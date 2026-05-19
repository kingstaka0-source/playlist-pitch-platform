import { Router } from "express";
import { prisma } from "../db";
import { getSpotifyAppAccessToken } from "../spotifyAppClient";

export const detection = Router();

detection.post("/detect-playlists/:trackId", async (req, res) => {
  try {
    const trackId = String(req.params.trackId);

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        matches: {
          include: {
            playlist: true,
            pitch: true,
          },
        },
      },
    });

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }

    const token = await getSpotifyAppAccessToken();

    const results: any[] = [];

    for (const match of track.matches) {
      const spotifyPlaylistId = match.playlist.spotifyPlaylistId;

      if (!spotifyPlaylistId) continue;

      const url = `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks?limit=100`;

      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!r.ok) continue;

      const json: any = await r.json();

      const found = (json.items || []).some((item: any) => {
        const spTrackId = item?.track?.id;
        return spTrackId === track.spotifyTrackId;
      });

      if (found && match.pitch) {
        await prisma.$executeRawUnsafe(
  `UPDATE "Pitch"
   SET "playlistDetected" = true,
       "playlistedAt" = NOW()
   WHERE "id" = $1`,
  match.pitch.id
);
      }

      results.push({
        playlist: match.playlist.name,
        detected: found,
      });
    }

    return res.json({
      ok: true,
      track: track.title,
      results,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      error: "playlist detection failed",
      details: err?.message ?? String(err),
    });
  }
});