
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";

const router = Router();

router.get("/dashboard", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Please sign in to TuneReach.",
      });
    }

    const curator = await prisma.curator.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!curator) {
      return res.status(404).json({
        error: "CURATOR_NOT_FOUND",
        message: "No verified curator account found.",
      });
    }

    const claims = await prisma.playlistClaim.findMany({
      where: {
        curatorId: curator.id,
        claimantClerkUserId: userId,
        status: "VERIFIED",
      },
      select: {
        id: true,
        verifiedAt: true,
        playlist: {
          select: {
            id: true,
            name: true,
            description: true,
            spotifyPlaylistId: true,
            spotifyUrl: true,
            ownerDisplayName: true,
            genres: true,
          },
        },
      },
      orderBy: {
        verifiedAt: "desc",
      },
    });

    const playlists = claims.map((claim) => ({
      ...claim.playlist,
      claimId: claim.id,
      verifiedAt: claim.verifiedAt,
      verificationStatus: "VERIFIED",
    }));

    return res.json({
      curator,
      stats: {
        verifiedPlaylists: playlists.length,
      },
      playlists,
    });
  } catch (error) {
    console.error("CURATOR_DASHBOARD_ERROR", error);

    return res.status(500).json({
      error: "CURATOR_DASHBOARD_ERROR",
      message: "Could not load curator dashboard.",
    });
  }
});

export default router;
