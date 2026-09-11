import assert from 'node:assert/strict';
import { classifyVisualFamily, getVisualSystem } from './visual-family-engine.js';

const cases=[
  [{id:1,business_name:'Sudz Sation',category:'Car Wash'},'car_wash'],
  [{id:2,business_name:'The Diesel Lab',category:'Diesel Repair'},'auto_repair'],
  [{id:3,business_name:'Up to Code Plumbing',category:'Plumbing'},'plumbing'],
  [{id:4,business_name:'Divaology Hair Studio',category:'Hair Salon'},'beauty'],
  [{id:5,business_name:'Therapeutic Massage',category:'Massage / Wellness'},'wellness'],
  [{id:6,business_name:'We Are All-En',category:'Childcare'},'childcare'],
  [{id:7,business_name:'B Towing',category:'Towing / Roadside'},'towing'],
  [{id:8,business_name:'Artistic Designs',category:'Flower Shop'},'floral'],
  [{id:9,business_name:'DKE',category:'Cleaning Services'},'cleaning'],
  [{id:10,business_name:'Cesar Collision',category:'Collision Repair'},'collision'],
  [{id:11,business_name:'Acme Consulting',category:'Business Consulting'},'professional'],
  [{id:12,business_name:'ABC Electric',category:'Electrical Contractor'},'home_services'],
  [{id:13,business_name:'Unknown Business',category:'Other'},'generic'],
  [{id:14,business_name:"Anita's Smokin Steak Burgers",category:'Restaurant'},'restaurant'],
  [{id:15,business_name:"Anita's Smokin Steak Burgers",category:'Local Business'},'restaurant'],
  [{id:16,business_name:'River Parish Fitness',category:'Gym'},'fitness'],
  [{id:17,business_name:'Bayou Pet Grooming',category:'Pet Grooming'},'pet'],
  [{id:18,business_name:'Main Street Dental',category:'Dentist'},'healthcare'],
  [{id:19,business_name:'Magnolia Boutique',category:'Retail Boutique'},'retail'],
];

for(const [prospect,expected] of cases){
  const result=classifyVisualFamily(prospect);
  assert.equal(result.family,expected,`${prospect.business_name} should classify as ${expected}, got ${result.family}`);
  const system=getVisualSystem(prospect,result);
  assert.ok(system.version,'visual system must expose a version');
  assert.equal(system.version,'visual-family-v5','visual system version should track v5 coverage');
  assert.ok(system.variant,'visual system must expose a deterministic variant');
  assert.ok(system.hero.startsWith('https://images.unsplash.com/'),'visual system must select a hero image');
}

const researchDriven={
  id:20,
  business_name:'Example Business',
  category:'Local Business',
  research_json:JSON.stringify({vertical:'Plumbing Contractor',services:[{name:'Drain Cleaning'}],suggested_sections:['Water Heater Services']})
};
assert.equal(classifyVisualFamily(researchDriven).family,'plumbing','research signals should override a generic category');

const hinted={
  id:21,
  business_name:'Ambiguous Name LLC',
  category:'Local Business',
  research_json:JSON.stringify({vertical:'Food Service',visual_family_hint:'restaurant'})
};
assert.equal(classifyVisualFamily(hinted).family,'restaurant','explicit research visual-family hints should win');

const stable={id:22,business_name:'Stable Business',category:'Auto Repair'};
const first=getVisualSystem(stable,classifyVisualFamily(stable));
const second=getVisualSystem(stable,classifyVisualFamily(stable));
assert.equal(first.variant,second.variant,'same prospect must receive stable visual variant');
assert.equal(first.hero,second.hero,'same prospect must receive stable hero selection');

const generic=getVisualSystem({id:23,business_name:'Unknown Business',category:'Other'});
assert.ok(!generic.hero.includes('photo-1497366811353-6870744d04b2'),'generic fallback must not use the old office hero');

console.log(`Visual Family Engine smoke tests passed: ${cases.length+4} checks.`);
