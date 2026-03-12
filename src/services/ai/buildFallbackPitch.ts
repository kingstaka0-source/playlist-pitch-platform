type FallbackInput = {
  artistName: string;
  trackTitle: string;
  curatorName?: string | null;
  playlistName: string;
  playlistGenres?: string[] | null;
  playlistDescription?: string | null;
};

export function buildFallbackPitch(input: FallbackInput) {
  const {
    artistName,
    trackTitle,
    curatorName,
    playlistName,
    playlistGenres,
    playlistDescription,
  } = input;

  const greeting = curatorName ? `Hi ${curatorName},` : `Hi,`;

  const fitReason =
    playlistGenres && playlistGenres.length > 0
      ? `I think "${trackTitle}" by ${artistName} could be a strong fit for ${playlistName}, especially with its connection to ${playlistGenres.join(", ")}.`
      : `I think "${trackTitle}" by ${artistName} could be a strong fit for ${playlistName}.`;

  const extra =
    playlistDescription && playlistDescription.trim()
      ? ` The playlist description and overall vibe feel aligned with the energy of this track.`
      : "";

  return {
    subject: `${trackTitle} for ${playlistName}`,
    body: `${greeting}

I wanted to share "${trackTitle}" by ${artistName} with you.

${fitReason}${extra}

Would love for you to consider it for the playlist if it feels like a match.

Thanks for your time.`,
  };
}