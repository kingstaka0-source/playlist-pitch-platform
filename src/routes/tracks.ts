import { Router } from "express";
import { prisma } from "../db";
import { getTrackAudioFeatures, getTrackMeta } from "../spotify";
import { getSpotifyAppAccessToken } from "../spotifyAppClient";
import { sendEmail } from "../email";
import { getArtistUsage } from "./artists";

export const tracks = Router();

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

function resolveRecipient(input: {
  curatorEmail?: string | null;
}) {
  const emailFrom = process.env.EMAIL_FROM || "";
  const resendTestTo = process.env.RESEND_TEST_TO || "kingstaka0@gmail.com";
  const isResendTestMode = emailFrom.includes("onboarding@resend.dev");

  if (isResendTestMode) return resendTestTo;
  return input.curatorEmail || null;
}

function getArtistId(req: any) {
  return (
    req?.legal?.artistId ||
    String(req.headers?.["x-artist-id"] || req.query?.artistId || "").trim()
  );
}

async function findTrackByAnyId(id: string) {
  return prisma.track.findFirst({
    where: {
      OR: [{ id }, { spotifyTrackId: id }],
    },
    select: {
      id: true,
      title: true,
      artistId: true,
      spotifyTrackId: true,
      artists: true,
      durationMs: true,
      createdAt: true,
      audioFeatures: true,
      genres: true,
      _count: {
        select: {
          matches: true,
        },
      },
    },
  });
}

async function requireOwnedTrack(trackId: string, artistId: string) {
  const track = await findTrackByAnyId(trackId);

  if (!track) {
    return {
      ok: false as const,
      error: {
        status: 404,
        body: { error: "TRACK_NOT_FOUND" },
      },
    };
  }

  if (track.artistId !== artistId) {
    return {
      ok: false as const,
      error: {
        status: 403,
        body: { error: "FORBIDDEN_TRACK" },
      },
    };
  }

  return { ok: true as const, track };
}

async function requirePaidPlan(artistId: string) {
  const usage = await getArtistUsage(artistId);

  if (!usage) {
    return {
      ok: false as const,
      error: {
        status: 404,
        body: {
          error: "ARTIST_NOT_FOUND",
        },
      },
    };
  }

  if (usage.plan === "FREE") {
    return {
      ok: false as const,
      error: {
        status: 403,
        body: {
          error: "PAID_PLAN_REQUIRED",
          message: "This feature is available for TRIAL and PRO only.",
          upgradeRequired: true,
          paywall: {
            plan: usage.plan,
            feature: "PRO_ONLY",
            month: usage.month,
          },
        },
      },
    };
  }

  return { ok: true as const, usage };
}

/**
 * GET /tracks
 */
