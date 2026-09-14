import prospectCleanupWorker from './prospect-cleanup.js';
import {identityCacheKey,isFresh,SOURCE_TTLS,sourcePlan} from './providers/business-data.js';

const clean=(v,m=4000)=>String(v??'').trim().slice(0,m);
const BUSINESS_FIELDS=['business_name','category','business_vertical','city','state','phone','email','address','business_summary','identity_confidence','google_rating','google_review_count','google_maps_url','verified_services_json','enrichment_sources_json'];
const RESEARCH_MUTATION_RE=/^\/api\/admin\/prospects\/(\d+)\/(research|build-concept)$/;
const PROSPECT_MUTATION_RE=/^\/api\/admin\/prospects\/(\d+)$/;
const VISION_MODEL='gpt-5.6-luna';
const DESIGN_PROFILE_KEYS=['archetype','mood','image_theme','headline','cta','sections','process'];

async function ensureSchema(env){
  if(!env.DB)return;
  await env.DB.prepare('SELECT address,business_summary,identity_confidence,google_rating,google_review_count,google_maps_url,verified_services_json,enrichment_sources_json,enrichment_provenance_json,enriched_at,research_status,visual_inspiration_json,visual_inspiration_at,design_directives_json,design_directives_updated_at FROM prospects LIMIT 0').all();
}

function parseJson(v,fallback={}){try{return v?JSON.parse(v):fallback}catch{return fallback}}
function isPresent(v){return v!==null&&v!==undefined&&String(v).trim()!==''}
function fact(research,label){return (research?.facts||[]).find(f=>clean(f?.label,80).toLowerCase()===label.toLowerCase())||null}
function researchCandidates(research){
  const phone=fact(research,'Phone'),email=fact(research,'Email'),address=fact(research,'Address'),g=research?.google_reviews||null;
  return {
    category:{value:clean(research?.vertical,160)||null,confidence:research?.identity_confidence||null,source_url:null},
    business_vertical:{value:clean(research?.vertical,160)||null,confidence:research?.identity_confidence||null,source_url:null},
    phone:{value:clean(phone?.value,80)||null,confidence:phone?.confidence||null,source_url:phone?.source_url||null},
    email:{value:clean(email?.value,255)||null,confidence:email?.confidence||null,source_url:email?.source_url||null},
    address:{value:clean(address?.value,500)||null,confidence:address?.confidence||null,source_url:address?.source_url||null},
    business_summary:{value:clean(research?.summary,1200)||null,confidence:research?.identity_confidence||null,source_url:null},
    identity_confidence:{value:clean(research?.identity_confidence,20)||null,confidence:research?.identity_confidence||null,source_url:null},
    google_rating:{value:g?.rating??null,confidence:g?'high':null,source_url:g?.source_url||null},
    google_review_count:{value:g?.count??null,confidence:g?'high':null,source_url:g?.source_url||null},
    google_maps_url:{value:clean(g?.source_url,1000)||null,confidence:g?'high':null,source_url:g?.source_url||null},
    verified_services_json:{value:Array.isArray(research?.services)?JSON.stringify(research.services):null,confidence:research?.identity_confidence||null,source_url:null},
    enrichment_sources_json:{value:Array.isArray(research?.sources)?JSON.stringify(research.sources):null,confidence:research?.identity_confidence||null,source_url:null}
  };
}

function protectedSnapshot(row){
  const provenance=parseJson(row?.enrichment_provenance_json,{}),protectedFields={};
  for(const field of BUSINESS_FIELDS){
    const p=provenance[field];
    if(p?.origin==='manual'||(isPresent(row?.[field])&&p?.origin!=='research'))protectedFields[field]=row[field];
  }
  return {provenance,protectedFields};
}

