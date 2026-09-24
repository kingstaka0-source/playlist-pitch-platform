import { prisma } from "../db";
import {
  getActionableContactType,
  type ActionableContactType,
} from "../lib/curatorContactQuality";

export const DAILY_ACTIONABLE_PLAYLIST_LIMIT = 100;

export type VerifiedPlaylistCandidate = {
  playlistId: string;
  spotifyPlaylistId: string | null;
  playlistName: string;
  curatorId: string;
  curatorName: string;
  contactType: Exclude<ActionableContactType, "NONE">;
  contactConfidence: number;
};

export type PlaylistPipelineResult = {
  inspected: number;
  actionableFound: number;
  accepted: number;
  rejectedNoContact: number;
  byContactType: {
    EMAIL: number;
    SUBMISSION: number;
    INSTAGRAM: number;
  };
  candidates: VerifiedPlaylistCandidate[];
};

export async function findVerifiedPlaylistCandidates(
  limit = DAILY_ACTIONABLE_PLAYLIST_LIMIT
): Promise<PlaylistPipelineResult> {
  const safeLimit = Math.max(
    1,
    Math.min(DAILY_ACTIONABLE_PLAYLIST_LIMIT, Math.floor(limit))
  );

  const playlists = await prisma.playlist.findMany({
    select: {
      id: true,
      spotifyPlaylistId: true,
      name: true,
      createdAt: true,
      curator: {
        select: {
          id: true,
          name: true,
          email: true,
          submissionUrl: true,
          instagramUrl: true,
          websiteUrl: true,
          contactConfidence: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const candidates: VerifiedPlaylistCandidate[] = [];

  const byContactType = {
    EMAIL: 0,
    SUBMISSION: 0,
    INSTAGRAM: 0,
  };

  let actionableFound = 0;
  let rejectedNoContact = 0;

  for (const playlist of playlists) {
    const contactType = getActionableContactType(playlist.curator);

    if (contactType === "NONE") {
      rejectedNoContact++;
      continue;
    }

    actionableFound++;
    byContactType[contactType]++;

    if (candidates.length >= safeLimit) {
      continue;
    }

    candidates.push({
      playlistId: playlist.id,
      spotifyPlaylistId: playlist.spotifyPlaylistId,
      playlistName: playlist.name,
      curatorId: playlist.curator.id,
      curatorName: playlist.curator.name,
      contactType,
      contactConfidence: playlist.curator.contactConfidence ?? 0,
    });
  }

  return {
    inspected: playlists.length,
    actionableFound,
    accepted: candidates.length,
    rejectedNoContact,
    byContactType,
    candidates,
  };
}