import type { Request, Response, NextFunction } from "express";
import { getArtistUsage } from "./routes/artists";

function getArtistIdFromRequest(req: Request) {
  const headerArtistId =
    typeof req.headers?.["x-artist-id"] === "string"
      ? req.headers["x-artist-id"]
      : "";

  const queryArtistId =
    typeof req.query?.artistId === "string" ? req.query.artistId : "";

  const bodyArtistId =
    typeof (req.body as any)?.artistId === "string"
      ? (req.body as any).artistId
      : "";

  const paramArtistId =
    typeof req.params?.artistId === "string"
      ? req.params.artistId
      : typeof req.params?.id === "string"
      ? req.params.id
      : "";

  return String(
    headerArtistId || queryArtistId || bodyArtistId || paramArtistId || ""
  ).trim();
}

export async function attachUsage(req: Request, res: Response, next: NextFunction) {
  try {
    const artistId = getArtistIdFromRequest(req);

    if (!artistId) {
      return res.status(400).json({
        error: "MISSING_ARTIST_ID",
        message: "artistId is required for paywall checks",
      });
    }

    const usage = await getArtistUsage(artistId);

    if (!usage) {
      return res.status(404).json({
        error: "ARTIST_NOT_FOUND",
      });
    }

    (req as any).artistUsage = usage;
    (req as any).artistId = artistId;

    return next();
  } catch (error: any) {
    console.error("ATTACH_USAGE_FAILED", error?.message ?? error);
    return res.status(500).json({
      error: "ATTACH_USAGE_FAILED",
      message: error?.message ?? String(error),
    });
  }
}

export async function requirePaidPlan(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const artistId = getArtistIdFromRequest(req);

    if (!artistId) {
      return res.status(400).json({
        error: "MISSING_ARTIST_ID",
      });
    }

    const usage = await getArtistUsage(artistId);

    if (!usage) {
      return res.status(404).json({
        error: "ARTIST_NOT_FOUND",
      });
    }

    if (usage.plan === "FREE") {
      return res.status(403).json({
        error: "PRO_REQUIRED",
        message: "Upgrade to PRO to access this feature.",
        upgradeRequired: true,
        paywall: {
          plan: usage.plan,
          feature: "PRO_ONLY",
          month: usage.month,
        },
      });
    }

    (req as any).artistUsage = usage;
    (req as any).artistId = artistId;

    return next();
  } catch (error: any) {
    console.error("REQUIRE_PAID_PLAN_FAILED", error?.message ?? error);
    return res.status(500).json({
      error: "REQUIRE_PAID_PLAN_FAILED",
      message: error?.message ?? String(error),
    });
  }
}

export async function requirePitchAllowance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const artistId = getArtistIdFromRequest(req);

    if (!artistId) {
      return res.status(400).json({
        error: "MISSING_ARTIST_ID",
      });
    }

    const usage = await getArtistUsage(artistId);

    if (!usage) {
      return res.status(404).json({
        error: "ARTIST_NOT_FOUND",
      });
    }

    if (!usage.allowed) {
      return res.status(403).json({
        error: "PITCH_LIMIT_REACHED",
        message: "Free plan limit reached. Upgrade to PRO for unlimited pitches.",
        upgradeRequired: true,
        paywall: {
          plan: usage.plan,
          feature: "PITCH_CREATE_LIMIT",
          month: usage.month,
        },
      });
    }

    (req as any).artistUsage = usage;
    (req as any).artistId = artistId;

    return next();
  } catch (error: any) {
    console.error("REQUIRE_PITCH_ALLOWANCE_FAILED", error?.message ?? error);
    return res.status(500).json({
      error: "REQUIRE_PITCH_ALLOWANCE_FAILED",
      message: error?.message ?? String(error),
    });
  }
}