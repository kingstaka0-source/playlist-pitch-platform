import "dotenv/config";
import { prisma } from "../db";

const subjectId =
  process.argv.find((a) => a.startsWith("cml")) ||
  process.env.ARTIST_ID ||
  process.env.NEXT_PUBLIC_ARTIST_ID;

if (!subjectId) {
  throw new Error(
    "Missing subjectId. Run: pnpm ts-node scripts/accept-pitch-consent.ts <ARTIST_ID>"
  );
}

console.log("USING SUBJECT ID:", subjectId);

async function upsertAcceptance(subjectId: string) {
  const existing = await prisma.agreementAcceptance.findFirst({
    where: {
      subjectType: "ARTIST" as any,
      subjectId,
      docType: "PITCH_CONSENT" as any,
      version: "2026-02-16",
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.agreementAcceptance.update({
      where: { id: existing.id },
      data: { acceptedAt: new Date() },
      select: { id: true, subjectId: true, acceptedAt: true },
    });
    console.log("✅ Updated acceptance:", updated);
    return;
  }

  const created = await prisma.agreementAcceptance.create({
    data: {
      subjectType: "ARTIST" as any,
      subjectId,
      docType: "PITCH_CONSENT" as any,
      version: "2026-02-16",
      acceptedAt: new Date(),
    },
    select: { id: true, subjectId: true, acceptedAt: true },
  });

  console.log("✅ Created acceptance:", created);
}

async function main() {
  if (!subjectId) {
    throw new Error("subjectId is required");
  }

  await upsertAcceptance(subjectId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });