import { Router } from "express";
import { Resend } from "resend";
import { prisma } from "../db";
import { buildPitchPrompt } from "../services/ai/buildPitchPrompt";
import { parseAiPitch } from "../services/ai/parseAiPitch";
import { generateTextFromAi } from "../services/ai/generateTextFromAi";
import { getArtistUsage } from "./artists";
import { generatePitch } from "../pitch/generatePitch"

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

async function resetPitchToDraft(pitchId: string) {
  return prisma.pitch.update({
    where: { id: pitchId },
    data: {
      status: "DRAFT",
      sentAt: null,
      sentTo: null,
    },
  });
}

async function getUsageOr404(artistId: string) {
  return getArtistUsage(artistId);
}

function denyFreeLimit(res: any, usage: Awaited<ReturnType<typeof getArtistUsage>>) {
  return res.status(403).json({
    error: "FREE_LIMIT_REACHED",
    message: "FREE plan allows 3 created pitches per month. Upgrade to continue.",
    usage: usage?.month ?? null,
  });
}

function denyPaidRequired(
  res: any,
  message = "This feature is available for TRIAL and PRO only."
) {
  return res.status(403).json({
    error: "PAID_PLAN_REQUIRED",
    message,
  });
}

async function buildAiPitchForMatch(match: any, channel: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: match.track.artistId },
    select: { id: true, name: true },
  });

  const artistName = artist?.name || "Unknown Artist";
  const trackTitle = match.track?.title || "Untitled Track";
  const trackArtists = Array.isArray(match.track?.artists) ? match.track.artists : [];
  const playlistName = match.playlist?.name || "Playlist";
  const curatorName = match.playlist?.curator?.name || null;
  const playlistGenres = Array.isArray(match.playlist?.genres) ? match.playlist.genres : [];

  const safeChannel: "EMAIL" | "INAPP" =
    channel === "INAPP" ? "INAPP" : "EMAIL";

  try {
    const prompt = buildPitchPrompt({
      artistName,
      trackTitle,
      trackArtists,
      trackGenre: (match.track as any)?.genre || null,
      trackMood: (match.track as any)?.mood || null,
      trackDescription: (match.track as any)?.description || null,
      curatorName,
      playlistName,
      playlistDescription: (match.playlist as any)?.description || null,
      playlistGenres,
      channel: safeChannel,
    });

    const aiRawResponse = await generateTextFromAi(prompt);
    const parsed = parseAiPitch(aiRawResponse);

    return {
      subject: parsed.subject,
      body: parsed.body,
    };
    } catch {
    const tempo =
      typeof (match.track?.audioFeatures as any)?.tempo === "number"
        ? (match.track.audioFeatures as any).tempo
        : null;

    const body = generatePitch({
      curatorName,
      playlistName,
      trackTitle,
      artistName,
      genres: playlistGenres,
      tempo,
    });

    return {
      subject: `Track suggestion: ${trackTitle}`,
      body,
    };
  }
}

/**
 * CREATE SINGLE PITCH
 */
router.post("/", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const matchId = String(req.body?.matchId || "").trim();
    const requestedChannel = String(req.body?.channel || "EMAIL")
      .trim()
      .toUpperCase();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!matchId) {
      return res.status(400).json({ error: "MISSING_MATCH_ID" });
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        track: true,
        playlist: {
          include: {
            curator: true,
          },
        },
        pitch: true,
      },
    });

    if (!match) {
      return res.status(404).json({ error: "MATCH_NOT_FOUND" });
    }

    if (match.track.artistId !== artistId) {
      return res.status(403).json({ error: "MATCH_NOT_OWNED_BY_ARTIST" });
    }

    if (match.pitch) {
      return res.json({
        ok: true,
        existing: true,
        pitch: match.pitch,
      });
    }

    const usage = await getUsageOr404(artistId);
    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE" && !usage.allowed) {
      return denyFreeLimit(res, usage);
    }

    const curator = match.playlist?.curator;
    const channel: "EMAIL" | "INAPP" =
      requestedChannel === "INAPP"
        ? "INAPP"
        : canEmailCurator(curator)
        ? "EMAIL"
        : "INAPP";

    const created = await prisma.pitch.create({
      data: {
        matchId: match.id,
        subject: `Track suggestion: ${match.track.title}`,
        body: "",
        channel,
        status: "DRAFT",
      },
    });

    return res.json({
      ok: true,
      existing: false,
      pitch: created,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_CREATE_ERROR", message);
    return res.status(500).json({
      error: "PITCH_CREATE_FAILED",
      message,
    });
  }
});

