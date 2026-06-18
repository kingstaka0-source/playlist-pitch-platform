import { Router } from "express";
import { prisma } from "../db";

export const followups = Router();

followups.get("/followups", async (_req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pitches = await prisma.pitch.findMany({
      where: {
        status: "SENT",
        openCount: {
          gt: 0,
        },
        replyCount: 0,
        followUpSent: false,
        lastOpenedAt: {
          lte: sevenDaysAgo,
        },
      },
      include: {
        match: {
          include: {
            track: true,
            playlist: {
              include: {
                curator: true,
              },
            },
          },
        },
      },
      orderBy: {
        lastOpenedAt: "asc",
      },
      take: 100,
    });

    return res.json({
      ok: true,
      count: pitches.length,
      followups: pitches.map((pitch) => ({
        id: pitch.id,
        subject: pitch.subject,
        sentTo: pitch.sentTo,
        sentAt: pitch.sentAt,
        openCount: pitch.openCount,
        clickCount: pitch.clickCount,
        replyCount: pitch.replyCount,
        lastOpenedAt: pitch.lastOpenedAt,
        followUpSent: pitch.followUpSent,
        followUpSentAt: pitch.followUpSentAt,
        track: {
          id: pitch.match.track.id,
          title: pitch.match.track.title,
          artists: pitch.match.track.artists,
        },
        playlist: {
          id: pitch.match.playlist.id,
          name: pitch.match.playlist.name,
        },
        curator: pitch.match.playlist.curator
          ? {
              id: pitch.match.playlist.curator.id,
              name: pitch.match.playlist.curator.name,
              email: pitch.match.playlist.curator.email,
            }
          : null,
      })),
    });
  } catch (error: any) {
    console.error("FOLLOWUPS_LIST_ERROR", error?.message ?? error);
    return res.status(500).json({
      error: "FOLLOWUPS_LIST_FAILED",
      message: error?.message ?? String(error),
    });
  }
});

followups.post("/followups/:id/mark-sent", async (req, res) => {
  try {
    const pitchId = String(req.params.id || "").trim();

    const updated = await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        followUpSent: true,
        followUpSentAt: new Date(),
      },
    });

    return res.json({
      ok: true,
      pitch: updated,
    });
  } catch (error: any) {
    console.error("FOLLOWUP_MARK_SENT_ERROR", error?.message ?? error);
    return res.status(500).json({
      error: "FOLLOWUP_MARK_SENT_FAILED",
      message: error?.message ?? String(error),
    });
  }
});