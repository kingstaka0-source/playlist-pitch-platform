import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * MatchJob Queue (PostgreSQL)
 * - enqueue idempotent
 * - pull atomisch met FOR UPDATE SKIP LOCKED
 * - retries met backoff
 * - watchdog om stuck RUNNING jobs te requeue'en
 */

export type MatchJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ClaimedJob = {
  id: string;
  trackId: string;
  artistId: string;
  status: MatchJobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  result: any;
  lastError: string | null;
};

export async function enqueueMatchJob(trackId: string, artistId: string) {
  const runAt = new Date();

  const existing = await prisma.matchJob.findFirst({
    where: {
      trackId,
      status: { in: ["QUEUED", "RUNNING"] as any },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    return { jobId: existing.id };
  }

  const job = await prisma.matchJob.create({
    data: {
      status: "QUEUED" as any,
      trackId,
      artistId,
      runAt,
      attempts: 0,
      maxAttempts: 5,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      result: Prisma.JsonNull,
    },
    select: { id: true },
  });

  return { jobId: job.id };
}

/**
 * Worker pulls 1 job at a time atomically.
 * Uses Postgres locking: FOR UPDATE SKIP LOCKED
 */
export async function pullNextMatchJob(workerId: string): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    WITH next_job AS (
      SELECT id
      FROM "MatchJob"
      WHERE status = 'QUEUED'
        AND "runAt" <= NOW()
      ORDER BY "runAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "MatchJob" j
    SET
      status = 'RUNNING',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      attempts = j.attempts + 1,
      "updatedAt" = NOW()
    FROM next_job
    WHERE j.id = next_job.id
    RETURNING
      j.id,
      j."trackId",
      j."artistId",
      j.status,
      j."runAt",
      j.attempts,
      j."maxAttempts",
      j."lockedAt",
      j."lockedBy",
      j."createdAt",
      j."updatedAt",
      j.result,
      j."lastError";
  `;

  if (!rows || rows.length === 0) return null;
  return rows[0];
}

/**
 * SAFE: mark SUCCEEDED only if job is RUNNING and belongs to this workerId.
 */
export async function markJobDoneSafe(jobId: string, workerId: string, result: any) {
  await prisma.matchJob.updateMany({
    where: { id: jobId, status: "RUNNING" as any, lockedBy: workerId },
    data: {
      status: "SUCCEEDED" as any,
      result,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * SAFE: mark FAILED/QUEUED only if job is RUNNING and belongs to this workerId.
 */
export async function markJobFailedSafe(jobId: string, workerId: string, errMsg: string) {
  const job = await prisma.matchJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const attempts = Number(job.attempts ?? 0);
  const maxAttempts = Number(job.maxAttempts ?? 5);
  const shouldRetry = attempts < maxAttempts;

  await prisma.matchJob.updateMany({
    where: { id: jobId, status: "RUNNING" as any, lockedBy: workerId },
    data: {
      status: (shouldRetry ? "QUEUED" : "FAILED") as any,
      lastError: errMsg.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAt: shouldRetry ? new Date(Date.now() + backoffMs(attempts)) : job.runAt,
      updatedAt: new Date(),
    },
  });
}

/**
 * LEGACY: keeps old worker compatible.
 */
export async function markJobDone(jobId: string, result: any) {
  await prisma.matchJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED" as any,
      result,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * LEGACY
 */
export async function markJobFailed(jobId: string, errMsg: string) {
  const job = await prisma.matchJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const attempts = Number(job.attempts ?? 0);
  const maxAttempts = Number(job.maxAttempts ?? 5);
  const shouldRetry = attempts < maxAttempts;

  await prisma.matchJob.update({
    where: { id: jobId },
    data: {
      status: (shouldRetry ? "QUEUED" : "FAILED") as any,
      lastError: errMsg.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAt: shouldRetry ? new Date(Date.now() + backoffMs(attempts)) : job.runAt,
      updatedAt: new Date(),
    },
  });
}

/**
 * Requeue RUNNING jobs that got stuck.
 */
export async function requeueStuckRunningJobs(staleAfterMs = 120_000) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "MatchJob"
    SET
      status = 'QUEUED',
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "runAt" = NOW() + INTERVAL '2 seconds',
      "updatedAt" = NOW()
    WHERE status = 'RUNNING'
      AND "lockedAt" IS NOT NULL
      AND "lockedAt" < NOW() - (${staleAfterMs}::int * INTERVAL '1 millisecond')
    RETURNING id;
  `;

  return rows.length;
}

function backoffMs(attempt: number) {
  return Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
}