/**
 * LIST PITCHES
 */
router.get("/", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const trackId = String(req.query?.trackId || "").trim();

    const pitches = await prisma.pitch.findMany({
      where: {
        match: {
          track: {
            artistId,
            ...(trackId ? { id: trackId } : {}),
          },
        },
      },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const results = pitches.map((p) => {
      const curator = p.match?.playlist?.curator || null;

      return {
        id: p.id,
        subject: p.subject,
        body: p.body,
        channel: p.channel,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        sentAt: p.sentAt,
        sentTo: p.sentTo,
        matchId: p.matchId,
        match: p.match
          ? {
              id: p.match.id,
              playlistId: p.match.playlistId,
              trackId: p.match.trackId,
            }
          : null,
        track: p.match?.track
          ? {
              id: p.match.track.id,
              title: p.match.track.title,
              spotifyTrackId: p.match.track.spotifyTrackId,
              artists: p.match.track.artists,
            }
          : null,
        playlist: p.match?.playlist
          ? {
              id: p.match.playlist.id,
              name: p.match.playlist.name,
              spotifyPlaylistId: p.match.playlist.spotifyPlaylistId,
              genres: p.match.playlist.genres,
            }
          : null,
        curator: curator
          ? {
              id: curator.id,
              name: curator.name,
              email: curator.email,
              contactMethod: curator.contactMethod,
              consent: curator.consent,
              canEmail: canEmailCurator(curator),
            }
          : null,
      };
    });

    return res.json({
      ok: true,
      count: results.length,
      pitches: results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_LIST_ERROR", message);
    return res.status(500).json({
      error: "PITCH_LIST_FAILED",
      message,
    });
  }
});

/**
 * GET SINGLE PITCH
 */
router.get("/:id", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const id = String(req.params.id || "").trim();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!id) {
      return res.status(400).json({ error: "MISSING_PITCH_ID" });
    }

    const pitch = await prisma.pitch.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
    });

    if (!pitch) {
      return res.status(404).json({ error: "PITCH_NOT_FOUND" });
    }

    if (pitch.match?.track?.artistId !== artistId) {
      return res.status(403).json({ error: "PITCH_NOT_OWNED_BY_ARTIST" });
    }

    const curator = pitch.match?.playlist?.curator || null;

    return res.json({
      ok: true,
      pitch: {
        id: pitch.id,
        subject: pitch.subject,
        body: pitch.body,
        channel: pitch.channel,
        status: pitch.status,
        createdAt: pitch.createdAt,
        updatedAt: pitch.updatedAt,
        sentAt: pitch.sentAt,
        sentTo: pitch.sentTo,
        matchId: pitch.matchId,
        track: pitch.match?.track
          ? {
              id: pitch.match.track.id,
              title: pitch.match.track.title,
              spotifyTrackId: pitch.match.track.spotifyTrackId,
              artists: pitch.match.track.artists,
            }
          : null,
        playlist: pitch.match?.playlist
          ? {
              id: pitch.match.playlist.id,
              name: pitch.match.playlist.name,
              spotifyPlaylistId: pitch.match.playlist.spotifyPlaylistId,
              genres: pitch.match.playlist.genres,
              rules: pitch.match.playlist.rules,
            }
          : null,
        curator: curator
          ? {
              id: curator.id,
              name: curator.name,
              email: curator.email,
              contactMethod: curator.contactMethod,
              consent: curator.consent,
              languages: curator.languages,
              canEmail: canEmailCurator(curator),
            }
          : null,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_GET_ERROR", message);
    return res.status(500).json({
      error: "PITCH_GET_FAILED",
      message,
    });
  }
});

