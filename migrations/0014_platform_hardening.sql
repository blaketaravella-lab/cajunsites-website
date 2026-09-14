CREATE TABLE IF NOT EXISTS research_cache (
  cache_key TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  phone TEXT,
  payload_json TEXT NOT NULL,
  identity_confidence TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_cache_expiry
ON research_cache(expires_at);

CREATE TABLE IF NOT EXISTS platform_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL UNIQUE,
  prospect_id INTEGER,
  customer_id INTEGER,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Queued',
  stage TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_jobs_status
ON platform_jobs(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_jobs_prospect
ON platform_jobs(prospect_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER,
  customer_id INTEGER,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  model TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  request_count INTEGER NOT NULL DEFAULT 1,
  usage_json TEXT,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_created
ON provider_usage_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_usage_operation
ON provider_usage_events(provider, operation, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_snapshots (
  customer_id INTEGER PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  amount_cents INTEGER,
  interval TEXT,
  mrr_cents INTEGER NOT NULL DEFAULT 0,
  open_balance_cents INTEGER NOT NULL DEFAULT 0,
  delinquent INTEGER NOT NULL DEFAULT 0,
  last_invoice_status TEXT,
  current_period_end TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_snapshots_status
ON billing_snapshots(subscription_status, synced_at DESC);
