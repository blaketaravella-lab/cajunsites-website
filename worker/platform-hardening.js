import appWorker from './design-chat.js';
import {identityCacheKey,SOURCE_TTLS,sourcePlan} from './providers/business-data.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const RESEARCH_RE=/^\/api\/admin\/prospects\/(\d+)\/research$/;
const BUILD_RE=/^\/api\/admin\/prospects\/(\d+)\/build-concept$/;
const BILLING_RE=/^\/api\/admin\/customers\/(\d+)\/billing$/;

async function actor(request,env){
  const url=new URL('/api/admin/me',request.url),headers=new Headers();
  const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
  const r=await appWorker.fetch(new Request(url,{method:'GET',headers}),env);
  return r.ok?(await r.json().catch(()=>null))?.user||null:null;
}

async function ensurePlatformSchema(env){
  if(!env.DB)return;
  const statements=[
    `CREATE TABLE IF NOT EXISTS research_cache (cache_key TEXT PRIMARY KEY,business_name TEXT NOT NULL,city TEXT,state TEXT,phone TEXT,payload_json TEXT NOT NULL,identity_confidence TEXT,source_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS platform_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,job_key TEXT NOT NULL UNIQUE,prospect_id INTEGER,customer_id INTEGER,job_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Queued',stage TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at TEXT,completed_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS provider_usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT,prospect_id INTEGER,customer_id INTEGER,provider TEXT NOT NULL,operation TEXT NOT NULL,model TEXT,cache_hit INTEGER NOT NULL DEFAULT 0,duration_ms INTEGER,request_count INTEGER NOT NULL DEFAULT 1,usage_json TEXT,estimated_cost_usd REAL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS billing_snapshots (customer_id INTEGER PRIMARY KEY,stripe_customer_id TEXT,stripe_subscription_id TEXT,subscription_status TEXT,amount_cents INTEGER,interval TEXT,mrr_cents INTEGER NOT NULL DEFAULT 0,open_balance_cents INTEGER NOT NULL DEFAULT 0,delinquent INTEGER NOT NULL DEFAULT 0,last_invoice_status TEXT,current_period_end TEXT,synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_research_cache_expiry ON research_cache(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_platform_jobs_status ON platform_jobs(status,updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage_events(created_at DESC)`
  ];
  for(const sql of statements)await env.DB.prepare(sql).run();
}

function expiry(days){return new Date(Date.now()+days*86400000).toISOString()}
function parseResearch(v){try{return typeof v==='string'?JSON.parse(v):v}catch{return null}}
function mrrCents(amount,interval){const n=Number(amount||0);if(!n)return 0;if(interval==='year')return Math.round(n/12);if(interval==='week')return Math.round(n*52/12);if(interval==='day')return Math.round(n*365/12);return n}

async function usage(env,{tenantId=1,prospectId=null,customerId=null,provider,operation,model=null,cacheHit=false,durationMs=null,usageData=null}){
  if(!env.DB)return;
  try{await env.DB.prepare(`INSERT INTO provider_usage_events (tenant_id,prospect_id,customer_id,provider,operation,model,cache_hit,duration_ms,request_count,usage_json,created_at) VALUES (?,?,?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP)`).bind(tenantId,prospectId,customerId,provider,operation,model,cacheHit?1:0,durationMs,usageData?JSON.stringify(usageData):null).run()}catch{}
}

async function upsertJob(env,{tenantId=1,key,prospectId=null,customerId=null,type,status,stage=null,error=null,incrementAttempt=false}){
  if(!env.DB)return;
  try{await env.DB.prepare(`INSERT INTO platform_jobs (tenant_id,job_key,prospect_id,customer_id,job_type,status,stage,attempts,last_error,started_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?, CASE WHEN ?='Running' THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN ? IN ('Complete','Failed') THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET status=excluded.status,stage=excluded.stage,attempts=platform_jobs.attempts+?,last_error=excluded.last_error,started_at=CASE WHEN excluded.status='Running' AND platform_jobs.started_at IS NULL THEN CURRENT_TIMESTAMP ELSE platform_jobs.started_at END,completed_at=CASE WHEN excluded.status IN ('Complete','Failed') THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP`).bind(tenantId,key,prospectId,customerId,type,status,stage,incrementAttempt?1:0,error,status,status,incrementAttempt?1:0).run()}catch{}
}

async function prospect(env,tenantId,id){return env.DB?.prepare('SELECT * FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenantId,id).first()||null}

async function promoteCachedResearch(env,p,research){
  if(!env.DB||!research)return;
  const services=Array.isArray(research.services)?JSON.stringify(research.services):null;
  const sources=Array.isArray(research.sources)?JSON.stringify(research.sources):null;
  const facts=Array.isArray(research.facts)?research.facts:[];
  const value=label=>facts.find(f=>String(f?.label||'').toLowerCase()===label.toLowerCase())?.value||null;
  await env.DB.prepare(`UPDATE prospects SET research_json=?,research_status='Complete',business_vertical=COALESCE(NULLIF(business_vertical,''),?),category=COALESCE(NULLIF(category,''),?),phone=COALESCE(NULLIF(phone,''),?),email=COALESCE(NULLIF(email,''),?),address=COALESCE(NULLIF(address,''),?),business_summary=COALESCE(NULLIF(business_summary,''),?),identity_confidence=COALESCE(NULLIF(identity_confidence,''),?),verified_services_json=COALESCE(NULLIF(verified_services_json,''),?),enrichment_sources_json=COALESCE(NULLIF(enrichment_sources_json,''),?),researched_at=CURRENT_TIMESTAMP,enriched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?`).bind(JSON.stringify(research),research.vertical||null,research.vertical||null,value('Phone'),value('Email'),value('Address'),research.summary||null,research.identity_confidence||null,services,sources,p.tenant_id,p.id).run();
}

async function handleResearch(request,env,id){
  await ensurePlatformSchema(env);
  const user=await actor(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);const tenantId=Number(user.current_tenant_id);if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);
  const p=await prospect(env,tenantId,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);
  const url=new URL(request.url),force=url.searchParams.get('refresh')==='1';
  const key=`${tenantId}:${await identityCacheKey(p)}`,started=Date.now(),jobKey=`tenant:${tenantId}:research:${id}`;
  await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'research',status:'Running',stage:'Researching',incrementAttempt:true});
  if(!force){
    const cached=await env.DB.prepare(`SELECT * FROM research_cache WHERE tenant_id=? AND cache_key=? AND expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(tenantId,key).first();
    if(cached){
      const research=parseResearch(cached.payload_json);await promoteCachedResearch(env,p,research);
      await usage(env,{tenantId,prospectId:id,provider:'research_cache',operation:'business_research',cacheHit:true,durationMs:Date.now()-started,usageData:{source_count:cached.source_count}});
      await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'research',status:'Complete',stage:'Cached'});
      return json({ok:true,research,cache:{hit:true,expires_at:cached.expires_at},source_strategy:'free_first_confidence_driven'});
    }
  }
  const response=await appWorker.fetch(request,env);const clone=response.clone();
  const payload=await clone.json().catch(()=>null);
  if(response.ok&&payload?.research){
    const research=payload.research,sources=Array.isArray(research.sources)?research.sources.length:0;
    await env.DB.prepare(`INSERT INTO research_cache (tenant_id,cache_key,business_name,city,state,phone,payload_json,identity_confidence,source_count,created_at,refreshed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,identity_confidence=excluded.identity_confidence,source_count=excluded.source_count,refreshed_at=CURRENT_TIMESTAMP,expires_at=excluded.expires_at`).bind(tenantId,key,p.business_name,p.city||null,p.state||null,p.phone||null,JSON.stringify(research),research.identity_confidence||null,sources,expiry(SOURCE_TTLS.research_days)).run();
    await usage(env,{tenantId,prospectId:id,provider:'openai',operation:'business_research',model:env.OPENAI_RESEARCH_MODEL||'default',durationMs:Date.now()-started,usageData:{source_count:sources}});
    await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'research',status:'Complete',stage:'Researched'});
  }else await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'research',status:'Failed',stage:'Research',error:payload?.error||`HTTP ${response.status}`});
  return response;
}

function routedEnv(env,p,request){
  const force=new URL(request.url).searchParams.get('enhanced_sources')==='1';
  const plan=sourcePlan(p,{forceGoogle:force});
  if(plan.google_places)return {env,plan};
  const proxy=new Proxy(env,{get(target,prop){if(prop==='GOOGLE_PLACES_API_KEY'||prop==='GOOGLE_MAPS_API_KEY')return undefined;return target[prop]}});
  return {env:proxy,plan};
}

async function handleBuild(request,env,id){
  await ensurePlatformSchema(env);
  const user=await actor(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);const tenantId=Number(user.current_tenant_id);if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);
  const p=await prospect(env,tenantId,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);
  const {env:rEnv,plan}=routedEnv(env,p,request),started=Date.now(),jobKey=`tenant:${tenantId}:concept:${id}`;
  await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'concept_build',status:'Running',stage:'Building',incrementAttempt:true});
  const response=await appWorker.fetch(request,rEnv);const payload=await response.clone().json().catch(()=>null);
  let attempts=0;try{const row=await env.DB.prepare(`SELECT COUNT(*) AS count FROM concept_images WHERE tenant_id=? AND prospect_id=? AND created_at>=datetime('now','-1 day')`).bind(tenantId,id).first();attempts=Number(row?.count||0)}catch{}
  await usage(env,{tenantId,prospectId:id,provider:'openai',operation:'concept_build',model:payload?.image_pipeline?.model||env.OPENAI_IMAGE_MODEL||'default',durationMs:Date.now()-started,usageData:{image_attempt_records:attempts,source_plan:plan}});
  if(plan.google_places)await usage(env,{tenantId,prospectId:id,provider:'google_places',operation:'visual_inspiration',durationMs:null,usageData:{reason:plan.reason}});
  await upsertJob(env,{tenantId,key:jobKey,prospectId:id,type:'concept_build',status:response.ok?'Complete':'Failed',stage:response.ok?'Deployed':'Build',error:response.ok?null:payload?.error||`HTTP ${response.status}`});
  return response;
}

async function persistBillingSnapshot(env,customerId,payload){
  if(!env.DB||!payload?.ok)return;
  const s=payload.subscription||null,sc=payload.stripe_customer||null;
  await env.DB.prepare(`INSERT INTO billing_snapshots (customer_id,stripe_customer_id,stripe_subscription_id,subscription_status,amount_cents,interval,mrr_cents,open_balance_cents,delinquent,last_invoice_status,current_period_end,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(customer_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,subscription_status=excluded.subscription_status,amount_cents=excluded.amount_cents,interval=excluded.interval,mrr_cents=excluded.mrr_cents,open_balance_cents=excluded.open_balance_cents,delinquent=excluded.delinquent,last_invoice_status=excluded.last_invoice_status,current_period_end=excluded.current_period_end,synced_at=CURRENT_TIMESTAMP`).bind(customerId,payload.customer?.stripe_customer_id||null,s?.id||null,s?.status||null,s?.amount||0,s?.interval||null,mrrCents(s?.amount,s?.interval),Math.max(0,Number(sc?.balance||0)),sc?.delinquent?1:0,payload.invoices?.[0]?.status||null,s?.current_period_end?new Date(s.current_period_end*1000).toISOString():null).run();
}

async function handleBilling(request,env,id){
  await ensurePlatformSchema(env);const started=Date.now();const response=await appWorker.fetch(request,env);const payload=await response.clone().json().catch(()=>null);
  if(response.ok){await persistBillingSnapshot(env,id,payload);await usage(env,{customerId:id,provider:'stripe',operation:'billing_sync',durationMs:Date.now()-started,usageData:{invoice_count:payload?.invoices?.length||0}})}
  return response;
}

async function syncWebhookSnapshot(env,event){
  const obj=event?.data?.object;if(!obj||!env.DB)return;
  if(String(event.type||'').startsWith('customer.subscription.')){
    const customer=await env.DB.prepare('SELECT id FROM customers WHERE stripe_customer_id=? LIMIT 1').bind(obj.customer).first();if(!customer)return;
    const price=obj.items?.data?.[0]?.price||null,amount=Number(price?.unit_amount||0),interval=price?.recurring?.interval||null;
    await env.DB.prepare(`INSERT INTO billing_snapshots (customer_id,stripe_customer_id,stripe_subscription_id,subscription_status,amount_cents,interval,mrr_cents,current_period_end,synced_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(customer_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,subscription_status=excluded.subscription_status,amount_cents=excluded.amount_cents,interval=excluded.interval,mrr_cents=excluded.mrr_cents,current_period_end=excluded.current_period_end,synced_at=CURRENT_TIMESTAMP`).bind(customer.id,obj.customer,obj.id,obj.status,amount,interval,mrrCents(amount,interval),obj.current_period_end?new Date(obj.current_period_end*1000).toISOString():null).run();
  }else if(String(event.type||'').startsWith('invoice.')){
    const customer=await env.DB.prepare('SELECT id FROM customers WHERE stripe_customer_id=? LIMIT 1').bind(obj.customer).first();if(!customer)return;
    await env.DB.prepare(`INSERT INTO billing_snapshots (customer_id,stripe_customer_id,open_balance_cents,last_invoice_status,delinquent,synced_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(customer_id) DO UPDATE SET open_balance_cents=excluded.open_balance_cents,last_invoice_status=excluded.last_invoice_status,delinquent=excluded.delinquent,synced_at=CURRENT_TIMESTAMP`).bind(customer.id,obj.customer,Number(obj.amount_remaining||0),obj.status||null,['past_due','unpaid'].includes(obj.status)?1:0).run();
  }
}

async function reconcileJobs(env){
  try{await env.DB.prepare(`UPDATE platform_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM prospects p WHERE p.id=platform_jobs.prospect_id AND p.concept_state='Built') AND job_type='prospect_automation' THEN 'Complete' WHEN EXISTS(SELECT 1 FROM prospects p WHERE p.id=platform_jobs.prospect_id AND (p.research_status='Failed' OR p.concept_state='Build Failed')) THEN 'Failed' ELSE status END,completed_at=CASE WHEN status IN ('Complete','Failed') THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE status IN ('Queued','Running')`).run()}catch{}
}

async function dashboardSummary(request,env){
  const user=await actor(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);const tenantId=Number(user.current_tenant_id);if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);if(!env.DB)return json({ok:false,error:'Database unavailable.'},503);
  await ensurePlatformSchema(env);await reconcileJobs(env);
  const today=new Date().toISOString().slice(0,10);
  const [stages,prospectStats,customerStats,priority,activity,billing,jobs,usageStats,imageStats]=await Promise.all([
    env.DB.prepare(`SELECT stage,COUNT(*) AS count FROM prospects WHERE tenant_id=? AND customer_id IS NULL GROUP BY stage`).bind(tenantId).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN next_follow_up IS NOT NULL AND next_follow_up<? AND stage NOT IN ('Won','Lost') THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN research_status='Failed' THEN 1 ELSE 0 END) AS research_failures,SUM(CASE WHEN concept_state='Build Failed' OR concept_build_error IS NOT NULL THEN 1 ELSE 0 END) AS build_failures,SUM(CASE WHEN visual_fallback=1 THEN 1 ELSE 0 END) AS fallbacks FROM prospects WHERE tenant_id=? AND customer_id IS NULL`).bind(tenantId,today).first(),
    env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('Ready to Build','Building','Internal QA','Customer Review','Revisions','Approved for Launch','Launching') THEN 1 ELSE 0 END) AS production,SUM(CASE WHEN status='Payment Issue' THEN 1 ELSE 0 END) AS payment_issues FROM customers`).first(),
    env.DB.prepare(`SELECT id,business_name,email,status FROM customers WHERE status NOT IN ('Live','Active Customer','Cancelled') ORDER BY updated_at ASC LIMIT 8`).all(),
    env.DB.prepare(`SELECT a.description,a.created_at FROM admin_activity a ORDER BY a.id DESC LIMIT 8`).all(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN subscription_status IN ('active','trialing') THEN mrr_cents ELSE 0 END),0) AS actual_mrr_cents,SUM(CASE WHEN subscription_status IN ('past_due','unpaid') OR delinquent=1 THEN 1 ELSE 0 END) AS past_due,COUNT(*) AS synced FROM billing_snapshots`).first(),
    env.DB.prepare(`SELECT status,COUNT(*) AS count FROM platform_jobs WHERE tenant_id=? GROUP BY status`).bind(tenantId).all(),
    env.DB.prepare(`SELECT COUNT(*) AS calls,SUM(cache_hit) AS cache_hits,SUM(CASE WHEN provider='google_places' THEN 1 ELSE 0 END) AS google_calls,SUM(CASE WHEN provider='openai' THEN 1 ELSE 0 END) AS openai_calls FROM provider_usage_events WHERE tenant_id=? AND created_at>=datetime('now','-30 days')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) AS attempts,SUM(CASE WHEN qa_status='approved' THEN 1 ELSE 0 END) AS approved FROM concept_images WHERE tenant_id=? AND created_at>=datetime('now','-30 days')`).bind(tenantId).first().catch(()=>({attempts:0,approved:0}))
  ]);
  const stageCounts=Object.fromEntries((stages.results||[]).map(r=>[r.stage,Number(r.count||0)])),jobCounts=Object.fromEntries((jobs.results||[]).map(r=>[r.status,Number(r.count||0)]));
  const calls=Number(usageStats?.calls||0),hits=Number(usageStats?.cache_hits||0),synced=Number(billing?.synced||0),customerTotal=Number(customerStats?.total||0);
  return json({ok:true,prospects:{total:Number(prospectStats?.total||0),stage_counts:stageCounts,open:(stageCounts.Qualified||0)+(stageCounts['Concept Built']||0)+(stageCounts.Contacted||0)+(stageCounts['Concept Viewed']||0),overdue_followups:Number(prospectStats?.overdue||0),research_failures:Number(prospectStats?.research_failures||0),build_failures:Number(prospectStats?.build_failures||0),generic_fallbacks:Number(prospectStats?.fallbacks||0)},customers:{total:customerTotal,in_production:Number(customerStats?.production||0),payment_issues:Number(customerStats?.payment_issues||0),priority:priority.results||[]},billing:{actual_mrr_cents:Number(billing?.actual_mrr_cents||0),past_due:Number(billing?.past_due||0),synced_customers:synced,unsynced_customers:Math.max(0,customerTotal-synced)},jobs:{counts:jobCounts},efficiency:{provider_calls_30d:calls,cache_hits_30d:hits,cache_hit_rate:calls?Number((hits/calls*100).toFixed(1)):0,google_calls_30d:Number(usageStats?.google_calls||0),openai_calls_30d:Number(usageStats?.openai_calls||0),image_attempts_30d:Number(imageStats?.attempts||0),approved_images_30d:Number(imageStats?.approved||0)},activity:activity.results||[]});
}

export default{async fetch(request,env,context){
  const url=new URL(request.url);
  try{
    if(url.pathname==='/api/admin/dashboard-summary'&&request.method==='GET')return dashboardSummary(request,env);
    const r=url.pathname.match(RESEARCH_RE);if(r&&request.method==='POST')return handleResearch(request,env,Number(r[1]));
    const b=url.pathname.match(BUILD_RE);if(b&&request.method==='POST')return handleBuild(request,env,Number(b[1]));
    const billing=url.pathname.match(BILLING_RE);if(billing&&request.method==='GET')return handleBilling(request,env,Number(billing[1]));
    if(url.pathname==='/api/stripe/webhook'&&request.method==='POST'){
      await ensurePlatformSchema(env);const copy=request.clone(),response=await appWorker.fetch(request,env,context);
      if(response.ok){try{await syncWebhookSnapshot(env,JSON.parse(await copy.text()))}catch(e){console.warn('Billing snapshot webhook sync skipped',clean(e?.message||e,300))}}
      return response;
    }
    if(url.pathname==='/api/admin/prospects'&&request.method==='POST'){
      await ensurePlatformSchema(env);const user=await actor(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);const tenantId=Number(user.current_tenant_id);if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);const response=await appWorker.fetch(request,env,context);const payload=await response.clone().json().catch(()=>null);
      if(response.ok&&payload?.id)await upsertJob(env,{tenantId,key:`tenant:${tenantId}:automation:${payload.id}`,prospectId:payload.id,type:'prospect_automation',status:'Queued',stage:'Research'});
      return response;
    }
  }catch(error){console.error('Platform hardening layer error',error);return json({ok:false,error:'Platform operation failed.'},500)}
  return appWorker.fetch(request,env,context);
}};
