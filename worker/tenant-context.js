const DEFAULT_TENANT_ID=1;
const clean=(v,m=255)=>String(v??'').trim().slice(0,m);

export async function resolveTenantContext(env,user,requestedTenantId=null){
  if(!env?.DB)throw new Error('Database is not configured.');
  if(!user?.id)throw new Error('Authenticated user is required to resolve tenant context.');

  let tenantId=Number(requestedTenantId||0);
  if(!Number.isInteger(tenantId)||tenantId<=0){
    const membership=await env.DB.prepare(`SELECT tenant_id FROM tenant_memberships WHERE admin_user_id=? AND status='active' ORDER BY tenant_id LIMIT 1`).bind(user.id).first().catch(()=>null);
    tenantId=Number(membership?.tenant_id||DEFAULT_TENANT_ID);
  }

  const membership=await env.DB.prepare(`SELECT tm.tenant_id,tm.role,t.name,t.slug,t.status FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id WHERE tm.admin_user_id=? AND tm.tenant_id=? AND tm.status='active' AND t.status='active' LIMIT 1`).bind(user.id,tenantId).first().catch(()=>null);
  if(!membership)throw new Error('You do not have access to this organization.');

  return Object.freeze({
    tenant_id:Number(membership.tenant_id),
    tenant_name:clean(membership.name),
    tenant_slug:clean(membership.slug),
    role:clean(membership.role)||'operator'
  });
}

export async function tenantSettings(env,tenantId){
  const row=await env.DB.prepare(`SELECT t.id,t.name,t.slug,t.plan_code,s.launch_fee_cents,s.hosting_fee_cents,s.currency,s.concept_domain,s.sender_name,s.sender_email,s.stripe_account_id,s.onboarding_complete,b.display_name,b.logo_url,b.primary_color,b.accent_color,b.website_url FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id=t.id LEFT JOIN tenant_branding b ON b.tenant_id=t.id WHERE t.id=? LIMIT 1`).bind(tenantId).first();
  if(!row)throw new Error('Organization configuration was not found.');
  return row;
}

export function tenantIdOf(record){
  const id=Number(record?.tenant_id||DEFAULT_TENANT_ID);
  return Number.isInteger(id)&&id>0?id:DEFAULT_TENANT_ID;
}

export function assertTenantRecord(record,tenantId,label='Record'){
  if(!record)throw new Error(`${label} was not found.`);
  if(tenantIdOf(record)!==Number(tenantId))throw new Error(`${label} does not belong to this organization.`);
  return record;
}

export async function recordTenantUsage(env,{tenant_id,event_type,quantity=1,provider=null,model=null,estimated_cost_cents=null,prospect_id=null,customer_id=null,build_id=null,metadata=null}){
  if(!env?.DB||!tenant_id||!event_type)return;
  await env.DB.prepare(`INSERT INTO tenant_usage_events (tenant_id,event_type,quantity,provider,model,estimated_cost_cents,prospect_id,customer_id,build_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(Number(tenant_id),clean(event_type,100),Number(quantity)||1,provider?clean(provider,100):null,model?clean(model,150):null,estimated_cost_cents==null?null:Number(estimated_cost_cents),prospect_id||null,customer_id||null,build_id?clean(build_id,255):null,metadata?JSON.stringify(metadata):null).run();
}

export const SAAS_FOUNDATION_VERSION='1.0.0';
