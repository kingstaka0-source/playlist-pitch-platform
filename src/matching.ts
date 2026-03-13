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
  "opera",
  "classical",
];

function containsBannedWord(text: string) {
  const lower = text.toLowerCase();
  return BANNED_PLAYLIST_WORDS.some((word) => lower.includes(word));
}

function normalizeGenre(value: string) {
  return value.toLowerCase().trim();
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
    penalty += (playlist.minBpm - bpm) * 0.45;
  }
  if (playlist.maxBpm != null && bpm > playlist.maxBpm) {
    penalty += (bpm - playlist.maxBpm) * 0.45;
  }

  if (playlist.minEnergy != null && energy < playlist.minEnergy) {
    penalty += (playlist.minEnergy - energy) * 40;
  }
  if (playlist.maxEnergy != null && energy > playlist.maxEnergy) {
    penalty += (energy - playlist.maxEnergy) * 40;
  }

  return penalty;
}

function getSendableEmailState(playlist: any) {
  return (
    !!playlist?.curator?.email &&
    playlist.curator.contactMethod === "EMAIL" &&
    playlist.curator.consent === true
  );
}

function genericTitlePenalty(name: string) {
  const lower = name.toLowerCase().trim();

  if (!lower) return 8;
  if (lower === "reggae") return 10;
  if (lower === "hip hop") return 10;
  if (lower === "afrobeats") return 10;
  if (lower.split(/\s+/).length <= 1) return 7;

  return 0;
}

function specificityBonus(playlist: any) {
  let bonus = 0;

  const playlistGenres = getPlaylistGenres(playlist);
  const textGenres = inferGenresFromText(
    `${playlist?.name ?? ""} ${playlist?.rules ? JSON.stringify(playlist.rules) : ""}`
  );

  const mergedGenres = [...new Set([...playlistGenres, ...textGenres])];

  if (mergedGenres.length >= 2) bonus += 6;
  else if (mergedGenres.length === 1) bonus += 3;

  if (playlist.spotifyPlaylistId) bonus += 2;
  if (getSendableEmailState(playlist)) bonus += 5;

  return bonus;
}

function textMismatchPenalty(playlist: any) {
  const fullText = `${playlist?.name ?? ""} ${playlist?.rules ? JSON.stringify(playlist.rules) : ""}`.toLowerCase();

  if (containsBannedWord(fullText)) {
    return 50;
  }

  return 0;
}

function computeFinalScore(track: any, playlist: any, vec: TrackVector) {
  const centroid = buildPlaylistCentroid(playlist);
  const baseCosine = cosine(vec, centroid);

  let score = 28 + baseCosine * 42;

  score -= penaltyForRules(vec, playlist);
  score -= textMismatchPenalty(playlist);
  score -= genericTitlePenalty(String(playlist?.name ?? ""));
  score += specificityBonus(playlist);

  const nameText = String(playlist?.name ?? "").toLowerCase();
  if (nameText.includes("roots")) score += 2;
  if (nameText.includes("dub")) score += 2;
  if (nameText.includes("reggae")) score += 3;
  if (nameText.includes("dancehall")) score += 3;

  score = Math.round(score);
  score = Math.max(0, Math.min(99, score));

  return score;
}

type RankedMatch = {
  playlistId: string;
  score: number;
  explanation: string;
  sendable: boolean;
};

function compareRankedMatches(a: RankedMatch, b: RankedMatch) {
  // 1) sendable eerst
  if (a.sendable !== b.sendable) {
    return a.sendable ? -1 : 1;
  }

  // 2) dan score
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  // 3) stabiele fallback
  return a.playlistId.localeCompare(b.playlistId);
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

  const scored: RankedMatch[] = playlists.map((pl) => {
    const score = computeFinalScore(track, pl, vec);
    const canEmail = getSendableEmailState(pl);

    const explanationParts = [
      `Tempo ~${Math.round(vec[3] * 200)} BPM`,
      `Energy ~${vec[1].toFixed(2)}`,
      canEmail ? "Sendable by email" : "Not sendable by email",
    ];

    return {
      playlistId: pl.id,
      score,
      explanation: explanationParts.join(" • "),
      sendable: canEmail,
    };
  });

  const top = scored
    .filter((t) => t.score >= 40)
    .sort(compareRankedMatches)
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
        fitScore: m.fitScore ?? 0,
        genres: pl?.genres ?? [],
        sendable: canEmail,
      };
    })
    .sort((a, b) => {
      if (a.sendable !== b.sendable) {
        return a.sendable ? -1 : 1;
      }
      if (a.fitScore !== b.fitScore) {
        return b.fitScore - a.fitScore;
      }
      return a.playlistName.localeCompare(b.playlistName);
    })
    .slice(0, 10);

  return {
    ok: true,
    trackId,
    created: created.length,
    matchIds: created.map((m) => m.id),
    top,
  };
}