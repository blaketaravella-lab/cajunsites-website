CREATE TABLE IF NOT EXISTS customer_site_content (
  customer_id INTEGER PRIMARY KEY,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_site_content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  change_summary TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(customer_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_site_content_versions
  ON customer_site_content_versions(customer_id, version_number DESC);
