import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/0016_concept_pipeline_tenants.sql', import.meta.url),
  'utf8',
);
const helper = readFileSync(new URL('./tenant-context.js', import.meta.url), 'utf8');

for (const table of [
  'prospects',
  'concept_builds',
  'concept_images',
  'design_chat_messages',
  'platform_jobs',
  'provider_usage_events',
  'research_cache',
]) {
  assert.match(
    migration,
    new RegExp(`ALTER TABLE ${table} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1`),
    `${table} must receive a non-null tenant key`,
  );
}

assert.match(migration, /CREATE TABLE IF NOT EXISTS tenants/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_memberships/);
assert.match(migration, /concept build tenant does not match prospect tenant/);
assert.match(migration, /concept image tenant does not match prospect tenant/);
assert.match(migration, /design chat tenant does not match prospect tenant/);

assert.match(helper, /tm\.user_id = \?/);
assert.match(helper, /tm\.status = 'active'/);
assert.match(helper, /t\.status = 'active'/);
assert.match(helper, /prospects WHERE tenant_id = \? AND id = \?/);
assert.doesNotMatch(helper, /WHERE id = \? LIMIT 1/);

console.log('Tenant isolation foundation invariants passed.');
