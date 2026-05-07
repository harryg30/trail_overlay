-- Add instructions column to trail_import_drafts for persisting user guidance
ALTER TABLE trail_import_drafts
  ADD COLUMN instructions TEXT DEFAULT '';
