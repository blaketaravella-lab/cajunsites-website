import appWorker from './platform-hardening.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const CONCEPT_REDIRECT=/^\/api\/admin\/prospects\/(\d+)\/concept$/;
const VERCEL_PROJECT='cajun-sites-prospect-websites';
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';

async function currentUser(request,env){
  const headers=new Headers();const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
  const r=await appWorker.fetch(new Request(new URL('/api/admin/me',request.url),{method:'GET',headers}),env);
  return r.ok?(await r.json().catch(()=>null))?.user||null:null;
}

async function ensureCompatibility(env){
  if(!env.DB)return;
  for(const sql of [
    `ALTER TABLE prospects ADD COLUMN customer_id INTEGER`,
    `ALTER TABLE prospects ADD COLUMN concept_state TEXT NOT NULL DEFAULT 'Not Built'`,
    `ALTER TABLE prospects ADD COLUMN concept_slug TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_deployment_id TEXT`,
    `ALTER TABLE prospects ADD COLUMN concept_build_error TEXT`,
    `ALTER TABLE prospects ADD COLUMN research_status TEXT NOT NULL DEFAULT 'Not Run'`,
    `ALTER TABLE prospects ADD COLUMN visual_fallback INTEGER NOT NULL DEFAULT 0`
  ]){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))console.warn('Compatibility alter skipped',String(e?.message||e))}}
  try{await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_activity (id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,event_type TEXT,description TEXT NOT NULL,metadata_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}catch{}
}

const safeFirst=async(stmt,fallback={})=>{try{return await stmt.first()||fallback}catch(e){console.warn('Dashboard query fallback',String(e?.message||e));return fallback}};
const safeAll=async(stmt)=>{try{return await stmt.all()}catch(e){console.warn('Dashboard query fallback',String(e?.message||e));return{results:[]}}};

async function dashboardSummary(request,env){
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(!env.DB)return json({ok:false,error:'Database unavailable.'},503);
  await ensureCompatibility(env);
  const today=new Date().toISOString().slice(0,10);
  const stages=await safeAll(env.DB.prepare(`SELECT stage,COUNT(*) AS count FROM prospects WHERE customer_id IS NULL GROUP BY stage`));
  const prospectStats=await safeFirst(env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN next_follow_up IS NOT NULL AND next_follow_up<? AND stage NOT IN ('Won','Lost') THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN research_status='Failed' THEN 1 ELSE 0 END) AS research_failures,SUM(CASE WHEN concept_state='Build Failed' OR concept_build_error IS NOT NULL THEN 1 ELSE 0 END) AS build_failures,SUM(CASE WHEN visual_fallback=1 THEN 1 ELSE 0 END) AS fallbacks FROM prospects WHERE customer_id IS NULL`).bind(today),{total:0,overdue:0,research_failures:0,build_failures:0,fallbacks:0});
  const customerStats=await safeFirst(env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('Ready to Build','Building','Internal QA','Customer Review','Revisions','Approved for Launch','Launching') THEN 1 ELSE 0 END) AS production,SUM(CASE WHEN status='Payment Issue' THEN 1 ELSE 0 END) AS payment_issues FROM customers`),{total:0,production:0,payment_issues:0});
  const priority=await safeAll(env.DB.prepare(`SELECT id,business_name,email,status FROM customers WHERE status NOT IN ('Live','Active Customer','Cancelled') ORDER BY updated_at ASC LIMIT 8`));
  const activity=await safeAll(env.DB.prepare(`SELECT description,created_at FROM admin_activity ORDER BY id DESC LIMIT 8`));
  const billing=await safeFirst(env.DB.prepare(`SELECT COALESCE(SUM(mrr_cents),0) AS actual_mrr_cents,SUM(CASE WHEN delinquent=1 OR subscription_status IN ('past_due','unpaid') THEN 1 ELSE 0 END) AS past_due,COUNT(*) AS synced FROM billing_snapshots`),{actual_mrr_cents:0,past_due:0,synced:0});
  const jobs=await safeAll(env.DB.prepare(`SELECT status,COUNT(*) AS count FROM platform_jobs GROUP BY status`));
  const usage=await safeFirst(env.DB.prepare(`SELECT COUNT(*) AS calls,SUM(cache_hit) AS cache_hits,SUM(CASE WHEN provider='google_places' THEN 1 ELSE 0 END) AS google_calls,SUM(CASE WHEN provider='openai' THEN 1 ELSE 0 END) AS openai_calls FROM provider_usage_events WHERE created_at>=datetime('now','-30 days')`),{calls:0,cache_hits:0,google_calls:0,openai_calls:0});
  const images=await safeFirst(env.DB.prepare(`SELECT COUNT(*) AS attempts,SUM(CASE WHEN qa_status='approved' THEN 1 ELSE 0 END) AS approved FROM concept_images WHERE created_at>=datetime('now','-30 days')`),{attempts:0,approved:0});
  const stageCounts=Object.fromEntries((stages.results||[]).map(r=>[r.stage,Number(r.count||0)]));
  const jobCounts=Object.fromEntries((jobs.results||[]).map(r=>[r.status,Number(r.count||0)]));
  const calls=Number(usage.calls||0),hits=Number(usage.cache_hits||0),customerTotal=Number(customerStats.total||0),synced=Number(billing.synced||0);
  return json({ok:true,prospects:{total:Number(prospectStats.total||0),stage_counts:stageCounts,open:(stageCounts.Qualified||0)+(stageCounts['Concept Built']||0)+(stageCounts.Contacted||0)+(stageCounts['Concept Viewed']||0),overdue_followups:Number(prospectStats.overdue||0),research_failures:Number(prospectStats.research_failures||0),build_failures:Number(prospectStats.build_failures||0),generic_fallbacks:Number(prospectStats.fallbacks||0)},customers:{total:customerTotal,in_production:Number(customerStats.production||0),payment_issues:Number(customerStats.payment_issues||0),priority:priority.results||[]},billing:{actual_mrr_cents:Number(billing.actual_mrr_cents||0),past_due:Number(billing.past_due||0),synced_customers:synced,unsynced_customers:Math.max(0,customerTotal-synced)},jobs:{counts:jobCounts},efficiency:{provider_calls_30d:calls,cache_hits_30d:hits,cache_hit_rate:calls?Number((hits/calls*100).toFixed(1)):0,google_calls_30d:Number(usage.google_calls||0),openai_calls_30d:Number(usage.openai_calls||0),image_attempts_30d:Number(images.attempts||0),approved_images_30d:Number(images.approved||0)},activity:activity.results||[]});
}

