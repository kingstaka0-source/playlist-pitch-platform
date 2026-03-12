import { Router } from "express";
import { prisma } from "../db";
import { Prisma } from "@prisma/client";

export const matchJobs = Router();

function getIp(req: any) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress ?? null;
}

/**
 * GET /match-jobs/:jobId
 * -> frontend kan pollen tot status SUCCEEDED/FAILED
 */
matchJobs.get("/match-jobs/:jobId", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const job = await prisma.matchJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        trackId: true,
        artistId: true,
        runAt: true,
        attempts: true,
        maxAttempts: true,
        lockedAt: true,
        lockedBy: true,
        lastError: true,
        result: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!job) return res.status(404).json({ error: "MatchJob not found" });

    return res.json({ ok: true, job });
  } catch (e: any) {
    console.error("MATCH JOBS GET ERROR", e?.message ?? e);
    return res.status(500).json({ error: "match job get failed" });
  }
});

/**
 * POST /match-jobs/:jobId/retry
 * -> alleen als FAILED, zet terug naar QUEUED en reset lock
 */
matchJobs.post("/match-jobs/:jobId/retry", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    const job = await prisma.matchJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, attempts: true, maxAttempts: true },
    });

    if (!job) return res.status(404).json({ error: "MatchJob not found" });

    if (job.status !== ("FAILED" as any)) {
      return res.status(400).json({
        error: "NOT_FAILED",
        message: "Only FAILED jobs can be retried",
        status: job.status,
      });
    }

    const updated = await prisma.matchJob.update({
      where: { id: jobId },
      data: {
        status: "QUEUED" as any,
        runAt: new Date(Date.now() + 250),
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        result: Prisma.JsonNull,
      },
      select: { id: true, status: true, runAt: true, attempts: true },
    });

    return res.json({
      ok: true,
      job: updated,
      meta: {
        retriedAt: new Date().toISOString(),
        ip: getIp(req),
        userAgent: String(req.headers["user-agent"] || ""),
      },
    });
  } catch (e: any) {
    console.error("MATCH JOBS RETRY ERROR", e?.message ?? e);
    return res.status(500).json({ error: "match job retry failed" });
  }
});
