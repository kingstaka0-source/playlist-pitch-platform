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

  const genreLine =
    genres && genres.length > 0
      ? genres.slice(0, 2).join(", ")
      : "reggae / dub";

  const vibeLine =
    tempo && tempo > 0
      ? `around ${Math.round(tempo)} BPM with a solid groove`
      : "with a deep roots groove";

  return {
    subject: `${artistName} — ${trackTitle} (for ${playlist})`,

    body: `Hi ${name},

Sending you my new track "${trackTitle}" — ${genreLine} with ${vibeLine}.

Feels like a natural fit for ${playlist}.

Respect,
${artistName}`,
  };
}