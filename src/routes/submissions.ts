
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

const router = Router();

function currentArtistId(res: any): string {
  return String(res.locals?.artist?.id || "").trim();
}

router.post("/", async (req, res) => {
  try {
    const artistId = currentArtistId(res);

    if (!artistId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "INVALID_REQUEST_BODY" });
    }

    const { trackId, playlistId } = body;

    if (
      typeof trackId !== "string" ||
      !trackId.trim() ||
      typeof playlistId !== "string" ||
      !playlistId.trim()
    ) {
      return res.status(400).json({
        error: "TRACK_AND_PLAYLIST_REQUIRED",
      });
    }

    const track = await prisma.track.findFirst({
      where: {
        id: trackId.trim(),
        artistId,
      },
      select: { id: true },
    });

    if (!track) {
      return res.status(404).json({
        error: "TRACK_NOT_FOUND",
      });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId.trim() },
      select: {
        id: true,
        curatorId: true,
        rules: true,
        claims: {
          where: { status: "VERIFIED" },
          select: {
            curatorId: true,
            claimantClerkUserId: true,
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({
        error: "PLAYLIST_NOT_FOUND",
      });
    }

    const verifiedClaim = playlist.claims.find(
      (claim) =>
        claim.curatorId === playlist.curatorId &&
        Boolean(claim.claimantClerkUserId)
    );

    if (!verifiedClaim) {
      return res.status(409).json({
        error: "PLAYLIST_NOT_VERIFIED",
      });
    }

    const curator = await prisma.curator.findUnique({
      where: { id: playlist.curatorId },
      select: { clerkUserId: true },
    });

    if (
      !curator?.clerkUserId ||
      curator.clerkUserId !== verifiedClaim.claimantClerkUserId
    ) {
      return res.status(409).json({
        error: "PLAYLIST_NOT_VERIFIED",
      });
    }

    const rules = playlist.rules;

    const settings =
      rules &&
      typeof rules === "object" &&
      !Array.isArray(rules) &&
      "curatorSettings" in rules
        ? rules.curatorSettings
        : null;

    const accepting =
      settings &&
      typeof settings === "object" &&
      !Array.isArray(settings) &&
      "acceptingSubmissions" in settings &&
      settings.acceptingSubmissions === true;

    if (!accepting) {
      return res.status(409).json({
        error: "SUBMISSIONS_CLOSED",
      });
    }

    const submission = await prisma.submission.create({
      data: {
        trackId: track.id,
        playlistId: playlist.id,
        artistId,
        curatorId: playlist.curatorId,
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        trackId: true,
        playlistId: true,
      },
    });

    return res.status(201).json({
      ok: true,
      submission,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "ALREADY_SUBMITTED",
      });
    }

    console.error("SUBMISSION_CREATE_ERROR", error);

    return res.status(500).json({
      error: "SUBMISSION_CREATE_ERROR",
    });
  }
});

router.get("/mine", async (_req, res) => {
  try {
    const artistId = currentArtistId(res);

    if (!artistId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const submissions = await prisma.submission.findMany({
      where: { artistId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        track: {
          select: { id: true, title: true },
        },
        playlist: {
          select: { id: true, name: true },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });

    return res.json({ ok: true, submissions });
  } catch (error) {
    console.error("SUBMISSIONS_MINE_ERROR", error);

    return res.status(500).json({
      error: "SUBMISSIONS_MINE_ERROR",
    });
  }
});

export default router;
