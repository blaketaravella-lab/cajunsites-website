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
const BOOTSTRAP_OWNER_EMAIL = 'blaketaravella@gmail.com';
const BOOTSTRAP_OWNER_NAME = 'Blake Taravella';
const INTERNAL_ROLES = ['owner','admin','operator','read_only'];
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

function randomHex(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bytesToHex(array);
}

async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function passwordHash(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g) || [], byte => parseInt(byte, 16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256);
  return bytesToHex(bits);
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function ensureIdentitySchema(env) {
  if (!env.DB) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS internal_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES internal_users(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)`).run();
}

async function createSession(userId, env) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO admin_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)`)
    .bind(tokenHash, userId, expires).run();
  return token;
}

async function getAdminUser(request, env) {
  if (!env.DB) return null;
  try { await ensureIdentitySchema(env); } catch { return null; }
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const user = await env.DB.prepare(`
    SELECT u.id,u.email,u.name,u.role,u.is_active,u.last_login_at,s.expires_at
    FROM admin_sessions s JOIN internal_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND u.is_active=1 AND s.expires_at > ? LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first();
  return user || null;
}

function canMutate(user) {
  return user && ['owner','admin','operator'].includes(user.role);
}

function requireOwner(user) {
  return user?.role === 'owner';
}

function sameOriginMutation(request) {
  if (!['POST','PATCH','PUT','DELETE'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function recordActivity(env, customerId, eventType, description, metadata = null, actor = null) {
  try {
    const details = { ...(metadata || {}), actor: actor ? { id: actor.id, name: actor.name, email: actor.email, role: actor.role } : { name: 'System' } };
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(customerId || null, clean(eventType, 80), clean(description, 1000), JSON.stringify(details)).run();
  } catch (error) {
    console.warn('Admin activity log unavailable', error instanceof Error ? error.message : String(error));
  }
}

async function handleAdminLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);
  await ensureIdentitySchema(env);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  const email = clean(data.email || BOOTSTRAP_OWNER_EMAIL, 255).toLowerCase();
  const password = String(data.password ?? '');
  if (!email || !password) return json({ ok: false, error: 'Email and password are required.' }, 400);

  let countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM internal_users`).first();
  if (Number(countRow?.count || 0) === 0) {
    if (!env.ADMIN_DASHBOARD_PASSWORD || !constantTimeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
      return json({ ok: false, error: 'Incorrect dashboard password.' }, 401);
    }
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    await env.DB.prepare(`INSERT INTO internal_users (email,name,role,password_salt,password_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(email || BOOTSTRAP_OWNER_EMAIL, clean(data.name || BOOTSTRAP_OWNER_NAME, 160), 'owner', salt, hash).run();
  }

  const user = await env.DB.prepare(`SELECT * FROM internal_users WHERE email=? LIMIT 1`).bind(email).first();
  if (!user || !user.is_active) return json({ ok: false, error: 'Incorrect email or password.' }, 401);
  const hash = await passwordHash(password, user.password_salt);
  if (!constantTimeEqual(hash, user.password_hash)) return json({ ok: false, error: 'Incorrect email or password.' }, 401);

  await env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).bind(new Date().toISOString()).run();
  const token = await createSession(user.id, env);
  await env.DB.prepare(`UPDATE internal_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?`).bind(user.id).run();
  await recordActivity(env, null, 'admin_login', `${user.name} signed in`, null, user);
  return json({ ok: true, user: { id:user.id,email:user.email,name:user.name,role:user.role } }, 200, {
    'set-cookie': `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}`,
  });
}

async function handleAdminLogout(request, env) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (token && env.DB) {
    try { await env.DB.prepare(`DELETE FROM admin_sessions WHERE token_hash=?`).bind(await sha256Hex(token)).run(); } catch {}
  }
  return json({ ok: true }, 200, { 'set-cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function handleMe(user) {
  return json({ ok:true, user:{ id:user.id,email:user.email,name:user.name,role:user.role } });
}

async function handleUsers(request, env, user) {
  if (!requireOwner(user)) return json({ ok:false,error:'Owner access is required.' },403);
  if (request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT id,email,name,role,is_active,created_at,updated_at,last_login_at FROM internal_users ORDER BY name COLLATE NOCASE`).all();
    return json({ ok:true, users:result.results || [] });
  }
  if (request.method === 'POST') {
    let data; try { data = await request.json(); } catch { return json({ok:false,error:'Invalid request.'},400); }
    const email=clean(data.email,255).toLowerCase(), name=clean(data.name,160), role=clean(data.role,40), password=String(data.password||'');
    if (!email || !email.includes('@') || !name || !INTERNAL_ROLES.includes(role) || password.length < 12) return json({ok:false,error:'Name, valid email, role, and a temporary password of at least 12 characters are required.'},400);
    const existing=await env.DB.prepare(`SELECT id FROM internal_users WHERE email=? LIMIT 1`).bind(email).first();
    if (existing) return json({ok:false,error:'An internal user with that email already exists.'},409);
    const salt=randomHex(16), hash=await passwordHash(password,salt);
    const result=await env.DB.prepare(`INSERT INTO internal_users (email,name,role,password_salt,password_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(email,name,role,salt,hash).run();
    await recordActivity(env,null,'internal_user_added',`${user.name} added internal user ${name} (${role})`,{target_email:email,target_role:role},user);
    return json({ok:true,id:result.meta?.last_row_id||null});
  }
  return json({ok:false,error:'Method not allowed.'},405);
}

async function countActiveOwners(env) {
  const row=await env.DB.prepare(`SELECT COUNT(*) AS count FROM internal_users WHERE role='owner' AND is_active=1`).first();
  return Number(row?.count||0);
}

async function handleUserRecord(request, env, actor, userId) {
  if (!requireOwner(actor)) return json({ok:false,error:'Owner access is required.'},403);
  const target=await env.DB.prepare(`SELECT * FROM internal_users WHERE id=? LIMIT 1`).bind(userId).first();
  if (!target) return json({ok:false,error:'Internal user not found.'},404);

  if (request.method === 'PATCH') {
    let data; try { data=await request.json(); } catch { return json({ok:false,error:'Invalid request.'},400); }
    const role=data.role!==undefined?clean(data.role,40):target.role;
    const isActive=data.is_active!==undefined?(data.is_active?1:0):target.is_active;
    const name=data.name!==undefined?clean(data.name,160):target.name;
    if (!INTERNAL_ROLES.includes(role) || !name) return json({ok:false,error:'Invalid user settings.'},400);
    if (target.id===actor.id && !isActive) return json({ok:false,error:'You cannot disable your own account.'},409);
    if (target.role==='owner' && target.is_active && (role!=='owner' || !isActive) && await countActiveOwners(env)<=1) return json({ok:false,error:'CajunSites must always have at least one active Owner.'},409);
    await env.DB.prepare(`UPDATE internal_users SET name=?,role=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,role,isActive,userId).run();
    if (!isActive || role!==target.role) await env.DB.prepare(`DELETE FROM admin_sessions WHERE user_id=?`).bind(userId).run();
    await recordActivity(env,null,'internal_user_updated',`${actor.name} updated ${target.name}`,{target_email:target.email,from_role:target.role,to_role:role,is_active:Boolean(isActive)},actor);
    return json({ok:true});
  }

  if (request.method === 'DELETE') {
    if (target.id===actor.id) return json({ok:false,error:'You cannot remove your own account.'},409);
    if (target.role==='owner' && target.is_active && await countActiveOwners(env)<=1) return json({ok:false,error:'CajunSites must always have at least one active Owner.'},409);
    await env.DB.prepare(`DELETE FROM admin_sessions WHERE user_id=?`).bind(userId).run();
    await env.DB.prepare(`DELETE FROM internal_users WHERE id=?`).bind(userId).run();
    await recordActivity(env,null,'internal_user_removed',`${actor.name} removed internal user ${target.name}`,{target_email:target.email,target_role:target.role},actor);
    return json({ok:true});
  }

  return json({ok:false,error:'Method not allowed.'},405);
}

