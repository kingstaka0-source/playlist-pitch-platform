
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { getAuth } from "@clerk/express";
import { prisma } from "../db";

const router = Router();

router.get("/dashboard", async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "UNAUTHORIZED",
                message: "Please sign in to TuneReach.",
            });
        }

        const curator = await prisma.curator.findUnique({
            where: {
                clerkUserId: userId,
            },
            select: {
                id: true,
                name: true,
                email: true,
            },
        });

        if (!curator) {
            return res.status(404).json({
                error: "CURATOR_NOT_FOUND",
                message: "No verified curator account found.",
            });
        }

        const claims = await prisma.playlistClaim.findMany({
            where: {
                curatorId: curator.id,
                claimantClerkUserId: userId,
                status: "VERIFIED",
            },
            select: {
                id: true,
                verifiedAt: true,
                playlist: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        spotifyPlaylistId: true,
                        spotifyUrl: true,
                        ownerDisplayName: true,
                        genres: true,
                        rules: true,
                    },
                },
            },
            orderBy: {
                verifiedAt: "desc",
            },
        });

        const playlists = claims.map((claim) => {
            const { rules, ...playlist } = claim.playlist;

            const playlistRules =
                rules && typeof rules === "object" && !Array.isArray(rules)
                    ? rules
                    : {};

            const imageCandidate =
                "spotifyImageUrl" in playlistRules
                    ? playlistRules.spotifyImageUrl
                    : undefined;

            const fallbackImage =
                "imageUrl" in playlistRules
                    ? playlistRules.imageUrl
                    : undefined;

            const imageUrl =
                typeof imageCandidate === "string" && imageCandidate.trim()
                    ? imageCandidate
                    : typeof fallbackImage === "string" && fallbackImage.trim()
                        ? fallbackImage
                        : null;

            return {
                ...playlist,
                imageUrl,
                claimId: claim.id,
                verifiedAt: claim.verifiedAt,
                verificationStatus: "VERIFIED",
            };
        });

        return res.json({
            curator,
            stats: {
                verifiedPlaylists: playlists.length,
            },
            playlists,
        });
    } catch (error) {
        console.error("CURATOR_DASHBOARD_ERROR", error);

        return res.status(500).json({
            error: "CURATOR_DASHBOARD_ERROR",
            message: "Could not load curator dashboard.",
        });
    }
});


router.get("/playlists/:id", async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "UNAUTHORIZED",
                message: "Please sign in to TuneReach.",
            });
        }

        const playlistId = String(req.params.id || "").trim();

        if (!playlistId) {
            return res.status(400).json({
                error: "PLAYLIST_ID_REQUIRED",
            });
        }

        const curator = await prisma.curator.findUnique({
            where: { clerkUserId: userId },
            select: { id: true },
        });

        if (!curator) {
            return res.status(404).json({
                error: "CURATOR_NOT_FOUND",
            });
        }

        const claim = await prisma.playlistClaim.findFirst({
            where: {
                playlistId,
                curatorId: curator.id,
                claimantClerkUserId: userId,
                status: "VERIFIED",
            },
            select: {
                verifiedAt: true,
                playlist: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        spotifyPlaylistId: true,
                        spotifyUrl: true,
                        ownerDisplayName: true,
                        genres: true,
                        minBpm: true,
                        maxBpm: true,
                        minEnergy: true,
                        maxEnergy: true,
                        rules: true,
                    },
                },
            },
        });

        if (!claim) {
            return res.status(404).json({
                error: "PLAYLIST_NOT_FOUND",
            });
        }

        const { rules, ...playlist } = claim.playlist;

        const playlistRules =
            rules && typeof rules === "object" && !Array.isArray(rules)
                ? rules
                : {};

        const spotifyImage =
            "spotifyImageUrl" in playlistRules
                ? playlistRules.spotifyImageUrl
                : undefined;

        const fallbackImage =
            "imageUrl" in playlistRules
                ? playlistRules.imageUrl
                : undefined;

        const imageUrl =
            typeof spotifyImage === "string" && spotifyImage.trim()
                ? spotifyImage
                : typeof fallbackImage === "string" && fallbackImage.trim()
                    ? fallbackImage
                    : null;

        return res.json({
            ok: true,
            playlist: {
                ...playlist,
                rules,
                imageUrl,
                verifiedAt: claim.verifiedAt,
                verificationStatus: "VERIFIED",
            },
        });
    } catch (error) {
        console.error("CURATOR_PLAYLIST_GET_ERROR", error);

        return res.status(500).json({
            error: "CURATOR_PLAYLIST_GET_ERROR",
            message: "Could not load playlist settings.",
        });
    }
});



