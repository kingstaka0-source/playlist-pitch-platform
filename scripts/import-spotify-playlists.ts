import "dotenv/config";
import { PrismaClient, ContactMethod, Prisma } from "@prisma/client";
import {
  extractCuratorContactFromDescription,
  getActionableContactType,
} from "../src/lib/curatorContactQuality";

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

  // SOCA / CARIBBEAN / CARNIVAL
{ q: "soca", genres: ["soca", "caribbean"] },
{ q: "soca playlist", genres: ["soca", "caribbean"] },
{ q: "soca 2025", genres: ["soca", "caribbean"] },
{ q: "soca 2026", genres: ["soca", "caribbean"] },
{ q: "carnival soca", genres: ["soca", "carnival", "caribbean"] },
{ q: "trinidad soca", genres: ["soca", "caribbean"] },
{ q: "caribbean vibes", genres: ["caribbean", "soca", "dancehall"] },
{ q: "caribbean party", genres: ["caribbean", "soca", "dancehall"] },
{ q: "island vibes", genres: ["caribbean", "soca", "dancehall"] },
{ q: "calypso soca", genres: ["soca", "calypso", "caribbean"] },
{ q: "bouyon", genres: ["soca", "caribbean"] },
{ q: "tropical party", genres: ["caribbean", "soca", "afro"] },

// SURINAME / CARIBBEAN / KASEKO
{ q: "surinam music", genres: ["surinam", "caribbean"] },
{ q: "suriname playlist", genres: ["surinam", "caribbean"] },
{ q: "surinaamse muziek", genres: ["surinam", "caribbean"] },
{ q: "kaseko", genres: ["kaseko", "surinam"] },
{ q: "kaseko playlist", genres: ["kaseko", "surinam"] },
{ q: "kawina", genres: ["kawina", "surinam"] },
{ q: "kawina playlist", genres: ["kawina", "surinam"] },
{ q: "suripop", genres: ["surinam"] },
{ q: "baithak gana", genres: ["surinam", "caribbean"] },
{ q: "chutney music", genres: ["caribbean", "surinam"] },
{ q: "caribbean nederland", genres: ["caribbean"] },
{ q: "zouk caribbean", genres: ["caribbean"] },
{ q: "dutch caribbean", genres: ["caribbean"] },

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

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSeconds = Number.parseInt(
      retryAfterHeader || "",
      10
    );

    const retryAfter =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : null;

    const retryMessage =
      retryAfter !== null
        ? `Spotify rate limit reached. Retry after ${retryAfter} seconds.`
        : "Spotify rate limit reached. Retry later.";

    throw new Error(retryMessage);
  }

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
  q: string,
  maxPages = MAX_PAGES_PER_QUERY
): Promise<SpotifyPlaylistItem[]> {
  const all: SpotifyPlaylistItem[] = [];

  for (let page = 0; page < maxPages; page++) {
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
            spotifyUrl: safeSpotifyUrl(item),
            description: safeDescription(item?.description),
            ownerDisplayName: safeOwnerDisplayName(item),
            ownerSpotifyId: safeOwnerSpotifyId(item),
            genres,
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

  const contact = extractCuratorContactFromDescription(description);
  const contactType = getActionableContactType(contact);

  if (contactType === "NONE") {
    return {
      status: "skipped_no_contact" as const,
      name: playlistName,
      isOfficial,
    };
  }

  const contactMethod =
    contactType === "EMAIL"
      ? ContactMethod.EMAIL
      : ContactMethod.INAPP;

  let curator =
    contact.email
      ? await withRetry(
          () =>
            prisma.curator.findFirst({
              where: { email: contact.email },
            }),
          `curator.findByEmail(${contact.email})`
        )
      : null;

  if (!curator) {
    curator = await withRetry(
      () =>
        prisma.curator.findFirst({
          where: {
            name: ownerName,
            contactMethod,
          },
        }),
      `curator.findFirst(${ownerName})`
    );
  }

  if (curator) {
    curator = await withRetry(
      () =>
        prisma.curator.update({
          where: { id: curator!.id },
          data: {
            email: contact.email || curator!.email,
            contactMethod:
              contactType === "EMAIL"
                ? ContactMethod.EMAIL
                : curator!.contactMethod,
            instagramUrl:
              contact.instagramUrl || curator!.instagramUrl,
            websiteUrl:
              contact.websiteUrl || curator!.websiteUrl,
            submissionUrl:
              contact.submissionUrl || curator!.submissionUrl,
            contactConfidence: Math.max(
              curator!.contactConfidence ?? 0,
              contact.contactConfidence
            ),
            contactSourceUrl:
              safeSpotifyUrl(item) || curator!.contactSourceUrl,
            lastEnrichedAt: new Date(),
            enrichmentNotes:
              curator!.enrichmentNotes ||
              "Verified from Spotify playlist description",
          },
        }),
      `curator.update(${ownerName})`
    );
  } else {
    curator = await withRetry(
      () =>
        prisma.curator.create({
          data: {
            name: ownerName,
            email: contact.email,
            contactMethod,
            consent: false,
            languages: ["en"],
            instagramUrl: contact.instagramUrl,
            websiteUrl: contact.websiteUrl,
            submissionUrl: contact.submissionUrl,
            contactConfidence: contact.contactConfidence,
            contactSourceUrl: safeSpotifyUrl(item),
            lastEnrichedAt: new Date(),
            enrichmentNotes:
              "Verified from Spotify playlist description",
          },
        }),
      `curator.create(${ownerName})`
    );
  }

  const rules = {
    importedFrom: "spotify_search_verified",
    isOfficialSpotify: isOfficial,
    isContactable: true,
    contactType,
    spotifyUrl: item?.external_urls?.spotify || null,
    imageUrl:
      Array.isArray(item?.images) && item.images[0]?.url
        ? item.images[0]!.url
        : null,
    ownerId,
    ownerName,
    description,
    trackCount: item?.tracks?.total ?? 0,
    isPublic: item?.public ?? null,
  };

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
  const now = new Date();

  const startOfUtcDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const startOfNextUtcDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )
  );

  const verifiedCreatedToday = await withRetry(
    () =>
      prisma.playlist.count({
        where: {
          createdAt: {
            gte: startOfUtcDay,
            lt: startOfNextUtcDay,
          },
          rules: {
            path: ["importedFrom"],
            equals: "spotify_search_verified",
          },
        },
      }),
    "playlist.count(verifiedCreatedToday)"
  );

  const DAILY_ACTIONABLE_PLAYLIST_LIMIT = 100;

  const remainingDailySlots = Math.max(
    0,
    DAILY_ACTIONABLE_PLAYLIST_LIMIT - verifiedCreatedToday
  );

  console.log("=== DAILY VERIFIED PLAYLIST CAP ===");
  console.log({
    verifiedCreatedToday,
    dailyLimit: DAILY_ACTIONABLE_PLAYLIST_LIMIT,
    remainingDailySlots,
    utcDay: startOfUtcDay.toISOString().slice(0, 10),
  });

  if (remainingDailySlots === 0) {
    console.log(
      `DAILY VERIFIED LIMIT ALREADY REACHED: ${DAILY_ACTIONABLE_PLAYLIST_LIMIT}`
    );
    return;
  }

  const accessToken = await getSpotifyAccessToken();

  let created = 0;
  let skippedNoContact = 0;
  let dailyLimitReached = false;
  let updated = 0;
  let skippedInvalid = 0;
  let failed = 0;
  let officialCount = 0;

  const seenPlaylistIds = new Set<string>();

  const filter = String(process.argv[2] || "").toLowerCase();

  const requestedMaxPages = Number.parseInt(process.argv[3] || "", 10);
  const maxPages =
    Number.isFinite(requestedMaxPages) && requestedMaxPages > 0
      ? Math.min(requestedMaxPages, MAX_PAGES_PER_QUERY)
      : MAX_PAGES_PER_QUERY;

  console.log(`Spotify pages per search: ${maxPages}/${MAX_PAGES_PER_QUERY}`);

