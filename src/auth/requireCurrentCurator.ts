import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";

export async function requireCurrentCurator(
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

    const curator = await prisma.curator.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        id: true,
        clerkUserId: true,
        name: true,
        email: true,
        contactMethod: true,
        consent: true,
        languages: true,
      },
    });

    if (!curator) {
      return res.status(404).json({
        error: "CURATOR_PROFILE_NOT_FOUND",
        message: "Complete curator account setup first.",
      });
    }

    res.locals.curator = curator;

    return next();
  } catch (error) {
    console.error("REQUIRE_CURRENT_CURATOR_ERROR", error);

    return res.status(500).json({
      error: "AUTHORIZATION_FAILED",
    });
  }
}