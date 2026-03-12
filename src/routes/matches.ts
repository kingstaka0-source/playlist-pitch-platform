import { Router } from "express";
import { prisma } from "../db";
import { computeMatches } from "../matching";

export const matches = Router();

matches.post("/matches/run", async (req, res) => {
  try {
    const { trackId } = req.body ?? {};
    if (!trackId) {
      return res.status(400).json({ error: "trackId required" });
    }

    const created = await computeMatches(trackId);
    return res.json({ ok: true, count: created.length, matches: created });
  } catch (err: any) {
    console.error("MATCH RUN ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "match run failed",
      details: err?.message ?? String(err),
    });
  }
});

matches.get("/matches", async (req, res) => {
  try {
    const trackId = String(req.query.trackId || "");
    if (!trackId) {
      return res.status(400).json({ error: "trackId query param required" });
    }

    const list = await prisma.match.findMany({
      where: { trackId },
      include: {
        playlist: {
          include: {
            curator: true,
          },
        },
      },
      orderBy: { fitScore: "desc" },
    });

    const results = list.map((m) => {
      const curator = m.playlist?.curator;

      const canEmail =
        !!curator?.email &&
        curator.contactMethod === "EMAIL" &&
        curator.consent === true;

      return {
        id: m.id,
        trackId: m.trackId,
        playlistId: m.playlistId,
        fitScore: m.fitScore,
        explanation: m.explanation,
        createdAt: m.createdAt,

        playlist: m.playlist
          ? {
              id: m.playlist.id,
              name: m.playlist.name,
              spotifyPlaylistId: m.playlist.spotifyPlaylistId,
              genres: m.playlist.genres,
              curator: curator
                ? {
                    id: curator.id,
                    name: curator.name,
                    email: curator.email,
                    contactMethod: curator.contactMethod,
                    consent: curator.consent,
                    languages: curator.languages,
                    canEmail,
                  }
                : null,
            }
          : null,
      };
    });

    return res.json(results);
  } catch (err: any) {
    console.error("MATCH LIST ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "match list failed",
      details: err?.message ?? String(err),
    });
  }
});