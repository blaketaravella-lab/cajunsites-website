export function assetKey(tenant, prospectExternalId, buildExternalId, filename) {
  const safe = (value) => String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return [
    'tenants',
    safe(tenant.tenantExternalId),
    'prospects',
    safe(prospectExternalId),
    'builds',
    safe(buildExternalId),
    safe(filename),
  ].join('/');
}

export async function listProspects(env, tenant, limit = 50, cursor = null) {
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  const after = Math.max(0, Number(cursor) || 0);
  const result = await env.DB.prepare(`
    SELECT id,external_id,business_name,category,city,state,research_status,concept_state,updated_at
    FROM prospects
    WHERE tenant_id=? AND id>?
    ORDER BY id
    LIMIT ?
  `).bind(tenant.tenantId, after, pageSize + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const nextCursor = hasMore ? String(pageRows.at(-1)?.id || after) : null;
  const items = pageRows.map(({ id, ...item }) => item);
  return { items, next_cursor: nextCursor };
}

export async function getProspect(env, tenant, externalId) {
  return env.DB.prepare(`
    SELECT *
    FROM prospects
    WHERE tenant_id=? AND external_id=?
    LIMIT 1
  `).bind(tenant.tenantId, externalId).first();
}

export async function listBuilds(env, tenant, prospectId) {
  const result = await env.DB.prepare(`
    SELECT external_id,status,stage,deployment_id,concept_alias,error_stage,error_message,
           started_at,completed_at,created_at,updated_at
    FROM concept_builds
    WHERE tenant_id=? AND prospect_id=?
    ORDER BY id DESC
    LIMIT 100
  `).bind(tenant.tenantId, prospectId).all();
  return result.results || [];
}

export async function queueBuild(env, tenant, prospect, idempotencyKey) {
  const externalId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO concept_builds (
      tenant_id,prospect_id,external_id,idempotency_key,status,stage,created_at,updated_at
    ) VALUES (?, ?, ?, ?, 'Queued', 'Accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id,idempotency_key) DO NOTHING
  `).bind(tenant.tenantId, prospect.id, externalId, idempotencyKey).run();

  return env.DB.prepare(`
    SELECT external_id,status,stage,created_at
    FROM concept_builds
    WHERE tenant_id=? AND idempotency_key=?
    LIMIT 1
  `).bind(tenant.tenantId, idempotencyKey).first();
}
