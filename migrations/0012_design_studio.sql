ALTER TABLE prospects ADD COLUMN design_directives_json TEXT;
ALTER TABLE prospects ADD COLUMN design_directives_updated_at TEXT;

CREATE TABLE IF NOT EXISTS design_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  proposal_json TEXT,
  in_scope INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_design_chat_prospect
  ON design_chat_messages(prospect_id, id);
