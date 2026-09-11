# CajunSites End-to-End Project Audit

Date: 2026-09-11

## Executive Summary

CajunSites has a working public marketing site, Stripe checkout/onboarding flow, Cloudflare Worker backend, D1 operational database, internal dashboard, prospect pipeline, automated business research, concept generation, prospect cleanup, and prospect-to-customer conversion. The project is functional enough for controlled sales validation, but several areas should be hardened before volume increases.

The highest priorities are: protect `/admin/*` at the server or Cloudflare Access layer, unify internal-user password hashing, make Stripe subscription state authoritative for billing metrics and lifecycle exceptions, consolidate the concept build router, formalize D1 migrations, and add automated Worker tests/validation to CI.

## Priority 0: Security and Data Integrity

### Protect the dashboard server-side

Admin pages are static Astro assets. The login overlay protects API data, but the HTML for pages such as Documentation, Settings, Templates, and dashboard structure can still be requested directly because Worker-first routing currently applies to `/api/*`, not `/admin/*`.

Recommended end state: protect `/admin/*` with Cloudflare Access or route `/admin/*` through the Worker and require a valid admin session before serving dashboard assets. `noindex` is not an access control.

### Unify password hashing

`worker/auth.js` verifies passwords with HMAC-SHA256 using `ADMIN_DASHBOARD_PASSWORD` as a server-side key, while `worker/app.js` still creates and resets user passwords with PBKDF2. This can create accounts whose passwords cannot be verified by the login path.

Recommended end state: one shared password module used by bootstrap, login, Add User, Reset Password, and future password changes. Store an explicit hash scheme/version per user if migration between schemes is required.

Also separate the dashboard password pepper from the bootstrap owner password. A runtime secret should not act both as a login credential and as the cryptographic pepper for every internal user.

### Add login throttling

Admin login has no application-level failed-login throttling. Add Cloudflare rate limiting or a D1/KV-backed attempt policy per IP and normalized email.

### Make prospect deletion fail closed

Prospect deletion now requires Vercel and DNS cleanup credentials when a concept exists. If external asset cleanup cannot be completed, the prospect record must remain in D1 rather than silently orphaning assets.

## Priority 1: Payments, Webhooks, and Customer Lifecycle

### Synchronize subscription state

The Worker currently centers on successful Checkout Session events. Add handling for recurring payment failures, successful recovery, subscription cancellation, and relevant refund events. Customer lifecycle should not depend entirely on manual dashboard changes after checkout.

Suggested Stripe events include the appropriate `invoice.*`, `customer.subscription.*`, and refund/payment events for the final billing design.

### Do not calculate financial analytics from customer count alone

Dashboard MRR currently assumes every non-cancelled customer contributes $49/month, and launch revenue assumes every customer represents $499 of earned launch revenue. Replace these estimates with Stripe-derived subscription/payment state or clearly label them as model estimates.

`Payment Issue` customers should not automatically be treated as healthy MRR.

### Make prospect conversion webhook repairable

The conversion wrapper calls the base signed webhook handler first and then links a prospect to the new customer. Conversion-finalization errors are logged after the base webhook can already return success. A prospect-referenced event should either fail the webhook so Stripe retries, or write a durable reconciliation record that can be retried safely.

### Track internal notification state separately

The welcome email has a persisted sent flag. The internal paid-customer notification does not have equivalent durable state and is only attempted on the first inserted customer row. Add a separate notification state so retries can recover from transient email failures.

## Priority 1: Concept Factory

### Consolidate the routing architecture

Current Worker request routing is layered through multiple Worker-like wrappers:

`prospect-cleanup -> vertical-concepts -> conversion -> concept-factory -> prospects -> auth -> app -> index`

This works, but route ownership and failure behavior are increasingly difficult to reason about. Refactor toward one top-level router that imports focused service functions instead of repeatedly forwarding `Request` objects through nested `fetch()` implementations.

### Use one multi-signal vertical classifier for every concept

The new Car Wash path correctly evaluates researched vertical, prospect category, verified services, and suggested sections. The base concept factory still relies primarily on a single selected vertical/category value.

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
- Generic Local Business only as a visible fallback

### Make fallback visible

If no specialized family matches, store `visual_family=generic` and show a warning in Prospect Details such as `No specialized visual preset matched`. A generic result should be an explicit operational condition, not a silent fallback.

### Reduce same-industry repetition

Each visual family should have a small curated image pool, layout variants, hero treatments, CTA variants, and section-order variants. Select deterministically from the prospect ID or slug so rebuilds are stable but different businesses in the same vertical do not look identical.

### Validate imagery before deployment

External image URLs should be checked during the build. If an image is unavailable, use a known-good family fallback. Long-term, consider copying approved concept imagery into controlled deployment assets instead of depending entirely on remote image URLs.

### Use research quality as an input

Research should include an identity-confidence result. Before concept generation, compare business name, city/state, phone/address, and source consistency. If confidence is low, require manual review instead of building persuasive copy from a potentially incorrect business match.

### Preserve prior deployments or clean them intentionally

A rebuild creates a new Vercel deployment and replaces `concept_deployment_id`. The previous deployment is not tracked in D1 and can remain in Vercel. Either delete the previous deployment after the replacement is ready and aliased, or add a deployment-history table and explicit retention policy.

### Surface research/build quality

Store and show:

- visual family
- classifier signal
- research confidence
- number of verified services/facts/sources
- image source/selection
- build version
- generic-fallback warning

This makes the concept factory observable instead of opaque.

## Priority 1: Database and Migrations

### Add the missing base schema migration

