import axios from "axios";
import { prisma } from "../../db";
import { getValidSpotifyAccessToken } from "./refreshToken";

const PAGE_LIMIT = 10;

export async function loadSpotifyReleases(
  artistId: string
) {
  const artist = await prisma.artist.findUnique({
    where: {
      id: artistId,
    },
    select: {
      spotifyArtistId: true,
    },
  });

  if (!artist?.spotifyArtistId) {
    throw new Error("SPOTIFY_ARTIST_NOT_DISCOVERED");
  }

  const accessToken =
    await getValidSpotifyAccessToken(artistId);

  const releases: any[] = [];

  let offset = 0;
let hasNext = true;

while (hasNext) {
  try {

      const response = await axios.get(
        `https://api.spotify.com/v1/artists/${artist.spotifyArtistId}/albums`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            market: "NL",
            limit: PAGE_LIMIT,
            offset,
          },
          timeout: 10_000,
        }
      );

      const items = Array.isArray(response.data.items)
        ? response.data.items
        : [];

      releases.push(...items);

      hasNext = response.data.next !== null;
      offset += PAGE_LIMIT;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        
      }

      throw error;
    }
  }

  return releases;
}