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
  events: any[] = [],
) {
  const campaignPitches = campaign.items.flatMap((item: any) => {
    if (!item.pitchId) return [];

    const pitch = pitchById.get(item.pitchId);

    return pitch ? [pitch] : [];
  });

  const sentEvents = events.filter(
  (event: any) => event.type === "SENT",
);

const openedEvents = events.filter(
  (event: any) => event.type === "OPENED",
);

const clickedEvents = events.filter(
  (event: any) => event.type === "CLICKED",
);

const repliedEvents = events.filter(
  (event: any) => event.type === "REPLIED",
);

const sentCount = new Set(
  sentEvents.map((event: any) => event.campaignItemId),
).size;

const opens = openedEvents.length;
const clicks = clickedEvents.length;
const replies = repliedEvents.length;

  const interestedEvents = events.filter(
  (event: any) => event.type === "INTERESTED",
);

const declinedEvents = events.filter(
  (event: any) => event.type === "DECLINED",
);

const playlistedEvents = events.filter(
  (event: any) => event.type === "PLAYLISTED",
);

const interestedCurators = new Set(
  interestedEvents.map((event: any) => event.campaignItemId),
).size;

const negativeReplies = new Set(
  declinedEvents.map((event: any) => event.campaignItemId),
).size;

const placements = new Set(
  playlistedEvents.map((event: any) => event.campaignItemId),
).size;

  const uniqueOpened = new Set(
  openedEvents.map((event: any) => event.campaignItemId),
).size;

const uniqueClicked = new Set(
  clickedEvents.map((event: any) => event.campaignItemId),
).size;

const uniqueReplied = new Set(
  repliedEvents.map((event: any) => event.campaignItemId),
).size;

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

      const campaignIds = histories.map(
  (campaign) => campaign.id,
);

const campaignEvents =
  campaignIds.length > 0
    ? await prisma.campaignEvent.findMany({
        where: {
          campaignId: {
            in: campaignIds,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      })
    : [];

const eventsByCampaignId = new Map<string, any[]>();

for (const event of campaignEvents) {
  const existing =
    eventsByCampaignId.get(event.campaignId) || [];

  existing.push(event);

  eventsByCampaignId.set(
    event.campaignId,
    existing,
  );
}

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
      eventsByCampaignId.get(campaign.id) || [],
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
  events,
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

router.post(
  "/:id/items/:campaignItemId/reply",
  async (req, res) => {
    try {
      const artistId = getArtistId(res);

      const campaignId = String(
        req.params.id || "",
      ).trim();

      const campaignItemId = String(
        req.params.campaignItemId || "",
      ).trim();

      const status = String(
        req.body?.status || "",
      )
        .trim()
        .toUpperCase();

      if (!artistId) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
        });
      }

      if (
        status !== "INTERESTED" &&
        status !== "DECLINED"
      ) {
        return res.status(400).json({
          error: "INVALID_REPLY_STATUS",
          allowed: [
            "INTERESTED",
            "DECLINED",
          ],
        });
      }

      const campaign =
        await prisma.campaignHistory.findFirst({
          where: {
            id: campaignId,
            trackId: {
              in: (
                await prisma.track.findMany({
                  where: {
                    artistId,
                  },
                  select: {
                    id: true,
                  },
                })
              ).map((track) => track.id),
            },
          },
          select: {
            id: true,
          },
        });

      if (!campaign) {
        return res.status(404).json({
          error: "CAMPAIGN_NOT_FOUND",
        });
      }

      const campaignItem =
        await prisma.campaignHistoryItem.findFirst({
          where: {
            id: campaignItemId,
            campaignId,
          },
        });

      if (!campaignItem) {
        return res.status(404).json({
          error: "CAMPAIGN_ITEM_NOT_FOUND",
        });
      }

      if (!campaignItem.pitchId) {
        return res.status(400).json({
          error: "CAMPAIGN_ITEM_HAS_NO_PITCH",
        });
      }

      const repliedAt = new Date();

      await prisma.pitch.update({
        where: {
          id: campaignItem.pitchId,
        },
        data: {
          replyCount: {
            increment: 1,
          },

          lastRepliedAt: repliedAt,

          positiveReply:
            status === "INTERESTED",

          negativeReply:
            status === "DECLINED",
        },
      });

      await prisma.campaignEvent.create({
        data: {
          campaignId,
          campaignItemId,

          pitchId:
            campaignItem.pitchId,

          matchId:
            campaignItem.matchId,

          type: "REPLIED",

          createdAt: repliedAt,

          metadata: {
            status,
          },
        },
      });

      await prisma.campaignEvent.create({
        data: {
          campaignId,
          campaignItemId,

          pitchId:
            campaignItem.pitchId,

          matchId:
            campaignItem.matchId,

          type:
            status === "INTERESTED"
              ? "INTERESTED"
              : "DECLINED",

          createdAt: repliedAt,

          metadata: {
            status,
          },
        },
      });

      return res.json({
        ok: true,
        campaignId,
        campaignItemId,
        status,
      });
    } catch (error: any) {
      console.error(
        "CAMPAIGN_REPLY_ERROR",
        error?.message ?? error,
      );

      return res.status(500).json({
        error: "CAMPAIGN_REPLY_FAILED",
        message:
          error?.message ?? String(error),
      });
    }
  },
);

