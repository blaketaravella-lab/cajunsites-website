import appWorker from './app.js';

const ADMIN_COOKIE = 'cajunsites_admin';
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const BOOTSTRAP_OWNER_EMAIL = 'blaketaravella@gmail.com';
const BOOTSTRAP_OWNER_NAME = 'Blake Taravella';
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return bytesToHex(digest);
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function pepper(env) {
  return env.ADMIN_PASSWORD_PEPPER || env.ADMIN_DASHBOARD_PASSWORD || '';
}

async function hmacPasswordHash(password, saltHex, env) {
  const secret = pepper(env);
  if (!secret) throw new Error('Authentication pepper is not configured');
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
    new TextEncoder().encode(`${saltHex}:${String(password)}`),
  );
  return bytesToHex(signature);
}

async function pbkdf2PasswordHash(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(String(saltHex || '').match(/.{1,2}/g) || [], byte => parseInt(byte, 16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256);
  return bytesToHex(bits);
}

async function ensureAuthSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    successful INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_lookup ON admin_login_attempts(email_hash,ip_hash,created_at)').run();
  for (const sql of [
    'ALTER TABLE internal_users ADD COLUMN password_scheme TEXT',
  ]) {
    try { await env.DB.prepare(sql).run(); } catch (error) {
      if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
    }
  }
}

async function passwordMatchesAndUpgrade(password, user, env) {
  const hmacHash = await hmacPasswordHash(password, user.password_salt, env);
  if (constantTimeEqual(hmacHash, user.password_hash)) {
    if (user.password_scheme !== 'hmac_v2') {
      await env.DB.prepare(`UPDATE internal_users SET password_scheme='hmac_v2',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(user.id).run().catch(()=>{});
    }
    return true;
  }

  try {
    const pbkdf2Hash = await pbkdf2PasswordHash(password, user.password_salt);
    if (!constantTimeEqual(pbkdf2Hash, user.password_hash)) return false;
    const salt = randomHex(16);
    const upgradedHash = await hmacPasswordHash(password, salt, env);
    await env.DB.prepare(`UPDATE internal_users SET password_salt=?,password_hash=?,password_scheme='hmac_v2',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(salt, upgradedHash, user.id).run();
    return true;
  } catch (error) {
    console.warn('Legacy PBKDF2 compatibility verification failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function createSession(userId, env) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO admin_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)'
  ).bind(tokenHash, userId, expiresAt).run();
  return token;
}

async function currentUser(request, env) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token || !env.DB) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(`SELECT u.id,u.email,u.name,u.role,u.is_active FROM admin_sessions s JOIN internal_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1 LIMIT 1`)
    .bind(tokenHash, new Date().toISOString()).first();
}

async function loginKey(request, email) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  return { emailHash: await sha256Hex(String(email).toLowerCase()), ipHash: await sha256Hex(ip.split(',')[0].trim()) };
}

