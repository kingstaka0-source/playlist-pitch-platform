import { Router } from "express";
import { prisma } from "../db";
import { importSpotifyPlaylistForArtist } from "../lib/spotifyPlaylistImporter";
import { Prisma } from "@prisma/client";

export const playlists = Router();

type RequestLike = {
  headers?: Record<string, unknown>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

type CuratorLike = {
  email?: string | null;
  contactMethod?: string | null;
  consent?: boolean | null;
};

type SpotifyTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type SpotifyPlaylistSearchItem = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  external_urls?: {
    spotify?: string | null;
  } | null;
  images?: Array<{
    url?: string | null;
  }> | null;
  owner?: {
    id?: string | null;
    display_name?: string | null;
    external_urls?: {
      spotify?: string | null;
    } | null;
  } | null;
  tracks?: {
    total?: number | null;
  } | null;
  public?: boolean | null;
};

type SpotifyPlaylistSearchResponse = {
  playlists?: {
    items?: SpotifyPlaylistSearchItem[];
  } | null;
  error?: {
    message?: string;
  } | null;
  message?: string;
};

function getArtistId(req: RequestLike) {
  const headerArtistId =
    typeof req.headers?.["x-artist-id"] === "string"
      ? req.headers["x-artist-id"]
      : "";

  const bodyArtistId =
    typeof req.body?.artistId === "string" ? req.body.artistId : "";

  const queryArtistId =
    typeof req.query?.artistId === "string" ? req.query.artistId : "";

  return String(headerArtistId || bodyArtistId || queryArtistId || "").trim();
}

function canEmailCurator(curator: CuratorLike | null | undefined) {
  return (
    !!curator?.email &&
    curator.contactMethod === "EMAIL" &&
    curator.consent === true
  );
}

function buildPitchContent(input: {
  trackTitle: string;
  playlistName: string;
  spotifyTrackId?: string | null;
  explanation?: string | null;
}) {
  const spotifyUrl = input.spotifyTrackId
    ? `https://open.spotify.com/track/${input.spotifyTrackId}`
    : "";

  const explanationLine = input.explanation
    ? `Reason this track fits your playlist: ${input.explanation}`
    : "";

  const subject = `Track suggestion: ${input.trackTitle}`;

  const body = `Hi,

I came across your playlist "${input.playlistName}" and thought my track "${input.trackTitle}" could be a strong fit.

${explanationLine}

Spotify link:
${spotifyUrl}

Thanks for your time 🙏
`;

  return { subject, body };
}

function getSpotifyClientCredentials() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_CREDENTIALS_MISSING");
  }

  return { clientId, clientSecret };
}

async function getSpotifyAppAccessToken() {
  const { clientId, clientSecret } = getSpotifyClientCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const tokenJson: SpotifyTokenResponse = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !tokenJson?.access_token) {
    throw new Error(
      tokenJson?.error_description ||
        tokenJson?.error ||
        "SPOTIFY_CLIENT_CREDENTIALS_FAILED"
    );
  }

  return String(tokenJson.access_token);
}

