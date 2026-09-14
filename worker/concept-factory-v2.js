import legacyWorker from './concept-factory.js';
import { classifyVisualFamily, getVisualSystem, buildConceptDocument } from './visual-family-engine.js';
import { generateApprovedConceptImages, applyAIImages, bytesFromB64 } from './image-pipeline/ai-image-pipeline.js';

const BUILD_RE=/^\/api\/admin\/prospects\/(\d+)\/build-concept$/;
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_PROJECT='cajun-sites-prospect-websites';
const IMAGE_PIPELINE_VERSION='ai-image-v2-static';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function slugify(v){return clean(v,200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,63)}
function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
function makeBuildId(id){return `${new Date().toISOString().replace(/[-:.]/g,'')}-${id}-${crypto.randomUUID().slice(0,8)}`}
function utf8Bytes(v){return new TextEncoder().encode(String(v??''))}
function deploymentBaseUrl(dep){const raw=clean(dep?.url||dep?.alias?.[0]||'',500).replace(/^https?:\/\//,'').replace(/\/$/,'');return raw?`https://${raw}`:''}
function readResearch(p){try{return p?.research_json?JSON.parse(p.research_json):null}catch{return null}}
function sameOriginMutation(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
function isWebp(bytes){return bytes?.length>=12&&bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46&&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50}

async function sha1Hex(bytes){const digest=await crypto.subtle.digest('SHA-1',bytes);return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function currentUser(request,env){const headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const r=await legacyWorker.fetch(new Request(new URL('/api/admin/me',request.url),{method:'GET',headers}),env);if(!r.ok)return null;return (await r.json().catch(()=>null))?.user||null}
async function recordActivity(env,user,p,description,metadata={},eventType='concept_build'){try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,?,?,?,CURRENT_TIMESTAMP)`).bind(eventType,description,JSON.stringify({prospect_id:p.id,business_name:p.business_name,...metadata,actor:user?{id:user.id,name:user.name,email:user.email,role:user.role}:null})).run()}catch{}}

async function ensureSchema(env){
  if(!env.DB)return;
  const alters=[
    "ALTER TABLE prospects ADD COLUMN concept_state TEXT NOT NULL DEFAULT 'Not Built'",
    'ALTER TABLE prospects ADD COLUMN concept_slug TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_deployment_id TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_build_error TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_built_at TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_build_id TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_family TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_version TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_variant TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_classifier_score REAL',
    'ALTER TABLE prospects ADD COLUMN visual_classifier_signal TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0'
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,build_id TEXT NOT NULL UNIQUE,prospect_id INTEGER NOT NULL,status TEXT NOT NULL,
    previous_deployment_id TEXT,deployment_id TEXT,concept_alias TEXT,visual_family TEXT,visual_version TEXT,image_pipeline_version TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ready_at TEXT,alias_moved_at TEXT,completed_at TEXT,error_stage TEXT,error_message TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,prospect_id INTEGER NOT NULL,build_id TEXT,image_role TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,
    prompt TEXT NOT NULL,policy_id TEXT,policy_version TEXT,policy_hash TEXT,asset_path TEXT,deployment_id TEXT,generation_status TEXT NOT NULL,qa_status TEXT,
    qa_score INTEGER,qa_json TEXT,attempt_number INTEGER NOT NULL DEFAULT 1,representation_class TEXT NOT NULL DEFAULT 'representative_service',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,deployed_at TEXT
  )`).run();
}

async function setBuildStatus(env,buildId,status,extra={}){
  const fields=['status=?'],values=[status];
  for(const [key,value] of Object.entries(extra)){if(!['deployment_id','ready_at','alias_moved_at','error_stage','error_message'].includes(key))continue;fields.push(`${key}=?`);values.push(value)}
  values.push(buildId);await env.DB.prepare(`UPDATE concept_builds SET ${fields.join(',')} WHERE build_id=?`).bind(...values).run();
}

async function ensureResearch(request,env,id){
  let p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if(!p||p.research_status==='Complete')return p;
  if(!env.OPENAI_API_KEY)return p;
  const headers=new Headers({'content-type':'application/json','origin':new URL(request.url).origin}),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
  const url=new URL(`/api/admin/prospects/${id}/research`,request.url);
  const r=await legacyWorker.fetch(new Request(url,{method:'POST',headers,body:'{}'}),env);
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.error||`Business research failed (${r.status}).`)}
  return env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
}

