import appWorker from './billing.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,m=4000)=>String(v??'').trim().slice(0,m);
const CHAT_RE=/^\/api\/admin\/design-chat\/(\d+)$/;
const APPLY_RE=/^\/api\/admin\/design-chat\/(\d+)\/apply\/(\d+)$/;
const RESEARCH_RE=/^\/api\/admin\/prospects\/(\d+)\/research$/;
const MODEL='gpt-5.6-luna';
const ARCHETYPES=['urgent_service','local_service','appointment','destination','showcase','trust_professional','family'];
const MOODS=['calm','warm','bold','clean','premium','trusted','friendly','confident'];
const PROFILE_KEYS=['archetype','mood','image_theme','headline','cta','sections','process','layout','navigation','content_density','services_presentation','trust_strategy','mobile_strategy','imagery_strategy'];

function sameOriginMutation(request){if(!['POST','PATCH','PUT','DELETE'].includes(request.method))return true;const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
function parseJson(v,fallback=null){try{return v?JSON.parse(v):fallback}catch{return fallback}}
function responseText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const parts=[];for(const item of d?.output||[])for(const c of item?.content||[])if(c?.type==='output_text'&&c?.text)parts.push(c.text);return parts.join('\n').trim()}
function parseJsonText(t){const raw=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const first=raw.indexOf('{'),last=raw.lastIndexOf('}');if(first<0||last<first)throw new Error('Design Studio response did not contain JSON.');return JSON.parse(raw.slice(first,last+1))}
function normalizeList(v,maxItems=8,maxLen=100){return Array.isArray(v)?v.map(x=>clean(x,maxLen)).filter(Boolean).slice(0,maxItems):[]}
function normalizeProposal(v){
  if(!v||typeof v!=='object')return null;const out={};
  if(ARCHETYPES.includes(v.archetype))out.archetype=v.archetype;if(MOODS.includes(v.mood))out.mood=v.mood;
  for(const [k,m] of [['image_theme',300],['headline',180],['cta',70],['layout',60],['navigation',80],['content_density',80],['services_presentation',100],['mobile_strategy',100]])if(clean(v[k],m))out[k]=clean(v[k],m);
  for(const [k,n,m] of [['sections',10,80],['process',4,100],['trust_strategy',8,100],['imagery_strategy',8,120]]){const a=normalizeList(v[k],n,m);if(a.length)out[k]=a}
  return Object.keys(out).length?out:null;
}
function mergeProfile(base,proposal){const out={};for(const key of PROFILE_KEYS){if(base&&base[key]!==undefined)out[key]=base[key]}for(const key of PROFILE_KEYS){if(proposal&&proposal[key]!==undefined)out[key]=proposal[key]}return normalizeProposal(out)||{}}

