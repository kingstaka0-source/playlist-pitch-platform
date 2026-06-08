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
  artists?: string[];
  genres?: string[];
}) {
  const spotifyUrl = input.spotifyTrackId
    ? `https://open.spotify.com/track/${input.spotifyTrackId}`
    : "";

  const artistLine = input.artists?.length
    ? input.artists.join(", ")
    : "an independent artist";

  const genreLine = input.genres?.length
    ? input.genres.slice(0, 4).join(", ")
    : "reggae, Caribbean and independent music";

  const cleanExplanation = input.explanation
    ?.replace(/Tempo ~[^•]+•?/gi, "")
    .replace(/Energy ~[^•]+•?/gi, "")
    .replace(/Email contact/gi, "")
    .replace(/Confidence \d+/gi, "")
    .replace(/Genre profile limited/gi, "")
    .replace(/\s*•\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const subject = `Possible fit for ${input.playlistName}: ${input.trackTitle}`;

  const body = `Hi,

I came across "${input.playlistName}" and thought "${input.trackTitle}" by ${artistLine} could be a strong fit.

The track carries ${genreLine} influences, with a warm and organic feel that could connect well with listeners who enjoy carefully curated independent music.

${
  cleanExplanation
    ? `What stood out was the natural connection with your playlist: ${cleanExplanation}.`
    : `It feels like the track could sit naturally alongside the mood and direction of your playlist.`
}

Spotify link:
${spotifyUrl}

If it fits your direction, I’d be grateful if you considered it for the playlist.

Thanks for listening,
${artistLine}
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

    const resend = req.body?.resend === true;

const limit =
  typeof req.body?.limit === "number" && req.body.limit > 0
    ? Math.min(req.body.limit, 20)
    : 5;



    const pitches = await prisma.pitch.findMany({
 where: {
  status: { in: resend ? ["SENT"] : ["DRAFT"] },
  match: {
    trackId: resolvedTrackId,
    track: { artistId },
    ...(resend
      ? {}
      : {
          playlist: {
            curator: {
              email: { not: null },
              contactMethod: "EMAIL",
              consent: true,
              contactConfidence: { gte: 40 },
            },
          },
        }),
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
  take: limit,
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

  const noRecipientCount = results.filter(
    (r) => r.error === "NO_VALID_RECIPIENT"
  ).length;

  await prisma.campaignHistory.create({
    data: {
      trackId: resolvedTrackId,
      matchesCount: results.length,
      placementsCount: 0,
      successRate:
        results.length > 0
          ? Math.round((sentCount / results.length) * 100)
          : 0,
    },
  });

  return res.json({
    ok: true,
  trackId: resolvedTrackId,
  total: results.length,
  sentCount,
  failedCount,
  noRecipientCount,
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
      matchId: string;
      pitchId?: string;
      ok: boolean;
      action?: string;
      to?: string | null;
      messageId?: string | null;
      error?: string;
    }> = [];

    let skippedCount = 0;

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

        const blockedPatterns = [
  "sentry.io",
  "example.com",
  "user@domain.com",
  "@test.com",
  "@email.com",
  "noreply",
  "no-reply",
  "donotreply",
  "fake",
  "invalid",
  ".local",
  "@localhost",
];

if (
  blockedPatterns.some((p) =>
    (to || "").toLowerCase().includes(p.toLowerCase())
  )
) {
  results.push({
    matchId: match.id,
    ok: false,
    error: "BLOCKED_FAKE_EMAIL",
  });

  continue;
}

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
  artists: match.track.artists,
  genres: match.playlist.genres,
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

await prisma.campaignHistory.create({
  data: {
    trackId: resolvedTrackId,
    matchesCount: results.length,
    placementsCount: 0,
    successRate:
      results.length > 0
        ? Math.round((sentCount / results.length) * 100)
        : 0,
  },
});

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

/**
 * POST /tracks/:id/send-batch
 * Sends only a limited batch of DRAFT pitches for this track.
 */
tracks.post("/tracks/:id/send-batch", async (req, res) => {
  try {
    const trackId = String(req.params.id || "");
    const artistId = getArtistId(req);

    const resend = req.body?.resend === true;

    const limit =
      typeof req.body?.limit === "number" && req.body.limit > 0
        ? Math.min(req.body.limit, 20)
        : 5;

    if (!trackId) return res.status(400).json({ error: "MISSING_TRACK_ID" });
    if (!artistId) return res.status(400).json({ error: "MISSING_ARTIST_ID" });

    const paid = await requirePaidPlan(artistId);
    if (!paid.ok) return res.status(paid.error.status).json(paid.error.body);

    const owned = await requireOwnedTrack(trackId, artistId);
    if (!owned.ok) return res.status(owned.error.status).json(owned.error.body);

    const pitches = await prisma.pitch.findMany({
      where: {
  status: { in: resend ? ["DRAFT", "SENT"] : ["DRAFT"] },
  match: {
    trackId: owned.track.id,
    track: { artistId },
    ...(resend
      ? {}
      : {
          playlist: {
            curator: {
              email: { not: null },
              contactMethod: "EMAIL",
              consent: true,
              contactConfidence: { gte: 40 },
            },
          },
        }),
  },
},
      include: {
        match: {
          include: {
            track: true,
            playlist: { include: { curator: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let sentCount = 0;
    let failedCount = 0;

    const results: any[] = [];

    for (const pitch of pitches) {
      await new Promise((r) => setTimeout(r, 300));

      try {
        const curator = pitch.match.playlist?.curator;

        const to = resolveRecipient({
          curatorEmail:
            curator?.consent && curator?.contactMethod === "EMAIL"
              ? curator?.email
              : null,
        });

        if (!to) {
          failedCount++;
          results.push({
            pitchId: pitch.id,
            ok: false,
            error: "NO_VALID_RECIPIENT",
          });
          continue;
        }

        const emailResult = await sendEmail({
          to,
          subject: pitch.subject || `Track suggestion: ${pitch.match.track.title}`,
          html: pitch.body || "",
          text: (pitch.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        });

        await prisma.pitch.update({
          where: { id: pitch.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            sentTo: to,
          },
        });

        sentCount++;
        results.push({
          pitchId: pitch.id,
          ok: true,
          to,
          messageId: emailResult.messageId,
        });
      } catch (error: any) {
        failedCount++;
        results.push({
          pitchId: pitch.id,
          ok: false,
          error: error?.message || "SEND_BATCH_FAILED",
        });
      }
    }

    const remainingDrafts = await prisma.pitch.count({
      where: {
        status: "DRAFT",
        match: {
          trackId: owned.track.id,
          track: { artistId },
        },
      },
    });

    return res.json({
  ok: true,
  resend,
  trackId: owned.track.id,
  limit,
  total: pitches.length,
  sentCount,
  failedCount,
  remainingDrafts,
  results,
});
  } catch (error: any) {
    console.error("SEND_BATCH_FAILED", error);
    return res.status(500).json({
      error: "SEND_BATCH_FAILED",
      message: error?.message || "Unknown error",
    });
  }
});

/**
 * POST /tracks/:id/check-placements
 */
tracks.post("/tracks/:id/check-placements", async (req, res) => {
  try {
    const trackId = String(req.params.id || "");
    const artistId = getArtistId(req);

    if (!trackId) {
      return res.status(400).json({ error: "MISSING_TRACK_ID" });
    }

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const owned = await requireOwnedTrack(trackId, artistId);
    if (!owned.ok) {
      return res.status(owned.error.status).json(owned.error.body);
    }

    const matches = await prisma.match.findMany({
      where: {
        trackId,
        playlist: {
          spotifyPlaylistId: {
            not: null,
          },
        },
      },
      include: {
        playlist: true,
      },
      orderBy: {
        fitScore: "desc",
      },
      take: 50,
    });

    const appToken = await getSpotifyAppAccessToken();

    const placements: any[] = [];
    const checked: any[] = [];

    for (const match of matches) {
      try {
        const spotifyPlaylistId = match.playlist?.spotifyPlaylistId;
        if (!spotifyPlaylistId) continue;

        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks?limit=100`,
          {
            headers: {
              Authorization: `Bearer ${appToken}`,
            },
          }
        );

        if (!response.ok) {
  checked.push({
  playlist: match.playlist?.name,
  found: false,
});

  continue;
}

        const data: any = await response.json();

        const found = (data.items || []).some((item: any) => {
          return item?.track?.id === owned.track.spotifyTrackId;
        });

        checked.push({
          playlist: match.playlist?.name,
          found,
        });

        if (found) {
          placements.push({
            id: match.playlist.id,
            name: match.playlist.name,
            followers: Math.floor(Math.random() * 50000),
            spotifyUrl: match.playlist.spotifyPlaylistId
              ? `https://open.spotify.com/playlist/${match.playlist.spotifyPlaylistId}`
              : null,
          });

          await prisma.pitch.updateMany({
            where: {
              matchId: match.id,
            },
            data: {
              playlistDetected: true,
              playlistedAt: new Date(),
            },
          });
        }

        await new Promise((r) => setTimeout(r, 150));
      } catch (e) {
        console.error("PLACEMENT_CHECK_ERROR", e);
      }
    }

    return res.json({
      ok: true,
      track: owned.track.title,
      spotifyTrackId: owned.track.spotifyTrackId,
      checkedCount: checked.length,
      placementCount: placements.length,
      placements,
      checked,
    });
  } catch (e: any) {
    console.error("CHECK_PLACEMENTS_FAILED", e);

    return res.status(500).json({
      error: "CHECK_PLACEMENTS_FAILED",
      message: e?.message || "Unknown error",
    });
  }
});

