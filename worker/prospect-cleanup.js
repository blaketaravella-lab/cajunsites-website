import conversionWorker from './conversion.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_PROJECT='cajun-sites-prospect-websites';
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);

function slugify(v){return clean(v,200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,63)}
function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
async function currentUser(request,env){const url=new URL(request.url),headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const r=await conversionWorker.fetch(new Request(new URL('/api/admin/me',url.origin),{method:'GET',headers}),env);if(!r.ok)return null;return (await r.json().catch(()=>null))?.user||null}
async function vercelDelete(env,path){const r=await fetch(`https://api.vercel.com${path}${vq(env)}`,{method:'DELETE',headers:{Authorization:`Bearer ${env.VERCEL_API_TOKEN}`,'Content-Type':'application/json'}});if(r.status===404)return {not_found:true};const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||d?.message||`Vercel cleanup failed (${r.status})`);return d}
async function deleteDns(env,slug){const r=await fetch(env.CAJUNSITES_DNS_API_URL||DNS_API,{method:'DELETE',headers:{Authorization:`Bearer ${env.DNS_INTEGRATION_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({name:slug})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||d?.message||`DNS cleanup failed (${r.status})`);return d}
async function cleanupProspect(env,p){
  const hasConcept=Boolean(clean(p.concept_url,1000)||clean(p.concept_deployment_id,255)||clean(p.concept_slug,100)||p.concept_state==='Built');
  if(!hasConcept)return {required:false,slug:null,alias:null,domain:false,deployment:false,dns:false};
  if(!env.VERCEL_API_TOKEN)throw new Error('VERCEL_API_TOKEN is required to remove this prospect because a concept deployment exists.');
  if(!env.DNS_INTEGRATION_API_KEY)throw new Error('DNS_INTEGRATION_API_KEY is required to remove this prospect because a concept hostname exists.');
  const slug=clean(p.concept_slug,100)||slugify(p.business_name),alias=slug?`${slug}.cajunsites.com`:'';
  if(!slug)throw new Error('Could not determine the concept hostname for cleanup.');
  const result={required:true,slug,alias,domain:false,deployment:false,dns:false};
  if(alias){await vercelDelete(env,`/v9/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains/${encodeURIComponent(alias)}`);result.domain=true}
  if(p.concept_deployment_id){await vercelDelete(env,`/v13/deployments/${encodeURIComponent(p.concept_deployment_id)}`);result.deployment=true}
  await deleteDns(env,slug);result.dns=true;
  return result;
}

async function protectAdminPage(request,env,url){
  if(!url.pathname.startsWith('/admin'))return null;
  if(url.pathname==='/admin/login'||url.pathname==='/admin/login/')return env.ASSETS.fetch(request);
  const user=await currentUser(request,env);if(user)return env.ASSETS.fetch(request);
  const login=new URL('/admin/login/',url.origin);login.searchParams.set('next',url.pathname+url.search);return Response.redirect(login.toString(),302);
}

async function ensureLeadSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS website_leads (id INTEGER PRIMARY KEY AUTOINCREMENT,prospect_id INTEGER,name TEXT NOT NULL,business_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,industry TEXT,domain_status TEXT,services TEXT,notes TEXT,source TEXT NOT NULL DEFAULT 'Website Inquiry',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function persistWebsiteLead(env,form){
  if(!env.DB)return;
  const name=clean(form.get('name'),120),business=clean(form.get('business'),160),email=clean(form.get('email'),254),phone=clean(form.get('phone'),80),industry=clean(form.get('industry'),160),domain=clean(form.get('domain'),80),services=clean(form.get('services'),3000),notes=clean(form.get('notes'),3000);
  if(!name||!business||!email)return;
  await ensureLeadSchema(env);
  let prospect=await env.DB.prepare(`SELECT id FROM prospects WHERE lower(business_name)=lower(?) AND lower(COALESCE(email,''))=lower(?) ORDER BY id DESC LIMIT 1`).bind(business,email).first().catch(()=>null);
  if(!prospect){
    const result=await env.DB.prepare(`INSERT INTO prospects (business_name,category,stage,website_gate,contact_name,phone,email,notes,created_at,updated_at) VALUES (?,?,'Qualified','Needs website gate verification',?,?,?, ?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(business,industry||null,name,phone||null,email,`Source: Website Inquiry\nDomain status: ${domain||'Not provided'}\nServices: ${services||'Not provided'}\n${notes||''}`.trim()).run();
    prospect={id:result.meta?.last_row_id||null};
  }
  await env.DB.prepare(`INSERT INTO website_leads (prospect_id,name,business_name,email,phone,industry,domain_status,services,notes,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,'Website Inquiry',CURRENT_TIMESTAMP)`).bind(prospect?.id||null,name,business,email,phone||null,industry||null,domain||null,services||null,notes||null).run();
}

async function adminHealth(request,env){
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);
  let d1=false;try{await env.DB.prepare('SELECT 1 AS ok').first();d1=true}catch{}
  return json({ok:true,services:{d1:{configured:Boolean(env.DB),healthy:d1},stripe_webhook:{configured:Boolean(env.STRIPE_WEBHOOK_SECRET)},resend:{configured:Boolean(env.RESEND_API_KEY)},openai:{configured:Boolean(env.OPENAI_API_KEY)},vercel:{configured:Boolean(env.VERCEL_API_TOKEN)},dns:{configured:Boolean(env.DNS_INTEGRATION_API_KEY)},email_service:{configured:Boolean(env.SEND_EMAIL)},assets:{configured:Boolean(env.ASSETS)},admin_password_pepper:{configured:Boolean(env.ADMIN_PASSWORD_PEPPER||env.ADMIN_DASHBOARD_PASSWORD),dedicated:Boolean(env.ADMIN_PASSWORD_PEPPER)}}});
}

async function adminMetrics(request,env){
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(!env.DB)return json({ok:false,error:'Database unavailable.'},503);
  const prospects=(await env.DB.prepare('SELECT * FROM prospects ORDER BY id DESC').all()).results||[];
  let customers=[];try{customers=(await env.DB.prepare('SELECT * FROM customers ORDER BY id DESC').all()).results||[]}catch{}
  const today=new Date().toISOString().slice(0,10),stageCounts={};for(const p of prospects)stageCounts[p.stage]=(stageCounts[p.stage]||0)+1;
  const overdue=prospects.filter(p=>p.next_follow_up&&p.next_follow_up<today&&!['Won','Lost'].includes(p.stage)).length;
  const buildFailures=prospects.filter(p=>p.concept_state==='Build Failed'||p.concept_build_error).length;
  const researchFailures=prospects.filter(p=>p.research_status==='Failed').length;
  const unpaidCheckout=prospects.filter(p=>p.checkout_started_at&&!p.customer_id&&!['Won','Lost'].includes(p.stage)).length;
  const fallbackConcepts=prospects.filter(p=>Number(p.visual_fallback||0)===1).length;
  const wins=Number(stageCounts.Won||0),lost=Number(stageCounts.Lost||0),closed=wins+lost;
  return json({ok:true,prospects:{total:prospects.length,stage_counts:stageCounts,overdue_followups:overdue,build_failures:buildFailures,research_failures:researchFailures,checkout_started_unpaid:unpaidCheckout,generic_fallbacks:fallbackConcepts,win_rate:closed?Number((wins/closed*100).toFixed(1)):0},customers:{total:customers.length,payment_issues:customers.filter(c=>c.status==='Payment Issue').length,cancelled:customers.filter(c=>c.status==='Cancelled').length,active_mrr_customers:customers.filter(c=>!['Cancelled','Payment Issue'].includes(c.status)&&c.subscription_status!=='canceled').length}});
}

export default{async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname.startsWith('/admin')){const protectedResponse=await protectAdminPage(request,env,url);if(protectedResponse)return protectedResponse;}
  if(url.pathname==='/api/admin/health'&&request.method==='GET')return adminHealth(request,env);
  if(url.pathname==='/api/admin/metrics'&&request.method==='GET')return adminMetrics(request,env);
  if(url.pathname==='/api/lead'&&request.method==='POST'){
    const copy=request.clone(),response=await conversionWorker.fetch(request,env);
    if(response.ok){try{await persistWebsiteLead(env,await copy.formData())}catch(e){console.error('Website lead persistence failed',e)}}
    return response;
  }
  const m=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)$/);if(m&&request.method==='DELETE'){
    if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
    const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(!['owner','admin'].includes(user.role))return json({ok:false,error:'Admin access is required to remove prospects.'},403);
    const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(Number(m[1])).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);
    if(p.customer_id)return json({ok:false,error:'This prospect is linked to a customer and cannot be removed from the prospect pipeline. Manage the customer record instead.'},409);
    try{const cleanup=await cleanupProspect(env,p);const response=await conversionWorker.fetch(request,env);if(!response.ok)return response;const data=await response.json().catch(()=>({ok:true}));return json({...data,cleanup});}catch(e){console.error('Prospect cleanup failed',e);return json({ok:false,error:`Prospect was not removed because related asset cleanup failed: ${clean(e?.message||e,500)}`},502)}
  }
  return conversionWorker.fetch(request,env)
}};
