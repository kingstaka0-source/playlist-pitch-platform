import axios, { type AxiosResponse } from "axios";
import { prisma } from "../../db";
import { loadSpotifyReleases } from "./releases";
import { getSpotifyAppAccessToken } from "../../spotifyAppClient";

type ImportResult = {
  albumsProcessed: number;
  tracksImported: number;
  tracksUpdated: number;
  duplicatesSkipped: number;
};

type SpotifyArtist = {
  id: string;
  name: string;
};

type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  track_number: number;
  disc_number: number;
  artists: SpotifyArtist[];
  external_urls?: {
    spotify?: string;
  };
};

type SpotifyAlbumTracksResponse = {
  items?: SpotifyTrack[];
  next?: string | null;
};

type SpotifyFullTrack = SpotifyTrack & {
  external_ids?: {
    isrc?: string;
  };
  album?: {
    id?: string;
    name?: string;
    release_date?: string;
    images?: Array<{
      url: string;
      height?: number | null;
      width?: number | null;
    }>;
  };
};

export async function importSpotifyCatalog(
  artistId: string
): Promise<ImportResult> {
  const releases = await loadSpotifyReleases(artistId);
  const appToken = await getSpotifyAppAccessToken();

  const result: ImportResult = {
    albumsProcessed: 0,
    tracksImported: 0,
    tracksUpdated: 0,
    duplicatesSkipped: 0,
  };

  const processedSpotifyTrackIds = new Set<string>();

  for (const release of releases) {
    result.albumsProcessed++;

    console.log(
      `Processing album ${result.albumsProcessed}/${releases.length}: ${release.name}`
    );

    let nextUrl: string | null =
      `https://api.spotify.com/v1/albums/${release.id}/tracks?limit=50`;

    let albumTrackCount = 0;

    while (nextUrl) {
      const response: AxiosResponse<SpotifyAlbumTracksResponse> =
  await axios.get<SpotifyAlbumTracksResponse>(
        nextUrl,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
          },
        }
      );

      const tracks = response.data.items ?? [];
      albumTrackCount += tracks.length;

      for (const track of tracks) {
        if (!track.id) {
          console.warn(
            `Skipping track without Spotify ID: ${track.name}`
          );
          continue;
        }

        if (processedSpotifyTrackIds.has(track.id)) {
          result.duplicatesSkipped++;

          console.log(
            `Duplicate skipped: ${track.name} (${track.id})`
          );

          continue;
        }

        processedSpotifyTrackIds.add(track.id);

        const fullTrackResponse = await axios.get<SpotifyFullTrack>(
          `https://api.spotify.com/v1/tracks/${track.id}`,
          {
            headers: {
              Authorization: `Bearer ${appToken}`,
            },
            params: {
              market: "NL",
            },
          }
        );

        const fullTrack = fullTrackResponse.data;

        const existingTrack = await prisma.track.findUnique({
  where: {
    artistId_spotifyTrackId: {
      artistId,
      spotifyTrackId: fullTrack.id,
    },
  },
  select: {
    id: true,
  },
});

        await prisma.track.upsert({
  where: {
    artistId_spotifyTrackId: {
      artistId,
      spotifyTrackId: fullTrack.id,
    },
  },
          update: {
            artistId,
            spotifyAlbumId:
              fullTrack.album?.id ?? release.id ?? null,
            spotifyUrl:
              fullTrack.external_urls?.spotify ?? null,
            title: fullTrack.name,
            artists: fullTrack.artists.map(
              (artist) => artist.name
            ),
            albumName:
              fullTrack.album?.name ?? release.name ?? null,
            albumImageUrl:
              fullTrack.album?.images?.[0]?.url ?? null,
            releaseDate:
              fullTrack.album?.release_date ?? null,
            isrc:
              fullTrack.external_ids?.isrc ?? null,
            trackNumber:
              fullTrack.track_number ?? null,
            discNumber:
              fullTrack.disc_number ?? null,
            explicit:
              fullTrack.explicit ?? false,
            durationMs:
              fullTrack.duration_ms,
          },
          create: {
            artistId,
            spotifyTrackId: fullTrack.id,
            spotifyAlbumId:
              fullTrack.album?.id ?? release.id ?? null,
            spotifyUrl:
              fullTrack.external_urls?.spotify ?? null,
            title: fullTrack.name,
            artists: fullTrack.artists.map(
              (artist) => artist.name
            ),
            albumName:
              fullTrack.album?.name ?? release.name ?? null,
            albumImageUrl:
              fullTrack.album?.images?.[0]?.url ?? null,
            releaseDate:
              fullTrack.album?.release_date ?? null,
            isrc:
              fullTrack.external_ids?.isrc ?? null,
            trackNumber:
              fullTrack.track_number ?? null,
            discNumber:
              fullTrack.disc_number ?? null,
            explicit:
              fullTrack.explicit ?? false,
            durationMs:
              fullTrack.duration_ms,
            audioFeatures: {},
            genres: [],
          },
        });

        if (existingTrack) {
          result.tracksUpdated++;

          console.log(
            `Track updated: ${fullTrack.name}`
          );
        } else {
          result.tracksImported++;

          console.log(
            `Track imported: ${fullTrack.name}`
          );
        }
      }

      nextUrl = response.data.next ?? null;
    }

    console.log(
      `Found ${albumTrackCount} tracks in album "${release.name}"`
    );
  }

  console.log(
    "Spotify catalog import completed:",
    result
  );

  return result;
}