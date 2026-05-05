import "dotenv/config";
import { PrismaClient, ContactMethod } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE || 200);
const REQUEST_TIMEOUT_MS = 12000;

type CuratorRow = {
  id: string;
  name: string;
  email: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  submissionUrl: string | null;
  contactSourceUrl: string | null;
  contactConfidence: number;
};

type Candidate = {
  email: string;
  sourceUrl: string;
  confidence: number;
  note: string;
};

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isBadEmail(email: string): boolean {
  const e = normalizeEmail(email);

  if (!e.includes("@")) return true;
  if (/\.(png|jpg|jpeg|svg|webp|gif|css|js|ico|pdf)(\?.*)?$/i.test(e)) return true;

  const blockedExact = new Set([
    "error-lite@duckduckgo.com",
  ]);

  if (blockedExact.has(e)) return true;

  const blockedPrefixes = [
    "noreply@",
    "no-reply@",
    "privacy@",
    "support@",
    "help@",
    "legal@",
    "abuse@",
    "admin@",
    "hello@spotify.com",
    "info@spotify.com",
  ];

  if (blockedPrefixes.some((prefix) => e.startsWith(prefix))) return true;

  const blockedDomains = new Set([
    "duckduckgo.com",
    "google.com",
    "bing.com",
    "yahoo.com",
    "spotify.com",
    "instagram.com",
    "facebookmail.com",
    "example.com",
    "test.com",
    "email.com",
  ]);

  const domain = e.split("@")[1] || "";
  if (blockedDomains.has(domain)) return true;

  return false;
}

function decodeObfuscation(input: string): string {
  return input
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/mailto:/gi, "");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(text: string): string[] {
  const decoded = decodeObfuscation(text);
  const matches =
    decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];

  return uniq(
    matches
      .map(normalizeEmail)
      .filter((email) => !isBadEmail(email))
  );
}

function buildSourceList(curator: CuratorRow): string[] {
  return uniq(
    [
      curator.submissionUrl,
      curator.websiteUrl,
      curator.contactSourceUrl,
      curator.instagramUrl,
    ]
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean)
  );
}

function scoreCandidate(email: string, sourceUrl: string, raw: string): Candidate {
  const lowerUrl = sourceUrl.toLowerCase();
  const lowerRaw = raw.toLowerCase();

  let confidence = 50;
  let note = "Found email on linked page";

  if (lowerRaw.includes(`mailto:${email}`)) {
    confidence = 95;
    note = "Found mailto on linked page";
  } else if (lowerUrl.includes("contact")) {
    confidence = 90;
    note = "Found email on contact page";
  } else if (lowerUrl.includes("submit") || lowerUrl.includes("submission")) {
    confidence = 85;
    note = "Found email on submission page";
  } else if (lowerUrl.includes("instagram.com")) {
    confidence = 55;
    note = "Found email on Instagram page text";
  } else if (lowerUrl.includes("linktr.ee") || lowerUrl.includes("beacons.ai") || lowerUrl.includes("bio.site")) {
    confidence = 60;
    note = "Found email on profile hub page";
  } else if (lowerRaw.includes("contact")) {
    confidence = 75;
    note = "Found email near contact-related content";
  }

  return { email, sourceUrl, confidence, note };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; TuneReachBot/1.0; +https://tunereach.app)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return null;
    }

    return await res.text();
  } catch {
    return null;
  }
}

async function main() {
  const curators = await prisma.curator.findMany({
    where: {
      email: null,
      OR: [
        { websiteUrl: { not: null } },
        { submissionUrl: { not: null } },
        { instagramUrl: { not: null } },
        { contactSourceUrl: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      instagramUrl: true,
      websiteUrl: true,
      submissionUrl: true,
      contactSourceUrl: true,
      contactConfidence: true,
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "desc" },
  });

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let failed = 0;
  let duplicateEmail = 0;

  console.log("\n=== ENRICH FROM LINKS ===");
  console.log(`Processing: ${curators.length}\n`);

  for (const curator of curators) {
    processed++;
    try {
      const sources = buildSourceList(curator);

      if (sources.length === 0) {
        notFound++;
        console.log(`NO SOURCES | ${curator.name}`);
        continue;
      }

      let best: Candidate | null = null;

      for (const source of sources) {
        const html = await fetchText(source);
        if (!html) continue;

        const plain = stripHtml(html);
        const searchable = `${html}\n${plain}`;
        const emails = extractEmails(searchable);

        if (!emails.length) continue;

        const candidate = scoreCandidate(emails[0], source, searchable);

        if (!best || candidate.confidence > best.confidence) {
          best = candidate;
        }

        if (candidate.confidence >= 90) break;
      }

      if (!best) {
        await prisma.curator.update({
          where: { id: curator.id },
          data: {
            lastEnrichedAt: new Date(),
            enrichmentNotes: "No email found from linked pages",
          },
        });

        notFound++;
        console.log(`NOT FOUND | ${curator.name}`);
        continue;
      }

      const existingByEmail = await prisma.curator.findFirst({
        where: {
          email: best.email,
          NOT: { id: curator.id },
        },
        select: { id: true, name: true },
      });

      if (existingByEmail) {
        duplicateEmail++;
        console.log(`DUPLICATE | ${curator.name} | ${best.email}`);
        continue;
      }

      await prisma.curator.update({
        where: { id: curator.id },
        data: {
          email: best.email,
          contactMethod: ContactMethod.EMAIL,
          contactConfidence: best.confidence,
          contactSourceUrl: best.sourceUrl,
          lastEnrichedAt: new Date(),
          enrichmentNotes: best.note,
        },
      });

      found++;
      console.log(
        `FOUND | ${curator.name} | ${best.email} | confidence=${best.confidence}`
      );
    } catch (error) {
      failed++;
      console.error(`FAILED | ${curator.name}`);
      console.error(error);
    }
  }

  const sendableCount = await prisma.curator.count({
    where: {
      email: { not: null },
      contactMethod: ContactMethod.EMAIL,
      consent: true,
    },
  });

  console.log("\n=== DONE ===");
  console.log({
    processed,
    found,
    notFound,
    failed,
    duplicateEmail,
    sendableCount,
  });
}

main()
  .catch((e) => {
    console.error("ENRICH FROM LINKS FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });