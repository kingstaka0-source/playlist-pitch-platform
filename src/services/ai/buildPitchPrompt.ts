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
  musicalMatchGenres?: string[] | null;
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
    musicalMatchGenres,
    channel = "EMAIL",
  } = input;

  const joinedArtists =
    trackArtists.length > 0 ? trackArtists.join(", ") : artistName;

  const genresText =
    playlistGenres && playlistGenres.length > 0
      ? playlistGenres.join(", ")
      : "unknown";

  const musicalMatchText =
    musicalMatchGenres && musicalMatchGenres.length > 0
      ? musicalMatchGenres.join(", ")
      : "none";

  return `
You write short, natural Spotify playlist pitches for independent artists.

Your task:
Write a personalized curator pitch using only the information provided below.

Return valid JSON only:
{
  "subject": "...",
  "body": "..."
}

Pitch channel: ${channel}

TRACK FACTS
- Main artist/account: ${artistName}
- Track title: ${trackTitle}
- Credited artists: ${joinedArtists}
- Track genre: ${trackGenre || "unknown"}
- Track mood: ${trackMood || "unknown"}
- Track description: ${trackDescription || "none"}

PLAYLIST FACTS
- Curator name: ${curatorName || "unknown"}
- Playlist name: ${playlistName}
- Playlist description: ${playlistDescription || "none"}
- Playlist genres: ${genresText}

INTERNAL MUSICAL MATCH CONTEXT
- Genre overlap: ${musicalMatchText}

Important:
The internal musical match context is only supporting information.
Never mention matching systems, scores, confidence, algorithms, databases,
email availability, submission links, or internal analysis in the pitch.

Accuracy rules:
- Use only facts provided above.
- Never invent the track's mood, sound, instrumentation, tempo, energy, audience reaction, achievements, streams, press, playlist adds, or performance.
- If track genre, mood, or description is unknown, do not guess it.
- Do not turn playlist genres into track genres.
- Playlist name and description may suggest a direction, theme, setting, or audience, but phrase such observations carefully.
- Never claim to have listened to the playlist.
- Never imply knowledge of individual songs in the playlist unless that information was explicitly provided.
- Do not claim the track is a strong, perfect, natural, or obvious fit merely because an internal genre overlap exists.
- Treat similar-looking genre names carefully. For example, reggae and reggaeton are not interchangeable.
- If the available information does not support a specific musical claim, keep the pitch simple rather than inventing detail.

Artist attribution:
- Credited artists are the authoritative track attribution.
- If credited artists are available, use them when describing who the track is by.
- Do not incorrectly attribute a collaboration solely to the main artist/account.

Writing style:
- Natural, human, professional English.
- Conversational and specific, not marketing copy.
- Respectful and not pushy.
- Reference the playlist by name naturally.
- Use the curator name once if it sounds natural.
- Prefer a concrete observation based on the playlist name or description over generic praise.
- Explain the possible connection between the track and playlist only when supported by the supplied facts or musical match context.
- Do not repeat genre labels unnecessarily.
- Avoid dramatic, poetic, or exaggerated language.
- No emojis, hashtags, bullet points, placeholders, or fake signature.
- Do not say "I believe" or "I think".
- Never start with "Hi there, I hope you're well".
- Never start with "I hope this message finds you well".
- Avoid phrases such as "captivated", "beautifully blends", "resonate", "heartfelt melodies", "perfect for", "journey", "would fit nicely", "natural fit", and "emotional yet energetic vibe".

Length:
- EMAIL: 65 to 100 words.
- INAPP: 45 to 75 words.
- Prefer four short sentences over a long paragraph.

Subject:
- Keep it short and specific.
- Include the track title and/or playlist name when natural.
- Do not use clickbait or exaggerated claims.
- Example structure: "${trackTitle} for ${playlistName}"

Body structure:
- One short opening sentence that references the playlist or its stated context.
- One short sentence introducing the track and credited artist(s).
- One short sentence explaining the possible relevance to the playlist using only supported information.
- One polite, low-pressure closing sentence.
- Plain English.
- Sound hand-written.
`.trim();
}