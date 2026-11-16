
require("dotenv").config();

const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

const WRITE_CONFIRMATION = "CONFIRM_OUTREACH_BACKFILL";

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  const allowedArgs = [
    "--write",
    `--confirm=${WRITE_CONFIRMATION}`,
  ];

  const unknownArgs = args.filter(
    (arg) => !allowedArgs.includes(arg)
  );

  if (unknownArgs.length > 0) {
    throw new Error(
      `UNKNOWN_ARGUMENTS: ${unknownArgs.join(", ")}`
    );
  }

  if (
    write &&
    !args.includes(`--confirm=${WRITE_CONFIRMATION}`)
  ) {
    throw new Error("WRITE_CONFIRMATION_REQUIRED");
  }

  if (
    write &&
    process.env.OUTREACH_BACKFILL_APPROVED !== "YES"
  ) {
    throw new Error("WRITE_MODE_NOT_APPROVED");
  }

  if (!write && args.some((arg) => arg.startsWith("--confirm="))) {
    throw new Error("CONFIRMATION_WITHOUT_WRITE");
  }

  const pitches = await prisma.pitch.findMany({
    where: {
      OR: [
        { status: "SENT" },
        { sentAt: { not: null } },
        { providerMessageId: { not: null } },
      ],
    },
    select: {
      id: true,
      status: true,
      sentAt: true,
      sentTo: true,
      providerMessageId: true,
      createdAt: true,
      match: {
        select: {
          trackId: true,
          playlistId: true,
          track: {
            select: { artistId: true },
          },
          playlist: {
            select: { curatorId: true },
          },
        },
      },
    },
    orderBy: [
      { sentAt: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });

  const deliveries = [];
  const identities = new Map();
  const duplicateReferences = [];
  const missingRecipients = [];
  const providerIds = new Set();
  const duplicateProviderIds = [];

  for (const pitch of pitches) {
    const email = (pitch.sentTo || "").trim().toLowerCase();

    if (!email) {
      missingRecipients.push(pitch.id);
      continue;
    }

    const providerId = pitch.providerMessageId?.trim() || null;

    if (providerId) {
      if (providerIds.has(providerId)) {
        duplicateProviderIds.push(pitch.id);
      }
      providerIds.add(providerId);
    }

    const delivery = {
      pitchId: pitch.id,
      artistId: pitch.match.track.artistId,
      trackId: pitch.match.trackId,
      curatorId: pitch.match.playlist.curatorId,
      playlistId: pitch.match.playlistId,
      recipientEmail: pitch.sentTo.trim(),
      normalizedEmail: email,
      providerMessageId: providerId,
      sentAt: pitch.sentAt,
      status: "SENT_RECORDED",
      source: "HISTORICAL_BACKFILL",
    };

    deliveries.push(delivery);

    const identityValues = [
      ...(delivery.curatorId
        ? [{ type: "CURATOR", value: delivery.curatorId }]
        : []),
      { type: "EMAIL", value: delivery.normalizedEmail },
    ];

    for (const identity of identityValues) {
      const key = JSON.stringify([
        delivery.trackId,
        identity.type,
        identity.value,
      ]);

      if (identities.has(key)) {
        duplicateReferences.push({
          firstPitchId: identities.get(key).pitchId,
          anotherPitchId: delivery.pitchId,
        });
        continue;
      }

      identities.set(key, {
        trackId: delivery.trackId,
        identityType: identity.type,
        identityValue: identity.value,
        pitchId: delivery.pitchId,
      });
    }
  }

  const ready =
    missingRecipients.length === 0 &&
    duplicateProviderIds.length === 0 &&
    deliveries.length === pitches.length;

  const summary = {
    mode: write ? "WRITE_REQUESTED" : "DRY_RUN_READ_ONLY",
    historicalPitches: pitches.length,
    plannedDeliveries: deliveries.length,
    plannedIdentities: identities.size,
    duplicateIdentityReferences: duplicateReferences.length,
    uniqueProviderIds: providerIds.size,
    duplicateProviderIds: duplicateProviderIds.length,
    missingRecipients: missingRecipients.length,
    readyForWriteImplementation: ready,
  };

  if (!write) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!ready) {
    throw new Error("BACKFILL_VALIDATION_FAILED");
  }

  await prisma.$transaction(
    async (tx) => {
      const deliveryIdsByPitch = new Map();

      for (const delivery of deliveries) {
        const existing = await tx.outreachDelivery.findUnique({
          where: { pitchId: delivery.pitchId },
        });

        if (existing) {
          if (
            existing.source !== "HISTORICAL_BACKFILL" ||
            existing.status !== "SENT_RECORDED" ||
            existing.artistId !== delivery.artistId ||
            existing.trackId !== delivery.trackId ||
            existing.curatorId !== delivery.curatorId ||
            existing.playlistId !== delivery.playlistId ||
            existing.recipientEmail !== delivery.recipientEmail ||
            existing.normalizedEmail !== delivery.normalizedEmail ||
            existing.providerMessageId !== delivery.providerMessageId ||
            (existing.sentAt?.getTime() ?? null) !==
            (delivery.sentAt?.getTime() ?? null)
          ) {
            throw new Error(
              `EXISTING_DELIVERY_CONFLICT: ${delivery.pitchId}`
            );
          }

          deliveryIdsByPitch.set(
            delivery.pitchId,
            existing.id
          );
          continue;
        }

        const created = await tx.outreachDelivery.create({
          data: delivery,
        });

        deliveryIdsByPitch.set(
          delivery.pitchId,
          created.id
        );
      }

      for (const identity of identities.values()) {
        const deliveryId = deliveryIdsByPitch.get(
          identity.pitchId
        );

        if (!deliveryId) {
          throw new Error(
            `MISSING_DELIVERY_FOR_IDENTITY: ${identity.pitchId}`
          );
        }

        const existing = await tx.outreachIdentity.findUnique({
          where: {
            outreach_identity_unique: {
              trackId: identity.trackId,
              identityType: identity.identityType,
              identityValue: identity.identityValue,
            },
          },
        });

        if (existing) {
          if (existing.deliveryId !== deliveryId) {
            throw new Error(
              `EXISTING_IDENTITY_CONFLICT: ${identity.pitchId}`
            );
          }
          continue;
        }

        await tx.outreachIdentity.create({
          data: {
            trackId: identity.trackId,
            identityType: identity.identityType,
            identityValue: identity.identityValue,
            deliveryId,
          },
        });
      }

      const deliveryCount = await tx.outreachDelivery.count({
        where: {
          source: "HISTORICAL_BACKFILL",
          pitchId: { in: deliveries.map((d) => d.pitchId) },
        },
      });

      let identityCount = 0;

      for (const identity of identities.values()) {
        const expectedDeliveryId = deliveryIdsByPitch.get(
          identity.pitchId
        );

        const storedIdentity = await tx.outreachIdentity.findUnique({
          where: {
            outreach_identity_unique: {
              trackId: identity.trackId,
              identityType: identity.identityType,
              identityValue: identity.identityValue,
            },
          },
        });

        if (
          !storedIdentity ||
          storedIdentity.deliveryId !== expectedDeliveryId
        ) {
          throw new Error(
            `BACKFILL_IDENTITY_VERIFICATION_FAILED: ${identity.pitchId}`
          );
        }

        identityCount++;
      }

      if (
        deliveryCount !== deliveries.length ||
        identityCount !== identities.size
      ) {
        throw new Error(
          `BACKFILL_VERIFICATION_FAILED: ${deliveryCount}/${identityCount}`
        );
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120000,
    }
  );

  console.log(
    JSON.stringify(
      {
        ...summary,
        mode: "WRITE_COMPLETED",
        verifiedDeliveries: deliveries.length,
        verifiedIdentities: identities.size,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("BACKFILL_FAILED", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
