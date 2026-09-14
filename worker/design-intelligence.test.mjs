import assert from 'node:assert/strict';
import {resolveDesignSpec} from './design-intelligence.js';

const architecture={
  objective:'lead',
  conversion_strategy:{primary_cta:'Request an Estimate'},
  content_strategy:{section_sequence:['hero','services','trust','reviews','location','cta']},
  visual_strategy:{tone:['confident','technical','local'],image_direction:'precision collision repair and refinishing'}
};
const model={archetype:'local_service',mood:'confident',layout:'editorial',navigation:'minimal',content_density:'balanced',services_presentation:'service_grid',trust_strategy:['reviews','local_business_identity'],mobile_strategy:'sticky_primary_cta',imagery_strategy:['verified_service_action','industry_specific_detail'],headline:'Collision repair built around getting you back on the road',cta:'Request an Estimate',sections:['hero','services','trust','reviews','location','cta'],image_theme:'precision collision repair and refinishing'};
const p={id:1,business_name:"Cesar's Collision Center",concept_strategy_json:JSON.stringify(architecture),concept_design_model_json:JSON.stringify(model),research_json:JSON.stringify({vertical:'Collision Repair'})};
const spec=resolveDesignSpec(p);
assert.equal(spec.vertical_policy,'profile_driven');
assert.equal(spec.objective,'lead');
assert.equal(spec.hero,'editorial');
assert.equal(spec.headline,model.headline);
assert.ok(spec.cta_strategy.includes('Request an Estimate'));
assert.deepEqual(spec.section_sequence,model.sections);
assert.equal(spec.source,'concept_architecture');

const override=resolveDesignSpec({...p,design_directives_json:JSON.stringify({headline:'A more premium collision experience',layout:'split',mobile_strategy:'sticky_conversion_bar'})});
assert.equal(override.headline,'A more premium collision experience');
assert.equal(override.hero,'split');
assert.equal(override.mobile_strategy,'sticky_conversion_bar');
assert.equal(override.source,'design_studio_override');

const fallback=resolveDesignSpec({business_name:'Unknown',research_json:JSON.stringify({design_profile:{headline:'Local expertise',sections:['hero','services','cta']}})});
assert.equal(fallback.vertical_policy,'profile_driven');
assert.equal(fallback.headline,'Local expertise');
assert.equal(fallback.source,'research_fallback');
console.log('Design intelligence invariants passed.');
