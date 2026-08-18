import { Router, type Response } from "express";
import { prisma } from "../db";

const router = Router();

function getArtistId(res: Response): string {
  return String(res.locals?.artist?.id || "").trim();
}

function buildCampaignPayload(
  campaign: any,
  track: any,
  matchById: Map<string, any>,
  pitchById: Map<string, any>,
) {
  const campaignPitches = campaign.items.flatMap((item: any) => {
    if (!item.pitchId) return [];

    const pitch = pitchById.get(item.pitchId);

    return pitch ? [pitch] : [];
  });

  const sentPitches = campaignPitches.filter(
    (pitch: any) => pitch.sentAt !== null,
  );

  const sentCount = sentPitches.length;

  const opens = campaignPitches.reduce(
    (total: number, pitch: any) =>
      total + (pitch.openCount ?? 0),
    0,
  );

  const clicks = campaignPitches.reduce(
    (total: number, pitch: any) =>
      total + (pitch.clickCount ?? 0),
    0,
  );

  const replies = campaignPitches.reduce(
    (total: number, pitch: any) =>
      total + (pitch.replyCount ?? 0),
    0,
  );

  const interestedCurators = campaignPitches.filter(
    (pitch: any) => pitch.positiveReply === true,
  ).length;

  const negativeReplies = campaignPitches.filter(
    (pitch: any) => pitch.negativeReply === true,
  ).length;

  const placements = campaignPitches.filter(
    (pitch: any) => pitch.playlistDetected === true,
  ).length;

  const uniqueOpened = campaignPitches.filter(
    (pitch: any) => (pitch.openCount ?? 0) > 0,
  ).length;

  const uniqueClicked = campaignPitches.filter(
    (pitch: any) => (pitch.clickCount ?? 0) > 0,
  ).length;

  const uniqueReplied = campaignPitches.filter(
    (pitch: any) => (pitch.replyCount ?? 0) > 0,
  ).length;

  const openRate =
    sentCount > 0
      ? Math.round((uniqueOpened / sentCount) * 100)
      : 0;

  const clickRate =
    sentCount > 0
      ? Math.round((uniqueClicked / sentCount) * 100)
      : 0;

  const replyRate =
    sentCount > 0
      ? Math.round((uniqueReplied / sentCount) * 100)
      : 0;

  const placementRate =
    sentCount > 0
      ? Math.round((placements / sentCount) * 100)
      : 0;

  const items = campaign.items.map((item: any) => {
    const match = matchById.get(item.matchId);

    const pitch = item.pitchId
      ? pitchById.get(item.pitchId)
      : undefined;

    return {
      id: item.id,
      matchId: item.matchId,
      pitchId: item.pitchId,

      fitScore: match?.fitScore ?? null,

      playlist: match?.playlist
        ? {
            id: match.playlist.id,
            name: match.playlist.name,

            spotifyPlaylistId:
              match.playlist.spotifyPlaylistId ?? null,

            genres:
              match.playlist.genres ?? [],

            curator: match.playlist.curator
              ? {
                  id: match.playlist.curator.id,
                  name:
                    match.playlist.curator.name ||
                    "Unknown curator",
                  email:
                    match.playlist.curator.email ?? null,
                }
              : null,
          }
        : null,

      pitch: pitch
        ? {
            id: pitch.id,
            subject: pitch.subject,
            body: pitch.body,
            status: pitch.status,

            sentTo: pitch.sentTo,
            sentAt: pitch.sentAt,

            openCount: pitch.openCount,
            clickCount: pitch.clickCount,
            replyCount: pitch.replyCount,

            positiveReply:
              pitch.positiveReply,

            negativeReply:
              pitch.negativeReply,

            playlistDetected:
              pitch.playlistDetected,

            playlistedAt:
              pitch.playlistedAt,

            lastOpenedAt:
              pitch.lastOpenedAt,

            lastClickedAt:
              pitch.lastClickedAt,

            lastRepliedAt:
              pitch.lastRepliedAt,
          }
        : null,

      createdAt: item.createdAt,
    };
  });

  return {
    id: campaign.id,

    trackId: campaign.trackId,
    trackTitle:
      track?.title || "Unknown track",

    trackArtists:
      track?.artists || [],

    spotifyTrackId:
      track?.spotifyTrackId || null,

    spotifyUrl:
      track?.spotifyUrl || null,

    status: campaign.status,

    selectedPlaylists:
      campaign.selectedPlaylists,

    eligibleMatches:
      campaign.matchesCount,

    generatedPitches:
      campaign.generatedPitches,

    emailsSent: sentCount,

    skippedAlreadySent:
      campaign.skippedAlreadySent,

    skippedNoEmail:
      campaign.skippedNoEmail,

    skippedFakeEmail:
      campaign.skippedFakeEmail,

    failed:
      campaign.failed,

    opens,
    clicks,
    replies,

    interestedCurators,
    negativeReplies,
    placements,

    openRate,
    clickRate,
    replyRate,
    placementRate,

    items,

    createdAt:
      campaign.createdAt,

    updatedAt:
      campaign.updatedAt,
  };
}

/**
 * GET /campaigns
 *
 * Campaign history list for current artist.
 */
