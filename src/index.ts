import "dotenv/config";
import express from "express";
import cors from "cors";

import { prisma } from "./db";
import { env } from "./env";

import { health } from "./routes/health";
import { artists } from "./routes/artists";
import { tracks } from "./routes/tracks";
import { curators } from "./routes/curators";
import { playlists } from "./routes/playlists";
import { matches } from "./routes/matches";
import pitches from "./routes/pitches";
import { intake } from "./routes/intake";
import { dashboard } from "./routes/dashboard";
import { billing } from "./routes/billing";
import { spotifyAuth } from "./routes/spotifyAuth";
import { stripeWebhookHandler } from "./routes/stripeWebhooks";
import { legal } from "./routes/legal";
import { matchJobs } from "./routes/matchJobs";
import { requireLegal } from "./legalGate";
import { spotifyDebug } from "./routes/spotifyDebug";
import ai from "./routes/ai";

const app = express();

function logStartupConfig() {
  const emailFrom = String(process.env.EMAIL_FROM || "").trim();
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  const resendTestTo = String(process.env.RESEND_TEST_TO || "").trim();
  const spotifyClientId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
  const spotifyClientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();
  const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();

  console.log("STARTUP CONFIG", {
    nodeEnv: process.env.NODE_ENV || "development",
    port: env.PORT || 3100,
    databaseConfigured: !!databaseUrl,
    spotifyClientIdConfigured: !!spotifyClientId,
    spotifyClientSecretConfigured: !!spotifyClientSecret,
    resendConfigured: !!resendApiKey,
    emailFromConfigured: !!emailFrom,
    resendTestToConfigured: !!resendTestTo,
    stripeWebhookSecretConfigured: !!stripeWebhookSecret,
  });

  if (!databaseUrl) {
    console.warn("ENV WARNING: DATABASE_URL is missing.");
  }

  if (!spotifyClientId || !spotifyClientSecret) {
    console.warn(
      "ENV WARNING: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing. Spotify routes may fail."
    );
  }

  if (!resendApiKey) {
    console.warn(
      "ENV WARNING: RESEND_API_KEY is missing. Email send routes will fail."
    );
  }

  if (!emailFrom) {
    console.warn(
      "ENV WARNING: EMAIL_FROM is missing. Email send routes will fail."
    );
  }

  if (
    emailFrom.toLowerCase() === "onboarding@resend.dev" &&
    !resendTestTo
  ) {
    console.warn(
      "ENV WARNING: EMAIL_FROM is onboarding@resend.dev but RESEND_TEST_TO is missing."
    );
  }
}

process.on("uncaughtException", (error: Error) => {
  console.error("UNCAUGHT EXCEPTION", {
    message: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("UNHANDLED REJECTION", reason);
});

app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  })
);

app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

app.use(express.json({ limit: "1mb" }));

app.use(health);
app.use(legal);
app.use(spotifyAuth);

app.use("/billing", requireLegal("ARTIST", "BILLING_TERMS"));
app.use("/pitches", requireLegal("ARTIST", "PITCH_CONSENT"));
app.use("/intake/track", requireLegal("ARTIST", "TERMS"));
app.use("/intake/track", requireLegal("ARTIST", "PRIVACY"));

console.log("ROUTES CHECK", {
  health: !!health,
  artists: !!artists,
  tracks: !!tracks,
  curators: !!curators,
  playlists: !!playlists,
  matches: !!matches,
  pitches: !!pitches,
  intake: !!intake,
  dashboard: !!dashboard,
  billing: !!billing,
  matchJobs: !!matchJobs,
  spotifyDebug: !!spotifyDebug,
  ai: !!ai,
});

app.use(artists);
app.use(tracks);
app.use(curators);
app.use(playlists);
app.use(matches);
app.use("/pitches", pitches);
app.use(intake);
app.use(billing);
app.use(dashboard);
app.use(matchJobs);
app.use(spotifyDebug);
app.use("/ai", ai);

app.get("/admin/cleanup-edm", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      error: "DISABLED_IN_PRODUCTION",
    });
  }

  try {
    const duplicates = await prisma.playlist.findMany({
      where: { name: "EDM Bangers" },
      orderBy: { createdAt: "asc" },
    });

    if (duplicates.length <= 1) {
      return res.json({
        ok: true,
        message: "No duplicates found",
        count: duplicates.length,
      });
    }

    const keep = duplicates[0];
    const toDelete = duplicates.slice(1);

    const report: Array<{
      playlistId: string;
      deletedPitches: number;
      deletedMatches: number;
    }> = [];

    for (const playlist of toDelete) {
      const matchesForPlaylist = await prisma.match.findMany({
        where: { playlistId: playlist.id },
        select: { id: true },
      });

      const matchIds = matchesForPlaylist.map((match) => match.id);

      const pitchesDeleted = matchIds.length
        ? await prisma.pitch.deleteMany({
            where: {
              matchId: {
                in: matchIds,
              },
            },
          })
        : { count: 0 };

      const matchesDeleted = await prisma.match.deleteMany({
        where: { playlistId: playlist.id },
      });

      await prisma.playlist.delete({
        where: { id: playlist.id },
      });

      report.push({
        playlistId: playlist.id,
        deletedPitches: pitchesDeleted.count,
        deletedMatches: matchesDeleted.count,
      });
    }

    return res.json({
      ok: true,
      kept: { id: keep.id, name: keep.name },
      deletedPlaylists: report,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: "CLEANUP_EDM_FAILED",
      message,
    });
  }
});

app.use("/api", (_req, res) => {
  return res.status(404).json({
    error: "API_ROUTE_NOT_FOUND",
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "INTERNAL_SERVER_ERROR";
  console.error("EXPRESS_ERROR", err);

  if (res.headersSent) {
    return;
  }

  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message,
  });
});

const port = Number(process.env.PORT || 3100);

logStartupConfig();

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});

server.on("error", (error: Error) => {
  console.error("SERVER LISTEN ERROR", {
    message: error.message,
    stack: error.stack,
  });
});