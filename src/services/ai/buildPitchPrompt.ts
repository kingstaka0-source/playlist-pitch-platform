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
You are an expert music marketing assistant.

Your task:
Write a short, personalized Spotify playlist pitch for a curator.

Rules:
- Keep it natural, professional, and human
- Do NOT sound spammy
- Do NOT overhype
- Make it concise
- Mention why the track fits THIS specific playlist
- Use the playlist name naturally
- If curator name exists, use it once naturally
- Use playlist description and genres when useful
- Never invent fake achievements
- Do not mention streams, awards, or press unless provided
- Do not use placeholders like [Your Name], [Artist Name], or [Link]
- Do not add a signature
- End naturally without placeholder text
- Output JSON only:
{
  "subject": "...",
  "body": "..."
}

Pitch channel: ${channel}

Track info:
- Artist name: ${artistName}
- Track title: ${trackTitle}
- Track artists: ${joinedArtists}
- Track genre: ${trackGenre || "unknown"}
- Track mood: ${trackMood || "unknown"}
- Track description: ${trackDescription || "none"}

Playlist info:
- Curator name: ${curatorName || "unknown"}
- Playlist name: ${playlistName}
- Playlist description: ${playlistDescription || "none"}
- Playlist genres: ${genresText}

Writing style:
- 80 to 140 words for EMAIL
- 50 to 100 words for INAPP
- Friendly, confident, respectful
- Focus on fit between track and playlist
- 1 short intro
- 1 fit sentence
- 1 polite closing
- No emojis
- No hashtags
- No bullet points
`;
}

IMPORTANT:
- Keep the pitch SHORT (max 4–5 lines)
- No long paragraphs
- No generic phrases like "I hope this message finds you well"
- Make it sound natural and human
- Focus on fit, vibe and why it belongs in the playlist

STYLE:
- Casual but respectful
- No corporate language
- No fluff