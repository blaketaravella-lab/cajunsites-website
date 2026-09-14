# CajunSites Build Reliability Review

Date: 2026-09-14

## Goal

Concept Build and Design Studio Apply & Rebuild should succeed reliably without weakening core safety rules. A usable existing concept must remain live until a replacement is fully verified and activated.

## End-to-end findings

### 1. Secondary image QA is too brittle

The image pipeline treats hero and secondary imagery almost identically. Secondary imagery is also compared against the approved hero for distinctiveness. A relevant, safe secondary image can therefore fail the entire build because of a modest score shortfall even when it has no hard-reject condition.

### 2. Specialty QA instructions were not reaching the QA model

Visual policies contain specialty-specific QA instructions, including the restaurant guidance added for Anita's Smokin Steak Burgers, but the QA prompt only included generic hard-reject rules and score thresholds. The policy-specific instructions were effectively metadata rather than active QA guidance.

### 3. Retry diagnostics are discarded

After three image attempts, the pipeline returned only a generic `Suitable <role> imagery could not be verified` message. The final score, failed dimensions, and last QA explanation were lost, making repeated failures difficult to tune correctly.

### 4. New-prospect automatic builds run inside `waitUntil`

The Add Prospect flow redirects immediately while research and a full concept build continue in a Worker `waitUntil` task. Research, two image generations, two visual-QA requests, packaging, Vercel deployment, verification, DNS, and alias activation can exceed the background lifetime. That is the most likely cause of prospects such as Costa remaining in Building until stale-build recovery releases them.

## Reliability changes

1. Specialty and technical QA guidance is now injected into visual QA prompts.
2. Secondary imagery uses role-appropriate thresholds instead of hero-level strictness.
3. If a secondary image narrowly misses soft score thresholds but has no hard rejection and remains strongly business-relevant, the best safe candidate can be accepted as a degraded secondary fallback.
4. If all secondary candidates are unsafe or irrelevant, the already-approved hero image is reused at the secondary asset path rather than failing the entire concept. This fallback is explicitly marked in metadata and is preferable to leaving the prospect without a concept.
5. Hero imagery remains fail-closed. A hard reject, wrong industry, unsafe work, misleading representation, or materially poor hero still fails the build.
6. Image failure messages now retain the last QA explanation and score information.
7. Automatic research/build for a newly added prospect is moved out of Worker background execution. The browser drives the queued research and build sequence after redirecting to Prospect Details, so the long-running work remains attached to an active request rather than an expiring `waitUntil` task.
8. Existing deployment verification, rollback, stale-build recovery, and manual-data precedence remain intact.

## Success standard

A concept should fail only when proceeding would create a materially incorrect, unsafe, misleading, corrupt, or undeployable result. A nonessential secondary visual should not block an otherwise valid personalized sales concept.
