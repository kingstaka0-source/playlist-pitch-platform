import "dotenv/config";
import { prisma } from "../src/db";

const subjectId = process.argv[2];

if (!subjectId) {
  console.error("Usage: pnpm ts-node scripts/accept-pitch-consent-for.ts <ARTIST_ID>");
  process.exit(1);
}

async function main() {
  const docType = "PITCH_CONSENT" as any;
  const version = "2026-02-16";

  const existing = await prisma.agreementAcceptance.findFirst({
    where: {
      subjectType: "ARTIST" as any,
      subjectId,
      docType,
      version,
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.agreementAcceptance.update({
      where: { id: existing.id },
      data: { acceptedAt: new Date() },
      select: { id: true, subjectId: true, docType: true, version: true, acceptedAt: true },
    });
    console.log("✅ UPDATED", updated);
  } else {
    const created = await prisma.agreementAcceptance.create({
      data: {
        subjectType: "ARTIST" as any,
        subjectId,
        docType,
        version,
        acceptedAt: new Date(),
      },
      select: { id: true, subjectId: true, docType: true, version: true, acceptedAt: true },
    });
    console.log("✅ CREATED", created);
  }
}

main()
  .catch((e) => {
    console.error("❌ FAIL", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });