import axios from "axios";
import { prisma } from "../../db";
import { env } from "../../env";

function must(name: string, value?: string): string {
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

const CLIENT_ID = must("SPOTIFY_CLIENT_ID", env.SPOTIFY_CLIENT_ID);
const CLIENT_SECRET = must(
  "SPOTIFY_CLIENT_SECRET",
  env.SPOTIFY_CLIENT_SECRET
);

type SpotifyRefreshResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

/**
 * Returns a usable Spotify access token.
 *
 * If the current token is close to expiring, this function automatically
 * refreshes it and stores the new token in the database.
 */
export async function getValidSpotifyAccessToken(
  artistId: string
): Promise<string> {
  const artist = await prisma.artist.findUnique({
    where: {
      id: artistId,
    },
    select: {
      id: true,
      spotifyAccessToken: true,
      spotifyRefreshToken: true,
      spotifyTokenExpiresAt: true,
    },
  });

  if (!artist) {
    throw new Error("ARTIST_NOT_FOUND");
  }

  if (!artist.spotifyAccessToken) {
    throw new Error("SPOTIFY_NOT_CONNECTED");
  }

  const expiresAt = artist.spotifyTokenExpiresAt?.getTime() ?? 0;

  // Refresh one minute before the token actually expires.
  const tokenIsStillValid =
    expiresAt > Date.now() + 60 * 1000;

  if (tokenIsStillValid) {
    return artist.spotifyAccessToken;
  }

  if (!artist.spotifyRefreshToken) {
    throw new Error("SPOTIFY_REFRESH_TOKEN_MISSING");
  }

  try {
    const response = await axios.post<SpotifyRefreshResponse>(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: artist.spotifyRefreshToken,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
              "base64"
            ),
        },
        timeout: 10_000,
      }
    );

    const newAccessToken = response.data.access_token;
    const newRefreshToken =
      response.data.refresh_token ?? artist.spotifyRefreshToken;
    const expiresIn = response.data.expires_in;

    if (!newAccessToken) {
      throw new Error("SPOTIFY_REFRESH_RETURNED_NO_ACCESS_TOKEN");
    }

    await prisma.artist.update({
      where: {
        id: artist.id,
      },
      data: {
        spotifyAccessToken: newAccessToken,
        spotifyRefreshToken: newRefreshToken,
        spotifyTokenExpiresAt: new Date(
          Date.now() + expiresIn * 1000
        ),
        ...(response.data.scope
          ? { spotifyScopes: response.data.scope }
          : {}),
      },
    });

    return newAccessToken;
  } catch (error: any) {
    console.error(
      "SPOTIFY TOKEN REFRESH ERROR",
      error?.response?.data ?? error?.message ?? error
    );

    if (error?.response?.data?.error === "invalid_grant") {
      throw new Error("SPOTIFY_REAUTHORIZATION_REQUIRED");
    }

    throw new Error("SPOTIFY_TOKEN_REFRESH_FAILED");
  }
}