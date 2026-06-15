import { Router } from "express";
import { prisma } from "../db";

export const tracking = Router();

tracking.get("/open/:pitchId", async (req, res) => {
  try {
    const { pitchId } = req.params;

    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
  openCount: {
    increment: 1,
  },
  lastOpenedAt: new Date(),
},
    });

    const pixel = Buffer.from(
      "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64"
    );

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Length", pixel.length);

    return res.send(pixel);
  } catch {
    return res.status(200).end();
  }
});