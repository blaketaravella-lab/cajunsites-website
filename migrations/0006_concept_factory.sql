ALTER TABLE prospects ADD COLUMN concept_state TEXT NOT NULL DEFAULT 'Not Built';
ALTER TABLE prospects ADD COLUMN concept_slug TEXT;
ALTER TABLE prospects ADD COLUMN concept_deployment_id TEXT;
ALTER TABLE prospects ADD COLUMN concept_build_error TEXT;
ALTER TABLE prospects ADD COLUMN concept_built_at TEXT;

UPDATE prospects
SET concept_state = CASE
  WHEN COALESCE(concept_url, '') <> '' THEN 'Built'
  ELSE 'Not Built'
END;
