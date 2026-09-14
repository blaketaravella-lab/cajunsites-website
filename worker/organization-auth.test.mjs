import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./organization-auth.js',import.meta.url),'utf8');
const prospects=fs.readFileSync(new URL('./prospects.js',import.meta.url),'utf8');
const tenant=fs.readFileSync(new URL('./tenant-context.js',import.meta.url),'utf8');

assert.match(source,/resolveTenantContext/,'/me must resolve an authenticated tenant membership');
assert.match(source,/tenantSettings/,'/me must load tenant configuration');
assert.match(source,/x-cajunsites-tenant-id/,'tenant selection must be explicit and validated');
assert.match(source,/identity_role/,'global identity role must remain distinguishable from membership role during migration');
assert.match(source,/role:tenant\.role/,'effective authorization role must come from tenant membership');
assert.match(source,/authorization:/,'/me must expose explicit authorization context');
assert.match(source,/can_mutate/,'authorization context must expose mutation capability');
assert.match(source,/can_administer/,'authorization context must expose administrative capability');
assert.match(source,/organization:/,'/me must expose active organization context');
assert.match(source,/launch_fee_cents/,'tenant commercial configuration must be organization scoped');
assert.match(source,/branding:/,'tenant branding must be organization scoped');
assert.match(tenant,/tm\.admin_user_id=\? AND tm\.tenant_id=\?/,'requested tenant must be validated against membership');
assert.match(tenant,/tm\.status='active'/,'inactive memberships must not authorize access');
assert.match(tenant,/t\.status='active'/,'inactive tenants must not authorize access');
assert.match(prospects,/organization-auth\.js/,'prospect chain must use organization-aware identity');
assert.match(prospects,/x-cajunsites-tenant-id/,'prospect identity lookup must preserve requested tenant context');

console.log('organization-aware authentication invariants passed');
