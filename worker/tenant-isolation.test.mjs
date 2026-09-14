import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveTenantContext,
  requireTenantProspect,
  TenantAccessError,
} from './tenant-context.js';

const migration = readFileSync(
  new URL('../migrations/0016_concept_pipeline_tenants.sql', import.meta.url),
  'utf8',
);
const helper = readFileSync(new URL('./tenant-context.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('./auth.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./concept-design-worker.js', import.meta.url), 'utf8');
const factory = readFileSync(new URL('./concept-factory-v2.js', import.meta.url), 'utf8');
const images = readFileSync(new URL('./image-pipeline/ai-image-pipeline.js', import.meta.url), 'utf8');
const prospects = readFileSync(new URL('./prospects.js', import.meta.url), 'utf8');
const designChat = readFileSync(new URL('./design-chat.js', import.meta.url), 'utf8');

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

assert.match(auth, /current_tenant_id/);
assert.match(auth, /resolveTenantContext/);
assert.match(routes, /requireTenantProspect/);
assert.match(routes, /WHERE tenant_id=\? AND id=\?/);
assert.match(factory, /INSERT INTO concept_builds \(tenant_id,/);
assert.match(factory, /UPDATE concept_builds SET .* WHERE tenant_id=\? AND build_id=\?/);
assert.match(images, /INSERT INTO concept_images \(tenant_id,/);
assert.match(images, /INSERT INTO provider_usage_events \(tenant_id,/);
assert.match(prospects, /SELECT \* FROM prospects WHERE tenant_id=\?/);
assert.match(prospects, /INSERT INTO prospects\s+\(tenant_id,/);
assert.match(designChat, /design_chat_messages WHERE tenant_id=\?/);
assert.match(designChat, /INSERT INTO design_chat_messages \(tenant_id,/);

function fakeEnv() {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                if (sql.includes('FROM tenant_memberships')) {
                  const [userId, requestedTenantId] = values;
                  const memberships = {
                    101: [1],
                    202: [2],
                  };
                  const allowed = memberships[userId] || [];
                  const selected = requestedTenantId || allowed[0];
                  if (!allowed.includes(selected)) return null;
                  return {
                    tenant_id: selected,
                    tenant_slug: selected === 1 ? 'cajunsites' : 'tenant-two',
                    tenant_name: selected === 1 ? 'CajunSites' : 'Tenant Two',
                    tenant_role: 'owner',
                  };
                }

                if (sql.includes('FROM prospects WHERE tenant_id')) {
                  const [tenantId, prospectId] = values;
                  const owner = { 11: 1, 22: 2 }[prospectId];
                  return owner === tenantId ? { id: prospectId, tenant_id: tenantId } : null;
                }

                return null;
              },
            };
          },
        };
      },
    },
  };
}

const env = fakeEnv();
const tenantOne = await resolveTenantContext(env, { id: 101, current_tenant_id: 1 });
const tenantTwo = await resolveTenantContext(env, { id: 202, current_tenant_id: 2 });

assert.equal(tenantOne.id, 1);
assert.equal(tenantTwo.id, 2);
assert.equal((await requireTenantProspect(env, tenantOne, 11, 'id')).id, 11);
assert.equal((await requireTenantProspect(env, tenantTwo, 22, 'id')).id, 22);

await assert.rejects(
  () => resolveTenantContext(env, { id: 101, current_tenant_id: 2 }),
  (error) => error instanceof TenantAccessError && error.status === 403,
);
await assert.rejects(
  () => requireTenantProspect(env, tenantOne, 22, 'id'),
  (error) => error instanceof TenantAccessError && error.status === 404,
);
await assert.rejects(
  () => requireTenantProspect(env, tenantTwo, 11, 'id'),
  (error) => error instanceof TenantAccessError && error.status === 404,
);

console.log('Tenant isolation request and data-boundary invariants passed.');
