import { prisma } from "./db";

/**
 * Compute a simple fit score (0..100) based on playlist constraints vs track audio features.
 * This is intentionally "dumb but useful" and makes the product feel alive.
 */
function computeFitScore(playlist: any, audio: any): { score: number; explanation: string } {
  // Spotify audio-features keys typically include: tempo, energy, danceability, valence, etc.
  const tempo = typeof audio?.tempo === "number" ? audio.tempo : null;
  const energy = typeof audio?.energy === "number" ? audio.energy : null;

  let score = 60; // neutral baseline
  const reasons: string[] = [];

  // BPM checks
  if (tempo !== null) {
    const minBpm = playlist?.minBpm ?? null;
    const maxBpm = playlist?.maxBpm ?? null;

    if (minBpm !== null && tempo < minBpm) {
      score -= Math.min(30, Math.round((minBpm - tempo) * 0.8));
      reasons.push(`Tempo ${tempo.toFixed(0)} < minBpm ${minBpm}`);
    } else if (maxBpm !== null && tempo > maxBpm) {
      score -= Math.min(30, Math.round((tempo - maxBpm) * 0.8));
      reasons.push(`Tempo ${tempo.toFixed(0)} > maxBpm ${maxBpm}`);
    } else {
      reasons.push(`Tempo ${tempo.toFixed(0)} binnen range`);
      score += 10;
    }
  } else {
    reasons.push("Geen tempo data");
  }

  // Energy checks (0..1)
  if (energy !== null) {
    const minEnergy = playlist?.minEnergy ?? null;
    const maxEnergy = playlist?.maxEnergy ?? null;

    if (minEnergy !== null && energy < minEnergy) {
      score -= Math.min(25, Math.round((minEnergy - energy) * 80));
      reasons.push(`Energy ${energy.toFixed(2)} < minEnergy ${minEnergy}`);
    } else if (maxEnergy !== null && energy > maxEnergy) {
      score -= Math.min(25, Math.round((energy - maxEnergy) * 80));
      reasons.push(`Energy ${energy.toFixed(2)} > maxEnergy ${maxEnergy}`);
    } else {
      reasons.push(`Energy ${energy.toFixed(2)} binnen range`);
      score += 10;
    }
  } else {
    reasons.push("Geen energy data");
  }

  // clamp
  score = Math.max(0, Math.min(100, score));

  const explanation =
    score >= 80
      ? `Sterke match. ${reasons.join(" • ")}`
      : score >= 60
      ? `Redelijke match. ${reasons.join(" • ")}`
      : `Zwakke match. ${reasons.join(" • ")}`;

  return { score, explanation };
}

/**
 * Trigger matching after intake: create/upsert Match records for all playlists.
 */
export async function triggerMatchesForTrack(trackDbId: string) {
  const track = await prisma.track.findUnique({
    where: { id: trackDbId },
    select: {
      id: true,
      artistId: true,
      spotifyTrackId: true,
      audioFeatures: true,
    },
  });

  if (!track) return { ok: false, message: "Track not found" };

  // Fetch all playlists (later: filter by genre / curator preferences, etc.)
  const playlists = await prisma.playlist.findMany({
    select: {
      id: true,
      name: true,
      minBpm: true,
      maxBpm: true,
      minEnergy: true,
      maxEnergy: true,
    },
  });

  const audio = track.audioFeatures as any;

  const results = [];
  for (const pl of playlists) {
    const { score, explanation } = computeFitScore(pl, audio);

    // Upsert via unique constraint trackId+playlistId (you already have @@unique)
    const match = await prisma.match.upsert({
      where: {
        trackId_playlistId: {
          trackId: track.id,
          playlistId: pl.id,
        },
      },
      update: {
        fitScore: score,
        explanation,
      },
      create: {
        trackId: track.id,
        playlistId: pl.id,
        fitScore: score,
        explanation,
      },
    });

    results.push({ playlistId: pl.id, playlistName: pl.name, fitScore: score, matchId: match.id });
  }

  // sort highest first
  results.sort((a, b) => b.fitScore - a.fitScore);

  return { ok: true, trackId: track.id, createdOrUpdated: results.length, top: results.slice(0, 10) };
}