async function vercelFetch(env,path,o={}){
  const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{...o,headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json',...(o.headers||{})}});
  const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{d={raw:text}}
  if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel request failed (${r.status})`);return d;
}
async function vercelUploadFile(env,file,bytes,contentType='application/octet-stream'){
  const body=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),sha=await sha1Hex(body);
  const r=await fetch(`https://api.vercel.com/v2/files${vq(env)}`,{method:'POST',headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':contentType,'x-vercel-digest':sha},body});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.error?.message||d?.message||`Vercel file upload failed for ${file} (${r.status})`)}
  return{file,sha,size:body.byteLength};
}
async function waitReady(env,id){for(let i=0;i<45;i++){const d=await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`),s=d.readyState||d.status;if(s==='READY')return d;if(['ERROR','CANCELED'].includes(s))throw new Error(`Vercel deployment ended in ${s}`);await sleep(1000)}throw new Error('Vercel deployment did not become ready within 45 seconds.')}
async function ensureDns(env,slug){const r=await fetch(env.CAJUNSITES_DNS_API_URL||DNS_API,{method:'POST',headers:{Authorization:`Bearer ${env.DNS_INTEGRATION_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({name:slug,content:'cname.vercel-dns.com',proxied:false,ttl:1})}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||d?.message||`DNS request failed (${r.status})`);return d}
async function ensureDomain(env,alias){try{return await vercelFetch(env,`/v10/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains`,{method:'POST',body:JSON.stringify({name:alias})})}catch(e){if(/already exists|already added|already in use|domain.*exists/i.test(String(e?.message||e)))return{name:alias,existing:true};throw e}}
async function assignAlias(env,id,alias){let last;for(let i=0;i<15;i++){try{return await vercelFetch(env,`/v2/deployments/${encodeURIComponent(id)}/aliases`,{method:'POST',body:JSON.stringify({alias})})}catch(e){last=e;if(!/ssl|certificate|domain|verification|not configured|already in use/i.test(String(e?.message||e))||i===14)throw e;await sleep(2000)}}throw last||new Error('Could not assign the concept domain alias.')}
async function deleteAlias(env,alias){try{await vercelFetch(env,`/v2/aliases/${encodeURIComponent(alias)}`,{method:'DELETE'})}catch(e){console.warn('Concept alias cleanup failed',String(e?.message||e))}}
async function deleteDeployment(env,id){if(!id)return;try{await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(e){console.warn('Concept deployment cleanup failed',String(e?.message||e))}}

function deploymentTreeContains(tree,name){return JSON.stringify(tree||{}).includes(`\"${name}\"`)}
async function verifyDeploymentFiles(env,deploymentId){
  const tree=await vercelFetch(env,`/v6/deployments/${encodeURIComponent(deploymentId)}/files`);
  const missing=['index.html','concept-manifest.json','hero.webp','secondary.webp'].filter(name=>!deploymentTreeContains(tree,name));
  if(missing.length)throw new Error(`Vercel deployment file manifest is missing: ${missing.join(', ')}.`);
}
async function fetchRetry(url,validate,label){let last='';for(let i=0;i<12;i++){try{const r=await fetch(`${url}${url.includes('?')?'&':'?'}_csverify=${Date.now()}-${i}`,{cache:'no-store',redirect:'follow'});const result=await validate(r);if(result===true)return;r.body?.cancel?.();last=typeof result==='string'?result:`HTTP ${r.status}`}catch(e){last=String(e?.message||e)}if(i<11)await sleep(1500)}throw new Error(`Concept verification failed for ${label} after propagation retries: ${last||'unknown response'}`)}
async function verifyDeployment(env,deploymentId,baseUrl,html,buildId){
  if(!baseUrl)throw new Error('Vercel deployment URL was not available for verification.');
  if(!html.includes('/assets/hero.webp')||!html.includes('/assets/secondary.webp'))throw new Error('Concept packaging failed: generated HTML does not reference both local AI image assets.');
  await verifyDeploymentFiles(env,deploymentId);
  await fetchRetry(`${baseUrl}/index.html`,async r=>{if(!r.ok)return `index.html returned ${r.status}`;const t=await r.text();return /<html|<!doctype/i.test(t)&&t.includes('/assets/hero.webp')&&t.includes('/assets/secondary.webp')?true:'index.html content did not match the packaged concept'},'index.html');
  await fetchRetry(`${baseUrl}/concept-manifest.json`,async r=>{if(!r.ok)return `manifest returned ${r.status}`;const t=await r.text();try{const m=JSON.parse(t);return m?.build_id===buildId?true:`manifest build_id mismatch (${m?.build_id||'missing'})`}catch{return `manifest returned non-JSON content (${String(r.headers.get('content-type')||'unknown type')})`}},'concept-manifest.json');
  for(const role of ['hero','secondary'])await fetchRetry(`${baseUrl}/assets/${role}.webp`,async r=>{if(!r.ok)return `${role} returned ${r.status}`;const bytes=new Uint8Array(await r.arrayBuffer());return isWebp(bytes)?true:`${role} returned non-WebP bytes (${String(r.headers.get('content-type')||'unknown type')})`},`${role}.webp`);
  await fetchRetry(`${baseUrl}/`,async r=>{if(!r.ok)return `root returned ${r.status}`;const t=await r.text();return /<html|<!doctype/i.test(t)?true:'root did not return HTML'},'deployment root');
}

async function buildConcept(request,env,id){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  if(!env.VERCEL_API_TOKEN||!env.DNS_INTEGRATION_API_KEY)return json({ok:false,error:'Concept builder setup is incomplete. VERCEL_API_TOKEN and DNS_INTEGRATION_API_KEY must be configured.'},503);
  await ensureSchema(env);
  let p=await ensureResearch(request,env,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);
  if(p.customer_id)return json({ok:false,error:'Converted prospects cannot rebuild prospect concepts. Update the customer website instead.'},409);
  const research=readResearch(p);if(research?.identity_confidence==='low'){const message='Business research identity confidence is low. Review or rerun research before building the concept.';await env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message,id).run();return json({ok:false,error:message,requires_review:true},409)}
  const classification=classifyVisualFamily(p),system=getVisualSystem(p,classification),slug=slugify(p.concept_slug||p.business_name);if(!slug)return json({ok:false,error:'Could not create a valid concept subdomain from the business name.'},400);
  const alias=`${slug}.cajunsites.com`,conceptUrl=`https://${alias}`,oldDeploymentId=clean(p.concept_deployment_id,255)||null,buildId=makeBuildId(id);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO concept_builds (build_id,prospect_id,status,previous_deployment_id,concept_alias,visual_family,visual_version,image_pipeline_version,started_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(buildId,id,'Preparing',oldDeploymentId,alias,classification.family,system.version,IMAGE_PIPELINE_VERSION),
    env.DB.prepare(`UPDATE prospects SET concept_state='Building',concept_slug=?,concept_build_id=?,concept_build_error=NULL,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slug,buildId,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id)
  ]);
  await recordActivity(env,user,p,`${user.name} started concept build for ${p.business_name}`,{build_id:buildId,slug,deployer:'static_v2'});
  let deploymentId=null,aliasMoved=false,errorStage='Generating Images';
  try{
    await setBuildStatus(env,buildId,'Generating Images');
    const aiImages=await generateApprovedConceptImages(env,p,buildId);
    errorStage='Packaging';await setBuildStatus(env,buildId,'Packaging');
    const html=applyAIImages(buildConceptDocument(p,classification),system,aiImages);
    const manifest=JSON.stringify({schema_version:'2.0',build_id:buildId,prospect_id:id,visual_family:classification.family,visual_version:system.version,image_pipeline_version:IMAGE_PIPELINE_VERSION,routing:'native_static_no_rewrites',images:{hero:{path:'/assets/hero.webp',representation_class:'representative_service'},secondary:{path:'/assets/secondary.webp',representation_class:'representative_service'}}},null,2);
    const fileRefs=await Promise.all([
      vercelUploadFile(env,'index.html',utf8Bytes(html),'text/html; charset=utf-8'),
      vercelUploadFile(env,'assets/hero.webp',bytesFromB64(aiImages.hero.generated.b64),'image/webp'),
      vercelUploadFile(env,'assets/secondary.webp',bytesFromB64(aiImages.secondary.generated.b64),'image/webp'),
      vercelUploadFile(env,'concept-manifest.json',utf8Bytes(manifest),'application/json; charset=utf-8')
    ]);
    errorStage='Deploying';await setBuildStatus(env,buildId,'Deploying');
    const dep=await vercelFetch(env,'/v13/deployments',{method:'POST',body:JSON.stringify({name:VERCEL_PROJECT,project:VERCEL_PROJECT,target:'production',files:fileRefs,projectSettings:{framework:null},meta:{cajunsites_prospect_id:String(id),cajunsites_build_id:buildId,cajunsites_slug:slug,cajunsites_deployer:'static_v2',cajunsites_image_policy:aiImages.policy_id}})});
    deploymentId=dep.id||dep.uid;if(!deploymentId)throw new Error('Vercel did not return a deployment ID.');
    await setBuildStatus(env,buildId,'Deploying',{deployment_id:deploymentId});
    const ready=await waitReady(env,deploymentId);const baseUrl=deploymentBaseUrl(ready)||deploymentBaseUrl(dep);
    errorStage='Verifying';await setBuildStatus(env,buildId,'Verifying',{deployment_id:deploymentId,ready_at:new Date().toISOString()});
    await verifyDeployment(env,deploymentId,baseUrl,html,buildId);
    errorStage='Activating';await ensureDns(env,slug);await ensureDomain(env,alias);await setBuildStatus(env,buildId,'Activating',{deployment_id:deploymentId});
    await assignAlias(env,deploymentId,alias);aliasMoved=true;await setBuildStatus(env,buildId,'Activating',{alias_moved_at:new Date().toISOString()});
    errorStage='Committing';
    await env.DB.batch([
      env.DB.prepare(`UPDATE prospects SET concept_url=?,concept_state='Built',concept_slug=?,concept_build_id=?,concept_deployment_id=?,concept_build_error=NULL,concept_built_at=CURRENT_TIMESTAMP,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,stage=CASE WHEN stage='Qualified' THEN 'Concept Built' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(conceptUrl,slug,buildId,deploymentId,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id),
      env.DB.prepare(`UPDATE concept_images SET deployment_id=?,deployed_at=CURRENT_TIMESTAMP WHERE build_id=? AND qa_status='approved' AND asset_path IS NOT NULL`).bind(deploymentId,buildId),
      env.DB.prepare(`UPDATE concept_builds SET status='Complete',deployment_id=?,completed_at=CURRENT_TIMESTAMP,error_stage=NULL,error_message=NULL WHERE build_id=?`).bind(deploymentId,buildId)
    ]);
    await recordActivity(env,user,p,`${user.name} built concept site for ${p.business_name}`,{build_id:buildId,concept_url:conceptUrl,deployment_id:deploymentId,deployer:'static_v2',hero_qa:aiImages.hero.qa?.overall_score||null,secondary_qa:aiImages.secondary.qa?.overall_score||null});
    if(oldDeploymentId&&oldDeploymentId!==deploymentId)await deleteDeployment(env,oldDeploymentId);
    return json({ok:true,concept_url:conceptUrl,build_id:buildId,deployment_id:deploymentId,visual_family:classification.family,visual_label:classification.label,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback,identity_confidence:research?.identity_confidence||'unknown',image_pipeline:{provider:aiImages.provider,model:aiImages.model,policy_id:aiImages.policy_id,policy_version:aiImages.policy_version,hero_qa:aiImages.hero.qa?.overall_score,secondary_qa:aiImages.secondary.qa?.overall_score,assets:['/assets/hero.webp','/assets/secondary.webp']},deployment_pipeline:'static_v2'});
  }catch(e){
    const m=clean(e?.message||e,1000);let rolledBack=false;
    if(aliasMoved){try{if(oldDeploymentId){await assignAlias(env,oldDeploymentId,alias);rolledBack=true}else{await deleteAlias(env,alias);rolledBack=true}}catch(re){console.error('Concept alias rollback failed',re)}}
    if(deploymentId&&deploymentId!==oldDeploymentId)await deleteDeployment(env,deploymentId);
    try{await env.DB.batch([
      env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(m,id),
      env.DB.prepare(`UPDATE concept_builds SET status=?,deployment_id=?,completed_at=CURRENT_TIMESTAMP,error_stage=?,error_message=? WHERE build_id=?`).bind(rolledBack?'Rolled Back':'Failed',deploymentId,errorStage,m,buildId)
    ])}catch(dbError){console.error('Concept failure metadata update failed',dbError)}
    await recordActivity(env,user,p,`Concept build failed for ${p.business_name}`,{build_id:buildId,error:m,error_stage:errorStage,rolled_back:rolledBack,deployer:'static_v2'});
    return json({ok:false,error:m,build_id:buildId,error_stage:errorStage,rolled_back:rolledBack,deployment_pipeline:'static_v2'},502);
  }
}

export default{async fetch(request,env,context){const url=new URL(request.url),m=url.pathname.match(BUILD_RE);if(m&&request.method==='POST')return buildConcept(request,env,Number(m[1]));return legacyWorker.fetch(request,env,context)}};
