import { Router } from "express";
import { prisma } from "../db";
import { extractSpotifyTrackId } from "../spotifyTrackId";
import { getTrackMeta, getTrackAudioFeatures } from "../spotify";
import { getSpotifyAppAccessToken } from "../spotifyAppClient";
import { enqueueMatchJob } from "../matchQueue";



export const intake = Router();

/**
 * Opt-in curator intake:
 * maakt Curator + Playlist in één request (geen scraping).
 * POST /intake/curator
 */
intake.post("/intake/curator", async (req, res) => {
  try {
    const {
      curatorName,
      email,
      contactMethod = "INAPP",
      languages = ["nl"],
      consent = true,

      playlistName,
      spotifyPlaylistId, // optioneel
      genres = [],
      minBpm,
      maxBpm,
      minEnergy,
      maxEnergy,
      rules,
    } = req.body ?? {};

    if (!curatorName) return res.status(400).json({ error: "curatorName required" });
    if (!playlistName) return res.status(400).json({ error: "playlistName required" });
    if (contactMethod === "EMAIL" && !email) {
      return res.status(400).json({ error: "email required for EMAIL contactMethod" });
    }
    if (!consent) return res.status(400).json({ error: "consent must be true" });

    const curator = await prisma.curator.create({
      data: {
        name: curatorName,
        email: email || null,
        contactMethod,
        consent,
        languages,
      },
    });

    const playlist = await prisma.playlist.create({
      data: {
        curatorId: curator.id,
        name: playlistName,
        spotifyPlaylistId: spotifyPlaylistId || null,
        genres,
        minBpm: minBpm ?? null,
        maxBpm: maxBpm ?? null,
        minEnergy: minEnergy ?? null,
        maxEnergy: maxEnergy ?? null,
        rules: rules ?? null,
      },
    });

    return res.json({ curator, playlist });
  } catch (err: any) {
    console.error("INTAKE CURATOR ERROR", err?.response?.data ?? err?.message ?? err);
    return res.status(500).json({
      error: "intake curator failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * Track intake via Spotify URL/ID:
 * POST /intake/track
 * body: { artistId, spotifyTrackUrl } OR { artistId, spotifyTrackId }
 */
intake.post("/intake/track", async (req, res) => {
  try {
    const artistId = String(req.body?.artistId || "");
    if (!artistId) return res.status(400).json({ error: "Missing artistId" });

    const artist = await prisma.artist.findUnique({
  where: { id: artistId },
  select: { plan: true, trialUntil: true },
});

if (!artist) {
  return res.status(404).json({ error: "Artist not found" });
}

const now = new Date();
const isTrialActive =
  artist.plan === "TRIAL" &&
  artist.trialUntil &&
  artist.trialUntil > now;

const isPro = artist.plan === "PRO";
const canAutoMatch = isPro || isTrialActive;


    const trackId = extractSpotifyTrackId(
      String(req.body?.spotifyTrackUrl || req.body?.spotifyTrackId || "")
    );
    if (!trackId) return res.status(400).json({ error: "Invalid Spotify track URL/ID" });

    // App token (client_credentials)
    const appToken = await getSpotifyAppAccessToken();

    // ---- debug: precies zien welke call faalt ----
    let meta: any = null;
    let features: any = null;

    try {
      meta = await getTrackMeta(appToken, trackId);
    } catch (e: any) {
      console.error("SPOTIFY META ERROR", e?.response?.status, e?.response?.data);
      return res.status(502).json({
        error: "spotify meta failed",
        spotifyStatus: e?.response?.status,
        spotifyData: e?.response?.data,
      });
    }

    try {
      features = await getTrackAudioFeatures(appToken, trackId);
    } catch (e: any) {
      console.warn("SPOTIFY FEATURES WARNING (continuing)", e?.response?.status, e?.response?.data);
      // fallback: ga door zonder features
      features = null;
    }
    // ---------------------------------------------

    const title = String(meta?.name || "");
    const artists = (meta?.artists || [])
      .map((a: any) => a?.name)
      .filter(Boolean);

    const durationMs = Number(meta?.duration_ms || 0);

    if (!title || !artists.length || !durationMs) {
      return res.status(502).json({
        error: "spotify meta incomplete",
        metaPreview: { title, artistsCount: artists.length, durationMs },
      });
    }

    const safeFeatures = features ?? {}; // Prisma Json mag geen null in sommige schemas

    const track = await prisma.track.upsert({
  where: { spotifyTrackId: trackId },
  update: { title, artists, durationMs, audioFeatures: safeFeatures },
  create: {
    artistId,
    spotifyTrackId: trackId,
    title,
    artists,
    durationMs,
    audioFeatures: safeFeatures,
    genres: [],
  },
});

// 🔥 hier direct onder je prisma.track.upsert(...)
let job: { jobId: string } | null = null;

if (canAutoMatch) {
  job = await enqueueMatchJob(track.id, artistId);
}

return res.json({
  ok: true,
  track,
  matchJob: job, // { jobId } of null
  autoMatch: canAutoMatch,
  gated: !canAutoMatch ? "UPGRADE_REQUIRED" : null,
});





  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;

    console.error("INTAKE TRACK ERROR", { status, data, msg: err?.message });

    return res.status(500).json({
      error: "intake track failed",
      details: err?.message ?? String(err),
      spotifyStatus: status,
      spotifyData: data,
    });
  }
});
