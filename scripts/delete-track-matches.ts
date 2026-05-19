import { prisma } from "../src/db";

async function main() {
  const trackId = process.argv[2];

  if (!trackId) {
    throw new Error("Missing trackId");
  }

  const matches = await prisma.match.findMany({
    where: { trackId },
    select: { id: true },
  });

  const matchIds = matches.map((m) => m.id);

  await prisma.pitch.deleteMany({
    where: { matchId: { in: matchIds } },
  });

  await prisma.match.deleteMany({
    where: { trackId },
  });

  console.log("Deleted matches and pitches for track:", trackId);
  console.log("matches:", matchIds.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());