import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveImagePolicy} from './image-pipeline/policy-resolver.js';
import {buildImageBrief} from './image-pipeline/ai-image-pipeline.js';

const sidelines={
  id:1,
  business_name:'Sidelines Barbershop',
  category:'Barbershop',
  research_json:JSON.stringify({
    vertical:'Automotive Repair',
    identity_confidence:'high',
    services:[{name:'Engine Repair',confidence:'high'}],
    design_profile:{image_theme:'mechanic garage engines',mood:'bold'}
  }),
  enrichment_provenance_json:JSON.stringify({category:{origin:'manual'}})
};
const sidelinesPolicy=resolveImagePolicy(sidelines);
assert.equal(sidelinesPolicy.policy_id,'beauty.barber','Trusted barbershop identity must beat conflicting research imagery.');
assert.equal(sidelinesPolicy.identity.trusted_family,'barber');
assert.equal(sidelinesPolicy.identity.research_family,'automotive');
assert.equal(sidelinesPolicy.identity.conflict,true,'Conflicting research family must be surfaced.');
const heroBrief=buildImageBrief(sidelines,'hero',sidelinesPolicy);
assert.match(heroBrief.prompt,/trusted business identity \(barber\) controls this image/i);
assert.match(heroBrief.prompt,/mechanic|automotive|engine/i,'Barber policy must explicitly exclude automotive imagery.');
assert.match(heroBrief.prompt,/30 percent negative space/i,'Hero prompt must reserve website copy space.');
assert.match(heroBrief.prompt,/representative only/i,'Generated imagery must remain representative, never actual-work evidence.');

const dentist={
  business_name:'Example Dental',
  category:'Dentistry',
  verified_services_json:JSON.stringify([{name:'Dental Cleaning'}]),
  enrichment_provenance_json:JSON.stringify({category:{origin:'manual'},verified_services_json:{origin:'manual'}}),
  research_json:JSON.stringify({vertical:'Dentistry',services:[{name:'Dental Implants',confidence:'high'}]})
};
const dentalPolicy=resolveImagePolicy(dentist);
assert.equal(dentalPolicy.policy_id,'healthcare.dentistry');
assert.deepEqual(dentalPolicy.verified_service_names,['Dental Cleaning'],'Manual verified services must override research services.');
assert.ok(dentalPolicy.verified_service_ids.includes('preventive_care'),'Verified cleaning must activate preventive-care overlay.');
assert.ok(!dentalPolicy.verified_service_ids.includes('implants'),'Research-only implant service must not override manually verified services.');

const restaurant={business_name:'Bayou Cafe',category:'Restaurant',research_json:JSON.stringify({vertical:'Restaurant',services:[{name:'Breakfast',confidence:'high'}],design_profile:{image_theme:'warm neighborhood cafe interior'}})};
const generic=resolveImagePolicy(restaurant);
assert.match(generic.policy_id,/^general\./,'Unmodeled specialties must receive a strict generic policy rather than bypass QA.');
assert.ok(generic.allowed_image_subjects.some(x=>/cafe|restaurant/i.test(x)),'Generic policy must retain business-specific visual cues.');

const pipeline=fs.readFileSync('worker/image-pipeline/ai-image-pipeline.js','utf8');
const concept=fs.readFileSync('worker/concept-factory.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
assert.match(pipeline,/MAX_ATTEMPTS=3/,'Image generation must cap retries.');
assert.match(pipeline,/Suitable \$\{role\} imagery could not be verified/,'Image pipeline must fail closed after retry exhaustion.');
assert.match(pipeline,/gpt-image-2\.5-flare/,'Production image generation must use the current GPT Image provider default.');
assert.match(pipeline,/1536x1024/,'Concept images must be generated landscape.');
assert.match(pipeline,/IMAGE_ASSETS\.put/,'Approved images must persist to R2.');
assert.match(pipeline,/qaResult\?\.approved/,'QA result must be persisted.');
assert.match(concept,/generateApprovedConceptImages/,'Concept builds must pass through AI image generation and QA.');
assert.match(concept,/applyAIImages/,'Only approved AI imagery may be inserted into the generated concept.');
assert.match(concept,/if\(p\.customer_id\)/,'Converted prospects must not rebuild prospect concepts.');
assert.match(wrangler,/"binding": "IMAGE_ASSETS"/,'R2 image binding must be configured.');

console.log('AI image pipeline invariants passed.');
