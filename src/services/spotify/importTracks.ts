import axios from "axios";
import prisma from "../../lib/prisma";
import { getValidSpotifyAccessToken } from "./refreshToken";

type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  artists: Array<{
    id: string;
    name: string;
  }>;
};

type SpotifyAlbumTracksResponse = {
  items: SpotifyTrack[];
  next: string | null;
};

export async function importSpotifyAlbumTracks(
  artistId: string,
  albumId: string
) {
  const artist = await prisma.artist.findUnique({
    where: {
      id: artistId,
    },
  });

  if (!artist) {
    throw new Error("Artist not found");
  }

  if (!artist.spotifyArtistId) {
    throw new Error("Artist has no Spotify artist ID");
  }

  const accessToken = await getValidSpotifyAccessToken(artistId);

  let nextUrl: string | null =
    `https://api.spotify.com/v1/albums/${albumId}/tracks?market=NL&limit=50`;

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  while (nextUrl) {
    const response: {
      data: SpotifyAlbumTracksResponse;
    } = await axios.get(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 15_000,
    });

    for (const track of response.data.items) {
      if (!track.id) {
        skipped++;
        continue;
      }

      const existingTrack = await prisma.track.findUnique({
  where: {
    artistId_spotifyTrackId: {
      artistId,
      spotifyTrackId: track.id,
    },
  },
});

      const trackArtists = track.artists.map((item) => item.name);

      if (existingTrack) {
        await prisma.track.update({
  where: {
    artistId_spotifyTrackId: {
      artistId,
      spotifyTrackId: track.id,
    },
  },
          data: {
            title: track.name,
            artists: trackArtists,
            durationMs: track.duration_ms,
          },
        });

        updated++;
        continue;
      }

      await prisma.track.create({
        data: {
          artistId,
          spotifyTrackId: track.id,
          title: track.name,
          artists: trackArtists,
          durationMs: track.duration_ms,
          audioFeatures: {},
          genres: [],
        },
      });

      imported++;
    }

    nextUrl = response.data.next;
  }

  return {
    albumId,
    imported,
    updated,
    skipped,
    totalProcessed: imported + updated + skipped,
  };
}