import fs from 'node:fs';

const enrichment=fs.readFileSync('worker/prospect-enrichment.js','utf8');
const billing=fs.readFileSync('worker/billing.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
const migration=fs.readFileSync('migrations/0010_prospect_enrichment.sql','utf8');

const must=(condition,message)=>{if(!condition)throw new Error(message)};

const enrichmentIsTopLevel=wrangler.includes('"main": "./worker/prospect-enrichment.js"');
const billingWrapsEnrichment=wrangler.includes('"main": "./worker/billing.js"')&&billing.includes("import appWorker from './prospect-enrichment.js'");
must(enrichmentIsTopLevel||billingWrapsEnrichment,'Prospect enrichment must remain in the top-level Worker chain.');
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

console.log('Prospect enrichment invariants passed.');
