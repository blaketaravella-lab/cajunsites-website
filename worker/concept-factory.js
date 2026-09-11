import prospectWorker from './prospects.js';
import { classifyVisualFamily, getVisualSystem, buildConceptDocument } from './visual-family-engine.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_CONCEPT_PROJECT='cajun-sites-prospect-websites';
const RESEARCH_MODEL='gpt-5.6-luna';

function slugify(v){return clean(v,200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,63)}
function safeUrl(v){try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():''}catch{return''}}
function sameOriginMutation(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}

async function ensureConceptSchema(env){
  if(!env.DB)return;
  const alters=[
    "ALTER TABLE prospects ADD COLUMN concept_state TEXT NOT NULL DEFAULT 'Not Built'",
    'ALTER TABLE prospects ADD COLUMN concept_slug TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_deployment_id TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_build_error TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_built_at TEXT',
    "ALTER TABLE prospects ADD COLUMN research_status TEXT NOT NULL DEFAULT 'Not Run'",
    'ALTER TABLE prospects ADD COLUMN business_vertical TEXT',
    'ALTER TABLE prospects ADD COLUMN research_json TEXT',
    'ALTER TABLE prospects ADD COLUMN research_error TEXT',
    'ALTER TABLE prospects ADD COLUMN researched_at TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_family TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_version TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_variant TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_classifier_score REAL',
    'ALTER TABLE prospects ADD COLUMN visual_classifier_signal TEXT',
    'ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0'
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
  await env.DB.prepare(`UPDATE prospects SET concept_state=CASE WHEN COALESCE(concept_url,'')<>'' THEN 'Built' ELSE 'Not Built' END WHERE concept_state IS NULL OR concept_state='' OR (concept_state='Not Built' AND COALESCE(concept_url,'')<>'')`).run();
  await env.DB.prepare(`UPDATE prospects SET stage='Qualified' WHERE stage='Concept Built' AND COALESCE(concept_url,'')='' AND COALESCE(concept_state,'Not Built')='Not Built'`).run();
}

async function currentUser(request,env){
  const url=new URL(request.url),headers=new Headers(),cookie=request.headers.get('cookie');
  if(cookie)headers.set('cookie',cookie);
  const r=await prospectWorker.fetch(new Request(new URL('/api/admin/me',url.origin),{method:'GET',headers}),env);
  if(!r.ok)return null;
  return (await r.json().catch(()=>null))?.user||null;
}

async function recordActivity(env,user,p,description,metadata={},eventType='concept_build'){
  try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,?,?,?,CURRENT_TIMESTAMP)`).bind(eventType,description,JSON.stringify({prospect_id:p.id,business_name:p.business_name,...metadata,actor:user?{id:user.id,name:user.name,email:user.email,role:user.role}:null})).run()}catch{}
}

function responseText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const a=[];for(const i of d?.output||[])for(const c of i?.content||[])if(c?.type==='output_text'&&c?.text)a.push(c.text);return a.join('\n').trim()}
function parseJsonText(t){const r=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const f=r.indexOf('{'),l=r.lastIndexOf('}');if(f<0||l<f)throw new Error('Research response did not contain JSON.');return JSON.parse(r.slice(f,l+1))}
function normalizeResearch(r){
  const facts=Array.isArray(r?.facts)?r.facts.map(f=>({label:clean(f?.label,80),value:clean(f?.value,300),source_url:safeUrl(f?.source_url),confidence:clean(f?.confidence,20).toLowerCase()})).filter(f=>f.label&&f.value&&f.source_url&&['high','medium'].includes(f.confidence)).slice(0,20):[];
  const services=Array.isArray(r?.services)?r.services.map(s=>({name:clean(s?.name,100),source_url:safeUrl(s?.source_url),confidence:clean(s?.confidence,20).toLowerCase()})).filter(s=>s.name&&s.source_url&&s.confidence==='high').slice(0,10):[];
  const sources=Array.isArray(r?.sources)?r.sources.map(s=>({title:clean(s?.title,160),url:safeUrl(s?.url)})).filter(s=>s.url).slice(0,15):[];
  return{vertical:clean(r?.vertical,100)||'Local Business',summary:clean(r?.summary,700),facts,services,sources,review_themes:Array.isArray(r?.review_themes)?r.review_themes.map(x=>clean(x,120)).filter(Boolean).slice(0,5):[],suggested_sections:Array.isArray(r?.suggested_sections)?r.suggested_sections.map(x=>clean(x,80)).filter(Boolean).slice(0,6):[]};
}

async function runBusinessResearch(env,p){
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured for Business Research.');
  const identity=[p.business_name,p.city,p.state,p.category,p.phone].filter(Boolean).join(' | ');
  const prompt=`Research this specific small business using current public web sources: ${identity}.\nReturn ONLY valid JSON: {"vertical":"specific business vertical","summary":"2-3 sentence factual summary","facts":[{"label":"Phone|Address|Hours|Service Area|Other verified fact","value":"...","source_url":"https://...","confidence":"high|medium"}],"services":[{"name":"explicitly offered service","source_url":"https://...","confidence":"high"}],"review_themes":["non-quoted recurring theme"],"suggested_sections":["vertical-appropriate website section"],"sources":[{"title":"source title","url":"https://..."}]}. Identify the exact business. Prefer official profiles, reputable directories, controlled social profiles and major review platforms. Never invent years in business, licensing, insurance, certifications, awards, 24/7 availability, guarantees, service areas or services. Only list a service when explicitly supported. Do not quote reviews. Omit uncertain facts. Every factual item needs a source URL.`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_RESEARCH_MODEL||RESEARCH_MODEL,tools:[{type:'web_search'}],input:prompt})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||`Business research request failed (${r.status})`);
  return normalizeResearch(parseJsonText(responseText(d)));
}

async function performResearch(env,p,user){
  await env.DB.prepare(`UPDATE prospects SET research_status='Researching',research_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.id).run();
  await recordActivity(env,user,p,`${user.name} started business research for ${p.business_name}`,{},'prospect_research');
  try{
    const r=await runBusinessResearch(env,p);
    await env.DB.prepare(`UPDATE prospects SET research_status='Complete',business_vertical=?,research_json=?,research_error=NULL,researched_at=CURRENT_TIMESTAMP,category=CASE WHEN COALESCE(category,'')='' THEN ? ELSE category END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.vertical,JSON.stringify(r),r.vertical,p.id).run();
    await recordActivity(env,user,p,`${user.name} completed business research for ${p.business_name}`,{vertical:r.vertical,sources:r.sources.length,facts:r.facts.length,services:r.services.length},'prospect_research');
    return r;
  }catch(e){
    const m=clean(e?.message||e,1000);
    await env.DB.prepare(`UPDATE prospects SET research_status='Failed',research_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(m,p.id).run();
    await recordActivity(env,user,p,`Business research failed for ${p.business_name}`,{error:m},'prospect_research');
    throw e;
  }
}