async function ensureSchema(env){
  if(!env.DB)return;
  for(const sql of ['ALTER TABLE prospects ADD COLUMN design_directives_json TEXT','ALTER TABLE prospects ADD COLUMN design_directives_updated_at TEXT','ALTER TABLE prospects ADD COLUMN concept_design_model_json TEXT']){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS design_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    proposal_json TEXT,
    in_scope INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_design_chat_prospect ON design_chat_messages(prospect_id,id)').run();
}

async function currentUser(request,env,context){const url=new URL(request.url),headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const r=await appWorker.fetch(new Request(new URL('/api/admin/me',url.origin),{method:'GET',headers}),env,context);if(!r.ok)return null;return (await r.json().catch(()=>null))?.user||null}
async function prospect(env,tenantId,id){return env.DB.prepare('SELECT * FROM prospects WHERE tenant_id=? AND id=? LIMIT 1').bind(tenantId,id).first()}
async function recentMessages(env,tenantId,id){const r=await env.DB.prepare('SELECT id,role,content,proposal_json,in_scope,applied_at,created_at FROM design_chat_messages WHERE tenant_id=? AND prospect_id=? ORDER BY id DESC LIMIT 60').bind(tenantId,id).all();return (r.results||[]).reverse()}

async function callDesigner(env,p,messages,newMessage){
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured for Design Studio.');
  const research=parseJson(p.research_json,{})||{},verified=parseJson(p.verified_business_profile_json,research.verified_business_profile||{}),strategy=parseJson(p.concept_strategy_json,research.concept_strategy||{}),directives=parseJson(p.design_directives_json,null),compiled=parseJson(p.concept_design_model_json,research.concept_design_model||null),current=directives||compiled||research.design_profile||{};
  const history=messages.slice(-12).map(m=>`${m.role==='assistant'?'Assistant':'User'}: ${clean(m.content,900)}`).join('\n');
  const instructions=`You are CajunSites Design Studio. You edit ONLY the selected prospect's structured public website design model. You may redesign layout, hierarchy, imagery direction, tone, headline presentation, CTA wording, section sequence, service presentation, trust presentation, mobile behavior, and overall visual style. You must preserve verified business truth. Never invent services, products, credentials, awards, warranties, affiliations, results, locations, staff, or other factual claims. Never change CajunSites admin, billing, CRM, users, authentication, infrastructure, code, databases, secrets, integrations, or another client/site. For out-of-scope requests return {"in_scope":false,"reply":"...","proposal":null}. For design requests return ONLY JSON: {"in_scope":true,"reply":"short response","proposal":{"archetype":"allowed value","mood":"allowed value","image_theme":"...","headline":"...","cta":"...","sections":["..."],"process":["..."],"layout":"...","navigation":"...","content_density":"...","services_presentation":"...","trust_strategy":["..."],"mobile_strategy":"...","imagery_strategy":["..."]}}. Allowed archetypes: ${ARCHETYPES.join(', ')}. Allowed moods: ${MOODS.join(', ')}. Proposal must represent the FULL desired design model after the requested adjustment, preserving current settings not asked to change.`;
  const context=`Verified Business Profile:\n${JSON.stringify(verified)}\n\nCurrent Concept Strategy:\n${JSON.stringify(strategy)}\n\nCurrent Design Model:\n${JSON.stringify(current)}\n\nRecent conversation:\n${history||'(none)'}\n\nNew user message: ${clean(newMessage,2000)}`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_DESIGN_MODEL||MODEL,instructions,input:context})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||`Design Studio request failed (${r.status})`);
  const parsed=parseJsonText(responseText(d)),inScope=parsed?.in_scope===true,reply=clean(parsed?.reply,inScope?1800:900)||'I can only help adjust the selected website concept design.';
  return{in_scope:inScope,reply,proposal:inScope?normalizeProposal(parsed?.proposal):null};
}

async function listChat(env,tenantId,id){const p=await prospect(env,tenantId,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);const research=parseJson(p.research_json,{})||{};return json({ok:true,prospect:{id:p.id,business_name:p.business_name,category:p.business_vertical||p.category||null,city:p.city||null,state:p.state||null,research_status:p.research_status||'Not Run',concept_state:p.concept_state||'Not Built',concept_url:p.concept_url||null},current_design:parseJson(p.design_directives_json,null)||parseJson(p.concept_design_model_json,null)||research.concept_design_model||research.design_profile||null,concept_strategy:parseJson(p.concept_strategy_json,research.concept_strategy||null),verified_business_profile:parseJson(p.verified_business_profile_json,research.verified_business_profile||null),messages:await recentMessages(env,tenantId,id),guardrails:{scope:'Selected public website concept design only',business_truth_locked:true,dashboard_changes:false,code_execution:false,arbitrary_mutations:false}})}

async function sendMessage(request,env,user,tenantId,id){if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);let body;try{body=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}const message=clean(body?.message,2000);if(!message)return json({ok:false,error:'Enter a design message.'},400);const p=await prospect(env,tenantId,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);await env.DB.prepare("INSERT INTO design_chat_messages (tenant_id,prospect_id,role,content,in_scope,created_by,created_at) VALUES (?,?,'user',?,1,?,CURRENT_TIMESTAMP)").bind(tenantId,id,message,user.id||null).run();const history=await recentMessages(env,tenantId,id);try{const answer=await callDesigner(env,p,history,message);const result=await env.DB.prepare("INSERT INTO design_chat_messages (tenant_id,prospect_id,role,content,proposal_json,in_scope,created_by,created_at) VALUES (?,?,'assistant',?,?,?,?,CURRENT_TIMESTAMP)").bind(tenantId,id,answer.reply,answer.proposal?JSON.stringify(answer.proposal):null,answer.in_scope?1:0,user.id||null).run();return json({ok:true,message:{id:result.meta?.last_row_id||null,role:'assistant',content:answer.reply,proposal_json:answer.proposal?JSON.stringify(answer.proposal):null,in_scope:answer.in_scope?1:0,applied_at:null}})}catch(e){console.error('Design Studio AI request failed',e);return json({ok:false,error:clean(e?.message||e,800)},502)}}

