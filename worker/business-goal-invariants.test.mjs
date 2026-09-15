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
const conceptArchitecture = read('worker/concept-architecture.js');
const designIntelligence = read('worker/design-intelligence.js');
const visualEngine = read('worker/visual-family-engine.js');
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

assert.match(adminShell, /Outreach/i,'The approved manual Outreach workspace must remain in active admin navigation.');
assert.doesNotMatch(enrichment, /sendgrid|twilio|cold email|cold-email|send sms|sendSMS/i,'Automated prospect enrichment must not execute outbound outreach.');

assert.match(designChat, /rebuild_required:true/,'Design Studio apply must save directives and require an explicit rebuild.');
assert.match(designChat, /business_truth_locked:true/,'Design Studio must preserve verified business truth while editing the design model.');
assert.match(designChat, /concept_design_model_json/,'Design Studio must work against the structured concept design model.');
assert.match(designStudio, /fetch\(`\/api\/admin\/prospects\/\$\{id\}\/build-concept`/,'Design Studio rebuilds must use the top-level Concept Build endpoint.');
assert.match(designStudio, /error_stage/,'Design Studio must surface build failure stages.');
assert.match(designStudio, /build_id/,'Design Studio must surface build IDs.');

assert.match(wrangler, /"main": "\.\/worker\/concept-design-worker\.js"/,'Concept Design Worker must remain the production Worker entry point.');
assert.match(conceptWorker, /import appWorker from '\.\/stale-build-recovery\.js'/,'Stale build recovery must remain in the top-level Worker chain.');
assert.match(conceptWorker, /import staticBuildWorker from '\.\/concept-factory-v2\.js'/,'All concept builds must use the canonical atomic preview deployer.');
assert.match(conceptWorker, /compileConceptArchitecture/,'Every build must compile the verified business profile and concept strategy before generation.');
assert.match(conceptWorker, /verified_business_profile_json/,'Verified Business Profile must be persisted as a first-class build artifact.');
assert.match(conceptWorker, /concept_strategy_json/,'Concept Strategy must be persisted as a first-class build artifact.');
assert.match(conceptWorker, /concept_design_model_json/,'Concept Design Model must be persisted as a first-class build artifact.');
assert.match(conceptWorker, /concept_image_plan_json/,'Concept Image Plan must be persisted as a first-class build artifact.');
assert.match(conceptArchitecture, /location_match_required:true/,'Business Name + City + State must remain the research/build identity anchor.');
assert.match(conceptArchitecture, /profile_fingerprint/,'Verified profile changes must be distinguishable from design-only rebuilds.');
assert.match(conceptArchitecture, /canReuse/,'Unchanged business truth should reuse a stable concept strategy across rebuilds.');
assert.match(designIntelligence, /vertical_policy:'profile_driven'/,'Design intelligence must be profile-driven rather than dependent on a fixed vertical policy table.');
assert.match(visualEngine, /concept_design_model_json/,'The renderer must consume the structured Concept Design Model.');
assert.match(visualEngine, /visual-family-v7-architecture/,'The production renderer must use the architecture-aware visual system.');

assert.match(conceptWorker, /concept-preview/,'Design Studio must use a prospect-specific exact deployment preview route.');
assert.match(conceptWorker, /concept_deployment_id/,'Design Studio preview selection must bind to the selected prospect deployment ID.');
assert.match(conceptWorker, /x-cajunsites-prospect-id/,'Exact preview responses must retain the selected prospect identity for diagnostics.');
assert.match(conceptWorker, /designChatWithExactPreview/,'Design chat responses must be rewritten to the exact selected prospect preview.');
assert.match(conceptWorker, /\/v6\/deployments\/\$\{encodeURIComponent\(deploymentId\)\}\/files/,'Design Studio previews must read the selected deployment file tree through Vercel API.');
assert.match(conceptWorker, /deploymentFileBytes/,'Design Studio previews must proxy exact stored deployment bytes instead of iframeing a Vercel deployment host.');
assert.match(conceptWorker, /frame-ancestors 'self'/,'Same-origin Design Studio preview HTML must explicitly permit embedding only by CajunSites itself.');
assert.doesNotMatch(conceptWorker, /location:`https:\/\/\$\{host\}`/,'Design Studio must not redirect the iframe to a Vercel host that can refuse framing.');
assert.doesNotMatch(conceptWorker, /export default\{async fetch\(request,env,context\)\{\s*if\(env\.DB\)[\s\S]*?await ensure\(env\)/,'Ordinary admin requests must not run concept schema bootstrap before routing.');
assert.match(staleRecovery, /STALE_MINUTES=15/,'Interrupted concept builds must self-heal instead of staying Building forever.');

assert.match(conceptFactory, /verifySourceFiles/,'Concept preview deployments must verify exact stored source files before activation.');
assert.ok(conceptFactory.indexOf('await verifySourceFiles') < conceptFactory.indexOf('await assignAlias'),'A preview deployment must verify before its alias is activated.');
assert.match(conceptFactory, /verifyLiveAlias/,'The activated concept alias must be verified before the build is committed.');
assert.ok(conceptFactory.indexOf('await assignAlias') < conceptFactory.indexOf('await verifyLiveAlias'),'Live alias verification must happen after activation.');
assert.match(conceptFactory, /previous_deployment_id/,'Build history must retain the previous deployment for rollback.');
assert.match(conceptFactory, /assignAlias\(env,oldDeploymentId,alias\)/,'Failed alias activation must support rollback to the previous deployment.');
assert.match(conceptFactory, /const customerId=Number\(p\.customer_id\|\|0\)/,'Production builds must distinguish customers from sales concepts.');
assert.match(conceptFactory, /\$\{slug\}-review/,'Customer production builds must remain isolated from prospect concept aliases.');
assert.doesNotMatch(conceptFactory, /vercelUploadFile\(env,'vercel\.json'/,'Canonical concept builds must not install catch-all routing that can shadow static assets.');
assert.match(conceptFactory, /native_static_preview_then_alias/,'Canonical concept builds must use native static preview deployment followed by explicit alias activation.');
assert.doesNotMatch(conceptFactory, /target:'production'/,'Concept builds must not publish a candidate as production before verification.');

assert.match(imagePipeline, /representative only/i,'Generated concept imagery must be explicitly representative.');
assert.match(imagePipeline, /MAX_ATTEMPTS=3/,'Image generation must remain bounded.');
assert.match(imagePipeline, /concept_image_plan_json/,'Image generation must consume the compiled Concept Image Plan.');
assert.match(imagePipeline, /image_plan_source/,'Image-plan usage must remain observable.');
assert.match(imagePipeline, /\/assets\/hero\.webp/,'Concept hero imagery must use deployment-local assets.');
assert.match(imagePipeline, /\/assets\/secondary\.webp/,'Concept secondary imagery must use deployment-local assets.');
assert.match(imagePolicyResolver, /(?:policyId|policy_id):'food\.restaurant'/,'Restaurant concepts must retain restaurant-specific visual QA.');
assert.match(imagePolicyResolver, /secondary image/i,'Restaurant visual QA must explicitly support distinct secondary compositions.');
assert.match(imagePolicyResolver, /policy_mode/,'Visual policy resolution must expose specialized, derived, generic-safe, or blocked behavior.');
assert.doesNotMatch(wrangler, /IMAGE_ASSETS/,'Generated concept images must not silently reintroduce the retired R2 binding.');
assert.match(wrangler, /CUSTOMER_ASSETS/,'Approved customer photos must use private customer-scoped storage.');

const visualIndex = globalCss.indexOf("@import './admin-visual-alignment.css';");
const workspaceIndex = globalCss.indexOf("@import './prospect-workspace.css';");
const spacingIndex = globalCss.indexOf("@import './admin-content-spacing.css';");
assert.ok(visualIndex >= 0 && workspaceIndex > visualIndex && spacingIndex > workspaceIndex,'Admin visual alignment, Prospect Workspace, and content spacing layers must remain in final cascade order.');

console.log('CajunSites business goal alignment invariants passed.');