router.patch("/playlists/:id", async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ error: "UNAUTHORIZED" });
        }

        const playlistId = String(req.params.id || "").trim();

        if (!playlistId) {
            return res.status(400).json({
                error: "PLAYLIST_ID_REQUIRED",
            });
        }

        const body: unknown = req.body;

        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            return res.status(400).json({
                error: "INVALID_REQUEST_BODY",
            });
        }

        const input = body as Record<string, unknown>;

        const allowedFields = new Set([
            "genres",
            "minBpm",
            "maxBpm",
            "minEnergy",
            "maxEnergy",
            "acceptingSubmissions",
            "submissionInstructions",
        ]);

        const fields = Object.keys(input);

        if (
            fields.length === 0 ||
            fields.some((field) => !allowedFields.has(field))
        ) {
            return res.status(400).json({
                error: "INVALID_PLAYLIST_SETTINGS",
            });
        }

        const has = (key: string) =>
            Object.prototype.hasOwnProperty.call(input, key);

        const validatedNumbers: Record<
            string,
            number | null
        > = {};

        for (const key of [
            "minBpm",
            "maxBpm",
            "minEnergy",
            "maxEnergy",
        ]) {
            if (!has(key)) continue;

            const value = input[key];
            const max = key.endsWith("Bpm") ? 300 : 1;

            if (value === null) {
                validatedNumbers[key] = null;
                continue;
            }

            if (
                typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0 ||
                value > max ||
                (key.endsWith("Bpm") && !Number.isInteger(value))
            ) {
                return res.status(400).json({
                    error: `INVALID_${key.toUpperCase()}`,
                });
            }

            validatedNumbers[key] = value;
        }

        let validatedGenres: string[] | undefined;

        if (has("genres")) {
            const value = input.genres;

            if (
                !Array.isArray(value) ||
                value.length > 20 ||
                !value.every(
                    (genre: unknown) =>
                        typeof genre === "string" &&
                        genre.trim().length > 0 &&
                        genre.trim().length <= 60
                )
            ) {
                return res.status(400).json({
                    error: "INVALID_GENRES",
                });
            }

            validatedGenres = [
                ...new Set(
                    (value as string[]).map((genre) =>
                        genre.trim()
                    )
                ),
            ];
        }

        if (
            has("acceptingSubmissions") &&
            typeof input.acceptingSubmissions !== "boolean"
        ) {
            return res.status(400).json({
                error: "INVALID_ACCEPTING_SUBMISSIONS",
            });
        }

        if (
            has("submissionInstructions") &&
            (typeof input.submissionInstructions !== "string" ||
                input.submissionInstructions.length > 2000)
        ) {
            return res.status(400).json({
                error: "INVALID_SUBMISSION_INSTRUCTIONS",
            });
        }

        type UpdateResult =
            | { kind: "CURATOR_NOT_FOUND" }
            | { kind: "PLAYLIST_NOT_FOUND" }
            | { kind: "INVALID_SETTINGS_RANGE" }
            | {
                kind: "SUCCESS";
                playlist: {
                    id: string;
                    name: string;
                    genres: string[];
                    minBpm: number | null;
                    maxBpm: number | null;
                    minEnergy: number | null;
                    maxEnergy: number | null;
                    rules: Prisma.JsonValue;
                };
            };

        let result: UpdateResult | undefined;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                result = await prisma.$transaction(
                    async (tx): Promise<UpdateResult> => {
                        const curator = await tx.curator.findUnique({
                            where: { clerkUserId: userId },
                            select: { id: true },
                        });

                        if (!curator) {
                            return { kind: "CURATOR_NOT_FOUND" };
                        }

                        const claim = await tx.playlistClaim.findFirst({
                            where: {
                                playlistId,
                                curatorId: curator.id,
                                claimantClerkUserId: userId,
                                status: "VERIFIED",
                            },
                            select: { id: true },
                        });

                        if (!claim) {
                            return { kind: "PLAYLIST_NOT_FOUND" };
                        }

                        const existing = await tx.playlist.findUnique({
                            where: { id: playlistId },
                            select: {
                                genres: true,
                                minBpm: true,
                                maxBpm: true,
                                minEnergy: true,
                                maxEnergy: true,
                                rules: true,
                            },
                        });

                        if (!existing) {
                            return { kind: "PLAYLIST_NOT_FOUND" };
                        }

                        const minBpm = has("minBpm")
                            ? validatedNumbers.minBpm
                            : existing.minBpm;

                        const maxBpm = has("maxBpm")
                            ? validatedNumbers.maxBpm
                            : existing.maxBpm;

                        const minEnergy = has("minEnergy")
                            ? validatedNumbers.minEnergy
                            : existing.minEnergy;

                        const maxEnergy = has("maxEnergy")
                            ? validatedNumbers.maxEnergy
                            : existing.maxEnergy;

                        if (
                            (minBpm != null &&
                                maxBpm != null &&
                                minBpm > maxBpm) ||
                            (minEnergy != null &&
                                maxEnergy != null &&
                                minEnergy > maxEnergy)
                        ) {
                            return { kind: "INVALID_SETTINGS_RANGE" };
                        }

                        const data: Prisma.PlaylistUpdateInput = {};

                        if (validatedGenres !== undefined) {
                            data.genres = { set: validatedGenres };
                        }

                        if (has("minBpm")) {
                            data.minBpm = minBpm;
                        }

                        if (has("maxBpm")) {
                            data.maxBpm = maxBpm;
                        }

                        if (has("minEnergy")) {
                            data.minEnergy = minEnergy;
                        }

                        if (has("maxEnergy")) {
                            data.maxEnergy = maxEnergy;
                        }

                        if (
                            has("genres") ||
                            has("acceptingSubmissions") ||
                            has("submissionInstructions")
                        ) {
                            const existingRules =
                                existing.rules &&
                                    typeof existing.rules === "object" &&
                                    !Array.isArray(existing.rules)
                                    ? { ...existing.rules }
                                    : {};

                            const settingsValue =
                                "curatorSettings" in existingRules
                                    ? existingRules.curatorSettings
                                    : null;

                            const currentSettings =
                                settingsValue &&
                                    typeof settingsValue === "object" &&
                                    !Array.isArray(settingsValue)
                                    ? { ...settingsValue }
                                    : {};

                            if (has("genres")) {
                                currentSettings.genresManagedByCurator = true;
                            }

                            if (has("acceptingSubmissions")) {
                                currentSettings.acceptingSubmissions =
                                    input.acceptingSubmissions as boolean;
                            }

                            if (has("submissionInstructions")) {
                                currentSettings.submissionInstructions = (
                                    input.submissionInstructions as string
                                ).trim();
                            }

                            data.rules = {
                                ...existingRules,
                                curatorSettings: currentSettings,
                            } as Prisma.InputJsonValue;
                        }

                        const updated = await tx.playlist.update({
                            where: { id: playlistId },
                            data,
                            select: {
                                id: true,
                                name: true,
                                genres: true,
                                rules: true,
                                minBpm: true,
                                maxBpm: true,
                                minEnergy: true,
                                maxEnergy: true,
                            },
                        });

                        return {
                            kind: "SUCCESS",
                            playlist: updated,
                        };
                    },
                    {
                        isolationLevel:
                            Prisma.TransactionIsolationLevel.Serializable,
                    }
                );

                break;
            } catch (error) {
                const isConflict =
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2034";

                if (!isConflict) throw error;

                if (attempt === 2) {
                    return res.status(409).json({
                        error: "PLAYLIST_UPDATE_CONFLICT",
                        message: "Please retry saving your settings.",
                    });
                }
            }
        }

        if (!result) {
            return res.status(500).json({
                error: "PLAYLIST_UPDATE_FAILED",
            });
        }

        if (result.kind === "CURATOR_NOT_FOUND") {
            return res.status(404).json({
                error: "CURATOR_NOT_FOUND",
            });
        }

        if (result.kind === "PLAYLIST_NOT_FOUND") {
            return res.status(404).json({
                error: "PLAYLIST_NOT_FOUND",
            });
        }

        if (result.kind === "INVALID_SETTINGS_RANGE") {
            return res.status(400).json({
                error: "INVALID_SETTINGS_RANGE",
            });
        }

        return res.json({
            ok: true,
            playlist: result.playlist,
        });
    } catch (error) {
        console.error("CURATOR_PLAYLIST_UPDATE_ERROR", error);

        return res.status(500).json({
            error: "CURATOR_PLAYLIST_UPDATE_ERROR",
            message: "Could not update playlist settings.",
        });
    }
});



export default router;
