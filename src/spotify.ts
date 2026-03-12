import axios from "axios";
import { getSpotifyAppAccessToken } from "./spotifyAppClient";

async function spotifyGet<T>(url: string): Promise<T> {
  // 1) eerste poging
  let token = await getSpotifyAppAccessToken(false);

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
    });
    return data as T;
  } catch (err: any) {
    const status = err?.response?.status;

    // ✅ DEBUG: eerste fout (tijdelijk)
    console.log("SPOTIFY GET FAIL", url, "status=", status);
    console.log("SPOTIFY GET BODY", err?.response?.data);
    console.log("TRACKID?", url.split("/").pop());

    // 2) bij 401/403: token forceren vernieuwen en retry
    if (status === 401 || status === 403) {
      try {
        token = await getSpotifyAppAccessToken(true);

        const { data } = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10_000,
        });

        return data as T;
      } catch (err2: any) {
        // ✅ DEBUG: retry fout (tijdelijk)
        console.log("SPOTIFY RETRY FAIL", url, "status=", err2?.response?.status);
        console.log("SPOTIFY RETRY BODY", err2?.response?.data);
        throw err2;
      }
    }

    throw err;
  }
}

export async function getTrackAudioFeatures(_accessTokenIgnored: string, trackId: string) {
  return spotifyGet<any>(`https://api.spotify.com/v1/audio-features/${trackId}`);
}

export async function getTrackMeta(_accessTokenIgnored: string, trackId: string) {
  return spotifyGet<any>(`https://api.spotify.com/v1/tracks/${trackId}`);
}