async function isRateLimited(env, key) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString().replace('T',' ').replace('Z','');
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM admin_login_attempts WHERE email_hash=? AND ip_hash=? AND successful=0 AND created_at>=?`)
    .bind(key.emailHash, key.ipHash, since).first();
  return Number(row?.count || 0) >= LOGIN_MAX_FAILURES;
}

async function recordLoginAttempt(env, key, successful) {
  await env.DB.prepare(`INSERT INTO admin_login_attempts (email_hash,ip_hash,successful,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)`)
    .bind(key.emailHash, key.ipHash, successful ? 1 : 0).run();
  if (successful) await env.DB.prepare(`DELETE FROM admin_login_attempts WHERE email_hash=? AND ip_hash=?`).bind(key.emailHash,key.ipHash).run();
  else await env.DB.prepare(`DELETE FROM admin_login_attempts WHERE created_at < datetime('now','-2 days')`).run().catch(()=>{});
}

async function handleLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid login request.' }, 400); }

  const email = clean(data.email || BOOTSTRAP_OWNER_EMAIL, 255).toLowerCase();
  const password = String(data.password ?? '');
  if (!email || !password) return json({ ok: false, error: 'Email and password are required.' }, 400);

  try {
    await ensureAuthSchema(env);
    const key = await loginKey(request, email);
    if (await isRateLimited(env, key)) return json({ ok:false,error:'Too many failed sign-in attempts. Try again in about 15 minutes.' },429,{'retry-after':'900'});

    const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM internal_users').first();
    if (Number(countRow?.count || 0) === 0) {
      if (!env.ADMIN_DASHBOARD_PASSWORD || !constantTimeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
        await recordLoginAttempt(env,key,false);
        return json({ ok: false, error: 'Incorrect email or password.' }, 401);
      }
      const salt = randomHex(16);
      const hash = await hmacPasswordHash(password, salt, env);
      await env.DB.prepare(
        `INSERT INTO internal_users (email,name,role,password_salt,password_hash,password_scheme,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'hmac_v2',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
      ).bind(email, clean(data.name || BOOTSTRAP_OWNER_NAME, 160), 'owner', salt, hash).run();
    }

    const user = await env.DB.prepare('SELECT * FROM internal_users WHERE email=? LIMIT 1').bind(email).first();
    if (!user || !user.is_active || !(await passwordMatchesAndUpgrade(password, user, env))) {
      await recordLoginAttempt(env,key,false);
      return json({ ok: false, error: 'Incorrect email or password.' }, 401);
    }

    await recordLoginAttempt(env,key,true);
    await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(new Date().toISOString()).run();
    const token = await createSession(user.id, env);
    await env.DB.prepare('UPDATE internal_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id).run();
    return json(
      { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200,
      { 'set-cookie': `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}` },
    );
  } catch (error) {
    console.error('CajunSites internal login failed', error);
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(message)) return json({ ok: false, error: 'Internal user database setup is incomplete.' }, 503);
    if (/pepper|HMAC|PBKDF2|importKey|sign|deriveBits/i.test(message)) return json({ ok: false, error: 'Password security service failed.' }, 503);
    return json({ ok: false, error: `Internal login service failed: ${message.slice(0, 120)}` }, 500);
  }
}

async function handleCreateUser(request,env){
  const actor=await currentUser(request,env);if(!actor)return json({ok:false,error:'Authentication required.'},401);if(actor.role!=='owner')return json({ok:false,error:'Owner access is required.'},403);
  let data;try{data=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}
  const email=clean(data.email,255).toLowerCase(),name=clean(data.name,160),role=clean(data.role,40),password=String(data.password||'');
  if(!email||!email.includes('@')||!name||!['owner','admin','operator','read_only'].includes(role)||password.length<12)return json({ok:false,error:'Name, valid email, role, and a temporary password of at least 12 characters are required.'},400);
  await ensureAuthSchema(env);const existing=await env.DB.prepare('SELECT id FROM internal_users WHERE email=? LIMIT 1').bind(email).first();if(existing)return json({ok:false,error:'An internal user with that email already exists.'},409);
  const salt=randomHex(16),hash=await hmacPasswordHash(password,salt,env);const result=await env.DB.prepare(`INSERT INTO internal_users (email,name,role,password_salt,password_hash,password_scheme,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'hmac_v2',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(email,name,role,salt,hash).run();
  return json({ok:true,id:result.meta?.last_row_id||null});
}

async function handleResetPassword(request,env,userId){
  const actor=await currentUser(request,env);if(!actor)return json({ok:false,error:'Authentication required.'},401);if(actor.role!=='owner')return json({ok:false,error:'Owner access is required.'},403);
  let data;try{data=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}const password=String(data.password||'');if(password.length<12)return json({ok:false,error:'Password must be at least 12 characters.'},400);
  const target=await env.DB.prepare('SELECT id FROM internal_users WHERE id=? LIMIT 1').bind(userId).first();if(!target)return json({ok:false,error:'Internal user not found.'},404);
  const salt=randomHex(16),hash=await hmacPasswordHash(password,salt,env);await env.DB.prepare(`UPDATE internal_users SET password_salt=?,password_hash=?,password_scheme='hmac_v2',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(salt,hash,userId).run();await env.DB.prepare('DELETE FROM admin_sessions WHERE user_id=?').bind(userId).run();return json({ok:true});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/login') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return handleLogin(request, env);
    }
    if(url.pathname==='/api/admin/users'&&request.method==='POST')return handleCreateUser(request,env);
    const reset=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);if(reset&&request.method==='POST')return handleResetPassword(request,env,Number(reset[1]));
    return appWorker.fetch(request, env);
  },
};
