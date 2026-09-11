import assert from 'node:assert/strict';
import { classifyVisualFamily, getVisualSystem, buildConceptDocument } from './visual-family-engine.js';

const legacyCases=[
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
  [{id:15,business_name:'River Parish Fitness',category:'Gym'},'fitness'],
  [{id:16,business_name:'Bayou Pet Grooming',category:'Pet Grooming'},'pet'],
  [{id:17,business_name:'Main Street Dental',category:'Dentist'},'healthcare'],
  [{id:18,business_name:'Magnolia Boutique',category:'Retail Boutique'},'retail'],
];
for(const [prospect,expected] of legacyCases){const result=classifyVisualFamily(prospect);assert.equal(result.family,expected);const system=getVisualSystem(prospect,result);assert.equal(system.version,'visual-family-v6');assert.ok(system.variant);assert.ok(system.hero.startsWith('https://images.unsplash.com/'))}

const adaptive={id:20,business_name:'Completely New Vertical LLC',category:'Unclassified',research_json:JSON.stringify({vertical:'Mobile Instrument Calibration',summary:'Provides on-site calibration services.',services:[{name:'On-site calibration'}],design_profile:{archetype:'local_service',mood:'clean confident',image_theme:'technical field service',headline:'Calibration support that comes to your operation.',cta:'Request Calibration',sections:['Calibration Services','How It Works','Request Service'],process:['Tell us what needs calibration','Plan the visit','Complete the service']}})};
const adaptiveClass=classifyVisualFamily(adaptive);assert.equal(adaptiveClass.family,'local_service','researched design profile should bypass vertical-specific family maintenance');assert.equal(adaptiveClass.score,20);const adaptiveSystem=getVisualSystem(adaptive,adaptiveClass);assert.equal(adaptiveSystem.headline,'Calibration support that comes to your operation.');assert.equal(adaptiveSystem.cta,'Request Calibration');assert.equal(adaptiveSystem.archetype,'local_service');assert.ok(buildConceptDocument(adaptive,adaptiveClass).includes('Calibration Services'));

const stable={id:22,business_name:'Stable Business',category:'Auto Repair'};const first=getVisualSystem(stable,classifyVisualFamily(stable)),second=getVisualSystem(stable,classifyVisualFamily(stable));assert.equal(first.variant,second.variant);assert.equal(first.hero,second.hero);
console.log(`Adaptive Visual System smoke tests passed: ${legacyCases.length+6} checks.`);
