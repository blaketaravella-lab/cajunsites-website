ALTER TABLE prospects ADD COLUMN visual_family TEXT;
ALTER TABLE prospects ADD COLUMN visual_version TEXT;
ALTER TABLE prospects ADD COLUMN visual_variant TEXT;
ALTER TABLE prospects ADD COLUMN visual_classifier_score REAL;
ALTER TABLE prospects ADD COLUMN visual_classifier_signal TEXT;
ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0;
