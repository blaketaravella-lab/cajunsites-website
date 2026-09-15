CREATE TABLE IF NOT EXISTS customer_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'general',
  alt_text TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'admin',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_assets_customer ON customer_assets(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_assets_build_selection ON customer_assets(customer_id, approval_status, role, created_at DESC);
