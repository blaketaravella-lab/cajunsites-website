import appWorker from './reliability-hotfix.js';
import { resolveDesignSpec, designSpecSummary } from './design-intelligence.js';
const BUILD=/^\/api\/admin\/prospects\/(\d+)\/build-concept$/;
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function parse(v,f={}){try{return v?JSON.parse(v):f}catch{return f}}
async function ensure(env){
  if(!env.DB)return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    build_id TEXT NOT NULL UNIQUE,
    prospect_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    previous_deployment_id TEXT,
    deployment_id TEXT,
    concept_alias TEXT,
    visual_family TEXT,
    visual_version TEXT,
    image_pipeline_version TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ready_at TEXT,
    alias_moved_at TEXT,
    completed_at TEXT,
    error_stage TEXT,
    error_message TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL,
    build_id TEXT,
    image_role TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    policy_id TEXT,
    policy_version TEXT,
    policy_hash TEXT,
    asset_path TEXT,
    deployment_id TEXT,
    generation_status TEXT NOT NULL,
    qa_status TEXT,
    qa_score INTEGER,
    qa_json TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    representation_class TEXT NOT NULL DEFAULT 'representative_service',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    deployed_at TEXT
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_concept_builds_prospect ON concept_builds(prospect_id,started_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_concept_images_prospect ON concept_images(prospect_id,image_role,created_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_concept_images_build ON concept_images(build_id,image_role,attempt_number)').run();
  for(const sql of [
    `ALTER TABLE prospects ADD COLUMN concept_build_id TEXT`,
    `ALTER TABLE prospects ADD COLUMN design_spec_json TEXT`,
    `ALTER TABLE prospects ADD COLUMN design_spec_version TEXT`,
    `ALTER TABLE prospects ADD COLUMN design_spec_updated_at TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN design_spec_json TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN design_spec_version TEXT`
  ]){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
}
async function prepare(env,id){await ensure(env);const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)throw new Error('Prospect not found.');const r=parse(p.research_json,{}),visual={layout:r?.design_profile?.layout,headline:r?.design_profile?.headline},spec=resolveDesignSpec(p,visual);const profile={...(r.design_profile||{}),headline:spec.headline||r?.design_profile?.headline,cta:spec.cta_strategy?.[0]||r?.design_profile?.cta,sections:spec.section_sequence,process:spec.process?.length?spec.process:r?.design_profile?.process,image_theme:spec.image_theme||r?.design_profile?.image_theme,layout:spec.hero,objective:spec.objective,mobile_strategy:spec.mobile_strategy,trust_strategy:spec.trust_strategy,services_presentation:spec.services_presentation,content_density:spec.content_density,imagery_strategy:spec.imagery_strategy,section_sequence:spec.section_sequence,cta_strategy:spec.cta_strategy,personality:spec.personality};const next={...r,design_profile:profile,design_spec:spec};await env.DB.prepare(`UPDATE prospects SET research_json=?,design_spec_json=?,design_spec_version='1.0',design_spec_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(next),JSON.stringify(spec),id).run();try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,'design_intelligence',?,?,CURRENT_TIMESTAMP)`).bind(`Resolved Concept Build design strategy for ${p.business_name}`,JSON.stringify({prospect_id:id,design_spec:spec,summary:designSpecSummary(spec)})).run()}catch{}return spec}
export default{async fetch(request,env,context){if(env.DB){try{await ensure(env)}catch(e){console.error('Concept schema compatibility bootstrap failed',e)}}const url=new URL(request.url),m=url.pathname.match(BUILD);if(!(m&&request.method==='POST'&&env.DB))return appWorker.fetch(request,env,context);let spec;try{spec=await prepare(env,Number(m[1]))}catch(e){return json({ok:false,error:`Design strategy failed: ${String(e?.message||e)}`},500)}const response=await appWorker.fetch(request,env,context);if(response.ok){try{const payload=await response.clone().json();if(payload?.build_id)await env.DB.prepare(`UPDATE concept_builds SET design_spec_json=?,design_spec_version='1.0' WHERE build_id=?`).bind(JSON.stringify(spec),payload.build_id).run()}catch{}}return response}};
