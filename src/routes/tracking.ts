import { Router } from "express";
import { prisma } from "../db";

export const tracking = Router();

tracking.get("/open/:pitchId", async (req, res) => {
  const pixel = Buffer.from(
    "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64",
  );

  try {
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

    const openedAt = new Date();

    // =====================================
    // EXISTING PITCH TRACKING
    // =====================================

    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        openCount: {
          increment: 1,
        },
        lastOpenedAt: openedAt,
      },
    });

    // =====================================
    // CAMPAIGN EVENT TRACKING
    // =====================================

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

            type: "OPENED",

            createdAt: openedAt,

            metadata: {
              userAgent:
                req.get("user-agent") || null,
            },
          },
        });

        console.log(
          "CAMPAIGN EMAIL OPENED",
          campaignId,
          pitchId,
        );
      } else {
        console.warn(
          "OPEN_TRACKING_CAMPAIGN_ITEM_NOT_FOUND",
          {
            campaignId,
            campaignItemId,
            pitchId,
            matchId,
          },
        );
      }
    }
  } catch (error) {
    console.error(
      "OPEN_TRACKING_ERROR",
      error,
    );
  }

  // Pixel altijd teruggeven.
  // Een trackingfout mag de afbeelding niet breken.
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", pixel.length);
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );

  return res.status(200).send(pixel);
}); 