import { prisma } from "./db";
import type { TrackVector } from "./types";

function cosine(a: number[], b: number[]) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  // avoid NaN if vector is zero
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

// ✅ Soft penalty in plaats van harde blokkade
function penaltyForRules(
  vector: TrackVector,
  playlist: {
    minBpm?: number | null;
    maxBpm?: number | null;
    minEnergy?: number | null;
    maxEnergy?: number | null;
  }
) {
  const bpm = vector[3] * 200;
  const energy = vector[1];

  let penalty = 0;

  if (playlist.minBpm != null && bpm < playlist.minBpm) penalty += (playlist.minBpm - bpm) * 0.7;
  if (playlist.maxBpm != null && bpm > playlist.maxBpm) penalty += (bpm - playlist.maxBpm) * 0.7;

  if (playlist.minEnergy != null && energy < playlist.minEnergy) penalty += (playlist.minEnergy - energy) * 60;
  if (playlist.maxEnergy != null && energy > playlist.maxEnergy) penalty += (energy - playlist.maxEnergy) * 60;

  return penalty;
}

export async function computeMatches(trackId: string) {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) throw new Error("Track not found");

  const f = (track.audioFeatures ?? {}) as any;

  const vec: TrackVector = [
    f.danceability ?? 0.5,
    f.energy ?? 0.5,
    f.valence ?? 0.5,
    (f.tempo ?? 120) / 200,
    ((f.loudness ?? -10) + 60) / 60,
    f.mode ?? 1,
  ];

  const playlists = await prisma.playlist.findMany();

  // ✅ Debug (tijdelijk): om te zien of playlists bestaan en welke defaults gebruikt worden
  console.log("computeMatches: playlists=", playlists.length, "tempo=", Math.round(vec[3] * 200), "energy=", vec[1]);

  const scored = playlists.map((pl) => {
    const centroid: TrackVector = [
      0.5,
      pl.minEnergy ?? 0.6,
      0.5,
      (((pl.minBpm ?? 110) + (pl.maxBpm ?? 140)) / 2) / 200,
      0.5,
      1,
    ];

    const base = cosine(vec, centroid); // 0..1-ish
    const penalty = penaltyForRules(vec, pl);

    let score = Math.round(base * 100 - penalty);
    score = Math.max(0, Math.min(100, score)); // clamp 0..100

    return {
      playlistId: pl.id,
      score,
      explanation: `Tempo ~${Math.round(vec[3] * 200)} BPM • Energy ~${vec[1].toFixed(2)}`,
    };
  });

  // ✅ GEEN filter op score > 0, altijd ranking
  const top = scored.sort((a, b) => b.score - a.score).slice(0, 50);

  const created = await Promise.all(
    top.map((t) =>
      prisma.match.upsert({
        where: { trackId_playlistId: { trackId, playlistId: t.playlistId } },
        update: { fitScore: t.score, explanation: t.explanation },
        create: {
          trackId,
          playlistId: t.playlistId,
          fitScore: t.score,
          explanation: t.explanation,
        },
      })
    )
  );

  return created;
}

// ================================
// Wrapper voor worker: geeft top + playlist names terug
// ================================
export async function triggerMatchesForTrack(trackId: string) {
  const created = await computeMatches(trackId);

  const playlistIds = [...new Set(created.map((m) => m.playlistId))];

  const playlists = await prisma.playlist.findMany({
    where: { id: { in: playlistIds } },
    select: { id: true, name: true },
  });

  const nameById = new Map(playlists.map((p) => [p.id, p.name]));

  const top = created
    .slice()
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
    .slice(0, 10)
    .map((m) => ({
      matchId: m.id,
      playlistId: m.playlistId,
      playlistName: nameById.get(m.playlistId) ?? m.playlistId,
      fitScore: m.fitScore,
    }));

  return {
    ok: true,
    trackId,
    created: created.length,
    matchIds: created.map((m) => m.id),
    top,
  };
}