/**
 * SAVE / EDIT DRAFT
 */
router.patch("/:id", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const id = String(req.params.id || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || "").trim();
    const channel = String(req.body?.channel || "EMAIL")
      .trim()
      .toUpperCase();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!id) {
      return res.status(400).json({ error: "MISSING_PITCH_ID" });
    }

    const existing = await prisma.pitch.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            track: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "PITCH_NOT_FOUND" });
    }

    if (existing.match?.track?.artistId !== artistId) {
      return res.status(403).json({ error: "PITCH_NOT_OWNED_BY_ARTIST" });
    }

    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "ONLY_DRAFT_EDITABLE" });
    }

    const updated = await prisma.pitch.update({
      where: { id },
      data: {
        subject,
        body,
        channel: channel === "INAPP" ? "INAPP" : "EMAIL",
      },
    });

    return res.json({
      ok: true,
      pitch: updated,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_PATCH_ERROR", message);
    return res.status(500).json({
      error: "PITCH_PATCH_FAILED",
      message,
    });
  }
});

/**
 * QUEUE SINGLE PITCH
 */
router.post("/:id/queue", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const id = String(req.params.id || "").trim();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const usage = await getUsageOr404(artistId);
    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE") {
      return denyPaidRequired(res, "Queueing pitches is available for TRIAL and PRO only.");
    }

    if (!id) {
      return res.status(400).json({ error: "MISSING_PITCH_ID" });
    }

    const pitch = await prisma.pitch.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
    });

    if (!pitch) {
      return res.status(404).json({ error: "PITCH_NOT_FOUND" });
    }

    if (pitch.match?.track?.artistId !== artistId) {
      return res.status(403).json({ error: "PITCH_NOT_OWNED_BY_ARTIST" });
    }

    if (pitch.status !== "DRAFT") {
      return res.status(400).json({ error: "ONLY_DRAFT_CAN_BE_QUEUED" });
    }

    if (pitch.channel !== "EMAIL") {
      return res.status(400).json({ error: "PITCH_NOT_EMAIL_CHANNEL" });
    }

    if (!pitch.subject?.trim() || !pitch.body?.trim()) {
      return res.status(400).json({ error: "PITCH_EMPTY" });
    }

    const curator = pitch.match?.playlist?.curator;
    if (!curator || !canEmailCurator(curator)) {
      return res.status(400).json({ error: "CURATOR_NOT_EMAILABLE" });
    }

    const updated = await prisma.pitch.update({
      where: { id },
      data: {
        status: "QUEUED",
      },
    });

    return res.json({
      ok: true,
      pitch: updated,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_QUEUE_ERROR", message);
    return res.status(500).json({
      error: "PITCH_QUEUE_FAILED",
      message,
    });
  }
});

/**
 * RESET TO DRAFT
 */
router.post("/:id/reset-draft", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const id = String(req.params.id || "").trim();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!id) {
      return res.status(400).json({ error: "MISSING_PITCH_ID" });
    }

    const existing = await prisma.pitch.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            track: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "PITCH_NOT_FOUND" });
    }

    if (existing.match?.track?.artistId !== artistId) {
      return res.status(403).json({ error: "PITCH_NOT_OWNED_BY_ARTIST" });
    }

    const updated = await prisma.pitch.update({
      where: { id },
      data: {
        status: "DRAFT",
        sentAt: null,
        sentTo: null,
      },
    });

    return res.json({
      ok: true,
      pitch: updated,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_RESET_DRAFT_ERROR", message);
    return res.status(500).json({
      error: "PITCH_RESET_DRAFT_FAILED",
      message,
    });
  }
});

