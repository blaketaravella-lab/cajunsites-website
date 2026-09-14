import appWorker from './stale-build-recovery.js';
import staticBuildWorker from './concept-factory-v2.js';
import { compileConceptArchitecture, bridgeArchitectureIntoResearch, ARCHITECTURE_VERSION } from './concept-architecture.js';
import { resolveTenantContext, requireTenantProspect, TenantAccessError } from './tenant-context.js';

const BUILD=/^\/api\/admin\/prospects\/(\d+)\/build-concept$/;
const PREVIEW=/^\/api\/admin\/prospects\/(\d+)\/concept-preview(?:\/(.*))?$/;
const DESIGN_CHAT=/^\/api\/admin\/design-chat\/(\d+)$/;
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const ACTIVE=['Preparing','Generating Images','Packaging','Deploying','Verifying','Activating','Committing'];

function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
function bytesFromBase64(v){const s=String(v||'').replace(/^data:[^,]+,/,'');const bin=atob(s),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function flattenFiles(nodes,prefix=''){const out=[];for(const node of Array.isArray(nodes)?nodes:[]){const path=prefix?`${prefix}/${node.name}`:node.name;if(node.type==='file')out.push({path,uid:node.uid,name:node.name});if(Array.isArray(node.children))out.push(...flattenFiles(node.children,path))}return out}

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
    `ALTER TABLE prospects ADD COLUMN verified_business_profile_json TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_strategy_json TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_design_model_json TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_image_plan_json TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_architecture_version TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_build_readiness TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN design_spec_json TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN design_spec_version TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN concept_strategy_json TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN concept_design_model_json TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN concept_image_plan_json TEXT`,
    `ALTER TABLE concept_builds ADD COLUMN architecture_version TEXT`
  ]){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
}

async function currentUser(request,env,context){
  const headers=new Headers(),cookie=request.headers.get('cookie');
  if(cookie)headers.set('cookie',cookie);
  const r=await appWorker.fetch(new Request(new URL('/api/admin/me',request.url),{method:'GET',headers}),env,context);
  if(!r.ok)return null;
  return (await r.json().catch(()=>null))?.user||null;
}

async function vercelJson(env,path){
  const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel request failed (${r.status}).`);
  return d;
}

async function deploymentFileBytes(env,deploymentId,fileId){
  const r=await fetch(`https://api.vercel.com/v8/deployments/${encodeURIComponent(deploymentId)}/files/${encodeURIComponent(fileId)}${vq(env)}`,{headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`}});
  const text=await r.text();
  if(!r.ok)throw new Error(`Vercel deployment file read failed (${r.status}).`);
  let d;try{d=JSON.parse(text)}catch{throw new Error('Vercel deployment file read returned invalid JSON.')}
  const b64=d?.data||d?.content||d?.file?.data||d?.value;
  if(typeof b64!=='string')throw new Error('Vercel deployment file read did not return base64 content.');
  return bytesFromBase64(b64);
}

