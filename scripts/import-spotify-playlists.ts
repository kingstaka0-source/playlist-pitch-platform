import "dotenv/config";
import { PrismaClient, ContactMethod, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type SpotifyTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type SpotifyPlaylistItem = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  external_urls?: { spotify?: string | null } | null;
  images?: Array<{ url?: string | null }> | null;
  owner?: {
    id?: string | null;
    display_name?: string | null;
    external_urls?: { spotify?: string | null } | null;
  } | null;
  tracks?: { total?: number | null } | null;
  public?: boolean | null;
};

type SpotifySearchResponse = {
  playlists?: {
    items?: SpotifyPlaylistItem[];
    total?: number;
    limit?: number;
    offset?: number;
    next?: string | null;
  } | null;
  error?: {
    message?: string;
    status?: number;
  } | null;
  message?: string;
};

const SEARCH_GROUPS = [
  { q: "reggae", genres: ["reggae"] },
  { q: "roots reggae", genres: ["reggae", "roots"] },
  { q: "dub reggae", genres: ["reggae", "dub"] },
  { q: "conscious reggae", genres: ["reggae"] },
  { q: "modern reggae", genres: ["reggae"] },

  { q: "dancehall", genres: ["dancehall", "reggae"] },
  { q: "jamaican dancehall", genres: ["dancehall"] },

  { q: "afrobeats", genres: ["afro"] },
  { q: "afrobeat", genres: ["afro"] },
  { q: "afro fusion", genres: ["afro"] },
  { q: "naija", genres: ["afro"] },

  { q: "boom bap", genres: ["hiphop"] },
  { q: "underground hip hop", genres: ["hiphop"] },
  { q: "lofi hip hop", genres: ["lofi", "hiphop"] },
  { q: "old school hip hop", genres: ["hiphop"] },

  { q: "indie chill", genres: ["indie"] },
  { q: "neo soul", genres: ["soul"] },
  { q: "chill rnb", genres: ["rnb"] },

  { q: "playlist submission", genres: [] },
  { q: "indie artists", genres: [] },
];

// Belangrijk:
// 10 werkt bij jou stabiel.
// We pagineren met meerdere pagina's om toch veel playlists op te halen.
const LIMIT_PER_PAGE = 10;
const MAX_PAGES_PER_QUERY = 10;

function clean(value: unknown) {
  return String(value || "").trim();
}

function uniqStrings(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function isOfficialSpotifyPlaylist(item: SpotifyPlaylistItem) {
  const ownerId = clean(item?.owner?.id).toLowerCase();
  const ownerName = clean(item?.owner?.display_name).toLowerCase();
  return ownerId === "spotify" || ownerName === "spotify";
}

async function getSpotifyAccessToken() {
  const clientId = clean(process.env.SPOTIFY_CLIENT_ID);
  const clientSecret = clean(process.env.SPOTIFY_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const json: SpotifyTokenResponse = await res.json().catch(() => ({}));

  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Spotify token failed (${res.status})`
    );
  }

  return json.access_token;
}

async function searchSpotifyPlaylistsPage(
  accessToken: string,
  q: string,
  limit: number,
  offset: number
) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const params = new URLSearchParams({
    q,
    type: "playlist",
    limit: String(safeLimit),
    offset: String(safeOffset),
  });

  const url = `https://api.spotify.com/v1/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json: SpotifySearchResponse = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      json?.error?.message ||
        json?.message ||
        `Spotify search failed (${res.status})`
    );
  }

  return Array.isArray(json?.playlists?.items) ? json.playlists.items : [];
}

async function searchSpotifyPlaylistsAllPages(accessToken: string, q: string) {
  const all: SpotifyPlaylistItem[] = [];

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const offset = page * LIMIT_PER_PAGE;

    const items = await searchSpotifyPlaylistsPage(
      accessToken,
      q,
      LIMIT_PER_PAGE,
      offset
    );

    if (!items.length) {
      break;
    }

    console.log(
      `Fetched ${items.length} playlists for "${q}" (page ${page + 1}, offset ${offset})`
    );

    all.push(...items);

    if (items.length < LIMIT_PER_PAGE) {
      break;
    }
  }

  return all;
}

async function findOrCreateCurator(input: {
  ownerId: string | null;
  ownerName: string;
}) {
  const ownerName = clean(input.ownerName) || "Unknown Curator";

  const existing = await prisma.curator.findFirst({
    where: {
      name: ownerName,
      contactMethod: ContactMethod.INAPP,
      consent: true,
    },
  });

  if (existing) return existing;

  return prisma.curator.create({
    data: {
      name: ownerName,
      email: null,
      contactMethod: ContactMethod.INAPP,
      consent: true,
      languages: ["en"],
    },
  });
}

