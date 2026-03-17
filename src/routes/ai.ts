import { Router } from "express";
import prisma from "../lib/prisma";
import { buildPitchPrompt } from "../services/ai/buildPitchPrompt";
import { parseAiPitch } from "../services/ai/parseAiPitch";
import { buildFallbackPitch } from "../services/ai/buildFallbackPitch";
import { generateTextFromAi } from "../services/ai/generateTextFromAi";
import { getArtistUsage } from "./artists";

const router = Router();

router.post("/generate-and-save-pitch", async (req, res) => {
  try {
    const { matchId, channel = "EMAIL" } = req.body;
    const artistId = req.header("x-artist-id");

    if (!artistId) {
      return res.status(400).json({ error: "Missing x-artist-id header" });
    }

    if (!matchId) {
      return res.status(400).json({ error: "matchId is required" });
    }

    const match = await prisma.match.findFirst({
      where: {
        id: matchId,
        track: {
          artistId: String(artistId),
        },
      },
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
      return res.status(404).json({ error: "Match not found" });
    }

    const usage = await getArtistUsage(String(artistId));
    if (!usage) {
      return res.status(404).json({ error: "Artist not found" });
    }

    // FREE mag geen nieuwe pitch meer maken als limiet op is
    if (!match.pitch && usage.plan === "FREE" && !usage.allowed) {
      return res.status(403).json({
        error: "FREE_PLAN_LIMIT_REACHED",
        message: "Upgrade to PRO to generate more pitches.",
        usage: usage.month,
      });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: String(artistId) },
      select: {
        id: true,
        name: true,
      },
    });

    const artistName = artist?.name || "Unknown Artist";
const trackTitle = match.track?.title || "Untitled Track";
const trackSpotifyUrl = match.track?.spotifyTrackId
  ? `https://open.spotify.com/track/${match.track.spotifyTrackId}`
  : "";
    const trackArtists = Array.isArray(match.track?.artists)
      ? match.track.artists
      : [];
    const playlistName = match.playlist?.name || "this playlist";
    const curatorName = match.playlist?.curator?.name || null;

    const playlistGenres = Array.isArray(match.playlist?.genres)
      ? match.playlist.genres
      : [];

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
      channel,
    });

    let subject = "";
let body = "";

try {
  const aiRawResponse = await generateTextFromAi(prompt);
  const parsed = parseAiPitch(aiRawResponse);
  subject = parsed.subject;
  body = parsed.body;
} catch (aiError) {
  const fallback = buildFallbackPitch({
    artistName,
    trackTitle,
    curatorName,
    playlistName,
    playlistGenres,
    playlistDescription: (match.playlist as any)?.description || null,
  });

  subject = fallback.subject;
  body = fallback.body;
}

if (trackSpotifyUrl) {
  const lowerBody = body.toLowerCase();

  if (!lowerBody.includes("open.spotify.com/track/")) {
    body = `${body.trim()}

Spotify link:
${trackSpotifyUrl}`;
  }
}

    let savedPitch;

    if (match.pitch) {
      savedPitch = await prisma.pitch.update({
        where: { id: match.pitch.id },
        data: {
          subject,
          body,
          channel,
          status: "DRAFT",
        },
      });
    } else {
      savedPitch = await prisma.pitch.create({
        data: {
          matchId: match.id,
          subject,
          body,
          status: "DRAFT",
          channel,
          sentTo: match.playlist?.curator?.email || null,
        },
      });
    }

    return res.json({
      ok: true,
      pitch: savedPitch,
    });
  } catch (error) {
    console.error("AI generate-and-save-pitch error:", error);
    return res.status(500).json({
      error: "Failed to generate and save pitch",
    });
  }
});

export default router;