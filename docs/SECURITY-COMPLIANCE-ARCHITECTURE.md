# CajunSites SaaS Security & Compliance Architecture

## Objective

Build the CajunSites SaaS platform so the technical architecture, operating controls, and evidence model support future ISO/IEC 27001:2022 certification readiness and SOC 2 examination readiness without requiring a security redesign later.

This document is an engineering guardrail, not a certification claim.

## Core principle

Security and compliance requirements must be built into the SaaS foundation now, especially while multi-tenancy, identity, billing, deployment, logging, and provider integrations are being redesigned.

The platform should preserve evidence automatically wherever practical.

## Security architecture requirements

### 1. Tenant isolation

- Every tenant-owned record must be bound to a tenant.
- Every authenticated data request must resolve tenant context server-side.
- Database operations must include tenant ownership in authorization checks.
- Cross-tenant access must fail even when a valid record ID is supplied.
- Child records must inherit or validate the tenant of their parent.
- Background jobs, webhook handlers, AI jobs, deployments, images, billing records, and activity events must retain tenant context.
- Automated tests must explicitly attempt cross-tenant reads and writes.

### 2. Identity and access management

Use a global user identity with tenant-specific membership and role assignment.

Required properties:
- Unique user identity.
- Tenant membership separated from global identity.
- Least-privilege tenant roles.
- Platform-administration roles separated from tenant roles.
- MFA-ready authentication architecture.
- Session expiration and revocation.
- Password security using dedicated secrets and modern password hashing/derivation.
- User lifecycle states for active, suspended, and removed access.
- Audit events for sign-in, failed sign-in, role changes, membership changes, password reset, session revocation, and administrative actions.
- Periodic access review capability.

### 3. Privileged access separation

Separate:
- Platform administrators
- Tenant owners/admins/operators/read-only users
- System/service identities
- External provider credentials

Platform administrators must not implicitly become members of every tenant through ordinary tenant APIs.

Emergency/platform support access should be explicit, time-bounded where practical, and logged.

### 4. Audit logging

Security-relevant and business-critical actions must generate durable audit events containing, where applicable:
- event ID
- timestamp
- tenant ID
- actor ID / system identity
- actor role
- event type
- target resource type and ID
- action/result
- source context
- relevant request or correlation ID
- metadata sufficient to reconstruct what occurred

Examples:
- authentication events
- tenant creation
- membership/role changes
- prospect creation/update/delete
- research runs
- AI generations
- Design Studio changes
- concept builds
- alias/domain changes
- customer conversion
- billing/invoice/subscription actions
- configuration changes
- webhook processing
- deployment failures and rollbacks
- data exports/deletions

Logs should be append-oriented. Ordinary tenant users must not be able to alter historical audit records.

### 5. Evidence retention

Design operational evidence so future control testing can retrieve it without reconstructing events manually.

Evidence sources should include:
- GitHub commits and pull requests
- CI/CD runs and tests
- deployment records
- Cloudflare/Vercel configuration and deployment events
- application audit logs
- authentication records
- tenant membership history
- provider usage records
- Stripe billing event history
- incident records
- vulnerability/dependency scan results
- backup/restore test evidence
- change approvals where required

Retention periods should eventually be governed by formal policy.

### 6. Change management / SDLC

Production changes should support:
- source control
- reviewable change history
- automated tests
- security regression tests
- branch protections / controlled merge process
- CI success before production release
- deployment traceability from production version to commit SHA
- rollback procedures
- emergency-change documentation

Security-sensitive changes should have explicit tests or documented validation.

### 7. Secure development

Required engineering practices:
- no secrets in source control
- centralized secret management through deployment environment
- dependency inventory
- automated dependency/security scanning
- input validation
- output encoding
- CSRF/same-origin protections where applicable
- strict authorization independent of UI controls
- secure webhook validation
- rate limiting for authentication and abuse-sensitive APIs
- structured error handling that avoids exposing secrets/internal details
- security headers for browser-facing applications
- periodic threat modeling for major architecture changes

### 8. Encryption and secrets

- HTTPS/TLS for all external traffic.
- Provider/API credentials stored only in secrets/environment configuration.
- Dedicated secrets by purpose where possible.
- No fallback reuse of unrelated secrets for cryptographic operations in the mature SaaS architecture.
- Sensitive stored data should be classified before deciding whether application-level encryption is needed in addition to provider-managed encryption at rest.
- Secret rotation procedures must be supportable without code changes.

### 9. Data classification and minimization