async function handleResetPassword(request, env, actor, userId) {
  if (!requireOwner(actor)) return json({ok:false,error:'Owner access is required.'},403);
  const target=await env.DB.prepare(`SELECT id,name,email FROM internal_users WHERE id=? LIMIT 1`).bind(userId).first();
  if (!target) return json({ok:false,error:'Internal user not found.'},404);
  let data; try { data=await request.json(); } catch { return json({ok:false,error:'Invalid request.'},400); }
  const password=String(data.password||'');
  if (password.length<12) return json({ok:false,error:'Password must be at least 12 characters.'},400);
  const salt=randomHex(16), hash=await passwordHash(password,salt);
  await env.DB.prepare(`UPDATE internal_users SET password_salt=?,password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(salt,hash,userId).run();
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE user_id=?`).bind(userId).run();
  await recordActivity(env,null,'internal_user_password_reset',`${actor.name} reset the password for ${target.name}`,{target_email:target.email},actor);
  return json({ok:true});
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

async function updateStatus(customerId, newStatus, env, actor) {
  if (!canMutate(actor)) return json({ok:false,error:'Your role is read only.'},403);
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (!VALID_STATUSES.includes(newStatus)) return json({ ok: false, error: 'Invalid status.' }, 400);
  if (customer.status === newStatus) return json({ ok: true, id: customerId, status: newStatus });
  const normalAllowed = STATUS_TRANSITIONS[customer.status] || [];
  const exceptionAllowed = ['Payment Issue','Cancelled'].includes(newStatus) && ['owner','admin'].includes(actor.role);
  if (!normalAllowed.includes(newStatus) && !exceptionAllowed) return json({ ok: false, error: `Cannot move from ${customer.status} to ${newStatus}.` }, 409);
  await env.DB.prepare(`UPDATE customers SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newStatus, customerId).run();
  await recordActivity(env, customerId, 'status_changed', `${actor.name} moved ${customer.business_name || customer.email}: ${customer.status} → ${newStatus}`, { from: customer.status, to: newStatus }, actor);
  return json({ ok: true, id: customerId, status: newStatus });
}

async function handleStatusUpdate(request, customerId, env, actor) {
  let data; try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  return updateStatus(customerId, clean(data.status, 80), env, actor);
}

async function handleNotes(request, customerId, env, actor) {
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (request.method === 'GET') {
    try { const result = await env.DB.prepare(`SELECT id,note,created_at FROM customer_notes WHERE customer_id=? ORDER BY id DESC`).bind(customerId).all(); return json({ ok: true, notes: result.results || [] }); }
    catch { return json({ ok: true, notes: [], storageReady: false }); }
  }
  if (request.method === 'POST') {
    if (!canMutate(actor)) return json({ok:false,error:'Your role is read only.'},403);
    let data; try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    const note = clean(data.note, 4000);
    if (!note) return json({ ok: false, error: 'Enter a note.' }, 400);
    try {
      const result = await env.DB.prepare(`INSERT INTO customer_notes (customer_id,note,created_at) VALUES (?,?,CURRENT_TIMESTAMP)`).bind(customerId, note).run();
      await recordActivity(env, customerId, 'note_added', `${actor.name} added an internal note for ${customer.business_name || customer.email}`, null, actor);
      return json({ ok: true, id: result.meta?.last_row_id || null });
    } catch { return json({ ok: false, error: 'Notes storage is not ready yet.' }, 503); }
  }
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}

async function handleSite(request, customerId, env, actor) {
  const customer = await getCustomer(customerId, env);
  if (!customer) return json({ ok: false, error: 'Customer not found.' }, 404);
  if (request.method === 'GET') {
    try { const site = await env.DB.prepare(`SELECT * FROM customer_sites WHERE customer_id=? LIMIT 1`).bind(customerId).first(); return json({ ok: true, site: site || null }); }
    catch { return json({ ok: true, site: null, storageReady: false }); }
  }
  if (request.method === 'POST' || request.method === 'PATCH') {
    if (!canMutate(actor)) return json({ok:false,error:'Your role is read only.'},403);
    let data; try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    const domain = clean(data.domain, 255), previewUrl = clean(data.preview_url, 1000), productionUrl = clean(data.production_url, 1000), templateKey = clean(data.template_key, 120), internalNotes = clean(data.internal_notes, 4000);
    try {
      await env.DB.prepare(`INSERT INTO customer_sites (customer_id,domain,preview_url,production_url,template_key,internal_notes,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(customer_id) DO UPDATE SET domain=excluded.domain,preview_url=excluded.preview_url,production_url=excluded.production_url,template_key=excluded.template_key,internal_notes=excluded.internal_notes,updated_at=CURRENT_TIMESTAMP`)
        .bind(customerId, domain || null, previewUrl || null, productionUrl || null, templateKey || null, internalNotes || null).run();
      await recordActivity(env, customerId, 'site_updated', `${actor.name} updated site information for ${customer.business_name || customer.email}`, null, actor);
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
    if (contactName || businessName) await env.DB.prepare(`UPDATE customers SET customer_name=COALESCE(NULLIF(?,''),customer_name), business_name=COALESCE(NULLIF(?,''),business_name), updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(contactName, businessName, customer.id).run();
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
    return handleAdminLogout(request, env);
  }
  if (!sameOriginMutation(request)) return json({ok:false,error:'Invalid request origin.'},403);
  const actor = await getAdminUser(request, env);
  if (!actor) return json({ ok: false, error: 'Authentication required.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);

  if (url.pathname === '/api/admin/me') return request.method === 'GET' ? handleMe(actor) : json({ok:false,error:'Method not allowed.'},405);
  if (url.pathname === '/api/admin/users') return handleUsers(request, env, actor);
  if (url.pathname === '/api/admin/customers') return request.method === 'GET' ? handleAdminCustomers(env) : json({ok:false,error:'Method not allowed.'},405);
  if (url.pathname === '/api/admin/overview') return request.method === 'GET' ? handleOverview(env) : json({ok:false,error:'Method not allowed.'},405);
  if (url.pathname === '/api/admin/activity') return request.method === 'GET' ? handleActivity(env) : json({ok:false,error:'Method not allowed.'},405);

  let match = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (match) return handleUserRecord(request,env,actor,Number(match[1]));
  match = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
  if (match) return request.method==='POST' ? handleResetPassword(request,env,actor,Number(match[1])) : json({ok:false,error:'Method not allowed.'},405);
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/ready$/);
  if (match) return request.method==='POST' ? updateStatus(Number(match[1]),'Ready to Build',env,actor) : json({ok:false,error:'Method not allowed.'},405);
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/status$/);
  if (match) return request.method==='POST' ? handleStatusUpdate(request,Number(match[1]),env,actor) : json({ok:false,error:'Method not allowed.'},405);
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/notes$/);
  if (match) return handleNotes(request,Number(match[1]),env,actor);
  match = url.pathname.match(/^\/api\/admin\/customers\/(\d+)\/site$/);
  if (match) return handleSite(request,Number(match[1]),env,actor);
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
