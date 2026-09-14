import fs from 'node:fs';
import assert from 'node:assert/strict';

const designChat=fs.readFileSync(new URL('./design-chat.js',import.meta.url),'utf8');
const conceptDesign=fs.readFileSync(new URL('./concept-design-worker.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0015_saas_foundation.sql',import.meta.url),'utf8');

const checks=[
  [migration.includes('ALTER TABLE design_chat_messages ADD COLUMN tenant_id'), 'design_chat_messages must be tenant-owned'],
  [migration.includes('idx_concept_builds_tenant_build'), 'concept builds need tenant/build index'],
  [migration.includes('idx_concept_images_tenant_build'), 'concept images need tenant/build index'],
  [designChat.includes("SELECT * FROM prospects WHERE tenant_id=? AND id=?"), 'Design Studio prospect lookup must be tenant scoped'],
  [designChat.includes('WHERE tenant_id=? AND prospect_id=?'), 'Design Studio history must be tenant scoped'],
  [designChat.includes('INSERT INTO design_chat_messages (tenant_id,prospect_id'), 'Design Studio messages must record tenant ownership'],
  [designChat.includes("SELECT * FROM design_chat_messages WHERE tenant_id=? AND id=? AND prospect_id=?"), 'proposal application must enforce tenant ownership'],
  [designChat.includes("if(research){const id=Number(research[1]);const p=await prospect(env,id,tenant)"), 'research endpoint must validate tenant-owned prospect before dispatch'],
  [conceptDesign.includes("SELECT id,business_name,concept_state,concept_deployment_id FROM prospects WHERE tenant_id=? AND id=?"), 'exact preview must enforce tenant ownership'],
  [conceptDesign.includes("SELECT * FROM prospects WHERE tenant_id=? AND id=?"), 'architecture compiler must load tenant-owned prospect'],
  [conceptDesign.includes("SELECT build_id,status,started_at FROM concept_builds WHERE tenant_id=? AND build_id=?"), 'build gate must use tenant/build ownership'],
  [conceptDesign.includes("UPDATE concept_images SET tenant_id=? WHERE build_id=? AND prospect_id=?"), 'generated images must be attributed to the owning tenant'],
  [conceptDesign.includes("INSERT INTO admin_activity (tenant_id,customer_id,event_type"), 'concept architecture audit events must carry tenant context'],
  [conceptDesign.includes("'x-cajunsites-tenant-id':String(tenant.tenant_id)"), 'preview responses must expose verified tenant context for evidence/debugging'],
];

for(const [ok,message] of checks)assert.ok(ok,message);
console.log(`Tenant concept isolation invariants passed (${checks.length} checks).`);
