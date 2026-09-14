import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildVerifiedBusinessProfile,compileConceptArchitecture,bridgeArchitectureIntoResearch} from './concept-architecture.js';

const collision={
 id:99,business_name:"Cesar's Collision Center",city:'Luling',state:'LA',business_vertical:'Collision Repair',category:'Collision Repair',business_summary:'Local collision repair and auto body shop.',
 research_json:JSON.stringify({identity_confidence:'high',vertical:'Collision Repair',summary:'Local collision repair and auto body shop.',services:[{name:'Collision Repair',confidence:'high'},{name:'Auto Body Repair',confidence:'high'},{name:'Paint Refinishing',confidence:'high'}],sources:[{name:'Google Business Profile',url:'https://example.test'}]}),
 enrichment_provenance_json:JSON.stringify({business_name:{origin:'manual'},city:{origin:'manual'},state:{origin:'manual'},business_vertical:{origin:'research'}})
};
const profile=buildVerifiedBusinessProfile(collision);
assert.equal(profile.identity.business_name.value,"Cesar's Collision Center");
assert.equal(profile.identity.city.value,'Luling');
assert.equal(profile.identity.state.value,'LA');
assert.equal(profile.identity.confidence,'high');
assert.deepEqual(profile.business.services.map(x=>x.name),['Collision Repair','Auto Body Repair','Paint Refinishing']);
assert.equal(profile.safeguards.manual_data_wins,true);
assert.equal(profile.safeguards.human_design_directives_win,true);

const architecture=await compileConceptArchitecture({},collision);
assert.equal(architecture.build_readiness,'ready');
assert.equal(architecture.architecture_version,'concept-architecture-v1');
assert.ok(architecture.strategy.objective);
assert.ok(architecture.design_model.archetype);
assert.equal(architecture.image_plan.roles.length,2);
assert.deepEqual(architecture.image_plan.roles.map(x=>x.role),['hero','secondary']);
assert.ok(architecture.image_plan.roles[0].subjects.some(x=>/collision|auto body|paint/i.test(x)),'Image plan must be grounded in verified collision services.');

const customized={...collision,design_directives_json:JSON.stringify({mood:'premium',headline:'Collision repair with a more refined presentation',layout:'editorial',image_theme:'precision auto body refinishing and collision repair'})};
const customizedArchitecture=await compileConceptArchitecture({},customized);
assert.equal(customizedArchitecture.design_model.mood,'premium','Human Design Studio mood must override compiler defaults.');
assert.equal(customizedArchitecture.design_model.layout,'editorial','Human Design Studio layout must override compiler defaults.');
assert.equal(customizedArchitecture.design_model.headline,'Collision repair with a more refined presentation','Human-approved headline must survive strategy recompilation.');
assert.match(customizedArchitecture.image_plan.roles[0].subjects.join(' '),/precision auto body refinishing/i,'Human image direction must flow into the next image plan.');

const bridged=bridgeArchitectureIntoResearch(collision,architecture);
assert.equal(bridged.design_profile.archetype,architecture.design_model.archetype);
assert.equal(bridged.design_profile_origin,'concept_architecture');
assert.deepEqual(bridged.concept_image_plan.roles,architecture.image_plan.roles);

const low={...collision,research_json:JSON.stringify({identity_confidence:'low',vertical:'Collision Repair',services:[{name:'Collision Repair',confidence:'high'}]})};
assert.equal((await compileConceptArchitecture({},low)).build_readiness,'needs_identity_review');
const insufficient={business_name:'Mystery Business',city:'Luling',state:'LA',research_json:JSON.stringify({identity_confidence:'high',services:[]})};
assert.equal((await compileConceptArchitecture({},insufficient)).build_readiness,'needs_research_review');

const worker=fs.readFileSync('worker/concept-design-worker.js','utf8');
const chat=fs.readFileSync('worker/design-chat.js','utf8');
const images=fs.readFileSync('worker/image-pipeline/ai-image-pipeline.js','utf8');
const compiler=fs.readFileSync('worker/concept-architecture.js','utf8');
assert.match(worker,/compileConceptArchitecture/,'Builds must compile a verified business profile and concept strategy before generation.');
assert.match(worker,/verified_business_profile_json/,'Verified profile must be persisted separately from raw research.');
assert.match(worker,/concept_strategy_json/,'Concept strategy must be a first-class persisted artifact.');
assert.match(worker,/concept_design_model_json/,'Structured design model must be a first-class persisted artifact.');
assert.match(worker,/concept_image_plan_json/,'Image plan must be a first-class persisted artifact.');
assert.match(worker,/needs_identity_review/,'Low identity confidence must stop before image generation.');
assert.match(compiler,/applyHumanDirectives/,'Concept compiler must reapply human-approved design directives after AI output.');
assert.match(chat,/business_truth_locked:true/,'Design Studio must keep business truth locked while editing design.');
assert.match(chat,/concept_design_model_json/,'Design Studio must edit the structured design model.');
assert.match(images,/concept_image_plan_json/,'Image generation must consume the compiled image plan.');
assert.match(images,/image_plan_source/,'Image-plan usage must be observable.');

console.log('Concept architecture invariants passed.');
