import conceptWorker from './concept-factory.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

function sameOriginMutation(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function ensureConversionSchema(env) {
  if (!env.DB) return;
  const alters = [
    'ALTER TABLE prospects ADD COLUMN customer_id INTEGER',
    'ALTER TABLE prospects ADD COLUMN converted_at TEXT',
    'ALTER TABLE prospects ADD COLUMN checkout_started_at TEXT',
    'ALTER TABLE customers ADD COLUMN source_prospect_id INTEGER',
    'ALTER TABLE customers ADD COLUMN billing_status TEXT',
    'ALTER TABLE customers ADD COLUMN subscription_status TEXT',
    'ALTER TABLE customers ADD COLUMN payment_issue_previous_status TEXT',
    'ALTER TABLE customers ADD COLUMN last_payment_failed_at TEXT',
    'ALTER TABLE customers ADD COLUMN last_payment_recovered_at TEXT',
    'ALTER TABLE customers ADD COLUMN last_refund_at TEXT',
  ];
  for (const sql of alters) {
    try { await env.DB.prepare(sql).run(); } catch (error) {
      if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
    }
  }
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_customer_id ON prospects(customer_id) WHERE customer_id IS NOT NULL').run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_source_prospect ON customers(source_prospect_id) WHERE source_prospect_id IS NOT NULL').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_sites (
    customer_id INTEGER PRIMARY KEY, domain TEXT, preview_url TEXT, production_url TEXT, template_key TEXT, internal_notes TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, event_type TEXT NOT NULL, description TEXT NOT NULL,
    metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function currentUser(request, env) {
  const url = new URL(request.url), headers = new Headers(), cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const response = await conceptWorker.fetch(new Request(new URL('/api/admin/me', url.origin), { method: 'GET', headers }), env);
  if (!response.ok) return null;
  return (await response.json().catch(() => null))?.user || null;
}

async function recordActivity(env, customerId, eventType, description, metadata = {}) {
  try {
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(customerId || null, clean(eventType, 80), clean(description, 1000), JSON.stringify(metadata)).run();
  } catch (error) { console.warn('Conversion activity logging unavailable', error instanceof Error ? error.message : String(error)); }
}

async function insertConvertedCustomer(env, prospect) {
  const businessName = clean(prospect.business_name, 160);
  const customerName = clean(prospect.contact_name, 120);
  const email = clean(prospect.email, 254).toLowerCase();
  const baseSql = `INSERT INTO customers (
    stripe_customer_id,stripe_checkout_session_id,stripe_subscription_id,payment_link_id,
    customer_name,business_name,email,status,onboarding_completed,welcome_email_sent,
    source_prospect_id,billing_status,subscription_status,created_at,updated_at
  ) VALUES (NULL,?,NULL,NULL,?,?,?,'Ready to Build',0,0,?,'Not Configured',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;

  try {
    const result = await env.DB.prepare(baseSql)
      .bind(null, customerName || null, businessName, email, prospect.id).run();
    return Number(result.meta?.last_row_id || 0);
  } catch (error) {
    // Older production databases required stripe_checkout_session_id. A clearly
    // internal compatibility key keeps direct conversion working without
    // creating or invoking any Stripe Checkout Session.
    if (!/NOT NULL constraint failed:\s*customers\.stripe_checkout_session_id/i.test(String(error?.message || error))) throw error;
    const compatibilityKey = `direct_conversion_${prospect.id}_${crypto.randomUUID()}`;
    const result = await env.DB.prepare(baseSql)
      .bind(compatibilityKey, customerName || null, businessName, email, prospect.id).run();
    return Number(result.meta?.last_row_id || 0);
  }
}

async function promoteConceptSite(env, customerId, prospect) {
  const conceptUrl = clean(prospect.concept_url, 1000);
  if (!conceptUrl) throw new Error('Prospect must have a concept site before conversion.');
  const templateKey = clean(prospect.concept_visual_family || prospect.visual_family || '', 120) || null;
  const note = `Promoted from prospect #${prospect.id} concept site during customer conversion.`;
  await env.DB.prepare(`INSERT INTO customer_sites (customer_id,preview_url,template_key,internal_notes,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(customer_id) DO UPDATE SET
      preview_url=excluded.preview_url,
      template_key=COALESCE(customer_sites.template_key,excluded.template_key),
      internal_notes=CASE
        WHEN COALESCE(customer_sites.internal_notes,'')='' THEN excluded.internal_notes
        ELSE customer_sites.internal_notes || '\n' || excluded.internal_notes
      END,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(customerId, conceptUrl, templateKey, note).run();
}

async function convertProspectToCustomer(request, env, prospectId) {
  if (!env.DB) return json({ ok:false,error:'Customer database is not configured.' },503);
  if (!sameOriginMutation(request)) return json({ ok:false,error:'Invalid request origin.' },403);
  const user = await currentUser(request, env);
  if (!user) return json({ ok:false,error:'Authentication required.' },401);
  if (user.role === 'read_only') return json({ ok:false,error:'Your role is read only.' },403);

  await ensureConversionSchema(env);
  const prospect = await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(prospectId).first();
  if (!prospect) return json({ ok:false,error:'Prospect not found.' },404);

  if (prospect.customer_id) {
    return json({
      ok:true,
      already_converted:true,
      customer_id:Number(prospect.customer_id),
      customer_url:`/admin/?customer=${Number(prospect.customer_id)}`,
    });
  }

  if (!clean(prospect.concept_url, 1000)) {
    return json({ ok:false,error:'Build a concept site before converting this prospect to a customer.' },409);
  }

  const existingCustomer = await env.DB.prepare('SELECT id FROM customers WHERE source_prospect_id=? LIMIT 1').bind(prospect.id).first();
  let customerId = Number(existingCustomer?.id || 0);
  if (!customerId) customerId = await insertConvertedCustomer(env, prospect);
  if (!customerId) throw new Error('Customer record could not be created.');

  await promoteConceptSite(env, customerId, prospect);
  await env.DB.prepare(`UPDATE prospects SET
    customer_id=?,
    stage='Won',
    outcome='Converted to customer',
    converted_at=COALESCE(converted_at,CURRENT_TIMESTAMP),
    checkout_started_at=NULL,
    updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(customerId, prospect.id).run();

  if (clean(prospect.notes, 4000)) {
    try {
      await env.DB.prepare(`INSERT INTO customer_notes (customer_id,note,created_at) VALUES (?,?,CURRENT_TIMESTAMP)`)
        .bind(customerId, `Sales notes carried forward from prospect:\n${clean(prospect.notes, 4000)}`).run();
    } catch (error) {
      console.warn('Could not carry prospect notes into customer record', error instanceof Error ? error.message : String(error));
    }
  }

  await recordActivity(env, customerId, 'prospect_converted', `${prospect.business_name} converted from prospect to customer`, {
    prospect_id:prospect.id,
    customer_id:customerId,
    concept_url:prospect.concept_url,
    billing_started:false,
    actor:{id:user.id,name:user.name,email:user.email,role:user.role},
  });

  return json({
    ok:true,
    customer_id:customerId,
    prospect_id:prospect.id,
    concept_url:prospect.concept_url,
    customer_url:`/admin/?customer=${customerId}`,
    billing_started:false,
  });
}

async function findCustomerForStripeObject(env, obj) {
  const stripeCustomer = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
  const subscription = typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id || (obj?.object === 'subscription' ? obj.id : null);
  if (subscription) {
    const row = await env.DB.prepare('SELECT * FROM customers WHERE stripe_subscription_id=? LIMIT 1').bind(subscription).first();
    if (row) return row;
  }
  if (stripeCustomer) return env.DB.prepare('SELECT * FROM customers WHERE stripe_customer_id=? ORDER BY id DESC LIMIT 1').bind(stripeCustomer).first();
  return null;
}

async function markPaymentIssue(env, customer, reason, subscriptionStatus = null) {
  if (!customer) return;
  await env.DB.prepare(`UPDATE customers SET payment_issue_previous_status=CASE WHEN status<>'Payment Issue' THEN status ELSE payment_issue_previous_status END,status='Payment Issue',billing_status=?,subscription_status=COALESCE(?,subscription_status),last_payment_failed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(reason, subscriptionStatus, customer.id).run();
  await recordActivity(env,customer.id,'billing_payment_failed',`${customer.business_name||customer.email} has a Stripe payment issue`,{billing_status:reason,subscription_status:subscriptionStatus,actor:{name:'Stripe webhook',role:'system'}});
}

async function markPaymentRecovered(env, customer, subscriptionStatus = null) {
  if (!customer) return;
  const restore = customer.status === 'Payment Issue' ? (customer.payment_issue_previous_status || 'Active Customer') : customer.status;
  await env.DB.prepare(`UPDATE customers SET status=?,payment_issue_previous_status=NULL,billing_status='Current',subscription_status=COALESCE(?,subscription_status),last_payment_recovered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(restore, subscriptionStatus, customer.id).run();
  await recordActivity(env,customer.id,'billing_payment_recovered',`${customer.business_name||customer.email} payment status recovered`,{restored_status:restore,subscription_status:subscriptionStatus,actor:{name:'Stripe webhook',role:'system'}});
}

async function synchronizeStripeLifecycle(event, env) {
  if (!env.DB) return;
  await ensureConversionSchema(env);
  const type = event?.type || '', obj = event?.data?.object || {};
  if (!['invoice.payment_failed','invoice.paid','invoice.payment_succeeded','customer.subscription.updated','customer.subscription.deleted','charge.refunded'].includes(type)) return;
  const customer = await findCustomerForStripeObject(env,obj);
  if (!customer) { console.warn('Stripe lifecycle event did not match a CajunSites customer',{type,id:obj?.id||null}); return; }

  if (type === 'invoice.payment_failed') return markPaymentIssue(env,customer,'Payment Failed',obj?.parent?.subscription_details?.subscription ? null : customer.subscription_status);
  if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') return markPaymentRecovered(env,customer,customer.subscription_status || 'active');
  if (type === 'customer.subscription.deleted') {
    await env.DB.prepare(`UPDATE customers SET status='Cancelled',billing_status='Cancelled',subscription_status='canceled',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(customer.id).run();
    await recordActivity(env,customer.id,'subscription_cancelled',`${customer.business_name||customer.email} subscription was cancelled in Stripe`,{subscription_id:obj.id,actor:{name:'Stripe webhook',role:'system'}});return;
  }
  if (type === 'customer.subscription.updated') {
    const status=clean(obj.status,50)||'unknown';
    await env.DB.prepare('UPDATE customers SET subscription_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,customer.id).run();
    if (['past_due','unpaid','incomplete_expired','paused'].includes(status)) return markPaymentIssue(env,{...customer,subscription_status:status},`Subscription ${status}`,status);
    if (['active','trialing'].includes(status) && customer.status==='Payment Issue') return markPaymentRecovered(env,customer,status);
    return;
  }
  if (type === 'charge.refunded') {
    await env.DB.prepare(`UPDATE customers SET last_refund_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(customer.id).run();
    await recordActivity(env,customer.id,'payment_refunded',`${customer.business_name||customer.email} received a Stripe refund`,{charge_id:obj.id,amount_refunded:obj.amount_refunded||null,refunded:Boolean(obj.refunded),actor:{name:'Stripe webhook',role:'system'}});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const conversionMatch = url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/(?:convert|convert-checkout)$/);
    if (conversionMatch) {
      if (request.method !== 'POST') return json({ ok:false,error:'Method not allowed.' },405);
      try { return await convertProspectToCustomer(request, env, Number(conversionMatch[1])); }
      catch (error) { console.error('Prospect conversion failed', error); return json({ ok:false,error:'Could not convert prospect to customer.' },500); }
    }

    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      const copy = request.clone();
      const rawBodyPromise = copy.text();
      const response = await conceptWorker.fetch(request, env);
      if (!response.ok) return response;
      try {
        const event = JSON.parse(await rawBodyPromise);
        await synchronizeStripeLifecycle(event, env);
      } catch (error) {
        console.error('Post-verification Stripe synchronization failed', error);
        return json({ok:false,error:'Webhook synchronization failed.'},500);
      }
      return response;
    }

    if (url.pathname.startsWith('/api/admin/prospects')) {
      try { await ensureConversionSchema(env); } catch (error) { console.error('Conversion schema setup failed', error); }
    }
    return conceptWorker.fetch(request, env);
  },
};