/**
 * SEND SINGLE EMAIL NOW
 */
router.post("/:id/email", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const id = String(req.params.id || "").trim();

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const usage = await getUsageOr404(artistId);
    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE") {
      return denyPaidRequired(res, "Sending pitches is available for TRIAL and PRO only.");
    }

    if (!id) {
      return res.status(400).json({ error: "MISSING_PITCH_ID" });
    }

    const pitch = await prisma.pitch.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
    });

    if (!pitch) {
      return res.status(404).json({ error: "PITCH_NOT_FOUND" });
    }

    if (pitch.match?.track?.artistId !== artistId) {
      return res.status(403).json({ error: "PITCH_NOT_OWNED_BY_ARTIST" });
    }

    if (pitch.status === "SENT") {
      return res.status(400).json({ error: "PITCH_ALREADY_SENT" });
    }

    if (pitch.channel !== "EMAIL") {
      return res.status(400).json({ error: "PITCH_NOT_EMAIL_CHANNEL" });
    }

    const curator = pitch.match?.playlist?.curator;
    if (!curator || !canEmailCurator(curator)) {
      return res.status(400).json({ error: "CURATOR_NOT_EMAILABLE" });
    }

    if (!pitch.subject?.trim() || !pitch.body?.trim()) {
      return res.status(400).json({ error: "PITCH_EMPTY" });
    }

    if (!resend) {
      return res.status(500).json({ error: "RESEND_NOT_CONFIGURED" });
    }

    const from = String(process.env.EMAIL_FROM || "").trim();
    if (!from) {
      return res.status(500).json({ error: "EMAIL_FROM_NOT_CONFIGURED" });
    }

    const sendTo = resolveRecipient(curator.email);
    if (!sendTo) {
      return res.status(400).json({ error: "RECIPIENT_NOT_RESOLVED" });
    }

    const sendResult = await resend.emails.send({
      from,
      to: [sendTo],
      subject: pitch.subject,
      text: pitch.body,
    });

    const updated = await prisma.pitch.update({
      where: { id: pitch.id },
      data: {
        channel: "EMAIL",
        status: "SENT",
        sentAt: new Date(),
        sentTo: sendTo,
      },
    });

    return res.json({
      ok: true,
      pitch: updated,
      email: {
        id: sendResult.data?.id ?? null,
        sentTo: sendTo,
        originalCuratorEmail: curator.email,
        testModeRedirected:
          from.toLowerCase() === "onboarding@resend.dev" &&
          !!process.env.RESEND_TEST_TO &&
          sendTo !== curator.email,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_SEND_EMAIL_ERROR", message);
    return res.status(500).json({
      error: "PITCH_SEND_EMAIL_FAILED",
      message,
    });
  }
});

/**
 * SEND QUEUED
 */