async function markManualFields(env,id,data){
  if(!env.DB||!data||typeof data!=='object')return;
  await ensureSchema(env);
  const row=await env.DB.prepare('SELECT enrichment_provenance_json FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if(!row)return;
  const provenance=parseJson(row.enrichment_provenance_json,{}),now=new Date().toISOString();
  for(const field of BUSINESS_FIELDS){if(Object.prototype.hasOwnProperty.call(data,field))provenance[field]={origin:'manual',updated_at:now,source_url:null,confidence:null}}
  await env.DB.prepare('UPDATE prospects SET enrichment_provenance_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(JSON.stringify(provenance),id).run();
}

async function enrichFromStoredResearch(env,id,before=null){
  if(!env.DB)return;
  await ensureSchema(env);
  const row=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if(!row)return;
  const research=parseJson(row.research_json,null);if(!research)return;
  const snap=before||protectedSnapshot(row),provenance={...snap.provenance},candidates=researchCandidates(research),updates={},now=new Date().toISOString();
  for(const [field,value] of Object.entries(snap.protectedFields||{})){updates[field]=value;provenance[field]={...(provenance[field]||{}),origin:provenance[field]?.origin==='manual'?'manual':'manual_existing',updated_at:provenance[field]?.updated_at||now}}
  for(const [field,candidate] of Object.entries(candidates)){
    if(Object.prototype.hasOwnProperty.call(snap.protectedFields||{},field))continue;
    if(candidate.value===null||candidate.value===undefined||candidate.value==='')continue;
    const p=provenance[field];
    if(p?.origin==='manual'||p?.origin==='manual_existing')continue;
    updates[field]=candidate.value;
    provenance[field]={origin:'research',updated_at:now,source_url:candidate.source_url||null,confidence:candidate.confidence||null};
  }
  const allowed=['category','business_vertical','phone','email','address','business_summary','identity_confidence','google_rating','google_review_count','google_maps_url','verified_services_json','enrichment_sources_json'];
  const fields=allowed.filter(f=>Object.prototype.hasOwnProperty.call(updates,f));
  const assignments=fields.map(f=>`${f}=?`).concat(['enrichment_provenance_json=?','enriched_at=CURRENT_TIMESTAMP','updated_at=CURRENT_TIMESTAMP']);
  const values=fields.map(f=>updates[f]).concat([JSON.stringify(provenance),id]);
  await env.DB.prepare(`UPDATE prospects SET ${assignments.join(',')} WHERE id=?`).bind(...values).run();
}

async function usage(env,{tenantId=1,prospectId,provider,operation,cacheHit=false,durationMs=null,usageData=null}){try{await env.DB.prepare(`INSERT INTO provider_usage_events (tenant_id,prospect_id,provider,operation,cache_hit,duration_ms,request_count,usage_json,created_at) VALUES (?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP)`).bind(tenantId,prospectId,provider,operation,cacheHit?1:0,durationMs,usageData?JSON.stringify(usageData):null).run()}catch{}}
async function setJob(env,tenantId,id,status,stage,error=null){try{await env.DB.prepare(`INSERT INTO platform_jobs (tenant_id,job_key,prospect_id,job_type,status,stage,attempts,last_error,started_at,completed_at,created_at,updated_at) VALUES (?,?,?,'prospect_automation',?,?,1,?,CASE WHEN ?='Running' THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN ? IN ('Complete','Failed') THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET status=excluded.status,stage=excluded.stage,last_error=excluded.last_error,attempts=CASE WHEN excluded.status='Running' THEN platform_jobs.attempts+1 ELSE platform_jobs.attempts END,started_at=CASE WHEN excluded.status='Running' AND platform_jobs.started_at IS NULL THEN CURRENT_TIMESTAMP ELSE platform_jobs.started_at END,completed_at=CASE WHEN excluded.status IN ('Complete','Failed') THEN CURRENT_TIMESTAMP ELSE platform_jobs.completed_at END,updated_at=CURRENT_TIMESTAMP`).bind(tenantId,`tenant:${tenantId}:automation:${id}`,id,status,stage,error,status,status).run()}catch{}}

async function loadCachedResearch(env,p){
  try{const key=`${p.tenant_id}:${await identityCacheKey(p)}`,row=await env.DB.prepare('SELECT payload_json,expires_at FROM research_cache WHERE tenant_id=? AND cache_key=? AND expires_at>CURRENT_TIMESTAMP LIMIT 1').bind(p.tenant_id,key).first();return row?{key,research:parseJson(row.payload_json,null),expires_at:row.expires_at}:null}catch{return null}
}
async function storeResearchCache(env,p){
  try{const research=parseJson(p.research_json,null);if(!research)return;const key=`${p.tenant_id}:${await identityCacheKey(p)}`,sources=Array.isArray(research.sources)?research.sources.length:0,expires=new Date(Date.now()+SOURCE_TTLS.research_days*86400000).toISOString();await env.DB.prepare(`INSERT INTO research_cache (tenant_id,cache_key,business_name,city,state,phone,payload_json,identity_confidence,source_count,created_at,refreshed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,identity_confidence=excluded.identity_confidence,source_count=excluded.source_count,refreshed_at=CURRENT_TIMESTAMP,expires_at=excluded.expires_at`).bind(p.tenant_id,key,p.business_name,p.city||null,p.state||null,p.phone||null,JSON.stringify(research),research.identity_confidence||null,sources,expires).run()}catch{}
}
async function applyCachedResearch(env,p,cached){
  if(!cached?.research)return false;
  await env.DB.prepare(`UPDATE prospects SET research_json=?,research_status='Complete',researched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(cached.research),p.id).run();
  await enrichFromStoredResearch(env,p.id,protectedSnapshot(p));
  await usage(env,{tenantId:p.tenant_id,prospectId:p.id,provider:'research_cache',operation:'business_research',cacheHit:true,usageData:{expires_at:cached.expires_at}});
  return true;
}

function responseText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const a=[];for(const i of d?.output||[])for(const c of i?.content||[])if(c?.type==='output_text'&&c?.text)a.push(c.text);return a.join('\n').trim()}
function parseJsonText(t){const r=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const f=r.indexOf('{'),l=r.lastIndexOf('}');if(f<0||l<f)throw new Error('Visual inspiration response did not contain JSON.');return JSON.parse(r.slice(f,l+1))}
function normalizeVisualInspiration(v,photoCount){const arr=(x,max=8,len=100)=>Array.isArray(x)?x.map(y=>clean(y,len)).filter(Boolean).slice(0,max):[];return{source:'google_places_photos',photo_count:photoCount,visual_mood:clean(v?.visual_mood,80)||null,environment:clean(v?.environment,220)||null,hero_direction:clean(v?.hero_direction,240)||null,brand_cues:arr(v?.brand_cues,8,100),dominant_colors:arr(v?.dominant_colors,6,40),materials:arr(v?.materials,8,80),subjects:arr(v?.subjects,8,100),avoid:arr(v?.avoid,8,120)}}

async function googlePhotoUris(env,p){
  const key=env.GOOGLE_PLACES_API_KEY||env.GOOGLE_MAPS_API_KEY;if(!key)return [];
  const research=parseJson(p.research_json,{}),address=clean(p.address||fact(research,'Address')?.value,300),query=[p.business_name,address,p.city,p.state,p.phone].filter(Boolean).join(' ');if(!query)return [];
  const search=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.photos'},body:JSON.stringify({textQuery:query,maxResultCount:1})});
  const data=await search.json().catch(()=>({}));if(!search.ok)throw new Error(data?.error?.message||`Google Places search failed (${search.status})`);
  const photos=data?.places?.[0]?.photos||[],uris=[];
  for(const photo of photos.slice(0,4)){
    const name=clean(photo?.name,1000);if(!name)continue;
    const media=await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&skipHttpRedirect=true&key=${encodeURIComponent(key)}`),payload=await media.json().catch(()=>({}));
    if(media.ok&&payload?.photoUri)uris.push(payload.photoUri);
  }
  return uris;
}

async function analyzePhotoInspiration(env,p,photoUris){
  if(!env.OPENAI_API_KEY||!photoUris.length)return null;
  const prompt=`Analyze these Google Business/Maps photos only as visual reference for a new concept website for ${clean(p.business_name,200)}. Do not copy, reproduce, trace, crop, embed, or otherwise reuse any source photo in the website. Infer only broad non-sensitive design cues such as atmosphere, environment, colors, materials, subjects, and suitable original hero-image direction. Ignore faces and do not infer identity, demographics, health, religion, or other personal attributes from people in the photos. Return ONLY JSON: {"visual_mood":"...","environment":"...","hero_direction":"original or stock-photo direction inspired by broad cues only","brand_cues":["..."],"dominant_colors":["..."],"materials":["..."],"subjects":["..."],"avoid":["specific things the concept should avoid copying from source photos"]}.`;
  const content=[{type:'input_text',text:prompt},...photoUris.map(image_url=>({type:'input_image',image_url,detail:'low'}))];
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_VISION_MODEL||env.OPENAI_RESEARCH_MODEL||VISION_MODEL,input:[{role:'user',content}]})}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||`Visual inspiration request failed (${response.status})`);
  return normalizeVisualInspiration(parseJsonText(responseText(data)),photoUris.length);
}