router.post(
  "/:id/items/:campaignItemId/playlist",
  async (req, res) => {
    try {
      const artistId = getArtistId(res);

      const campaignId = String(
        req.params.id || "",
      ).trim();

      const campaignItemId = String(
        req.params.campaignItemId || "",
      ).trim();

      if (!artistId) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
        });
      }

      const trackIds = (
        await prisma.track.findMany({
          where: {
            artistId,
          },
          select: {
            id: true,
          },
        })
      ).map((track) => track.id);

      const campaign =
        await prisma.campaignHistory.findFirst({
          where: {
            id: campaignId,
            trackId: {
              in: trackIds,
            },
          },
          select: {
            id: true,
          },
        });

      if (!campaign) {
        return res.status(404).json({
          error: "CAMPAIGN_NOT_FOUND",
        });
      }

      const campaignItem =
        await prisma.campaignHistoryItem.findFirst({
          where: {
            id: campaignItemId,
            campaignId,
          },
        });

      if (!campaignItem) {
        return res.status(404).json({
          error: "CAMPAIGN_ITEM_NOT_FOUND",
        });
      }

      if (!campaignItem.pitchId) {
        return res.status(400).json({
          error: "CAMPAIGN_ITEM_HAS_NO_PITCH",
        });
      }

      const playlistedAt = new Date();

      await prisma.pitch.update({
        where: {
          id: campaignItem.pitchId,
        },
        data: {
          playlistDetected: true,
          playlistedAt,
        },
      });

      const existingEvent =
        await prisma.campaignEvent.findFirst({
          where: {
            campaignId,
            campaignItemId,
            type: "PLAYLISTED",
          },
          select: {
            id: true,
          },
        });

      if (!existingEvent) {
        await prisma.campaignEvent.create({
          data: {
            campaignId,
            campaignItemId,
            pitchId: campaignItem.pitchId,
            matchId: campaignItem.matchId,
            type: "PLAYLISTED",
            createdAt: playlistedAt,
            metadata: {
              source: "manual",
            },
          },
        });
      }

      return res.json({
        ok: true,
        campaignId,
        campaignItemId,
        playlistedAt,
      });
    } catch (error: any) {
      console.error(
        "CAMPAIGN_PLAYLISTED_ERROR",
        error?.message ?? error,
      );

      return res.status(500).json({
        error: "CAMPAIGN_PLAYLISTED_FAILED",
        message:
          error?.message ?? String(error),
      });
    }
  },
);

export default router;