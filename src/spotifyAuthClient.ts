import axios from "axios";
import { prisma } from "./db";
import { env } from "./env";

export async function getValidSpotifyAccessToken(artistId: string) {
  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist?.spotifyRefreshToken) return null;

  const now = Date.now();
  const expiresAt = artist.spotifyTokenExpiresAt?.getTime() ?? 0;

  // nog geldig (met 60s marge)
  if (artist.spotifyAccessToken && expiresAt - 60_000 > now) {
    return artist.spotifyAccessToken;
  }

  // refresh
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", artist.spotifyRefreshToken);

  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const { data } = await axios.post("https://accounts.spotify.com/api/token", params, {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 10_000,
  });

  const newAccess = data.access_token as string;
  const expiresIn = data.expires_in as number; // seconds
  const newRefresh = (data.refresh_token as string | undefined) ?? artist.spotifyRefreshToken;

  await prisma.artist.update({
    where: { id: artistId },
    data: {
      spotifyAccessToken: newAccess,
      spotifyRefreshToken: newRefresh,
      spotifyTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return newAccess;
}
