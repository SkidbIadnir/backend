-- Tasting photos (backend PR #15).
ALTER TABLE tasteep_tastings ADD COLUMN IF NOT EXISTS photo_id uuid;