async function upsertPlaylist(item: SpotifyPlaylistItem, genreHints: string[]) {
  const spotifyPlaylistId = clean(item?.id);
  const playlistName = clean(item?.name);
  const ownerId = clean(item?.owner?.id) || null;
  const ownerName = clean(item?.owner?.display_name) || ownerId || "Unknown Curator";
  const description = clean(item?.description);
  const isOfficial = isOfficialSpotifyPlaylist(item);

  if (!spotifyPlaylistId || !playlistName) {
    return { status: "skipped_invalid" as const };
  }

  const curator = await findOrCreateCurator({
    ownerId,
    ownerName,
  });

  const detectedGenres = description
    .toLowerCase()
    .split(/[^a-z0-9+#-]+/i)
    .filter((w) =>
      [
        "reggae",
        "roots",
        "dub",
        "dancehall",
        "afro",
        "afrobeats",
        "afrobeat",
        "hiphop",
        "hip-hop",
        "rap",
        "lofi",
        "indie",
        "chill",
        "soul",
        "rnb",
      ].includes(w)
    );

  const genres = uniqStrings([...genreHints, ...detectedGenres]);

  const rules = {
    importedFrom: "spotify_search",
    isOfficialSpotify: isOfficial,
    isContactable: false,
    spotifyUrl: item?.external_urls?.spotify || null,
    imageUrl:
      Array.isArray(item?.images) && item.images[0]?.url ? item.images[0]!.url : null,
    ownerId,
    ownerName,
    description,
    trackCount: item?.tracks?.total ?? 0,
    isPublic: item?.public ?? null,
  };

  const existing = await prisma.playlist.findFirst({
    where: { spotifyPlaylistId },
  });

  if (existing) {
    const updated = await prisma.playlist.update({
      where: { id: existing.id },
      data: {
        name: playlistName,
        curatorId: curator.id,
        genres,
        rules: rules as Prisma.InputJsonValue,
      },
    });

    return {
      status: "updated" as const,
      playlistId: updated.id,
      name: updated.name,
      isOfficial,
    };
  }

  const created = await prisma.playlist.create({
    data: {
      curatorId: curator.id,
      name: playlistName,
      spotifyPlaylistId,
      genres,
      rules: rules as Prisma.InputJsonValue,
    },
  });

  return {
    status: "created" as const,
    playlistId: created.id,
    name: created.name,
    isOfficial,
  };
}

async function main() {
  const accessToken = await getSpotifyAccessToken();

  let created = 0;
  let updated = 0;
  let skippedInvalid = 0;
  let failed = 0;
  let officialCount = 0;

  const seenPlaylistIds = new Set<string>();

  for (const group of SEARCH_GROUPS) {
    console.log(`\n=== SEARCH: ${group.q} ===`);

    let items: SpotifyPlaylistItem[] = [];

    try {
      items = await searchSpotifyPlaylistsAllPages(accessToken, group.q);
    } catch (error) {
      failed += 1;
      console.error(`SEARCH FAILED for "${group.q}":`, error);
      continue;
    }

    for (const item of items) {
      try {
        const spotifyPlaylistId = clean(item?.id);

        if (!spotifyPlaylistId) {
          skippedInvalid += 1;
          continue;
        }

        if (seenPlaylistIds.has(spotifyPlaylistId)) {
          continue;
        }
        seenPlaylistIds.add(spotifyPlaylistId);

        const result = await upsertPlaylist(item, group.genres);

        if (result.isOfficial) {
          officialCount += 1;
        }

        if (result.status === "created") {
          created += 1;
          console.log(
            `CREATE ${result.name}${result.isOfficial ? " [OFFICIAL]" : ""}`
          );
        } else if (result.status === "updated") {
          updated += 1;
          console.log(
            `UPDATE ${result.name}${result.isOfficial ? " [OFFICIAL]" : ""}`
          );
        } else {
          skippedInvalid += 1;
          console.log(`SKIP invalid playlist`);
        }
      } catch (error) {
        failed += 1;
        console.error("IMPORT ITEM FAILED:", error);
      }
    }
  }

  const total = await prisma.playlist.count();

  console.log("\n=== DONE ===");
  console.log({
    created,
    updated,
    skippedInvalid,
    failed,
    officialCount,
    totalPlaylistsInDb: total,
  });
}

main()
  .catch((e) => {
    console.error("IMPORT FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });