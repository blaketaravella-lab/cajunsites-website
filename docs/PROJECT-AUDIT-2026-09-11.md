# CajunSites End-to-End Project Audit

Date: 2026-09-11

## Executive Summary

CajunSites has a working public marketing site, Stripe checkout/onboarding flow, Cloudflare Worker backend, D1 operational database, internal dashboard, prospect pipeline, automated business research, concept generation, prospect cleanup, and prospect-to-customer conversion. The platform is suitable for controlled sales validation, but several areas should be hardened before customer volume increases.

During this audit, three immediate issues were corrected: prospect deletion now fails closed when concept assets cannot be cleaned up, internal login now accepts both password formats currently produced by the application, and CI now syntax-checks all Worker JavaScript in addition to building Astro.

The highest remaining priorities are server-side protection of `/admin/*`, one explicitly versioned password-storage scheme with a dedicated pepper, Stripe subscription-state synchronization, a consolidated concept-factory/classifier, canonical D1 migrations, and broader Worker behavior tests.

## Changes Completed During This Audit

### Prospect cleanup now fails closed

Built concepts require Vercel and DNS cleanup credentials. If cleanup fails, the D1 prospect record remains instead of silently orphaning concept assets. Customer-linked prospects remain protected from deletion.

### Internal password compatibility restored

The login path now checks the HMAC format used by the current authentication/bootstrap path and also accepts PBKDF2 records produced by the original Add User/Reset Password path. This fixes the immediate risk of user-management actions creating credentials that cannot log in.

This is a compatibility measure, not the final cryptographic design. The target remains one explicitly versioned password scheme shared by bootstrap, login, Add User, Reset Password, and future password changes, with a dedicated password pepper separate from any bootstrap credential.

### Worker syntax validation added to CI

GitHub Actions now runs `node --check` against every `worker/*.js` file before the Astro build. This catches syntax errors that an Astro-only build would miss.

## Priority 0: Security and Data Integrity

### Protect the dashboard server-side

Admin pages are static Astro assets. The login overlay protects API data, but the HTML for Documentation, Settings, Templates, and other dashboard pages can still be requested directly because Worker-first asset routing currently applies to `/api/*`, not `/admin/*`.

Recommended end state: protect `/admin/*` with Cloudflare Access or route `/admin/*` through authenticated Worker handling. `noindex` is not an access control.

### Finish password-storage consolidation

Current login compatibility handles both HMAC and PBKDF2 records, but maintaining two implicit formats is technical debt. Add an explicit hash scheme/version and migrate to one shared implementation.

Also separate the password pepper from the bootstrap owner credential. A runtime secret should not serve both purposes.

### Add login throttling

Admin login has no application-level failed-login throttling. Add Cloudflare rate limiting or a D1/KV-backed attempt policy per IP and normalized email.

## Priority 1: Payments, Webhooks, and Customer Lifecycle

### Synchronize subscription state

The Worker currently centers on successful Checkout Session events. Add handling for recurring payment failures, successful recovery, subscription cancellation, and relevant refund events. Customer billing state should not depend entirely on manual dashboard changes after checkout.

### Do not calculate financial analytics from customer count alone

Dashboard MRR currently assumes every non-cancelled customer contributes $49/month, and launch revenue assumes every customer represents $499. Replace these estimates with Stripe-derived subscription/payment state or clearly label them as model estimates. `Payment Issue` should not count as healthy recurring revenue.

### Make prospect conversion webhook repairable

The conversion wrapper calls the base signed webhook handler first and then links a prospect to the customer. A conversion-finalization error can occur after the base handler has already produced a successful response. A prospect-referenced event should either fail so Stripe retries, or write a durable reconciliation job/state that can be retried safely.

### Track internal notification state separately

The welcome email has a persisted sent flag. The internal paid-customer notification does not have equivalent durable state and is attempted only when the customer row is first inserted. Add a separate notification state so transient failures can be retried.

### Make onboarding persistence atomic/recoverable

The base onboarding handler can update the customer to `Onboarding Received` and return success before the dashboard wrapper persists the detailed onboarding payload. If payload persistence fails, status and stored intake can diverge. Move onboarding persistence into one transaction-like operation where possible, or add a durable retry/reconciliation path.