router.post("/send-queued", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const usage = await getUsageOr404(artistId);
    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE") {
      return denyPaidRequired(res, "Sending queued pitches is available for TRIAL and PRO only.");
    }

    if (!resend) {
      return res.status(500).json({ error: "RESEND_NOT_CONFIGURED" });
    }

    const from = String(process.env.EMAIL_FROM || "").trim();
    if (!from) {
      return res.status(500).json({ error: "EMAIL_FROM_NOT_CONFIGURED" });
    }

    const queuedPitches = await prisma.pitch.findMany({
      where: {
        status: "QUEUED",
        channel: "EMAIL",
        match: {
          track: {
            artistId,
          },
        },
      },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    let sent = 0;
    let failed = 0;

    const results: Array<{
      pitchId: string;
      status: string;
      sentTo?: string | null;
      emailId?: string | null;
      originalCuratorEmail?: string | null;
      testModeRedirected?: boolean;
      error?: string;
    }> = [];

    for (const pitch of queuedPitches) {
      try {
        const curator = pitch.match?.playlist?.curator;

        if (!curator || !canEmailCurator(curator)) {
          await resetPitchToDraft(pitch.id);
          failed += 1;
          results.push({
            pitchId: pitch.id,
            status: "FAILED_RESET_TO_DRAFT",
            error: "CURATOR_NOT_EMAILABLE",
          });
          continue;
        }

        if (!pitch.subject?.trim() || !pitch.body?.trim()) {
          await resetPitchToDraft(pitch.id);
          failed += 1;
          results.push({
            pitchId: pitch.id,
            status: "FAILED_RESET_TO_DRAFT",
            error: "PITCH_EMPTY",
          });
          continue;
        }

        const sendTo = resolveRecipient(curator.email);
        if (!sendTo) {
          await resetPitchToDraft(pitch.id);
          failed += 1;
          results.push({
            pitchId: pitch.id,
            status: "FAILED_RESET_TO_DRAFT",
            error: "RECIPIENT_NOT_RESOLVED",
          });
          continue;
        }

        const sendResult = await resend.emails.send({
          from,
          to: [sendTo],
          subject: pitch.subject,
          text: pitch.body,
        });

        await prisma.pitch.update({
          where: { id: pitch.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            sentTo: sendTo,
          },
        });

        sent += 1;
        results.push({
          pitchId: pitch.id,
          status: "SENT",
          sentTo: sendTo,
          emailId: sendResult.data?.id ?? null,
          originalCuratorEmail: curator.email,
          testModeRedirected:
            from.toLowerCase() === "onboarding@resend.dev" &&
            !!process.env.RESEND_TEST_TO &&
            sendTo !== curator.email,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        await resetPitchToDraft(pitch.id);
        failed += 1;
        results.push({
          pitchId: pitch.id,
          status: "FAILED_RESET_TO_DRAFT",
          error: message,
        });
      }
    }

    return res.json({
      ok: true,
      totalQueued: queuedPitches.length,
      sent,
      failed,
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_SEND_QUEUED_ERROR", message);
    return res.status(500).json({
      error: "PITCH_SEND_QUEUED_FAILED",
      message,
    });
  }
});

/**
 * RESET WRONG QUEUED
 */
router.post("/reset-wrong-queued", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const queuedPitches = await prisma.pitch.findMany({
      where: {
        status: "QUEUED",
        match: {
          track: {
            artistId,
          },
        },
      },
      include: {
        match: {
          include: {
            playlist: {
              include: {
                curator: true,
              },
            },
            track: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    let reset = 0;
    let kept = 0;

    const results: Array<{
      pitchId: string;
      status: string;
      channel: string;
      curatorEmail: string | null;
      canEmail: boolean;
    }> = [];

    for (const pitch of queuedPitches) {
      const curator = pitch.match?.playlist?.curator || null;
      const emailable = canEmailCurator(curator);

      if (!emailable || pitch.channel !== "EMAIL") {
        const updated = await prisma.pitch.update({
          where: { id: pitch.id },
          data: {
            status: "DRAFT",
            sentAt: null,
            sentTo: null,
          },
        });

        reset += 1;
        results.push({
          pitchId: updated.id,
          status: "RESET_TO_DRAFT",
          channel: updated.channel,
          curatorEmail: curator?.email || null,
          canEmail: emailable,
        });
      } else {
        kept += 1;
        results.push({
          pitchId: pitch.id,
          status: "KEPT_QUEUED",
          channel: pitch.channel,
          curatorEmail: curator?.email || null,
          canEmail: emailable,
        });
      }
    }

    return res.json({
      ok: true,
      totalQueued: queuedPitches.length,
      reset,
      kept,
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_RESET_WRONG_QUEUED_ERROR", message);
    return res.status(500).json({
      error: "PITCH_RESET_WRONG_QUEUED_FAILED",
      message,
    });
  }
});

/**
 * LAUNCH CAMPAIGN
 */
router.post("/launch-campaign", async (req, res) => {
  try {
    const artistId = getArtistId(req);
    const body = (req.body || {}) as LaunchCampaignRequestBody;
    const trackId = String(body.trackId || "").trim();

    const selectedMatchIds = Array.isArray(body.matchIds)
      ? body.matchIds.map((value) => String(value).trim()).filter(Boolean)
      : [];

    const queueEmail = body.queueEmail === false ? false : true;

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    if (!trackId) {
      return res.status(400).json({ error: "MISSING_TRACK_ID" });
    }

    const usage = await getUsageOr404(artistId);
    if (!usage) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (usage.plan === "FREE") {
      return denyPaidRequired(res, "Launch Campaign is available for TRIAL and PRO only.");
    }

    const matches = await prisma.match.findMany({
      where: {
        trackId,
        track: {
          artistId,
        },
        ...(selectedMatchIds.length > 0
          ? {
              id: {
                in: selectedMatchIds,
              },
            }
          : {}),
      },
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
    });

    if (matches.length === 0) {
      return res.status(404).json({
        error: "NO_MATCHES_FOUND_FOR_TRACK",
      });
    }

    let created = 0;
    let queued = 0;
    let drafted = 0;
    let skipped = 0;
    let failed = 0;

    const results: Array<{
      matchId: string;
      pitchId?: string;
      trackTitle: string | null;
      playlistName: string | null;
      status: string;
      channel?: string;
      pitchStatus?: string;
      error?: string;
    }> = [];

    for (const match of matches) {
      try {
        const curator = match.playlist?.curator || null;
        const emailable = canEmailCurator(curator);
        const channel: "EMAIL" | "INAPP" = emailable ? "EMAIL" : "INAPP";

        if (match.pitch) {
          if (
            queueEmail &&
            emailable &&
            match.pitch.channel === "EMAIL" &&
            match.pitch.status === "DRAFT"
          ) {
            const aiPitch = await buildAiPitchForMatch(match, channel);

            const updated = await prisma.pitch.update({
              where: { id: match.pitch.id },
              data: {
                status: "QUEUED",
                subject: aiPitch.subject,
                body: aiPitch.body,
              },
            });

            queued += 1;
            results.push({
              matchId: match.id,
              pitchId: updated.id,
              trackTitle: match.track?.title || null,
              playlistName: match.playlist?.name || null,
              status: "QUEUED_EXISTING_DRAFT",
              channel: updated.channel,
              pitchStatus: updated.status,
            });
          } else {
            skipped += 1;
            results.push({
              matchId: match.id,
              pitchId: match.pitch.id,
              trackTitle: match.track?.title || null,
              playlistName: match.playlist?.name || null,
              status: "SKIPPED_EXISTING_PITCH",
              channel: match.pitch.channel,
              pitchStatus: match.pitch.status,
            });
          }

          continue;
        }

        const status = queueEmail && emailable ? "QUEUED" : "DRAFT";
        const aiPitch = await buildAiPitchForMatch(match, channel);

        const createdPitch = await prisma.pitch.create({
          data: {
            matchId: match.id,
            subject: aiPitch.subject,
            body: aiPitch.body,
            channel,
            status,
          },
        });

        created += 1;

        if (status === "QUEUED") {
          queued += 1;
        } else {
          drafted += 1;
        }

        results.push({
          matchId: match.id,
          pitchId: createdPitch.id,
          trackTitle: match.track?.title || null,
          playlistName: match.playlist?.name || null,
          status: "CREATED",
          channel,
          pitchStatus: status,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        failed += 1;
        results.push({
          matchId: match.id,
          trackTitle: match.track?.title || null,
          playlistName: match.playlist?.name || null,
          status: "FAILED",
          error: message,
        });
      }
    }

    return res.json({
      ok: true,
      trackId,
      totalMatches: matches.length,
      created,
      queued,
      drafted,
      skipped,
      failed,
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PITCH_LAUNCH_CAMPAIGN_ERROR", message);
    return res.status(500).json({
      error: "PITCH_LAUNCH_CAMPAIGN_FAILED",
      message,
    });
  }
});

export default router;