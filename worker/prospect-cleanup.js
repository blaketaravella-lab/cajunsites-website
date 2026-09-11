import verticalWorker from './vertical-concepts.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const DNS_API='https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_PROJECT='cajun-sites-prospect-websites';
const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);

function slugify(v){return clean(v,200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,63)}
function vq(env){const p=new URLSearchParams();if(env.VERCEL_TEAM_ID)p.set('teamId',env.VERCEL_TEAM_ID);return p.toString()?`?${p}`:''}
async function currentUser(request,env){const url=new URL(request.url),headers=new Headers(),cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const r=await verticalWorker.fetch(new Request(new URL('/api/admin/me',url.origin),{method:'GET',headers}),env);if(!r.ok)return null;return (await r.json().catch(()=>null))?.user||null}
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

export default{async fetch(request,env){const url=new URL(request.url),m=url.pathname.match(/^\/api\/admin\/prospects\/(\d+)$/);if(m&&request.method==='DELETE'){
  if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  const user=await currentUser(request,env);if(!user)return json({ok:false,error:'Authentication required.'},401);if(!['owner','admin'].includes(user.role))return json({ok:false,error:'Admin access is required to remove prospects.'},403);
  const p=await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(Number(m[1])).first();if(!p)return json({ok:false,error:'Prospect not found.'},404);
  if(p.customer_id)return json({ok:false,error:'This prospect is linked to a customer and cannot be removed from the prospect pipeline. Manage the customer record instead.'},409);
  try{const cleanup=await cleanupProspect(env,p);const response=await verticalWorker.fetch(request,env);if(!response.ok)return response;const data=await response.json().catch(()=>({ok:true}));return json({...data,cleanup});}catch(e){console.error('Prospect cleanup failed',e);return json({ok:false,error:`Prospect was not removed because related asset cleanup failed: ${clean(e?.message||e,500)}`},502)}
}
return verticalWorker.fetch(request,env)}};
