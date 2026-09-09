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
 * Auto-downgrade als TRIAL lokaal verlopen is.
 * Voor Stripe-trials zal webhook leidend zijn, maar deze fallback mag blijven.
 */
export async function normalizeArtistPlan(artistId: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
  });

  if (!artist) return null;

  const now = Date.now();

  // Een TRIAL is alleen geldig als er daadwerkelijk
  // een toekomstige trialUntil-datum bestaat.
  if (artist.plan === "TRIAL") {
    const trialIsActive =
      !!artist.trialUntil &&
      artist.trialUntil.getTime() > now;

    if (!trialIsActive) {
      return await prisma.artist.update({
        where: { id: artistId },
        data: {
          plan: "FREE",
          trialUntil: null,
        },
      });
    }
  }

  // PRO-toegang is alleen geldig voor een Stripe-subscription
  // die ACTIVE of voorlopig PAST_DUE is.
  if (artist.plan === "PRO") {
    const proIsActive = ["ACTIVE", "PAST_DUE"].includes(
      artist.subscriptionStatus
    );

    if (!proIsActive) {
      return await prisma.artist.update({
        where: { id: artistId },
        data: {
          plan: "FREE",
          trialUntil: null,
        },
      });
    }
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
 * Usage endpoint
 */
artists.get("/artists/me/usage", async (_req, res) => {
  try {
    const artistId = String(res.locals?.artist?.id || "").trim();

    if (!artistId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "You must be signed in.",
      });
    }

    const usage = await getArtistUsage(artistId);

    if (!usage) {
      return res.status(404).json({
        error: "Artist not found",
      });
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

    