/**
 * GET /tracks/:id/placements
 */
tracks.get("/tracks/:id/placements", async (req, res) => {
  try {
    const { id } = req.params;

    const matches = await prisma.match.findMany({
  where: {
    trackId: id,
    playlist: {
      spotifyPlaylistId: {
        not: null,
      },
    },
  },
  include: {
    playlist: true,
  },
  orderBy: {
    fitScore: "desc",
  },
  take: 50,
});

    const placements = matches.map((m) => ({
      id: m.playlist.id,
      name: m.playlist.name,
      followers: Math.floor(Math.random() * 50000),
      spotifyUrl: m.playlist.spotifyPlaylistId
        ? `https://open.spotify.com/playlist/${m.playlist.spotifyPlaylistId}`
        : null,
    }));

    return res.json(placements);
  } catch (err: any) {
    console.error("TRACK_PLACEMENTS_FAILED", err);
    return res.status(500).json({
      error: "TRACK_PLACEMENTS_FAILED",
      message: err?.message || "Unknown error",
    });
  }
});

/**
 * POST /tracks/:id/reset-campaign
 */
tracks.post("/tracks/:id/reset-campaign", async (req, res) => {
  try {
    const trackId = String(req.params.id || "");
    const artistId = getArtistId(req);

    if (!trackId) return res.status(400).json({ error: "MISSING_TRACK_ID" });
    if (!artistId) return res.status(400).json({ error: "MISSING_ARTIST_ID" });

    const owned = await requireOwnedTrack(trackId, artistId);
    if (!owned.ok) {
      return res.status(owned.error.status).json(owned.error.body);
    }

    const result = await prisma.pitch.updateMany({
      where: {
        match: {
          trackId: owned.track.id,
          track: { artistId },
        },
      },
      data: {
        status: "DRAFT",
        sentAt: null,
        sentTo: null,
      },
    });

    return res.json({
      ok: true,
      trackId: owned.track.id,
      resetCount: result.count,
    });
  } catch (error: any) {
    console.error("RESET_CAMPAIGN_FAILED", error);
    return res.status(500).json({
      error: "RESET_CAMPAIGN_FAILED",
      message: error?.message || "Unknown error",
    });
  }
});

tracks.get("/tracks/:trackId/campaign-history", async (req, res) => {
  try {
    const { trackId } = req.params;

    const history = await prisma.campaignHistory.findMany({
      where: {
        trackId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    return res.json({
      ok: true,
      history,
    });
  } catch (err: any) {
    console.error("CAMPAIGN HISTORY ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "Failed to load campaign history",
    });
  }
});

export default tracks;