import { Router } from "express";
import { prisma } from "../db";

export const clickTracking = Router();

clickTracking.get("/click/:pitchId", async (req, res) => {
  try {
    const { pitchId } = req.params;
    const targetUrl = String(req.query.url || "");

    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        clickCount: {
          increment: 1,
        },
        lastClickedAt: new Date(),
      },
    });

    if (targetUrl) {
      return res.redirect(targetUrl);
    }

    return res.redirect("https://spotify.com");
  } catch (err) {
    console.error(err);

    const targetUrl = String(req.query.url || "https://spotify.com");
    return res.redirect(targetUrl);
  }
});
