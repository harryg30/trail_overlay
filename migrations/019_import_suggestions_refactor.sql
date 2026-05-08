-- migrations/019_import_suggestions_refactor.sql
-- Split AI analysis into a separate step for OSM suggestions

ALTER TABLE trail_import_drafts
  ADD COLUMN suggestion_set_name VARCHAR(255),
  ADD COLUMN ai_analyzed BOOLEAN DEFAULT FALSE,
  ADD COLUMN ai_analyzed_at TIMESTAMPTZ;

CREATE INDEX idx_import_drafts_ai_analyzed ON trail_import_drafts(ai_analyzed);
