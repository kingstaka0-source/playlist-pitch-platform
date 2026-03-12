import axios from "axios";

let cachedToken: string | null = null;
let cachedUntilMs = 0;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v.replace(/^"|"$/g, ""); // strip eventuele quotes
}

export async function getSpotifyAppAccessToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < cachedUntilMs) return cachedToken;

  const clientId = mustEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = mustEnv("SPOTIFY_CLIENT_SECRET");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10_000,
    }
  );

  const token = res.data?.access_token as string | undefined;
  const expiresIn = Number(res.data?.expires_in ?? 0);

  if (!token || !expiresIn) {
    throw new Error(`Spotify token response invalid: ${JSON.stringify(res.data)}`);
  }

  // refresh 30s early
  cachedToken = token;
  cachedUntilMs = Date.now() + expiresIn * 1000 - 30_000;

  return cachedToken;
}