function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
async function vercel(env,path,options={}){if(!env.VERCEL_API_TOKEN)throw new Error('VERCEL_API_TOKEN is not configured.');const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{...options,headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel request failed (${r.status})`);return d}
async function publicReachable(url){try{const r=await fetch(url,{method:'GET',redirect:'manual',headers:{'user-agent':'CajunSites-Concept-Health/1.0'}});return r.status>=200&&r.status<400}catch{return false}}
async function ensureDns(env,slug){if(!env.DNS_INTEGRATION_API_KEY)return;const r=await fetch(env.CAJUNSITES_DNS_API_URL||DNS_API,{method:'POST',headers:{Authorization:`Bearer ${env.DNS_INTEGRATION_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({name:slug,content:'cname.vercel-dns.com',proxied:false,ttl:1})});if(!r.ok)throw new Error(`DNS repair failed (${r.status})`)}
async function repairConcept(env,p){
  const url=p.concept_url||((p.concept_slug||'')?`https://${p.concept_slug}.cajunsites.com`:'');if(!url)throw new Error('This prospect does not have a concept URL yet.');
  if(await publicReachable(url))return url;
  const deploymentId=String(p.concept_deployment_id||'').trim();if(!deploymentId)throw new Error('The stored concept deployment is missing. Rebuild the concept.');
  const alias=new URL(url).hostname;const slug=alias.endsWith('.cajunsites.com')?alias.slice(0,-'.cajunsites.com'.length):(p.concept_slug||'');
  if(slug)await ensureDns(env,slug).catch(e=>console.warn('Concept DNS repair warning',String(e?.message||e)));
  try{await vercel(env,`/v10/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains`,{method:'POST',body:JSON.stringify({name:alias})})}catch(e){if(!/already exists|already added|already in use|domain.*exists/i.test(String(e?.message||e)))console.warn('Concept domain repair warning',String(e?.message||e))}
  try{await vercel(env,`/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`,{method:'POST',body:JSON.stringify({alias})})}catch(e){if(!/already exists|already assigned|already in use/i.test(String(e?.message||e)))console.warn('Concept alias repair warning',String(e?.message||e))}
  for(let i=0;i<4;i++){if(await publicReachable(url))return url;await new Promise(r=>setTimeout(r,500))}
  const dep=await vercel(env,`/v13/deployments/${encodeURIComponent(deploymentId)}`);const direct=dep?.url?`https://${String(dep.url).replace(/^https?:\/\//,'').replace(/\/$/,'')}`:'';if(direct&&await publicReachable(direct))return direct;
  throw new Error('The concept deployment is unavailable. Rebuild the concept to publish a fresh preview.');
}

async function conceptRedirect(request,env,id){
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(!env.DB)return json({ok:false,error:'Database unavailable.'},503);
  await ensureCompatibility(env);const p=await env.DB.prepare('SELECT id,concept_url,concept_slug,concept_deployment_id,concept_state FROM prospects WHERE id=? LIMIT 1').bind(id).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);
  try{const target=await repairConcept(env,p);return new Response(null,{status:302,headers:{location:target,'cache-control':'no-store'}})}catch(e){return json({ok:false,error:String(e?.message||e),prospect_id:id,action:'Rebuild the prospect concept from the Prospect workspace.'},410)}
}

function rewriteProspectLinks(payload,origin){
  const patch=p=>{if(p&&typeof p==='object'&&Number.isFinite(Number(p.id))&&p.concept_url){p.public_concept_url=p.concept_url;p.concept_url=`${origin}/api/admin/prospects/${p.id}/concept`}}
  if(Array.isArray(payload?.prospects))payload.prospects.forEach(patch);patch(payload?.prospect);return payload;
}

export default{async fetch(request,env,context){
  const url=new URL(request.url);
  try{
    if(request.method==='GET'&&url.pathname==='/api/admin/dashboard-summary')return await dashboardSummary(request,env);
    const m=url.pathname.match(CONCEPT_REDIRECT);if(m&&request.method==='GET')return await conceptRedirect(request,env,Number(m[1]));
    const response=await appWorker.fetch(request,env,context);
    if(request.method==='GET'&&response.ok&&(/^\/api\/admin\/prospects(?:\/|$)/.test(url.pathname)||/^\/api\/admin\/design-chat\//.test(url.pathname))&&String(response.headers.get('content-type')||'').includes('application/json')){
      const payload=await response.clone().json().catch(()=>null);if(payload){const next=rewriteProspectLinks(payload,url.origin);return new Response(JSON.stringify(next),{status:response.status,headers:response.headers})}
    }
    return response;
  }catch(e){console.error('Reliability hotfix error',e);return json({ok:false,error:String(e?.message||e)},500)}
}};
