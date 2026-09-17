-- Allow multiple TuneReach artist profiles to connect through the same Spotify user account.
-- spotifyArtistId remains unique and identifies the actual Spotify artist profile.
DROP INDEX IF EXISTS "Artist_spotifyId_key";
