# CajunSites Tenant-Scoping Map

## Purpose

This document defines how every current CajunSites data domain becomes tenant-safe as the internal operating dashboard evolves into a multi-tenant SaaS platform.

CajunSites is Tenant `1` during migration. Existing behavior must remain intact while every tenant-owned query becomes server-side scoped.

## Core rule

Every tenant-owned lookup must satisfy both the record identifier and the active tenant context.

```sql
SELECT *
FROM prospects
WHERE tenant_id = ?
  AND id = ?
LIMIT 1;
```

Never trust a tenant ID supplied in a record body. Resolve the active tenant from the authenticated membership or from a trusted public-token / Stripe / domain binding, then use that tenant ID in all reads and writes.

## Scope categories

- **Global identity**: shared across the platform and not assigned directly to one tenant.
- **Membership-scoped**: access to the record is derived through `tenant_memberships`.
- **Tenant-owned**: table should have a required `tenant_id`.
- **Parent-derived**: tenant is inherited from a required parent such as `customer_id` or `prospect_id`. For defense in depth, operational/high-volume tables should still persist `tenant_id` directly.
- **Platform-global**: platform operations only, intentionally not tenant-owned.

## Table map

| Table | Scope | `tenant_id` strategy | Migration / backfill | Required enforcement |
|---|---|---|---|---|
| `tenants` | Platform-global root | No parent `tenant_id`; `id` is the tenant key | Insert CajunSites as ID 1 | Platform admin only except current-tenant self reads |
| `tenant_memberships` | Membership-scoped | Required `tenant_id` FK | Backfill every current internal user into tenant 1 | All organization resolution and user-management paths |
| `tenant_settings` | Tenant-owned 1:1 | PK/FK `tenant_id` | Create tenant 1 settings with $499/$49 defaults | Tenant owners/admins only for mutation |
| `tenant_branding` | Tenant-owned 1:1 | PK/FK `tenant_id` | Create CajunSites purple/gold/default branding | Tenant owners/admins; public read only through resolved tenant branding |
| `tenant_billing` | Tenant-owned 1:1 | PK/FK `tenant_id` | Tenant 1 marked `internal` | Platform subscription service only; tenant can read own status |
| `tenant_usage_events` | Tenant-owned | Required indexed `tenant_id` | No historical backfill required initially; new events only or derive historical data if useful | Never aggregate without tenant scope except Platform Admin |
| `internal_users` | Global identity | **Do not add tenant_id** | Keep current users as platform identities | Access to organizations comes only through memberships |
| `admin_sessions` | Global identity session | No direct `tenant_id` initially; selected tenant may later be persisted in session/context | Existing sessions remain valid; tenant resolved from user membership | `/api/admin/me` should return memberships/current tenant, never authorize from role alone |
| `admin_login_attempts` | Platform-global security telemetry | No tenant_id required before authentication | Keep existing rows | Platform security only |
| `prospects` | Tenant-owned | Required `tenant_id`; composite indexes with tenant first | Backfill all current rows to tenant 1 | Every prospect list/read/update/delete/research/build/preview/design/conversion route |
| `design_chat_messages` | Tenant-owned / prospect-derived | Add required `tenant_id` and retain `prospect_id` | Backfill by joining `prospects.id` | Design Studio GET/POST/apply must filter both tenant and prospect |
| `concept_builds` | Tenant-owned / prospect-derived | Required `tenant_id` plus `prospect_id` | Backfill from prospect; future inserts copy active tenant | Build gate, build history, stale recovery, preview and rollback paths |
| `concept_images` | Tenant-owned / prospect-derived | Required `tenant_id` plus `prospect_id` | Backfill from prospect/build | Image generation, QA, usage reporting, deploy updates |
| `research_cache` | Shared-by-identity data with tenant-aware use | Prefer global cache with **no customer/private data**; key must be business identity only. Add `source_tenant_id` only for attribution, not ownership | Existing cache may stay global if payload is public research only | Cached result may be consumed by any tenant only if it contains no tenant/manual/private directives; never cache manual fields or Design Studio data |
| `platform_jobs` | Tenant-owned | Add required `tenant_id` | Backfill from linked prospect/customer; tenant 1 otherwise | Job dashboards, reconciliation, research/build automation |
| `provider_usage_events` | Tenant-owned metering | Add required `tenant_id` | Backfill from prospect/customer when possible; tenant 1 for current history | All usage/cost analytics and provider call tracking |
| `customers` | Tenant-owned | Required `tenant_id` | Backfill all current customers to tenant 1 | Customer lists/details/status/site/notes/billing/onboarding/webhook matching |
| `customer_notes` | Tenant-owned / customer-derived | Add required `tenant_id` | Backfill from `customers` | Notes GET/POST must verify customer belongs to active tenant |
| `customer_sites` | Tenant-owned / customer-derived | Add required `tenant_id`; uniqueness should become `(tenant_id, customer_id)` | Backfill from customers | Site GET/PATCH, promotion, production-site operations |
| `onboarding_submissions` | Tenant-owned / customer-derived | Add required `tenant_id` | Backfill from customers | Public onboarding derives tenant from verified customer token/session; admin reads tenant-scoped |
| `billing_snapshots` | Tenant-owned / customer-derived | Add required `tenant_id` | Backfill from customers | Billing dashboard and reconciliation must tenant-scope customer lookup |
| `admin_activity` | Tenant-owned audit | Required `tenant_id` even when `customer_id` is NULL | Backfill all current rows to tenant 1 | Every activity insert and `/api/admin/activity` query |
| `website_leads` | Tenant-owned | Add required `tenant_id` | Existing rows to tenant 1 | Public lead endpoint resolves tenant by hostname/form token; admin lead queries tenant-scoped |

