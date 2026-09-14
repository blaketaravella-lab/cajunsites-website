import authWorker from './auth.js';
import { resolveTenantContext, tenantSettings } from './tenant-context.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

function requestedTenantId(request){
  const header=Number(request.headers.get('x-cajunsites-tenant-id')||0);
  return Number.isInteger(header)&&header>0?header:null;
}

async function baseUser(request,env){
  const response=await authWorker.fetch(request,env);
  if(!response.ok)return {response,user:null};
  const body=await response.clone().json().catch(()=>null);
  return {response,user:body?.user||null};
}

async function organizationAwareMe(request,env){
  if(!env?.DB)return json({ok:false,error:'Customer database is not configured.'},503);
  const {response,user}=await baseUser(request,env);
  if(!user)return response;

  let tenant;
  try{
    tenant=await resolveTenantContext(env,user,requestedTenantId(request));
  }catch(error){
    return json({ok:false,error:error instanceof Error?error.message:'Organization access denied.'},403);
  }

  let settings=null;
  try{settings=await tenantSettings(env,tenant.tenant_id)}catch{}

  return json({
    ok:true,
    user:{
      id:user.id,
      email:user.email,
      name:user.name,
      role:tenant.role,
      identity_role:user.role,
    },
    organization:{
      id:tenant.tenant_id,
      name:tenant.tenant_name,
      slug:tenant.tenant_slug,
      role:tenant.role,
      plan_code:settings?.plan_code||null,
      branding:{
        display_name:settings?.display_name||tenant.tenant_name,
        logo_url:settings?.logo_url||null,
        primary_color:settings?.primary_color||null,
        accent_color:settings?.accent_color||null,
        website_url:settings?.website_url||null,
      },
      settings:{
        launch_fee_cents:Number(settings?.launch_fee_cents||0),
        hosting_fee_cents:Number(settings?.hosting_fee_cents||0),
        currency:settings?.currency||'usd',
        concept_domain:settings?.concept_domain||null,
        sender_name:settings?.sender_name||null,
        onboarding_complete:Boolean(settings?.onboarding_complete),
      },
    },
    authorization:{
      tenant_id:tenant.tenant_id,
      role:tenant.role,
      can_mutate:['owner','admin','operator'].includes(tenant.role),
      can_administer:['owner','admin'].includes(tenant.role),
      is_owner:tenant.role==='owner',
    },
  });
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/api/admin/me'&&request.method==='GET')return organizationAwareMe(request,env);
    return authWorker.fetch(request,env);
  }
};