router.get("/", async (_req, res) => {
  try {
    const artistId = getArtistId(res);

    if (!artistId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    const tracks = await prisma.track.findMany({
      where: {
        artistId,
      },
      select: {
        id: true,
        title: true,
        artists: true,
        spotifyTrackId: true,
        spotifyUrl: true,
      },
    });

    if (tracks.length === 0) {
      return res.json({
        ok: true,
        campaigns: [],
      });
    }

    const trackIds = tracks.map(
      (track) => track.id,
    );

    const trackById = new Map(
      tracks.map((track) => [
        track.id,
        track,
      ]),
    );

    const histories =
      await prisma.campaignHistory.findMany({
        where: {
          trackId: {
            in: trackIds,
          },
        },

        include: {
          items: true,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    const matchIds = Array.from(
      new Set(
        histories.flatMap((campaign) =>
          campaign.items.map(
            (item) => item.matchId,
          ),
        ),
      ),
    );

    const matches =
      matchIds.length > 0
        ? await prisma.match.findMany({
            where: {
              id: {
                in: matchIds,
              },
            },

            include: {
              playlist: {
                include: {
                  curator: true,
                },
              },
            },
          })
        : [];

    const matchById = new Map(
      matches.map((match) => [
        match.id,
        match,
      ]),
    );

    const pitchIds = Array.from(
      new Set(
        histories.flatMap((campaign) =>
          campaign.items
            .map((item) => item.pitchId)
            .filter(
              (pitchId): pitchId is string =>
                typeof pitchId === "string" &&
                pitchId.length > 0,
            ),
        ),
      ),
    );

    const pitches =
      pitchIds.length > 0
        ? await prisma.pitch.findMany({
            where: {
              id: {
                in: pitchIds,
              },
            },

            select: {
              id: true,
              matchId: true,

              subject: true,
              body: true,

              status: true,

              sentTo: true,
              sentAt: true,

              openCount: true,
              clickCount: true,
              replyCount: true,

              positiveReply: true,
              negativeReply: true,

              playlistDetected: true,
              playlistedAt: true,

              lastOpenedAt: true,
              lastClickedAt: true,
              lastRepliedAt: true,
            },
          })
        : [];

    const pitchById = new Map(
      pitches.map((pitch) => [
        pitch.id,
        pitch,
      ]),
    );

    const campaigns = histories.map(
      (campaign) =>
        buildCampaignPayload(
          campaign,
          trackById.get(campaign.trackId),
          matchById,
          pitchById,
        ),
    );

    return res.json({
      ok: true,
      campaigns,
    });
  } catch (error: any) {
    console.error(
      "GET_CAMPAIGNS_ERROR",
      error?.message ?? error,
    );

    return res.status(500).json({
      error: "GET_CAMPAIGNS_FAILED",
      message:
        error?.message ?? String(error),
    });
  }
});

/**
 * GET /campaigns/:id
 *
 * Full detail for one campaign.
 */
router.get("/:id", async (req, res) => {
  try {
    const artistId = getArtistId(res);

    const campaignId = String(
      req.params.id || "",
    ).trim();

    if (!artistId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    if (!campaignId) {
      return res.status(400).json({
        error: "MISSING_CAMPAIGN_ID",
      });
    }

    const campaign =
      await prisma.campaignHistory.findUnique({
        where: {
          id: campaignId,
        },

        include: {
          items: true,
        },
      });

    if (!campaign) {
      return res.status(404).json({
        error: "CAMPAIGN_NOT_FOUND",
      });
    }

    // Important:
    // verify this campaign belongs to current artist.
    const track = await prisma.track.findFirst({
      where: {
        id: campaign.trackId,
        artistId,
      },

      select: {
        id: true,
        title: true,
        artists: true,
        spotifyTrackId: true,
        spotifyUrl: true,
      },
    });

    if (!track) {
      return res.status(404).json({
        error: "CAMPAIGN_NOT_FOUND",
      });
    }

    const matchIds = campaign.items.map(
      (item) => item.matchId,
    );

    const pitchIds = campaign.items
      .map((item) => item.pitchId)
      .filter(
        (pitchId): pitchId is string =>
          typeof pitchId === "string" &&
          pitchId.length > 0,
      );

    const matches =
      matchIds.length > 0
        ? await prisma.match.findMany({
            where: {
              id: {
                in: matchIds,
              },
            },

            include: {
              playlist: {
                include: {
                  curator: true,
                },
              },
            },
          })
        : [];

    const pitches =
      pitchIds.length > 0
        ? await prisma.pitch.findMany({
            where: {
              id: {
                in: pitchIds,
              },
            },

            select: {
              id: true,
              matchId: true,

              subject: true,
              body: true,

              status: true,

              sentTo: true,
              sentAt: true,

              openCount: true,
              clickCount: true,
              replyCount: true,

              positiveReply: true,
              negativeReply: true,

              playlistDetected: true,
              playlistedAt: true,

              lastOpenedAt: true,
              lastClickedAt: true,
              lastRepliedAt: true,
            },
          })
        : [];

    const matchById = new Map(
      matches.map((match) => [
        match.id,
        match,
      ]),
    );

    const pitchById = new Map(
      pitches.map((pitch) => [
        pitch.id,
        pitch,
      ]),
    );

    // =====================================
// CAMPAIGN EVENTS
// =====================================

const events = await prisma.campaignEvent.findMany({
  where: {
    campaignId: campaign.id,
  },
  orderBy: {
    createdAt: "asc",
  },
  select: {
    id: true,
    campaignId: true,
    campaignItemId: true,
    pitchId: true,
    matchId: true,
    type: true,
    createdAt: true,
    metadata: true,
  },
});

const result = buildCampaignPayload(
  campaign,
  track,
  matchById,
  pitchById,
);

return res.json({
  ok: true,
  campaign: {
    ...result,
    events,
  },
});
  } catch (error: any) {
    console.error(
      "GET_CAMPAIGN_DETAIL_ERROR",
      error?.message ?? error,
    );

    return res.status(500).json({
      error: "GET_CAMPAIGN_DETAIL_FAILED",
      message:
        error?.message ?? String(error),
    });
  }
});

export default router;