import type { NextFunction, Request, Response } from "express";
import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export async function requireAdmin(
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

    const user = await clerkClient.users.getUser(userId);

    const role = user.publicMetadata?.role;

    if (role !== "admin") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Admin access required.",
      });
    }

    res.locals.adminUserId = userId;

    return next();
  } catch (error) {
    console.error("REQUIRE_ADMIN_ERROR", error);

    return res.status(500).json({
      error: "ADMIN_AUTHORIZATION_FAILED",
    });
  }
}
