import conceptWorker from './concept-factory.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const PAYMENT_LINK_URL = 'https://buy.stripe.com/8x2aEY3gl3Ev1pQ0St3wQ00';
const PAYMENT_LINK_ID = 'plink_1UETwWINepSxCPJz8VjC4MSO';
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
  ];
  for (const sql of alters) {
    try { await env.DB.prepare(sql).run(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_customer_id ON prospects(customer_id) WHERE customer_id IS NOT NULL').run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_source_prospect ON customers(source_prospect_id) WHERE source_prospect_id IS NOT NULL').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_sites (
    customer_id INTEGER PRIMARY KEY,
    domain TEXT,
    preview_url TEXT,
    production_url TEXT,
    template_key TEXT,
    internal_notes TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function currentUser(request, env) {
  const url = new URL(request.url);
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const response = await conceptWorker.fetch(new Request(new URL('/api/admin/me', url.origin), { method: 'GET', headers }), env);
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.user || null;
}

async function recordActivity(env, customerId, eventType, description, metadata = {}) {
  try {
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(customerId || null, clean(eventType, 80), clean(description, 1000), JSON.stringify(metadata)).run();
  } catch (error) {
    console.warn('Conversion activity logging unavailable', error instanceof Error ? error.message : String(error));
  }
}

async function createConversionCheckout(request, env, prospectId) {
  if (!env.DB) return json({ ok:false,error:'Customer database is not configured.' },503);
  if (!sameOriginMutation(request)) return json({ ok:false,error:'Invalid request origin.' },403);
  const user = await currentUser(request, env);
  if (!user) return json({ ok:false,error:'Authentication required.' },401);
  if (user.role === 'read_only') return json({ ok:false,error:'Your role is read only.' },403);

  await ensureConversionSchema(env);
  const prospect = await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(prospectId).first();
  if (!prospect) return json({ ok:false,error:'Prospect not found.' },404);
  if (prospect.customer_id) {
    return json({ ok:true,already_converted:true,customer_id:prospect.customer_id });
  }

  const params = new URLSearchParams({ client_reference_id: `prospect_${prospect.id}` });
  const email = clean(prospect.email, 254).toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) params.set('prefilled_email', email);
  const checkoutUrl = `${PAYMENT_LINK_URL}?${params.toString()}`;

  await env.DB.prepare('UPDATE prospects SET checkout_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(prospect.id).run();
  await recordActivity(env, null, 'prospect_conversion_started', `${user.name} started Stripe checkout for prospect ${prospect.business_name}`, {
    prospect_id: prospect.id,
    business_name: prospect.business_name,
    actor: { id:user.id,name:user.name,email:user.email,role:user.role },
  });

  return json({ ok:true,checkout_url:checkoutUrl,prospect_id:prospect.id });
}

function parseProspectReference(value) {
  const match = String(value || '').match(/^prospect_(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function finalizeProspectConversionFromWebhook(rawBody, env) {
  if (!env.DB) return;
  let event;
  try { event = JSON.parse(rawBody); } catch { return; }
  if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event?.type)) return;

  const session = event?.data?.object || {};
  const prospectId = parseProspectReference(session.client_reference_id);
  if (!prospectId) return;
  if (session.payment_link !== PAYMENT_LINK_ID || session.payment_status !== 'paid') return;

  await ensureConversionSchema(env);
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE stripe_checkout_session_id=? LIMIT 1').bind(session.id).first();
  if (!customer) {
    console.warn('Prospect conversion customer was not created yet', { prospectId, sessionId: session.id });
    return;
  }
  const prospect = await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(prospectId).first();
  if (!prospect) {
    console.warn('Prospect conversion reference not found', { prospectId, sessionId: session.id });
    return;
  }
  if (prospect.customer_id && Number(prospect.customer_id) !== Number(customer.id)) {
    console.error('Prospect is already linked to a different customer', { prospectId, existingCustomerId: prospect.customer_id, customerId: customer.id });
    return;
  }

  await env.DB.prepare(`UPDATE customers SET
    source_prospect_id=?,
    business_name=CASE WHEN COALESCE(TRIM(business_name),'')='' THEN ? ELSE business_name END,
    customer_name=CASE WHEN COALESCE(TRIM(customer_name),'')='' THEN ? ELSE customer_name END,
    updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(prospect.id, prospect.business_name || null, prospect.contact_name || null, customer.id).run();

  await env.DB.prepare(`UPDATE prospects SET
    customer_id=?,
    stage='Won',
    outcome=CASE WHEN COALESCE(TRIM(outcome),'')='' THEN 'Converted to customer' ELSE outcome END,
    converted_at=COALESCE(converted_at,CURRENT_TIMESTAMP),
    updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(customer.id, prospect.id).run();

  if (clean(prospect.concept_url, 1000)) {
    await env.DB.prepare(`INSERT INTO customer_sites (customer_id,preview_url,updated_at)
      VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET
        preview_url=CASE WHEN COALESCE(customer_sites.preview_url,'')='' THEN excluded.preview_url ELSE customer_sites.preview_url END,
        updated_at=CURRENT_TIMESTAMP`)
      .bind(customer.id, prospect.concept_url).run();
  }

  await recordActivity(env, customer.id, 'prospect_converted', `${prospect.business_name} converted from prospect to paid customer`, {
    prospect_id: prospect.id,
    customer_id: customer.id,
    checkout_session_id: session.id,
    concept_url: prospect.concept_url || null,
    actor: { name: 'Stripe webhook', role: 'system' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const checkoutMatch = url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/convert-checkout$/);
    if (checkoutMatch) {
      if (request.method !== 'POST') return json({ ok:false,error:'Method not allowed.' },405);
      try { return await createConversionCheckout(request, env, Number(checkoutMatch[1])); }
      catch (error) {
        console.error('Prospect conversion checkout failed', error);
        return json({ ok:false,error:'Could not start customer checkout.' },500);
      }
    }

    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      const copy = request.clone();
      const rawBodyPromise = copy.text();
      const response = await conceptWorker.fetch(request, env);
      if (response.ok) {
        try { await finalizeProspectConversionFromWebhook(await rawBodyPromise, env); }
        catch (error) { console.error('Prospect conversion finalization failed', error); }
      }
      return response;
    }

    if (url.pathname.startsWith('/api/admin/prospects')) {
      try { await ensureConversionSchema(env); } catch (error) { console.error('Conversion schema setup failed', error); }
    }

    return conceptWorker.fetch(request, env);
  },
};
