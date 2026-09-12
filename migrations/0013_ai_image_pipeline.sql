CREATE TABLE IF NOT EXISTS concept_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  image_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  policy_id TEXT,
  policy_version TEXT,
  policy_hash TEXT,
  storage_key TEXT,
  public_url TEXT,
  generation_status TEXT NOT NULL,
  qa_status TEXT,
  qa_json TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  representation_class TEXT NOT NULL DEFAULT 'representative_service',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_concept_images_prospect
ON concept_images(prospect_id, image_role, created_at DESC);
