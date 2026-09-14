import {resolveEffectivePolicy as resolveSpecializedPolicy} from './policy-registry.js';

const parse=(v,fallback={})=>{try{return v?JSON.parse(v):fallback}catch{return fallback}};
const clean=(v,m=300)=>String(v??'').trim().slice(0,m);
const uniq=a=>[...new Set(a.filter(Boolean))];
const FAMILIES=[
 ['barber',/barber|barbershop|barber shop|men'?s grooming|haircut|fade\b|beard trim/],
 ['salon',/salon|hair studio|hairstyl|beauty|nail|lash/],
 ['automotive',/mechanic|auto repair|automotive|diesel|engine|transmission|brake|tire shop/],
 ['plumbing',/plumb|drain|water heater|sewer/],
 ['electrical',/electrician|electrical|wiring|breaker/],
 ['hvac',/\bhvac\b|air condition|heating and cooling|furnace/],
 ['roofing',/roof|roofer|shingle/],
 ['restaurant',/restaurant|burger|steak|grill|cafe|coffee|bakery|pizza|seafood|food truck|catering/],
 ['wellness',/massage|therapeutic|spa|wellness|yoga/],
 ['childcare',/childcare|daycare|learning center|preschool|school|tutor/],
 ['floral',/florist|floral|flower|bouquet/],
 ['fitness',/fitness|gym|personal train|crossfit|boxing|martial/],
 ['pet',/pet|veterinar|animal|groom|kennel|boarding/],
 ['dentistry',/dentist|dentistry|dental/],
 ['legal',/law|legal|attorney|lawyer|estate planning|personal injury/],
 ['accounting',/accounting|accountant|\bcpa\b|bookkeep|tax prepar/],
 ['insurance',/insurance|insuranc/],
 ['cleaning',/cleaning|janitor|maid|housekeeping/],
 ['retail',/retail|boutique|store|shop|apparel|jewelry/],
 ['home_service',/landscap|contractor|construction|handyman|remodel|pest|painting|concrete/]
];
function family(text){const t=String(text||'').toLowerCase();return FAMILIES.find(([,rx])=>rx.test(t))?.[0]||null}
function serviceNames(prospect){
 const provenance=parse(prospect?.enrichment_provenance_json,{}),stored=parse(prospect?.verified_services_json,[]),research=parse(prospect?.research_json,{});
 const fromStored=Array.isArray(stored)?stored.map(x=>clean(typeof x==='string'?x:x?.name,120)).filter(Boolean):[];
 const fromResearch=Array.isArray(research?.services)?research.services.filter(x=>x?.confidence==='high').map(x=>clean(x?.name,120)).filter(Boolean):[];
 const origin=provenance?.verified_services_json?.origin;
 return uniq(origin==='manual'||origin==='manual_existing'?fromStored:[...fromStored,...fromResearch]);
}
function trustedIdentity(prospect){
 const provenance=parse(prospect?.enrichment_provenance_json,{}),manual=[];
 for(const field of ['category','business_vertical']){const origin=provenance?.[field]?.origin;if((origin==='manual'||origin==='manual_existing')&&prospect?.[field])manual.push(prospect[field])}
 return [prospect?.business_name,...manual].filter(Boolean).join(' | ');
}
function researchIdentity(prospect){const r=parse(prospect?.research_json,{});return [r?.vertical,r?.design_profile?.image_theme,...(r?.services||[]).map(x=>x?.name)].filter(Boolean).join(' | ')}
function restaurantPolicy(prospect,services,trustedFamily,researchFamily){
 const r=parse(prospect?.research_json,{}),imageTheme=clean(r?.design_profile?.image_theme,220),display=clean(r?.vertical||prospect?.business_vertical||prospect?.category||'Restaurant',120);
 const specialtyHints=uniq([imageTheme,...services.slice(0,6),prospect?.business_name]).filter(Boolean);
 const preferred=uniq([...specialtyHints,'representative plated signature food detail','representative kitchen preparation detail','warm unbranded dining atmosphere']).slice(0,10);
 return{policy_id:'food.restaurant',version:'1.0.0',industry:'food_service',specialty:'restaurant',display_name:display,status:'active',thresholds:{overall_auto_approve:80,business_relevance_min:28,service_relevance_min:8,composition_min:10,realism_min:10,brand_fit_min:7,safety_min:5,distinctiveness_min:2},representation:{allowed_classes:['representative_industry','representative_service'],forbidden_classes:['actual_customer_verified'],allow_as_actual_work:false,require_representative_disclosure:true},generation:{preferred_subjects:preferred,allowed_contexts:preferred,negative_prompt_terms:['unrelated industry','logos','readable signage','watermarks','fabricated menu text','prices','actual premises claim','actual employee claim'],service_grounding_required:true},allowed_image_subjects:preferred,forbidden_image_subjects:['unrelated industry','logos','readable signage','watermarks','fabricated menu text','prices','branded packaging','actual premises claim','actual employee claim'],hard_reject_rules:[{code:'wrong_industry',description:'Image depicts a non-food-service industry.',severity:'hard'},{code:'fabricated_branding',description:'Image contains readable fabricated restaurant branding, menu text, pricing, or logos.',severity:'hard'},{code:'misleading_representation',description:'Image explicitly presents generated people, premises, or food as the actual business rather than representative concept imagery.',severity:'hard'}],qa_instructions:{specialty_checks:['Confirm the image is unmistakably relevant to the verified restaurant specialty or menu/service context.','Representative food, preparation, or unbranded dining imagery is acceptable when it does not claim to show the actual business.','For a secondary image, favor a clearly different food detail, preparation detail, or atmosphere from the approved hero rather than rejecting a relevant image solely because it is not a different verified menu item.'],technical_checks:['Reject obvious food, hand, utensil, kitchen-equipment, perspective, or generated-text defects.']},verified_service_ids:[],verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':researchFamily?'research':'generic'}};
}
function genericPolicy(prospect){
 const r=parse(prospect?.research_json,{}),services=serviceNames(prospect),trusted=trustedIdentity(prospect),researched=researchIdentity(prospect),trustedFamily=family(trusted),researchFamily=family(researched),display=clean((trusted.split(' | ').slice(1).find(Boolean))||r?.vertical||prospect?.business_vertical||prospect?.category||trustedFamily||'Local Business',120),imageTheme=clean(r?.design_profile?.image_theme,220);
 const preferred=uniq([imageTheme,display,...services.slice(0,4)]);
 return{policy_id:`general.${trustedFamily||researchFamily||'local_business'}`,version:'1.0.0',industry:'general',specialty:trustedFamily||researchFamily||'local_business',display_name:display,status:'active',thresholds:{overall_auto_approve:85,business_relevance_min:30,service_relevance_min:10,composition_min:10,realism_min:11,brand_fit_min:7,safety_min:5,distinctiveness_min:3},representation:{allowed_classes:['representative_industry','representative_service'],forbidden_classes:['actual_customer_verified'],allow_as_actual_work:false,require_representative_disclosure:true},generation:{preferred_subjects:preferred,allowed_contexts:preferred,negative_prompt_terms:['unrelated industry','logos','readable signage','watermarks','fabricated credentials','fabricated awards','actual customer project claims'],service_grounding_required:true},allowed_image_subjects:preferred,forbidden_image_subjects:['unrelated industry','logos','readable signage','watermarks','fabricated credentials','fabricated awards','actual customer project claims'],hard_reject_rules:[{code:'wrong_industry',description:'Image depicts a different industry than the trusted business identity.',severity:'hard'},{code:'unsupported_service',description:'Image depicts a service or capability that is not verified.',severity:'hard'},{code:'misleading_representation',description:'Image implies actual staff, premises, projects, credentials, results, or affiliations that were not verified.',severity:'hard'}],qa_instructions:{specialty_checks:['Confirm the image matches the trusted business identity and verified services.'],technical_checks:['Reject obvious anatomy, tool, equipment, architecture, or generated-text defects.']},verified_service_ids:[],verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':researchFamily?'research':'generic'}};
}
export function resolveImagePolicy(prospect){
 const services=serviceNames(prospect),specialized=resolveSpecializedPolicy(prospect,services),trustedFamily=family(trustedIdentity(prospect)),researchFamily=family(researchIdentity(prospect));
 if(!specialized&&(trustedFamily==='restaurant'||researchFamily==='restaurant'))return restaurantPolicy(prospect,services,trustedFamily,researchFamily);
 if(!specialized)return genericPolicy(prospect);
 return{...specialized,verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':'research'}};
}
