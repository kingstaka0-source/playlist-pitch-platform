  import { triggerMatchesForTrack } from "./matching";
  import "dotenv/config";
  import { randomUUID } from "crypto";
  import {
    pullNextMatchJob,
    markJobDoneSafe,
    markJobFailedSafe,
    requeueStuckRunningJobs,
    type ClaimedJob,
  } from "./matchQueue"; // ⚠️ PAS AAN ALS JOUW BESTANDSNAAM ANDERS IS
  // ^ Dit moet verwijzen naar het bestand waar jij enqueue/pull/mark functies in hebt gezet.

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- instellingen (FASE 1) ---
  const POLL_MS = 750;          // ✅ 500–1000ms
  const WATCHDOG_EVERY_MS = 60_000; // ✅ 60s
  const STALE_RUNNING_MS = 120_000; // ✅ 2 min

  // Worker id voor locking / logs
  const workerId = `worker_${randomUUID().slice(0, 8)}`;

  function log(...args: any[]) {
    console.log(new Date().toISOString(), `[${workerId}]`, ...args);
  }

  async function processJob(job: ClaimedJob) {
    const started = Date.now();
    log(`JOB CLAIMED id=${job.id} trackId=${job.trackId} attempts=${job.attempts}/${job.maxAttempts}`);

    try {
      // ⚠️ HIER roep jij jouw matching logic aan.
      // Vervang onderstaande stub met jouw echte functie.
      //
      // Voorbeeld:
      // const result = await runMatchingForTrack(job.trackId, job.artistId);
      //
      // result moet iets zijn dat je in job.result wil opslaan.

      const result = await runMatching(job);

      await markJobDoneSafe(job.id, workerId, result);

      const ms = Date.now() - started;
      log(`JOB SUCCEEDED id=${job.id} durationMs=${ms}`);
    } catch (err: any) {
      const ms = Date.now() - started;
      const msg = err?.message ? String(err.message) : String(err);
      log(`JOB FAILED id=${job.id} durationMs=${ms} error=${msg}`);

      // Mark failed (met retry/backoff in jouw queue file)
      await markJobFailedSafe(job.id, workerId, msg);
    }
  }

  async function watchdogLoop() {
    while (true) {
      try {
        const n = await requeueStuckRunningJobs(STALE_RUNNING_MS);
        if (n > 0) log(`WATCHDOG requeued=${n} stuck RUNNING jobs`);
      } catch (e: any) {
        log(`WATCHDOG ERROR`, e?.message ?? e);
      }

      await sleep(WATCHDOG_EVERY_MS);
    }
  }

  async function main() {
    log(`MATCH WORKER STARTED 🚀`);
    // Start watchdog parallel
    void watchdogLoop();

    // Main polling loop (no overlap)
    while (true) {
      try {
        const job = await pullNextMatchJob(workerId);

        if (!job) {
          // idle
          await sleep(POLL_MS);
          continue;
        }

        // Process 1 job at a time (stabiliteit > throughput)
        await processJob(job);
      } catch (e: any) {
        // Nooit silent crash
        log(`WORKER LOOP ERROR`, e?.message ?? e);
        await sleep(1000);
      }
    }
  }

  // --------------------
  // ⚠️ VERVANG DIT MET JOUW ECHTE MATCHING FUNCTIE
  // --------------------
  async function runMatching(job: ClaimedJob) {
  const result = await triggerMatchesForTrack(job.trackId);
return result;
}

  main().catch((e) => {
    // ts-node-dev respawn zal opnieuw starten, maar log eerst
    console.error(new Date().toISOString(), `[${workerId}] FATAL`, e);
    process.exit(1);
  });