ALTER TABLE prospects ADD COLUMN outreach_status TEXT NOT NULL DEFAULT 'Ready to Call';
ALTER TABLE prospects ADD COLUMN last_call_at TEXT;
ALTER TABLE prospects ADD COLUMN last_call_result TEXT;
ALTER TABLE prospects ADD COLUMN last_contacted_at TEXT;
ALTER TABLE prospects ADD COLUMN last_email_at TEXT;
ALTER TABLE prospects ADD COLUMN last_email_id TEXT;
ALTER TABLE prospects ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prospects ADD COLUMN outreach_unsubscribe_token TEXT;

CREATE TABLE IF NOT EXISTS prospect_outreach_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  result TEXT,
  notes TEXT,
  provider_id TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outreach_events_prospect ON prospect_outreach_events(prospect_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_events_provider ON prospect_outreach_events(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_unsubscribe_token ON prospects(outreach_unsubscribe_token) WHERE outreach_unsubscribe_token IS NOT NULL;
