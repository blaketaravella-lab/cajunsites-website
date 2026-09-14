ALTER TABLE prospects ADD COLUMN concept_build_id TEXT;

CREATE TABLE IF NOT EXISTS concept_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL UNIQUE,
  prospect_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  previous_deployment_id TEXT,
  deployment_id TEXT,
  concept_alias TEXT,
  visual_family TEXT,
  visual_version TEXT,
  image_pipeline_version TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  alias_moved_at TEXT,
  completed_at TEXT,
  error_stage TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_concept_builds_prospect
ON concept_builds(prospect_id, started_at DESC);

CREATE TABLE IF NOT EXISTS concept_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  build_id TEXT,
  image_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  policy_id TEXT,
  policy_version TEXT,
  policy_hash TEXT,
  asset_path TEXT,
  deployment_id TEXT,
  generation_status TEXT NOT NULL,
  qa_status TEXT,
  qa_score INTEGER,
  qa_json TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  representation_class TEXT NOT NULL DEFAULT 'representative_service',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  deployed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_concept_images_prospect
ON concept_images(prospect_id, image_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_images_build
ON concept_images(build_id, image_role, attempt_number);