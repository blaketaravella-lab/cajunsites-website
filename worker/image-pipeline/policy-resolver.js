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
function genericPolicy(prospect){
 const r=parse(prospect?.research_json,{}),services=serviceNames(prospect),trusted=trustedIdentity(prospect),researched=researchIdentity(prospect),trustedFamily=family(trusted),researchFamily=family(researched),display=clean((trusted.split(' | ').slice(1).find(Boolean))||r?.vertical||prospect?.business_vertical||prospect?.category||trustedFamily||'Local Business',120),imageTheme=clean(r?.design_profile?.image_theme,220);
 const preferred=uniq([imageTheme,display,...services.slice(0,4)]);
 return{policy_id:`general.${trustedFamily||researchFamily||'local_business'}`,version:'1.0.0',industry:'general',specialty:trustedFamily||researchFamily||'local_business',display_name:display,status:'active',thresholds:{overall_auto_approve:85,business_relevance_min:30,service_relevance_min:10,composition_min:10,realism_min:11,brand_fit_min:7,safety_min:5,distinctiveness_min:3},representation:{allowed_classes:['representative_industry','representative_service'],forbidden_classes:['actual_customer_verified'],allow_as_actual_work:false,require_representative_disclosure:true},generation:{preferred_subjects:preferred,allowed_contexts:preferred,negative_prompt_terms:['unrelated industry','logos','readable signage','watermarks','fabricated credentials','fabricated awards','actual customer project claims'],service_grounding_required:true},allowed_image_subjects:preferred,forbidden_image_subjects:['unrelated industry','logos','readable signage','watermarks','fabricated credentials','fabricated awards','actual customer project claims'],hard_reject_rules:[{code:'wrong_industry',description:'Image depicts a different industry than the trusted business identity.',severity:'hard'},{code:'unsupported_service',description:'Image depicts a service or capability that is not verified.',severity:'hard'},{code:'misleading_representation',description:'Image implies actual staff, premises, projects, credentials, results, or affiliations that were not verified.',severity:'hard'}],qa_instructions:{specialty_checks:['Confirm the image matches the trusted business identity and verified services.'],technical_checks:['Reject obvious anatomy, tool, equipment, architecture, or generated-text defects.']},verified_service_ids:[],verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':researchFamily?'research':'generic'}};
}
export function resolveImagePolicy(prospect){
 const services=serviceNames(prospect),specialized=resolveSpecializedPolicy(prospect,services),trustedFamily=family(trustedIdentity(prospect)),researchFamily=family(researchIdentity(prospect));
 if(!specialized)return genericPolicy(prospect);
 return{...specialized,verified_service_names:services,identity:{trusted_family:trustedFamily,research_family:researchFamily,conflict:Boolean(trustedFamily&&researchFamily&&trustedFamily!==researchFamily),source:trustedFamily?'trusted_identity':'research'}};
}
