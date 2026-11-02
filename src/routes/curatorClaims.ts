import { Router } from "express";
import { getAuth } from "@clerk/express";
import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";
import { prisma } from "../db";
import { env } from "../env";

const router = Router();

function must(name: string, value?: string) {
    if (!value) {
        throw new Error(`Missing env: ${name}`);
    }

    return value;
}

const SPOTIFY_CLIENT_ID = must(
    "SPOTIFY_CLIENT_ID",
    env.SPOTIFY_CLIENT_ID,
);

const SPOTIFY_CLIENT_SECRET = must(
    "SPOTIFY_CLIENT_SECRET",
    env.SPOTIFY_CLIENT_SECRET,
);

const SPOTIFY_CURATOR_REDIRECT_URI = must(
    "SPOTIFY_CURATOR_REDIRECT_URI",
    env.SPOTIFY_CURATOR_REDIRECT_URI,
);

const FRONTEND_URL = env.FRONTEND_URL || "http://localhost:3000";

function createCuratorClaimSpotifyState(
    claimId: string,
    claimantClerkUserId: string,
): string {
    const payload = Buffer.from(
        JSON.stringify({
            claimId,
            claimantClerkUserId,
            createdAt: Date.now(),
        }),
    ).toString("base64url");

    const signature = createHmac("sha256", SPOTIFY_CLIENT_SECRET)
        .update(payload)
        .digest("base64url");

    return `${payload}.${signature}`;
}

function readCuratorClaimSpotifyState(state: string): {
    claimId: string;
    claimantClerkUserId: string;
    createdAt: number;
} {
    const [payload, suppliedSignature] = state.split(".");

    if (!payload || !suppliedSignature) {
        throw new Error("INVALID_CURATOR_SPOTIFY_STATE");
    }

    const expectedSignature = createHmac(
        "sha256",
        SPOTIFY_CLIENT_SECRET,
    )
        .update(payload)
        .digest("base64url");

    const suppliedBuffer = Buffer.from(
        suppliedSignature,
        "base64url",
    );
    const expectedBuffer = Buffer.from(
        expectedSignature,
        "base64url",
    );

    if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
        throw new Error("INVALID_CURATOR_SPOTIFY_STATE");
    }

    const decoded = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
    );

    const claimId = String(decoded?.claimId || "").trim();
    const claimantClerkUserId = String(
        decoded?.claimantClerkUserId || "",
    ).trim();
    const createdAt = Number(decoded?.createdAt || 0);

    if (
        !claimId ||
        !claimantClerkUserId ||
        !Number.isFinite(createdAt)
    ) {
        throw new Error("INVALID_CURATOR_SPOTIFY_STATE");
    }

    const tenMinutes = 10 * 60 * 1000;
    const age = Date.now() - createdAt;

    if (age < 0 || age > tenMinutes) {
        throw new Error("EXPIRED_CURATOR_SPOTIFY_STATE");
    }

    return {
        claimId,
        claimantClerkUserId,
        createdAt,
    };
}

router.post("/:claimId/spotify/start", async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "UNAUTHORIZED",
                message: "You must be signed in.",
            });
        }

        const claimId = String(req.params.claimId || "").trim();

        if (!claimId) {
            return res.status(400).json({
                error: "CLAIM_ID_REQUIRED",
            });
        }

        const claim = await prisma.playlistClaim.findUnique({
            where: {
                id: claimId,
            },
            select: {
                id: true,
                claimantClerkUserId: true,
                status: true,
                playlist: {
                    select: {
                        id: true,
                        ownerSpotifyId: true,
                    },
                },
                curator: {
                    select: {
                        id: true,
                        clerkUserId: true,
                    },
                },
            },
        });

        if (!claim) {
            return res.status(404).json({
                error: "CLAIM_NOT_FOUND",
            });
        }

        if (claim.claimantClerkUserId !== userId) {
            return res.status(403).json({
                error: "CLAIM_ACCESS_DENIED",
            });
        }

        if (claim.status !== "PENDING") {
            return res.status(409).json({
                error: "CLAIM_NOT_PENDING",
                status: claim.status,
            });
        }

        if (
            claim.curator.clerkUserId &&
            claim.curator.clerkUserId !== userId
        ) {
            return res.status(409).json({
                error: "CURATOR_ALREADY_LINKED",
                message: "This curator profile is already linked to another account.",
            });
        }

        if (!claim.playlist.ownerSpotifyId) {
            return res.status(409).json({
                error: "SPOTIFY_OWNER_ID_UNAVAILABLE",
                message:
                    "This playlist cannot currently be verified through Spotify.",
            });
        }

        const state = createCuratorClaimSpotifyState(
            claim.id,
            userId,
        );

        const scope = ["user-read-private"].join(" ");

        const url =
            "https://accounts.spotify.com/authorize?" +
            new URLSearchParams({
                response_type: "code",
                client_id: SPOTIFY_CLIENT_ID,
                scope,
                redirect_uri: SPOTIFY_CURATOR_REDIRECT_URI,
                state,
                show_dialog: "true",
            }).toString();

        return res.json({
            url,
        });
    } catch (error) {
        console.error(
            "START_CURATOR_SPOTIFY_VERIFICATION_ERROR",
            error instanceof Error ? error.message : "UNKNOWN_ERROR",
        );

        return res.status(500).json({
            error: "COULD_NOT_START_SPOTIFY_VERIFICATION",
        });
    }
});

