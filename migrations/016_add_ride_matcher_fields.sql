-- Add ride-matcher game tracking
-- Tracks when users last started a game for rate limiting (1 game per 15 min Strava API rate limit cycle)

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_game_started_at TIMESTAMPTZ;

-- Create index for efficient rate limit checks (CONCURRENTLY to avoid locking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_last_game_started_at_idx ON users (last_game_started_at);
