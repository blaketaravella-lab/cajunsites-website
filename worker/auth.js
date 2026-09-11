import appWorker from './app.js';
import { pbkdf2Sync } from 'node:crypto';

const ADMIN_COOKIE = 'cajunsites_admin';
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const BOOTSTRAP_OWNER_EMAIL = 'blaketaravella@gmail.com';
const BOOTSTRAP_OWNER_NAME = 'Blake Taravella';

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

async function passwordHash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return pbkdf2Sync(String(password), salt, 210000, 32, 'sha256').toString('hex');
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

async function handleLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Customer database is not configured.' }, 503);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid login request.' }, 400);
  }

  const email = clean(data.email || BOOTSTRAP_OWNER_EMAIL, 255).toLowerCase();
  const password = String(data.password ?? '');
  if (!email || !password) return json({ ok: false, error: 'Email and password are required.' }, 400);

  try {
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM internal_users').first();
    if (Number(countRow?.count || 0) === 0) {
      if (!env.ADMIN_DASHBOARD_PASSWORD || !constantTimeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
        return json({ ok: false, error: 'Incorrect email or password.' }, 401);
      }

      const salt = randomHex(16);
      const hash = await passwordHash(password, salt);
      await env.DB.prepare(
        'INSERT INTO internal_users (email,name,role,password_salt,password_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'
      ).bind(email, clean(data.name || BOOTSTRAP_OWNER_NAME, 160), 'owner', salt, hash).run();
    }

    const user = await env.DB.prepare('SELECT * FROM internal_users WHERE email=? LIMIT 1').bind(email).first();
    if (!user || !user.is_active) return json({ ok: false, error: 'Incorrect email or password.' }, 401);

    const hash = await passwordHash(password, user.password_salt);
    if (!constantTimeEqual(hash, user.password_hash)) {
      return json({ ok: false, error: 'Incorrect email or password.' }, 401);
    }

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
    if (/no such table/i.test(message)) {
      return json({ ok: false, error: 'Internal user database setup is incomplete.' }, 503);
    }
    if (/PBKDF2|pbkdf2|crypto/i.test(message)) {
      return json({ ok: false, error: 'Password security service failed.' }, 503);
    }
    return json({ ok: false, error: 'Internal login service failed.' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/login') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return handleLogin(request, env);
    }
    return appWorker.fetch(request, env);
  },
};