## Prospect and concept API enforcement map

| Endpoint / route family | Tenant resolution | Enforcement required |
|---|---|---|
| `GET /api/admin/prospects` | Authenticated membership/current tenant | `WHERE tenant_id=?`; never return another tenant's converted/history rows |
| `POST /api/admin/prospects` | Authenticated membership/current tenant | Insert active `tenant_id`; ignore any body-supplied tenant ID |
| `PATCH /api/admin/prospects/:id` | Authenticated membership/current tenant | Load/update using `WHERE tenant_id=? AND id=?` |
| `DELETE /api/admin/prospects/:id` | Authenticated membership/current tenant | Delete only matching tenant record |
| `POST /api/admin/prospects/:id/research` | Authenticated membership/current tenant | Resolve prospect by tenant; all resulting activity/jobs/usage inherit tenant |
| `POST /api/admin/prospects/:id/build-concept` | Authenticated membership/current tenant | Prospect/build gate/build rows/images/deployment metadata all tenant-bound |
| `GET /api/admin/prospects/:id/concept-preview/*` | Authenticated membership/current tenant | Verify tenant owns prospect and exact deployment ID before reading Vercel files |
| `GET/POST /api/admin/design-chat/:id` | Authenticated membership/current tenant | Prospect and chat message queries tenant-scoped |
| `POST /api/admin/design-chat/:id/apply/:messageId` | Authenticated membership/current tenant | Both prospect and message must match tenant; applied model stays tenant-owned |
| `POST /api/admin/prospects/:id/convert` | Authenticated membership/current tenant | Prospect lookup tenant-scoped; created customer/site/notes/activity/billing inherit same tenant |

## Customer / fulfillment API enforcement map

| Endpoint | Enforcement required |
|---|---|
| `GET /api/admin/customers` | Filter `customers.tenant_id=?`; all onboarding/site joins must remain within same tenant |
| `GET /api/admin/overview` | Every aggregate must include tenant filter |
| `GET /api/admin/activity` | Filter `admin_activity.tenant_id=?` |
| `POST /api/admin/customers/:id/ready` | Customer lookup/update tenant-scoped |
| `POST /api/admin/customers/:id/status` | Customer lookup/update tenant-scoped |
| `GET/POST /api/admin/customers/:id/notes` | Verify parent customer tenant, then query notes by tenant + customer |
| `GET/POST/PATCH /api/admin/customers/:id/site` | Verify parent customer tenant, then site query/write by tenant + customer |
| `GET /api/admin/customers/:id/billing` | Customer lookup must include tenant before any Stripe calls |
| `POST /api/admin/customers/:id/invoices` | Customer lookup tenant-scoped; Stripe metadata should include platform tenant ID |
| `POST /api/admin/invoices/:invoiceId/send` | Resolve Stripe invoice customer, then verify matched DB customer belongs to active tenant before sending |

## Identity and organization API enforcement map

| Endpoint | Strategy |
|---|---|
| `POST /api/admin/login` | Authenticates a global user; response should include available tenant memberships after login |
| `POST /api/admin/logout` | Global session operation |
| `GET /api/admin/me` | Return global identity plus current tenant/memberships and tenant role |
| `GET /api/admin/users` | Replace global user list behavior with current tenant membership list; only tenant Owner/Admin can manage |
| `POST /api/admin/users` | Create/reuse global identity then create tenant membership; do not make global role authoritative |
| `PATCH /api/admin/users/:id` | Mutate membership role/status for current tenant, not the user's global access to other tenants |
| `DELETE /api/admin/users/:id` | Remove membership from current tenant; delete global identity only when explicitly handled by platform lifecycle and no memberships remain |
| `POST /api/admin/users/:id/password` | Password is global identity credential; requester must have authority over target membership and platform policy must prevent cross-tenant abuse |

## Public endpoint enforcement map

| Endpoint | Tenant resolution | Strategy |
|---|---|---|
| `POST /api/lead` | Hostname, tenant-specific public form token, or explicit signed tenant reference | Store `website_leads.tenant_id`; send tenant-branded notification to tenant-configured destination |
| `POST /api/onboarding` | Signed onboarding token -> checkout/customer -> tenant | Never accept tenant from form body; submission/customer updates inherit customer tenant |
| `POST /api/stripe-webhook` | Stripe Connect account ID / metadata / matched customer | Resolve tenant before customer mutation; event may not use active browser tenant context |

## Stripe and billing strategy

The current implementation uses one CajunSites Stripe account and hard-coded $499/$49 amounts. SaaS requires two separate layers:

1. **Platform billing**: tenant pays CajunSites Platform. Store in `tenant_billing`.
2. **Tenant customer billing**: local SMB pays the tenant/agency. Future implementation should use Stripe Connect or another explicitly tenant-bound payment account.

All tenant-customer Stripe objects should carry immutable metadata such as:

```text
platform_tenant_id
platform_customer_id
source_prospect_id
fee_type / service
```

Webhook handlers must use trusted Stripe account/object metadata plus DB mappings to resolve `tenant_id` before updates.

## Domain and deployment strategy

Concept aliasing currently assumes `*.cajunsites.com`. For SaaS:

- tenant 1 continues to use `cajunsites.com`.
- concept domain comes from `tenant_settings.concept_domain`.
- deployment records must include `tenant_id`.
- generated slug uniqueness is tenant/domain scoped, not globally business-name scoped.
- Design Studio preview remains same-origin and authenticated, but must tenant-check the prospect before proxying deployment bytes.

Recommended uniqueness where applicable:

```sql
UNIQUE (tenant_id, concept_slug)
UNIQUE (tenant_id, source_prospect_id)
```

Global external IDs such as Stripe object IDs and Vercel deployment IDs may remain globally unique.

## Migration order

### Phase 1: Foundation

1. Create `tenants`, `tenant_memberships`, `tenant_settings`, `tenant_branding`, `tenant_billing`, `tenant_usage_events`.
2. Insert CajunSites tenant ID 1.
3. Add all existing internal users as tenant 1 memberships.
4. Do not change visible application behavior.

### Phase 2: Direct tenant ownership

Add and backfill `tenant_id=1` on:

- `prospects`
- `customers`
- `admin_activity`
- `concept_builds`
- `concept_images`
- `design_chat_messages`
- `platform_jobs`
- `provider_usage_events`
- `website_leads`

### Phase 3: Parent-derived records

Add/backfill tenant IDs by joining their parents:

```sql
UPDATE customer_notes
SET tenant_id=(SELECT tenant_id FROM customers WHERE customers.id=customer_notes.customer_id);
```

Repeat for:

- `customer_notes`
- `customer_sites`
- `onboarding_submissions`
- `billing_snapshots`

### Phase 4: Tenant-aware authorization

Introduce one active tenant context resolver and require it at the top of every authenticated API request. Replace role-only authorization with membership role authorization.

### Phase 5: Query conversion

Convert every tenant-owned query from ID-only to tenant + ID. Lists and aggregates must always filter tenant. Inserts must receive tenant from context.

### Phase 6: Cross-tenant invariant tests

Create Tenant A and Tenant B fixtures and prove Tenant A cannot:

- list Tenant B prospects/customers
- fetch a record by guessed ID
- research or rebuild Tenant B prospect
- load Tenant B Design Studio conversation
- apply Tenant B design proposal
- proxy Tenant B concept deployment
- convert Tenant B prospect
- read or mutate Tenant B notes/site/billing
- send Tenant B invoice
- see Tenant B activity/usage/jobs
- change Tenant B memberships/settings/branding

Every test should expect 404 or 403 without leaking whether the other tenant record exists.

## Required schema correction before migration is merged

The current SaaS foundation migration must use the existing identity table name `internal_users`, not `admin_users`, when backfilling CajunSites memberships.

## Tables that should remain global

These should not receive a normal tenant ownership column:

- `tenants`
- `internal_users`
- `admin_sessions`
- `admin_login_attempts`

`research_cache` can remain globally reusable only if it contains exclusively public business research keyed by exact business identity. If tenant-entered/private data is ever included, split the cache into a global public-research cache and a tenant-owned enrichment cache.

## Definition of done for Tenant Isolation Phase 1

Tenant isolation is complete when:

1. Every current CajunSites operational record belongs to tenant 1 or is intentionally global.
2. Every authenticated API resolves a membership-backed tenant context.
3. No tenant-owned query uses only a record ID.
4. Every aggregate/list is tenant filtered.
5. Every insert derives tenant from trusted context.
6. Stripe/public routes resolve tenant from trusted external bindings rather than request bodies.
7. Cross-tenant tests cover reads, writes, AI operations, deployment preview, billing and conversion.
8. Existing CajunSites behavior remains unchanged as tenant 1.
