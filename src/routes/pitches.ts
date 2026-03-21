import { Router } from "express";
import { Resend } from "resend";
import { prisma } from "../db";
import { buildPitchPrompt } from "../services/ai/buildPitchPrompt";
import { parseAiPitch } from "../services/ai/parseAiPitch";
import { generateTextFromAi } from "../services/ai/generateTextFromAi";
import { getArtistUsage } from "./artists";
import { generatePitch } from "../pitch/generatePitch";

const router = Router();

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

type ArtistIdSource = {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

type CuratorLike = {
  email?: string | null;
  contactMethod?: string | null;
  consent?: boolean | null;
};

type LaunchCampaignRequestBody = {
  trackId?: unknown;
  matchIds?: unknown;
  queueEmail?: unknown;
};

function getArtistId(req: ArtistIdSource) {
  const headerArtistId =
    typeof req.headers?.["x-artist-id"] === "string"
      ? req.headers["x-artist-id"]
      : "";

  const queryArtistId =
    typeof req.query?.artistId === "string" ? req.query.artistId : "";

  return String(headerArtistId || queryArtistId || "").trim();
}

function canEmailCurator(curator: CuratorLike | null | undefined) {
  return (
    !!curator?.email &&
    curator.contactMethod === "EMAIL" &&
    curator.consent === true
  );
}

function resolveRecipient(curatorEmail?: string | null) {
  const from = String(process.env.EMAIL_FROM || "").trim();
  const resendTestTo = String(process.env.RESEND_TEST_TO || "").trim();

  if (!curatorEmail) return null;

  if (from.toLowerCase() === "onboarding@resend.dev" && resendTestTo) {
    return resendTestTo;
  }

  return curatorEmail;
}

async function getUsageOr404(artistId: string) {
  return getArtistUsage(artistId);
}

function denyFreeLimit(res: any, usage: any) {
  return res.status(403).json({
    error: "FREE_LIMIT_REACHED",
    message: "FREE plan allows 3 created pitches per month. Upgrade to PRO for unlimited pitches.",
    upgradeRequired: true,
    paywall: {
      plan: usage?.plan ?? "FREE",
      feature: "PITCH_CREATE_LIMIT",
      month: usage?.month ?? null,
    },
  });
}

function denyPaidRequired(res: any, usage: any, message: string) {
  return res.status(403).json({
    error: "PAID_PLAN_REQUIRED",
    message,
    upgradeRequired: true,
    paywall: {
      plan: usage?.plan ?? "FREE",
      feature: "PRO_ONLY",
      month: usage?.month ?? null,
    },
  });
}

/**
 * 🔥 FIXED AI + FALLBACK
 */
async function buildAiPitchForMatch(match: any, channel: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: match.track.artistId },
    select: { name: true },
  });

  const artistName = artist?.name || "Unknown Artist";
  const trackTitle = match.track?.title || "Untitled Track";
  const trackArtists = match.track?.artists || [];
  const playlistName = match.playlist?.name || "Playlist";
  const curatorName = match.playlist?.curator?.name || null;
  const playlistGenres = match.playlist?.genres || [];

  try {
    const prompt = buildPitchPrompt({
      artistName,
      trackTitle,
      trackArtists,
      curatorName,
      playlistName,
      playlistGenres,
      channel: (channel === "INAPP" ? "INAPP" : "EMAIL") as "EMAIL" | "INAPP",
    });

    const aiRaw = await generateTextFromAi(prompt);
    const parsed = parseAiPitch(aiRaw);

    return {
      subject: parsed.subject,
      body: parsed.body,
    };
  } catch {
    const fallback = generatePitch({
      curatorName,
      playlistName,
      trackTitle,
      artistName,
      genres: playlistGenres,
      tempo: null,
    });

    return {
      subject: fallback.subject,
      body: fallback.body,
    };
  }
}

/**
 * CREATE SINGLE PITCH
 * FREE = max 3 created pitches/month
 * TRIAL / PRO = unlimited
 */
router.post("/", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const matchId = req.body?.matchId;

    if (!artistId || !matchId) {
      return res.status(400).json({ error: "Missing data" });
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        track: true,
        playlist: { include: { curator: true } },
        pitch: true,
      },
    });

    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }

    if (match.track.artistId !== artistId) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "This match does not belong to the current artist.",
      });
    }

    if (match.pitch) {
      return res.json({ ok: true, pitch: match.pitch });
    }

    const usage = await getUsageOr404(artistId);

    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE" && !usage.allowed) {
      return denyFreeLimit(res, usage);
    }

    const pitch = await prisma.pitch.create({
      data: {
        matchId,
        subject: `Track suggestion: ${match.track.title}`,
        body: "",
        status: "DRAFT",
        channel: "EMAIL",
      },
    });

    return res.json({ ok: true, pitch });
  } catch (error: any) {
    console.error("CREATE_PITCH_ERROR", error?.message ?? error);
    return res.status(500).json({
      error: "CREATE_PITCH_FAILED",
      message: error?.message ?? String(error),
    });
  }
});

/**
 * LAUNCH CAMPAIGN
 * FREE = blocked
 * TRIAL / PRO = allowed
 */
router.post("/launch-campaign", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const { trackId } = req.body as LaunchCampaignRequestBody;

    if (!artistId || typeof trackId !== "string" || !trackId.trim()) {
      return res.status(400).json({
        error: "MISSING_DATA",
        message: "artistId and trackId are required",
      });
    }

    const usage = await getUsageOr404(artistId);

    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE") {
      return denyPaidRequired(
        res,
        usage,
        "Campaign launch is available on TRIAL or PRO."
      );
    }

    const matches = await prisma.match.findMany({
      where: {
        trackId,
        track: { artistId },
      },
      include: {
        track: true,
        playlist: { include: { curator: true } },
        pitch: true,
      },
    });

    let created = 0;
    let skippedExisting = 0;
    let skippedNoEmail = 0;

    for (const match of matches) {
      if (match.pitch) {
        skippedExisting++;
        continue;
      }

      if (!canEmailCurator(match.playlist?.curator)) {
        skippedNoEmail++;
        continue;
      }

      const aiPitch = await buildAiPitchForMatch(match, "EMAIL");

      await prisma.pitch.create({
        data: {
          matchId: match.id,
          subject: aiPitch.subject,
          body: aiPitch.body,
          status: "DRAFT",
          channel: "EMAIL",
        },
      });

      created++;
    }

    return res.json({
      ok: true,
      created,
      skippedExisting,
      skippedNoEmail,
    });
  } catch (error: any) {
    console.error("LAUNCH_CAMPAIGN_ERROR", error?.message ?? error);
    return res.status(500).json({
      error: "LAUNCH_CAMPAIGN_FAILED",
      message: error?.message ?? String(error),
    });
  }
});

export default router;