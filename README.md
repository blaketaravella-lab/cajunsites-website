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
- Automated prospect business research
- Vercel concept-site generation and CajunSites subdomain automation
- Prospect-to-customer conversion workflow

## Stack

- Astro static site
- Cloudflare Workers, D1, DNS, SSL/CDN, Email Service, and Turnstile
- GitHub source control and CI
- Stripe Billing/Checkout
- Resend
- OpenAI business research
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

Cloudflare Worker entry point is defined in `wrangler.jsonc` and currently routes through the prospect-cleanup/concept/conversion/admin worker chain.

## Runtime configuration

Production secrets and bindings belong in Cloudflare configuration, never in source control. Current runtime dependencies include D1, email binding, Turnstile, Stripe webhook verification, Resend, Vercel, CajunSites DNS integration, OpenAI research, and dashboard authentication secrets.

## Database migrations

Tracked migrations are stored in `migrations/`. Some early features also self-initialize schema at runtime. That is transitional behavior and should be replaced by a complete canonical migration history before a new environment is expected to be reproducible from source alone.

## Internal documentation

Operational documentation is available in the dashboard Documentation section. The current end-to-end technical and operational audit is also tracked in:

`docs/PROJECT-AUDIT-2026-09-11.md`

## Current priorities

- Protect `/admin/*` at the server/Cloudflare Access layer, not only with the client login overlay
- Unify internal-user password hashing across login, Add User, and Reset Password
- Harden Stripe subscription/payment lifecycle synchronization and webhook recovery
- Consolidate the concept build router and multi-signal vertical classifier
- Formalize D1 migrations and remove runtime seed/schema mutation
- Add Worker syntax, bundle, and behavior tests to CI
- Replace model-estimated dashboard revenue metrics with Stripe-backed financial state

## Production safety

Never commit API keys, webhook secrets, dashboard passwords/peppers, Vercel tokens, DNS integration keys, or customer-sensitive data. Concept sites must not invent business claims, credentials, services, years in business, insurance, awards, testimonials, or availability.
