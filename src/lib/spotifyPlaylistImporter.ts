import { prisma } from "../db";
import { computeMatches } from "../matching";

type SpotifyImage = {
  url?: string;
  height?: number | null;
  width?: number | null;
};

type SpotifyUser = {
  id: string;
  display_name?: string | null;
  href?: string;
  external_urls?: {
    spotify?: string;
  };
  followers?: {
    total?: number;
  };
  images?: SpotifyImage[];
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  collaborative?: boolean;
  public?: boolean | null;
  owner?: SpotifyUser;
  external_urls?: {
    spotify?: string;
  };
  followers?: {
    total?: number;
  };
  images?: SpotifyImage[];
  tracks?: {
    total?: number;
  };
};

function parseSpotifyPlaylistId(input: string): string | null {
  const value = String(input || "").trim();
  if (!value) return null;

  if (/^[A-Za-z0-9]{10,}$/.test(value) && !value.includes("spotify.com")) {
    return value;
  }

  const match = value.match(/playlist\/([A-Za-z0-9]+)(\?|$)/i);
  if (match?.[1]) return match[1];

  return null;
}

function getSpotifyClientCredentials() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_CREDENTIALS_MISSING");
  }

  return { clientId, clientSecret };
}

async function getAppAccessToken() {
  const { clientId, clientSecret } = getSpotifyClientCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const tokenJson: any = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !tokenJson?.access_token) {
    throw new Error(
      tokenJson?.error_description ||
        tokenJson?.error ||
        "SPOTIFY_CLIENT_CREDENTIALS_FAILED"
    );
  }

  return String(tokenJson.access_token);
}

async function refreshSpotifyAccessToken(artistId: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      spotifyRefreshToken: true,
    },
  });

  if (!artist?.spotifyRefreshToken) {
    throw new Error("SPOTIFY_REFRESH_TOKEN_MISSING");
  }

  const { clientId, clientSecret } = getSpotifyClientCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: artist.spotifyRefreshToken,
    }),
  });

  const tokenJson: any = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !tokenJson?.access_token) {
    throw new Error(
      tokenJson?.error_description || tokenJson?.error || "SPOTIFY_REFRESH_FAILED"
    );
  }

  const expiresIn = Number(tokenJson.expires_in || 3600);
  const nextExpiry = new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000);

  const updated = await prisma.artist.update({
    where: { id: artistId },
    data: {
      spotifyAccessToken: String(tokenJson.access_token),
      spotifyTokenExpiresAt: nextExpiry,
      spotifyScopes: tokenJson.scope ? String(tokenJson.scope) : undefined,
    },
    select: {
      spotifyAccessToken: true,
    },
  });

  return updated.spotifyAccessToken || "";
}

async function getArtistAccessTokenIfAvailable(artistId: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      spotifyAccessToken: true,
      spotifyTokenExpiresAt: true,
      spotifyRefreshToken: true,
    },
  });

  if (!artist) {
    throw new Error("ARTIST_NOT_FOUND");
  }

  const now = Date.now();
  const expiresAt = artist.spotifyTokenExpiresAt
    ? new Date(artist.spotifyTokenExpiresAt).getTime()
    : 0;

  if (artist.spotifyAccessToken && expiresAt > now + 30_000) {
    return artist.spotifyAccessToken;
  }

  if (artist.spotifyRefreshToken) {
    return refreshSpotifyAccessToken(artistId);
  }

  return null;
}

async function spotifyGetWithToken<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const spotifyMessage =
      json?.error?.message || json?.message || "Unknown Spotify error";

    throw new Error(`Spotify request failed (${res.status}): ${spotifyMessage}`);
  }

  return json as T;
}

async function spotifyGet<T>(artistId: string, url: string): Promise<T> {
  const artistToken = await getArtistAccessTokenIfAvailable(artistId);

  if (artistToken) {
    try {
      return await spotifyGetWithToken<T>(artistToken, url);
    } catch (err: any) {
      const msg = String(err?.message || "");
      const shouldFallback =
        msg.includes("401") ||
        msg.includes("403") ||
        msg.toLowerCase().includes("token");

      if (!shouldFallback) {
        throw err;
      }
    }
  }

  const appToken = await getAppAccessToken();
  return spotifyGetWithToken<T>(appToken, url);
}

function inferGenresFromPlaylist(playlist: SpotifyPlaylist): string[] {
  const source = `${playlist.name || ""} ${playlist.description || ""}`.toLowerCase();

  const known = [
    "reggae",
    "roots",
    "dub",
    "dancehall",
    "afrobeats",
    "afrobeat",
    "hip hop",
    "rap",
    "drill",
    "rnb",
    "soul",
    "jazz",
    "house",
    "techno",
    "edm",
    "pop",
    "rock",
    "indie",
    "latin",
    "amapiano",
    "gospel",
    "lofi",
    "trap",
  ];

  const found = known.filter((g) => source.includes(g));
  return [...new Set(found)];
}

async function runAutoMatchingForImportedPlaylist(playlistDbId: string) {
  const tracks = await prisma.track.findMany({
    select: { id: true },
  });

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const track of tracks) {
    try {
      await computeMatches(track.id);
      ok += 1;
    } catch (err: any) {
      failed += 1;
      errors.push(`track ${track.id}: ${err?.message ?? String(err)}`);
    }
  }

  return {
    playlistDbId,
    totalTracks: tracks.length,
    matchedTracks: ok,
    failedTracks: failed,
    errors: errors.slice(0, 20),
  };
}

export async function importSpotifyPlaylistForArtist(input: {
  artistId: string;
  playlistUrlOrId: string;
}) {
  const playlistId = parseSpotifyPlaylistId(input.playlistUrlOrId);

  if (!playlistId) {
    throw new Error("INVALID_SPOTIFY_PLAYLIST_URL_OR_ID");
  }

  let playlist: SpotifyPlaylist;

  try {
    playlist = await spotifyGet<SpotifyPlaylist>(
      input.artistId,
      `https://api.spotify.com/v1/playlists/${playlistId}`
    );
  } catch (err: any) {
    const msg = String(err?.message || "");

    if (msg.includes("404") || msg.toLowerCase().includes("resource not found")) {
      throw new Error(
        "SPOTIFY_PLAYLIST_NOT_ACCESSIBLE: this playlist may be Spotify-owned/editorial or unavailable to your app in development mode"
      );
    }

    throw err;
  }

  let ownerProfile: SpotifyUser | null = null;

  if (playlist.owner?.id) {
    try {
      ownerProfile = await spotifyGet<SpotifyUser>(
        input.artistId,
        `https://api.spotify.com/v1/users/${encodeURIComponent(playlist.owner.id)}`
      );
    } catch (_err) {
      console.warn("SPOTIFY_OWNER_PROFILE_FETCH_FAILED", playlist.owner.id);
    }
  }

  const curatorName =
    ownerProfile?.display_name?.trim() ||
    playlist.owner?.display_name?.trim() ||
    playlist.owner?.id ||
    "Spotify Curator";

  const curatorEmail = null;
  const contactMethod = "INAPP" as const;
  const inferredGenres = inferGenresFromPlaylist(playlist);

  const rules = {
    source: "spotify-import",
    spotifyPlaylistUrl: playlist.external_urls?.spotify || null,
    spotifyOwnerUrl:
      ownerProfile?.external_urls?.spotify ||
      playlist.owner?.external_urls?.spotify ||
      null,
    spotifyOwnerId: playlist.owner?.id || null,
    spotifyOwnerDisplayName:
      ownerProfile?.display_name || playlist.owner?.display_name || null,
    spotifyFollowers: playlist.followers?.total ?? null,
    spotifyTrackCount: playlist.tracks?.total ?? null,
    spotifyDescription: playlist.description || null,
    spotifyCollaborative: playlist.collaborative ?? null,
    spotifyPublic: playlist.public ?? null,
    importedAt: new Date().toISOString(),
  };

  let curator = await prisma.curator.findFirst({
    where: {
      OR: [
        {
          name: curatorName,
          contactMethod,
        },
      ],
    },
  });

  if (!curator) {
    curator = await prisma.curator.create({
      data: {
        name: curatorName,
        email: curatorEmail,
        contactMethod,
        consent: false,
        languages: ["en"],
      },
    });
  } else {
    curator = await prisma.curator.update({
      where: { id: curator.id },
      data: {
        name: curatorName,
      },
    });
  }

  const existingPlaylist = await prisma.playlist.findFirst({
    where: {
      OR: [
        { spotifyPlaylistId: playlist.id },
        {
          curatorId: curator.id,
          name: playlist.name,
        },
      ],
    },
    include: {
      curator: true,
      _count: {
        select: {
          matches: true,
          tasteEvents: true,
        },
      },
    },
  });

  if (existingPlaylist) {
    const updated = await prisma.playlist.update({
      where: { id: existingPlaylist.id },
      data: {
        curatorId: curator.id,
        name: playlist.name,
        spotifyPlaylistId: playlist.id,
        genres: inferredGenres,
        rules,
      },
      include: {
        curator: true,
        _count: {
          select: {
            matches: true,
            tasteEvents: true,
          },
        },
      },
    });

    const autoMatching = await runAutoMatchingForImportedPlaylist(updated.id);

    return {
      ok: true,
      created: false,
      updated: true,
      playlistId: playlist.id,
      playlist: updated,
      autoMatching,
    };
  }

  const created = await prisma.playlist.create({
    data: {
      curatorId: curator.id,
      name: playlist.name,
      spotifyPlaylistId: playlist.id,
      genres: inferredGenres,
      rules,
    },
    include: {
      curator: true,
      _count: {
        select: {
          matches: true,
          tasteEvents: true,
        },
      },
    },
  });

  const autoMatching = await runAutoMatchingForImportedPlaylist(created.id);

  return {
    ok: true,
    created: true,
    updated: false,
    playlistId: playlist.id,
    playlist: created,
    autoMatching,
  };
}