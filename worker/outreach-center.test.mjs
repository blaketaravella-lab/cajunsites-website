import fs from 'node:fs';
import assert from 'node:assert/strict';

const api=fs.readFileSync(new URL('./prospects.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../src/pages/admin/outreach.astro',import.meta.url),'utf8');
const nav=fs.readFileSync(new URL('../src/components/AdminShell.astro',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0016_outreach_center.sql',import.meta.url),'utf8');

assert.match(nav,/label:'Outreach'/,'Outreach must remain in the Sales navigation.');
assert.match(page,/Approved call direction/,'The calling workspace must show the approved script.');
assert.match(page,/outreach-call/,'The workspace must record structured call results.');
assert.match(page,/outreach-email/,'The workspace must expose human-approved concept email.');
assert.match(api,/OUTREACH_POSTAL_ADDRESS must be configured/,'Commercial email must fail closed without a postal address.');
assert.match(api,/OUTREACH_EMAIL_ENABLED!=='true'/,'The backend must reject prospect email until it is explicitly enabled.');
assert.match(page,/outreachData\.email_enabled/,'The email interface must remain hidden until the backend enables it.');
assert.match(api,/List-Unsubscribe-Post/,'Concept email must support one-click unsubscribe.');
assert.match(api,/do_not_contact/,'Outreach must enforce suppression state.');
assert.match(api,/Publish the concept before sending it/,'Email must require a published concept.');
assert.match(migration,/prospect_outreach_events/,'Outreach history must have a canonical migration.');

console.log('Outreach Center invariants passed.');
