import { Router } from "express";
import axios from "axios";
import { prisma } from "../db";
import { env } from "../env";

export const spotifyAuth = Router();

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
    const artistId = String(req.query.artistId || "");
    if (!artistId) return res.status(400).send("Missing artistId");

    // check artist bestaat (optioneel maar handig)
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) return res.status(404).send("Artist not found");

    // state = base64url JSON (zodat callback weet welke artist het is)
    const state = Buffer.from(JSON.stringify({ artistId })).toString("base64url");

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
 * Connection status
 * GET /auth/spotify/status?artistId=...
 */
spotifyAuth.get("/auth/spotify/status", async (req, res) => {
  try {
    const artistId = String(req.query.artistId || "").trim();

    if (!artistId) {
      return res.status(400).json({
        error: "MISSING_ARTIST_ID",
        message: "artistId is required",
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
 * Callback
 * GET /auth/spotify/callback?code=...&state=...
 */
spotifyAuth.get("/auth/spotify/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");

    if (!code) return res.status(400).send("Missing code");
    if (!state) return res.status(400).send("Missing state");

    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    const artistId = decoded.artistId as string;
    if (!artistId) return res.status(400).send("Invalid state");

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
    const email = (meRes.data.email as string | undefined) || undefined;

    // 3) Opslaan
    await prisma.artist.update({
      where: { id: artistId },
      data: {
        spotifyId,
        email,
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
