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

    return res.json({
      ok: true,
      artist,
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