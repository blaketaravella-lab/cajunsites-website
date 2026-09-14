# CajunSites Project Alignment Review

Date: 2026-09-14

## Product goal

CajunSites should make it fast and repeatable to find or receive a small-business prospect, build a credible personalized concept, use that concept in a human-led sales process, convert a win into a customer, and fulfill a simple website product without creating unnecessary agency overhead.

The operating product remains:

- $499 Website Design & Launch
- $49/month Hosting & Maintenance
- mobile-friendly small-business websites
- SEO foundation, secure hosting, and routine updates
- concepts are sales previews, not customer-approved production sites

## Non-negotiable operating rules

1. Human-entered prospect and sales information wins over automated research.
2. Research may enrich business facts, but must not overwrite human sales workflow fields.
3. Prospect research and concept generation may be automated.
4. Outreach remains human-led for now. No automated cold email, SMS, calling, or Outreach Center execution should be introduced until explicitly approved.
5. Concept imagery must be representative, relevant to the verified business identity, and must not imply actual premises, staff, customers, projects, credentials, awards, or results unless supplied and verified.
6. A concept rebuild must never replace the currently usable concept until the replacement passes generation, packaging, deployment, verification, and activation.
7. Failed or interrupted builds must recover to an actionable state rather than remain permanently Building.
8. Converted prospects are historical sales records and should not continue through the prospect concept workflow.
9. Admin UX should use the Overview visual language as the benchmark: quiet neutral surfaces, clear hierarchy, restrained purple/gold, consistent spacing, and mobile-safe behavior.
10. Secrets stay in runtime configuration, not source control.

## Alignment status

### Prospect pipeline: aligned

The current enrichment path preserves manual provenance and protects existing human-entered business data. Automated research and concept creation are supported while human sales fields such as call attempts, next follow-up, and decision-maker state remain outside research mutation.

The current project intentionally does not include automated outreach execution. That remains deferred.

### Concept design and Design Studio: aligned, actively hardening

Design Studio saves constrained design directives and starts rebuilds through the public top-level Concept Build endpoint. This preserves Design Intelligence, image QA, deployment verification, and build diagnostics.

Concept Build now provides:

- Design Intelligence before rendering
- adaptive visual-family selection
- AI-generated representative imagery
- vertical-specific image QA, including restaurant-specific policy
- build-stage persistence
- deployment-local image assets
- Vercel deployment verification
- alias activation only after verification
- rollback behavior
- stale-build recovery
- persistent stage/build diagnostics in Design Studio

The current priority is quality and reliability, not adding more design controls.

### Admin operations experience: aligned

The admin application now shares a common design system and final alignment layers. Overview remains the visual reference. Navigation, mobile layout, page spacing, content separation, status treatment, and Prospect Workspace have automated invariant checks.

### Customer conversion and fulfillment: mostly aligned

Prospect-to-customer conversion, customer lifecycle statuses, onboarding capture, billing surfaces, notes, sites, and operational activity are present.

Remaining lifecycle hardening is still appropriate before larger customer volume:

- Stripe recurring-payment and cancellation events need fuller synchronization.
- Webhook reconciliation/retry should become more durable.
- Onboarding persistence should become atomic or explicitly retryable.
- The onboarding signing secret should be separated from the Stripe webhook secret.

### Security: partially aligned

Good controls already present include HttpOnly/Secure/SameSite admin sessions, application-level login throttling, password scheme tagging/upgrades, same-origin mutation checking, role checks, Turnstile, signed Stripe webhooks, and no secret values in source.

Remaining security work:

- Protect `/admin/*` at the server or Cloudflare Access layer instead of relying on the client login overlay to hide static admin HTML.
- Require a dedicated `ADMIN_PASSWORD_PEPPER` and remove fallback use of the bootstrap dashboard password as the long-term pepper.
- Remove duplicated legacy PBKDF2 auth implementation that still exists in the lower admin worker after the top-level auth wrapper became canonical.
- Consider making the GitHub repository private before meaningful customer data/volume grows.

### Data model and migrations: partially aligned

D1 is functioning as the system of record for prospects, concept builds, images, customers, billing snapshots, jobs, activity, and admin identity. However, runtime `CREATE TABLE` / `ALTER TABLE` compatibility bootstraps remain widespread.

Target state remains explicit canonical migrations with runtime verification rather than request-time schema mutation.

### Public funnel: mostly aligned

Pricing and offer naming are currently consistent on the main public site: Website Design & Launch and Hosting & Maintenance.

The largest remaining funnel gap is that the public Get Started inquiry currently sends an email but does not create a Prospect record. Inbound sales leads should eventually enter the same prospect system so the business does not maintain two disconnected intake paths.

## Current implementation priorities

### Priority A: stabilize the core sales-preview engine

1. Validate Anita restaurant rebuild after restaurant-specific QA policy deployment.
2. Validate Costa stale-build recovery and successful retry.
3. Continue adding vertical-specific image policies only when failures reveal a real gap.
4. Keep the current fail-closed image/verification posture rather than disabling QA to make builds pass.

### Priority B: operational integrity before customer volume

1. Full Stripe lifecycle synchronization and reconciliation.
2. Dedicated onboarding signing secret.
3. Canonical D1 migrations and removal of runtime schema mutation.
4. Server-side protection for admin assets.
5. Persist public inquiries as prospects.

### Priority C: scale only after the workflow is dependable

1. Production-site structure/hand-off automation.
2. Customer asset upload improvements.
3. Broader vertical policy coverage based on actual pipeline demand.
4. Outreach Center remains roadmap-only until explicitly approved.

## Guardrail

A CI goal-alignment test should remain in the repository to protect the rules above. New work should fail review if it silently introduces automated outreach, weakens manual-data precedence, bypasses the top-level Concept Build pipeline, removes rollback/verification, changes canonical pricing, or drops the admin visual-alignment layers.
