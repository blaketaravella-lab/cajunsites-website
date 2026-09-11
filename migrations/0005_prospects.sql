CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  category TEXT,
  city TEXT,
  state TEXT,
  concept_url TEXT,
  stage TEXT NOT NULL DEFAULT 'Qualified',
  qualification TEXT,
  website_gate TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  call_attempts INTEGER NOT NULL DEFAULT 0,
  decision_maker_reached INTEGER NOT NULL DEFAULT 0,
  concept_viewed INTEGER NOT NULL DEFAULT 0,
  next_follow_up TEXT,
  outcome TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage);
CREATE INDEX IF NOT EXISTS idx_prospects_business ON prospects(business_name);
