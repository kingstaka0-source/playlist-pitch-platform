import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";


export async function requireCurrentArtist(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "You must be signed in.",
      });
    }

    const artist = await prisma.artist.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        id: true,
        clerkUserId: true,
        name: true,
        email: true,
        plan: true,
        subscriptionStatus: true,
        spotifyArtistId: true,
        spotifyArtistName: true,
        spotifyArtistUrl: true,
        spotifyArtistImageUrl: true,
      },
    });

    if (!artist) {
      return res.status(404).json({
        error: "ARTIST_PROFILE_NOT_FOUND",
        message: "Complete account bootstrap first.",
      });
    }

    res.locals.artist = artist;

    // Tijdelijk behouden voor bestaande routes.
    // Hierdoor hoeft tracks.ts niet direct volledig herschreven te worden.
    (req as any).legal = {
      ...(req as any).legal,
      artistId: artist.id,
    };

    return next();
  } catch (error) {
    console.error("REQUIRE_CURRENT_ARTIST_ERROR", error);

    return res.status(500).json({
      error: "AUTHORIZATION_FAILED",
    });
  }
}