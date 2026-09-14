-- CajunSites SaaS foundation
-- CajunSites becomes the first tenant while the existing operating workflow remains intact.

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  plan_code TEXT,
  platform_customer_id TEXT,
  platform_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tenants (id, slug, name, status, plan_code)
VALUES (1, 'cajunsites', 'CajunSites', 'active', 'internal');

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  admin_user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, admin_user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INTEGER PRIMARY KEY,
  launch_fee_cents INTEGER NOT NULL DEFAULT 49900,
  hosting_fee_cents INTEGER NOT NULL DEFAULT 4900,
  currency TEXT NOT NULL DEFAULT 'usd',
  concept_domain TEXT NOT NULL DEFAULT 'cajunsites.com',
  sender_name TEXT,
  sender_email TEXT,
  stripe_account_id TEXT,
  onboarding_complete INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

INSERT OR IGNORE INTO tenant_settings
  (tenant_id, launch_fee_cents, hosting_fee_cents, currency, concept_domain, sender_name, onboarding_complete)
VALUES
  (1, 49900, 4900, 'usd', 'cajunsites.com', 'CajunSites', 1);

CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT,
  accent_color TEXT,
  website_url TEXT,
  branding_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

INSERT OR IGNORE INTO tenant_branding
  (tenant_id, display_name, primary_color, accent_color, website_url)
VALUES
  (1, 'CajunSites', '#2d0b50', '#f0b719', 'https://cajunsites.com');

CREATE TABLE IF NOT EXISTS tenant_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  provider TEXT,
  model TEXT,
  estimated_cost_cents REAL,
  prospect_id INTEGER,
  customer_id INTEGER,
  build_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_events_tenant_created
  ON tenant_usage_events (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id INTEGER PRIMARY KEY,
  plan_code TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'internal',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

INSERT OR IGNORE INTO tenant_billing (tenant_id, plan_code, subscription_status)
VALUES (1, 'internal', 'internal');

-- Add tenant ownership to operational records. Existing data belongs to CajunSites tenant 1.
ALTER TABLE prospects ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE concept_builds ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE concept_images ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE design_chat_messages ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_activity ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_id ON prospects (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_concept_builds_tenant_id ON concept_builds (tenant_id, prospect_id);
CREATE INDEX IF NOT EXISTS idx_concept_builds_tenant_build ON concept_builds (tenant_id, build_id);
CREATE INDEX IF NOT EXISTS idx_concept_images_tenant_id ON concept_images (tenant_id, prospect_id);
CREATE INDEX IF NOT EXISTS idx_concept_images_tenant_build ON concept_images (tenant_id, build_id);
CREATE INDEX IF NOT EXISTS idx_design_chat_tenant_prospect ON design_chat_messages (tenant_id, prospect_id, id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_tenant_id ON admin_activity (tenant_id, created_at);

-- Existing admins become members of CajunSites. This keeps current access working while
-- allowing future users to belong to one or more agencies.
INSERT OR IGNORE INTO tenant_memberships (tenant_id, admin_user_id, role, status)
SELECT 1, id, COALESCE(role, 'operator'), 'active'
FROM internal_users;
