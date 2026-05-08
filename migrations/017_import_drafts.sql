-- migrations/017_import_drafts.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Import drafts (pending user approval)
CREATE TABLE trail_import_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_session_id UUID NOT NULL DEFAULT uuid_generate_v4(),

  -- Import metadata
  bbox JSONB NOT NULL, -- { north, south, east, west }
  filters JSONB, -- { trailType, difficulty, minLength }

  -- Results
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, published
  trails JSONB NOT NULL, -- [{ osmWayId, name, polyline, difficulty, distance, ... }]
  stats JSONB, -- { totalFound, newTrails, duplicates, filtered }

  -- Approval tracking
  selected_trail_ids TEXT[], -- OSM way IDs user selected for approval
  created_trail_db_ids UUID[], -- DB IDs after batch create
  created_change_set_id UUID REFERENCES trail_change_sets(id),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  -- Claude metadata (for debugging)
  claude_prompt_tokens INT,
  claude_output_tokens INT,
  claude_cache_hit BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_import_drafts_user_id ON trail_import_drafts(user_id);
CREATE INDEX idx_import_drafts_status ON trail_import_drafts(status);
CREATE INDEX idx_import_drafts_session ON trail_import_drafts(import_session_id);

-- Add import tracking to revisions
ALTER TABLE trail_revisions ADD COLUMN import_session_id UUID;
ALTER TABLE trail_revisions ADD COLUMN ai_categorized BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_revisions_import_session ON trail_revisions(import_session_id);

COMMENT ON TABLE trail_import_drafts IS 'Pending OSM imports awaiting user approval';
COMMENT ON COLUMN trail_import_drafts.trails IS 'Array of trails ranked by Claude, includes osmWayId for tracking';
COMMENT ON COLUMN trail_import_drafts.selected_trail_ids IS 'OSM way IDs user chose to approve (subset of trails)';