async function applyStoredDirectivesToResearch(env,tenantId,id,directives=null){
  const p=await prospect(env,tenantId,id);if(!p)return null;const proposal=normalizeProposal(directives||parseJson(p.design_directives_json,null));if(!proposal)return null;const research=parseJson(p.research_json,null);if(!research)return null;
  const original=parseJson(p.concept_design_model_json,null)||research.concept_design_model||research.research_design_profile||research.design_profile||{},merged=mergeProfile(original,proposal),next={...research,research_design_profile:research.research_design_profile||research.design_profile||null,concept_design_model:merged,design_profile:merged,design_profile_origin:'design_studio'};
  await env.DB.prepare('UPDATE prospects SET research_json=?,design_directives_json=?,concept_design_model_json=?,design_directives_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?').bind(JSON.stringify(next),JSON.stringify(merged),JSON.stringify(merged),tenantId,id).run();return merged;
}

async function applyProposal(request,env,user,context,tenantId,id,messageId){
  if(user.role==='read_only')return json({ok:false,error:'Your role is read only.'},403);
  const row=await env.DB.prepare("SELECT * FROM design_chat_messages WHERE tenant_id=? AND id=? AND prospect_id=? AND role='assistant' LIMIT 1").bind(tenantId,messageId,id).first();if(!row)return json({ok:false,error:'Design proposal not found.'},404);
  const proposal=normalizeProposal(parseJson(row.proposal_json,null));if(!proposal||!row.in_scope)return json({ok:false,error:'This message does not contain an applicable website design proposal.'},409);
  const p=await prospect(env,tenantId,id);if(!p)return json({ok:false,error:'Prospect not found.'},404);if(p.research_status!=='Complete'||!p.research_json)return json({ok:false,error:'Business research must complete before Design Studio can rebuild the concept.'},409);
  const merged=await applyStoredDirectivesToResearch(env,tenantId,id,proposal);await env.DB.prepare('UPDATE design_chat_messages SET applied_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?').bind(tenantId,messageId).run();
  try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,'design_studio',?,?,CURRENT_TIMESTAMP)`).bind(`${user.name} applied Design Studio changes to ${p.business_name}`,JSON.stringify({prospect_id:id,message_id:messageId,design_model:merged,actor:{id:user.id,name:user.name,email:user.email,role:user.role}})).run()}catch{}
  return json({ok:true,design:merged,design_model:merged,design_saved:true,rebuild_required:true,prospect_id:id,message_id:messageId});
}

const worker={async fetch(request,env,context){const url=new URL(request.url),chat=url.pathname.match(CHAT_RE),apply=url.pathname.match(APPLY_RE),research=url.pathname.match(RESEARCH_RE);if(!chat&&!apply){const response=await appWorker.fetch(request,env,context);if(research&&request.method==='POST'&&response.ok&&env.DB){try{await ensureSchema(env);const prospectId=Number(research[1]),owned=await env.DB.prepare('SELECT tenant_id FROM prospects WHERE id=? LIMIT 1').bind(prospectId).first();if(owned)await applyStoredDirectivesToResearch(env,Number(owned.tenant_id),prospectId)}catch(e){console.error('Design Studio directive reapply failed',e)}}return response}if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);if(!sameOriginMutation(request))return json({ok:false,error:'Invalid request origin.'},403);await ensureSchema(env);const user=await currentUser(request,env,context);if(!user)return json({ok:false,error:'Authentication required.'},401);const tenantId=Number(user.current_tenant_id);if(!Number.isInteger(tenantId)||tenantId<=0)return json({ok:false,error:'No active tenant context was found.'},403);if(chat){const id=Number(chat[1]);if(request.method==='GET')return listChat(env,tenantId,id);if(request.method==='POST')return sendMessage(request,env,user,tenantId,id);return json({ok:false,error:'Method not allowed.'},405)}if(apply){if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);return applyProposal(request,env,user,context,tenantId,Number(apply[1]),Number(apply[2]))}return json({ok:false,error:'Not found.'},404)}};

export default worker;
