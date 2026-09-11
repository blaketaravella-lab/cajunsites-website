# CajunSites Platform Hardening Implementation

Date: 2026-09-11

This document records the implementation work completed after the end-to-end project audit and identifies the remaining operational follow-ups.

## 1. Admin Access Protection

Completed.

- `/admin` and `/admin/*` now run through the Cloudflare Worker before static assets are served.
- `/admin/login/` is the only unauthenticated admin page.
- Other admin pages require a valid CajunSites admin session and redirect to the login page when unauthenticated.
- API authorization remains server-side and role based.
- The older client-side login overlay remains as a session-expiry fallback, not as the primary access control.

Remaining improvement: add a mobile-visible Sign Out control to the compact dashboard navigation.

## 2. Internal Password Security and Login Throttling

Completed for current application behavior.

- New user and password-reset writes use the `hmac_v2` password scheme.
- Existing HMAC records continue to work.
- Legacy PBKDF2 records are accepted once and upgraded to `hmac_v2` after a successful login.
- Login attempts are rate-limited by hashed normalized email plus hashed client IP.
- Five failed attempts inside fifteen minutes produce a temporary rate limit.
- Successful authentication clears prior failed attempts for that login key.

Runtime secret policy:

- Preferred secret: `ADMIN_PASSWORD_PEPPER`
- Compatibility fallback: `ADMIN_DASHBOARD_PASSWORD`

Operational follow-up: configure a dedicated `ADMIN_PASSWORD_PEPPER` secret in Cloudflare. Do not remove the legacy secret until the bootstrap/login dependency has been intentionally redesigned and all active user records are confirmed migrated.

## 3. Stripe Billing Lifecycle

Completed in Worker code and the live Stripe webhook endpoint was expanded.

Handled events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `invoice.payment_failed`
- `invoice.paid`
- `invoice.payment_succeeded`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`

Lifecycle behavior:

- Failed recurring payment moves the customer to `Payment Issue` and preserves the previous workflow status.
- Successful recovery restores the preserved workflow status and marks billing current.
- Bad subscription states can set `Payment Issue`.
- Subscription deletion sets `Cancelled`.
- Refund activity is recorded without automatically assuming the entire customer relationship should be cancelled.
- Prospect conversion finalization now fails the webhook response if the verified paid event cannot be linked correctly, allowing Stripe to retry instead of silently accepting an incomplete conversion.

Financial dashboard metrics remain operational models. Stripe is the source of truth for realized revenue and subscription state.

## 4. Database and Migration Hardening

Completed in source control, with production migration application still requiring controlled reconciliation.

- Added `0001_base_schema.sql` for the original customer schema.
- Removed historical prospect seed inserts from `0005_prospects.sql`.
- Removed runtime automatic prospect repopulation when the table is empty.
- Added visual-engine metadata migration.
- Added security, billing, and website-lead schema definitions.

Important production note: several columns were historically created at request time. Do not blindly apply newer `ALTER TABLE ... ADD COLUMN` migrations to an already-mutated production D1 database. Compare the live schema first and reconcile migration state before applying them.

Long-term target: no request-time schema mutation. Runtime code should verify schema rather than modify it.

## 5. Central Visual Family Engine

Completed.

All concept builds use one multi-signal classifier and one rendering path. The previous vertical-specific Car Wash wrapper was removed.

Weighted classification inputs:

- researched vertical
- stored business vertical
- prospect category
- verified services
- suggested sections
- review themes

Current visual families:

- Car Wash / Auto Care
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
- Generic Local Business fallback

Each family owns its color system, messaging direction, calls to action, process language, section defaults, and curated representative image pools. Deterministic prospect-based selection chooses layout and imagery variants while keeping rebuilds stable.

Stored build metadata includes visual family, visual version, visual variant, classifier score, classifier signal, and fallback state.

## 6. Rebuild Cleanup and Concept Observability

Completed.

- Replacement concepts retain the previous deployment ID during the build.
- The new deployment must become ready and receive its DNS/domain alias before old deployment cleanup is attempted.
- Generic visual fallback is stored explicitly.
- Concept build/research activity records classifier and research details.
- Prospect deletion remains fail-closed and cleans the prospect domain, deployment, and DNS record before deleting the prospect record.

## 7. CI and Regression Protection

Completed for the current hardening scope.

CI now runs:

1. Worker JavaScript syntax validation
2. Visual Family Engine classifier tests
3. Platform invariant tests
4. Astro production build

Platform invariants protect admin Worker routing, removal of prospect auto-seeding, login throttling, unified password writes, Stripe lifecycle event handling, Visual Family Engine usage, visual fallback metadata, prospect asset cleanup, admin health reporting, and website lead persistence.

Future test expansion should mock D1 and external services to exercise webhook idempotency, lifecycle transitions, onboarding persistence, and cleanup failures behaviorally rather than only checking source invariants.

## 8. Dashboard Operational Improvements

Completed for the first hardening pass.

Overview now surfaces:

- open prospects
- overdue prospect follow-ups
- research failures
- concept build failures
- checkout started but unpaid
- generic visual fallbacks
- paid customer production workload
- modeled healthy base MRR

Analytics now includes the prospect funnel and customer fulfillment funnel, closed win rate, payment issues, and generic visual fallbacks. It intentionally avoids presenting customer-count multiplied by `$499` as realized launch revenue.

Settings now uses a protected health endpoint instead of hard-coded `Configured` labels for the major platform bindings/secrets.

Remaining dashboard improvements:

- mobile-visible Sign Out
- richer visual-family metadata on Prospect Details
- direct links/filters from Overview exception cards
- time-to-stage and revision-cycle analytics once sufficient data exists
- assignment, due date, and blocked reason as fulfillment volume grows

## 9. Website Inquiry Persistence

Completed.

A successful `/api/lead` submission still sends the existing notification email and now also persists operationally. CajunSites creates or links a Prospect record and stores the source inquiry in `website_leads`.

Inbound website inquiries are marked as requiring website-gate verification before they are treated as qualified cold-prospect opportunities.

Onboarding direct file upload is not yet implemented. The current production form continues to accept shared asset links. Recommended future implementation is controlled object storage such as Cloudflare R2 with authenticated/signed upload handling, file type/size restrictions, retention policy, and customer-record linkage.

## 10. Public Offer Naming and Configuration Hygiene

Remaining cleanup.

The locked customer-facing recurring service name is `Hosting & Maintenance`. Any remaining `Hosting & Support` copy in marketing metadata, structured data, or page content should be normalized to the locked term.

Repeated runtime constants such as Payment Link ID, concept project name, DNS service URL, sender identity, and internal destination should gradually move into a small typed/configured constants module or environment configuration where appropriate.

## Google Reviews Policy for Concept Builds

Google reviews should improve concept credibility, but only through verified aggregate information and non-quoted themes.

Research now requests:

- exact-business identity confidence
- current Google rating when directly supported
- current Google review count when directly supported
- Google Maps / Business Profile source URL
- broad recurring review themes

Rules:

- Match the exact business using name plus location and phone/address when available.
- If identity confidence is low, block concept generation for manual review.
- Do not copy individual Google review text.
- Do not store or display reviewer names from research.
- Do not invent or estimate ratings or review counts.
- Do not claim a testimonial is customer-authorized merely because it is publicly visible.
- If an exact current Google source cannot support both rating and count, omit the aggregate.
- Broad review themes may influence concept copy and the existing `What customers mention` section.
- Numeric Google rating/review-count presentation should only be rendered when the verified aggregate exists and should link to the source listing.

This approach uses reviews as evidence and social-proof context without turning concept generation into review scraping or unsupported testimonial reproduction.