## Priority 1: Concept Factory

### Consolidate the routing architecture

Current Worker request routing is layered through multiple Worker-like wrappers:

`prospect-cleanup -> vertical-concepts -> conversion -> concept-factory -> prospects -> auth -> app -> index`

This works, but route ownership and error propagation are becoming difficult to reason about. Refactor toward one top-level router that imports focused service functions rather than forwarding Requests through nested `fetch()` implementations.

### Use one multi-signal vertical classifier for every concept

The Car Wash path correctly evaluates researched vertical, prospect category, verified services, and suggested sections. The base concept factory still primarily selects one vertical/category value.

Move multi-signal classification into the core concept factory and use it for all visual families.

Recommended first-class visual families:

- Car Wash / Auto Detailing
- Collision / Auto Body
- Auto Repair / Diesel
- Towing / Roadside
- Plumbing
- Cleaning
- Beauty / Salon
- Massage / Wellness
- Childcare / Learning
- Floral
- Professional Services
- Home Services / Trades
- Restaurant / Food Service when intentionally supported
- Generic Local Business only as an explicit fallback

### Make fallback visible

If no specialized family matches, store `visual_family=generic` and show a warning in Prospect Details such as `No specialized visual preset matched`. A generic result should be an explicit operational condition, not a silent fallback.

### Reduce same-industry repetition

Each visual family should have a curated image pool, layout variants, hero treatments, CTA variants, and section-order variants. Select deterministically from prospect ID or slug so rebuilds are stable while different businesses in the same vertical do not all look identical.

### Validate imagery before deployment

External image URLs should be checked during build. If an image is unavailable, use a known-good family fallback. Longer term, consider packaging approved concept imagery into controlled deployment assets rather than depending entirely on remote image URLs.

### Use research quality as an input

Research should include an identity-confidence result. Compare business name, city/state, phone/address, and source consistency. Low-confidence research should require manual review before generating persuasive concept copy.

### Clean or track prior concept deployments

A rebuild creates a new Vercel deployment and replaces `concept_deployment_id`. The previous deployment is not tracked in D1 and can remain in Vercel. Either delete the previous deployment after the replacement is ready and aliased, or add deployment history plus a retention policy.

### Surface research/build quality

Store and display:

- visual family
- classifier signal
- research identity confidence
- verified service/fact/source counts
- selected imagery
- build version
- generic-fallback warning

## Priority 1: Database and Migrations

### Add the missing base schema migration

Tracked migrations begin at `0002_admin_dashboard.sql`. Add a canonical `0001` migration for the original `customers` table and other base objects so a new environment can be recreated from source control.

### Stop request-time schema mutation

Several Worker modules issue `CREATE TABLE` or `ALTER TABLE` statements during normal requests. This was useful during rapid bootstrap, but production should use explicit migrations plus a schema-version mechanism. Runtime requests should verify required schema, not alter it.

### Add a migration for research fields

Research columns are currently created by runtime logic rather than a tracked migration. Add a safe forward migration for `research_status`, `business_vertical`, `research_json`, `research_error`, and `researched_at` after reconciling columns already created in production.

### Separate seed data from schema migrations/runtime

`0005_prospects.sql` contains the initial prospect list, and `prospects.js` can repopulate all initial prospects if the table becomes empty. This means an intentionally emptied production pipeline can silently be repopulated. Move prospect seeds to an explicit development/bootstrap action and remove runtime auto-seeding.

### Add relational integrity where practical

`prospects.customer_id` and `customers.source_prospect_id` use unique indexes but not explicit foreign keys. Define intended delete/update behavior and add constraints in a forward migration where D1 limitations permit it.

## Priority 2: Dashboard

### Protect and personalize the shell

- Keep the compact sidebar and current Prospect Details design direction.
- Add a mobile-accessible Sign Out control. The desktop topbar is hidden below 900px, which currently removes the visible Sign Out button.
- Format all activity timestamps for the operator rather than exposing raw database timestamps.
- Replace silent `catch {}` blocks with visible error and retry states.

