import "dotenv/config";
import { prisma } from "../src/db";

async function main() {
  const subjectId = process.argv[2];

  if (!subjectId) {
    console.log("Usage: pnpm tsx scripts/accept-billing-terms-for.ts <ARTIST_ID>");
    process.exit(1);
  }

  const existing = await prisma.agreementAcceptance.findFirst({
    where: {
      subjectType: "ARTIST" as any,
      subjectId,
      docType: "BILLING_TERMS" as any,
      version: "2026-02-16",
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.agreementAcceptance.update({
      where: { id: existing.id },
      data: { acceptedAt: new Date() },
      select: {
        id: true,
        subjectId: true,
        docType: true,
        version: true,
        acceptedAt: true,
      },
    });

    console.log("✅ UPDATED", updated);
    return;
  }

  const created = await prisma.agreementAcceptance.create({
    data: {
      subjectType: "ARTIST" as any,
      subjectId,
      docType: "BILLING_TERMS" as any,
      version: "2026-02-16",
      acceptedAt: new Date(),
    },
    select: {
      id: true,
      subjectId: true,
      docType: true,
      version: true,
      acceptedAt: true,
    },
  });

  console.log("✅ CREATED", created);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });