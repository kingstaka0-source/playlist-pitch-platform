
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";

const router = Router();

const reviewStatuses = new Set([
  "IN_REVIEW",
  "ACCEPTED",
  "REJECTED",
]);

async function getCurator(userId: string) {
  return prisma.curator.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
}

function verifiedPlaylistFilter(curatorId: string, userId: string) {
  return {
    curatorId,
    playlist: {
      claims: {
        some: {
          curatorId,
          claimantClerkUserId: userId,
          status: "VERIFIED" as const,
        },
      },
    },
  };
}

router.get("/submissions", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    const curator = await getCurator(userId);

    if (!curator) {
      return res.status(404).json({
        error: "CURATOR_NOT_FOUND",
      });
    }

    const submissions = await prisma.submission.findMany({
      where: verifiedPlaylistFilter(curator.id, userId),
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        reviewNotes: true,
        track: {
          select: {
            id: true,
            title: true,
            artists: true,
            spotifyTrackId: true,
            spotifyUrl: true,
          },
        },
        playlist: {
          select: {
            id: true,
            name: true,
          },
        },
        artist: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });

    return res.json({
      ok: true,
      submissions,
    });
  } catch (error) {
    console.error("CURATOR_SUBMISSIONS_LIST_ERROR", error);

    return res.status(500).json({
      error: "CURATOR_SUBMISSIONS_LIST_ERROR",
    });
  }
});

router.patch("/submissions/:id", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    const curator = await getCurator(userId);

    if (!curator) {
      return res.status(404).json({
        error: "CURATOR_NOT_FOUND",
      });
    }

    const submissionId = String(req.params.id || "").trim();

    if (!submissionId) {
      return res.status(400).json({
        error: "SUBMISSION_ID_REQUIRED",
      });
    }

    const body: unknown = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error: "INVALID_REQUEST_BODY",
      });
    }

    const input = body as Record<string, unknown>;
    const keys = Object.keys(input);

    if (
      keys.length === 0 ||
      keys.some(
        (key) => !["status", "reviewNotes"].includes(key)
      ) ||
      typeof input.status !== "string" ||
      !reviewStatuses.has(input.status) ||
      (input.reviewNotes !== undefined &&
        input.reviewNotes !== null &&
        (typeof input.reviewNotes !== "string" ||
          input.reviewNotes.length > 2000))
    ) {
      return res.status(400).json({
        error: "INVALID_REVIEW",
      });
    }

    const filter = verifiedPlaylistFilter(
      curator.id,
      userId
    );

    const existing = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        ...filter,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        error: "SUBMISSION_NOT_FOUND",
      });
    }

    if (
      existing.status === "ACCEPTED" ||
      existing.status === "REJECTED"
    ) {
      return res.status(409).json({
        error: "SUBMISSION_ALREADY_FINAL",
      });
    }

    const nextStatus = input.status as
      | "IN_REVIEW"
      | "ACCEPTED"
      | "REJECTED";

    const result = await prisma.submission.updateMany({
      where: {
        id: submissionId,
        ...filter,
        status: {
          in: ["PENDING", "IN_REVIEW"],
        },
      },
      data: {
        status: nextStatus,
        reviewedAt: new Date(),
        ...(Object.prototype.hasOwnProperty.call(
          input,
          "reviewNotes"
        )
          ? {
              reviewNotes: input.reviewNotes as
                | string
                | null,
            }
          : {}),
      },
    });

    if (result.count === 0) {
      return res.status(409).json({
        error: "SUBMISSION_STATE_CHANGED",
      });
    }

    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        ...filter,
      },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        reviewNotes: true,
      },
    });

    return res.json({
      ok: true,
      submission,
    });
  } catch (error) {
    console.error("CURATOR_SUBMISSION_REVIEW_ERROR", error);

    return res.status(500).json({
      error: "CURATOR_SUBMISSION_REVIEW_ERROR",
    });
  }
});

export default router;
