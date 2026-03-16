export function generatePitch({
  curatorName,
  playlistName,
  trackTitle,
  artistName,
  genres,
  tempo,
}: {
  curatorName?: string | null
  playlistName: string
  trackTitle: string
  artistName: string
  genres: string[]
  tempo?: number | null
}) {

  const genreLine =
    genres && genres.length
      ? `It blends ${genres.slice(0, 3).join(", ")} influences`
      : "It blends modern influences"

  const tempoLine =
    tempo ? `with a groove around ~${Math.round(tempo)} BPM` : ""

  return `Hi ${curatorName || "there"},

I came across your playlist "${playlistName}" and really liked the vibe.

My new track "${trackTitle}" by ${artistName} ${genreLine} ${tempoLine}, and I believe it could fit nicely with the sound you're curating.

Spotify link:
https://open.spotify.com/

If it fits your playlist, I'd really appreciate you considering it.

Much respect,
${artistName}`
}