import "dotenv/config";
import { PrismaClient, ContactMethod } from "@prisma/client";

const prisma = new PrismaClient();

type SearchCandidate = {
  curatorId: string;
  curatorName: string;
  playlistName: string;
  spotifyPlaylistId: string | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function extractEmails(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches)];
}

function scoreEmail(email: string) {
  const lower = email.toLowerCase();

  if (
    lower.includes("noreply") ||
    lower.includes("no-reply") ||
    lower.includes("do-not-reply") ||
    lower.includes("donotreply")
  ) {
    return 0;
  }

  if (
    lower.includes("submit") ||
    lower.includes("music") ||
    lower.includes("demo") ||
    lower.includes("playlist") ||
    lower.includes("contact") ||
    lower.includes("booking")
  ) {
    return 90;
  }

  if (
    lower.endsWith("@gmail.com") ||
    lower.endsWith("@outlook.com") ||
    lower.endsWith("@hotmail.com") ||
    lower.endsWith("@icloud.com")
  ) {
    return 70;
  }

  return 75;
}

function chooseBestEmail(emails: string[]) {
  if (!emails.length) return null;

  const ranked = emails
    .map((email) => ({ email, score: scoreEmail(email) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0] || null;
}

async function fetchText(url: string) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 PlaylistPitchPlatform/1.0",
      },
    });

    if (!res.ok) return "";

    return await res.text();
  } catch {
    return "";
  }
}

async function enrichOne(candidate: SearchCandidate) {
  const queries = [
    `"${candidate.curatorName}" playlist email`,
    `"${candidate.curatorName}" contact`,
    `"${candidate.playlistName}" submit music`,
    `"${candidate.playlistName}" playlist contact`,
  ];

  let combinedText = "";
  let sourceUrl: string | null = null;
  let websiteUrl: string | null = null;
  let instagramUrl: string | null = null;
  let submissionUrl: string | null = null;

  for (const q of queries) {
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const html = await fetchText(searchUrl);

    if (!html) continue;

    combinedText += "\n" + html;

    const urls = extractUrls(html);

    for (const url of urls) {
      const lower = url.toLowerCase();

      if (!sourceUrl) sourceUrl = url;
      if (!websiteUrl && !lower.includes("instagram.com") && !lower.includes("spotify.com")) {
        websiteUrl = url;
      }
      if (!instagramUrl && lower.includes("instagram.com")) {
        instagramUrl = url;
      }
      if (
        !submissionUrl &&
        (lower.includes("submit") || lower.includes("submission") || lower.includes("contact"))
      ) {
        submissionUrl = url;
      }
    }
  }

  const emails = extractEmails(combinedText);
  const best = chooseBestEmail(emails);

  if (!best) {
    await prisma.curator.update({
      where: { id: candidate.curatorId },
      data: {
        contactSourceUrl: sourceUrl,
        websiteUrl,
        instagramUrl,
        submissionUrl,
        lastEnrichedAt: new Date(),
        contactConfidence: 0,
        enrichmentNotes: "No public email found",
      },
    });

    return {
      curatorId: candidate.curatorId,
      found: false,
    };
  }

  await prisma.curator.update({
    where: { id: candidate.curatorId },
    data: {
      email: best.email,
      contactMethod: ContactMethod.EMAIL,
      consent: true,
      contactSourceUrl: sourceUrl,
      websiteUrl,
      instagramUrl,
      submissionUrl,
      contactConfidence: best.score,
      lastEnrichedAt: new Date(),
      enrichmentNotes: `Auto-enriched from public web results`,
    },
  });

  return {
    curatorId: candidate.curatorId,
    found: true,
    email: best.email,
    score: best.score,
  };
}

async function main() {
  const curators = await prisma.curator.findMany({
    where: {
      OR: [
        { email: null },
        { contactMethod: ContactMethod.INAPP },
      ],
    },
    include: {
      playlists: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    take: 200,
  });

  let found = 0;
  let notFound = 0;
  let failed = 0;

  for (const curator of curators) {
    const playlist = curator.playlists[0];

    if (!playlist) continue;

    const candidate: SearchCandidate = {
      curatorId: curator.id,
      curatorName: clean(curator.name),
      playlistName: clean(playlist.name),
      spotifyPlaylistId: playlist.spotifyPlaylistId,
    };

    try {
      const result = await enrichOne(candidate);

      if (result.found) {
        found += 1;
        console.log(`FOUND ${candidate.curatorName} -> ${result.email}`);
      } else {
        notFound += 1;
        console.log(`NO EMAIL ${candidate.curatorName}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`FAILED ${candidate.curatorName}: ${String(error)}`);
    }
  }

  console.log("\n=== DONE ===");
  console.log({
    processed: curators.length,
    found,
    notFound,
    failed,
  });
}

main()
  .catch((e) => {
    console.error("ENRICH FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });