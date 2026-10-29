export function generatePitch({
  curatorName,
  playlistName,
  trackTitle,
  artistName,
  genres,
  tempo,
}: {
  curatorName?: string | null;
  playlistName?: string | null;
  trackTitle: string;
  artistName: string;
  genres?: string[] | null;
  tempo?: number | null;
}) {
  const name = curatorName || "there";
  const playlist = playlistName || "your playlist";

  const genreContext =
    genres && genres.length > 0
      ? ` I noticed the playlist focuses on ${genres.slice(0, 2).join(" and ")}.`
      : "";

  return {
    subject: `${trackTitle} for ${playlist}`,

    body: `Hi ${name},

I'm sharing "${trackTitle}" by ${artistName} for your consideration.${genreContext}

If it sounds relevant, I'd be glad if you gave it a listen.

Best,
${artistName}`,
  };
}