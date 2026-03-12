import type { Request, Response, NextFunction } from "express";
import { prisma } from "./db";

type SubjectType = "ARTIST" | "CURATOR";
type DocType = "TERMS" | "PRIVACY" | "PITCH_CONSENT" | "BILLING_TERMS";

// Houd dit gelijk aan legal.ts
const CURRENT = {
  TERMS: "2026-02-16",
  PRIVACY: "2026-02-16",
  PITCH_CONSENT: "2026-02-16",
  BILLING_TERMS: "2026-02-16",
} as const;

function pickFirst(...vals: any[]) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function getSubject(req: Request, subjectType: SubjectType) {
  // ✅ Support BOTH styles:
  // - New: artistId / x-artist-id
  // - Old: subjectId / x-subject-id
  if (subjectType === "ARTIST") {
    const id = pickFirst(
      (req.body as any)?.artistId,
      (req.query as any)?.artistId,
      req.headers["x-artist-id"],
      // legacy aliases:
      (req.body as any)?.subjectId,
      (req.query as any)?.subjectId,
      req.headers["x-subject-id"]
    );
    return id || null;
  }

  if (subjectType === "CURATOR") {
    const id = pickFirst(
      (req.body as any)?.curatorId,
      (req.query as any)?.curatorId,
      req.headers["x-curator-id"]
    );
    return id || null;
  }

  return null;
}

export function requireLegal(subjectType: SubjectType, docType: DocType) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subjectId = getSubject(req, subjectType);
      if (!subjectId) {
        return res.status(400).json({
          error: "MISSING_SUBJECT_ID",
          message:
            subjectType === "ARTIST"
              ? "Missing artistId/subjectId (body/query/x-artist-id/x-subject-id)"
              : "Missing curatorId (body/query/x-curator-id)",
        });
      }

      const requiredVersion = (CURRENT as any)[docType] as string | undefined;
      if (!requiredVersion) {
        return res.status(500).json({
          error: "LEGAL_CONFIG_ERROR",
          message: "Unknown docType config",
        });
      }

      const row = await prisma.agreementAcceptance.findFirst({
        where: {
          subjectType: subjectType as any,
          subjectId,
          docType: docType as any,
          version: requiredVersion,
        },
        select: { id: true, acceptedAt: true },
      });

      if (!row) {
        return res.status(403).json({
          error: "LEGAL_NOT_ACCEPTED",
          subjectType,
          subjectId,
          docType,
          requiredVersion,
        });
      }

      return next();
    } catch (e: any) {
      console.error("LEGAL GATE ERROR", e?.message ?? e);
      return res.status(500).json({ error: "LEGAL_GATE_FAILED" });
    }
  };
}