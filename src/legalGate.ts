import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";

type SubjectType = "ARTIST" | "CURATOR";

type DocType =
  | "TERMS"
  | "PRIVACY"
  | "PITCH_CONSENT"
  | "BILLING_TERMS";

const CURRENT = {
  TERMS: "2026-02-16",
  PRIVACY: "2026-02-16",
  PITCH_CONSENT: "2026-02-16",
  BILLING_TERMS: "2026-02-16",
} as const;

function getAuthenticatedSubjectId(
  req: Request,
  res: Response,
  subjectType: SubjectType,
) {
  if (subjectType === "ARTIST") {
    const artistId = String(
      res.locals.artist?.id ||
        (req as any)?.legal?.artistId ||
        "",
    ).trim();

    return artistId || null;
  }

  // Curator-authenticatie heeft later een eigen accountkoppeling nodig.
  return null;
}

export function requireLegal(
  subjectType: SubjectType,
  docType: DocType,
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const subjectId = getAuthenticatedSubjectId(
        req,
        res,
        subjectType,
      );

      if (!subjectId) {
        return res.status(401).json({
          error: "AUTHENTICATED_SUBJECT_REQUIRED",
          subjectType,
        });
      }

      const requiredVersion = CURRENT[docType];

      const acceptance =
        await prisma.agreementAcceptance.findUnique({
          where: {
            subject_doc_version_unique: {
              subjectType,
              subjectId,
              docType,
              version: requiredVersion,
            },
          },
          select: {
            id: true,
            acceptedAt: true,
          },
        });

      if (!acceptance) {
        return res.status(403).json({
          error: "LEGAL_NOT_ACCEPTED",
          subjectType,
          subjectId,
          docType,
          requiredVersion,
        });
      }

      (req as any).legal = {
        ...(req as any).legal,
        artistId:
          subjectType === "ARTIST"
            ? subjectId
            : (req as any)?.legal?.artistId,
        subjectType,
        subjectId,
        docType,
        version: requiredVersion,
      };

      return next();
    } catch (error) {
      console.error("LEGAL_GATE_ERROR", error);

      return res.status(500).json({
        error: "LEGAL_GATE_FAILED",
      });
    }
  };
}