router.get("/spotify/callback", async (req, res) => {
    const redirectWithResult = (
        result: string,
        claimId?: string,
    ) => {
        const params = new URLSearchParams({
            spotifyVerification: result,
        });

        if (claimId) {
            params.set("claimId", claimId);
        }

        return res.redirect(
            `${FRONTEND_URL}/curator/claim?${params.toString()}`,
        );
    };

    try {
        const spotifyError = String(req.query.error || "").trim();
        const state = String(req.query.state || "").trim();

        if (!state) {
            return res.status(400).json({
                error: "MISSING_CURATOR_SPOTIFY_STATE",
            });
        }

        let stateData: {
            claimId: string;
            claimantClerkUserId: string;
            createdAt: number;
        };

        try {
            stateData = readCuratorClaimSpotifyState(state);
        } catch (error) {
            const errorCode =
                error instanceof Error
                    ? error.message
                    : "INVALID_CURATOR_SPOTIFY_STATE";

            return res.status(400).json({
                error: errorCode,
            });
        }

        if (spotifyError) {
            return redirectWithResult(
                "cancelled",
                stateData.claimId,
            );
        }

        const code = String(req.query.code || "").trim();

        if (!code) {
            return res.status(400).json({
                error: "MISSING_SPOTIFY_CODE",
            });
        }

        const claim = await prisma.playlistClaim.findUnique({
            where: {
                id: stateData.claimId,
            },
            select: {
                id: true,
                curatorId: true,
                claimantClerkUserId: true,
                status: true,
                playlist: {
                    select: {
                        id: true,
                        ownerSpotifyId: true,
                    },
                },
                curator: {
                    select: {
                        id: true,
                        clerkUserId: true,
                    },
                },
            },
        });

        if (!claim) {
            return res.status(404).json({
                error: "CLAIM_NOT_FOUND",
            });
        }

        if (
            claim.claimantClerkUserId !==
            stateData.claimantClerkUserId
        ) {
            return res.status(403).json({
                error: "CLAIMANT_MISMATCH",
            });
        }

        if (claim.status !== "PENDING") {
            return redirectWithResult(
                claim.status === "VERIFIED"
                    ? "verified"
                    : "not-pending",
                claim.id,
            );
        }

        if (
            claim.curator.clerkUserId &&
            claim.curator.clerkUserId !==
            claim.claimantClerkUserId
        ) {
            return res.status(409).json({
                error: "CURATOR_ALREADY_LINKED",
            });
        }

        if (!claim.playlist.ownerSpotifyId) {
            return redirectWithResult(
                "owner-unavailable",
                claim.id,
            );
        }

        const tokenRes = await axios.post(
            "https://accounts.spotify.com/api/token",
            new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: SPOTIFY_CURATOR_REDIRECT_URI,
            }),
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                    Authorization:
                        "Basic " +
                        Buffer.from(
                            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
                        ).toString("base64"),
                },
                timeout: 10_000,
            },
        );

        const accessToken = String(
            tokenRes.data?.access_token || "",
        );

        if (!accessToken) {
            throw new Error("SPOTIFY_ACCESS_TOKEN_MISSING");
        }

        const meRes = await axios.get(
            "https://api.spotify.com/v1/me",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                timeout: 10_000,
            },
        );

        const spotifyUserId = String(
            meRes.data?.id || "",
        ).trim();

        if (!spotifyUserId) {
            throw new Error("SPOTIFY_USER_ID_MISSING");
        }

        if (
            spotifyUserId !== claim.playlist.ownerSpotifyId
        ) {
            return redirectWithResult(
                "owner-mismatch",
                claim.id,
            );
        }

        const verifiedAt = new Date();

        await prisma.$transaction(async (tx) => {
            const currentClaim =
                await tx.playlistClaim.findUnique({
                    where: {
                        id: claim.id,
                    },
                    select: {
                        id: true,
                        curatorId: true,
                        claimantClerkUserId: true,
                        status: true,
                        curator: {
                            select: {
                                clerkUserId: true,
                            },
                        },
                    },
                });

            if (!currentClaim) {
                throw new Error("CLAIM_NOT_FOUND");
            }

            if (
                currentClaim.claimantClerkUserId !==
                stateData.claimantClerkUserId
            ) {
                throw new Error("CLAIMANT_MISMATCH");
            }

            if (currentClaim.status !== "PENDING") {
                throw new Error("CLAIM_NOT_PENDING");
            }

            if (
                currentClaim.curator.clerkUserId &&
                currentClaim.curator.clerkUserId !==
                currentClaim.claimantClerkUserId
            ) {
                throw new Error("CURATOR_ALREADY_LINKED");
            }

            await tx.curator.update({
                where: {
                    id: currentClaim.curatorId,
                },
                data: {
                    clerkUserId:
                        currentClaim.claimantClerkUserId,
                },
            });

            const claimUpdate = await tx.playlistClaim.updateMany({
                where: {
                    id: currentClaim.id,
                    claimantClerkUserId:
                        currentClaim.claimantClerkUserId,
                    status: "PENDING",
                },
                data: {
                    status: "VERIFIED",
                    verificationMethod: "SPOTIFY",
                    verifiedAt,
                    rejectedAt: null,
                },
            });

            if (claimUpdate.count !== 1) {
                throw new Error("CLAIM_NOT_PENDING");
            }
        });

        return redirectWithResult("verified", claim.id);
    } catch (error) {
        console.error(
            "CURATOR_SPOTIFY_VERIFICATION_ERROR",
            error instanceof Error
                ? error.message
                : "UNKNOWN_ERROR",
        );

        return res.status(500).json({
            error: "SPOTIFY_VERIFICATION_FAILED",
        });
    }
});

