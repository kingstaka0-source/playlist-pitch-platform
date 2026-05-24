import prisma from "../src/lib/prisma";

function extractEmail(text: string): string | null {
  const match = text.match(
    /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i
  );

  if (!match) return null;

  const email = match[1].toLowerCase();

  // 🔥 blacklist junk emails
  const blocked = [
    "noreply",
    "no-reply",
    "spotify",
    "example",
    "test",
  ];

  const isBlocked = blocked.some((b) =>
    email.includes(b)
  );

  if (isBlocked) {
    return null;
  }

  return email;
}

function extractInstagram(text: string): string | null {
  const match = text.match(
    /(https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+)/i
  );

  return match ? match[1] : null;
}

function extractWebsite(text: string): string | null {
  const match = text.match(
    /(https?:\/\/[^\s]+)/i
  );

  return match ? match[1] : null;
}

function extractSubmissionUrl(text: string): string | null {
  const patterns = [
    /(https?:\/\/[^\s]*submithub[^\s]*)/i,
    /(https?:\/\/[^\s]*groover[^\s]*)/i,
    /(https?:\/\/[^\s]*linktr\.ee[^\s]*)/i,
    /(https?:\/\/[^\s]*toneden[^\s]*)/i,
    /(https?:\/\/[^\s]*google\.[^\s]*forms[^\s]*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function calculateConfidence(input: {
  email?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  submissionUrl?: string | null;
}) {
  let score = 0;

  if (input.email) {
    score += 40;
  }

  if (input.instagramUrl) {
    score += 20;
  }

  if (input.websiteUrl) {
    score += 15;
  }

  if (input.submissionUrl) {
    score += 25;
  }

  if (!input.email && !input.submissionUrl) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

async function run() {
  const playlists = await prisma.playlist.findMany({
    include: {
      curator: true,
    },
    take: 1500,
  });

  let found = 0;
  let notFound = 0;
  let updated = 0;

  for (const playlist of playlists) {
    try {
      if (!playlist.curator) continue;

      const text = `
${playlist.name || ""}
${playlist.description || ""}
${playlist.ownerDisplayName || ""}
${playlist.spotifyUrl || ""}
`;

      const email = extractEmail(text);

      const instagramUrl = extractInstagram(text);

      const rawWebsite = extractWebsite(text);

const websiteUrl =
  rawWebsite &&
  !rawWebsite.includes("open.spotify.com")
    ? rawWebsite
    : null;

const submissionUrl = extractSubmissionUrl(text);

      if (!email && !instagramUrl && !websiteUrl && !submissionUrl) {
        notFound++;
        console.log("NO CONTACT", playlist.name);
        continue;
      }

      await prisma.curator.update({
        where: {
          id: playlist.curator.id,
        },
        data: {
          ...(email
            ? {
                email,
                contactMethod: "EMAIL",
              }
            : {}),

          ...(instagramUrl
            ? {
                instagramUrl,
              }
            : {}),

          ...(websiteUrl
            ? {
                websiteUrl,
              }
            : {}),

            ...(submissionUrl
  ? {
      submissionUrl,
    }
  : {}),

          contactConfidence: 70,
          enrichmentNotes: "playlist_scan_ai",
          lastEnrichedAt: new Date(),
        },
      });

      updated++;

      if (email || instagramUrl) {
        found++;
      }

      console.log("UPDATED", {
        playlist: playlist.name,
        curator: playlist.curator.name,
        email,
        instagramUrl,
        websiteUrl,
      });
    } catch (err) {
      console.error("ENRICH FAILED", playlist.name, err);
    }
  }

  console.log("\n=== DONE ===");

  console.log({
    processed: playlists.length,
    found,
    updated,
    notFound,
  });
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });