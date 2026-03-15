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
  href?: string | null;
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
  // REGGAE / ROOTS / DUB
  { q: "reggae", genres: ["reggae"] },
  { q: "reggae playlist", genres: ["reggae"] },
  { q: "best reggae", genres: ["reggae"] },
  { q: "new reggae", genres: ["reggae"] },
  { q: "reggae 2024", genres: ["reggae"] },
  { q: "reggae 2025", genres: ["reggae"] },
  { q: "roots reggae", genres: ["reggae", "roots"] },
  { q: "roots reggae playlist", genres: ["reggae", "roots"] },
  { q: "dub reggae", genres: ["reggae", "dub"] },
  { q: "dub reggae playlist", genres: ["reggae", "dub"] },
  { q: "conscious reggae", genres: ["reggae"] },
  { q: "modern reggae", genres: ["reggae"] },
  { q: "jamaican reggae", genres: ["reggae"] },
  { q: "roots and culture", genres: ["reggae", "roots"] },
  { q: "dub music", genres: ["dub"] },
  { q: "reggae roots dub", genres: ["reggae", "roots", "dub"] },
  { q: "caribbean reggae", genres: ["reggae"] },
  { q: "reggae vibes", genres: ["reggae"] },
  { q: "reggae mix", genres: ["reggae"] },
  { q: "island reggae", genres: ["reggae"] },

  // DANCEHALL
  { q: "dancehall", genres: ["dancehall", "reggae"] },
  { q: "dancehall playlist", genres: ["dancehall", "reggae"] },
  { q: "new dancehall", genres: ["dancehall"] },
  { q: "dancehall 2024", genres: ["dancehall"] },
  { q: "dancehall 2025", genres: ["dancehall"] },
  { q: "jamaican dancehall", genres: ["dancehall"] },
  { q: "caribbean dancehall", genres: ["dancehall"] },
  { q: "dancehall vibes", genres: ["dancehall"] },
  { q: "dancehall mix", genres: ["dancehall"] },
  { q: "afro dancehall", genres: ["dancehall", "afro"] },

  // AFRO / AFROBEATS
  { q: "afrobeats", genres: ["afro"] },
  { q: "afrobeats playlist", genres: ["afro"] },
  { q: "best afrobeats", genres: ["afro"] },
  { q: "new afrobeats", genres: ["afro"] },
  { q: "afrobeats 2024", genres: ["afro"] },
  { q: "afrobeats 2025", genres: ["afro"] },
  { q: "afrobeat", genres: ["afro"] },
  { q: "afrobeat playlist", genres: ["afro"] },
  { q: "afro fusion", genres: ["afro"] },
  { q: "afro fusion playlist", genres: ["afro"] },
  { q: "afro vibes", genres: ["afro"] },
  { q: "naija", genres: ["afro"] },
  { q: "naija hits", genres: ["afro"] },
  { q: "african music", genres: ["afro"] },
  { q: "african playlist", genres: ["afro"] },
  { q: "afropop", genres: ["afro"] },
  { q: "afropop playlist", genres: ["afro"] },
  { q: "amapiano", genres: ["afro"] },
  { q: "afrobeats chill", genres: ["afro"] },
  { q: "afrobeats mix", genres: ["afro"] },

  // HIPHOP / RAP / BOOM BAP / LOFI
  { q: "boom bap", genres: ["hiphop"] },
  { q: "boom bap playlist", genres: ["hiphop"] },
  { q: "underground hip hop", genres: ["hiphop"] },
  { q: "underground rap", genres: ["hiphop"] },
  { q: "hip hop playlist", genres: ["hiphop"] },
  { q: "rap playlist", genres: ["hiphop"] },
  { q: "indie rap", genres: ["hiphop"] },
  { q: "conscious hip hop", genres: ["hiphop"] },
  { q: "old school hip hop", genres: ["hiphop"] },
  { q: "golden era hip hop", genres: ["hiphop"] },
  { q: "lofi hip hop", genres: ["lofi", "hiphop"] },
  { q: "lofi hip hop playlist", genres: ["lofi", "hiphop"] },
  { q: "chillhop", genres: ["lofi", "hiphop"] },
  { q: "study beats", genres: ["lofi"] },
  { q: "beats to relax", genres: ["lofi"] },
  { q: "lyrical rap", genres: ["hiphop"] },
  { q: "spotify hip hop", genres: ["hiphop"] },
  { q: "hip hop discovery", genres: ["hiphop"] },
  { q: "independent hip hop", genres: ["hiphop"] },
  { q: "new rap 2025", genres: ["hiphop"] },

  // SOUL / RNB / CHILL / INDIE
  { q: "neo soul", genres: ["soul"] },
  { q: "neo soul playlist", genres: ["soul"] },
  { q: "soul playlist", genres: ["soul"] },
  { q: "modern soul", genres: ["soul"] },
  { q: "indie soul", genres: ["soul", "indie"] },
  { q: "chill rnb", genres: ["rnb"] },
  { q: "rnb playlist", genres: ["rnb"] },
  { q: "alternative rnb", genres: ["rnb"] },
  { q: "new rnb", genres: ["rnb"] },
  { q: "rnb vibes", genres: ["rnb"] },
  { q: "indie chill", genres: ["indie"] },
  { q: "indie playlist", genres: ["indie"] },
  { q: "indie discovery", genres: ["indie"] },
  { q: "chill playlist", genres: ["indie"] },
  { q: "chill vibes", genres: ["indie"] },
  { q: "bedroom pop", genres: ["indie"] },
  { q: "indie pop chill", genres: ["indie"] },
  { q: "mellow vibes", genres: ["indie"] },
  { q: "late night vibes", genres: ["indie", "rnb"] },
  { q: "chill soul", genres: ["soul", "rnb"] },

  // SUBMISSION / DISCOVERY / CURATOR-TYPE SEARCHES
  { q: "playlist submission", genres: [] },
  { q: "playlist submissions", genres: [] },
  { q: "submit music", genres: [] },
  { q: "submit your music", genres: [] },
  { q: "indie artists", genres: [] },
  { q: "indie artist playlist", genres: [] },
  { q: "music discovery", genres: [] },
  { q: "new music friday indie", genres: [] },
  { q: "independent artists", genres: [] },
  { q: "unsigned artists", genres: [] },
  { q: "emerging artists", genres: [] },
  { q: "artist discovery", genres: [] },
  { q: "new artist playlist", genres: [] },
  { q: "discover weekly indie", genres: [] },
  { q: "underrated artists", genres: [] },
];

const LIMIT_PER_PAGE = 10;
const MAX_PAGES_PER_QUERY = 20;

function clean(value: unknown): string {
  return String(value || "").trim();
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();

  return (
    message.includes("can't reach database server") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("connection") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("too many connections") ||
    message.includes("server has closed the connection")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const retryable = isRetryableError(error);

      console.error(
        `RETRY ${attempt}/${maxAttempts} FAILED | ${label} | retryable=${retryable}`
      );

      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      await sleep(1000 * attempt);
    }
  }

  throw lastError;
}

function isOfficialSpotifyPlaylist(item: SpotifyPlaylistItem): boolean {
  const ownerId = clean(item?.owner?.id).toLowerCase();
  const ownerName = clean(item?.owner?.display_name).toLowerCase();
  return ownerId === "spotify" || ownerName === "spotify";
}

function safeSpotifyUrl(playlist: SpotifyPlaylistItem): string | null {
  return playlist?.external_urls?.spotify || playlist?.href || null;
}

function safeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function safeOwnerDisplayName(playlist: SpotifyPlaylistItem): string | null {
  const value = playlist?.owner?.display_name || playlist?.owner?.id || null;
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function safeOwnerSpotifyId(playlist: SpotifyPlaylistItem): string | null {
  const value = playlist?.owner?.id;
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function getSpotifyAccessToken(): Promise<string> {
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
): Promise<SpotifyPlaylistItem[]> {
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

async function searchSpotifyPlaylistsAllPages(
  accessToken: string,
  q: string
): Promise<SpotifyPlaylistItem[]> {
  const all: SpotifyPlaylistItem[] = [];

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const offset = page * LIMIT_PER_PAGE;

    const items = await searchSpotifyPlaylistsPage(
      accessToken,
      q,
      LIMIT_PER_PAGE,
      offset
    );

    if (!items.length) break;

    console.log(
      `Fetched ${items.length} playlists for "${q}" (page ${page + 1}, offset ${offset})`
    );

    all.push(...items);

    if (items.length < LIMIT_PER_PAGE) break;

    await sleep(150);
  }

  return all;
}

async function findOrCreateCurator(input: {
  ownerId: string | null;
  ownerName: string;
}) {
  const ownerName = clean(input.ownerName) || "Unknown Curator";

  const existing = await withRetry(
    () =>
      prisma.curator.findFirst({
        where: {
          name: ownerName,
          contactMethod: ContactMethod.INAPP,
          consent: true,
        },
      }),
    `curator.findFirst(${ownerName})`
  );

  if (existing) return existing;

  return withRetry(
    () =>
      prisma.curator.create({
        data: {
          name: ownerName,
          email: null,
          contactMethod: ContactMethod.INAPP,
          consent: true,
          languages: ["en"],
        },
      }),
    `curator.create(${ownerName})`
  );
}

async function upsertPlaylist(item: SpotifyPlaylistItem, genreHints: string[]) {
  const spotifyPlaylistId = clean(item?.id);
  const playlistName = clean(item?.name);
  const ownerId = clean(item?.owner?.id) || null;
  const ownerName =
    clean(item?.owner?.display_name) || ownerId || "Unknown Curator";
  const description = clean(item?.description);
  const isOfficial = isOfficialSpotifyPlaylist(item);

  if (!spotifyPlaylistId || !playlistName) {
    return { status: "skipped_invalid" as const, isOfficial };
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

  const existing = await withRetry(
    () =>
      prisma.playlist.findFirst({
        where: { spotifyPlaylistId },
      }),
    `playlist.findFirst(${spotifyPlaylistId})`
  );

  if (existing) {
    const updated = await withRetry(
      () =>
        prisma.playlist.update({
          where: { id: existing.id },
          data: {
            name: playlistName,
            curatorId: curator.id,
            spotifyUrl: safeSpotifyUrl(item),
            description: safeDescription(item?.description),
            ownerDisplayName: safeOwnerDisplayName(item),
            ownerSpotifyId: safeOwnerSpotifyId(item),
            genres,
            rules: rules as Prisma.InputJsonValue,
          },
        }),
      `playlist.update(${playlistName})`
    );

    return {
      status: "updated" as const,
      playlistId: updated.id,
      name: updated.name,
      isOfficial,
    };
  }

  const created = await withRetry(
    () =>
      prisma.playlist.create({
        data: {
          curatorId: curator.id,
          name: playlistName,
          spotifyPlaylistId,
          spotifyUrl: safeSpotifyUrl(item),
          description: safeDescription(item?.description),
          ownerDisplayName: safeOwnerDisplayName(item),
          ownerSpotifyId: safeOwnerSpotifyId(item),
          genres,
          rules: rules as Prisma.InputJsonValue,
        },
      }),
    `playlist.create(${playlistName})`
  );

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
          console.log("SKIP invalid playlist");
        }
      } catch (error) {
        failed += 1;
        console.error("IMPORT ITEM FAILED:", error);
      }
    }
  }

  const total = await withRetry(
    () => prisma.playlist.count(),
    "playlist.count()"
  );

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