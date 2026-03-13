import { prisma } from "./db";
import type { TrackVector } from "./types";

function cosine(a: number[], b: number[]) {
  const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

const BANNED_PLAYLIST_WORDS = [
  "bdsm",
  "submissive",
  "freaky",
  "sex",
  "hardcore",
  "techno",
  "house",
  "classical",
  "opera",
];

function containsBannedWord(text: string) {
  const lower = text.toLowerCase();
  return BANNED_PLAYLIST_WORDS.some((word) => lower.includes(word));
}

function normalizeGenre(value: string) {
  return value.toLowerCase().trim();
}

function getTrackGenres(track: any): string[] {
  const genres = Array.isArray(track?.genres) ? track.genres : [];
  return genres.map((g: unknown) => normalizeGenre(String(g))).filter(Boolean);
}

function getPlaylistGenres(playlist: any): string[] {
  const genres = Array.isArray(playlist?.genres) ? playlist.genres : [];
  return genres.map((g: unknown) => normalizeGenre(String(g))).filter(Boolean);
}

function inferGenresFromText(text: string): string[] {
  const lower = text.toLowerCase();

  const found: string[] = [];

  const rules: Array<[string, string]> = [
    ["reggae", "reggae"],
    ["roots", "roots"],
    ["dub", "dub"],
    ["dancehall", "dancehall"],
    ["afrobeat", "afrobeat"],
    ["afrobeats", "afrobeats"],
    ["afro", "afro"],
    ["hip hop", "hiphop"],
    ["hiphop", "hiphop"],
    ["rap", "rap"],
    ["boom bap", "boom-bap"],
    ["lofi", "lofi"],
    ["neo soul", "neo-soul"],
    ["soul", "soul"],
    ["rnb", "rnb"],
    ["indie", "indie"],
    ["chill", "chill"],
  ];

  for (const [needle, tag] of rules) {
    if (lower.includes(needle)) found.push(tag);
  }

  return [...new Set(found)];
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

  if (playlist.minBpm != null && bpm < playlist.minBpm) {
    penalty += (playlist.minBpm - bpm) * 0.6;
  }
  if (playlist.maxBpm != null && bpm > playlist.maxBpm) {
    penalty += (bpm - playlist.maxBpm) * 0.6;
  }

  if (playlist.minEnergy != null && energy < playlist.minEnergy) {
    penalty += (playlist.minEnergy - energy) * 55;
  }
  if (playlist.maxEnergy != null && energy > playlist.maxEnergy) {
    penalty += (energy - playlist.maxEnergy) * 55;
  }

  return penalty;
}

function buildTrackVector(track: any): TrackVector {
  const f = (track.audioFeatures ?? {}) as any;

  return [
    f.danceability ?? 0.5,
    f.energy ?? 0.5,
    f.valence ?? 0.5,
    (f.tempo ?? 120) / 200,
    ((f.loudness ?? -10) + 60) / 60,
    f.mode ?? 1,
  ];
}

function buildPlaylistCentroid(pl: any): TrackVector {
  return [
    0.5,
    pl.minEnergy ?? 0.6,
    0.5,
    (((pl.minBpm ?? 110) + (pl.maxBpm ?? 140)) / 2) / 200,
    0.5,
    1,
  ];
}

function computeGenreBonus(track: any, playlist: any) {
  const trackGenres = getTrackGenres(track);

  const textGenres = inferGenresFromText(
    `${playlist?.name ?? ""} ${playlist?.rules ? JSON.stringify(playlist.rules) : ""}`
  );

  const playlistGenres = [...new Set([...getPlaylistGenres(playlist), ...textGenres])];

  if (trackGenres.length === 0 || playlistGenres.length === 0) {
    return {
      bonus: 0,
      overlap: [] as string[],
      playlistGenres,
      trackGenres,
    };
  }

  const overlap = trackGenres.filter((g) => playlistGenres.includes(g));

  let bonus = 0;

  if (overlap.length > 0) {
    bonus += Math.min(30, overlap.length * 12);
  }

  return {
    bonus,
    overlap,
    playlistGenres,
    trackGenres,
  };
}

function computeTextPenalty(track: any, playlist: any) {
  const playlistName = String(playlist?.name ?? "");
  const rulesText = playlist?.rules ? JSON.stringify(playlist.rules) : "";
  const fullText = `${playlistName} ${rulesText}`.toLowerCase();

  if (containsBannedWord(fullText)) {
    return 60;
  }

  const trackGenres = getTrackGenres(track);

  // zachte penalty voor duidelijke mismatch buckets
  if (
    trackGenres.includes("reggae") &&
    (fullText.includes("techno") || fullText.includes("house") || fullText.includes("classical"))
  ) {
    return 35;
  }

  if (
    trackGenres.includes("hiphop") &&
    (fullText.includes("opera") || fullText.includes("classical"))
  ) {
    return 35;
  }

  return 0;
}

export async function computeMatches(trackId: string) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
  });

  if (!track) throw new Error("Track not found");

  const vec = buildTrackVector(track);

  const playlists = await prisma.playlist.findMany({
    include: {
      curator: true,
    },
  });

  console.log(
    "computeMatches: playlists=",
    playlists.length,
    "tempo=",
    Math.round(vec[3] * 200),
    "energy=",
    vec[1]
  );

  const scored = playlists.map((pl) => {
    const centroid = buildPlaylistCentroid(pl);

    const baseCosine = cosine(vec, centroid);
    const baseScore = Math.round(baseCosine * 100);

    const rulesPenalty = penaltyForRules(vec, pl);
    const textPenalty = computeTextPenalty(track, pl);

    const genreInfo = computeGenreBonus(track, pl);

    let score = baseScore + genreInfo.bonus - rulesPenalty - textPenalty;

    // kleine bonus als playlist genres heeft
    if (Array.isArray(pl.genres) && pl.genres.length > 0) {
      score += 4;
    }

    // kleine bonus als spotifyPlaylistId aanwezig is
    if (pl.spotifyPlaylistId) {
      score += 2;
    }

    score = Math.round(score);
    score = Math.max(0, Math.min(100, score));

    const canEmail =
      !!pl.curator?.email &&
      pl.curator?.contactMethod === "EMAIL" &&
      pl.curator?.consent === true;

    const explanationParts = [
      `Tempo ~${Math.round(vec[3] * 200)} BPM`,
      `Energy ~${vec[1].toFixed(2)}`,
      genreInfo.overlap.length > 0
        ? `Genre overlap: ${genreInfo.overlap.join(", ")}`
        : "Genre overlap: none",
      canEmail ? "Sendable by email" : "Not sendable by email",
    ];

    if (textPenalty >= 35) {
      explanationParts.push("Penalty: playlist text mismatch");
    }

    return {
      playlistId: pl.id,
      score,
      explanation: explanationParts.join(" • "),
    };
  });

  // ✅ Alleen bruikbare matches bewaren
  const top = scored
    .filter((t) => t.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

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
    select: {
      id: true,
      name: true,
      genres: true,
      curator: {
        select: {
          email: true,
          contactMethod: true,
          consent: true,
        },
      },
    },
  });

  const playlistById = new Map(playlists.map((p) => [p.id, p]));

  const top = created
    .slice()
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
    .slice(0, 10)
    .map((m) => {
      const pl = playlistById.get(m.playlistId);

      const canEmail =
        !!pl?.curator?.email &&
        pl.curator.contactMethod === "EMAIL" &&
        pl.curator.consent === true;

      return {
        matchId: m.id,
        playlistId: m.playlistId,
        playlistName: pl?.name ?? m.playlistId,
        fitScore: m.fitScore,
        genres: pl?.genres ?? [],
        sendable: canEmail,
      };
    });

  return {
    ok: true,
    trackId,
    created: created.length,
    matchIds: created.map((m) => m.id),
    top,
  };
}