const groupsToRun = filter
  ? SEARCH_GROUPS.filter((g) =>
      g.q.toLowerCase().includes(filter) ||
      g.genres.some((genre) => genre.toLowerCase().includes(filter))
    )
  : SEARCH_GROUPS;

  for (const group of groupsToRun) {
  console.log("Waiting to avoid Spotify rate limit...");
  await sleep(1200);

  console.log(`=== SEARCH: ${group.q} ===`);

  let items: SpotifyPlaylistItem[] = [];

  try {
    items = await searchSpotifyPlaylistsAllPages(
      accessToken,
      group.q,
      maxPages
    );
  } catch (error) {
    failed += 1;

    const message =
      error instanceof Error ? error.message : String(error);

    console.error(`SEARCH FAILED for "${group.q}":`, error);

    if (message.startsWith("Spotify rate limit reached.")) {
      throw error;
    }

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
          if (created >= remainingDailySlots) {
            dailyLimitReached = true;
            console.log(
              `DAILY VERIFIED LIMIT REACHED: ${DAILY_ACTIONABLE_PLAYLIST_LIMIT}`
            );
            break;
          }
        } else if (result.status === "updated") {
          updated += 1;
          console.log(
            `UPDATE ${result.name}${result.isOfficial ? " [OFFICIAL]" : ""}`
          );
        } else if (result.status === "skipped_no_contact") {
          skippedNoContact += 1;
          console.log(`SKIP no actionable contact: ${result.name}`);
        } else {
          skippedInvalid += 1;
          console.log("SKIP invalid playlist");
        }
      } catch (error) {
        failed += 1;
        console.error("IMPORT ITEM FAILED:", error);
      }
    }

    if (dailyLimitReached) {
      break;
    }
  }

  const total = await withRetry(
    () => prisma.playlist.count(),
    "playlist.count()"
  );

  console.log("\n=== DONE ===");
  console.log({
    verifiedCreatedBeforeRun: verifiedCreatedToday,
    remainingSlotsAtStart: remainingDailySlots,
    createdVerified: created,
    verifiedTotalAfterRun: verifiedCreatedToday + created,
    skippedNoContact,
    updated,
    skippedInvalid,
    failed,
    officialCount,
    dailyLimit: DAILY_ACTIONABLE_PLAYLIST_LIMIT,
    dailyLimitReached,
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