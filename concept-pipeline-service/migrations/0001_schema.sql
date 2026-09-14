PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_api_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  key_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_tenant_api_credentials_lookup
ON tenant_api_credentials(key_id, status);

CREATE TABLE prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  category TEXT,
  city TEXT,
  state TEXT,
  phone TEXT,
  email TEXT,
  research_status TEXT NOT NULL DEFAULT 'Not Run',
  concept_state TEXT NOT NULL DEFAULT 'Not Built',
  verified_business_profile_json TEXT,
  concept_strategy_json TEXT,
  concept_design_model_json TEXT,
  concept_image_plan_json TEXT,
  design_directives_json TEXT,
  source_payload_json TEXT,
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, external_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_prospects_tenant_state
ON prospects(tenant_id, concept_state, updated_at DESC);

CREATE TABLE concept_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  prospect_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Queued',
  stage TEXT,
  deployment_id TEXT,
  concept_alias TEXT,
  architecture_version TEXT,
  visual_version TEXT,
  image_pipeline_version TEXT,
  error_stage TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, external_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, prospect_id)
    REFERENCES prospects(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_concept_builds_tenant_prospect
ON concept_builds(tenant_id, prospect_id, created_at DESC);

CREATE TABLE concept_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  prospect_id INTEGER NOT NULL,
  build_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  image_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  asset_key TEXT,
  generation_status TEXT NOT NULL,
  qa_status TEXT,
  qa_score INTEGER,
  qa_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  deployed_at TEXT,
  UNIQUE (tenant_id, external_id),
  FOREIGN KEY (tenant_id, prospect_id)
    REFERENCES prospects(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, build_id)
    REFERENCES concept_builds(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_concept_images_tenant_build
ON concept_images(tenant_id, build_id, image_role, created_at DESC);

CREATE TABLE provider_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  prospect_id INTEGER,
  build_id INTEGER,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  model TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  usage_json TEXT,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, prospect_id)
    REFERENCES prospects(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, build_id)
    REFERENCES concept_builds(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_provider_usage_tenant_created
ON provider_usage_events(tenant_id, created_at DESC);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  request_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_audit_events_tenant_created
ON audit_events(tenant_id, created_at DESC);

CREATE TABLE migration_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  source_system TEXT NOT NULL,
  source_export_id TEXT NOT NULL,
  status TEXT NOT NULL,
  row_counts_json TEXT,
  checksum TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE (tenant_id, source_system, source_export_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
