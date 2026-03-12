import { Router } from "express";
import { getTrackMeta, getTrackAudioFeatures } from "../spotify";

export const spotifyDebug = Router();

spotifyDebug.get("/spotify/debug/:id", async (req, res) => {
  const id = String(req.params.id || "");
  try {
    const meta = await getTrackMeta("", id);
    let features: any = null;
    try {
      features = await getTrackAudioFeatures("", id);
    } catch (e: any) {
      features = { error: e?.response?.data ?? e?.message ?? String(e) };
    }
    res.json({ ok: true, id, meta_ok: !!meta?.id, features });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.response?.data ?? e?.message ?? String(e) });
  }
});