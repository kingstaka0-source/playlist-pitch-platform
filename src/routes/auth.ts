import { Router } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "../db";

const router = Router();

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

router.use(clerkMiddleware());

router.post("/bootstrap", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const existingArtist = await prisma.artist.findUnique({
      where: { clerkUserId: userId },
    });

    if (existingArtist) {
      return res.json({
        artist: existingArtist,
        created: false,
      });
    }

    const clerkUser = await clerkClient.users.getUser(userId);

    const email =
      clerkUser.emailAddresses.find(
        (item) => item.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      null;

    const displayName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      email?.split("@")[0] ||
      "Artist";

    const artist = await prisma.artist.create({
      data: {
        clerkUserId: userId,
        name: displayName,
        email,
        plan: "FREE",
        subscriptionStatus: "NONE",
      },
    });

    return res.status(201).json({
      artist,
      created: true,
    });
  } catch (error) {
    console.error("AUTH BOOTSTRAP ERROR", error);

    return res.status(500).json({
      error: "Could not create TuneReach artist profile",
    });
  }
});

export default router;