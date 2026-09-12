import fs from 'node:fs';

const enrichment=fs.readFileSync('worker/prospect-enrichment.js','utf8');
const billing=fs.readFileSync('worker/billing.js','utf8');
const designChat=fs.readFileSync('worker/design-chat.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
const migration=fs.readFileSync('migrations/0010_prospect_enrichment.sql','utf8');
const visualMigration=fs.readFileSync('migrations/0011_visual_inspiration.sql','utf8');
const designMigration=fs.readFileSync('migrations/0012_design_studio.sql','utf8');

const must=(condition,message)=>{if(!condition)throw new Error(message)};

const enrichmentIsTopLevel=wrangler.includes('"main": "./worker/prospect-enrichment.js"');
const billingWrapsEnrichment=wrangler.includes('"main": "./worker/billing.js"')&&billing.includes("import appWorker from './prospect-enrichment.js'");
const designChatWrapsBilling=wrangler.includes('"main": "./worker/design-chat.js"')&&designChat.includes("import appWorker from './billing.js'")&&billing.includes("import appWorker from './prospect-enrichment.js'");
must(enrichmentIsTopLevel||billingWrapsEnrichment||designChatWrapsBilling,'Prospect enrichment must remain in the top-level Worker chain.');
must(enrichment.includes("origin:'manual'"),'Manual edits must be recorded in field provenance.');
must(enrichment.includes("'manual_existing'"),'Legacy non-empty values must be protected from research overwrite.');
must(enrichment.includes("origin:'research'"),'Research-populated fields must retain research provenance.');
must(enrichment.includes('protectedSnapshot'),'Research must preserve protected prospect values.');
must(enrichment.includes('enrichFromStoredResearch'),'Completed research must enrich the structured prospect record.');
must(enrichment.includes('business_summary'),'Research summary must be promoted to a structured prospect field.');
must(enrichment.includes('google_rating')&&enrichment.includes('google_review_count'),'Verified Google aggregate data must be eligible for enrichment.');
must(enrichment.includes('verified_services_json'),'Verified services must be persisted on the prospect record.');
must(migration.includes('enrichment_provenance_json'),'Canonical migration must include enrichment provenance.');
must(!enrichment.includes('call_attempts')&&!enrichment.includes('next_follow_up')&&!enrichment.includes('decision_maker_reached'),'Research enrichment must not mutate human sales workflow fields.');
must(enrichment.includes('queueAutoResearchAndBuild'),'New prospect creation must queue the automatic research and concept-build workflow.');
must(enrichment.includes("research_status='Queued'"),'Automatic research must expose a queued state.');
must(enrichment.includes('`/api/admin/prospects/${id}/research`'),'Automatic research must use the existing research endpoint so manual re-runs remain consistent.');
must(enrichment.includes('`/api/admin/prospects/${id}/build-concept`'),'A successful automatic research run must chain into the existing concept-build endpoint.');
must(enrichment.indexOf('`/api/admin/prospects/${id}/research`')<enrichment.indexOf('`/api/admin/prospects/${id}/build-concept`'),'Automatic concept build must run only after the automatic research call.');
must(enrichment.includes('context?.waitUntil'),'Automatic prospect workflow must run asynchronously when the Worker execution context is available.');
must(enrichment.includes("(research|build-concept)"),'Manual Research and Build Concept mutation routing must remain available.');
must(enrichment.includes('places.googleapis.com/v1/places:searchText'),'Concept builds must look up the exact business in Google Places before visual analysis.');
must(enrichment.includes('skipHttpRedirect=true'),'Google Place photos must be retrieved transiently for analysis rather than embedded into the generated site.');
must(enrichment.includes("type:'input_image'"),'Google Place photos must be passed to the vision model as image inputs.');
must(enrichment.includes('Do not copy, reproduce, trace, crop, embed, or otherwise reuse any source photo'),'Visual analysis must explicitly prohibit copying Google source photos into concept sites.');
must(enrichment.includes('prepareConceptBuild'),'Concept build requests must prepare research and visual inspiration before downstream build logic runs.');
must(enrichment.includes('await refreshVisualInspiration(env,id)'),'Concept builds must refresh derived visual inspiration before downstream build logic runs.');
must(enrichment.includes('visual_inspiration:inspiration'),'Only derived visual cues, not source photo URLs, must be persisted into research data.');
must(visualMigration.includes('visual_inspiration_json')&&visualMigration.includes('visual_inspiration_at'),'Visual inspiration persistence fields must have a canonical migration.');

must(designChat.includes('a tightly constrained website-design assistant'),'Design Studio must use an explicit website-design-only system boundary.');
must(designChat.includes('You have no tools, no code execution, no filesystem, no database access'),'Design Studio prompt must deny tool, code, filesystem, and database capabilities.');
must(designChat.includes('Never output HTML, CSS, JavaScript'),'Design Studio must prohibit code generation.');
must(!designChat.includes("tools:[")&&!designChat.includes('tools: ['),'Design Studio model calls must not expose OpenAI tools.');
must(designChat.includes("const PROFILE_KEYS=['archetype','mood','image_theme','headline','cta','sections','process']"),'Design Studio must use an explicit design-field allowlist.');
must(designChat.includes('normalizeProposal'),'Every AI design proposal must be normalized through the allowlist.');
must(designChat.includes("role='assistant'")&&designChat.includes('proposal_json'),'Only stored assistant proposals may be applied.');
must(designChat.includes("p.research_status!=='Complete'"),'Design Studio must require completed research before applying a design.');
must(designChat.includes('design_directives_json')&&designChat.includes('design_profile_origin'),'Applied design changes must be isolated as design directives and labeled separately from research.');
must(designChat.includes('`/api/admin/prospects/${id}/build-concept`'),'Applying a design may only hand off to the existing concept builder.');
must(!designChat.includes('/api/admin/users')&&!designChat.includes('/api/admin/settings')&&!designChat.includes('/api/admin/billing'),'Design Studio must not contain mutation paths for protected dashboard domains.');
must(designMigration.includes('design_chat_messages')&&designMigration.includes('design_directives_json'),'Design Studio must have canonical isolated persistence.');

console.log('Prospect enrichment and Design Studio invariants passed.');
