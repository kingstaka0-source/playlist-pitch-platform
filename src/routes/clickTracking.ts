import { Router } from "express";
import { prisma } from "../db";

export const clickTracking = Router();

clickTracking.get("/click/:pitchId", async (req, res) => {
  const { pitchId } = req.params;

  const campaignId = String(
    req.query.campaignId || "",
  ).trim();

  const campaignItemId = String(
    req.query.campaignItemId || "",
  ).trim();

  const matchId = String(
    req.query.matchId || "",
  ).trim();

  const clickedAt = new Date();

  try {
    const pitch = await prisma.pitch.findUnique({
      where: {
        id: pitchId,
      },
      select: {
        id: true,
        match: {
          select: {
            track: {
              select: {
                spotifyTrackId: true,
              },
            },
          },
        },
      },
    });

    if (!pitch?.match?.track?.spotifyTrackId) {
      return res.status(404).send("Track not found");
    }

    const targetUrl =
      `https://open.spotify.com/track/` +
      encodeURIComponent(pitch.match.track.spotifyTrackId);

    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        clickCount: {
          increment: 1,
        },
        lastClickedAt: clickedAt,
      },
    });

    if (campaignId && campaignItemId && matchId) {
      const campaignItem =
        await prisma.campaignHistoryItem.findFirst({
          where: {
            id: campaignItemId,
            campaignId,
            matchId,
            pitchId,
          },
          select: {
            id: true,
          },
        });

      if (campaignItem) {
        await prisma.campaignEvent.create({
          data: {
            campaignId,
            campaignItemId,
            pitchId,
            matchId,

            type: "CLICKED",

            createdAt: clickedAt,

            metadata: {
              targetUrl,
              userAgent:
                req.get("user-agent") || null,
            },
          },
        });

        console.log(
          "CAMPAIGN LINK CLICKED",
          campaignId,
          pitchId,
        );
      } else {
        console.warn(
          "CLICK_TRACKING_CAMPAIGN_ITEM_NOT_FOUND",
          {
            campaignId,
            campaignItemId,
            pitchId,
            matchId,
          },
        );
      }
    }

    return res.redirect(targetUrl);
  } catch (error) {
    console.error(
      "CLICK_TRACKING_ERROR",
      error,
    );

    return res.status(404).send("Tracking link not found");
  }
});