playlists.post("/playlists", async (req, res) => {
  try {
    const {
      curatorId,
      name,
      spotifyPlaylistId,
      genres = [],
      minBpm = null,
      maxBpm = null,
      minEnergy = null,
      maxEnergy = null,
      rules = null,
    } = req.body ?? {};

    if (!curatorId || !name) {
      return res.status(400).json({
        error: "CURATOR_ID_AND_NAME_REQUIRED",
      });
    }

    const curator = await prisma.curator.findUnique({
      where: { id: String(curatorId) },
    });

    if (!curator) {
      return res.status(404).json({ error: "CURATOR_NOT_FOUND" });
    }

    const playlist = await prisma.playlist.create({
      data: {
        curatorId: String(curatorId),
        name: String(name).trim(),
        spotifyPlaylistId: spotifyPlaylistId
          ? String(spotifyPlaylistId).trim()
          : null,
        genres: Array.isArray(genres) ? genres.map((g) => String(g)) : [],
        minBpm: minBpm == null ? null : Number(minBpm),
        maxBpm: maxBpm == null ? null : Number(maxBpm),
        minEnergy: minEnergy == null ? null : Number(minEnergy),
        maxEnergy: maxEnergy == null ? null : Number(maxEnergy),
        rules: rules ?? null,
      },
      include: {
        curator: true,
      },
    });

    return res.json({
      ok: true,
      playlist,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_CREATE_ERROR", details);
    return res.status(500).json({
      error: "PLAYLIST_CREATE_FAILED",
      details,
    });
  }
});

playlists.post("/playlists/discover", async (req, res) => {
  try {
    const payload = (req.body ?? {}) as Record<string, unknown>;

    const curatorName = String(payload.curatorName || payload.name || "").trim();
    const curatorEmailRaw =
      payload.curatorEmail == null
        ? ""
        : String(payload.curatorEmail).trim().toLowerCase();

    const contactMethod = String(payload.contactMethod || "EMAIL")
      .trim()
      .toUpperCase();

    const consent =
      payload.consent === undefined || payload.consent === null
        ? true
        : !!payload.consent;

    const playlistName = String(payload.playlistName || payload.name || "").trim();

    const spotifyPlaylistId = payload.spotifyPlaylistId
      ? String(payload.spotifyPlaylistId).trim()
      : null;

    const genres = Array.isArray(payload.genres)
      ? payload.genres.map((value) => String(value))
      : [];

    const languages = Array.isArray(payload.languages)
      ? payload.languages.map((value) => String(value))
      : ["en"];

    const rules = payload.rules ?? null;

    const minBpm = payload.minBpm == null ? null : Number(payload.minBpm);
    const maxBpm = payload.maxBpm == null ? null : Number(payload.maxBpm);
    const minEnergy = payload.minEnergy == null ? null : Number(payload.minEnergy);
    const maxEnergy = payload.maxEnergy == null ? null : Number(payload.maxEnergy);

    if (!curatorName) {
      return res.status(400).json({ error: "CURATOR_NAME_REQUIRED" });
    }

    if (!playlistName) {
      return res.status(400).json({ error: "PLAYLIST_NAME_REQUIRED" });
    }

    if (!["EMAIL", "INAPP"].includes(contactMethod)) {
      return res.status(400).json({ error: "INVALID_CONTACT_METHOD" });
    }

    if (contactMethod === "EMAIL" && !curatorEmailRaw) {
      return res
        .status(400)
        .json({ error: "CURATOR_EMAIL_REQUIRED_FOR_EMAIL_CONTACT" });
    }

    let curator:
      | {
          id: string;
          name: string;
          email: string | null;
          contactMethod: "EMAIL" | "INAPP";
          consent: boolean;
          languages: string[];
        }
      | null = null;

    if (curatorEmailRaw) {
      curator = await prisma.curator.findUnique({
        where: { email: curatorEmailRaw },
      });
    }

    if (!curator) {
      curator = await prisma.curator.create({
        data: {
          name: curatorName,
          email: curatorEmailRaw || null,
          contactMethod: contactMethod as "EMAIL" | "INAPP",
          consent,
          languages,
        },
      });
    } else {
      curator = await prisma.curator.update({
        where: { id: curator.id },
        data: {
          name: curatorName || curator.name,
          contactMethod: contactMethod as "EMAIL" | "INAPP",
          consent,
          languages,
        },
      });
    }

    let existingPlaylist = null;

    if (spotifyPlaylistId) {
      existingPlaylist = await prisma.playlist.findFirst({
        where: { spotifyPlaylistId },
        include: { curator: true },
      });
    }

    if (!existingPlaylist) {
      existingPlaylist = await prisma.playlist.findFirst({
        where: {
          curatorId: curator.id,
          name: playlistName,
        },
        include: { curator: true },
      });
    }

    if (existingPlaylist) {
      const updated = await prisma.playlist.update({
        where: { id: existingPlaylist.id },
        data: {
          name: playlistName,
          spotifyPlaylistId:
            spotifyPlaylistId ?? existingPlaylist.spotifyPlaylistId,
          genres,
          minBpm,
          maxBpm,
          minEnergy,
          maxEnergy,
          rules: rules ?? Prisma.JsonNull,
        },
        include: {
          curator: true,
          _count: {
            select: {
              matches: true,
              tasteEvents: true,
            },
          },
        },
      });

      return res.json({
        ok: true,
        created: false,
        updated: true,
        playlist: updated,
      });
    }

    const created = await prisma.playlist.create({
      data: {
        curatorId: curator.id,
        name: playlistName,
        spotifyPlaylistId,
        genres,
        minBpm,
        maxBpm,
        minEnergy,
        maxEnergy,
       rules: rules ?? Prisma.JsonNull,
      },
      include: {
        curator: true,
        _count: {
          select: {
            matches: true,
            tasteEvents: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      created: true,
      updated: false,
      playlist: created,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_DISCOVER_ERROR", details);
    return res.status(500).json({
      error: "PLAYLIST_DISCOVER_FAILED",
      details,
    });
  }
});

playlists.post("/playlists/import-from-spotify", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    const playlistUrlOrId = String(
      req.body?.playlistUrl ||
        req.body?.spotifyUrl ||
        req.body?.playlistId ||
        req.body?.url ||
        ""
    ).trim();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!playlistUrlOrId) {
      return res.status(400).json({ error: "MISSING_PLAYLIST_URL_OR_ID" });
    }

    const result = await importSpotifyPlaylistForArtist({
      artistId,
      playlistUrlOrId,
    });

    return res.json(result);
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_IMPORT_FROM_SPOTIFY_ERROR", details);

    return res.status(500).json({
      error: "PLAYLIST_IMPORT_FROM_SPOTIFY_FAILED",
      details,
    });
  }
});

playlists.get("/playlists/search-spotify", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limitRaw = Number(req.query.limit || 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(20, limitRaw))
      : 10;

    if (!q) {
      return res.status(400).json({ error: "MISSING_QUERY" });
    }

    const accessToken = await getSpotifyAppAccessToken();

    const searchUrl =
      `https://api.spotify.com/v1/search?` +
      new URLSearchParams({
        q,
        type: "playlist",
        limit: String(limit),
      }).toString();

    const spotifyRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const spotifyJson: SpotifyPlaylistSearchResponse = await spotifyRes
      .json()
      .catch(() => ({}));

    if (!spotifyRes.ok) {
      const message =
        spotifyJson?.error?.message ||
        spotifyJson?.message ||
        `Spotify search failed (${spotifyRes.status})`;

      return res.status(500).json({
        error: "SPOTIFY_PLAYLIST_SEARCH_FAILED",
        details: message,
      });
    }

    const items = Array.isArray(spotifyJson?.playlists?.items)
      ? spotifyJson.playlists.items
      : [];

    const results = items.map((item) => ({
      id: item?.id || null,
      name: item?.name || "",
      description: item?.description || "",
      spotifyUrl: item?.external_urls?.spotify || "",
      imageUrl:
        Array.isArray(item?.images) && item.images[0]?.url
          ? item.images[0].url
          : null,
      ownerId: item?.owner?.id || null,
      ownerDisplayName: item?.owner?.display_name || item?.owner?.id || null,
      ownerSpotifyUrl: item?.owner?.external_urls?.spotify || null,
      trackCount: item?.tracks?.total ?? 0,
      isPublic: item?.public ?? null,
    }));

    return res.json({
      ok: true,
      query: q,
      count: results.length,
      results,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("SPOTIFY_PLAYLIST_SEARCH_ERROR", details);
    return res.status(500).json({
      error: "SPOTIFY_PLAYLIST_SEARCH_FAILED",
      details,
    });
  }
});

playlists.post("/playlists/:id/auto-pitch-all", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const playlistId = String(req.params.id || "").trim();
    if (!playlistId) {
      return res.status(400).json({ error: "MISSING_PLAYLIST_ID" });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: {
        curator: true,
        matches: {
          include: {
            pitch: true,
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
          orderBy: { fitScore: "desc" },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: "PLAYLIST_NOT_FOUND" });
    }

    const ownedMatches = playlist.matches.filter(
      (match) => match.track?.artistId === artistId
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;
    let queued = 0;

    const results: Array<{
      matchId: string;
      trackId: string;
      trackTitle: string | null;
      status: string;
      pitchId?: string;
      channel?: string;
      queued?: boolean;
      error?: string;
    }> = [];

    for (const match of ownedMatches) {
      try {
        if (match.pitch) {
          let queuedThisPitch = false;

          if (match.pitch.status === "DRAFT" && match.pitch.channel === "EMAIL") {
            await prisma.pitch.update({
              where: { id: match.pitch.id },
              data: {
                status: "QUEUED",
              },
            });
            queued += 1;
            queuedThisPitch = true;
          }

          skipped += 1;
          results.push({
            matchId: match.id,
            trackId: match.trackId,
            trackTitle: match.track?.title || null,
            status: "SKIPPED_EXISTING_PITCH",
            pitchId: match.pitch.id,
            channel: match.pitch.channel,
            queued: queuedThisPitch,
          });
          continue;
        }

        const curator = match.playlist?.curator || null;
        const channel = canEmailCurator(curator) ? "EMAIL" : "INAPP";

        const generated = buildPitchContent({
          trackTitle: match.track?.title || "Untitled Track",
          playlistName: match.playlist?.name || "Playlist",
          spotifyTrackId: match.track?.spotifyTrackId || null,
          explanation: match.explanation,
        });

        const pitch = await prisma.pitch.create({
          data: {
            matchId: match.id,
            subject: generated.subject,
            body: generated.body,
            channel,
            status: channel === "EMAIL" ? "QUEUED" : "DRAFT",
          },
        });

        created += 1;

        if (channel === "EMAIL") {
          queued += 1;
        }

        results.push({
          matchId: match.id,
          trackId: match.trackId,
          trackTitle: match.track?.title || null,
          status: "CREATED",
          pitchId: pitch.id,
          channel,
          queued: channel === "EMAIL",
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failed += 1;
        results.push({
          matchId: match.id,
          trackId: match.trackId,
          trackTitle: match.track?.title || null,
          status: "FAILED",
          error: message,
        });
      }
    }

    return res.json({
      ok: true,
      playlistId: playlist.id,
      playlistName: playlist.name,
      totalMatches: playlist.matches.length,
      ownedMatches: ownedMatches.length,
      created,
      skipped,
      failed,
      queued,
      results,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_AUTO_PITCH_ALL_ERROR", details);
    return res.status(500).json({
      error: "PLAYLIST_AUTO_PITCH_ALL_FAILED",
      details,
    });
  }
});

playlists.get("/playlists", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const genre = String(req.query.genre || "").trim();
    const curatorId = String(req.query.curatorId || "").trim();

    const where: {
      OR?: Array<Record<string, unknown>>;
      genres?: { has: string };
      curatorId?: string;
    } = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { spotifyPlaylistId: { contains: q, mode: "insensitive" } },
        {
          curator: {
            name: { contains: q, mode: "insensitive" },
          },
        },
        {
          curator: {
            email: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }

    if (genre) {
      where.genres = { has: genre };
    }

    if (curatorId) {
      where.curatorId = curatorId;
    }

    const list = await prisma.playlist.findMany({
      where,
      include: {
        curator: true,
        _count: {
          select: {
            matches: true,
            tasteEvents: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const results = list.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      spotifyPlaylistId: playlist.spotifyPlaylistId,
      genres: playlist.genres,
      minBpm: playlist.minBpm,
      maxBpm: playlist.maxBpm,
      minEnergy: playlist.minEnergy,
      maxEnergy: playlist.maxEnergy,
      rules: playlist.rules,
      createdAt: playlist.createdAt,
      matchCount: playlist._count.matches,
      tasteEventCount: playlist._count.tasteEvents,
      curator: playlist.curator
        ? {
            id: playlist.curator.id,
            name: playlist.curator.name,
            email: playlist.curator.email,
            contactMethod: playlist.curator.contactMethod,
            consent: playlist.curator.consent,
            languages: playlist.curator.languages,
            canEmail: canEmailCurator(playlist.curator),
          }
        : null,
    }));

    return res.json({
      ok: true,
      count: results.length,
      playlists: results,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_LIST_ERROR", details);
    return res.status(500).json({
      error: "PLAYLIST_LIST_FAILED",
      details,
    });
  }
});

playlists.get("/playlists/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "PLAYLIST_ID_REQUIRED" });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        curator: true,
        tasteEvents: {
          orderBy: { createdAt: "desc" },
        },
        matches: {
          include: {
            track: true,
            pitch: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
          orderBy: { fitScore: "desc" },
        },
        _count: {
          select: {
            matches: true,
            tasteEvents: true,
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: "PLAYLIST_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        spotifyPlaylistId: playlist.spotifyPlaylistId,
        genres: playlist.genres,
        minBpm: playlist.minBpm,
        maxBpm: playlist.maxBpm,
        minEnergy: playlist.minEnergy,
        maxEnergy: playlist.maxEnergy,
        rules: playlist.rules,
        createdAt: playlist.createdAt,
        matchCount: playlist._count.matches,
        tasteEventCount: playlist._count.tasteEvents,
        curator: playlist.curator
          ? {
              id: playlist.curator.id,
              name: playlist.curator.name,
              email: playlist.curator.email,
              contactMethod: playlist.curator.contactMethod,
              consent: playlist.curator.consent,
              languages: playlist.curator.languages,
              canEmail: canEmailCurator(playlist.curator),
            }
          : null,
        tasteEvents: playlist.tasteEvents.map((event) => ({
          id: event.id,
          spotifyTrackId: event.spotifyTrackId,
          label: event.label,
          createdAt: event.createdAt,
        })),
        matches: playlist.matches.map((match) => ({
          id: match.id,
          fitScore: match.fitScore,
          explanation: match.explanation,
          createdAt: match.createdAt,
          trackId: match.trackId,
          playlistId: match.playlistId,
          track: match.track
            ? {
                id: match.track.id,
                title: match.track.title,
                spotifyTrackId: match.track.spotifyTrackId,
                artists: match.track.artists,
              }
            : null,
          pitch: match.pitch
            ? {
                id: match.pitch.id,
                status: match.pitch.status,
                channel: match.pitch.channel,
                sentAt: match.pitch.sentAt,
                sentTo: match.pitch.sentTo,
              }
            : null,
        })),
      },
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("PLAYLIST_GET_ERROR", details);
    return res.status(500).json({
      error: "PLAYLIST_GET_FAILED",
      details,
    });
  }
});

export default playlists;