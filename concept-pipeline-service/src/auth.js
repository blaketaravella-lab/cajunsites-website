const encoder = new TextEncoder();

export class ServiceAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'ServiceAuthError';
    this.status = status;
  }
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function parseBearer(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(cpt_live_([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{24,256}))$/);
  if (!match) throw new ServiceAuthError('A valid service credential is required.');
  return { token: match[1], keyId: match[2], secret: match[3] };
}

export async function authenticateServiceRequest(request, env) {
  if (!env?.DB) throw new ServiceAuthError('Service database is unavailable.', 503);
  const credential = parseBearer(request);
  const row = await env.DB.prepare(`
    SELECT
      c.id AS credential_id,
      c.tenant_id,
      c.secret_hash,
      c.scopes_json,
      c.expires_at,
      t.external_id AS tenant_external_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name
    FROM tenant_api_credentials c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.key_id = ?
      AND c.status = 'active'
      AND t.status = 'active'
      AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
  `).bind(credential.keyId).first();

  if (!row || !constantTimeEqual(await sha256(credential.secret), row.secret_hash)) {
    throw new ServiceAuthError('The service credential is invalid or expired.');
  }

  env.DB.prepare(
    'UPDATE tenant_api_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?',
  ).bind(row.credential_id, row.tenant_id).run().catch(() => {});

  let scopes = [];
  try { scopes = JSON.parse(row.scopes_json || '[]'); } catch {}

  return Object.freeze({
    credentialId: Number(row.credential_id),
    tenantId: Number(row.tenant_id),
    tenantExternalId: row.tenant_external_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name,
    scopes: new Set(Array.isArray(scopes) ? scopes : []),
  });
}

export function requireScope(context, scope) {
  if (!context?.scopes?.has(scope) && !context?.scopes?.has('*')) {
    throw new ServiceAuthError(`Credential does not grant ${scope}.`, 403);
  }
}
