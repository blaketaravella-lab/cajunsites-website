import assert from 'node:assert/strict';
import fs from 'node:fs';

const conversion=fs.readFileSync('worker/conversion.js','utf8');
const concept=fs.readFileSync('worker/concept-factory-v2.js','utf8');
const customerAssets=fs.readFileSync('worker/customer-assets.js','utf8');
const productionStudio=fs.readFileSync('src/pages/admin/production-studio.astro','utf8');
const productionContentMigration=fs.readFileSync('migrations/0018_production_content.sql','utf8');

assert.match(conversion,/prospect\.concept_state!==['"]Built['"]/,'Only a successfully built concept may convert.');
assert.match(conversion,/concept_deployment_id/,'Conversion must preserve the exact approved deployment.');
assert.match(conversion,/approved_concept_build_id/,'Customer must retain the approved concept build ID.');
assert.match(conversion,/approved_concept_deployment_id/,'Customer must retain the approved deployment ID.');
assert.match(conversion,/production_url=excluded\.production_url/,'Approved concept must be promoted as the production customer site, not rebuilt.');
assert.match(conversion,/LAUNCH_FEE_CENTS=49900/,'Website Design & Launch must remain $499.');
assert.match(conversion,/HOSTING_FEE_CENTS=4900/,'Hosting & Maintenance must remain $49 per month.');
assert.match(conversion,/Website Design & Launch/,'Conversion must create the launch invoice.');
assert.match(conversion,/\/finalize/,'Launch invoice must be finalized.');
assert.match(conversion,/\/send/,'Launch invoice must be sent.');
assert.match(conversion,/Pending Launch Payment/,'Recurring hosting must wait for launch payment instead of producing a surprise second invoice at conversion.');
assert.match(conversion,/obj\.id===customer\.launch_invoice_id/,'Paid launch invoice must be the trigger for recurring hosting setup.');
assert.match(conversion,/Hosting & Maintenance/,'Recurring subscription must describe the CajunSites hosting service.');
assert.match(conversion,/recurring\]\[interval\].*month/,'Hosting must recur monthly.');
assert.match(conversion,/launch_invoice_failed/,'Invoice delivery failures must be observable without destroying the promoted customer site.');
assert.match(conversion,/hosting_subscription_failed/,'Recurring billing setup failures must be observable.');
assert.match(concept,/const customerId=Number\(p\.customer_id\|\|0\)/,'Customer production builds must be explicitly distinguished from prospect concepts.');
assert.match(concept,/\$\{slug\}-review/,'Customer rebuilds must target a production review alias.');
assert.match(customerAssets,/customer_site_content_versions/,'Production content edits must create immutable version records.');
assert.match(customerAssets,/normalizeContent/,'Production content must pass through a bounded schema normalizer.');
assert.match(customerAssets,/pages\.length>=5|slice\(0,5\)/,'Production sites must enforce the five-page plan limit.');
assert.match(productionStudio,/Website Content/,'Production Studio must expose direct structured content editing.');
assert.match(productionStudio,/Save &amp; Rebuild/,'Structured drafts must remain separate from preview rebuilds.');
assert.match(concept,/applyProductionContent/,'Production rebuilds must consume the saved structured content draft.');
assert.match(productionContentMigration,/customer_site_content_versions/,'Versioned production content must have a canonical migration.');

console.log('Customer lifecycle invariants passed.');
