export const DEFAULT_TENANT_SLUG = 'cajunsites';

export class TenantAccessError extends Error {
  constructor(message = 'Tenant access is not authorized.', status = 403) {
    super(message);
    this.name = 'TenantAccessError';
    this.status = status;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export async function resolveTenantContext(env, user, requestedTenantId = null) {
  if (!env?.DB) throw new TenantAccessError('Tenant database is not configured.', 503);
  const userId = positiveInteger(user?.id);
  if (!userId) throw new TenantAccessError('Authentication is required.', 401);

  const requestedId = positiveInteger(requestedTenantId ?? user.current_tenant_id);
  const bindings = [userId];
  let requestedClause = '';

  if (requestedId) {
    requestedClause = 'AND t.id = ?';
    bindings.push(requestedId);
  }

  const membership = await env.DB.prepare(`
    SELECT
      t.id AS tenant_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      tm.role AS tenant_role
    FROM tenant_memberships tm
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = ?
      AND tm.status = 'active'
      AND t.status = 'active'
      ${requestedClause}
    ORDER BY
      CASE WHEN t.id = COALESCE(?, t.id) THEN 0 ELSE 1 END,
      t.id
    LIMIT 1
  `).bind(...bindings, requestedId).first();

  if (!membership) {
    throw new TenantAccessError(
      requestedId ? 'You do not have access to the requested tenant.' : 'No active tenant membership was found.',
      403,
    );
  }

  return Object.freeze({
    id: Number(membership.tenant_id),
    slug: membership.tenant_slug,
    name: membership.tenant_name,
    role: membership.tenant_role,
    userId,
  });
}

export async function requireTenantProspect(env, tenant, prospectId, columns = '*') {
  const id = positiveInteger(prospectId);
  if (!id) throw new TenantAccessError('A valid prospect is required.', 400);

  const safeColumns = columns === '*' ? '*' : String(columns)
    .split(',')
    .map((column) => column.trim())
    .filter((column) => /^[a-z_][a-z0-9_]*$/i.test(column))
    .join(',');

  if (!safeColumns) throw new TenantAccessError('Invalid prospect projection.', 500);

  const prospect = await env.DB.prepare(
    `SELECT ${safeColumns} FROM prospects WHERE tenant_id = ? AND id = ? LIMIT 1`,
  ).bind(tenant.id, id).first();

  if (!prospect) throw new TenantAccessError('Prospect not found.', 404);
  return prospect;
}

export function tenantBind(tenant, ...values) {
  if (!positiveInteger(tenant?.id)) throw new TenantAccessError();
  return [tenant.id, ...values];
}
