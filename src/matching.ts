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

const GENERIC_PLAYLIST_PATTERNS = [
  "new music friday",
  "eclectic vibes",
  "greatest mix",
  "greatest hits",
  "top hits",
  "top songs",
  "all genres",
  "mixed genres",
  "best hits",
  "party mix",
  "viral hits",
  "trending hits",
  "music mix",
  "big hits",
];

function containsBannedWord(text: string) {
  const lower = text.toLowerCase();
  return BANNED_PLAYLIST_WORDS.some((word) => lower.includes(word));
}

function normalizeGenre(value: string) {
  return value.toLowerCase().trim();
}

function uniqStrings(values: string[]) {
  return [...new Set(values.map((v) => normalizeGenre(v)).filter(Boolean))];
}

function getPlaylistGenres(playlist: any): string[] {
  const genres = Array.isArray(playlist?.genres) ? playlist.genres : [];
  return genres.map((g: unknown) => normalizeGenre(String(g))).filter(Boolean);
}

function getTrackGenres(track: any): string[] {
  const genres = Array.isArray(track?.genres) ? track.genres : [];
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
    ["afropop", "afropop"],
    ["afro", "afro"],
    ["amapiano", "amapiano"],
    ["naija", "afro"],

    ["hip hop", "hiphop"],
    ["hiphop", "hiphop"],
    ["rap", "rap"],
    ["boom bap", "boom-bap"],
    ["trap", "trap"],
    ["drill", "drill"],
    ["lofi", "lofi"],

    ["neo soul", "neo-soul"],
    ["soul", "soul"],
    ["rnb", "rnb"],
    ["r&b", "rnb"],

    ["indie", "indie"],
    ["indie pop", "indie-pop"],
    ["pop", "pop"],
    ["rock", "rock"],
    ["alternative", "alternative"],

    ["chill", "chill"],
    ["edm", "edm"],
    ["electronic", "electronic"],
    ["techno", "techno"],
    ["house", "house"],
  ];

  for (const [needle, tag] of rules) {
    if (lower.includes(needle)) found.push(tag);
  }

  return uniqStrings(found);
}

function getTrackGenreProfile(track: any): string[] {
  const direct = getTrackGenres(track);
  const text = inferGenresFromText(
    `${track?.title ?? ""} ${(track?.artists ?? []).join(" ")}`
  );

  return uniqStrings([...direct, ...text]);
}

function getPlaylistGenreProfile(playlist: any): string[] {
  const direct = getPlaylistGenres(playlist);
  const text = inferGenresFromText(
    `${playlist?.name ?? ""} ${playlist?.description ?? ""} ${
      playlist?.rules ? JSON.stringify(playlist.rules) : ""
    }`
  );

  return uniqStrings([...direct, ...text]);
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
    playlist?.curator?.contactMethod === "EMAIL" &&
    playlist?.curator?.consent === true
  );
}

function genericTitlePenalty(name: string) {
  const lower = name.toLowerCase().trim();

  if (!lower) return 8;
  if (lower.split(/\s+/).length <= 1) return 7;

  if (
    GENERIC_PLAYLIST_PATTERNS.some((pattern) => lower.includes(pattern))
  ) {
    return 10;
  }

  if (
    lower === "hits" ||
    lower === "vibes" ||
    lower === "mix" ||
    lower === "playlist"
  ) {
    return 9;
  }

  return 0;
}

function specificityBonus(playlist: any) {
  let bonus = 0;

  const mergedGenres = getPlaylistGenreProfile(playlist);

  if (mergedGenres.length >= 3) bonus += 7;
  else if (mergedGenres.length === 2) bonus += 5;
  else if (mergedGenres.length === 1) bonus += 2;

  if (playlist.spotifyPlaylistId) bonus += 2;
  if (playlist.description) bonus += 2;

  return bonus;
}

function textMismatchPenalty(playlist: any) {
  const fullText =
    `${playlist?.name ?? ""} ${playlist?.description ?? ""} ${
      playlist?.rules ? JSON.stringify(playlist.rules) : ""
    }`.toLowerCase();

  if (containsBannedWord(fullText)) {
    return 50;
  }

  return 0;
}

function genreAffinityScore(track: any, playlist: any) {
  const trackGenres = getTrackGenreProfile(track);
  const playlistGenres = getPlaylistGenreProfile(playlist);

  if (!trackGenres.length && !playlistGenres.length) {
    return 0;
  }

  if (trackGenres.length && !playlistGenres.length) {
    return -4;
  }

  const trackSet = new Set(trackGenres);
  const playlistSet = new Set(playlistGenres);

  const overlap = [...trackSet].filter((g) => playlistSet.has(g));
  const overlapCount = overlap.length;

  let score = 0;

  if (overlapCount >= 3) score += 18;
  else if (overlapCount === 2) score += 12;
  else if (overlapCount === 1) score += 7;

  const majorTrackGenres = trackGenres.slice(0, 3);

  const strongMismatchGenres = playlistGenres.filter(
    (g) =>
      !trackSet.has(g) &&
      [
        "techno",
        "house",
        "electronic",
        "edm",
        "rock",
        "classical",
        "opera",
      ].includes(g)
  );

  if (strongMismatchGenres.length >= 1 && overlapCount === 0) {
    score -= 12;
  }

  if (playlistGenres.length >= 5 && overlapCount <= 1) {
    score -= 7;
  }

  if (
    majorTrackGenres.length > 0 &&
    overlapCount === 0 &&
    playlistGenres.length > 0
  ) {
    score -= 9;
  }

  return score;
}

