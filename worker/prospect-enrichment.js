import prospectCleanupWorker from './prospect-cleanup.js';

const clean=(v,m=4000)=>String(v??'').trim().slice(0,m);
const BUSINESS_FIELDS=['business_name','category','business_vertical','city','state','phone','email','address','business_summary','identity_confidence','google_rating','google_review_count','google_maps_url','verified_services_json','enrichment_sources_json'];
const RESEARCH_MUTATION_RE=/^\/api\/admin\/prospects\/(\d+)\/(research|build-concept)$/;
const PROSPECT_MUTATION_RE=/^\/api\/admin\/prospects\/(\d+)$/;

async function ensureSchema(env){
  if(!env.DB)return;
  const alters=[
    'ALTER TABLE prospects ADD COLUMN address TEXT',
    'ALTER TABLE prospects ADD COLUMN business_summary TEXT',
    'ALTER TABLE prospects ADD COLUMN identity_confidence TEXT',
    'ALTER TABLE prospects ADD COLUMN google_rating REAL',
    'ALTER TABLE prospects ADD COLUMN google_review_count INTEGER',
    'ALTER TABLE prospects ADD COLUMN google_maps_url TEXT',
    'ALTER TABLE prospects ADD COLUMN verified_services_json TEXT',
    'ALTER TABLE prospects ADD COLUMN enrichment_sources_json TEXT',
    'ALTER TABLE prospects ADD COLUMN enrichment_provenance_json TEXT',
    'ALTER TABLE prospects ADD COLUMN enriched_at TEXT',
    "ALTER TABLE prospects ADD COLUMN research_status TEXT NOT NULL DEFAULT 'Not Run'"
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
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

async function readJsonClone(request){try{return await request.clone().json()}catch{return null}}

function internalPostRequest(request,path){
  const url=new URL(request.url);url.pathname=path;url.search='';
  const headers=new Headers({'content-type':'application/json'});
  const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
  headers.set('origin',url.origin);
  return new Request(url.toString(),{method:'POST',headers,body:'{}'});
}

async function recordAutomationFailure(env,id,field,message){
  await env.DB.prepare(`UPDATE prospects SET ${field}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clean(message,1000),id).run().catch(()=>{});
}

async function queueAutoResearchAndBuild(worker,request,env,context,id){
  await ensureSchema(env);
  await env.DB.prepare("UPDATE prospects SET research_status='Queued',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  const task=(async()=>{
    try{
      const researchResponse=await worker.fetch(internalPostRequest(request,`/api/admin/prospects/${id}/research`),env,context);
      if(!researchResponse.ok){
        const payload=await researchResponse.clone().json().catch(()=>({}));
        const message=clean(payload?.error||`Automatic research request failed (${researchResponse.status})`,1000);
        await recordAutomationFailure(env,id,'research_error',message);
        console.error('Automatic prospect research failed',{prospectId:id,error:message});
        return;
      }
      const buildResponse=await worker.fetch(internalPostRequest(request,`/api/admin/prospects/${id}/build-concept`),env,context);
      if(!buildResponse.ok){
        const payload=await buildResponse.clone().json().catch(()=>({}));
        const message=clean(payload?.error||`Automatic concept build failed (${buildResponse.status})`,1000);
        console.error('Automatic concept build failed',{prospectId:id,error:message});
      }
    }catch(error){
      const message=clean(error?.message||error,1000);
      await recordAutomationFailure(env,id,'research_error',message);
      console.error('Automatic prospect workflow failed',{prospectId:id,error:message});
    }
  })();
  if(context?.waitUntil)context.waitUntil(task);else await task;
}

const worker={
  async fetch(request,env,context){
    const url=new URL(request.url);
    if(!env.DB)return prospectCleanupWorker.fetch(request,env,context);
    await ensureSchema(env);

    let data=null,before=null,id=null;
    const researchMatch=url.pathname.match(RESEARCH_MUTATION_RE),prospectMatch=url.pathname.match(PROSPECT_MUTATION_RE);
    const isCreate=url.pathname==='/api/admin/prospects'&&request.method==='POST';
    const isManualUpdate=prospectMatch&&request.method==='PATCH';
    const isResearchMutation=researchMatch&&request.method==='POST';

    if(isCreate||isManualUpdate)data=await readJsonClone(request);
    if(isManualUpdate)id=Number(prospectMatch[1]);
    if(isResearchMutation){id=Number(researchMatch[1]);const row=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(row)before=protectedSnapshot(row)}

    const response=await prospectCleanupWorker.fetch(request,env,context);
    if(!response.ok)return response;

    try{
      if(isCreate){const payload=await response.clone().json();if(payload?.id){id=Number(payload.id);await markManualFields(env,id,data);await queueAutoResearchAndBuild(worker,request,env,context,id)}}
      if(isManualUpdate)await markManualFields(env,id,data);
      if(isResearchMutation)await enrichFromStoredResearch(env,id,before);
    }catch(error){console.error('Prospect enrichment post-processing failed',error)}
    return response;
  }
};

export default worker;
