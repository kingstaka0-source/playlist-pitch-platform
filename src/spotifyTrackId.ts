export function extractSpotifyTrackId(input: string): string | null {
  const s = (input || "").trim();

  // spotify:track:ID
  const uriMatch = s.match(/^spotify:track:([A-Za-z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  // https://open.spotify.com/track/ID?...
  const urlMatch = s.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // raw ID
  if (/^[A-Za-z0-9]{10,}$/.test(s)) return s;

  return null;
}
