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

    if (!track.spotifyTrackId) {
      return res.status(400).json({
        error: "TRACK_HAS_NO_SPOTIFY_ID",
        message: "This track has no spotifyTrackId, so placement detection cannot run.",
      });
    }

    const token = await getSpotifyAppAccessToken();

    const results: any[] = [];

    let checked = 0;
    let skippedNoPlaylistId = 0;
    let errors = 0;
    let placementsFound = 0;

    for (const match of track.matches) {
      const spotifyPlaylistId = match.playlist.spotifyPlaylistId;

      if (!spotifyPlaylistId) {
        skippedNoPlaylistId += 1;

        results.push({
          playlist: match.playlist.name,
          spotifyPlaylistId: null,
          detected: false,
          skipped: true,
          reason: "NO_SPOTIFY_PLAYLIST_ID",
        });

        continue;
      }

      checked += 1;

      const url = `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks?limit=100`;

      try {
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!r.ok) {
          errors += 1;

          results.push({
            playlist: match.playlist.name,
            spotifyPlaylistId,
            detected: false,
            error: `SPOTIFY_HTTP_${r.status}`,
          });

          continue;
        }

        const json: any = await r.json();

        const found = (json.items || []).some((item: any) => {
          const spTrackId = item?.track?.id;
          return spTrackId === track.spotifyTrackId;
        });

        if (found) {
          placementsFound += 1;

          if (match.pitch) {
            await prisma.pitch.update({
              where: { id: match.pitch.id },
              data: {
                playlistDetected: true,
                playlistedAt: new Date(),
              },
            });
          }
        }

        results.push({
          playlist: match.playlist.name,
          spotifyPlaylistId,
          detected: found,
          pitchUpdated: found && !!match.pitch,
        });
      } catch (error: any) {
        errors += 1;

        results.push({
          playlist: match.playlist.name,
          spotifyPlaylistId,
          detected: false,
          error: error?.message ?? String(error),
        });
      }
    }

    return res.json({
      ok: true,
      track: {
        id: track.id,
        title: track.title,
        spotifyTrackId: track.spotifyTrackId,
      },
      summary: {
        matches: track.matches.length,
        checked,
        skippedNoPlaylistId,
        errors,
        placementsFound,
      },
      results,
    });
  } catch (err: any) {
    console.error("PLAYLIST_DETECTION_ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "playlist detection failed",
      details: err?.message ?? String(err),
    });
  }
});