### Make Overview prospect-aware

Add:

- prospects needing first contact
- overdue follow-ups
- concepts built but not contacted
- concepts viewed but not converted
- checkout started but unpaid
- research/build failures

### Improve Analytics

Add prospect funnel metrics:

- Qualified -> Concept Built
- Concept Built -> Contacted
- Contacted -> Concept Viewed
- Concept Viewed -> Won
- average days to conversion
- call attempts per win
- concept view rate
- win rate

Add fulfillment metrics:

- payment to onboarding
- onboarding to Ready to Build
- Ready to Build to Customer Review
- approval to launch
- revisions per customer

Financial metrics should ultimately come from Stripe rather than inferred customer counts.

### Replace hardcoded Settings health cards

Several Settings cards always display `Configured`. Add a protected `/api/admin/health` endpoint that safely checks bindings and dependencies without exposing secret values.

### Make Templates reflect actual visual families

The Templates page currently shows three broad foundations while the concept factory supports more granular visual behavior. Replace or supplement it with a Visual Families registry showing supported families, version, imagery strategy, CTA pattern, and fallback status.

### Add operational ownership and due dates

As volume grows, Build Queue should support assignee, due date, blocked reason, priority, and last-action timestamp.

## Priority 2: Public Funnel and Onboarding

### Normalize offer naming

The current internal standard is `Hosting & Maintenance`, while parts of the public homepage still use `Website Hosting & Support`. Choose one canonical customer-facing name and use it consistently in metadata, structured data, hero pricing, pricing cards, Stripe naming, Terms, and dashboard documentation.

### Persist marketing leads

The Get Started form currently sends email but does not create a dashboard prospect. Persist inquiries to D1 or create a Prospect record so inbound leads are not disconnected from operations.

### Improve onboarding asset collection

The onboarding form relies on shared links for logos/photos. Secure direct upload would reduce inaccessible-share-link problems and improve completion.

### Version onboarding signed links

Use a dedicated onboarding signing secret instead of the Stripe webhook secret. Consider expiration/reissue behavior so rotating the Stripe webhook secret does not unexpectedly invalidate outstanding onboarding links.

## Priority 2: Deployment and CI

CI now performs:

1. dependency install
2. JavaScript syntax checking for every `worker/*.js`
3. Astro production build

Next additions should include:

1. Wrangler bundle/dry-run validation
2. unit tests for vertical classification and lifecycle transitions
3. password compatibility/migration tests
4. signed onboarding token tests
5. prospect cleanup tests
6. conversion webhook idempotency/retry tests
7. smoke tests against a non-production environment

A lockfile should be added so CI dependency resolution is deterministic.

## Priority 2: Repository and Configuration Hygiene

The GitHub repository is currently public. No secret values should ever be committed, but public source exposes internal architecture, owner email, operational endpoints, Payment Link identifiers, and dashboard implementation. Consider making the repository private before customer volume grows.

Centralize repeated configuration such as Payment Link IDs, Vercel project name, DNS API URL, public sender email, and internal notification destination instead of hardcoding them across Worker modules.

Add an `.env.example` or `docs/RUNTIME-CONFIG.md` containing secret names only, never values.

## Recommended Implementation Order

1. Server-side protection for `/admin/*`
2. Versioned/shared password hashing plus login throttling
3. Stripe subscription/payment lifecycle synchronization and webhook reconciliation
4. Canonical D1 migrations and removal of runtime auto-seeding/schema mutation
5. Consolidated concept factory with one multi-signal visual-family registry
6. Prior deployment cleanup and concept observability
7. Worker bundle/unit/smoke tests
8. Dashboard prospect KPIs, accurate financial metrics, health endpoint, and mobile sign-out
9. Lead persistence and onboarding upload improvements
10. Repository privacy and configuration centralization

## Current Build-Concept Standard

A concept is a personalized sales preview, not the final production website. Representative stock imagery must match the business vertical and must never imply that pictured people, vehicles, buildings, work products, certifications, awards, or credentials belong to the prospect unless independently verified.

The final production website must use customer-approved facts/assets, undergo internal QA, and follow the normal customer lifecycle before launch.
