import {
  authenticateServiceRequest,
  requireScope,
  ServiceAuthError,
} from './auth.js';
import {
  getProspect,
  listBuilds,
  listProspects,
  queueBuild,
} from './repository.js';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  },
});

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return json({ ok: true, service: 'concept-pipeline', version: 'v1' });
  }

  const tenant = await authenticateServiceRequest(request, env);
  const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

  if (url.pathname === '/v1/me' && request.method === 'GET') {
    return json({
      ok: true,
      tenant: {
        id: tenant.tenantExternalId,
        slug: tenant.tenantSlug,
        name: tenant.tenantName,
      },
      scopes: [...tenant.scopes],
      request_id: requestId,
    });
  }

  if (url.pathname === '/v1/prospects' && request.method === 'GET') {
    requireScope(tenant, 'prospects:read');
    const page = await listProspects(
      env,
      tenant,
      url.searchParams.get('limit'),
      url.searchParams.get('cursor'),
    );
    return json({ ok: true, ...page, request_id: requestId });
  }

  const prospectMatch = url.pathname.match(/^\/v1\/prospects\/([^/]+)$/);
  if (prospectMatch && request.method === 'GET') {
    requireScope(tenant, 'prospects:read');
    const prospect = await getProspect(env, tenant, decodeURIComponent(prospectMatch[1]));
    if (!prospect) return json({ ok: false, error: 'Prospect not found.', request_id: requestId }, 404);
    return json({ ok: true, prospect, request_id: requestId });
  }

  const buildsMatch = url.pathname.match(/^\/v1\/prospects\/([^/]+)\/builds$/);
  if (buildsMatch) {
    const prospect = await getProspect(env, tenant, decodeURIComponent(buildsMatch[1]));
    if (!prospect) return json({ ok: false, error: 'Prospect not found.', request_id: requestId }, 404);

    if (request.method === 'GET') {
      requireScope(tenant, 'builds:read');
      return json({ ok: true, builds: await listBuilds(env, tenant, prospect.id), request_id: requestId });
    }

    if (request.method === 'POST') {
      requireScope(tenant, 'builds:write');
      const idempotencyKey = clean(request.headers.get('idempotency-key'), 200);
      if (!idempotencyKey) {
        return json({ ok: false, error: 'Idempotency-Key is required.', request_id: requestId }, 400);
      }
      const build = await queueBuild(env, tenant, prospect, idempotencyKey);
      return json({ ok: true, build, request_id: requestId }, 202);
    }
  }

  return json({ ok: false, error: 'Not found.', request_id: requestId }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ServiceAuthError) {
        return json({ ok: false, error: error.message }, error.status);
      }
      console.error('Concept pipeline service error', error);
      return json({ ok: false, error: 'Service request failed.' }, 500);
    }
  },
};
