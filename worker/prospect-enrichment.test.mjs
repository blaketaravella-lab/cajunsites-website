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

console.log('Prospect enrichment invariants passed.');
