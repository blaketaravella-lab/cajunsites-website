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
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode('cajunsites:admin-session:v1'),
  );
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
  const expected = await adminSessionToken(env.ADMIN_DASHBOARD_PASSWORD);
  return constantTimeEqual(supplied, expected);
}

async function handleAdminLogin(request, env) {
  if (!env.ADMIN_DASHBOARD_PASSWORD) {
    console.error('ADMIN_DASHBOARD_PASSWORD is not configured');
    return json({ ok: false, error: 'Dashboard authentication is not configured.' }, 503);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const password = String(data.password ?? '');
  if (!constantTimeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
    return json({ ok: false, error: 'Incorrect dashboard password.' }, 401);
  }

  const token = await adminSessionToken(env.ADMIN_DASHBOARD_PASSWORD);
  return json(
    { ok: true },
    200,
    { 'set-cookie': `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}` },
  );
}

function handleAdminLogout() {
  return json(
    { ok: true },
    200,
    { 'set-cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` },
  );
}

async function handleAdminCustomers(env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);

  try {
    const result = await env.DB.prepare(`
      SELECT
        c.*,
        os.payload_json AS onboarding_payload,
        os.submitted_at AS onboarding_submitted_at
      FROM customers c
      LEFT JOIN onboarding_submissions os
        ON os.id = (
          SELECT id
          FROM onboarding_submissions
          WHERE customer_id = c.id
          ORDER BY submitted_at DESC, id DESC
          LIMIT 1
        )
      ORDER BY c.id DESC
    `).all();
    return json({ ok: true, customers: result.results || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('onboarding_submissions')) throw error;

    const fallback = await env.DB.prepare(`
      SELECT c.*, NULL AS onboarding_payload, NULL AS onboarding_submitted_at
      FROM customers c
      ORDER BY c.id DESC
    `).all();
    return json({ ok: true, customers: fallback.results || [], onboardingStorageReady: false });
  }
}

async function handleMarkReady(customerId, env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);
  if (!Number.isInteger(customerId) || customerId <= 0) return json({ ok: false, error: 'Invalid customer.' }, 400);

  const customer = await env.DB.prepare('SELECT id, business_name, status FROM customers WHERE id = ? LIMIT 1')
    .bind(customerId)
    .first();

  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (customer.status !== 'Onboarding Received') {
    return json({ ok: false, error: `Only customers in Onboarding Received can be marked Ready to Build. Current status: ${customer.status}.` }, 409);
  }

  await env.DB.prepare(`
    UPDATE customers
    SET status = 'Ready to Build', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'Onboarding Received'
  `).bind(customerId).run();

  return json({ ok: true, id: customerId, status: 'Ready to Build' });
}

async function persistSuccessfulOnboarding(requestCopy, env) {
  if (!env.DB) return;

  const form = await requestCopy.formData();
  const data = Object.fromEntries(form.entries());
  const checkoutSessionId = clean(data.checkout_session_id, 255);
  if (!checkoutSessionId) return;

  const customer = await env.DB.prepare(`
    SELECT id FROM customers WHERE stripe_checkout_session_id = ? LIMIT 1
  `).bind(checkoutSessionId).first();
  if (!customer) return;

  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    if (['cf-turnstile-response', 'website', 'checkout_session_id', 'onboarding_token'].includes(key)) continue;
    payload[key] = clean(value, 6000);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO onboarding_submissions (customer_id, payload_json, submitted_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).bind(customer.id, JSON.stringify(payload)).run();

    const contactName = clean(payload.contact_name, 120);
    const businessName = clean(payload.business_name, 160);
    if (contactName || businessName) {
      await env.DB.prepare(`
        UPDATE customers
        SET customer_name = COALESCE(NULLIF(?, ''), customer_name),
            business_name = COALESCE(NULLIF(?, ''), business_name),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(contactName, businessName, customer.id).run();
    }
  } catch (error) {
    console.error('Could not persist onboarding submission for dashboard', {
      customerId: customer.id,
      error: error instanceof Error ? error.message : String(error),
    });
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

  if (url.pathname === '/api/admin/customers') {
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleAdminCustomers(env);
  }

  const readyMatch = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/ready$/);
  if (readyMatch) {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    return handleMarkReady(Number(readyMatch[1]), env);
  }

  return json({ ok: false, error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/admin/')) {
      try {
        return await handleAdminApi(request, env, url);
      } catch (error) {
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
