-- Tenant boundary for the concept pipeline.
-- Existing CajunSites data is assigned to tenant 1 without changing current behavior.

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tenants (id, slug, name, status)
VALUES (1, 'cajunsites', 'CajunSites', 'active');

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'operator', 'viewer', 'service')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'removed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES internal_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
ON tenant_memberships(user_id, status, tenant_id);

INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, status)
SELECT
  1,
  id,
  CASE
    WHEN role = 'owner' THEN 'owner'
    WHEN role = 'admin' THEN 'admin'
    WHEN role = 'viewer' THEN 'viewer'
    ELSE 'operator'
  END,
  'active'
FROM internal_users;

ALTER TABLE internal_users ADD COLUMN current_tenant_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE prospects ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE concept_builds ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE concept_images ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE design_chat_messages ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE platform_jobs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE provider_usage_events ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE research_cache ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

UPDATE internal_users SET current_tenant_id = 1 WHERE current_tenant_id IS NULL;
UPDATE prospects SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE concept_builds SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE concept_images SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE design_chat_messages SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE platform_jobs SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE provider_usage_events SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE research_cache SET tenant_id = 1 WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_stage
ON prospects(tenant_id, stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_concept
ON prospects(tenant_id, concept_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_builds_tenant_prospect
ON concept_builds(tenant_id, prospect_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_images_tenant_prospect
ON concept_images(tenant_id, prospect_id, image_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_images_tenant_build
ON concept_images(tenant_id, build_id, image_role, attempt_number);

CREATE INDEX IF NOT EXISTS idx_design_chat_tenant_prospect
ON design_chat_messages(tenant_id, prospect_id, id);

CREATE INDEX IF NOT EXISTS idx_platform_jobs_tenant_status
ON platform_jobs(tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_usage_tenant_created
ON provider_usage_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_cache_tenant_key
ON research_cache(tenant_id, cache_key);

CREATE TRIGGER IF NOT EXISTS concept_builds_tenant_matches_prospect_insert
BEFORE INSERT ON concept_builds
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM prospects p
  WHERE p.id = NEW.prospect_id AND p.tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'concept build tenant does not match prospect tenant');
END;

CREATE TRIGGER IF NOT EXISTS concept_builds_tenant_matches_prospect_update
BEFORE UPDATE OF tenant_id, prospect_id ON concept_builds
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM prospects p
  WHERE p.id = NEW.prospect_id AND p.tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'concept build tenant does not match prospect tenant');
END;

CREATE TRIGGER IF NOT EXISTS concept_images_tenant_matches_prospect_insert
BEFORE INSERT ON concept_images
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM prospects p
  WHERE p.id = NEW.prospect_id AND p.tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'concept image tenant does not match prospect tenant');
END;

CREATE TRIGGER IF NOT EXISTS design_chat_tenant_matches_prospect_insert
BEFORE INSERT ON design_chat_messages
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM prospects p
  WHERE p.id = NEW.prospect_id AND p.tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'design chat tenant does not match prospect tenant');
END;
