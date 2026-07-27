import { Router } from "express";
import { AgreementDocType, AgreementSubjectType } from "@prisma/client";
import { prisma } from "../db";

export const legal = Router();

const CURRENT = {
  TERMS: "2026-02-16",
  PRIVACY: "2026-02-16",
  PITCH_CONSENT: "2026-02-16",
  BILLING_TERMS: "2026-02-16",
} as const;

const allowedDocTypes = new Set<AgreementDocType>([
  AgreementDocType.TERMS,
  AgreementDocType.PRIVACY,
  AgreementDocType.PITCH_CONSENT,
  AgreementDocType.BILLING_TERMS,
]);

/**
 * POST /legal/accept
 * body: { docType, version? }
 *
 * subjectType en subjectId worden door de server bepaald.
 */
legal.post("/legal/accept", async (req, res) => {
  try {
    const artist = res.locals.artist;

    if (!artist?.id) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Authenticated artist is required.",
      });
    }

    const docType = String(req.body?.docType || "").trim() as AgreementDocType;

    if (!docType || !allowedDocTypes.has(docType)) {
      return res.status(400).json({
        error: "INVALID_DOC_TYPE",
        message: "A valid docType is required.",
      });
    }

    const currentVersion = CURRENT[docType as keyof typeof CURRENT];

    if (!currentVersion) {
      return res.status(400).json({
        error: "UNSUPPORTED_DOC_TYPE",
        message: "No current version exists for this document type.",
      });
    }

    const requestedVersion = String(req.body?.version || "").trim();

    if (requestedVersion && requestedVersion !== currentVersion) {
      return res.status(400).json({
        error: "INVALID_DOCUMENT_VERSION",
        message: `The current version for ${docType} is ${currentVersion}.`,
      });
    }

    const subjectType = AgreementSubjectType.ARTIST;
    const subjectId = artist.id;
    const acceptedAt = new Date();

    const acceptance = await prisma.agreementAcceptance.upsert({
      where: {
        subject_doc_version_unique: {
          subjectType,
          subjectId,
          docType,
          version: currentVersion,
        },
      },
      update: {
        acceptedAt,
      },
      create: {
        subjectType,
        subjectId,
        docType,
        version: currentVersion,
        acceptedAt,
      },
    });

    return res.json({
      ok: true,
      acceptance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    console.error("LEGAL ACCEPT ERROR", message);

    return res.status(500).json({
      error: "LEGAL_ACCEPT_FAILED",
      details: message,
    });
  }
});

/**
 * GET /legal/acceptances
 *
 * Geeft alleen acceptaties van de ingelogde artiest terug.
 */
legal.get("/legal/acceptances", async (_req, res) => {
  try {
    const artist = res.locals.artist;

    if (!artist?.id) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Authenticated artist is required.",
      });
    }

    const list = await prisma.agreementAcceptance.findMany({
      where: {
        subjectType: AgreementSubjectType.ARTIST,
        subjectId: artist.id,
      },
      orderBy: {
        acceptedAt: "desc",
      },
    });

    return res.json({
      ok: true,
      currentVersions: CURRENT,
      list,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    console.error("LEGAL LIST ERROR", message);

    return res.status(500).json({
      error: "LEGAL_LIST_FAILED",
      details: message,
    });
  }
});