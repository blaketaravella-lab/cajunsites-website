ALTER TABLE prospects ADD COLUMN research_status TEXT NOT NULL DEFAULT 'Not Run';
ALTER TABLE prospects ADD COLUMN business_vertical TEXT;
ALTER TABLE prospects ADD COLUMN research_json TEXT;
ALTER TABLE prospects ADD COLUMN research_error TEXT;
ALTER TABLE prospects ADD COLUMN researched_at TEXT;

ALTER TABLE prospects ADD COLUMN visual_family TEXT;
ALTER TABLE prospects ADD COLUMN visual_version TEXT;
ALTER TABLE prospects ADD COLUMN visual_variant TEXT;
ALTER TABLE prospects ADD COLUMN visual_classifier_score REAL;
ALTER TABLE prospects ADD COLUMN visual_classifier_signal TEXT;
ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0;
