import {resolveEffectivePolicy as resolveSpecializedPolicy} from './policy-registry.js';

const parse=(v,fallback={})=>{try{return v?JSON.parse(v):fallback}catch{return fallback}};
const clean=(v,m=300)=>String(v??'').trim().slice(0,m);
const uniq=a=>[...new Set(a.filter(Boolean))];
const slug=v=>clean(v,80).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'local-business';
const FAMILIES=[
 ['barber',/barber|barbershop|barber shop|men'?s grooming|haircut|fade\b|beard trim/],
 ['salon',/salon|hair studio|hairstyl|beauty|nail|lash/],
 ['automotive',/mechanic|auto repair|automotive|diesel|engine|transmission|brake|tire shop/],
 ['plumbing',/plumb|drain|water heater|sewer/],
 ['electrical',/electrician|electrical|wiring|breaker/],
 ['hvac',/\bhvac\b|air condition|heating and cooling|furnace/],
 ['roofing',/roof|roofer|shingle/],
 ['restaurant',/restaurant|burger|steak|grill|cafe|coffee|bakery|pizza|seafood|food truck|catering/],
 ['nutrition',/nutrition|nutritionist|dietitian|dietician|meal plan|healthy eating|wellness coach|health coach/],
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
const UNIVERSAL_HARD_REJECTS=[
 {code:'wrong_industry',description:'Image depicts a different industry or specialty than the verified business context.',severity:'hard'},
 {code:'unsupported_service',description:'Image depicts a service, product, capability, result, credential, or affiliation that was not verified.',severity:'hard'},
 {code:'fabricated_branding',description:'Image contains fabricated logos, readable branding, prices, claims, badges, seals, or promotional text.',severity:'hard'},
 {code:'misleading_representation',description:'Image implies generated people, premises, products, projects, or results are the actual business.',severity:'hard'},
 {code:'unsafe_or_implausible',description:'Image depicts unsafe, impossible, or materially defective anatomy, tools, equipment, food, products, or work practices.',severity:'hard'}
];
const UNIVERSAL_FORBIDDEN=['unrelated industry','logos','trademarks','readable signage','watermarks','prices','fabricated claims','fabricated credentials','fabricated awards','before and after results','actual premises claim','actual employee claim','actual customer claim','actual project claim'];
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
function policyBase({policyId,industry,specialty,display,mode,services,preferred,forbidden=[],checks=[],technical=[],trustedFamily,researchFamily,thresholds={}}){
 return{
  policy_id:policyId,version:'2.0.0',policy_mode:mode,industry,specialty,display_name:display,status:'active',
  thresholds:{overall_auto_approve:82,business_relevance_min:28,service_relevance_min:8,composition_min:10,realism_min:10,brand_fit_min:7,safety_min:5,distinctiveness_min:2,...thresholds},
  representation:{allowed_classes:['representative_industry','representative_service'],forbidden_classes:['actual_customer_verified'],allow_as_actual_work:false,require_representative_disclosure:true},
  generation:{preferred_subjects:preferred,allowed_contexts:preferred,negative_prompt_terms:uniq([...UNIVERSAL_FORBIDDEN,...forbidden]),service_grounding_required:true},
  allowed_image_subjects:preferred,
  forbidden_image_subjects:uniq([...UNIVERSAL_FORBIDDEN,...forbidden]),
  hard_reject_rules:UNIVERSAL_HARD_REJECTS,
  qa_instructions:{specialty_checks:checks,technical_checks:technical.length?technical:['Reject obvious anatomy, tool, equipment, food, product, architecture, perspective, or generated-text defects.']},
  verified_service_ids:[],verified_service_names:services,
  identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':researchFamily?'research':'derived'}
 };
}
function restaurantPolicy(prospect,services,trustedFamily,researchFamily){
 const r=parse(prospect?.research_json,{}),imageTheme=clean(r?.design_profile?.image_theme,220),display=clean(r?.vertical||prospect?.business_vertical||prospect?.category||'Restaurant',120);
 const specialtyHints=uniq([imageTheme,...services.slice(0,6),prospect?.business_name]).filter(Boolean);
 const preferred=uniq([...specialtyHints,'representative plated signature food detail','representative kitchen preparation detail','warm unbranded dining atmosphere']).slice(0,10);
 return policyBase({policyId:'food.restaurant',industry:'food_service',specialty:'restaurant',display,mode:'specialized',services,preferred,forbidden:['fabricated menu text','branded packaging'],checks:['Confirm the image is unmistakably relevant to the verified restaurant specialty or menu/service context.','Representative food, preparation, or unbranded dining imagery is acceptable when it does not claim to show the actual business.','For a secondary image, favor a clearly different food detail, preparation detail, or atmosphere from the approved hero rather than rejecting a relevant image solely because it is not a different verified menu item.'],technical:['Reject obvious food, hand, utensil, kitchen-equipment, perspective, or generated-text defects.'],trustedFamily,researchFamily,thresholds:{overall_auto_approve:80,distinctiveness_min:2}});
}
function nutritionPolicy(prospect,services,trustedFamily,researchFamily){
 const r=parse(prospect?.research_json,{}),imageTheme=clean(r?.design_profile?.image_theme,220),display=clean(r?.vertical||prospect?.business_vertical||prospect?.category||'Nutrition & Wellness',120);
 const verified=services.slice(0,8);
 const preferred=uniq([imageTheme,...verified,'representative nutrition coaching consultation','healthy whole-food meal planning detail','fresh unbranded healthy food ingredients']).slice(0,10);
 const productVerified=verified.some(x=>/supplement|shake|smoothie|tea|product|protein/i.test(x));
 return policyBase({policyId:'wellness.nutrition',industry:'wellness',specialty:'nutrition',display,mode:'specialized',services,preferred,forbidden:['weight-loss before and after','body transformation result','medical diagnosis imagery','medical treatment claim','disease cure claim',...(productVerified?[]:['supplement bottles','branded nutrition products','protein tubs','shake products'])],checks:['Confirm the image is clearly relevant to the verified nutrition or wellness services.','Healthy-food, coaching, and meal-planning imagery may be representative when it does not imply clinical treatment or guaranteed results.','Supplements, shakes, smoothies, teas, or branded products may appear only when that product/service type is verified.','Reject before/after body transformation imagery and medical or disease-treatment claims.'],trustedFamily,researchFamily,thresholds:{overall_auto_approve:80,business_relevance_min:27,service_relevance_min:7}});
}
function derivedPolicy(prospect,services,trustedFamily,researchFamily){
 const r=parse(prospect?.research_json,{}),vertical=clean(r?.vertical||prospect?.business_vertical||prospect?.category,120),imageTheme=clean(r?.design_profile?.image_theme,220),summary=clean(r?.summary,220);
 const display=vertical||clean(prospect?.category,120)||'Local Business';
 const preferred=uniq([imageTheme,...services.slice(0,6),display,summary?`representative ${display.toLowerCase()} service context`:null]).filter(Boolean).slice(0,10);
 const evidenceCount=(vertical?1:0)+(imageTheme?1:0)+services.length;
 if(evidenceCount<2)return null;
 return policyBase({policyId:`derived.${slug(display)}`,industry:'derived',specialty:slug(display),display,mode:'derived',services,preferred,forbidden:['medical or legal claims unless explicitly verified','financial outcome claims','guaranteed results','unverified products','unverified specialized equipment'],checks:[`Confirm the image matches the verified business vertical: ${display}.`,'Use only the verified services and research context supplied for this prospect.','A neutral representative industry atmosphere is acceptable when it clearly fits the verified vertical and makes no unsupported claim.','Do not invent products, specialties, credentials, procedures, outcomes, or affiliations that are absent from verified research.'],trustedFamily,researchFamily,thresholds:{overall_auto_approve:80,business_relevance_min:27,service_relevance_min:7}});
}
function genericSafePolicy(prospect,services,trustedFamily,researchFamily){
 const r=parse(prospect?.research_json,{}),display=clean(r?.vertical||prospect?.business_vertical||prospect?.category||trustedFamily||researchFamily||'Local Business',120),imageTheme=clean(r?.design_profile?.image_theme,220);
 const preferred=uniq([imageTheme,display,...services.slice(0,4),'neutral representative local-business service environment']).filter(Boolean);
 return policyBase({policyId:`general.${trustedFamily||researchFamily||'local_business'}`,industry:'general',specialty:trustedFamily||researchFamily||'local_business',display,mode:'generic-safe',services,preferred,forbidden:['specialized procedure not explicitly verified','specific branded product not explicitly verified','guaranteed result'],checks:['Confirm the image matches the trusted business identity and verified services.','Prefer neutral, representative industry context over inventing a specific unverified service or product.'],trustedFamily,researchFamily,thresholds:{overall_auto_approve:83,business_relevance_min:29,service_relevance_min:7}});
}
export function resolveImagePolicy(prospect){
 const services=serviceNames(prospect),specialized=resolveSpecializedPolicy(prospect,services),trustedFamily=family(trustedIdentity(prospect)),researchFamily=family(researchIdentity(prospect));
 if(specialized)return{...specialized,policy_mode:'specialized',verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':'research'}};
 if(trustedFamily==='restaurant'||researchFamily==='restaurant')return restaurantPolicy(prospect,services,trustedFamily,researchFamily);
 if(trustedFamily==='nutrition'||researchFamily==='nutrition')return nutritionPolicy(prospect,services,trustedFamily,researchFamily);
 const derived=derivedPolicy(prospect,services,trustedFamily,researchFamily);if(derived)return derived;
 if(trustedFamily||researchFamily)return genericSafePolicy(prospect,services,trustedFamily,researchFamily);
 return{policy_id:'insufficient-research',version:'2.0.0',policy_mode:'insufficient-research',status:'blocked',verified_service_names:services,identity:{trusted_family:null,research_family:null,conflict:false,source:'insufficient_research'},reason:'Verified research does not contain enough business-specific evidence to create a safe visual policy.'};
}
