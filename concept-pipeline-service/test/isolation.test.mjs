import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetKey } from '../src/repository.js';

const schema = readFileSync(new URL('../migrations/0001_schema.sql', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../src/repository.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

for (const table of [
  'tenant_api_credentials',
  'prospects',
  'concept_builds',
  'concept_images',
  'provider_usage_events',
  'audit_events',
  'migration_imports',
]) {
  assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
  assert.match(
    schema.slice(schema.indexOf(`CREATE TABLE ${table}`)),
    /tenant_id INTEGER NOT NULL/,
    `${table} must have a required tenant key`,
  );
}

assert.match(schema, /FOREIGN KEY \(tenant_id, prospect_id\)/);
assert.match(schema, /UNIQUE \(tenant_id, idempotency_key\)/);
assert.match(auth, /JOIN tenants t ON t\.id = c\.tenant_id/);
assert.match(auth, /c\.status = 'active'/);
assert.match(repository, /WHERE tenant_id=\? AND external_id=\?/);
assert.match(repository, /WHERE tenant_id=\? AND prospect_id=\?/);
assert.match(repository, /ON CONFLICT\(tenant_id,idempotency_key\)/);
assert.match(api, /requireScope\(tenant, 'prospects:read'\)/);
assert.match(api, /requireScope\(tenant, 'builds:write'\)/);
assert.match(api, /Idempotency-Key is required/);

const tenantOne = { tenantExternalId: 'tenant-cajunsites' };
const tenantTwo = { tenantExternalId: 'tenant-two' };
const one = assetKey(tenantOne, 'prospect-7', 'build-2', 'hero.webp');
const two = assetKey(tenantTwo, 'prospect-7', 'build-2', 'hero.webp');

assert.equal(one, 'tenants/tenant-cajunsites/prospects/prospect-7/builds/build-2/hero.webp');
assert.equal(two, 'tenants/tenant-two/prospects/prospect-7/builds/build-2/hero.webp');
assert.notEqual(one, two);

console.log('Standalone concept pipeline isolation invariants passed.');
