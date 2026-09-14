# CajunSites

Production website and internal operations platform for CajunSites.com.

## What is in this repository

- Public CajunSites marketing site
- Customer onboarding form
- Privacy Policy and Terms
- Internal admin dashboard
- Cloudflare Worker API/runtime
- D1-backed customers, prospects, operations, and internal-user data
- Stripe checkout/webhook handling
- Resend transactional email
- Cloudflare Turnstile form protection
- Automated prospect business research and enrichment
- Design Intelligence and Design Studio
- AI-generated representative concept imagery with visual QA
- Vercel concept-site generation, verification, rollback, and CajunSites subdomain automation
- Prospect-to-customer conversion workflow

## Stack

- Astro static site
- Cloudflare Workers, D1, DNS, SSL/CDN, Email Service, and Turnstile
- GitHub source control and CI
- Stripe Billing/Checkout
- Resend
- OpenAI business research, design assistance, image generation, and visual QA
- Vercel prospect concept hosting

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Astro output directory: `dist`

Cloudflare Worker entry point is defined in `wrangler.jsonc`. The current production entry point is `worker/concept-design-worker.js`, which retains stale-build recovery and the lower prospect, conversion, billing, enrichment, admin, and public-site worker chain.

## Runtime configuration

Production secrets and bindings belong in Cloudflare configuration, never in source control. Current runtime dependencies include D1, email binding, Turnstile, Stripe webhook verification, Resend, Vercel, CajunSites DNS integration, OpenAI, and dashboard authentication secrets.

## Database migrations

Tracked migrations are stored in `migrations/`. Some compatibility paths still self-initialize or extend schema at runtime. That remains transitional behavior and should be replaced by a complete canonical migration history before a new environment is expected to be reproducible from source alone.

## Product guardrails

- Human-entered prospect and sales information wins over automated research.
- Research and concept creation may be automated; outbound prospect outreach remains human-led until explicitly approved.
- Concepts are sales previews, not customer-approved production sites.
- Concept imagery must be representative and must not imply unverified actual staff, premises, customers, work, credentials, awards, or results.
- A rebuilt concept does not replace the current concept until generation, deployment, verification, and activation succeed.
- Failed or interrupted concept builds must return to an actionable state.
- Converted prospects do not continue through the prospect concept-build workflow.
- The Overview page is the benchmark for the admin visual language.

## Internal documentation

Operational documentation is available in the dashboard Documentation section. Current audits are tracked in:

- `docs/PROJECT-AUDIT-2026-09-11.md`
- `docs/PROJECT-ALIGNMENT-2026-09-14.md`

## Current priorities

- Validate the stabilized Concept Build path across active prospects and add vertical-specific image policies only where real failures justify them
- Harden Stripe recurring-payment, cancellation, and webhook reconciliation behavior
- Protect `/admin/*` at the server/Cloudflare Access layer, not only with the client login overlay
- Require a dedicated admin password pepper and retire remaining legacy/duplicated auth paths
- Formalize D1 migrations and remove request-time schema mutation
- Persist public website inquiries into the Prospect pipeline
- Separate onboarding-link signing from the Stripe webhook secret
- Keep Outreach Center execution deferred until explicitly approved

## Production safety

Never commit API keys, webhook secrets, dashboard passwords/peppers, Vercel tokens, DNS integration keys, or customer-sensitive data. Concept sites must not invent business claims, credentials, services, years in business, insurance, awards, testimonials, or availability.
