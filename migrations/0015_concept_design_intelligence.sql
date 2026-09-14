ALTER TABLE prospects ADD COLUMN design_spec_json TEXT;
ALTER TABLE prospects ADD COLUMN design_spec_version TEXT;
ALTER TABLE prospects ADD COLUMN design_spec_updated_at TEXT;
ALTER TABLE concept_builds ADD COLUMN design_spec_json TEXT;
ALTER TABLE concept_builds ADD COLUMN design_spec_version TEXT;
CREATE INDEX IF NOT EXISTS idx_prospects_design_spec ON prospects(design_spec_version, design_spec_updated_at);
