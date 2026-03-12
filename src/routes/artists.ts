import { Router } from "express";
import { prisma } from "../db";

console.log("ARTISTS ROUTE FILE LOADED ✅", __filename);

export const artists = Router();

export type ArtistUsageResult = {
  artist: any;
  plan: "FREE" | "TRIAL" | "PRO";
  trial: null | { until: Date | null };
  month: {
    sentThisMonth: number;
    createdThisMonth: number;
    limit: number | null;
    remaining: number | null;
  };
  allowed: boolean;
};

function startOfCurrentMonthUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}

/**
 * Auto-downgrade als TRIAL verlopen is.
 */
export async function normalizeArtistPlan(artistId: string) {
  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist) return null;

  if (
    artist.plan === "TRIAL" &&
    artist.trialUntil &&
    artist.trialUntil.getTime() < Date.now()
  ) {
    return await prisma.artist.update({
      where: { id: artistId },
      data: { plan: "FREE", trialUntil: null },
    });
  }

  return artist;
}

/**
 * Centrale usage / paywall check
 * FREE = max 3 created pitches per month
 * TRIAL / PRO = unlimited
 */
export async function getArtistUsage(
  artistId: string
): Promise<ArtistUsageResult | null> {
  const artist = await normalizeArtistPlan(artistId);
  if (!artist) return null;

  const plan = (artist.plan ?? "FREE") as "FREE" | "TRIAL" | "PRO";
  const start = startOfCurrentMonthUtc();

  const [sentThisMonth, createdThisMonth] = await Promise.all([
    prisma.pitch.count({
      where: {
        status: "SENT",
        sentAt: { gte: start },
        match: {
          track: { artistId },
        },
      },
    }),
    prisma.pitch.count({
      where: {
        createdAt: { gte: start },
        match: {
          track: { artistId },
        },
      },
    }),
  ]);

  const limit = plan === "FREE" ? 3 : null;
  const remaining = limit === null ? null : Math.max(0, limit - createdThisMonth);
  const allowed = limit === null ? true : (remaining ?? 0) > 0;

  return {
    artist,
    plan,
    trial: plan === "TRIAL" ? { until: artist.trialUntil } : null,
    month: {
      sentThisMonth,
      createdThisMonth,
      limit,
      remaining,
    },
    allowed,
  };
}

/**
 * Create artist
 */
artists.post("/artists", async (req, res) => {
  try {
    const { name, email } = req.body ?? {};
    if (!name || !email) {
      return res.status(400).json({ error: "name and email required" });
    }

    const artist = await prisma.artist.create({
      data: { name, email },
    });

    return res.json(artist);
  } catch (err: any) {
    console.error("CREATE ARTIST ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "create artist failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * Connect artist to Spotify (store access token)
 */
artists.post("/artists/:id/spotify", async (req, res) => {
  try {
    const artistId = req.params.id;
    const { accessToken, spotifyId } = req.body ?? {};

    if (!accessToken) {
      return res.status(400).json({ error: "accessToken required" });
    }

    await prisma.artist.update({
      where: { id: artistId },
      data: {
        spotifyAccessToken: accessToken,
        ...(spotifyId ? { spotifyId } : {}),
      },
    });

    return res.json({ id: artistId });
  } catch (err: any) {
    console.error("CONNECT SPOTIFY ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "connect spotify failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * Usage endpoint
 */
artists.get("/artists/:id/usage", async (req, res) => {
  try {
    const artistId = req.params.id;
    const usage = await getArtistUsage(artistId);

    if (!usage) {
      return res.status(404).json({ error: "Artist not found" });
    }

    return res.json({
      artistId,
      plan: usage.plan,
      trial: usage.trial,
      month: usage.month,
    });
  } catch (err: any) {
    console.error("USAGE ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "usage failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * Start trial
 */
artists.post("/artists/:id/start-trial", async (req, res) => {
  try {
    const artistId = req.params.id;
    const artist = await normalizeArtistPlan(artistId);

    if (!artist) {
      return res.status(404).json({ error: "Artist not found" });
    }

    if (artist.plan === "PRO") {
      return res.json({
        ok: true,
        message: "Already PRO",
        artistId,
        plan: artist.plan,
        trial: null,
      });
    }

    if (
      artist.plan === "TRIAL" &&
      artist.trialUntil &&
      artist.trialUntil.getTime() > Date.now()
    ) {
      return res.json({
        ok: true,
        message: "Trial already active",
        artistId,
        plan: "TRIAL",
        trial: { until: artist.trialUntil },
      });
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const updated = await prisma.artist.update({
      where: { id: artistId },
      data: { plan: "TRIAL", trialUntil: endsAt },
    });

    return res.json({
      ok: true,
      message: "Trial started (7 days)",
      artistId,
      plan: updated.plan,
      trial: { until: updated.trialUntil },
    });
  } catch (err: any) {
    console.error("START TRIAL ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "start-trial failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * Cancel trial
 */
artists.post("/artists/:id/cancel-trial", async (req, res) => {
  try {
    const artistId = req.params.id;
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });

    if (!artist) {
      return res.status(404).json({ error: "Artist not found" });
    }

    if (artist.plan === "PRO") {
      return res.json({
        ok: true,
        message: "PRO (billing cancel later)",
        artistId,
        plan: "PRO",
        trial: null,
      });
    }

    const updated = await prisma.artist.update({
      where: { id: artistId },
      data: { plan: "FREE", trialUntil: null },
    });

    return res.json({
      ok: true,
      message: "Trial canceled -> FREE",
      artistId,
      plan: updated.plan,
      trial: null,
    });
  } catch (err: any) {
    console.error("CANCEL TRIAL ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "cancel-trial failed",
      details: err?.message ?? String(err),
    });
  }
});