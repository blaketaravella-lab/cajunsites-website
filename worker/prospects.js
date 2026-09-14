import authWorker from './auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const PROSPECT_STAGES = ['Qualified','Concept Built','Contacted','Concept Viewed','Won','Lost'];
const CALL_RESULTS = ['No Answer','Left Voicemail','Gatekeeper','Decision Maker Unavailable','Wrong Number','Call Back Requested','Send Concept','Concept Viewed','Interested','Demonstration Scheduled','Not Interested','Already Solved','Do Not Contact','Won','Lost'];

function sameOriginMutation(request) {
  if (!['POST','PATCH','PUT','DELETE'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function currentUser(request, env) {
  const url = new URL(request.url), headers = new Headers(), cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const response = await authWorker.fetch(new Request(new URL('/api/admin/me', url.origin), { method: 'GET', headers }), env);
  if (!response.ok) return null;
  return (await response.json().catch(() => null))?.user || null;
}

async function ensureSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    category TEXT,
    city TEXT,
    state TEXT,
    concept_url TEXT,
    stage TEXT NOT NULL DEFAULT 'Qualified',
    qualification TEXT,
    website_gate TEXT,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    call_attempts INTEGER NOT NULL DEFAULT 0,
    decision_maker_reached INTEGER NOT NULL DEFAULT 0,
    concept_viewed INTEGER NOT NULL DEFAULT 0,
    next_follow_up TEXT,
    outcome TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prospects_business ON prospects(business_name)').run();
  const alters=[
    "ALTER TABLE prospects ADD COLUMN outreach_status TEXT NOT NULL DEFAULT 'Ready to Call'",
    'ALTER TABLE prospects ADD COLUMN last_call_at TEXT','ALTER TABLE prospects ADD COLUMN last_call_result TEXT',
    'ALTER TABLE prospects ADD COLUMN last_contacted_at TEXT','ALTER TABLE prospects ADD COLUMN last_email_at TEXT',
    'ALTER TABLE prospects ADD COLUMN last_email_id TEXT','ALTER TABLE prospects ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE prospects ADD COLUMN outreach_unsubscribe_token TEXT'
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run()}catch(error){if(!/duplicate column|already exists/i.test(String(error?.message||error)))throw error}}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS prospect_outreach_events (id INTEGER PRIMARY KEY AUTOINCREMENT,prospect_id INTEGER NOT NULL,channel TEXT NOT NULL,event_type TEXT NOT NULL,result TEXT,notes TEXT,provider_id TEXT,metadata_json TEXT,created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_outreach_events_prospect ON prospect_outreach_events(prospect_id,created_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_outreach_events_provider ON prospect_outreach_events(provider_id)').run();
}

async function outreachEvent(env,user,id,channel,eventType,result='',notes='',providerId=null,metadata={}){
  await env.DB.prepare(`INSERT INTO prospect_outreach_events (prospect_id,channel,event_type,result,notes,provider_id,metadata_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(id,channel,eventType,clean(result,120)||null,clean(notes,4000)||null,providerId,JSON.stringify(metadata||{}),user?.id||null).run();
}

async function listOutreach(env){
  await ensureSchema(env);
  const prospects=await env.DB.prepare(`SELECT * FROM prospects WHERE customer_id IS NULL ORDER BY CASE WHEN next_follow_up IS NOT NULL AND date(next_follow_up)<=date('now') THEN 0 WHEN concept_url IS NOT NULL AND COALESCE(call_attempts,0)=0 THEN 1 ELSE 2 END,COALESCE(next_follow_up,'9999-12-31'),id DESC`).all();
  const events=await env.DB.prepare(`SELECT e.*,p.business_name FROM prospect_outreach_events e JOIN prospects p ON p.id=e.prospect_id ORDER BY e.id DESC LIMIT 250`).all();
  return json({ok:true,prospects:prospects.results||[],events:events.results||[],call_results:CALL_RESULTS,email_enabled:env.OUTREACH_EMAIL_ENABLED==='true'&&Boolean(env.RESEND_API_KEY)&&Boolean(clean(env.OUTREACH_POSTAL_ADDRESS,500))});
}

function callOutcome(result,existing){
  const reached=['Send Concept','Concept Viewed','Interested','Demonstration Scheduled','Not Interested','Already Solved','Won','Lost'].includes(result);
  const viewed=['Concept Viewed','Interested','Demonstration Scheduled','Won'].includes(result);
  const stage=result==='Won'?'Won':result==='Lost'||['Not Interested','Already Solved','Do Not Contact'].includes(result)?'Lost':viewed?'Concept Viewed':reached?'Contacted':existing.stage;
  const status=result==='Do Not Contact'?'Do Not Contact':result==='Won'?'Won':stage==='Lost'?'Closed':result;
  return {reached,viewed,stage,status};
}

async function recordCall(request,env,user,id){
  if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? AND customer_id IS NULL LIMIT 1').bind(id).first();
  if(!p)return json({ok:false,error:'Active prospect not found.'},404);
  let data;try{data=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}
  const result=clean(data.result,120);if(!CALL_RESULTS.includes(result))return json({ok:false,error:'Select a valid call result.'},400);
  const outcome=callOutcome(result,p),followup=clean(data.next_follow_up,80)||null,notes=clean(data.notes,4000);
  await env.DB.prepare(`UPDATE prospects SET call_attempts=COALESCE(call_attempts,0)+1,last_call_at=CURRENT_TIMESTAMP,last_contacted_at=CURRENT_TIMESTAMP,last_call_result=?,outreach_status=?,stage=?,decision_maker_reached=?,concept_viewed=?,next_follow_up=?,outcome=?,do_not_contact=?,notes=CASE WHEN ?='' THEN notes WHEN notes IS NULL OR notes='' THEN ? ELSE notes||char(10)||? END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(result,outcome.status,outcome.stage,outcome.reached?1:Number(p.decision_maker_reached||0),outcome.viewed?1:Number(p.concept_viewed||0),followup,result,result==='Do Not Contact'?1:Number(p.do_not_contact||0),notes,notes,notes,id).run();
  await outreachEvent(env,user,id,'call','call_completed',result,notes,null,{next_follow_up:followup});
  await recordActivity(env,user,`${user.name} recorded ${result} for ${p.business_name}`,{prospect_id:id,channel:'call',result});
  return json({ok:true});
}

function emailAddressValid(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function htmlEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function sendConceptEmail(request,env,user,id){
  if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  if(env.OUTREACH_EMAIL_ENABLED!=='true')return json({ok:false,error:'Prospect email outreach is currently disabled.'},403);
  if(!env.RESEND_API_KEY)return json({ok:false,error:'Resend is not configured.'},503);
  if(!clean(env.OUTREACH_POSTAL_ADDRESS,500))return json({ok:false,error:'OUTREACH_POSTAL_ADDRESS must be configured before commercial outreach can be sent.'},503);
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? AND customer_id IS NULL LIMIT 1').bind(id).first();
  if(!p)return json({ok:false,error:'Active prospect not found.'},404);
  if(p.do_not_contact)return json({ok:false,error:'This prospect is marked Do Not Contact.'},409);
  if(!p.concept_url)return json({ok:false,error:'Publish the concept before sending it.'},409);
  if(!emailAddressValid(clean(p.email,255)))return json({ok:false,error:'A valid prospect email is required.'},400);
  let data;try{data=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}
  const subject=clean(data.subject,200),message=clean(data.message,6000);if(!subject||!message)return json({ok:false,error:'Subject and message are required.'},400);
  const token=p.outreach_unsubscribe_token||crypto.randomUUID().replaceAll('-','');
  if(!p.outreach_unsubscribe_token)await env.DB.prepare('UPDATE prospects SET outreach_unsubscribe_token=? WHERE id=?').bind(token,id).run();
  const unsubscribe=`https://cajunsites.com/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
  const footer=`CajunSites | ${clean(env.OUTREACH_POSTAL_ADDRESS,500)}\nUnsubscribe: ${unsubscribe}`;
  const text=`${message}\n\n${footer}`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#26212a;max-width:640px">${htmlEscape(message).replace(/\n/g,'<br>')}<hr style="border:0;border-top:1px solid #e5e1e7;margin:28px 0 16px"><p style="font-size:12px;color:#716a75">CajunSites<br>${htmlEscape(env.OUTREACH_POSTAL_ADDRESS)}<br><a href="${htmlEscape(unsubscribe)}">Unsubscribe from future outreach</a></p></div>`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':`cajunsites-outreach-${id}-${crypto.randomUUID()}`},body:JSON.stringify({from:clean(env.OUTREACH_FROM_EMAIL,255)||'Cooper at CajunSites <hello@cajunsites.com>',to:[p.email],reply_to:clean(env.OUTREACH_REPLY_TO,255)||'hello@cajunsites.com',subject,text,html,headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}})});
  if(!response.ok){const body=await response.text();return json({ok:false,error:`Resend rejected the email (${response.status}): ${clean(body,800)}`},502)}
  const sent=await response.json();
  await env.DB.prepare(`UPDATE prospects SET last_email_at=CURRENT_TIMESTAMP,last_contacted_at=CURRENT_TIMESTAMP,last_email_id=?,outreach_status='Concept Emailed',stage=CASE WHEN stage IN ('Qualified','Concept Built') THEN 'Contacted' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(sent.id||null,id).run();
  await outreachEvent(env,user,id,'email','sent','Concept Emailed','',sent.id||null,{to:p.email,subject});
  await recordActivity(env,user,`${user.name} emailed the concept to ${p.business_name}`,{prospect_id:id,channel:'email',provider_id:sent.id||null});
  return json({ok:true,id:sent.id||null});
}

async function unsubscribe(request,env,url){
  if(!env.DB)return new Response('Unavailable',{status:503});
  await ensureSchema(env);const token=clean(url.searchParams.get('token'),100);
  const p=token?await env.DB.prepare('SELECT id,business_name FROM prospects WHERE outreach_unsubscribe_token=? LIMIT 1').bind(token).first():null;
  if(!p)return new Response('This unsubscribe link is invalid or expired.',{status:404,headers:{'content-type':'text/plain; charset=utf-8'}});
  if(request.method==='POST'){
    await env.DB.prepare(`UPDATE prospects SET do_not_contact=1,outreach_status='Do Not Contact',next_follow_up=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.id).run();
    await outreachEvent(env,null,p.id,'email','unsubscribed','Do Not Contact');
    return new Response('Unsubscribed',{headers:{'content-type':'text/plain; charset=utf-8'}});
  }
  return new Response(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Unsubscribe | CajunSites</title><body style="font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:20px"><h1>Stop CajunSites outreach?</h1><p>This will prevent future prospecting messages to this address.</p><form method="post"><button style="padding:12px 18px">Unsubscribe</button></form></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});
}

async function recordActivity(env, user, description, metadata = null) {
  try {
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,'prospect_updated',?,?,CURRENT_TIMESTAMP)`)
      .bind(description, JSON.stringify({ ...(metadata || {}), actor: user ? { id:user.id,name:user.name,email:user.email,role:user.role } : null })).run();
  } catch {}
}

async function listProspects(env, url) {
  await ensureSchema(env);
  const includeConverted = url.searchParams.get('include_converted') === '1';
  const sql = includeConverted ? 'SELECT * FROM prospects ORDER BY id DESC' : 'SELECT * FROM prospects WHERE customer_id IS NULL ORDER BY id DESC';
  const result = await env.DB.prepare(sql).all();
  return json({ ok: true, prospects: result.results || [], stages: PROSPECT_STAGES, include_converted: includeConverted });
}

async function createProspect(request, env, user) {
  if (user.role === 'read_only') return json({ ok:false, error:'Your role is read only.' }, 403);
  let data; try { data = await request.json(); } catch { return json({ ok:false,error:'Invalid request.' },400); }
  const business = clean(data.business_name, 200), city = clean(data.city,120), state = clean(data.state,40);
  const stage = PROSPECT_STAGES.includes(data.stage) ? data.stage : 'Qualified';
  if (!business) return json({ ok:false,error:'Business name is required.' },400);
  if (!city || !state) return json({ ok:false,error:'City and state are required so research can identify the correct business.' },400);
  const result = await env.DB.prepare(`INSERT INTO prospects
    (business_name,category,city,state,concept_url,stage,qualification,website_gate,contact_name,phone,email,call_attempts,decision_maker_reached,concept_viewed,next_follow_up,outcome,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(business,clean(data.category,160)||null,city,state,clean(data.concept_url,1000)||null,stage,clean(data.qualification,40)||null,clean(data.website_gate,200)||null,clean(data.contact_name,160)||null,clean(data.phone,80)||null,clean(data.email,255)||null,Number(data.call_attempts||0),data.decision_maker_reached?1:0,data.concept_viewed?1:0,clean(data.next_follow_up,80)||null,clean(data.outcome,160)||null,clean(data.notes,4000)||null).run();
  await recordActivity(env,user,`${user.name} added prospect ${business}`,{prospect_id:result.meta?.last_row_id||null,identity_anchor:{business_name:business,city,state}});
  return json({ok:true,id:result.meta?.last_row_id||null});
}

async function updateProspect(request, env, user, id) {
  if (user.role === 'read_only') return json({ok:false,error:'Your role is read only.'},403);
  const existing = await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) return json({ok:false,error:'Prospect not found.'},404);
  if (existing.customer_id) return json({ok:false,error:'Converted prospects are preserved as history and cannot be edited from the active prospect workflow.'},409);
  let data; try { data = await request.json(); } catch { return json({ok:false,error:'Invalid request.'},400); }
  const stage = data.stage !== undefined && PROSPECT_STAGES.includes(data.stage) ? data.stage : existing.stage;
  const values = {
    business_name:data.business_name!==undefined?clean(data.business_name,200):existing.business_name,
    category:data.category!==undefined?clean(data.category,160):existing.category,
    city:data.city!==undefined?clean(data.city,120):existing.city,
    state:data.state!==undefined?clean(data.state,40):existing.state,
    concept_url:data.concept_url!==undefined?clean(data.concept_url,1000):existing.concept_url,
    stage,
    qualification:data.qualification!==undefined?clean(data.qualification,40):existing.qualification,
    website_gate:data.website_gate!==undefined?clean(data.website_gate,200):existing.website_gate,
    contact_name:data.contact_name!==undefined?clean(data.contact_name,160):existing.contact_name,
    phone:data.phone!==undefined?clean(data.phone,80):existing.phone,
    email:data.email!==undefined?clean(data.email,255):existing.email,
    call_attempts:data.call_attempts!==undefined?Math.max(0,Number(data.call_attempts)||0):existing.call_attempts,
    decision_maker_reached:data.decision_maker_reached!==undefined?(data.decision_maker_reached?1:0):existing.decision_maker_reached,
    concept_viewed:data.concept_viewed!==undefined?(data.concept_viewed?1:0):existing.concept_viewed,
    next_follow_up:data.next_follow_up!==undefined?clean(data.next_follow_up,80):existing.next_follow_up,
    outcome:data.outcome!==undefined?clean(data.outcome,160):existing.outcome,
    notes:data.notes!==undefined?clean(data.notes,4000):existing.notes,
  };
  if (!values.business_name) return json({ok:false,error:'Business name is required.'},400);
  await env.DB.prepare(`UPDATE prospects SET business_name=?,category=?,city=?,state=?,concept_url=?,stage=?,qualification=?,website_gate=?,contact_name=?,phone=?,email=?,call_attempts=?,decision_maker_reached=?,concept_viewed=?,next_follow_up=?,outcome=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(values.business_name,values.category||null,values.city||null,values.state||null,values.concept_url||null,values.stage,values.qualification||null,values.website_gate||null,values.contact_name||null,values.phone||null,values.email||null,values.call_attempts,values.decision_maker_reached,values.concept_viewed,values.next_follow_up||null,values.outcome||null,values.notes||null,id).run();
  await recordActivity(env,user,`${user.name} updated prospect ${values.business_name}`,{prospect_id:id,from_stage:existing.stage,to_stage:values.stage});
  return json({ok:true});
}

async function deleteProspect(env, user, id) {
  if (!['owner','admin'].includes(user.role)) return json({ok:false,error:'Admin access is required to remove prospects.'},403);
  const existing = await env.DB.prepare('SELECT business_name,customer_id FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) return json({ok:false,error:'Prospect not found.'},404);
  if (existing.customer_id) return json({ok:false,error:'Converted prospects are retained as customer history and cannot be removed.'},409);
  await env.DB.prepare('DELETE FROM prospects WHERE id=?').bind(id).run();
  await recordActivity(env,user,`${user.name} removed prospect ${existing.business_name}`,{prospect_id:id});
  return json({ok:true});
}

async function handleProspects(request, env, url) {
  if (!env.DB) return json({ok:false,error:'Customer database is not configured.'},503);
  const user = await currentUser(request, env);
  if (!user) return json({ok:false,error:'Authentication required.'},401);
  if (!sameOriginMutation(request)) return json({ok:false,error:'Invalid request origin.'},403);
  await ensureSchema(env);
  if(url.pathname==='/api/admin/outreach'&&request.method==='GET')return listOutreach(env);
  if (url.pathname === '/api/admin/prospects') {
    if (request.method === 'GET') return listProspects(env,url);
    if (request.method === 'POST') return createProspect(request,env,user);
    return json({ok:false,error:'Method not allowed.'},405);
  }
  const callMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/outreach-call$/);
  if(callMatch&&request.method==='POST')return recordCall(request,env,user,Number(callMatch[1]));
  const emailMatch=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/outreach-email$/);
  if(emailMatch&&request.method==='POST')return sendConceptEmail(request,env,user,Number(emailMatch[1]));
  const match = url.pathname.match(/^\/api\/admin\/prospects\/(\d+)$/);
  if (!match) return json({ok:false,error:'Not found.'},404);
  const id = Number(match[1]);
  if (request.method === 'PATCH') return updateProspect(request,env,user,id);
  if (request.method === 'DELETE') return deleteProspect(env,user,id);
  return json({ok:false,error:'Method not allowed.'},405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname==='/api/outreach/unsubscribe')return unsubscribe(request,env,url);
    if (url.pathname.startsWith('/api/admin/prospects')||url.pathname==='/api/admin/outreach') {
      try { return await handleProspects(request,env,url); }
      catch (error) { console.error('Prospect API failed', error); return json({ok:false,error:'Prospect request failed.'},500); }
    }
    return authWorker.fetch(request, env);
  },
};
