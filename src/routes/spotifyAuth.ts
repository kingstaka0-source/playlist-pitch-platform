import { Router, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";
import { prisma } from "../db";
import { env } from "../env";
import {
  discoverSpotifyArtist,
  saveDiscoveredArtist,
} from "../services/spotify/discovery";
import { loadSpotifyReleases } from "../services/spotify/releases";
import { importSpotifyCatalog } from "../services/spotify/importCatalog";
import { getValidSpotifyAccessToken } from "../services/spotify/refreshToken";
import { getSpotifyAppAccessToken } from "../spotifyAppClient";

export const spotifyAuth = Router();

function getArtistId(res: Response): string {
  return String(res.locals?.artist?.id || "").trim();
}

function createSpotifyState(artistId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      artistId,
      createdAt: Date.now(),
    })
  ).toString("base64url");

  const signature = createHmac("sha256", CLIENT_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function readSpotifyState(state: string): {
  artistId: string;
  createdAt: number;
} {
  const [payload, suppliedSignature] = state.split(".");

  if (!payload || !suppliedSignature) {
    throw new Error("INVALID_SPOTIFY_STATE");
  }

  const expectedSignature = createHmac("sha256", CLIENT_SECRET)
    .update(payload)
    .digest("base64url");

  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new Error("INVALID_SPOTIFY_STATE");
  }

  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );

  const artistId = String(decoded?.artistId || "").trim();
  const createdAt = Number(decoded?.createdAt || 0);

  if (!artistId || !Number.isFinite(createdAt)) {
    throw new Error("INVALID_SPOTIFY_STATE");
  }

  const tenMinutes = 10 * 60 * 1000;

  if (Date.now() - createdAt > tenMinutes) {
    throw new Error("EXPIRED_SPOTIFY_STATE");
  }

  return {
    artistId,
    createdAt,
  };
}

function must(name: string, v?: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const CLIENT_ID = must("SPOTIFY_CLIENT_ID", env.SPOTIFY_CLIENT_ID);
const CLIENT_SECRET = must("SPOTIFY_CLIENT_SECRET", env.SPOTIFY_CLIENT_SECRET);

// Moet EXACT matchen met Spotify Dashboard Redirect URI
const REDIRECT_URI =
  env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:3100/auth/spotify/callback";

const FRONTEND_URL = env.FRONTEND_URL || "http://localhost:3000";

/**
 * Start OAuth
 * GET /auth/spotify?artistId=...
 */
spotifyAuth.get("/auth/spotify", async (req, res) => {
  try {
    const artistId = getArtistId(res);

if (!artistId) {
  return res.status(401).json({
    error: "UNAUTHORIZED",
  });
}

    // check artist bestaat (optioneel maar handig)
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) return res.status(404).send("Artist not found");

    // state = base64url JSON (zodat callback weet welke artist het is)
    const state = createSpotifyState(artistId);

    const scope = ["user-read-email", "user-read-private"].join(" ");

    const authUrl =
      "https://accounts.spotify.com/authorize?" +
      new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        scope,
        redirect_uri: REDIRECT_URI,
        state,
        show_dialog: "true",
      }).toString();

    return res.redirect(authUrl);
  } catch (err: any) {
    console.error("SPOTIFY AUTH START ERROR", err?.response?.data ?? err?.message ?? err);
    return res.status(500).send("Spotify auth start failed");
  }
});

/**
 * Start Spotify OAuth from the authenticated frontend.
 * POST /auth/spotify/start
 */
spotifyAuth.post("/auth/spotify/start", async (_req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "You must be signed in.",
      });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
      },
    });

    if (!artist) {
      return res.status(404).json({
        error: "ARTIST_NOT_FOUND",
        message: "Your TuneReach artist profile could not be found.",
      });
    }

    const state = createSpotifyState(artist.id);
    const scope = ["user-read-email", "user-read-private"].join(" ");

    const url =
      "https://accounts.spotify.com/authorize?" +
      new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        scope,
        redirect_uri: REDIRECT_URI,
        state,
        show_dialog: "true",
      }).toString();

    return res.json({
      ok: true,
      url,
    });
  } catch (error: any) {
    console.error(
      "SPOTIFY START ERROR",
      error?.response?.data ?? error?.message ?? error,
    );

    return res.status(500).json({
      error: "SPOTIFY_START_FAILED",
      message: "Unable to start Spotify authorization.",
    });
  }
});