Define data classes before public SaaS release:
- Public business information
- Tenant confidential data
- Customer confidential data
- Authentication/security data
- Billing metadata
- Personal information
- Secrets/credentials

Collect only what the service needs. Do not store raw payment card data.

AI prompts and provider payloads must be evaluated against classification rules so confidential tenant/customer information is not sent unnecessarily.

### 10. Vendor / subprocessor governance

Maintain an inventory for providers such as:
- Cloudflare
- Vercel
- Stripe
- OpenAI
- Resend
- GitHub
- other research/data providers

For each, track:
- purpose
- data processed
- authentication method
- criticality
- contract/DPA status where applicable
- security/compliance posture
- availability dependency
- incident notification expectations
- offboarding/data deletion considerations

### 11. Availability and resilience

The platform should explicitly support:
- health monitoring
- build/deployment failure detection
- safe rollback
- retry behavior for transient provider failures
- backup strategy for D1/application data
- recovery procedures
- periodic restore testing
- documented recovery objectives later (RTO/RPO)
- provider-outage handling

The existing candidate-build, verification, alias activation, and rollback model should remain because it is consistent with controlled production changes.

### 12. Incident response readiness

Build features that make future incident response practical:
- correlation/request IDs
- timestamped audit logs
- actor/tenant context
- provider/deployment traceability
- security event logging
- ability to revoke sessions
- ability to suspend users/tenants
- ability to rotate credentials
- ability to determine affected tenants/resources

A formal incident response policy/runbook will be required before certification/examination readiness.

### 13. Business continuity and backups

Before external SaaS launch, establish:
- documented backup scope
- backup frequency
- retention
- restore procedure
- restore testing cadence
- responsible owner
- disaster recovery procedure
- evidence of tests

### 14. Privacy and data lifecycle

The architecture must support:
- tenant/customer data export where required
- data correction
- account/tenant deletion workflow
- retention policy enforcement
- deletion of dependent data
- provider-side deletion/offboarding where applicable
- preservation of records that must legally or operationally be retained

### 15. Risk management

Maintain a platform risk register covering at minimum:
- cross-tenant data exposure
- compromised administrator account
- exposed provider credential
- malicious/unsafe AI-generated content
- incorrect business identity resolution
- fraudulent billing/webhook activity
- domain/DNS takeover or misconfiguration
- dependency compromise
- provider outage
- data loss
- failed backups
- unauthorized production change

Technical mitigations should map back to risks rather than exist only as isolated features.

## SOC 2 readiness emphasis

Initial target should be the Security Trust Services Criterion as the baseline. Availability and Confidentiality should be designed in from the start because they are likely relevant to a hosted SaaS platform.

Engineering should preserve evidence for controls around:
- logical access
- change management
- system operations
- risk mitigation
- monitoring
- vendor management
- incident response
- availability
- confidentiality

## ISO/IEC 27001 readiness emphasis

The platform architecture should support an eventual ISMS by making control ownership and evidence observable. Engineering controls should be capable of mapping to the ISO/IEC 27001:2022 Annex A themes, including organizational, people, physical, and technological controls, while recognizing that certification also requires governance, policies, risk treatment, management review, internal audit, corrective actions, and other non-code activities.

## Required SaaS-foundation acceptance criteria

Before onboarding a second real tenant:

1. Cross-tenant read/write isolation tests pass.
2. Tenant context is resolved server-side for all tenant APIs.
3. Critical audit events include tenant, actor, target, timestamp, and result.
4. Platform admin and tenant admin authorization are separated.
5. Secrets are not stored in tenant database records when a provider secret store/environment binding is appropriate.
6. Production deployment is traceable to source revision.
7. Billing/webhook processing derives tenant from trusted mappings, not user-supplied tenant IDs.
8. Background jobs retain tenant ID.
9. AI usage/events retain tenant ID and provider/model attribution.
10. Data deletion/retention design is documented before external beta.
11. Backup and restore procedures exist and have been tested before general availability.
12. Security regression tests are part of CI.

## Engineering rule going forward

Every new SaaS feature should answer these questions during implementation:

1. Who owns this data?
2. How is tenant authorization enforced?
3. What is the least privilege required?
4. What audit event proves the action occurred?
5. What sensitive data is involved?
6. Which third party receives data?
7. How is the change tested?
8. How would we detect misuse or failure?
9. How would we recover?
10. What evidence would an auditor ask for?

If those answers are not clear, the feature is not complete from a SaaS security architecture perspective.
