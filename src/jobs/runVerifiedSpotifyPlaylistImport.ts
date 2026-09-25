import "dotenv/config";
import {
  disconnectVerifiedSpotifyPlaylistImporter,
  runVerifiedSpotifyPlaylistImport,
} from "../services/spotifyVerifiedPlaylistImporter";

async function main(): Promise<void> {
  console.log("Starting verified Spotify playlist import job...");

  try {
    await runVerifiedSpotifyPlaylistImport();
    console.log("Verified Spotify playlist import job completed.");
  } catch (error) {
    console.error("Verified Spotify playlist import job failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await disconnectVerifiedSpotifyPlaylistImporter();
  }
}

void main();