function genericDiscoveryPenalty(track: any, playlist: any) {
  const lower =
    `${playlist?.name ?? ""} ${playlist?.description ?? ""}`.toLowerCase();

  let penalty = 0;

  if (GENERIC_PLAYLIST_PATTERNS.some((pattern) => lower.includes(pattern))) {
    penalty += 8;
  }

  if (/\b(top|hits|mix|vibes|greatest|best)\b/.test(lower)) {
    penalty += 3;
  }

  const trackGenres = getTrackGenreProfile(track);
  const playlistGenres = getPlaylistGenreProfile(playlist);
  const overlap = trackGenres.filter((g) => playlistGenres.includes(g)).length;

  if (penalty > 0 && overlap >= 2) {
    penalty -= 4;
  }

  return Math.max(0, penalty);
}

function contactabilityBonus(playlist: any) {
  let bonus = 0;
  const curator = playlist?.curator;

  const sendableEmail = getSendableEmailState(playlist);
  const hasSubmissionUrl = !!curator?.submissionUrl;
  const hasWebsiteUrl = !!curator?.websiteUrl;
  const hasInstagramUrl = !!curator?.instagramUrl;
  const confidence = Number(curator?.contactConfidence ?? 0);

  if (sendableEmail) bonus += 8;
  if (hasSubmissionUrl) bonus += 6;
  if (hasWebsiteUrl) bonus += 3;
  if (hasInstagramUrl) bonus += 1;

  if (confidence >= 80) bonus += 6;
  else if (confidence >= 60) bonus += 4;
  else if (confidence >= 40) bonus += 2;

  return bonus;
}

function buildContactSummary(playlist: any) {
  const curator = playlist?.curator;
  const parts: string[] = [];

  if (getSendableEmailState(playlist)) {
    parts.push("Email contact");
  } else {
    parts.push("No public email");
  }

  if (curator?.submissionUrl) parts.push("Submission link");
  if (curator?.websiteUrl) parts.push("Website");
  if (curator?.instagramUrl) parts.push("Instagram");

  if ((curator?.contactConfidence ?? 0) > 0) {
    parts.push(`Confidence ${curator.contactConfidence}`);
  }

  return parts.join(" • ");
}

function buildGenreSummary(track: any, playlist: any) {
  const trackGenres = getTrackGenreProfile(track);
  const playlistGenres = getPlaylistGenreProfile(playlist);
  const overlap = trackGenres.filter((g) => playlistGenres.includes(g));

  if (overlap.length) {
    return `Genre overlap: ${overlap.join(", ")}`;
  }

  if (trackGenres.length && playlistGenres.length) {
    return `Track genres: ${trackGenres.slice(0, 3).join(", ")} • Playlist genres: ${playlistGenres.slice(0, 3).join(", ")}`;
  }

  if (trackGenres.length) {
    return `Track genres: ${trackGenres.slice(0, 3).join(", ")}`;
  }

  return "Genre profile limited";
}

function computeFinalScore(track: any, playlist: any, vec: TrackVector) {
  const centroid = buildPlaylistCentroid(playlist);
  const baseCosine = cosine(vec, centroid);

  let score = 28 + baseCosine * 42;

  score -= penaltyForRules(vec, playlist);
  score -= textMismatchPenalty(playlist);
  score -= genericTitlePenalty(String(playlist?.name ?? ""));
  score -= genericDiscoveryPenalty(track, playlist);
  score += specificityBonus(playlist);
  score += genreAffinityScore(track, playlist);
  score += contactabilityBonus(playlist);

  score = Math.round(score);
  score = Math.max(0, Math.min(99, score));

  return score;
}

type RankedMatch = {
  playlistId: string;
  score: number;
  explanation: string;
  sendable: boolean;
  contactConfidence: number;
  hasSubmissionUrl: boolean;
};

function compareRankedMatches(a: RankedMatch, b: RankedMatch) {
  if (a.sendable !== b.sendable) {
    return a.sendable ? -1 : 1;
  }

  if (a.hasSubmissionUrl !== b.hasSubmissionUrl) {
    return a.hasSubmissionUrl ? -1 : 1;
  }

  if (a.contactConfidence !== b.contactConfidence) {
    return b.contactConfidence - a.contactConfidence;
  }

  if (a.score !== b.score) {
    return b.score - a.score;
  }

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
    vec[1],
    "trackGenres=",
    getTrackGenreProfile(track)
  );

  const scored: RankedMatch[] = playlists.map((pl) => {
    const score = computeFinalScore(track, pl, vec);
    const canEmail = getSendableEmailState(pl);
    const contactConfidence = Number(pl?.curator?.contactConfidence ?? 0);
    const hasSubmissionUrl = !!pl?.curator?.submissionUrl;

    const explanationParts = [
      `Tempo ~${Math.round(vec[3] * 200)} BPM`,
      `Energy ~${vec[1].toFixed(2)}`,
      buildGenreSummary(track, pl),
      buildContactSummary(pl),
    ];

    return {
      playlistId: pl.id,
      score,
      explanation: explanationParts.join(" • "),
      sendable: canEmail,
      contactConfidence,
      hasSubmissionUrl,
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
          contactConfidence: true,
          instagramUrl: true,
          websiteUrl: true,
          submissionUrl: true,
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
        contactConfidence: pl?.curator?.contactConfidence ?? 0,
        hasSubmissionUrl: !!pl?.curator?.submissionUrl,
        hasWebsiteUrl: !!pl?.curator?.websiteUrl,
      };
    })
    .sort((a, b) => {
      if (a.sendable !== b.sendable) {
        return a.sendable ? -1 : 1;
      }
      if (a.hasSubmissionUrl !== b.hasSubmissionUrl) {
        return a.hasSubmissionUrl ? -1 : 1;
      }
      if ((a.contactConfidence ?? 0) !== (b.contactConfidence ?? 0)) {
        return (b.contactConfidence ?? 0) - (a.contactConfidence ?? 0);
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