tracks.get("/tracks", async (_req, res) => {
  try {
    const list = await prisma.track.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { matches: true } },
      },
    });

    return res.json(
      list.map((t) => ({
        id: t.id,
        artistId: t.artistId,
        spotifyTrackId: t.spotifyTrackId,
        title: t.title,
        artists: t.artists,
        durationMs: t.durationMs,
        audioFeatures: t.audioFeatures,
        genres: t.genres,
        createdAt: t.createdAt,
        matchCount: t._count.matches,
      }))
    );
  } catch (err: any) {
    console.error("TRACKS LIST ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "tracks list failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * GET /tracks/:id
 */
tracks.get("/tracks/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "MISSING_TRACK_ID" });
    }

    const track = await prisma.track.findFirst({
      where: {
        OR: [{ id }, { spotifyTrackId: id }],
      },
      select: {
        id: true,
        artistId: true,
        spotifyTrackId: true,
        title: true,
        artists: true,
        durationMs: true,
        createdAt: true,
        audioFeatures: true,
        genres: true,
        _count: {
          select: {
            matches: true,
          },
        },
      },
    });

    if (!track) {
      return res.status(404).json({
        error: "Track not found",
        requestedId: id,
      });
    }

    return res.json({
      id: track.id,
      artistId: track.artistId,
      spotifyTrackId: track.spotifyTrackId,
      title: track.title,
      artists: track.artists,
      durationMs: track.durationMs,
      createdAt: track.createdAt,
      audioFeatures: track.audioFeatures,
      genres: track.genres,
      matchCount: track._count.matches,
    });
  } catch (err: any) {
    console.error("TRACK DETAIL ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "track detail failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * POST /tracks/manual
 */
tracks.post("/tracks/manual", async (req, res) => {
  try {
    const {
      artistId,
      title,
      tempo,
      energy,
      valence,
      loudness = -10,
      mode = 1,
    } = req.body ?? {};

    if (!artistId || !title) {
      return res.status(400).json({ error: "artistId and title required" });
    }

    const track = await prisma.track.create({
      data: {
        artistId,
        spotifyTrackId: `manual:${Date.now()}`,
        title,
        artists: [],
        durationMs: 180000,
        audioFeatures: {
          danceability: 0.5,
          energy: energy ?? 0.5,
          valence: valence ?? 0.5,
          tempo: tempo ?? 120,
          loudness,
          mode,
          key: 0,
          duration_ms: 180000,
        },
        genres: [],
      },
    });

    return res.json(track);
  } catch (err: any) {
    console.error("TRACK MANUAL ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "track manual failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * POST /tracks/import
 */
tracks.post("/tracks/import", async (req, res) => {
  try {
    const { artistId, spotifyTrackId } = req.body ?? {};

    if (!artistId || !spotifyTrackId) {
      return res
        .status(400)
        .json({ error: "artistId and spotifyTrackId required" });
    }

    const appToken = await getSpotifyAppAccessToken();

    let meta: any;
    try {
      meta = await getTrackMeta(appToken, spotifyTrackId);
    } catch (e: any) {
      console.error(
        "SPOTIFY META ERROR",
        e?.response?.status,
        e?.response?.data
      );
      return res.status(502).json({
        error: "spotify meta failed",
        spotifyStatus: e?.response?.status,
        spotifyData: e?.response?.data,
      });
    }

    let feat: any = {};
    try {
      feat = await getTrackAudioFeatures(appToken, spotifyTrackId);
    } catch (e: any) {
      console.warn(
        "SPOTIFY FEATURES WARNING (continuing)",
        e?.response?.status,
        e?.response?.data
      );
      feat = {};
    }

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

    const track = await prisma.track.upsert({
      where: { spotifyTrackId },
      update: {
        title,
        artists,
        durationMs,
        audioFeatures: feat,
      },
      create: {
        artistId,
        spotifyTrackId,
        title,
        artists,
        durationMs,
        audioFeatures: feat,
        genres: [],
      },
    });

    return res.json(track);
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error("TRACK IMPORT ERROR", status, data ?? err?.message ?? err);
    return res.status(502).json({
      error: "track import failed",
      status,
      details: data ?? err?.message ?? String(err),
    });
  }
});

/**
 * POST /tracks/:id/send-all
 */
tracks.post("/tracks/:id/send-all", async (req, res) => {
  try {
    const trackId = String(req.params.id || "");
    const artistId = getArtistId(req);

    if (!trackId) {
      return res.status(400).json({ error: "MISSING_TRACK_ID" });
    }

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const paid = await requirePaidPlan(artistId);
    if (!paid.ok) {
      return res.status(paid.error.status).json(paid.error.body);
    }

    const owned = await requireOwnedTrack(trackId, artistId);
    if (!owned.ok) {
      return res.status(owned.error.status).json(owned.error.body);
    }

    const resolvedTrackId = owned.track.id;

    const pitches = await prisma.pitch.findMany({
      where: {
        match: { trackId: resolvedTrackId },
        status: "DRAFT",
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

    if (!pitches.length) {
      return res.status(400).json({ error: "NO_DRAFT_PITCHES_FOUND" });
    }

    const results: Array<{
      pitchId: string;
      ok: boolean;
      to?: string | null;
      messageId?: string | null;
      error?: string;
    }> = [];

    for (const pitch of pitches) {
      try {
        if (!pitch.subject?.trim() || !pitch.body?.trim()) {
          results.push({
            pitchId: pitch.id,
            ok: false,
            error: "EMPTY_SUBJECT_OR_BODY",
          });
          continue;
        }

        const curator = pitch.match?.playlist?.curator;
        const to = resolveRecipient({
          curatorEmail:
            curator?.consent && curator?.contactMethod === "EMAIL"
              ? curator?.email
              : null,
        });

        if (!to) {
          results.push({
            pitchId: pitch.id,
            ok: false,
            error: "NO_VALID_RECIPIENT",
          });
          continue;
        }

        const emailResult = await sendEmail({
          to,
          subject: pitch.subject,
          html: pitch.body,
          text: pitch.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        });

        await prisma.pitch.update({
          where: { id: pitch.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            sentTo: to,
          },
        });

        results.push({
          pitchId: pitch.id,
          ok: true,
          to,
          messageId: emailResult.messageId,
        });
      } catch (err: any) {
        results.push({
          pitchId: pitch.id,
          ok: false,
          error: err?.message || "SEND_FAILED",
        });
      }
    }

    const sentCount = results.filter((r) => r.ok).length;
    const failedCount = results.filter((r) => !r.ok).length;

    return res.json({
      ok: true,
      trackId: resolvedTrackId,
      total: results.length,
      sentCount,
      failedCount,
      results,
    });
  } catch (e: any) {
    console.error("TRACK_SEND_ALL_FAILED", e);
    return res.status(500).json({
      error: "TRACK_SEND_ALL_FAILED",
      message: e?.message || "Unknown error",
    });
  }
});

/**
 * POST /tracks/:id/auto-pitch-send
 */
tracks.post("/tracks/:id/auto-pitch-send", async (req, res) => {
  try {
    const trackId = String(req.params.id || "");
    const artistId = getArtistId(req);

    if (!trackId) {
      return res.status(400).json({ error: "MISSING_TRACK_ID" });
    }

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const paid = await requirePaidPlan(artistId);
    if (!paid.ok) {
      return res.status(paid.error.status).json(paid.error.body);
    }

    const owned = await requireOwnedTrack(trackId, artistId);
    if (!owned.ok) {
      return res.status(owned.error.status).json(owned.error.body);
    }

    const resolvedTrackId = owned.track.id;

    const matches = await prisma.match.findMany({
  where: {
    trackId: resolvedTrackId,
    playlist: {
      curator: {
        email: { not: null },
        contactMethod: "EMAIL",
        consent: true,
        contactConfidence: { gte: 40 },
      },
    },
  },
  include: {
    track: true,
    playlist: {
      include: {
        curator: true,
      },
    },
  },
  orderBy: { fitScore: "desc" },
  take: 20,
});

    if (!matches.length) {
      return res.status(400).json({ error: "NO_MATCHES_FOUND" });
    }

    const results: Array<{
      let skippedCount = 0;
      matchId: string;
      pitchId?: string;
      ok: boolean;
      action?: string;
      to?: string | null;
      messageId?: string | null;
      error?: string;
    }> = [];

    for (const match of matches) {
  await new Promise((r) => setTimeout(r, 250)); // 🔥 RATE LIMIT FIX

  try {
        const curator = match.playlist?.curator;

        const to = resolveRecipient({
          curatorEmail:
            curator?.consent && curator?.contactMethod === "EMAIL"
              ? curator?.email
              : null,
        });

        if (!to) {
          results.push({
            matchId: match.id,
            ok: false,
            error: "NO_VALID_RECIPIENT",
          });
          continue;
        }

        const generated = buildPitchContent({
          trackTitle: match.track.title,
          playlistName: match.playlist.name,
          spotifyTrackId: match.track.spotifyTrackId,
          explanation: match.explanation,
        });

        const existing = await prisma.pitch.findUnique({
          where: { matchId: match.id },
        });

        let pitch;

        if (!existing) {
          pitch = await prisma.pitch.create({
            data: {
              matchId: match.id,
              subject: generated.subject,
              body: generated.body,
              channel: "EMAIL",
              status: "DRAFT",
            },
          });
        } else if (existing.status === "SENT") {
  skippedCount++;

  results.push({
    matchId: match.id,
    pitchId: existing.id,
    ok: true,
    action: "SKIPPED_ALREADY_SENT",
  });

  continue;
} else {
          pitch = await prisma.pitch.update({
            where: { id: existing.id },
            data: {
              subject: generated.subject,
              body: generated.body,
              channel: "EMAIL",
              status: "DRAFT",
              sentAt: null,
              sentTo: null,
            },
          });
        }

        const emailResult = await sendEmail({
          to,
          subject: generated.subject,
          html: generated.body,
          text: generated.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        });

        const sentPitch = await prisma.pitch.update({
          where: { id: pitch.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            sentTo: to,
          },
        });

        results.push({
          matchId: match.id,
          pitchId: sentPitch.id,
          ok: true,
          action: existing ? "UPDATED_AND_SENT" : "CREATED_AND_SENT",
          to,
          messageId: emailResult.messageId,
        });
      } catch (err: any) {
        results.push({
          matchId: match.id,
          ok: false,
          error: err?.message || "AUTO_PITCH_SEND_FAILED",
        });
      }
    }

    const sentCount = results.filter((r) => r.ok && !r.action?.startsWith("SKIPPED")).length;
const failedCount = results.filter((r) => !r.ok).length;

    return res.json({
  ok: true,
  trackId: resolvedTrackId,
  total: results.length,
  sentCount,
  skippedCount,
  failedCount,
  results,
});
  } catch (e: any) {
    console.error("TRACK_AUTO_PITCH_SEND_FAILED", e);
    return res.status(500).json({
      error: "TRACK_AUTO_PITCH_SEND_FAILED",
      message: e?.message || "Unknown error",
    });
  }
});

export default tracks;