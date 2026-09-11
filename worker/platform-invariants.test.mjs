import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const wrangler = read('wrangler.jsonc');
const prospects = read('worker/prospects.js');
const auth = read('worker/auth.js');
const conversion = read('worker/conversion.js');
const concept = read('worker/concept-factory.js');
const cleanup = read('worker/prospect-cleanup.js');

assert.match(wrangler, /"\/admin\/\*"/, 'Admin pages must run through the Worker');
assert.doesNotMatch(prospects, /initialProspects/, 'Prospects must never runtime auto-seed');
assert.match(auth, /LOGIN_MAX_FAILURES\s*=\s*5/, 'Login throttling must remain enabled');
assert.match(auth, /password_scheme='hmac_v2'/, 'Password writes must use the unified scheme');
for (const event of ['invoice.payment_failed','invoice.paid','customer.subscription.updated','customer.subscription.deleted','charge.refunded']) {
  assert.ok(conversion.includes(event), `Missing Stripe lifecycle event ${event}`);
}
assert.match(concept, /classifyVisualFamily/, 'All concept builds must use the Visual Family Engine');
assert.match(concept, /visual_fallback/, 'Concept build metadata must retain fallback state');
assert.match(cleanup, /cleanupProspect/, 'Prospect deletion must clean related assets');
assert.match(cleanup, /\/api\/admin\/health/, 'Protected health endpoint must remain available');
assert.match(cleanup, /persistWebsiteLead/, 'Website inquiries must persist operationally');

console.log('Platform invariant tests passed.');
