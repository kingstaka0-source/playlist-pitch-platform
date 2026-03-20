import { Router } from "express";
import prisma from "../lib/prisma";

// 🔥 FIXED IMPORT (BELANGRIJK)
import { generatePitch } from "../pitch/generatePitch";

import { buildPitchPrompt } from "../services/ai/buildPitchPrompt";
import { parseAiPitch } from "../services/ai/parseAiPitch";
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

    if (!match.pitch && usage.plan === "FREE" && !usage.allowed) {
      return res.status(403).json({
        error: "FREE_PLAN_LIMIT_REACHED",
        message: "Upgrade to PRO to generate more pitches.",
        usage: usage.month,
      });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: String(artistId) },
      select: { id: true, name: true },
    });

    const artistName = artist?.name || "Unknown Artist";
    const trackTitle = match.track?.title || "Untitled Track";
    const trackArtists = Array.isArray(match.track?.artists)
      ? match.track.artists
      : [];

    const playlistName = match.playlist?.name || "this playlist";
    const curatorName = match.playlist?.curator?.name || null;

    const playlistGenres = Array.isArray(match.playlist?.genres)
      ? match.playlist.genres
      : [];

    const spotifyTrackId = match.track?.spotifyTrackId;
    const spotifyUrl = spotifyTrackId
      ? `https://open.spotify.com/track/${spotifyTrackId}`
      : "";

    let subject = "";
    let body = "";

    // ======================
    // 🔥 TRY AI
    // ======================
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
        channel,
      });

      const aiRaw = await generateTextFromAi(prompt);
      const parsed = parseAiPitch(aiRaw);

      subject = parsed.subject;
      body = parsed.body;
    } catch (err) {
      // ======================
      // 🔥 FALLBACK (REGGAE STYLE)
      // ======================
      const fallback = generatePitch({
        curatorName,
        playlistName,
        trackTitle,
        artistName,
        genres: playlistGenres,
        tempo: (match.track as any)?.tempo,
      });

      subject = fallback.subject;
      body = fallback.body;
    }

    body = body || "";
    // ======================
    // 🔥 CLEANUP (SUPER IMPORTANT)
    // ======================
    body = body
      .replace(/I hope this message finds you well\.?/gi, "")
      .replace(/I wanted to share/gi, "Sending you")
      .replace(/I'?m reaching out to share/gi, "Sending you")
      .replace(/I believe (that )?/gi, "")
      .replace(/I think (that )?/gi, "")
      .replace(/I look forward to your thoughts\.?/gi, "")
      .replace(/Thank you for considering.*$/gi, "")
      .trim();

    // line breaks fix
    body = body
      .replace(/\.\s+/g, ".\n\n")
      .replace(/\n{3,}/g, "\n\n");

    // limit length
    if (body.length > 600) {
      body = body.slice(0, 600).trim() + "...";
    }

    
    // ======================
    // 🔥 ALWAYS ADD SPOTIFY LINK
    // ======================
    if (spotifyUrl) {
      body += `\n\nSpotify:\n${spotifyUrl}`;
    }

    // ======================
    // 💾 SAVE
    // ======================
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

    return res.json({ ok: true, pitch: savedPitch });
  } catch (error) {
    console.error("AI generate-and-save-pitch error:", error);
    return res.status(500).json({
      error: "Failed to generate and save pitch",
    });
  }
});

export default router;