router.post("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "You must be signed in.",
      });
    }

    const playlistId = String(req.body?.playlistId || "").trim();

    if (!playlistId) {
      return res.status(400).json({
        error: "PLAYLIST_ID_REQUIRED",
      });
    }

    const playlist = await prisma.playlist.findUnique({
      where: {
        id: playlistId,
      },
      select: {
        id: true,
        curatorId: true,
        name: true,
        spotifyPlaylistId: true,
        spotifyUrl: true,
        ownerDisplayName: true,
        ownerSpotifyId: true,
        curator: {
          select: {
            id: true,
            clerkUserId: true,
            name: true,
          },
        },
        claims: {
          select: {
            id: true,
            claimantClerkUserId: true,
            status: true,
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({
        error: "PLAYLIST_NOT_FOUND",
      });
    }

    if (
      playlist.curator.clerkUserId &&
      playlist.curator.clerkUserId !== userId
    ) {
      return res.status(409).json({
        error: "CURATOR_ALREADY_LINKED",
        message: "This curator profile is already linked to another account.",
      });
    }

    const existingClaim = playlist.claims[0] ?? null;

    if (existingClaim) {
      if (existingClaim.claimantClerkUserId === userId) {
        return res.status(200).json({
          claim: existingClaim,
          created: false,
        });
      }

      return res.status(409).json({
        error: "PLAYLIST_ALREADY_CLAIMED",
        status: existingClaim.status,
      });
    }

    const claim = await prisma.playlistClaim.create({
      data: {
        playlistId: playlist.id,
        curatorId: playlist.curatorId,
        claimantClerkUserId: userId,
        status: "PENDING",
      },
      select: {
        id: true,
        playlistId: true,
        curatorId: true,
        claimantClerkUserId: true,
        status: true,
        verificationMethod: true,
        createdAt: true,
        updatedAt: true,
        verifiedAt: true,
        rejectedAt: true,
      },
    });

    return res.status(201).json({
      claim,
      created: true,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        spotifyPlaylistId: playlist.spotifyPlaylistId,
        spotifyUrl: playlist.spotifyUrl,
        ownerDisplayName: playlist.ownerDisplayName,
        ownerSpotifyId: playlist.ownerSpotifyId,
      },
    });
  } catch (error) {
    console.error("CREATE_PLAYLIST_CLAIM_ERROR", error);

    return res.status(500).json({
      error: "COULD_NOT_CREATE_PLAYLIST_CLAIM",
    });
  }
});

export default router;