/**
 * Connection status
 * GET /auth/spotify/status?artistId=...
 */
spotifyAuth.get("/auth/spotify/status", async (req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
  return res.status(401).json({
    error: "UNAUTHORIZED",
  });
}

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        name: true,
        email: true,
        spotifyId: true,
        spotifyAccessToken: true,
        spotifyTokenExpiresAt: true,
        spotifyArtistId: true,
        spotifyArtistName: true,
        spotifyArtistUrl: true,
        spotifyArtistImageUrl: true,
        spotifyArtistFollowers: true,
      },
    });

    if (!artist) {
      return res.status(404).json({
        error: "ARTIST_NOT_FOUND",
      });
    }

    if (!artist.spotifyId || !artist.spotifyAccessToken) {
      return res.json({
        connected: false,
        artist: {
          id: artist.id,
          name: artist.name,
        },
      });
    }

    let profile: {
      displayName?: string;
      imageUrl?: string;
      followers?: number;
      spotifyUrl?: string;
    } = {};

    try {
      const meRes = await axios.get("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${artist.spotifyAccessToken}`,
        },
        timeout: 10_000,
      });

      profile = {
        displayName: meRes.data.display_name || undefined,
        imageUrl: meRes.data.images?.[0]?.url || undefined,
        followers: meRes.data.followers?.total ?? 0,
        spotifyUrl: meRes.data.external_urls?.spotify || undefined,
      };
    } catch (spotifyError: any) {
      console.warn(
        "SPOTIFY STATUS PROFILE FETCH FAILED",
        spotifyError?.response?.data ?? spotifyError?.message
      );
    }

    return res.json({
      connected: true,
      artist: {
        id: artist.id,
        name: profile.displayName || artist.name,
        email: artist.email,
        spotifyId: artist.spotifyId,
        imageUrl: profile.imageUrl,
        followers: profile.followers ?? 0,
        spotifyUrl: profile.spotifyUrl,
      },
      selectedArtist: artist.spotifyArtistId
        ? {
            id: artist.spotifyArtistId,
            name: artist.spotifyArtistName,
            imageUrl: artist.spotifyArtistImageUrl,
            followers: artist.spotifyArtistFollowers ?? 0,
            spotifyUrl: artist.spotifyArtistUrl,
          }
        : null,
    });
  } catch (err: any) {
    console.error("SPOTIFY STATUS ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "SPOTIFY_STATUS_FAILED",
      message: err?.message ?? String(err),
    });
  }
});

/**
 * Search Spotify artist profiles.
 *
 * GET /auth/spotify/artist-options?q=...
 */
spotifyAuth.get("/auth/spotify/artist-options", async (req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
      });
    }

    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        error: "MISSING_ARTIST_QUERY",
      });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        spotifyAccessToken: true,
      },
    });

    if (!artist?.spotifyAccessToken) {
      return res.status(401).json({
        success: false,
        error: "SPOTIFY_NOT_CONNECTED",
      });
    }

    const accessToken = await getValidSpotifyAccessToken(artistId);

    const response = await axios.get(
      "https://api.spotify.com/v1/search",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          q,
          type: "artist",
          limit: 10,
          market: "NL",
        },
        timeout: 10_000,
      }
    );

    const artists = (response.data.artists?.items ?? []).map(
      (candidate: any) => ({
        id: candidate.id,
        name: candidate.name,
        imageUrl: candidate.images?.[0]?.url ?? null,
        followers: candidate.followers?.total ?? 0,
        spotifyUrl:
          candidate.external_urls?.spotify ?? null,
        genres: candidate.genres ?? [],
        popularity: candidate.popularity ?? 0,
      })
    );

    return res.json({
      success: true,
      artists,
    });
  } catch (error: any) {
    console.error(
      "SPOTIFY ARTIST OPTIONS ERROR",
      error?.response?.data ??
        error?.message ??
        error
    );

    return res.status(
      error?.response?.status || 500
    ).json({
      success: false,
      error: "SPOTIFY_ARTIST_OPTIONS_FAILED",
    });
  }
});

