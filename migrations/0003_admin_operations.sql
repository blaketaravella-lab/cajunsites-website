CREATE TABLE IF NOT EXISTS admin_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_created
ON admin_activity(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_customer
ON admin_activity(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer
ON customer_notes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_sites (
  customer_id INTEGER PRIMARY KEY,
  domain TEXT,
  preview_url TEXT,
  production_url TEXT,
  template_key TEXT,
  internal_notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
