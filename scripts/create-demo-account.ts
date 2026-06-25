import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_ARTIST_ID = "demo_tunereach_artist";
const DEMO_EMAIL = "demo@tunereach.app";

async function main() {
  console.log("Creating TuneReach demo account...");

  const artist = await prisma.artist.upsert({
    where: { id: DEMO_ARTIST_ID },
    update: {
      name: "TuneReach Demo Artist",
      email: DEMO_EMAIL,
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
    create: {
      id: DEMO_ARTIST_ID,
      name: "TuneReach Demo Artist",
      email: DEMO_EMAIL,
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  });

  console.log("Demo artist ready:", artist.id);

  const demoTracks = [
    {
      title: "Rainforest Riddim",
      spotifyTrackId: "36fmtAOp2tJbyM8AP95tFv",
      artists: ["TuneReach Demo"],
      genre: "reggae",
      tempo: 120,
      energy: 0.62,
    },
    {
      title: "Island Sunset",
      spotifyTrackId: "demo_island_sunset",
      artists: ["TuneReach Demo"],
      genre: "reggae",
      tempo: 96,
      energy: 0.54,
    },
    {
      title: "Midnight Groove",
      spotifyTrackId: "demo_midnight_groove",
      artists: ["TuneReach Demo"],
      genre: "afrobeats",
      tempo: 103,
      energy: 0.71,
    },
  ];

  const curators = [
    {
      name: "Reggae Daily",
      email: "reggaedaily@example.com",
      playlist: "Fresh Reggae Finds",
      opens: 5,
      clicks: 2,
      positiveReply: true,
    },
    {
      name: "Roots Weekly",
      email: "rootsweekly@example.com",
      playlist: "Roots & Culture Weekly",
      opens: 3,
      clicks: 1,
      positiveReply: false,
    },
    {
      name: "Island Flow",
      email: "islandflow@example.com",
      playlist: "Island Flow Selects",
      opens: 4,
      clicks: 2,
      positiveReply: true,
    },
    {
      name: "Caribbean Grooves",
      email: "caribbeangrooves@example.com",
      playlist: "Caribbean Grooves",
      opens: 2,
      clicks: 0,
      positiveReply: false,
    },
    {
      name: "Afro Fusion Hub",
      email: "afrofusion@example.com",
      playlist: "Afro Fusion Rotation",
      opens: 6,
      clicks: 3,
      positiveReply: true,
    },
    {
      name: "Indie Playlist Lab",
      email: "indieplaylistlab@example.com",
      playlist: "Independent Gems",
      opens: 1,
      clicks: 0,
      positiveReply: false,
    },
  ];

  let createdTracks = 0;
  let createdCurators = 0;
  let createdPlaylists = 0;
  let createdMatches = 0;
  let createdPitches = 0;

  for (const trackData of demoTracks) {
    const existingTrack = await prisma.track.findFirst({
  where: {
    OR: [
      {
        artistId: artist.id,
        title: trackData.title,
      },
      {
        spotifyTrackId: trackData.spotifyTrackId,
      },
    ],
  },
});

const track = existingTrack
  ? await prisma.track.update({
      where: { id: existingTrack.id },
      data: {
        spotifyTrackId: trackData.spotifyTrackId,
        artists: trackData.artists,
        genres: [trackData.genre],
        audioFeatures: {
          tempo: trackData.tempo,
          energy: trackData.energy,
        },
        durationMs: 210000,
      },
    })
  : await prisma.track.create({
      data: {
        artistId: artist.id,
        title: trackData.title,
        spotifyTrackId: trackData.spotifyTrackId,
        artists: trackData.artists,
        genres: [trackData.genre],
        audioFeatures: {
          tempo: trackData.tempo,
          energy: trackData.energy,
        },
        durationMs: 210000,
      },
    });

    createdTracks += 1;

    for (const curatorData of curators) {
      const curator = await prisma.curator.upsert({
        where: {
          email: curatorData.email,
        },
        update: {
          name: curatorData.name,
          contactMethod: "EMAIL",
          consent: true,
          languages: ["en"],
          contactConfidence: 90,
        },
        create: {
          name: curatorData.name,
          email: curatorData.email,
          contactMethod: "EMAIL",
          consent: true,
          languages: ["en"],
          contactConfidence: 90,
        },
      });

      createdCurators += 1;

      const demoPlaylistId = `demo_${curatorData.playlist
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")}`;

const existingPlaylist = await prisma.playlist.findFirst({
  where: {
    spotifyPlaylistId: demoPlaylistId,
    curatorId: curator.id,
  },
});

const playlist = existingPlaylist
  ? await prisma.playlist.update({
      where: { id: existingPlaylist.id },
      data: {
        name: curatorData.playlist,
        genres: [trackData.genre],
        curatorId: curator.id,
        description: `Demo playlist for ${curatorData.name}`,
        spotifyUrl: "https://open.spotify.com/",
      },
    })
  : await prisma.playlist.create({
      data: {
        name: curatorData.playlist,
        spotifyPlaylistId: demoPlaylistId,
        genres: [trackData.genre],
        curatorId: curator.id,
        description: `Demo playlist for ${curatorData.name}`,
        spotifyUrl: "https://open.spotify.com/",
      },
    });

      createdPlaylists += 1;

      const match = await prisma.match.upsert({
  where: {
    trackId_playlistId: {
      trackId: track.id,
      playlistId: playlist.id,
    },
  },
  update: {
    fitScore: 82,
    explanation: `This playlist is a strong ${trackData.genre} match because the track has similar energy, mood and audience fit.`,
  },
  create: {
    trackId: track.id,
    playlistId: playlist.id,
    fitScore: 82,
    explanation: `This playlist is a strong ${trackData.genre} match because the track has similar energy, mood and audience fit.`,
  },
});

      createdMatches += 1;

      const openedAt = new Date();
      openedAt.setDate(openedAt.getDate() - 8);

      const sentAt = new Date();
      sentAt.setDate(sentAt.getDate() - 10);

      await prisma.pitch.upsert({
        where: {
          matchId: match.id,
        },
        update: {
          subject: `Track suggestion: ${track.title}`,
          body: `Hi ${curator.name},

I came across "${playlist.name}" and thought "${track.title}" could be a strong fit.

The track matches the playlist energy and audience, and I would love to hear your thoughts.

Best regards,
TuneReach Demo`,
          channel: "EMAIL",
          status: "SENT",
          sentAt,
          sentTo: curator.email,
          openCount: curatorData.opens,
          clickCount: curatorData.clicks,
          replyCount: curatorData.positiveReply ? 1 : 0,
          positiveReply: curatorData.positiveReply,
          lastOpenedAt: openedAt,
          lastClickedAt: curatorData.clicks > 0 ? openedAt : null,
          lastRepliedAt: curatorData.positiveReply ? openedAt : null,
          followUpSent: !curatorData.positiveReply && curatorData.opens > 0,
          followUpSentAt:
            !curatorData.positiveReply && curatorData.opens > 0
              ? new Date()
              : null,
          playlistDetected: curatorData.positiveReply,
          playlistedAt: curatorData.positiveReply ? new Date() : null,
        },
        create: {
          matchId: match.id,
          subject: `Track suggestion: ${track.title}`,
          body: `Hi ${curator.name},

I came across "${playlist.name}" and thought "${track.title}" could be a strong fit.

The track matches the playlist energy and audience, and I would love to hear your thoughts.

Best regards,
TuneReach Demo`,
          channel: "EMAIL",
          status: "SENT",
          sentAt,
          sentTo: curator.email,
          openCount: curatorData.opens,
          clickCount: curatorData.clicks,
          replyCount: curatorData.positiveReply ? 1 : 0,
          positiveReply: curatorData.positiveReply,
          lastOpenedAt: openedAt,
          lastClickedAt: curatorData.clicks > 0 ? openedAt : null,
          lastRepliedAt: curatorData.positiveReply ? openedAt : null,
          followUpSent: !curatorData.positiveReply && curatorData.opens > 0,
          followUpSentAt:
            !curatorData.positiveReply && curatorData.opens > 0
              ? new Date()
              : null,
          playlistDetected: curatorData.positiveReply,
          playlistedAt: curatorData.positiveReply ? new Date() : null,
        },
      });

      createdPitches += 1;
    }
  }

  console.log("Demo seed complete:", {
    artistId: artist.id,
    email: artist.email,
    createdTracks,
    createdCurators,
    createdPlaylists,
    createdMatches,
    createdPitches,
  });
}

main()
  .catch((error) => {
    console.error("DEMO_SEED_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });