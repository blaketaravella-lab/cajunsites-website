# Concept Pipeline Extraction

## Decision

The AI concept pipeline will become a separate multi-tenant product. CajunSites will be its first tenant and later consume it through a tenant-authenticated API.

This extraction is staged so the current prospect and concept workflow remains usable throughout the transition.

## Tenant boundary

Every tenant-owned record must carry a non-null `tenant_id`. Authorization is derived from the authenticated user's active membership. A tenant identifier supplied by a browser or API caller is never trusted without checking that membership.

Tenant-owned pipeline data includes:

- prospects and verified research
- concept strategy and design artifacts
- build jobs and deployment state
- generated images, prompts, QA, and manifests
- design conversations
- provider usage and cost events
- cached research
- future tenant API credentials and audit events

Secrets, provider configuration, and globally versioned policy definitions are platform configuration. They must not contain tenant business data.

## Milestones

### 1. Compatibility foundation

- Create tenants and memberships.
- Seed CajunSites as tenant 1.
- Backfill existing pipeline records to CajunSites.
- Add compound tenant indexes.
- Add relationship triggers that prevent child records from crossing prospect tenants.
- Add a reusable server-side tenant context.

No customer data moves during this milestone.

### 2. Enforce the request boundary

- Return the active tenant in the authenticated session response.
- Require tenant context on every prospect, design, build, preview, image, job, cache, and usage query.
- Put `tenant_id` in every insert, update, and uniqueness decision.
- Reject unscoped internal helper calls.
- Add two-tenant negative tests proving tenant A cannot read, mutate, build, preview, or enumerate tenant B records.

### 3. Separate runtime

Create a private repository and independent Cloudflare Worker with:

- its own D1 database
- its own generated-asset storage
- independent provider and deployment secrets
- a versioned service API
- tenant-scoped audit logging and usage accounting

CajunSites remains the source of prospect intake until the new service is ready.

### 4. Copy and reconcile data

- Pause concept mutations briefly.
- Export tenant-owned pipeline rows.
- Import them into the new database with stable external IDs.
- Verify row counts, build history, image metadata, deployment pointers, and hashes.
- Run CajunSites in shadow-read mode against the new service.
- Keep the old data intact during the rollback window.

### 5. Cut over CajunSites

- Issue a CajunSites service credential bound only to the CajunSites tenant.
- Route concept operations through the service API.
- Verify research, build, preview, rebuild, failure recovery, and usage tracking.
- Disable legacy writes after reconciliation.
- Remove the embedded implementation only after the rollback window closes.

## Current milestone

Milestone 1 is implemented on the extraction branch. Applying its migration preserves current behavior because existing and compatibility-path records default to tenant 1. That default is transitional and must be removed after every write path explicitly supplies tenant context.