/**
 * Save the Spotify artist profile selected by the current TuneReach artist.
 *
 * POST /auth/spotify/select-artist
 */
spotifyAuth.post("/auth/spotify/select-artist", async (req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
      });
    }

    const spotifyArtistId = String(
      req.body?.spotifyArtistId || ""
    ).trim();

    if (!spotifyArtistId) {
      return res.status(400).json({
        success: false,
        error: "MISSING_SPOTIFY_ARTIST_ID",
      });
    }

    const accessToken =
      await getValidSpotifyAccessToken(artistId);

    /*
     * Do not trust artist metadata sent by the browser.
     * Retrieve the selected profile directly from Spotify.
     */
    const response = await axios.get(
      `https://api.spotify.com/v1/artists/${encodeURIComponent(
        spotifyArtistId
      )}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 10_000,
      }
    );

    const selectedArtist =
      await saveDiscoveredArtist(
        artistId,
        response.data
      );

    return res.json({
      success: true,
      artist: selectedArtist,
      nextStep: "LOAD_RELEASES",
    });
  } catch (error: any) {
    console.error(
      "SPOTIFY ARTIST SELECTION ERROR",
      error?.response?.data ??
        error?.message ??
        error
    );

    return res.status(
      error?.response?.status || 500
    ).json({
      success: false,
      error: "SPOTIFY_ARTIST_SELECTION_FAILED",
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not select Spotify artist.",
    });
  }
});

/**
 * Automatically discover the public Spotify artist profile.
 *
 * GET /auth/spotify/discovery?artistId=...
 */
spotifyAuth.get("/auth/spotify/discovery", async (req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
  return res.status(401).json({
    success: false,
    error: "UNAUTHORIZED",
  });
}

    const spotifyArtist =
      await discoverSpotifyArtist(artistId);

    return res.json({
      success: true,
      artist: spotifyArtist,
      nextStep: "LOAD_RELEASES",
    });
  } catch (error: any) {
    console.error(
      "SPOTIFY ARTIST DISCOVERY ERROR",
      error?.response?.data ??
        error?.message ??
        error
    );

    const errorCode =
      error?.message || "SPOTIFY_ARTIST_DISCOVERY_FAILED";

    if (errorCode === "ARTIST_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: errorCode,
      });
    }

    if (errorCode === "SPOTIFY_NOT_CONNECTED") {
      return res.status(401).json({
        success: false,
        error: errorCode,
        message: "Connect Spotify before discovering an artist.",
      });
    }

    if (
      errorCode === "SPOTIFY_REAUTHORIZATION_REQUIRED"
    ) {
      return res.status(401).json({
        success: false,
        error: errorCode,
        reconnectSpotify: true,
      });
    }

    if (errorCode === "SPOTIFY_ARTIST_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: errorCode,
        message:
          "No exact Spotify artist profile was found.",
        candidates: error?.candidates ?? [],
      });
    }

    return res.status(500).json({
      success: false,
      error: "SPOTIFY_ARTIST_DISCOVERY_FAILED",
      message: errorCode,
    });
  }
});

/**
 * Callback
 * GET /auth/spotify/callback?code=...&state=...
 */
spotifyAuth.get("/auth/spotify/callback", async (req, res) => {
  try {
    const spotifyError = String(req.query.error || "");
    const state = String(req.query.state || "");

    if (spotifyError) {
  let artistId = "";

  try {
    if (state) {
      artistId = readSpotifyState(state).artistId;
    }
  } catch {
    // Ongeldige of verlopen state: redirect zonder artistId
  }

  const params = new URLSearchParams({
    spotify: "cancelled",
  });

  if (artistId) {
    params.set("artistId", artistId);
  }

  return res.redirect(
    `${FRONTEND_URL}/onboarding/spotify?${params.toString()}`
  );
}

    const code = String(req.query.code || "");

    if (!code) return res.status(400).send("Missing code");
    if (!state) return res.status(400).send("Missing state");

    let artistId: string;

try {
  artistId = readSpotifyState(state).artistId;
} catch (error: any) {
  const code = error?.message || "INVALID_SPOTIFY_STATE";

  return res.status(400).json({
    error: code,
    message: "Spotify authorization state is invalid or expired.",
  });
}

    // 1) Exchange code -> tokens
    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
        },
        timeout: 10_000,
      }
    );

    const accessToken = tokenRes.data.access_token as string;
    const refreshToken = (tokenRes.data.refresh_token as string | undefined) ?? null;
    const expiresIn = tokenRes.data.expires_in as number; // seconds
    const scopeString = (tokenRes.data.scope as string) || "";

    // 2) /me voor spotifyId + email
    const meRes = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000,
    });

    const spotifyId = meRes.data.id as string;

    // 3) Opslaan
    await prisma.artist.update({
      where: { id: artistId },
      data: {
        spotifyId,
        spotifyAccessToken: accessToken,
        spotifyRefreshToken: refreshToken,
        spotifyTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        spotifyScopes: scopeString,
      } as any,
    });

    // 4) terug naar frontend
    return res.redirect(
  `${FRONTEND_URL}/onboarding/spotify?spotify=connected&artistId=${encodeURIComponent(
    artistId
  )}`
);
  } catch (err: any) {
    console.error("SPOTIFY CALLBACK ERROR", err?.response?.data ?? err?.message ?? err);
    return res.status(500).send("Spotify callback failed");
  }
});

spotifyAuth.get(
  "/auth/spotify/releases",
  async (req, res) => {
    try {
      const artistId = getArtistId(res);

if (!artistId) {
  return res.status(401).json({
    success: false,
    error: "UNAUTHORIZED",
  });
}

      const releases =
        await loadSpotifyReleases(artistId);

      return res.json({
        success: true,
        total: releases.length,
        releases,
        nextStep: "IMPORT_TRACKS",
      });
    } catch (error: any) {
  const spotifyStatus = error?.response?.status;
  const retryAfter =
    error?.response?.headers?.["retry-after"];

  console.error(
    "SPOTIFY RELEASE LOAD ERROR",
    {
      status: spotifyStatus,
      data: error?.response?.data,
      retryAfter,
      message: error?.message,
    }
  );

  

  if (spotifyStatus === 429) {
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
    }

    return res.status(429).json({
      success: false,
      error: "SPOTIFY_RATE_LIMITED",
      message:
        "Spotify rate limit is active. Do not retry until the waiting period has passed.",
      retryAfterSeconds: retryAfter
        ? Number(retryAfter)
        : null,
    });
  }

  return res.status(
    spotifyStatus && spotifyStatus >= 400
      ? spotifyStatus
      : 500
  ).json({
    success: false,
    error:
      error?.message ||
      "SPOTIFY_RELEASE_LOAD_FAILED",
  });
}
  }
);

spotifyAuth.post(
  "/auth/spotify/import-all-tracks",
  async (req, res) => {
    try {
      const artistId = getArtistId(res);

      if (!artistId) {
  return res.status(401).json({
    success: false,
    error: "UNAUTHORIZED",
  });
}

      const result = await importSpotifyCatalog(artistId);

      return res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error(
        "SPOTIFY CATALOG IMPORT ERROR",
        error?.response?.data ??
          error?.message ??
          error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.response?.data?.error?.message ||
          error?.message ||
          "SPOTIFY_CATALOG_IMPORT_FAILED",
      });
    }
  }
);

spotifyAuth.get(
  "/auth/spotify/test-audio-features",
  async (req, res) => {
    try {
      const spotifyTrackId = String(
        req.query.spotifyTrackId || ""
      ).trim();

      if (!spotifyTrackId) {
        return res.status(400).json({
          success: false,
          error: "MISSING_SPOTIFY_TRACK_ID",
        });
      }

      const appToken = await getSpotifyAppAccessToken();

      const response = await axios.get(
        `https://api.spotify.com/v1/audio-features/${spotifyTrackId}`,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
          },
        }
      );

      return res.json({
        success: true,
        audioFeatures: response.data,
      });
    } catch (error: any) {
      console.error(
        "SPOTIFY AUDIO FEATURES TEST ERROR",
        {
          status: error?.response?.status,
          data: error?.response?.data,
          message: error?.message,
        }
      );

      return res.status(
        error?.response?.status || 500
      ).json({
        success: false,
        status: error?.response?.status || 500,
        error:
          error?.response?.data ||
          error?.message ||
          "AUDIO_FEATURES_TEST_FAILED",
      });
    }
  }
);
