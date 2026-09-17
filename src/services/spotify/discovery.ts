import axios from "axios";
import { prisma } from "../../db";
import { getValidSpotifyAccessToken } from "./refreshToken";

type SpotifyImage = {
  url: string;
  width: number | null;
  height: number | null;
};

type SpotifyArtist = {
  id: string;
  name: string;
  external_urls?: {
    spotify?: string;
  };
  followers?: {
    total?: number;
  };
  genres?: string[];
  images?: SpotifyImage[];
  popularity?: number;
  uri?: string;
};

type SpotifyArtistSearchResponse = {
  artists?: {
    items?: SpotifyArtist[];
    total?: number;
  };
};

export type DiscoveredSpotifyArtist = {
  id: string;
  name: string;
  spotifyUrl: string | null;
  imageUrl: string | null;
  followers: number;
  popularity: number;
  genres: string[];
};

function normalizeArtistName(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function chooseBestArtistMatch(
  expectedName: string,
  candidates: SpotifyArtist[]
): SpotifyArtist | null {
  if (candidates.length === 0) {
    return null;
  }

  const normalizedExpectedName =
    normalizeArtistName(expectedName);

  console.log("SPOTIFY MATCH DEBUG", {
    expectedName,
    normalizedExpectedName,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      normalizedName: normalizeArtistName(candidate.name),
      exact:
        normalizeArtistName(candidate.name) ===
        normalizedExpectedName,
    })),
  });

  const exactMatch = candidates.find(
    (candidate) =>
      normalizeArtistName(candidate.name) ===
      normalizedExpectedName
  );

  return exactMatch ?? null;
}

export async function saveDiscoveredArtist(
  artistId: string,
  spotifyArtist: SpotifyArtist
): Promise<DiscoveredSpotifyArtist> {
  const result: DiscoveredSpotifyArtist = {
    id: spotifyArtist.id,
    name: spotifyArtist.name,
    spotifyUrl:
      spotifyArtist.external_urls?.spotify ?? null,
    imageUrl:
      spotifyArtist.images?.[0]?.url ?? null,
    followers:
      spotifyArtist.followers?.total ?? 0,
    popularity:
      spotifyArtist.popularity ?? 0,
    genres:
      spotifyArtist.genres ?? [],
  };

  await prisma.artist.update({
    where: {
      id: artistId,
    },
    data: {
      spotifyArtistId: result.id,
      spotifyArtistName: result.name,
      spotifyArtistUrl: result.spotifyUrl,
      spotifyArtistImageUrl: result.imageUrl,
      spotifyArtistFollowers: result.followers,
      spotifyArtistVerifiedAt: new Date(),
    },
  });

  return result;
}

/**
 * Finds the public Spotify artist profile matching the TuneReach artist name,
 * stores it on the Artist record, and returns the profile.
 */
export async function discoverSpotifyArtist(
  artistId: string
): Promise<DiscoveredSpotifyArtist> {
  const tuneReachArtist =
    await prisma.artist.findUnique({
      where: {
        id: artistId,
      },
      select: {
        id: true,
        name: true,
        spotifyArtistId: true,
        spotifyAccessToken: true,
      },
    });

  if (!tuneReachArtist) {
    throw new Error("ARTIST_NOT_FOUND");
  }

  if (!tuneReachArtist.spotifyAccessToken) {
    throw new Error("SPOTIFY_NOT_CONNECTED");
  }

  const accessToken =
    await getValidSpotifyAccessToken(artistId);

  /*
   * If an artist profile was already confirmed,
   * retrieve the latest public details directly.
   */
  if (tuneReachArtist.spotifyArtistId) {
    try {
      const existingArtistResponse =
        await axios.get<SpotifyArtist>(
          `https://api.spotify.com/v1/artists/${encodeURIComponent(
            tuneReachArtist.spotifyArtistId
          )}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 10_000,
          }
        );

      return await saveDiscoveredArtist(
        artistId,
        existingArtistResponse.data
      );
    } catch (error: unknown) {
      const axiosError = axios.isAxiosError(error)
        ? error
        : null;

      console.warn(
        "EXISTING SPOTIFY ARTIST FETCH FAILED",
        axiosError?.response?.data ??
          (error instanceof Error
            ? error.message
            : String(error))
      );

      /*
       * Continue to search again if the stored Spotify
       * artist profile can no longer be retrieved.
       */
    }
  }

  const searchResponse =
    await axios.get<SpotifyArtistSearchResponse>(
      "https://api.spotify.com/v1/search",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          q: tuneReachArtist.name,
          type: "artist",
          limit: 20,
          market: "NL",
        },
        timeout: 10_000,
      }
    );

  const candidates =
    searchResponse.data.artists?.items ?? [];

  console.log("SPOTIFY ARTIST SEARCH DEBUG", {
    searchedName: tuneReachArtist.name,
    total:
      searchResponse.data.artists?.total ?? 0,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      followers:
        candidate.followers?.total ?? 0,
    })),
  });

  const bestMatch = chooseBestArtistMatch(
    tuneReachArtist.name,
    candidates
  );

  if (!bestMatch) {
    const error =
      new Error("SPOTIFY_ARTIST_NOT_FOUND");

    Object.assign(error, {
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        imageUrl:
          candidate.images?.[0]?.url ?? null,
        followers:
          candidate.followers?.total ?? 0,
        spotifyUrl:
          candidate.external_urls?.spotify ?? null,
      })),
    });

    throw error;
  }

  return await saveDiscoveredArtist(
    artistId,
    bestMatch
  );
}