async function researchBusiness(request,env,id){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  await ensureConceptSchema(env);
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);
  try{return json({ok:true,research:await performResearch(env,p,user)})}catch(e){return json({ok:false,error:clean(e?.message||e,1000)},502)}
}

async function vercelFetch(env,path,o={}){
  const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{...o,headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json',...(o.headers||{})}}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel request failed (${r.status})`);return d;
}
async function ensureDns(env,slug){const r=await fetch(env.CAJUNSITES_DNS_API_URL||DNS_API,{method:'POST',headers:{Authorization:`Bearer ${env.DNS_INTEGRATION_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({name:slug,content:'cname.vercel-dns.com',proxied:false,ttl:1})}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||d?.message||`DNS request failed (${r.status})`);return d}
async function ensureDomain(env,alias){try{return await vercelFetch(env,`/v10/projects/${encodeURIComponent(VERCEL_CONCEPT_PROJECT)}/domains`,{method:'POST',body:JSON.stringify({name:alias})})}catch(e){if(/already exists|already added|already in use|domain.*exists/i.test(String(e?.message||e)))return{name:alias,existing:true};throw e}}
async function waitReady(env,id){for(let i=0;i<25;i++){const d=await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`),s=d.readyState||d.status;if(s==='READY')return d;if(['ERROR','CANCELED'].includes(s))throw new Error(`Vercel deployment ended in ${s}`);await new Promise(r=>setTimeout(r,1000))}throw new Error('Vercel deployment did not become ready in time.')}
async function assignAlias(env,id,alias){let last;for(let i=0;i<15;i++){try{return await vercelFetch(env,`/v2/deployments/${encodeURIComponent(id)}/aliases`,{method:'POST',body:JSON.stringify({alias})})}catch(e){last=e;if(!/ssl|certificate|domain|verification|not configured|already in use/i.test(String(e?.message||e))||i===14)throw e;await new Promise(r=>setTimeout(r,2000))}}throw last||new Error('Could not assign the concept domain alias.')}
async function deleteOldDeployment(env,id){if(!id)return;try{await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(e){console.warn('Old concept deployment cleanup failed',String(e?.message||e))}}

async function buildConcept(request,env,id){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  if(!env.VERCEL_API_TOKEN||!env.DNS_INTEGRATION_API_KEY)return json({ok:false,error:'Concept builder setup is incomplete. VERCEL_API_TOKEN and DNS_INTEGRATION_API_KEY must be configured as Worker secrets.'},503);
  await ensureConceptSchema(env);
  let p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);

  if(env.OPENAI_API_KEY&&p.research_status!=='Complete'){
    try{await performResearch(env,p,user)}catch(e){console.warn('Concept build continuing after research failure',String(e?.message||e))}
    p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  }

  const classification=classifyVisualFamily(p),system=getVisualSystem(p,classification),slug=slugify(p.concept_slug||p.business_name);
  if(!slug)return json({ok:false,error:'Could not create a valid concept subdomain from the business name.'},400);
  const alias=`${slug}.cajunsites.com`,conceptUrl=`https://${alias}`,oldDeploymentId=clean(p.concept_deployment_id,255)||null;

  await env.DB.prepare(`UPDATE prospects SET concept_state='Building',concept_slug=?,concept_build_error=NULL,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slug,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id).run();
  await recordActivity(env,user,p,`${user.name} started concept build for ${p.business_name}`,{slug,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,classifier_hits:classification.hits,fallback:classification.fallback});

  try{
    const html=buildConceptDocument(p,classification);
    const dep=await vercelFetch(env,'/v13/deployments',{method:'POST',body:JSON.stringify({name:VERCEL_CONCEPT_PROJECT,project:VERCEL_CONCEPT_PROJECT,target:'production',files:[{file:'index.html',data:html}],projectSettings:{framework:null},meta:{cajunsites_prospect_id:String(id),cajunsites_slug:slug,cajunsites_visual_family:classification.family,cajunsites_visual_version:system.version,cajunsites_visual_variant:system.variant}})}),deploymentId=dep.id||dep.uid;
    if(!deploymentId)throw new Error('Vercel did not return a deployment ID.');
    await waitReady(env,deploymentId);await ensureDns(env,slug);await ensureDomain(env,alias);await assignAlias(env,deploymentId,alias);
    await env.DB.prepare(`UPDATE prospects SET concept_url=?,concept_state='Built',concept_slug=?,concept_deployment_id=?,concept_build_error=NULL,concept_built_at=CURRENT_TIMESTAMP,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,stage=CASE WHEN stage='Qualified' THEN 'Concept Built' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(conceptUrl,slug,deploymentId,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id).run();
    await recordActivity(env,user,p,`${user.name} built concept site for ${p.business_name}`,{slug,concept_url:conceptUrl,deployment_id:deploymentId,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback});
    if(oldDeploymentId&&oldDeploymentId!==deploymentId)await deleteOldDeployment(env,oldDeploymentId);
    return json({ok:true,concept_url:conceptUrl,visual_family:classification.family,visual_label:classification.label,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback});
  }catch(e){
    const m=clean(e?.message||e,1000);await env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(m,id).run();
    await recordActivity(env,user,p,`Concept build failed for ${p.business_name}`,{error:m,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback});
    return json({ok:false,error:m},502);
  }
}

export default{async fetch(request,env){
  const url=new URL(request.url);
  const researchMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/research$/);
  if(researchMatch){if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);return researchBusiness(request,env,Number(researchMatch[1]));}
  const buildMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/build-concept$/);
  if(buildMatch){if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);return buildConcept(request,env,Number(buildMatch[1]));}
  if(url.pathname.startsWith('/api/admin/prospects')){try{await ensureConceptSchema(env)}catch(e){console.error('Concept schema setup failed',e)}}
  return prospectWorker.fetch(request,env);
}};
