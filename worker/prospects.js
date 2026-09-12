import authWorker from './auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const PROSPECT_STAGES = ['Qualified','Concept Built','Contacted','Concept Viewed','Won','Lost'];

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
  const sql = includeConverted
    ? 'SELECT * FROM prospects ORDER BY id DESC'
    : 'SELECT * FROM prospects WHERE customer_id IS NULL ORDER BY id DESC';
  const result = await env.DB.prepare(sql).all();
  return json({ ok: true, prospects: result.results || [], stages: PROSPECT_STAGES, include_converted: includeConverted });
}

async function createProspect(request, env, user) {
  if (user.role === 'read_only') return json({ ok:false, error:'Your role is read only.' }, 403);
  let data; try { data = await request.json(); } catch { return json({ ok:false,error:'Invalid request.' },400); }
  const business = clean(data.business_name, 200);
  const stage = PROSPECT_STAGES.includes(data.stage) ? data.stage : 'Qualified';
  if (!business) return json({ ok:false,error:'Business name is required.' },400);
  const result = await env.DB.prepare(`INSERT INTO prospects
    (business_name,category,city,state,concept_url,stage,qualification,website_gate,contact_name,phone,email,call_attempts,decision_maker_reached,concept_viewed,next_follow_up,outcome,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(business,clean(data.category,160)||null,clean(data.city,120)||null,clean(data.state,40)||null,clean(data.concept_url,1000)||null,stage,clean(data.qualification,40)||null,clean(data.website_gate,200)||null,clean(data.contact_name,160)||null,clean(data.phone,80)||null,clean(data.email,255)||null,Number(data.call_attempts||0),data.decision_maker_reached?1:0,data.concept_viewed?1:0,clean(data.next_follow_up,80)||null,clean(data.outcome,160)||null,clean(data.notes,4000)||null).run();
  await recordActivity(env,user,`${user.name} added prospect ${business}`,{prospect_id:result.meta?.last_row_id||null});
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
  if (url.pathname === '/api/admin/prospects') {
    if (request.method === 'GET') return listProspects(env,url);
    if (request.method === 'POST') return createProspect(request,env,user);
    return json({ok:false,error:'Method not allowed.'},405);
  }
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
    if (url.pathname.startsWith('/api/admin/prospects')) {
      try { return await handleProspects(request,env,url); }
      catch (error) { console.error('Prospect API failed', error); return json({ok:false,error:'Prospect request failed.'},500); }
    }
    return authWorker.fetch(request, env);
  },
};
