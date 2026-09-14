import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const homepage = read('src/pages/index.astro');
const adminShell = read('src/components/AdminShell.astro');
const globalCss = read('src/styles/global.css');
const enrichment = read('worker/prospect-enrichment.js');
const designStudio = read('src/pages/admin/design-studio.astro');
const designChat = read('worker/design-chat.js');
const conceptWorker = read('worker/concept-design-worker.js');
const conceptFactory = read('worker/concept-factory-v2.js');
const staleRecovery = read('worker/stale-build-recovery.js');
const imagePipeline = read('worker/image-pipeline/ai-image-pipeline.js');
const imagePolicyResolver = read('worker/image-pipeline/policy-resolver.js');
const wrangler = read('wrangler.jsonc');

assert.match(homepage, /\$499 Website Design &amp; Launch/,'Public site must preserve the $499 Website Design & Launch offer.');
assert.match(homepage, /\$49\/mo Hosting &amp; Maintenance/,'Public site must preserve the $49/month Hosting & Maintenance offer.');
assert.match(homepage, /A professional website\./,'Public positioning must preserve the approved core headline.');

assert.match(enrichment, /origin:'manual'/,'Manual prospect values must be tracked as manual provenance.');
assert.match(enrichment, /manual_existing/,'Existing human-entered prospect data must remain protected.');
assert.match(enrichment, /protectedSnapshot/,'Research enrichment must preserve protected prospect values.');
assert.doesNotMatch(enrichment, /UPDATE prospects SET[^\n]*(call_attempts|next_follow_up|decision_maker_reached)/,'Automated research must not mutate human sales workflow fields.');

assert.doesNotMatch(adminShell, /Outreach Center/i,'Outreach Center must remain off the active admin navigation until explicitly approved.');
assert.doesNotMatch(enrichment, /sendgrid|twilio|cold email|cold-email|send sms|sendSMS/i,'Automated prospect enrichment must not execute outbound outreach.');

assert.match(designChat, /rebuild_required:true/,'Design Studio apply must save directives and require an explicit rebuild.');
assert.match(designStudio, /fetch\(`\/api\/admin\/prospects\/\$\{id\}\/build-concept`/,'Design Studio rebuilds must use the top-level Concept Build endpoint.');
assert.match(designStudio, /error_stage/,'Design Studio must surface build failure stages.');
assert.match(designStudio, /build_id/,'Design Studio must surface build IDs.');

assert.match(wrangler, /"main": "\.\/worker\/concept-design-worker\.js"/,'Concept Design Worker must remain the production Worker entry point.');
assert.match(conceptWorker, /import appWorker from '\.\/stale-build-recovery\.js'/,'Stale build recovery must remain in the top-level Worker chain.');
assert.match(conceptWorker, /import staticBuildWorker from '\.\/concept-factory-v2\.js'/,'All concept builds must use the canonical atomic preview deployer.');
assert.match(conceptWorker, /concept-preview/,'Design Studio must use a prospect-specific exact deployment preview route.');
assert.match(conceptWorker, /concept_deployment_id/,'Design Studio preview selection must bind to the selected prospect deployment ID.');
assert.match(conceptWorker, /x-cajunsites-prospect-id/,'Exact preview responses must retain the selected prospect identity for diagnostics.');
assert.match(conceptWorker, /designChatWithExactPreview/,'Design chat responses must be rewritten to the exact selected prospect preview.');
assert.match(conceptWorker, /\/v6\/deployments\/\$\{encodeURIComponent\(deploymentId\)\}\/files/,'Design Studio previews must read the selected deployment file tree through Vercel API.');
assert.match(conceptWorker, /deploymentFileBytes/,'Design Studio previews must proxy exact stored deployment bytes instead of iframeing a Vercel deployment host.');
assert.match(conceptWorker, /frame-ancestors 'self'/,'Same-origin Design Studio preview HTML must explicitly permit embedding only by CajunSites itself.');
assert.doesNotMatch(conceptWorker, /location:`https:\/\/\$\{host\}`/,'Design Studio must not redirect the iframe to a Vercel host that can refuse framing.');
assert.match(staleRecovery, /STALE_MINUTES=15/,'Interrupted concept builds must self-heal instead of staying Building forever.');

assert.match(conceptFactory, /verifySourceFiles/,'Concept preview deployments must verify exact stored source files before activation.');
assert.ok(conceptFactory.indexOf('await verifySourceFiles') < conceptFactory.indexOf('await assignAlias'),'A preview deployment must verify before its alias is activated.');
assert.match(conceptFactory, /verifyLiveAlias/,'The activated concept alias must be verified before the build is committed.');
assert.ok(conceptFactory.indexOf('await assignAlias') < conceptFactory.indexOf('await verifyLiveAlias'),'Live alias verification must happen after activation.');
assert.match(conceptFactory, /previous_deployment_id/,'Build history must retain the previous deployment for rollback.');
assert.match(conceptFactory, /assignAlias\(env,oldDeploymentId,alias\)/,'Failed alias activation must support rollback to the previous deployment.');
assert.match(conceptFactory, /if\(p\.customer_id\)/,'Converted prospects must not continue through prospect concept builds.');
assert.doesNotMatch(conceptFactory, /vercelUploadFile\(env,'vercel\.json'/,'Canonical concept builds must not install catch-all routing that can shadow static assets.');
assert.match(conceptFactory, /native_static_preview_then_alias/,'Canonical concept builds must use native static preview deployment followed by explicit alias activation.');
assert.doesNotMatch(conceptFactory, /target:'production'/,'Concept builds must not publish a candidate as production before verification.');

assert.match(imagePipeline, /representative only/i,'Generated concept imagery must be explicitly representative.');
assert.match(imagePipeline, /MAX_ATTEMPTS=3/,'Image generation must remain bounded.');
assert.match(imagePipeline, /\/assets\/hero\.webp/,'Concept hero imagery must use deployment-local assets.');
assert.match(imagePipeline, /\/assets\/secondary\.webp/,'Concept secondary imagery must use deployment-local assets.');
assert.match(imagePolicyResolver, /policy_id:'food\.restaurant'/,'Restaurant concepts must retain restaurant-specific visual QA.');
assert.match(imagePolicyResolver, /secondary image/i,'Restaurant visual QA must explicitly support distinct secondary compositions.');
assert.doesNotMatch(wrangler, /r2_buckets|IMAGE_ASSETS/,'Concept images must not silently reintroduce an R2 dependency.');

const visualIndex = globalCss.indexOf("@import './admin-visual-alignment.css';");
const workspaceIndex = globalCss.indexOf("@import './prospect-workspace.css';");
const spacingIndex = globalCss.indexOf("@import './admin-content-spacing.css';");
assert.ok(visualIndex >= 0 && workspaceIndex > visualIndex && spacingIndex > workspaceIndex,'Admin visual alignment, Prospect Workspace, and content spacing layers must remain in final cascade order.');

console.log('CajunSites business goal alignment invariants passed.');
