ALTER TABLE internal_users ADD COLUMN password_scheme TEXT;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  successful INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_lookup ON admin_login_attempts(email_hash,ip_hash,created_at);

ALTER TABLE customers ADD COLUMN billing_status TEXT;
ALTER TABLE customers ADD COLUMN subscription_status TEXT;
ALTER TABLE customers ADD COLUMN payment_issue_previous_status TEXT;
ALTER TABLE customers ADD COLUMN last_payment_failed_at TEXT;
ALTER TABLE customers ADD COLUMN last_payment_recovered_at TEXT;
ALTER TABLE customers ADD COLUMN last_refund_at TEXT;

CREATE TABLE IF NOT EXISTS website_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER,
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  industry TEXT,
  domain_status TEXT,
  services TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'Website Inquiry',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);
CREATE INDEX IF NOT EXISTS idx_website_leads_created ON website_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_website_leads_prospect ON website_leads(prospect_id);
