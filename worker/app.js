import baseWorker from './index.js';

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const ADMIN_COOKIE = 'cajunsites_admin';
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const VALID_STATUSES = [
  'Paid - Awaiting Onboarding','Onboarding Received','Waiting on Customer','Ready to Build','Building','Internal QA',
  'Customer Review','Revisions','Approved for Launch','Launching','Live','Active Customer','Payment Issue','Cancelled',
];
const STATUS_TRANSITIONS = {
  'Onboarding Received': ['Waiting on Customer','Ready to Build'],
  'Waiting on Customer': ['Onboarding Received'],
  'Ready to Build': ['Building'],
  'Building': ['Internal QA'],
  'Internal QA': ['Building','Customer Review'],
  'Customer Review': ['Revisions','Approved for Launch'],
  'Revisions': ['Internal QA','Customer Review'],
  'Approved for Launch': ['Launching'],
  'Launching': ['Live'],
  'Live': ['Active Customer'],
};

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function adminSessionToken(secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('cajunsites:admin-session:v1'));
  return bytesToHex(signature);
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function isAdmin(request, env) {
  if (!env.ADMIN_DASHBOARD_PASSWORD) return false;
  const supplied = readCookie(request, ADMIN_COOKIE);
  if (!supplied) return false;
  return constantTimeEqual(supplied, await adminSessionToken(env.ADMIN_DASHBOARD_PASSWORD));
}

async function handleAdminLogin(request, env) {
  if (!env.ADMIN_DASHBOARD_PASSWORD) return json({ ok: false, error: 'Dashboard authentication is not configured.' }, 503);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  if (!constantTimeEqual(String(data.password ?? ''), env.ADMIN_DASHBOARD_PASSWORD)) return json({ ok: false, error: 'Incorrect dashboard password.' }, 401);
  const token = await adminSessionToken(env.ADMIN_DASHBOARD_PASSWORD);
  return json({ ok: true }, 200, { 'set-cookie': `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}` });
}

