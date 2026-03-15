import "dotenv/config";
import { PrismaClient, ContactMethod } from "@prisma/client";

const prisma = new PrismaClient();

type Candidate = {
  email?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  submissionUrl?: string | null;
  contactSourceUrl?: string | null;
  contactConfidence: number;
  enrichmentNotes?: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clean(value: unknown): string {
  return String(value || "").trim();
}

function isAsset(value: string): boolean {
  return /\.(png|jpg|jpeg|webp|svg|gif|css|js|ico|pdf)(\?.*)?$/i.test(value);
}

function isBadEmail(email: string): boolean {
  const e = normalizeEmail(email);

  if (!e.includes("@")) return true;
  if (isAsset(e)) return true;

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

function extractEmails(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniq(
    matches
      .map(normalizeEmail)
      .filter((email) => !isBadEmail(email))
  );
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches =
    text.match(/https?:\/\/[^\s<>"')\]]+/gi) ||
    text.match(/www\.[^\s<>"')\]]+/gi) ||
    [];

  return uniq(
    matches
      .map((url) => {
        const trimmed = url.trim().replace(/[),.;]+$/, "");
        if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
        return trimmed;
      })
      .filter(Boolean)
  );
}

function looksLikeInstagram(url: string): boolean {
  return /instagram\.com/i.test(url);
}

function looksLikeLinktree(url: string): boolean {
  return /linktr\.ee|beacons\.ai|bio\.site|lnk\.bio/i.test(url);
}

function looksLikeSubmission(url: string): boolean {
  return /submit|submission|pitch|form|google\.com\/forms|typeform|airtable/i.test(url);
}

function looksLikeWebsite(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (looksLikeInstagram(url)) return false;
  return true;
}

function buildCandidatesFromPlaylist(input: {
  playlistName: string;
  description: string;
  spotifyUrl: string;
}): Candidate[] {
  const description = clean(input.description);
  const spotifyUrl = clean(input.spotifyUrl);

  const emails = extractEmails(description);
  const urls = extractUrls(description);

  const instagramUrl =
    urls.find((url) => looksLikeInstagram(url)) || null;

  const submissionUrl =
    urls.find((url) => looksLikeSubmission(url)) || null;

  const websiteUrl =
    urls.find((url) => looksLikeWebsite(url) && !looksLikeSubmission(url)) || null;

  const notesBase = `Auto-enriched from playlist description`;

  const candidates: Candidate[] = [];

  for (const email of emails) {
    let confidence = 70;

    if (submissionUrl) confidence = 90;
    else if (websiteUrl) confidence = 85;
    else if (instagramUrl) confidence = 75;

    candidates.push({
      email,
      instagramUrl,
      websiteUrl: looksLikeLinktree(websiteUrl || "") ? null : websiteUrl,
      submissionUrl,
      contactSourceUrl: spotifyUrl || null,
      contactConfidence: confidence,
      enrichmentNotes: notesBase,
    });
  }

  if (!emails.length && (instagramUrl || websiteUrl || submissionUrl)) {
    candidates.push({
      email: null,
      instagramUrl,
      websiteUrl: looksLikeLinktree(websiteUrl || "") ? null : websiteUrl,
      submissionUrl,
      contactSourceUrl: spotifyUrl || null,
      contactConfidence: submissionUrl ? 45 : 35,
      enrichmentNotes: `${notesBase} (links only, no email found)`,
    });
  }

  return candidates;
}

function pickBestCandidate(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;

  const scored = [...candidates].sort(
    (a, b) => b.contactConfidence - a.contactConfidence
  );

  return scored[0] || null;
}

async function main() {
  const playlists = await prisma.playlist.findMany({
    where: {
      OR: [
        { description: { not: null } },
        { spotifyUrl: { not: null } },
      ],
    },
    include: {
      curator: true,
    },
    take: 1000,
    orderBy: {
      createdAt: "desc",
    },
  });

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let failed = 0;
  let skippedDuplicate = 0;
  let skippedBadEmail = 0;
  let skippedNotBetter = 0;
  let linksOnlyUpdated = 0;

  for (const playlist of playlists) {
    processed++;

    try {
      const description = clean(playlist.description);
      const spotifyUrl = clean(playlist.spotifyUrl);
      const curator = playlist.curator;

      const candidates = buildCandidatesFromPlaylist({
        playlistName: playlist.name,
        description,
        spotifyUrl,
      });

      const best = pickBestCandidate(candidates);

      if (!best) {
        notFound++;
        console.log(`NO CONTACT | ${playlist.name}`);
        continue;
      }

      if (best.email) {
        const normalizedEmail = normalizeEmail(best.email);

        if (isBadEmail(normalizedEmail)) {
          skippedBadEmail++;
          console.log(`BAD EMAIL | ${playlist.name} | ${normalizedEmail}`);
          continue;
        }

        const existingByEmail = await prisma.curator.findFirst({
          where: {
            email: normalizedEmail,
            NOT: { id: curator.id },
          },
          select: {
            id: true,
            name: true,
            email: true,
          },
        });

        if (existingByEmail) {
          skippedDuplicate++;
          console.log(
            `DUPLICATE EMAIL | ${playlist.name} | ${normalizedEmail} | existing=${existingByEmail.name}`
          );
          continue;
        }

        const currentConfidence = curator.contactConfidence ?? 0;
        const hasNoEmail = !curator.email;
        const betterConfidence = best.contactConfidence > currentConfidence;

        if (!hasNoEmail && !betterConfidence) {
          skippedNotBetter++;
          console.log(`SKIP NOT BETTER | ${playlist.name} | ${curator.name}`);
          continue;
        }

        await prisma.curator.update({
          where: { id: curator.id },
          data: {
            email: normalizedEmail,
            contactMethod: ContactMethod.EMAIL,
            instagramUrl: best.instagramUrl || curator.instagramUrl,
            websiteUrl: best.websiteUrl || curator.websiteUrl,
            submissionUrl: best.submissionUrl || curator.submissionUrl,
            contactSourceUrl: best.contactSourceUrl || curator.contactSourceUrl,
            contactConfidence: best.contactConfidence,
            lastEnrichedAt: new Date(),
            enrichmentNotes: best.enrichmentNotes || "Auto-enriched from playlist description",
          },
        });

        found++;
        console.log(
          `FOUND EMAIL | ${playlist.name} | ${normalizedEmail} | confidence=${best.contactConfidence}`
        );
        continue;
      }

      const hasAnyNewLink =
        (!!best.instagramUrl && !curator.instagramUrl) ||
        (!!best.websiteUrl && !curator.websiteUrl) ||
        (!!best.submissionUrl && !curator.submissionUrl);

      if (!hasAnyNewLink) {
        notFound++;
        console.log(`NO EMAIL / NO NEW LINKS | ${playlist.name}`);
        continue;
      }

      await prisma.curator.update({
        where: { id: curator.id },
        data: {
          instagramUrl: best.instagramUrl || curator.instagramUrl,
          websiteUrl: best.websiteUrl || curator.websiteUrl,
          submissionUrl: best.submissionUrl || curator.submissionUrl,
          contactSourceUrl: best.contactSourceUrl || curator.contactSourceUrl,
          contactConfidence: Math.max(curator.contactConfidence ?? 0, best.contactConfidence),
          lastEnrichedAt: new Date(),
          enrichmentNotes: best.enrichmentNotes || "Auto-enriched links from playlist description",
        },
      });

      linksOnlyUpdated++;
      console.log(`LINKS ONLY | ${playlist.name}`);
    } catch (error) {
      failed++;
      console.error(`FAILED | playlist=${playlist.name}`);
      console.error(error);
    }
  }

  console.log("\n=== DONE ===");
  console.log({
    processed,
    found,
    notFound,
    failed,
    skippedDuplicate,
    skippedBadEmail,
    skippedNotBetter,
    linksOnlyUpdated,
  });
}

main()
  .catch((e) => {
    console.error("ENRICHMENT FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });