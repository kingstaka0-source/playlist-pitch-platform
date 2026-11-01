import { Router } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "You must be signed in.",
      });
    }

    const playlistId = String(req.body?.playlistId || "").trim();

    if (!playlistId) {
      return res.status(400).json({
        error: "PLAYLIST_ID_REQUIRED",
      });
    }

    const playlist = await prisma.playlist.findUnique({
      where: {
        id: playlistId,
      },
      select: {
        id: true,
        curatorId: true,
        name: true,
        spotifyPlaylistId: true,
        spotifyUrl: true,
        ownerDisplayName: true,
        ownerSpotifyId: true,
        curator: {
          select: {
            id: true,
            clerkUserId: true,
            name: true,
          },
        },
        claims: {
          select: {
            id: true,
            claimantClerkUserId: true,
            status: true,
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({
        error: "PLAYLIST_NOT_FOUND",
      });
    }

    if (
      playlist.curator.clerkUserId &&
      playlist.curator.clerkUserId !== userId
    ) {
      return res.status(409).json({
        error: "CURATOR_ALREADY_LINKED",
        message: "This curator profile is already linked to another account.",
      });
    }

    const existingClaim = playlist.claims[0] ?? null;

    if (existingClaim) {
      if (existingClaim.claimantClerkUserId === userId) {
        return res.status(200).json({
          claim: existingClaim,
          created: false,
        });
      }

      return res.status(409).json({
        error: "PLAYLIST_ALREADY_CLAIMED",
        status: existingClaim.status,
      });
    }

    const claim = await prisma.playlistClaim.create({
      data: {
        playlistId: playlist.id,
        curatorId: playlist.curatorId,
        claimantClerkUserId: userId,
        status: "PENDING",
      },
      select: {
        id: true,
        playlistId: true,
        curatorId: true,
        claimantClerkUserId: true,
        status: true,
        verificationMethod: true,
        createdAt: true,
        updatedAt: true,
        verifiedAt: true,
        rejectedAt: true,
      },
    });

    return res.status(201).json({
      claim,
      created: true,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        spotifyPlaylistId: playlist.spotifyPlaylistId,
        spotifyUrl: playlist.spotifyUrl,
        ownerDisplayName: playlist.ownerDisplayName,
        ownerSpotifyId: playlist.ownerSpotifyId,
      },
    });
  } catch (error) {
    console.error("CREATE_PLAYLIST_CLAIM_ERROR", error);

    return res.status(500).json({
      error: "COULD_NOT_CREATE_PLAYLIST_CLAIM",
    });
  }
});

export default router;