function handleAdminLogout() {
  return json({ ok: true }, 200, { 'set-cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function recordActivity(env, customerId, eventType, description, metadata = null) {
  try {
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(customerId || null, clean(eventType, 80), clean(description, 1000), metadata ? JSON.stringify(metadata) : null).run();
  } catch (error) {
    console.warn('Admin activity log unavailable', error instanceof Error ? error.message : String(error));
  }
}

async function getCustomer(customerId, env) {
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  return env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(customerId).first();
}

async function handleAdminCustomers(env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);
  try {
    const result = await env.DB.prepare(`
      SELECT c.*, os.payload_json AS onboarding_payload, os.submitted_at AS onboarding_submitted_at,
             cs.domain AS site_domain, cs.preview_url, cs.production_url, cs.template_key, cs.internal_notes AS site_internal_notes
      FROM customers c
      LEFT JOIN onboarding_submissions os ON os.id = (
        SELECT id FROM onboarding_submissions WHERE customer_id = c.id ORDER BY submitted_at DESC, id DESC LIMIT 1
      )
      LEFT JOIN customer_sites cs ON cs.customer_id = c.id
      ORDER BY c.id DESC
    `).all();
    return json({ ok: true, customers: result.results || [] });
  } catch (error) {
    const fallback = await env.DB.prepare(`SELECT c.*, NULL AS onboarding_payload, NULL AS onboarding_submitted_at, NULL AS site_domain, NULL AS preview_url, NULL AS production_url, NULL AS template_key, NULL AS site_internal_notes FROM customers c ORDER BY c.id DESC`).all();
    return json({ ok: true, customers: fallback.results || [], extendedStorageReady: false });
  }
}

async function handleOverview(env) {
  const customersResponse = await handleAdminCustomers(env);
  const body = await customersResponse.json();
  if (!customersResponse.ok) return json(body, customersResponse.status);
  const customers = body.customers || [];
  let activity = [];
  try {
    const result = await env.DB.prepare(`SELECT a.*, c.business_name FROM admin_activity a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY a.id DESC LIMIT 20`).all();
    activity = result.results || [];
  } catch {}
  return json({ ok: true, customers, activity, extendedStorageReady: body.extendedStorageReady !== false });
}

async function handleActivity(env) {
  try {
    const result = await env.DB.prepare(`SELECT a.*, c.business_name, c.email FROM admin_activity a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY a.id DESC LIMIT 100`).all();
    return json({ ok: true, activity: result.results || [] });
  } catch {
    return json({ ok: true, activity: [], storageReady: false });
  }
}

async function updateStatus(customerId, newStatus, env) {
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (!VALID_STATUSES.includes(newStatus)) return json({ ok: false, error: 'Invalid status.' }, 400);
  if (customer.status === newStatus) return json({ ok: true, id: customerId, status: newStatus });

  const normalAllowed = STATUS_TRANSITIONS[customer.status] || [];
  const exceptionAllowed = ['Payment Issue','Cancelled'].includes(newStatus);
  if (!normalAllowed.includes(newStatus) && !exceptionAllowed) {
    return json({ ok: false, error: `Cannot move from ${customer.status} to ${newStatus}.` }, 409);
  }

  await env.DB.prepare(`UPDATE customers SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newStatus, customerId).run();
  await recordActivity(env, customerId, 'status_changed', `${customer.business_name || customer.email}: ${customer.status} → ${newStatus}`, { from: customer.status, to: newStatus });
  return json({ ok: true, id: customerId, status: newStatus });
}

async function handleMarkReady(customerId, env) {
  return updateStatus(customerId, 'Ready to Build', env);
}

async function handleStatusUpdate(request, customerId, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  return updateStatus(customerId, clean(data.status, 80), env);
}

async function handleNotes(request, customerId, env) {
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (request.method === 'GET') {
    try {
      const result = await env.DB.prepare(`SELECT id,note,created_at FROM customer_notes WHERE customer_id=? ORDER BY id DESC`).bind(customerId).all();
      return json({ ok: true, notes: result.results || [] });
    } catch { return json({ ok: true, notes: [], storageReady: false }); }
  }
  if (request.method === 'POST') {
    let data;
    try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    const note = clean(data.note, 4000);
    if (!note) return json({ ok: false, error: 'Enter a note.' }, 400);
    try {
      const result = await env.DB.prepare(`INSERT INTO customer_notes (customer_id,note,created_at) VALUES (?,?,CURRENT_TIMESTAMP)`).bind(customerId, note).run();
      await recordActivity(env, customerId, 'note_added', `Internal note added for ${customer.business_name || customer.email}`);
      return json({ ok: true, id: result.meta?.last_row_id || null });
    } catch { return json({ ok: false, error: 'Notes storage is not ready yet.' }, 503); }
  }
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}

async function handleSite(request, customerId, env) {
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (request.method === 'GET') {
    try {
      const site = await env.DB.prepare(`SELECT * FROM customer_sites WHERE customer_id=? LIMIT 1`).bind(customerId).first();
      return json({ ok: true, site: site || null });
    } catch { return json({ ok: true, site: null, storageReady: false }); }
  }
  if (request.method === 'POST' || request.method === 'PATCH') {
    let data;
    try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    const domain = clean(data.domain, 255), previewUrl = clean(data.preview_url, 1000), productionUrl = clean(data.production_url, 1000), templateKey = clean(data.template_key, 120), internalNotes = clean(data.internal_notes, 4000);
    try {
      await env.DB.prepare(`
        INSERT INTO customer_sites (customer_id,domain,preview_url,production_url,template_key,internal_notes,updated_at)
        VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(customer_id) DO UPDATE SET domain=excluded.domain,preview_url=excluded.preview_url,production_url=excluded.production_url,template_key=excluded.template_key,internal_notes=excluded.internal_notes,updated_at=CURRENT_TIMESTAMP
      `).bind(customerId, domain || null, previewUrl || null, productionUrl || null, templateKey || null, internalNotes || null).run();
      await recordActivity(env, customerId, 'site_updated', `Site information updated for ${customer.business_name || customer.email}`);
      return json({ ok: true });
    } catch { return json({ ok: false, error: 'Site metadata storage is not ready yet.' }, 503); }
  }
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}

async function persistSuccessfulOnboarding(requestCopy, env) {
  if (!env.DB) return;
  const form = await requestCopy.formData();
  const data = Object.fromEntries(form.entries());
  const checkoutSessionId = clean(data.checkout_session_id, 255);
  if (!checkoutSessionId) return;
  const customer = await env.DB.prepare(`SELECT id,business_name,email FROM customers WHERE stripe_checkout_session_id=? LIMIT 1`).bind(checkoutSessionId).first();
  if (!customer) return;
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    if (['cf-turnstile-response','website','checkout_session_id','onboarding_token'].includes(key)) continue;
    payload[key] = clean(value, 6000);
  }
  try {
    await env.DB.prepare(`INSERT INTO onboarding_submissions (customer_id,payload_json,submitted_at) VALUES (?,?,CURRENT_TIMESTAMP)`).bind(customer.id, JSON.stringify(payload)).run();
    const contactName = clean(payload.contact_name, 120), businessName = clean(payload.business_name, 160);
    if (contactName || businessName) {
      await env.DB.prepare(`UPDATE customers SET customer_name=COALESCE(NULLIF(?,''),customer_name), business_name=COALESCE(NULLIF(?,''),business_name), updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(contactName, businessName, customer.id).run();
    }
    await recordActivity(env, customer.id, 'onboarding_received', `Onboarding received for ${businessName || customer.business_name || customer.email}`);
  } catch (error) {
    console.error('Could not persist onboarding submission for dashboard', { customerId: customer.id, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleAdminApi(request, env, url) {
  if (url.pathname === '/api/admin/login') {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleAdminLogin(request, env);
  }
  if (url.pathname === '/api/admin/logout') {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleAdminLogout();
  }
  if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Authentication required.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);

  if (url.pathname === '/api/admin/customers') {
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleAdminCustomers(env);
  }
  if (url.pathname === '/api/admin/overview') {
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleOverview(env);
  }
  if (url.pathname === '/api/admin/activity') {
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleActivity(env);
  }

  let match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/ready$/);
  if (match) {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleMarkReady(Number(match[1]), env);
  }
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/status$/);
  if (match) {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleStatusUpdate(request, Number(match[1]), env);
  }
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/notes$/);
  if (match) return handleNotes(request, Number(match[1]), env);
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/site$/);
  if (match) return handleSite(request, Number(match[1]), env);

  return json({ ok: false, error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/admin/')) {
      try { return await handleAdminApi(request, env, url); }
      catch (error) {
        console.error('Admin dashboard API error', error);
        return json({ ok: false, error: 'Dashboard request failed.' }, 500);
      }
    }
    if (url.pathname === '/api/onboarding' && request.method === 'POST') {
      const copy = request.clone();
      const response = await baseWorker.fetch(request, env);
      if (response.ok) await persistSuccessfulOnboarding(copy, env);
      return response;
    }
    return baseWorker.fetch(request, env);
  },
};
