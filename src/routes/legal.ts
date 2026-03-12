import { Router } from "express";
import { AgreementDocType, AgreementSubjectType } from "@prisma/client";
import { prisma } from "../db";

export const legal = Router();

/**
 * POST /legal/accept
 * body: { subjectType, subjectId, docType, version }
 */
legal.post("/legal/accept", async (req, res) => {
  try {
    const subjectType = String(req.body?.subjectType || "").trim();
    const subjectId = String(req.body?.subjectId || "").trim();
    const docType = String(req.body?.docType || "").trim();
    const version = String(req.body?.version || "").trim();

    if (!subjectType || !subjectId || !docType || !version) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "subjectType, subjectId, docType, version required",
      });
    }

    const safeSubjectType = subjectType as AgreementSubjectType;
    const safeDocType = docType as AgreementDocType;

    const acceptance = await prisma.agreementAcceptance.create({
      data: {
        subjectType: safeSubjectType,
        subjectId,
        docType: safeDocType,
        version,
        acceptedAt: new Date(),
      },
    });

    return res.json({ ok: true, acceptance });
  } catch (err: any) {
    console.error("LEGAL ACCEPT ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "LEGAL_ACCEPT_FAILED",
      details: err?.message ?? String(err),
    });
  }
});

/**
 * GET /legal/acceptances?subjectType=...&subjectId=...
 */
legal.get("/legal/acceptances", async (req, res) => {
  try {
    const subjectType = String(req.query.subjectType || "").trim();
    const subjectId = String(req.query.subjectId || "").trim();

    if (!subjectType || !subjectId) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "subjectType and subjectId required",
      });
    }

    const safeSubjectType = subjectType as AgreementSubjectType;

    const list = await prisma.agreementAcceptance.findMany({
      where: {
        subjectType: safeSubjectType,
        subjectId,
      },
      orderBy: { acceptedAt: "desc" },
    });

    return res.json({ ok: true, list });
  } catch (err: any) {
    console.error("LEGAL LIST ERROR", err?.message ?? err);
    return res.status(500).json({
      error: "LEGAL_LIST_FAILED",
      details: err?.message ?? String(err),
    });
  }
});