async function exactConceptPreview(request,env,context,tenant,id,requestedPath=''){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  const p=await env.DB.prepare('SELECT id,business_name,concept_state,concept_deployment_id FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenant.id,id).first();
  if(!p)return json({ok:false,error:'Prospect not found.'},404);
  const deploymentId=String(p.concept_deployment_id||'').trim();
  if(!deploymentId)return json({ok:false,error:'This prospect does not have a completed concept deployment yet.'},410);
  if(!env.VERCEL_API_TOKEN)return json({ok:false,error:'Vercel preview access is not configured.'},503);
  const logicalPath=(requestedPath||'').replace(/^\/+|\/+$/g,'')||'index.html';
  const allowed=new Set(['index.html','assets/hero.webp','assets/secondary.webp','concept-manifest.json']);
  if(!allowed.has(logicalPath))return json({ok:false,error:'Preview asset not found.'},404);
  try{
    const tree=await vercelJson(env,`/v6/deployments/${encodeURIComponent(deploymentId)}/files`),flat=flattenFiles(tree),node=flat.find(x=>x.path===logicalPath)||flat.find(x=>x.path.endsWith(`/${logicalPath}`));
    if(!node?.uid)return json({ok:false,error:`The stored prospect deployment is missing ${logicalPath}.`},410);
    const bytes=await deploymentFileBytes(env,deploymentId,node.uid),headers={'cache-control':'private, no-store, no-cache, must-revalidate','x-cajunsites-prospect-id':String(id),'x-cajunsites-deployment-id':deploymentId,'x-content-type-options':'nosniff'};
    if(logicalPath==='index.html'){
      let html=new TextDecoder().decode(bytes);const base=`/api/admin/prospects/${id}/concept-preview`;
      html=html.replaceAll('/assets/hero.webp',`${base}/assets/hero.webp`).replaceAll('/assets/secondary.webp',`${base}/assets/secondary.webp`).replaceAll('/concept-manifest.json',`${base}/concept-manifest.json`);
      headers['content-type']='text/html; charset=utf-8';headers['content-security-policy']="default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self';";return new Response(html,{status:200,headers});
    }
    headers['content-type']=logicalPath.endsWith('.webp')?'image/webp':'application/json; charset=utf-8';return new Response(bytes,{status:200,headers});
  }catch(e){return json({ok:false,error:String(e?.message||e),prospect_id:id,deployment_id:deploymentId},502)}
}

async function designChatWithExactPreview(request,env,context,tenant,id){
  const response=await appWorker.fetch(request,env,context);
  if(!response.ok||!env.DB||!String(response.headers.get('content-type')||'').includes('application/json'))return response;
  const payload=await response.clone().json().catch(()=>null);if(!payload?.prospect||Number(payload.prospect.id)!==id)return response;
  const p=await env.DB.prepare('SELECT concept_deployment_id,concept_build_id,concept_state,concept_strategy_json,concept_design_model_json,concept_image_plan_json,concept_build_readiness FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenant.id,id).first();
  const deploymentId=String(p?.concept_deployment_id||'').trim();
  payload.prospect.concept_deployment_id=deploymentId||null;payload.prospect.concept_build_id=p?.concept_build_id||null;payload.prospect.concept_state=p?.concept_state||payload.prospect.concept_state||'Not Built';payload.prospect.concept_url=deploymentId?`${new URL(request.url).origin}/api/admin/prospects/${id}/concept-preview`:null;payload.prospect.public_concept_url=null;
  payload.concept_strategy=p?.concept_strategy_json?JSON.parse(p.concept_strategy_json):null;payload.current_design=p?.concept_design_model_json?JSON.parse(p.concept_design_model_json):payload.current_design;payload.image_plan=p?.concept_image_plan_json?JSON.parse(p.concept_image_plan_json):null;payload.build_readiness=p?.concept_build_readiness||null;
  return new Response(JSON.stringify(payload),{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}

async function prepare(env,tenant,id){
  await ensure(env);const p=await env.DB.prepare('SELECT * FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenant.id,id).first();if(!p)throw new Error('Prospect not found.');
  const architecture=await compileConceptArchitecture(env,p),nextResearch=bridgeArchitectureIntoResearch(p,architecture);
  await env.DB.prepare(`UPDATE prospects SET research_json=?,verified_business_profile_json=?,concept_strategy_json=?,concept_design_model_json=?,concept_image_plan_json=?,concept_architecture_version=?,concept_build_readiness=?,design_spec_json=?,design_spec_version=?,design_spec_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?`).bind(JSON.stringify(nextResearch),JSON.stringify(architecture.profile),JSON.stringify(architecture.strategy),JSON.stringify(architecture.design_model),JSON.stringify(architecture.image_plan),architecture.architecture_version,architecture.build_readiness,JSON.stringify(architecture.strategy),architecture.architecture_version,tenant.id,id).run();
  try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,'concept_architecture',?,?,CURRENT_TIMESTAMP)`).bind(`Compiled verified business profile and concept strategy for ${p.business_name}`,JSON.stringify({prospect_id:id,architecture_version:architecture.architecture_version,build_readiness:architecture.build_readiness,source:architecture.source,warning:architecture.warning||null,objective:architecture.strategy?.objective,image_roles:(architecture.image_plan?.roles||[]).map(x=>x.role)})).run()}catch{}
  return architecture;
}

async function buildGate(env,tenant,id){
  const p=await env.DB.prepare('SELECT concept_state,concept_build_id,concept_url FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenant.id,id).first();if(!p||p.concept_state!=='Building')return null;
  const b=p.concept_build_id?await env.DB.prepare('SELECT build_id,status,started_at FROM concept_builds WHERE tenant_id=? AND build_id=? LIMIT 1').bind(tenant.id,p.concept_build_id).first():null,fresh=b?.started_at&&Date.parse(String(b.started_at).replace(' ','T')+'Z')>Date.now()-15*60*1000;
  if(b&&ACTIVE.includes(b.status)&&fresh)return{blocked:true,build_id:b.build_id,status:b.status};
  const message='Previous concept build stopped before completion and was released so a new build can start.';await env.DB.prepare(`UPDATE prospects SET concept_state=CASE WHEN COALESCE(concept_url,'')<>'' THEN 'Built' ELSE 'Build Failed' END,concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND concept_state='Building'`).bind(message,tenant.id,id).run();if(b?.build_id&&ACTIVE.includes(b.status))await env.DB.prepare(`UPDATE concept_builds SET status='Failed',completed_at=CURRENT_TIMESTAMP,error_stage='Interrupted',error_message=? WHERE tenant_id=? AND build_id=?`).bind(message,tenant.id,b.build_id).run().catch(()=>{});return null;
}

export default{async fetch(request,env,context){
  const url=new URL(request.url),preview=url.pathname.match(PREVIEW),chat=url.pathname.match(DESIGN_CHAT),m=url.pathname.match(BUILD);
  const protectedId=preview?Number(preview[1]):chat?Number(chat[1]):m?Number(m[1]):null;
  let tenant=null;
  if(protectedId){
    const user=await currentUser(request,env,context);if(!user)return json({ok:false,error:'Authentication required.'},401);
    try{tenant=await resolveTenantContext(env,user);await requireTenantProspect(env,tenant,protectedId,'id')}
    catch(error){if(error instanceof TenantAccessError)return json({ok:false,error:error.message},error.status);throw error}
  }
  if(preview&&request.method==='GET')return exactConceptPreview(request,env,context,tenant,Number(preview[1]),preview[2]||'');
  if(chat&&request.method==='GET')return designChatWithExactPreview(request,env,context,tenant,Number(chat[1]));
  if(chat)return appWorker.fetch(request,env,context);
  if(!(m&&request.method==='POST'&&env.DB))return appWorker.fetch(request,env,context);
  const id=Number(m[1]),gate=await buildGate(env,tenant,id);if(gate?.blocked)return json({ok:false,error:`A concept build is already in progress (${gate.status}).`,build_id:gate.build_id,error_stage:gate.status,in_progress:true},409);
  let architecture;try{architecture=await prepare(env,tenant,id)}catch(e){return json({ok:false,error:`Concept strategy failed: ${String(e?.message||e)}`},500)}
  if(architecture.build_readiness!=='ready'){
    const identity=architecture.build_readiness==='needs_identity_review',message=identity?'Business identity needs review before a concept can be built.':'Business research needs more verified detail before a concept can be built.';
    await env.DB.prepare(`UPDATE prospects SET concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?`).bind(message,tenant.id,id).run().catch(()=>{});
    return json({ok:false,error:message,requires_review:true,review_type:identity?'identity':'research',build_readiness:architecture.build_readiness},409);
  }
  const response=await staticBuildWorker.fetch(request,env,context);
  if(response.ok){try{const payload=await response.clone().json();if(payload?.build_id)await env.DB.prepare(`UPDATE concept_builds SET design_spec_json=?,design_spec_version=?,concept_strategy_json=?,concept_design_model_json=?,concept_image_plan_json=?,architecture_version=? WHERE tenant_id=? AND build_id=?`).bind(JSON.stringify(architecture.strategy),ARCHITECTURE_VERSION,JSON.stringify(architecture.strategy),JSON.stringify(architecture.design_model),JSON.stringify(architecture.image_plan),ARCHITECTURE_VERSION,tenant.id,payload.build_id).run()}catch{}}
  return response;
}};
