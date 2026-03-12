import { Router } from "express";
import { prisma } from "../db";

console.log("CURATORS ROUTE LOADED ✅", new Date().toISOString());

export const curators = Router();

curators.post("/curators", async (req, res) => {
  try {
    const {
      name,
      email,
      contactMethod,
      languages = ["en"],
      consent = true,
    } = req.body ?? {};

    if (!name || !contactMethod) {
      return res.status(400).json({
        error: "name and contactMethod required",
      });
    }

    if (contactMethod === "EMAIL" && !email) {
      return res.status(400).json({
        error: "email required for EMAIL contactMethod",
      });
    }

    const curator = await prisma.curator.create({
      data: {
        name: String(name).trim(),
        email: email ? String(email).trim().toLowerCase() : null,
        contactMethod,
        languages: Array.isArray(languages) ? languages : ["en"],
        consent: !!consent,
      },
    });

    return res.json({
      ok: true,
      curator,
    });
  } catch (err: any) {
    console.error("CURATOR_CREATE_ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "curator create failed",
      details: err?.message ?? String(err),
    });
  }
});

curators.get("/curators", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const contactMethod = String(req.query.contactMethod || "").trim();
    const consentRaw = String(req.query.consent || "").trim();

    const where: any = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    if (contactMethod === "EMAIL" || contactMethod === "INAPP") {
      where.contactMethod = contactMethod;
    }

    if (consentRaw === "true") {
      where.consent = true;
    } else if (consentRaw === "false") {
      where.consent = false;
    }

    const list = await prisma.curator.findMany({
      where,
      include: {
        playlists: {
          select: {
            id: true,
            name: true,
            spotifyPlaylistId: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            playlists: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const results = list.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      contactMethod: c.contactMethod,
      consent: c.consent,
      languages: c.languages,
      createdAt: c.createdAt,
      playlistCount: c._count.playlists,
      playlists: c.playlists,
      canEmail:
        !!c.email && c.contactMethod === "EMAIL" && c.consent === true,
    }));

    return res.json({
      ok: true,
      count: results.length,
      curators: results,
    });
  } catch (err: any) {
    console.error("CURATORS_LIST_ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "curator list failed",
      details: err?.message ?? String(err),
    });
  }
});

curators.get("/curators/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) {
      return res.status(400).json({ error: "id required" });
    }

    const curator = await prisma.curator.findUnique({
      where: { id },
      include: {
        playlists: {
          include: {
            _count: {
              select: {
                matches: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!curator) {
      return res.status(404).json({ error: "CURATOR_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      curator: {
        ...curator,
        canEmail:
          !!curator.email &&
          curator.contactMethod === "EMAIL" &&
          curator.consent === true,
      },
    });
  } catch (err: any) {
    console.error("CURATOR_GET_ERROR", err?.message ?? err);

    return res.status(500).json({
      error: "curator get failed",
      details: err?.message ?? String(err),
    });
  }
});