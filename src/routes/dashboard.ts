// src/routes/dashboard.ts
import { Router } from "express";
import { prisma } from "../db";

export const dashboard = Router();

// Houd dit gelijk aan legal.ts
const CURRENT = {
  TERMS: "2026-02-16",
  PRIVACY: "2026-02-16",
  BILLING_TERMS: "2026-02-16",
} as const;

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * GET /dashboard/stats
 * Shape afgestemd op frontend app/page.tsx
 */
dashboard.get("/dashboard/stats", async (req, res) => {
  try {
    const artistId =
      String(req.header("x-artist-id") || req.query.artistId || "").trim();

    if (!artistId) {
      return res.status(400).json({ error: "Missing artistId" });
    }

    const monthStart = startOfMonth();

    const [totalMatches, monthlyMatches, sentPitchesAll, sentPitchesMonth] =
      await Promise.all([
        prisma.match.count({
          where: {
            track: {
              artistId,
            },
          },
        }),
        prisma.match.count({
          where: {
            track: {
              artistId,
            },
            createdAt: {
              gte: monthStart,
            },
          },
        }),
        prisma.pitch.count({
          where: {
            match: {
              track: {
                artistId,
              },
            },
            status: "SENT" as any,
          },
        }),
        prisma.pitch.count({
          where: {
            match: {
              track: {
                artistId,
              },
            },
            status: "SENT" as any,
            createdAt: {
              gte: monthStart,
            },
          },
        }),
      ]);

    const successRate =
      totalMatches > 0 ? sentPitchesAll / totalMatches : 0;

    return res.json({
      artistId,
      month: {
        sentThisMonth: sentPitchesMonth,
        matchesThisMonth: monthlyMatches,
      },
      totals: {
        totalMatches,
        totalPitchesSent: sentPitchesAll,
      },
      successRate,
    });
  } catch (err: any) {
    console.error("DASHBOARD STATS ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "dashboard stats failed",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * GET /dashboard/artist/:artistId/overview
 * Geeft:
 * - artist plan/trial
 * - legal status (accepted vs required)
 * - last 10 tracks + match counts + top matches
 */
dashboard.get("/dashboard/artist/:artistId/overview", async (req, res) => {
  try {
    const artistId = String(req.params.artistId || "");
    if (!artistId) {
      return res.status(400).json({ error: "Missing artistId" });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        trialUntil: true,
        createdAt: true,
      },
    });

    if (!artist) {
      return res.status(404).json({ error: "Artist not found" });
    }

    const legalRows = await prisma.agreementAcceptance.findMany({
      where: {
        subjectType: "ARTIST" as any,
        subjectId: artistId,
      },
      select: {
        docType: true,
        version: true,
        acceptedAt: true,
      },
    });

    const accepted = legalRows.reduce((acc: any, row) => {
      acc[row.docType] = {
        version: row.version,
        acceptedAt: row.acceptedAt,
      };
      return acc;
    }, {});

    const required = {
      TERMS: CURRENT.TERMS,
      PRIVACY: CURRENT.PRIVACY,
      BILLING_TERMS: CURRENT.BILLING_TERMS,
    };

    const missing = Object.entries(required)
      .filter(([doc, ver]) => accepted?.[doc]?.version !== ver)
      .map(([doc]) => doc);

    const tracks = await prisma.track.findMany({
      where: { artistId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        spotifyTrackId: true,
        title: true,
        artists: true,
        durationMs: true,
        createdAt: true,
      },
    });

    const tracksWithMatches = await Promise.all(
      tracks.map(async (t) => {
        const [matchCount, topMatches] = await Promise.all([
          prisma.match.count({
            where: {
              trackId: t.id,
            },
          }),
          prisma.match.findMany({
            where: {
              trackId: t.id,
            },
            orderBy: { fitScore: "desc" },
            take: 5,
            select: {
              id: true,
              fitScore: true,
              explanation: true,
              playlist: {
                select: {
                  id: true,
                  name: true,
                },
              },
              createdAt: true,
            },
          }),
        ]);

        return {
          ...t,
          matchCount,
          topMatches,
        };
      })
    );

        const allPitches = await prisma.pitch.findMany({
      where: {
        match: {
          track: {
            artistId,
          },
        },
      },
      select: {
  id: true,
  status: true,
  sentTo: true,
  playlistDetected: true,
  createdAt: true,

  openCount: true,
  clickCount: true,
  replyCount: true,

  positiveReply: true,
  negativeReply: true,
        match: {
          select: {
            track: {
              select: {
                id: true,
                title: true,
                artists: true,
              },
            },
            playlist: {
              select: {
                id: true,
                name: true,
                genres: true,
              },
            },
          },
        },
      },
    });

    const rawTotalCampaigns = await prisma.campaignHistory.count({
  where: {
    trackId: {
      in: tracks.map((t) => t.id),
    },
  },
});

const rawDraftCount = allPitches.filter((p) => p.status === "DRAFT").length;
const rawQueuedCount = allPitches.filter((p) => p.status === "QUEUED").length;
const rawSentCount = allPitches.filter((p) => p.status === "SENT").length;

const isDemoArtist = artistId === "demo_tunereach_artist";

const totalCampaigns = isDemoArtist ? 12 : rawTotalCampaigns;
const draftCount = isDemoArtist ? 4 : rawDraftCount;
const queuedCount = isDemoArtist ? 2 : rawQueuedCount;
const sentCount = isDemoArtist ? 12 : rawSentCount;

    const totalSentPitches = sentCount;
    const totalPlacements = allPitches.filter((p) => p.playlistDetected).length;

    const placementRate =
      totalSentPitches > 0
        ? Math.round((totalPlacements / totalSentPitches) * 100)
        : 0;

    const totalOpens = allPitches.reduce(
  (sum: number, p: any) => sum + (p.openCount || 0),
  0
);

const totalClicks = allPitches.reduce(
  (sum: number, p: any) => sum + (p.clickCount || 0),
  0
);

const totalReplies = allPitches.reduce(
  (sum: number, p: any) => sum + (p.replyCount || 0),
  0
);

const interestedCurators = allPitches.filter(
  (p: any) => p.positiveReply === true
).length;

const negativeReplies = allPitches.filter(
  (p: any) => p.negativeReply === true
).length;

const openRate =
  totalSentPitches > 0
    ? Math.round((totalOpens / totalSentPitches) * 100)
    : 0;

const clickRate =
  totalSentPitches > 0
    ? Math.round((totalClicks / totalSentPitches) * 100)
    : 0;

const replyRate =
  totalSentPitches > 0
    ? Math.round((totalReplies / totalSentPitches) * 100)
    : 0;

    const trackPitchMap = new Map<
      string,
      {
        trackId: string;
        title: string;
        artists: string[];
        pitchCount: number;
        sentCount: number;
        placementCount: number;
      }
    >();

    const categoryMap = new Map<
      string,
      {
        category: string;
        pitchCount: number;
        sentCount: number;
        placementCount: number;
      }
    >();

    const curatorSourceMap = new Map<
      string,
      {
        source: string;
        pitchCount: number;
        sentCount: number;
        placementCount: number;
      }
    >();

    for (const pitch of allPitches) {
      const track = pitch.match?.track;
      const playlist = pitch.match?.playlist;

      if (track) {
        const current = trackPitchMap.get(track.id) ?? {
          trackId: track.id,
          title: track.title,
          artists: track.artists ?? [],
          pitchCount: 0,
          sentCount: 0,
          placementCount: 0,
        };

        current.pitchCount += 1;
        if (pitch.status === "SENT") current.sentCount += 1;
        if (pitch.playlistDetected) current.placementCount += 1;

        trackPitchMap.set(track.id, current);
      }

      const genres = playlist?.genres?.length ? playlist.genres : ["Unknown"];

      for (const genre of genres) {
        const key = String(genre || "Unknown").trim() || "Unknown";

        const current = categoryMap.get(key) ?? {
          category: key,
          pitchCount: 0,
          sentCount: 0,
          placementCount: 0,
        };

        current.pitchCount += 1;
        if (pitch.status === "SENT") current.sentCount += 1;
        if (pitch.playlistDetected) current.placementCount += 1;

        categoryMap.set(key, current);
      }

      const source = pitch.sentTo?.trim() || "No recipient";

      const currentSource = curatorSourceMap.get(source) ?? {
        source,
        pitchCount: 0,
        sentCount: 0,
        placementCount: 0,
      };

      currentSource.pitchCount += 1;
      if (pitch.status === "SENT") currentSource.sentCount += 1;
      if (pitch.playlistDetected) currentSource.placementCount += 1;

      curatorSourceMap.set(source, currentSource);
    }

    const mostPitchedTrack =
      [...trackPitchMap.values()].sort((a, b) => b.pitchCount - a.pitchCount)[0] ??
      null;

    const topPerformingTrack =
      [...trackPitchMap.values()].sort((a, b) => {
        if (b.placementCount !== a.placementCount) {
          return b.placementCount - a.placementCount;
        }

        return b.sentCount - a.sentCount;
      })[0] ?? null;

    const bestPlaylistCategory =
      [...categoryMap.values()].sort((a, b) => {
        if (b.placementCount !== a.placementCount) {
          return b.placementCount - a.placementCount;
        }

        return b.sentCount - a.sentCount;
      })[0] ?? null;

    const topCuratorSources = [...curatorSourceMap.values()]
      .sort((a, b) => b.sentCount - a.sentCount)
      .slice(0, 5);

    const conversionFunnel = isDemoArtist
  ? {
      drafts: 4,
      queued: 2,
      sent: 12,
      placements: totalPlacements,
      draftToQueuedRate: 50,
      queuedToSentRate: 100,
      sentToPlacementRate:
        sentCount > 0 ? Math.round((totalPlacements / sentCount) * 100) : 0,
    }
  : {
      drafts: draftCount,
      queued: queuedCount,
      sent: sentCount,
      placements: totalPlacements,
      draftToQueuedRate:
        draftCount > 0 ? Math.round((queuedCount / draftCount) * 100) : 0,
      queuedToSentRate:
        queuedCount > 0 ? Math.round((sentCount / queuedCount) * 100) : 0,
      sentToPlacementRate:
        sentCount > 0 ? Math.round((totalPlacements / sentCount) * 100) : 0,
    };

    return res.json({
      ok: true,
      artist, 

      analytics: {
  totalCampaigns,
  totalSentPitches,
  totalPlacements,

  placementRate,
  replyRate,
  openRate,
  clickRate,
 
  totalOpens,
  totalClicks,
  totalReplies,

  interestedCurators,
  negativeReplies,

  draftCount,
  queuedCount,
  sentCount,

  topPerformingTrack,
  mostPitchedTrack,
  bestPlaylistCategory,
  topCuratorSources,
  conversionFunnel,
},

      legal: {
        accepted,
        required,
        missing,
        allAccepted: missing.length === 0,
      },

      tracks: tracksWithMatches,
    });
  } catch (err: any) {
    console.error("DASHBOARD OVERVIEW ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "dashboard overview failed",
      details: err?.message ?? String(err),
    });
  }
});