The tracked migrations begin at `0002_admin_dashboard.sql`. Add a canonical `0001` migration for the `customers` table and any other original production objects so a new environment can be recreated from source control.

### Stop request-time schema mutation

Several Worker modules issue `CREATE TABLE` or `ALTER TABLE` statements during normal requests. This helped bootstrap quickly, but production should use explicit migrations and a schema version table. Runtime requests should verify required schema, not alter it.

### Add a migration for research fields

Research columns are currently added by runtime logic rather than a tracked migration. Add a migration for `research_status`, `business_vertical`, `research_json`, `research_error`, and `researched_at`.

### Separate seed data from schema migrations

`0005_prospects.sql` contains the initial prospect list, and `prospects.js` can repopulate the list if the table becomes empty. Production schema migrations should not silently recreate sales prospects. Move seed data into an explicit development/bootstrap script and remove runtime auto-seeding.

### Add relational integrity where practical

`prospects.customer_id` and `customers.source_prospect_id` are protected by unique indexes but not by explicit foreign keys. Define intended delete/update behavior and add constraints in a forward migration where D1 migration limitations permit it.

## Priority 2: Dashboard

### Protect and personalize the dashboard shell

- Keep the approved compact sidebar and Prospect Details design direction.
- Add a mobile-accessible Sign Out control. The desktop topbar is hidden below 900px, which currently removes the visible Sign Out button.
- Format activity timestamps for the operator's local time instead of exposing raw database timestamps.
- Add loading, empty, and actionable error states consistently rather than silently swallowing `catch` blocks.

### Make Overview prospect-aware

Overview currently focuses mostly on customers. Add:

- prospects needing first contact
- overdue follow-ups
- concepts built but not contacted
- concepts viewed but not converted
- checkout started but unpaid
- research/build failures

### Improve Analytics

Add prospect funnel and conversion metrics:

- Qualified -> Concept Built
- Concept Built -> Contacted
- Contacted -> Concept Viewed
- Concept Viewed -> Won
- average days to conversion
- call attempts per win
- concept view rate
- win rate

Add fulfillment metrics:

- average time from payment to onboarding
- onboarding to Ready to Build
- Ready to Build to Customer Review
- approval to launch
- revisions per customer

Financial metrics should eventually be sourced from Stripe rather than inferred from customer count.

### Replace hardcoded Settings health cards

Several Settings cards always display `Configured`. Add a protected `/api/admin/health` endpoint that checks whether required bindings/secrets are present and whether D1/Vercel/DNS/Resend/OpenAI dependencies can be safely validated without exposing secret values.

### Make Templates reflect the real visual system

The Templates page currently shows three broad static foundations, while the concept factory has more granular vertical behavior. Replace or supplement this with a Visual Families registry showing each supported family, version, imagery set, CTA pattern, and fallback status.

### Add operational ownership and due dates

As customer volume grows, Build Queue should support owner/assignee, due date, blocked reason, and last-action timestamp.

## Priority 2: Public Funnel and Onboarding

### Persist marketing leads

The Get Started form currently delivers email. Also persist qualified inquiries into D1 or create a Prospect record so marketing leads are not disconnected from the dashboard pipeline.

### Improve onboarding asset collection

The onboarding form currently relies on shared links for logos/photos. That is workable for launch, but direct secure upload would improve completion rate and reduce inaccessible-share-link problems.

### Version onboarding and signed links

Use a dedicated onboarding signing secret rather than the Stripe webhook secret. Consider timestamped/expiring signed links or an explicit reissue process. Secret rotation should not unexpectedly invalidate every outstanding onboarding URL.

## Priority 2: Deployment and CI

Current GitHub Actions validates only the Astro build. A green build does not prove Worker JavaScript parses, routes correctly, or that dashboard/concept APIs behave correctly.

Minimum CI should include:

1. `npm run build`
2. syntax checking for every `worker/*.js`
3. a Wrangler dry-run or equivalent Worker bundle validation
4. lightweight unit tests for vertical classification and lifecycle transitions
5. tests for password hash consistency
6. tests for signed onboarding token verification
7. tests for prospect cleanup behavior
8. tests for webhook conversion idempotency/retry behavior

Use a lockfile and deterministic install process when the dependency set grows.

## Priority 2: Repository and Configuration Hygiene

The GitHub repository is currently public. No secret values should ever be committed, but the public repository exposes internal architecture, owner email, operational endpoints, Stripe Payment Link identifiers, and dashboard implementation. Consider making the repository private before customer volume increases.

Centralize repeated configuration such as Payment Link IDs, Vercel project name, DNS API URL, public sender email, and internal notification destination rather than hardcoding the same values across multiple Worker modules.

Add an `.env.example` or `docs/RUNTIME-CONFIG.md` containing secret names only, never values.

## Recommended Implementation Order

1. Server-side protection for `/admin/*`
2. Password hashing unification and login throttling
3. Webhook/subscription lifecycle hardening
4. Canonical D1 migrations and removal of runtime auto-seeding/schema changes
5. Consolidated concept factory and multi-signal visual-family registry
6. Old deployment cleanup and visual build observability
7. Worker CI/tests
8. Dashboard prospect KPIs, accurate financial metrics, health endpoint, mobile sign-out
9. Lead persistence and onboarding upload improvements
10. Repository privacy/configuration cleanup

## Current Build-Concept Standard

A concept is a personalized sales preview, not the final production website. Concept generation may use representative stock imagery, but the image must match the business vertical and must never imply that the pictured people, vehicles, building, work product, certifications, awards, or credentials belong to the prospect unless independently verified.

The final production website must use customer-approved facts and assets, undergo internal QA, and follow the normal customer lifecycle before launch.
