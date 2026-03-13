import { PrismaClient, Channel, PitchStatus, Plan, ContactMethod } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const artistId = "cmmnjti0n0004112o3orl713x";

  const artist = await prisma.artist.upsert({
    where: { id: artistId },
    update: {},
    create: {
      id: artistId,
      name: "King Staka",
      email: "kingstaka0@gmail.com",
      plan: Plan.FREE,
    },
  });

  const curator = await prisma.curator.create({
    data: {
      name: "Test Curator",
      email: `testcurator_${Date.now()}@example.com`,
      contactMethod: ContactMethod.EMAIL,
      consent: true,
      languages: ["en"],
    },
  });

  const playlist = await prisma.playlist.create({
    data: {
      name: "Reggae Test Playlist",
      curatorId: curator.id,
      genres: ["reggae", "roots", "dub"],
      rules: { note: "Test playlist for matching flow" },
    } as any,
  });

  const track = await prisma.track.create({
    data: {
      title: "Test Track",
      artistId: artist.id,
      spotifyTrackId: `test_track_${Date.now()}`,
      durationMs: 180000,
      artists: ["King Staka"],
      audioFeatures: {},
    } as any,
  });

  const match = await prisma.match.create({
    data: {
      trackId: track.id,
      playlistId: playlist.id,
      fitScore: 80,
      explanation: "Strong reggae fit for this playlist.",
    } as any,
  });

  const pitch = await prisma.pitch.create({
    data: {
      matchId: match.id,
      subject: "Test Pitch",
      body: "Hello, this is a test pitch for the seeded playlist.",
      channel: Channel.INAPP,
      status: PitchStatus.DRAFT,
    },
  });

  console.log("DONE");
  console.log({
    artistId: artist.id,
    trackId: track.id,
    playlistId: playlist.id,
    matchId: match.id,
    pitchId: pitch.id,
  });
}

main()
  .catch((e) => {
    console.error("SEED ERROR:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });