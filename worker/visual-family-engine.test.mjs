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
for(const [prospect,expected] of legacyCases){const result=classifyVisualFamily(prospect);assert.equal(result.family,expected);const system=getVisualSystem(prospect,result);assert.equal(system.version,'visual-family-v7-architecture');assert.ok(system.variant);assert.ok(system.hero.startsWith('https://images.unsplash.com/'))}

const designModel={archetype:'local_service',mood:'premium',image_theme:'precision collision repair, auto body refinishing, professional repair environment',headline:'Collision repair built around getting you back on the road',cta:'Request an Estimate',sections:['hero','services','trust','about','reviews','location','cta'],process:['Tell us what happened','Review repair needs','Plan the next step'],layout:'editorial',navigation:'minimal',content_density:'balanced',services_presentation:'service_grid',trust_strategy:['reviews','local_business_identity'],mobile_strategy:'sticky_primary_cta',imagery_strategy:['verified_service_action','industry_specific_detail']};
const architectureProspect={id:20,business_name:"Cesar's Collision Center",city:'Luling',state:'LA',category:'Collision Repair',concept_design_model_json:JSON.stringify(designModel),verified_business_profile_json:JSON.stringify({business:{vertical:{value:'Collision Repair'},summary:{value:'Collision and auto body repair serving the local community.'},services:[{name:'Collision Repair'},{name:'Auto Body Repair'},{name:'Paint Refinishing'}]},identity:{city:{value:'Luling'},state:{value:'LA'},phone:{value:'985-555-0100'},email:{value:null},address:{value:null}},reputation:null}),concept_strategy_json:JSON.stringify({objective:'lead',conversion_strategy:{primary_cta:'Request an Estimate'},value_proposition:'Clear collision-repair guidance and an easy way to request an estimate'}),research_json:JSON.stringify({identity_confidence:'high',vertical:'Collision Repair',services:[{name:'Collision Repair',confidence:'high'},{name:'Auto Body Repair',confidence:'high'},{name:'Paint Refinishing',confidence:'high'}],design_profile:designModel})};
const architectureClass=classifyVisualFamily(architectureProspect);assert.equal(architectureClass.family,'local_service');assert.equal(architectureClass.score,20);const architectureSystem=getVisualSystem(architectureProspect,architectureClass);assert.equal(architectureSystem.layout,'editorial','Structured design model must control layout instead of deterministic random layout.');assert.equal(architectureSystem.headline,designModel.headline);assert.equal(architectureSystem.cta,'Request an Estimate');const architectureHtml=buildConceptDocument(architectureProspect,architectureClass);assert.ok(architectureHtml.includes(designModel.headline));assert.ok(architectureHtml.includes('Request an Estimate'));assert.ok(architectureHtml.includes('Collision Repair'));assert.ok(architectureHtml.includes('Auto Body Repair'));assert.ok(architectureHtml.includes('Paint Refinishing'));assert.ok(architectureHtml.includes('Representative visuals are generated for this concept')||architectureHtml.includes('AI-generated representative imagery'));

const adaptive={id:21,business_name:'Completely New Vertical LLC',category:'Unclassified',research_json:JSON.stringify({vertical:'Mobile Instrument Calibration',summary:'Provides on-site calibration services.',services:[{name:'On-site calibration'}],design_profile:{archetype:'local_service',mood:'clean',image_theme:'technical field service',headline:'Calibration support that comes to your operation.',cta:'Request Calibration',sections:['hero','services','process','cta'],process:['Tell us what needs calibration','Plan the visit','Complete the service'],layout:'split'}})};
const adaptiveClass=classifyVisualFamily(adaptive);assert.equal(adaptiveClass.family,'local_service');const adaptiveHtml=buildConceptDocument(adaptive,adaptiveClass);assert.ok(adaptiveHtml.includes('Calibration support that comes to your operation.'));assert.ok(adaptiveHtml.includes('Request Calibration'));assert.ok(adaptiveHtml.includes('On-site calibration'));

const stable={id:22,business_name:'Stable Business',category:'Auto Repair'};const first=getVisualSystem(stable,classifyVisualFamily(stable)),second=getVisualSystem(stable,classifyVisualFamily(stable));assert.equal(first.variant,second.variant);assert.equal(first.hero,second.hero);
console.log(`Architecture-aware Visual System smoke tests passed: ${legacyCases.length+10} checks.`);
