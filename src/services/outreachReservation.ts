
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

type ReserveOutreachInput = {
    artistId: string;
    trackId: string;
    curatorId?: string | null;
    playlistId?: string | null;
    pitchId?: string | null;
    recipientEmail: string;
    identityEmail?: string | null;
    source: string;
};

export type ReserveOutreachResult =
    | { ok: true; deliveryId: string }
    | { ok: false; reason: "ALREADY_RESERVED_OR_CONTACTED" };

export async function reserveOutreach(
    input: ReserveOutreachInput
): Promise<ReserveOutreachResult> {
    const normalizedEmail = (
        input.identityEmail || input.recipientEmail
    ).trim().toLowerCase();

    if (
        !input.artistId ||
        !input.trackId ||
        !normalizedEmail ||
        !input.source
    ) {
        throw new Error("INVALID_OUTREACH_RESERVATION");
    }

    const identities = [
        ...(input.curatorId
            ? [{
                identityType: "CURATOR",
                identityValue: input.curatorId,
            }]
            : []),
        {
            identityType: "EMAIL",
            identityValue: normalizedEmail,
        },
    ];

    try {
        return await prisma.$transaction(
            async (tx) => {
                const delivery = await tx.outreachDelivery.create({
                    data: {
                        artistId: input.artistId,
                        trackId: input.trackId,
                        curatorId: input.curatorId || null,
                        playlistId: input.playlistId || null,
                        pitchId: input.pitchId || null,
                        recipientEmail: input.recipientEmail.trim(),
                        normalizedEmail,
                        source: input.source,
                        status: "RESERVED",
                    },
                });

                for (const identity of identities) {
                    await tx.outreachIdentity.create({
                        data: {
                            trackId: input.trackId,
                            identityType: identity.identityType,
                            identityValue: identity.identityValue,
                            deliveryId: delivery.id,
                        },
                    });
                }

                return {
                    ok: true as const,
                    deliveryId: delivery.id,
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2002" || error.code === "P2034")
        ) {
            return {
                ok: false,
                reason: "ALREADY_RESERVED_OR_CONTACTED",
            };
        }

        throw error;
    }
}


export async function markOutreachSent(input: {
    deliveryId: string;
    providerMessageId?: string | null;
    sentAt?: Date;
}) {
    return prisma.outreachDelivery.update({
        where: {
            id: input.deliveryId,
        },
        data: {
            status: "SENT",
            sentAt: input.sentAt ?? new Date(),
            providerMessageId: input.providerMessageId || null,
            failedAt: null,
            lastError: null,
        },
    });
}

export async function markOutreachUncertain(input: {
    deliveryId: string;
    error?: string | null;
}) {
    return prisma.outreachDelivery.updateMany({
        where: {
            id: input.deliveryId,
            status: {
                not: "SENT",
            },
        },
        data: {
            status: "UNKNOWN",
            lastError:
                input.error?.slice(0, 1000) ||
                "DELIVERY_OUTCOME_UNKNOWN",
        },
    });
}