async function refreshVisualInspiration(env,tenantId,id,{force=false}={}){
  if(!env.DB||!env.OPENAI_API_KEY)return null;
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return null;
  if(!force&&isFresh(p.visual_inspiration_at,SOURCE_TTLS.visual_inspiration_days))return parseJson(p.visual_inspiration_json,null);
  const plan=sourcePlan(p,{forceGoogle:force||env.GOOGLE_VISUALS_MODE==='always'});
  if(!plan.google_places||!(env.GOOGLE_PLACES_API_KEY||env.GOOGLE_MAPS_API_KEY))return null;
  const started=Date.now(),photoUris=await googlePhotoUris(env,p);if(!photoUris.length)return null;
  const inspiration=await analyzePhotoInspiration(env,p,photoUris);if(!inspiration)return null;
  const research=parseJson(p.research_json,{}),profile={...(research.design_profile||{})};
  if(inspiration.visual_mood)profile.mood=inspiration.visual_mood;
  const visualSignal=[profile.image_theme,inspiration.hero_direction,...inspiration.subjects,...inspiration.materials].filter(Boolean).join(' | ');if(visualSignal)profile.image_theme=clean(visualSignal,500);
  const directives=parseJson(p.design_directives_json,null);if(directives&&typeof directives==='object'){for(const key of DESIGN_PROFILE_KEYS){if(directives[key]!==undefined)profile[key]=directives[key]}}
  const updatedResearch={...research,design_profile:profile,visual_inspiration:inspiration,design_profile_origin:directives?'design_studio':research.design_profile_origin};
  await env.DB.prepare('UPDATE prospects SET research_json=?,visual_inspiration_json=?,visual_inspiration_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(JSON.stringify(updatedResearch),JSON.stringify(inspiration),id).run();
  await usage(env,{tenantId,prospectId:id,provider:'google_places',operation:'visual_inspiration',durationMs:Date.now()-started,usageData:{photo_count:photoUris.length,reason:plan.reason}});
  return inspiration;
}

async function readJsonClone(request){try{return await request.clone().json()}catch{return null}}
function internalPostRequest(request,path){const url=new URL(request.url);url.pathname=path;url.search='';const headers=new Headers({'content-type':'application/json'});const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);headers.set('origin',url.origin);return new Request(url.toString(),{method:'POST',headers,body:'{}'})}

async function ensureResearch(worker,request,env,context,id){
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p||p.research_status==='Complete')return true;
  const cached=await loadCachedResearch(env,p);if(cached&&await applyCachedResearch(env,p,cached))return true;
  const started=Date.now(),researchResponse=await worker.fetch(internalPostRequest(request,`/api/admin/prospects/${id}/research`),env,context);
  if(researchResponse.ok){const refreshed=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(refreshed)await storeResearchCache(env,refreshed);await usage(env,{tenantId,prospectId:id,provider:'openai',operation:'business_research',durationMs:Date.now()-started});return true}
  return false;
}

async function prepareConceptBuild(worker,request,env,context,tenantId,id){
  try{await ensureResearch(worker,request,env,context,id);await refreshVisualInspiration(env,tenantId,id)}catch(error){console.warn('Optional visual enrichment skipped',{prospectId:id,error:clean(error?.message||error,500)})}
}

async function queueAutoResearchAndBuild(worker,request,env,context,tenantId,id){
  await ensureSchema(env);
  await env.DB.prepare("UPDATE prospects SET research_status='Queued',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").bind(tenantId,id).run();
  await setJob(env,tenantId,id,'Queued','Browser Research & Build');
}

const worker={
  async fetch(request,env,context){
    const url=new URL(request.url);if(!env.DB)return prospectCleanupWorker.fetch(request,env,context);await ensureSchema(env);
    let data=null,before=null,id=null;
    let tenantId=null;
    if(url.pathname.startsWith('/api/admin/prospects')){
      const headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
      const me=await prospectCleanupWorker.fetch(new Request(new URL('/api/admin/me',request.url),{method:'GET',headers}),env,context);
      if(!me.ok)return me;const mePayload=await me.json().catch(()=>null);tenantId=Number(mePayload?.user?.current_tenant_id);
      if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);
      const routeId=Number((url.pathname.match(/^\/api\/admin\/prospects\/(\d+)/)||[])[1]);
      if(routeId){const owned=await env.DB.prepare('SELECT id FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenantId,routeId).first();if(!owned)return json({ok:false,error:'Prospect not found.'},404)}
    }
    const researchMatch=url.pathname.match(RESEARCH_MUTATION_RE),prospectMatch=url.pathname.match(PROSPECT_MUTATION_RE);
    const isCreate=url.pathname==='/api/admin/prospects'&&request.method==='POST';
    const isManualUpdate=prospectMatch&&request.method==='PATCH';
    const isResearchMutation=researchMatch&&researchMatch[2]==='research'&&request.method==='POST';
    const isConceptBuild=researchMatch&&researchMatch[2]==='build-concept'&&request.method==='POST';
    if(isCreate||isManualUpdate)data=await readJsonClone(request);
    if(isManualUpdate)id=Number(prospectMatch[1]);
    if(isResearchMutation){id=Number(researchMatch[1]);const row=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(row)before=protectedSnapshot(row)}
    if(isConceptBuild){id=Number(researchMatch[1]);await prepareConceptBuild(worker,request,env,context,tenantId,id)}
    const response=await prospectCleanupWorker.fetch(request,env,context);if(!response.ok)return response;
    try{
      if(isCreate){const payload=await response.clone().json();if(payload?.id){id=Number(payload.id);await markManualFields(env,id,data);await queueAutoResearchAndBuild(worker,request,env,context,tenantId,id)}}
      if(isManualUpdate)await markManualFields(env,id,data);
      if(isResearchMutation){await enrichFromStoredResearch(env,id,before);const row=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(row)await storeResearchCache(env,row)}
    }catch(error){console.error('Prospect enrichment post-processing failed',error)}
    return response;
  }
};

export default worker;
