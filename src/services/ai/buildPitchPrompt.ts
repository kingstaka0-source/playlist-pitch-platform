type PitchInput = {
  artistName: string;
  trackTitle: string;
  trackArtists?: string[];
  trackGenre?: string | null;
  trackMood?: string | null;
  trackDescription?: string | null;
  curatorName?: string | null;
  playlistName: string;
  playlistDescription?: string | null;
  playlistGenres?: string[] | null;
  channel?: "EMAIL" | "INAPP";
};

export function buildPitchPrompt(input: PitchInput) {
  const {
    artistName,
    trackTitle,
    trackArtists = [],
    trackGenre,
    trackMood,
    trackDescription,
    curatorName,
    playlistName,
    playlistDescription,
    playlistGenres,
    channel = "EMAIL",
  } = input;

  const joinedArtists =
    trackArtists.length > 0 ? trackArtists.join(", ") : artistName;

  const genresText =
    playlistGenres && playlistGenres.length > 0
      ? playlistGenres.join(", ")
      : "unknown";

    return `
You are an expert Spotify playlist pitching assistant for independent artists.

Your task:
Write a short, personalized Spotify playlist pitch for a curator.

Return JSON only:
{
  "subject": "...",
  "body": "..."
}

Pitch channel: ${channel}

Track info:
- Main artist/account: ${artistName}
- Track title: ${trackTitle}
- Credited artists: ${joinedArtists}
- Track genre: ${trackGenre || "unknown"}
- Track mood: ${trackMood || "unknown"}
- Track description: ${trackDescription || "none"}

Playlist info:
- Curator name: ${curatorName || "unknown"}
- Playlist name: ${playlistName}
- Playlist description: ${playlistDescription || "none"}
- Playlist genres: ${genresText}

Rules:
- Natural, human, professional English.
- Short: 80 to 130 words for EMAIL, 50 to 90 words for INAPP.
- Do NOT mention tempo, BPM, energy, confidence score, fit score, algorithm, match score, database, or internal matching data.
- Do NOT say "strong feedback so far" unless provided in Track description.
- Do NOT claim the song is by ${artistName} if the credited artists are different. Use credited artists when needed.
- Do NOT invent streams, press, playlist adds, awards, or achievements.
- Do NOT use emojis, hashtags, bullet points, or placeholders.
- Do NOT add a fake signature.
- Mention why the track could fit this playlist using musical language, mood, sound, audience, or playlist direction.
- Use the curator name once if it sounds natural.
- Use the playlist description only if useful.
- Keep it respectful and not pushy.
- If the credited artists are different from the main artist/account, describe the track as being by the credited artists, not by the main artist/account.


Subject:
Make the subject specific and simple, for example:
"Possible fit for ${playlistName}: ${trackTitle}"

Body style:
- 1 short opening sentence
- 1 sentence about the track and credited artists
- 1 sentence about why it fits the playlist
- 1 polite closing sentence
- No long paragraphs
`.trim();
}