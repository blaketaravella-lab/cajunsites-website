import assert from 'node:assert/strict';
import fs from 'node:fs';

const conversion=fs.readFileSync('worker/conversion.js','utf8');
const concept=fs.readFileSync('worker/concept-factory-v2.js','utf8');

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

console.log('Customer lifecycle invariants passed.');
