
import { prisma } from "../db";

type OutreachDuplicateInput = {
  trackId: string;
  curatorId?: string | null;
  recipientEmail?: string | null;
  excludePitchId?: string | null;
};

export async function findPreviousCuratorOutreach({
  trackId,
  curatorId,
  recipientEmail,
  excludePitchId,
}: OutreachDuplicateInput) {
  const normalizedEmail = recipientEmail?.trim().toLowerCase() || null;

  if (!trackId || (!curatorId && !normalizedEmail)) {
    return null;
  }

  const previous = await prisma.pitch.findFirst({
    where: {
      status: "SENT",
      ...(excludePitchId
        ? { id: { not: excludePitchId } }
        : {}),
      match: {
        trackId,
        playlist: {
          OR: [
            ...(curatorId
              ? [{ curatorId }]
              : []),
            ...(normalizedEmail
              ? [{
                  curator: {
                    email: {
                      equals: normalizedEmail,
                      mode: "insensitive" as const,
                    },
                  },
                }]
              : []),
          ],
        },
      },
    },
    select: {
      id: true,
      sentAt: true,
      sentTo: true,
      match: {
        select: {
          playlistId: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return previous;
}
