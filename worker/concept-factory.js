import prospectWorker from './prospects.js';
import { classifyVisualFamily, getVisualSystem, buildConceptDocument } from './visual-family-engine.js';
import { generateApprovedConceptImages, applyAIImages, bytesFromB64 } from './image-pipeline/ai-image-pipeline.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_CONCEPT_PROJECT='cajun-sites-prospect-websites';
const RESEARCH_MODEL='gpt-5.6-luna';
const IMAGE_PIPELINE_VERSION='ai-image-v1';

function slugify(v){return clean(v,200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,63)}
function safeUrl(v){try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():''}catch{return''}}
function sameOriginMutation(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
function makeBuildId(id){return `${new Date().toISOString().replace(/[-:.]/g,'').replace('Z','Z')}-${id}-${crypto.randomUUID().slice(0,8)}`}
function deploymentBaseUrl(dep){const raw=clean(dep?.url||dep?.alias?.[0]||'',500).replace(/^https?:\/\//,'').replace(/\/$/,'');return raw?`https://${raw}`:''}
async function sha1Hex(bytes){const digest=await crypto.subtle.digest('SHA-1',bytes);return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function utf8Bytes(v){return new TextEncoder().encode(String(v??''))}

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
    'ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE prospects ADD COLUMN concept_build_id TEXT'
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
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
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_concept_builds_prospect ON concept_builds(prospect_id,started_at DESC)').run();
  await env.DB.prepare(`UPDATE prospects SET concept_state=CASE WHEN COALESCE(concept_url,'')<>'' THEN 'Built' ELSE 'Not Built' END WHERE concept_state IS NULL OR concept_state='' OR (concept_state='Not Built' AND COALESCE(concept_url,'')<>'')`).run();
  await env.DB.prepare(`UPDATE prospects SET stage='Qualified' WHERE stage='Concept Built' AND COALESCE(concept_url,'')='' AND COALESCE(concept_state,'Not Built')='Not Built'`).run();
}

async function currentUser(request,env){const url=new URL(request.url),headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const r=await prospectWorker.fetch(new Request(new URL('/api/admin/me',url.origin),{method:'GET',headers}),env);if(!r.ok)return null;return (await r.json().catch(()=>null))?.user||null}
async function recordActivity(env,user,p,description,metadata={},eventType='concept_build'){try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,?,?,?,CURRENT_TIMESTAMP)`).bind(eventType,description,JSON.stringify({prospect_id:p.id,business_name:p.business_name,...metadata,actor:user?{id:user.id,name:user.name,email:user.email,role:user.role}:null})).run()}catch{}}
function responseText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const a=[];for(const i of d?.output||[])for(const c of i?.content||[])if(c?.type==='output_text'&&c?.text)a.push(c.text);return a.join('\n').trim()}
function parseJsonText(t){const r=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const f=r.indexOf('{'),l=r.lastIndexOf('}');if(f<0||l<f)throw new Error('Research response did not contain JSON.');return JSON.parse(r.slice(f,l+1))}
function normalizeGoogleReviews(value){if(!value||typeof value!=='object')return null;const rating=Number(value.rating),count=Math.max(0,Math.floor(Number(value.count)||0)),sourceUrl=safeUrl(value.source_url),themes=Array.isArray(value.themes)?value.themes.map(x=>clean(x,120)).filter(Boolean).slice(0,5):[];if(!sourceUrl||!Number.isFinite(rating)||rating<1||rating>5||count<1)return null;return{rating:Number(rating.toFixed(1)),count,source_url:sourceUrl,themes}}
function normalizeDesignProfile(v){if(!v||typeof v!=='object')return null;const allowed=['urgent_service','local_service','appointment','destination','showcase','trust_professional','family'];const archetype=allowed.includes(clean(v.archetype,40))?clean(v.archetype,40):'local_service';const mood=clean(v.mood,40)||'confident';const imageTheme=clean(v.image_theme,80)||'local business';const headline=clean(v.headline,180);const cta=clean(v.cta,60);const sections=Array.isArray(v.sections)?v.sections.map(x=>clean(x,80)).filter(Boolean).slice(0,6):[];const process=Array.isArray(v.process)?v.process.map(x=>clean(x,80)).filter(Boolean).slice(0,4):[];return{archetype,mood,image_theme:imageTheme,headline,cta,sections,process}}
function normalizeResearch(r){const facts=Array.isArray(r?.facts)?r.facts.map(f=>({label:clean(f?.label,80),value:clean(f?.value,300),source_url:safeUrl(f?.source_url),confidence:clean(f?.confidence,20).toLowerCase()})).filter(f=>f.label&&f.value&&f.source_url&&['high','medium'].includes(f.confidence)).slice(0,25):[];const services=Array.isArray(r?.services)?r.services.map(s=>({name:clean(s?.name,100),source_url:safeUrl(s?.source_url),confidence:clean(s?.confidence,20).toLowerCase()})).filter(s=>s.name&&s.source_url&&s.confidence==='high').slice(0,12):[];const sources=Array.isArray(r?.sources)?r.sources.map(s=>({title:clean(s?.title,160),url:safeUrl(s?.url)})).filter(s=>s.url).slice(0,18):[];const confidence=['high','medium','low'].includes(clean(r?.identity_confidence,20).toLowerCase())?clean(r.identity_confidence,20).toLowerCase():'unknown';const googleReviews=normalizeGoogleReviews(r?.google_reviews);const reviewThemes=Array.isArray(r?.review_themes)?r.review_themes.map(x=>clean(x,120)).filter(Boolean).slice(0,5):[];return{vertical:clean(r?.vertical,100)||'Local Business',summary:clean(r?.summary,700),identity_confidence:confidence,facts,services,sources,google_reviews:googleReviews,review_themes:googleReviews?.themes?.length?googleReviews.themes:reviewThemes,suggested_sections:Array.isArray(r?.suggested_sections)?r.suggested_sections.map(x=>clean(x,80)).filter(Boolean).slice(0,6):[],design_profile:normalizeDesignProfile(r?.design_profile)}}
function researchFact(r,...labels){const wanted=labels.map(x=>x.toLowerCase());return r.facts.find(f=>wanted.includes(String(f.label||'').toLowerCase())&&f.confidence==='high')||r.facts.find(f=>wanted.includes(String(f.label||'').toLowerCase()))||null}
async function enrichProspect(env,p,r){const phone=researchFact(r,'Phone','Business Phone'),email=researchFact(r,'Email','Business Email'),city=researchFact(r,'City'),state=researchFact(r,'State');const updates={category:!clean(p.category)?r.vertical:null,phone:!clean(p.phone)&&phone?phone.value:null,email:!clean(p.email)&&email?email.value:null,city:!clean(p.city)&&city?city.value:null,state:!clean(p.state)&&state?state.value:null};await env.DB.prepare(`UPDATE prospects SET category=CASE WHEN COALESCE(category,'')='' THEN ? ELSE category END,phone=CASE WHEN COALESCE(phone,'')='' THEN ? ELSE phone END,email=CASE WHEN COALESCE(email,'')='' THEN ? ELSE email END,city=CASE WHEN COALESCE(city,'')='' THEN ? ELSE city END,state=CASE WHEN COALESCE(state,'')='' THEN ? ELSE state END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(updates.category,updates.phone,updates.email,updates.city,updates.state,p.id).run();return Object.fromEntries(Object.entries(updates).filter(([,v])=>v))}

async function runBusinessResearch(env,p){
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured for Business Research.');
  const identity=[p.business_name,p.city,p.state,p.category,p.phone].filter(Boolean).join(' | ');
  const prompt=`Research this exact small business using current public web sources: ${identity}. Return ONLY valid JSON with: {"identity_confidence":"high|medium|low","vertical":"specific business vertical","summary":"2-3 sentence factual summary","facts":[{"label":"Phone|Email|Address|City|State|Hours|Service Area|Other verified fact","value":"...","source_url":"https://...","confidence":"high|medium"}],"services":[{"name":"explicitly offered service","source_url":"https://...","confidence":"high"}],"google_reviews":{"rating":4.8,"count":123,"source_url":"https://www.google.com/maps/...","themes":["non-quoted recurring theme"]},"review_themes":["non-quoted recurring theme"],"suggested_sections":["business-specific website section"],"design_profile":{"archetype":"urgent_service|local_service|appointment|destination|showcase|trust_professional|family","mood":"short design mood","image_theme":"specific visual subject appropriate to this exact business","headline":"compelling but factual owner-ready headline","cta":"best primary action","sections":["3-6 business-specific sections"],"process":["2-4 customer journey steps"]},"sources":[{"title":"source title","url":"https://..."}]}. Match the exact business using name plus location and phone/address when available. The design_profile is a creative direction for this exact business, not a vertical template. Choose it from verified services, customer intent, public brand cues and review themes. Do not invent claims in the headline or design profile. Prefer official profiles, Google Business Profile/Maps, controlled social profiles, reputable directories and major review platforms. Only populate Google aggregate when an exact current listing supports both rating and count. Never quote reviews or include reviewer names. Never invent years, licensing, insurance, certifications, awards, 24/7 availability, guarantees, service areas or services. Omit uncertain facts. Every factual item needs a source URL.`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_RESEARCH_MODEL||RESEARCH_MODEL,tools:[{type:'web_search'}],input:prompt})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||`Business research request failed (${r.status})`);return normalizeResearch(parseJsonText(responseText(d)));
}

