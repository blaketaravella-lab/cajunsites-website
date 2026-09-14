# Concept Pipeline Service

Independent, tenant-isolated runtime for the CajunSites AI concept pipeline.

This directory is intentionally self-contained and can be split into a private repository without changing its internal paths.

## Current capabilities

- tenant-bound service credentials
- versioned `/v1` API
- tenant-scoped prospect shadow reads
- tenant-scoped build history
- idempotent build-queue acceptance
- tenant-prefixed generated-asset keys
- standalone D1 schema for prospects, builds, images, usage, audit, and migration reconciliation

The actual generation worker is not activated here yet. A queued build remains queued until the existing architecture, image QA, packaging, deployment verification, and rollback modules are moved behind the queue consumer.

## Provisioning gate

Do not deploy `wrangler.template.jsonc` as written. The placeholder database ID deliberately prevents accidental deployment against an unknown database.

Provision:

```bash
wrangler d1 create concept-pipeline-production
wrangler r2 bucket create concept-pipeline-assets
```

Copy `wrangler.template.jsonc` to `wrangler.jsonc`, replace `PROVISION_BEFORE_DEPLOYMENT` with the returned D1 database ID, then apply:

```bash
wrangler d1 migrations apply concept-pipeline-production --remote
```

## First tenant

Insert CajunSites with a stable external ID, then create a random service secret locally. Store only its SHA-256 hash in `tenant_api_credentials`. The presented token format is:

```text
cpt_live_<key_id>.<secret>
```

Recommended CajunSites scopes:

```json
["prospects:read", "prospects:write", "builds:read", "builds:write"]
```

Never commit the plaintext token.

## Cutover state

1. Provision isolated infrastructure.
2. Create the CajunSites tenant and service credential.
3. Import a checksum-bearing snapshot from the existing D1 database.
4. Compare row counts and build/image relationships.
5. Enable shadow reads from CajunSites.
6. Move generation modules and run end-to-end tests.
7. Enable writes through a feature flag.
8. Disable legacy writes only after the rollback window.