async function performResearch(env,p,user){await env.DB.prepare(`UPDATE prospects SET research_status='Researching',research_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.id).run();await recordActivity(env,user,p,`${user.name} started business research for ${p.business_name}`,{},'prospect_research');try{const r=await runBusinessResearch(env,p);const enriched=await enrichProspect(env,p,r);await env.DB.prepare(`UPDATE prospects SET research_status='Complete',business_vertical=?,research_json=?,research_error=NULL,researched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.vertical,JSON.stringify(r),p.id).run();await recordActivity(env,user,p,`${user.name} completed business research for ${p.business_name}`,{vertical:r.vertical,identity_confidence:r.identity_confidence,sources:r.sources.length,facts:r.facts.length,services:r.services.length,google_rating:r.google_reviews?.rating||null,google_review_count:r.google_reviews?.count||null,design_archetype:r.design_profile?.archetype||null,enriched_fields:Object.keys(enriched)},'prospect_research');return r}catch(e){const m=clean(e?.message||e,1000);await env.DB.prepare(`UPDATE prospects SET research_status='Failed',research_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(m,p.id).run();await recordActivity(env,user,p,`Business research failed for ${p.business_name}`,{error:m},'prospect_research');throw e}}
async function researchBusiness(request,env,id){if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);await ensureConceptSchema(env);const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);try{return json({ok:true,research:await performResearch(env,p,user)})}catch(e){return json({ok:false,error:clean(e?.message||e,1000)},502)}}

async function vercelFetch(env,path,o={}){const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{...o,headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json',...(o.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel request failed (${r.status})`);return d}
async function vercelUploadFile(env,file,bytes,contentType='application/octet-stream'){
  const body=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),sha=await sha1Hex(body);
  const r=await fetch(`https://api.vercel.com/v2/files${vq(env)}`,{method:'POST',headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':contentType,'x-vercel-digest':sha},body});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.error?.message||d?.message||`Vercel file upload failed for ${file} (${r.status})`)}
  return{file,sha,size:body.byteLength};
}
async function ensureDns(env,slug){const r=await fetch(env.CAJUNSITES_DNS_API_URL||DNS_API,{method:'POST',headers:{Authorization:`Bearer ${env.DNS_INTEGRATION_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({name:slug,content:'cname.vercel-dns.com',proxied:false,ttl:1})}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||d?.message||`DNS request failed (${r.status})`);return d}
async function ensureDomain(env,alias){try{return await vercelFetch(env,`/v10/projects/${encodeURIComponent(VERCEL_CONCEPT_PROJECT)}/domains`,{method:'POST',body:JSON.stringify({name:alias})})}catch(e){if(/already exists|already added|already in use|domain.*exists/i.test(String(e?.message||e)))return{name:alias,existing:true};throw e}}
async function waitReady(env,id){for(let i=0;i<25;i++){const d=await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`),s=d.readyState||d.status;if(s==='READY')return d;if(['ERROR','CANCELED'].includes(s))throw new Error(`Vercel deployment ended in ${s}`);await new Promise(r=>setTimeout(r,1000))}throw new Error('Vercel deployment did not become ready in time.')}
async function assignAlias(env,id,alias){let last;for(let i=0;i<15;i++){try{return await vercelFetch(env,`/v2/deployments/${encodeURIComponent(id)}/aliases`,{method:'POST',body:JSON.stringify({alias})})}catch(e){last=e;if(!/ssl|certificate|domain|verification|not configured|already in use/i.test(String(e?.message||e))||i===14)throw e;await new Promise(r=>setTimeout(r,2000))}}throw last||new Error('Could not assign the concept domain alias.')}
async function deleteAlias(env,alias){try{await vercelFetch(env,`/v2/aliases/${encodeURIComponent(alias)}`,{method:'DELETE'})}catch(e){console.warn('Concept alias cleanup failed',String(e?.message||e))}}
async function deleteOldDeployment(env,id){if(!id)return;try{await vercelFetch(env,`/v13/deployments/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(e){console.warn('Old concept deployment cleanup failed',String(e?.message||e))}}
function readResearch(p){try{return p.research_json?JSON.parse(p.research_json):null}catch{return null}}

function isWebp(bytes){return bytes.length>=12&&bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46&&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50}
async function verifyImageAsset(role,response){
  if(!response.ok)throw new Error(`Concept verification failed: ${role} image returned ${response.status}.`);
  const contentType=String(response.headers.get('content-type')||'').toLowerCase();
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!isWebp(bytes))throw new Error(`Concept verification failed: ${role} asset did not return valid WebP image bytes${contentType?` (content-type ${contentType})`:''}.`);
}
async function verifyDeployment(baseUrl,html){
  if(!baseUrl)throw new Error('Vercel deployment URL was not available for verification.');
  if(!html.includes('/assets/hero.webp')||!html.includes('/assets/secondary.webp'))throw new Error('Concept packaging failed: generated HTML does not reference both local AI image assets.');
  const [page,hero,secondary]=await Promise.all([fetch(`${baseUrl}/`),fetch(`${baseUrl}/assets/hero.webp`),fetch(`${baseUrl}/assets/secondary.webp`)]);
  if(!page.ok)throw new Error(`Concept verification failed: index returned ${page.status}.`);
  const deployedHtml=await page.text();
  if(/images\.unsplash\.com|images\.pexels\.com|\/api\/images\//i.test(deployedHtml))throw new Error('Concept verification failed: an external legacy concept image URL remains in the deployed HTML.');
  await Promise.all([verifyImageAsset('hero',hero),verifyImageAsset('secondary',secondary)]);
}

async function setBuildStatus(env,buildId,status,fields={}){
  if(!env.DB)return;
  const allowed=['deployment_id','ready_at','alias_moved_at','completed_at','error_stage','error_message'],sets=['status=?'],values=[status];
  for(const key of allowed){if(Object.prototype.hasOwnProperty.call(fields,key)){sets.push(`${key}=?`);values.push(fields[key])}}
  values.push(buildId);await env.DB.prepare(`UPDATE concept_builds SET ${sets.join(',')} WHERE build_id=?`).bind(...values).run();
}

async function buildConcept(request,env,id){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  if(!env.VERCEL_API_TOKEN||!env.DNS_INTEGRATION_API_KEY)return json({ok:false,error:'Concept builder setup is incomplete. VERCEL_API_TOKEN and DNS_INTEGRATION_API_KEY must be configured as Worker secrets.'},503);
  await ensureConceptSchema(env);
  let p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);
  if(p.customer_id)return json({ok:false,error:'Converted prospects cannot rebuild prospect concepts. Update the customer website instead.'},409);
  if(env.OPENAI_API_KEY&&p.research_status!=='Complete'){try{await performResearch(env,p,user)}catch(e){console.warn('Concept build continuing after research failure',String(e?.message||e))}p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first()}
  const research=readResearch(p);if(research?.identity_confidence==='low'){const message='Business research identity confidence is low. Review or rerun research before building the concept.';await env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message,id).run();await recordActivity(env,user,p,`Concept build blocked for ${p.business_name}`,{reason:'low_identity_confidence'},'concept_build');return json({ok:false,error:message,requires_review:true},409)}
  const classification=classifyVisualFamily(p),system=getVisualSystem(p,classification),slug=slugify(p.concept_slug||p.business_name);if(!slug)return json({ok:false,error:'Could not create a valid concept subdomain from the business name.'},400);
  const alias=`${slug}.cajunsites.com`,conceptUrl=`https://${alias}`,oldDeploymentId=clean(p.concept_deployment_id,255)||null,buildId=makeBuildId(id);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO concept_builds (build_id,prospect_id,status,previous_deployment_id,concept_alias,visual_family,visual_version,image_pipeline_version,started_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(buildId,id,'Preparing',oldDeploymentId,alias,classification.family,system.version,IMAGE_PIPELINE_VERSION),
    env.DB.prepare(`UPDATE prospects SET concept_state='Building',concept_slug=?,concept_build_id=?,concept_build_error=NULL,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slug,buildId,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id)
  ]);
  await recordActivity(env,user,p,`${user.name} started concept build for ${p.business_name}`,{build_id:buildId,slug,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,classifier_hits:classification.hits,fallback:classification.fallback,identity_confidence:research?.identity_confidence||'unknown',google_rating:research?.google_reviews?.rating||null,google_review_count:research?.google_reviews?.count||null,image_pipeline:'vercel_local_ai_fail_closed'});

  let deploymentId=null,aliasMoved=false,errorStage='Generating Images';
  try{
    await setBuildStatus(env,buildId,'Generating Images');
    const aiImages=await generateApprovedConceptImages(env,p,buildId);
    await setBuildStatus(env,buildId,'Packaging');errorStage='Packaging';
    const html=applyAIImages(buildConceptDocument(p,classification),system,aiImages);
    const manifest=JSON.stringify({schema_version:'1.0',build_id:buildId,prospect_id:id,visual_family:classification.family,visual_version:system.version,image_pipeline_version:IMAGE_PIPELINE_VERSION,images:{hero:{path:'/assets/hero.webp',representation_class:'representative_service'},secondary:{path:'/assets/secondary.webp',representation_class:'representative_service'}}},null,2);
    const fileRefs=await Promise.all([
      vercelUploadFile(env,'index.html',utf8Bytes(html),'text/html; charset=utf-8'),
      vercelUploadFile(env,'assets/hero.webp',bytesFromB64(aiImages.hero.generated.b64),'image/webp'),
      vercelUploadFile(env,'assets/secondary.webp',bytesFromB64(aiImages.secondary.generated.b64),'image/webp'),
      vercelUploadFile(env,'concept-manifest.json',utf8Bytes(manifest),'application/json; charset=utf-8')
    ]);
    await setBuildStatus(env,buildId,'Deploying');errorStage='Deploying';
    const dep=await vercelFetch(env,'/v13/deployments',{method:'POST',body:JSON.stringify({name:VERCEL_CONCEPT_PROJECT,project:VERCEL_CONCEPT_PROJECT,target:'production',files:fileRefs,projectSettings:{framework:null},meta:{cajunsites_prospect_id:String(id),cajunsites_build_id:buildId,cajunsites_slug:slug,cajunsites_visual_family:classification.family,cajunsites_visual_version:system.version,cajunsites_visual_variant:system.variant,cajunsites_image_provider:aiImages.provider,cajunsites_image_policy:aiImages.policy_id}})});
    deploymentId=dep.id||dep.uid;if(!deploymentId)throw new Error('Vercel did not return a deployment ID.');
    await setBuildStatus(env,buildId,'Deploying',{deployment_id:deploymentId});
    const ready=await waitReady(env,deploymentId);await setBuildStatus(env,buildId,'Verifying',{deployment_id:deploymentId,ready_at:new Date().toISOString()});errorStage='Verifying';
    const baseUrl=deploymentBaseUrl(ready)||deploymentBaseUrl(dep);await verifyDeployment(baseUrl,html);
    await ensureDns(env,slug);await ensureDomain(env,alias);
    await setBuildStatus(env,buildId,'Activating',{deployment_id:deploymentId});errorStage='Activating';
    await assignAlias(env,deploymentId,alias);aliasMoved=true;await setBuildStatus(env,buildId,'Activating',{alias_moved_at:new Date().toISOString()});
    errorStage='Committing';
    await env.DB.batch([
      env.DB.prepare(`UPDATE prospects SET concept_url=?,concept_state='Built',concept_slug=?,concept_build_id=?,concept_deployment_id=?,concept_build_error=NULL,concept_built_at=CURRENT_TIMESTAMP,visual_family=?,visual_version=?,visual_variant=?,visual_classifier_score=?,visual_classifier_signal=?,visual_fallback=?,stage=CASE WHEN stage='Qualified' THEN 'Concept Built' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(conceptUrl,slug,buildId,deploymentId,classification.family,system.version,system.variant,classification.score,classification.signal,classification.fallback?1:0,id),
      env.DB.prepare(`UPDATE concept_images SET deployment_id=?,deployed_at=CURRENT_TIMESTAMP WHERE build_id=? AND qa_status='approved' AND asset_path IS NOT NULL`).bind(deploymentId,buildId),
      env.DB.prepare(`UPDATE concept_builds SET status='Complete',deployment_id=?,completed_at=CURRENT_TIMESTAMP,error_stage=NULL,error_message=NULL WHERE build_id=?`).bind(deploymentId,buildId)
    ]);
    await recordActivity(env,user,p,`${user.name} built concept site for ${p.business_name}`,{build_id:buildId,slug,concept_url:conceptUrl,deployment_id:deploymentId,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback,identity_confidence:research?.identity_confidence||'unknown',image_provider:aiImages.provider,image_model:aiImages.model,image_policy:aiImages.policy_id,image_policy_version:aiImages.policy_version,hero_qa:aiImages.hero.qa?.overall_score||null,secondary_qa:aiImages.secondary.qa?.overall_score||null});
    if(oldDeploymentId&&oldDeploymentId!==deploymentId)await deleteOldDeployment(env,oldDeploymentId);
    return json({ok:true,concept_url:conceptUrl,build_id:buildId,deployment_id:deploymentId,visual_family:classification.family,visual_label:classification.label,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback,identity_confidence:research?.identity_confidence||'unknown',google_reviews:research?.google_reviews||null,image_pipeline:{provider:aiImages.provider,model:aiImages.model,policy_id:aiImages.policy_id,policy_version:aiImages.policy_version,hero_qa:aiImages.hero.qa?.overall_score,secondary_qa:aiImages.secondary.qa?.overall_score,assets:['/assets/hero.webp','/assets/secondary.webp']}});
  }catch(e){
    const m=clean(e?.message||e,1000);let rolledBack=false;
    if(aliasMoved){try{if(oldDeploymentId){await assignAlias(env,oldDeploymentId,alias);rolledBack=true}else{await deleteAlias(env,alias);rolledBack=true}}catch(rollbackError){console.error('Concept alias rollback failed',rollbackError)}}
    if(deploymentId&&deploymentId!==oldDeploymentId)await deleteOldDeployment(env,deploymentId);
    try{await env.DB.batch([
      env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(m,id),
      env.DB.prepare(`UPDATE concept_builds SET status=?,deployment_id=?,completed_at=CURRENT_TIMESTAMP,error_stage=?,error_message=? WHERE build_id=?`).bind(rolledBack?'Rolled Back':'Failed',deploymentId,errorStage,m,buildId)
    ])}catch(dbError){console.error('Concept failure metadata update failed',dbError)}
    await recordActivity(env,user,p,`Concept build failed for ${p.business_name}`,{build_id:buildId,error:m,error_stage:errorStage,rolled_back:rolledBack,visual_family:classification.family,visual_version:system.version,visual_variant:system.variant,classifier_score:classification.score,fallback:classification.fallback,image_pipeline:'vercel_local_ai_fail_closed'});
    return json({ok:false,error:m,build_id:buildId,error_stage:errorStage,rolled_back:rolledBack},502);
  }
}

export default{async fetch(request,env){const url=new URL(request.url);const researchMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/research$/);if(researchMatch){if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);return researchBusiness(request,env,Number(researchMatch[1]))}const buildMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/build-concept$/);if(buildMatch){if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);return buildConcept(request,env,Number(buildMatch[1]))}if(url.pathname.startsWith('/api/admin/prospects')){try{await ensureConceptSchema(env)}catch(e){console.error('Concept schema setup failed',e)}}return prospectWorker.fetch(request,env)}};