const clean=(v,m=1000)=>String(v??'').trim().slice(0,m);
const parse=(v,f={})=>{try{return v?JSON.parse(v):f}catch{return f}};
const uniq=a=>[...new Set((a||[]).map(x=>clean(x,180)).filter(Boolean))];
const MODEL='gpt-5.6-luna';
const ARCHITECTURE_VERSION='concept-architecture-v1';
const ARCHETYPES=['urgent_service','local_service','appointment','destination','showcase','trust_professional','family'];
const MOODS=['calm','warm','bold','clean','premium','trusted','friendly','confident'];
const safeList=(v,n=10,m=140)=>Array.isArray(v)?uniq(v.map(x=>clean(typeof x==='string'?x:x?.name,m))).slice(0,n):[];

function responseText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const out=[];for(const i of d?.output||[])for(const c of i?.content||[])if(c?.type==='output_text'&&c?.text)out.push(c.text);return out.join('\n').trim()}
function parseJsonText(t){const raw=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a<0||b<a)throw new Error('Concept strategy response did not contain JSON.');return JSON.parse(raw.slice(a,b+1))}
function factMap(r){const out={};for(const f of Array.isArray(r?.facts)?r.facts:[]){const k=clean(f?.label,80);if(k&&f?.value)out[k]={value:clean(f.value,500),confidence:clean(f.confidence,30)||null,source_url:clean(f.source_url,1000)||null}}return out}
function serviceNames(p,r){const provenance=parse(p?.enrichment_provenance_json,{}),stored=parse(p?.verified_services_json,[]);const manual=provenance?.verified_services_json?.origin==='manual'||provenance?.verified_services_json?.origin==='manual_existing';const fromStored=safeList(stored,12),fromResearch=Array.isArray(r?.services)?r.services.filter(x=>x?.confidence==='high').map(x=>clean(x?.name,140)).filter(Boolean):[];return uniq(manual?fromStored:[...fromStored,...fromResearch]).slice(0,12)}

export function buildVerifiedBusinessProfile(p){
 const r=parse(p?.research_json,{}),provenance=parse(p?.enrichment_provenance_json,{}),facts=factMap(r),services=serviceNames(p,r),sources=(Array.isArray(r?.sources)?r.sources:[]).slice(0,20).map(s=>({name:clean(s?.name||s?.title,120)||null,url:clean(s?.url||s?.source_url,1000)||null,type:clean(s?.type,60)||null})).filter(x=>x.name||x.url);
 const field=(name,fallback=null)=>({value:clean(p?.[name]??fallback,1000)||null,origin:provenance?.[name]?.origin||((p?.[name]!==undefined&&p?.[name]!==null&&String(p[name]).trim())?'stored':'research'),confidence:provenance?.[name]?.confidence||null,source_url:provenance?.[name]?.source_url||null});
 const identityConfidence=clean(r?.identity_confidence||p?.identity_confidence,30)||'unknown';
 return{
  schema_version:'1.0',profile_version:ARCHITECTURE_VERSION,
  identity:{business_name:field('business_name',p?.business_name),city:field('city',p?.city),state:field('state',p?.state),address:field('address',facts.Address?.value),phone:field('phone',facts.Phone?.value),email:field('email',facts.Email?.value),confidence:identityConfidence},
  business:{vertical:field('business_vertical',r?.vertical||p?.category),category:field('category',r?.vertical),summary:field('business_summary',r?.summary),services:services.map(name=>({name,verified:true})),hours:facts.Hours||null},
  reputation:r?.google_reviews?{google_rating:r.google_reviews.rating??null,google_review_count:r.google_reviews.count??null,source_url:clean(r.google_reviews.source_url,1000)||null,review_themes:safeList(r.review_themes,6)}:null,
  visual_reference:parse(p?.visual_inspiration_json,r?.visual_inspiration||null),
  sources,
  safeguards:{manual_data_wins:true,only_verified_services:true,no_invented_credentials:true,no_invented_results:true}
 };
}

function defaultArchitecture(profile,current={}){
 const vertical=clean(profile?.business?.vertical?.value||profile?.business?.category?.value||'Local Business',120),services=(profile?.business?.services||[]).map(x=>x.name),t=[vertical,...services].join(' ').toLowerCase();
 let archetype='local_service',objective='contact',cta='Contact Us',mood='confident';
 if(/restaurant|cafe|food|bakery|pizza|grill/.test(t)){archetype='destination';objective='visit';cta='Plan Your Visit';mood='warm'}
 else if(/barber|salon|spa|massage|wellness|fitness|dent|clinic/.test(t)){archetype='appointment';objective='appointment';cta='Book or Contact';mood='clean'}
 else if(/law|legal|attorney|account|insurance|financial/.test(t)){archetype='trust_professional';objective='consultation';cta='Request a Consultation';mood='trusted'}
 else if(/child|daycare|preschool|learning/.test(t)){archetype='family';objective='tour';cta='Schedule a Visit';mood='friendly'}
 else if(/tow|roadside|emergency/.test(t)){archetype='urgent_service';objective='call';cta='Call Now';mood='bold'}
 const imageTheme=clean(profile?.visual_reference?.hero_direction||profile?.visual_reference?.environment||`${vertical} service environment`,220);
 const sectionSequence=['hero','services','trust','about','reviews','location','cta'];
 const strategy={schema_version:'1.0',objective,primary_audience:'Local customers seeking the verified services',value_proposition:clean(profile?.business?.summary?.value,240)||`Clear, trustworthy presentation of ${vertical.toLowerCase()} services.`,conversion_strategy:{primary_cta:cta,secondary_cta:'Call',friction_reduction:['Clear services','Easy contact path','Local trust signals']},content_strategy:{service_priority:services.slice(0,6),trust_signals:['Public reviews','Verified business information'],section_sequence:sectionSequence},visual_strategy:{tone:[mood,'local','credible'],image_direction:imageTheme,avoid:['fabricated branding','unsupported services','fake credentials','misleading before/after claims']}};
 const design={schema_version:'1.0',archetype,mood,image_theme:imageTheme,headline:clean(current?.headline,180)||clean(profile?.business?.summary?.value,180)||`Trusted ${vertical} in ${profile?.identity?.city?.value||'the local area'}`,cta:clean(current?.cta,70)||cta,sections:safeList(current?.sections,8).length?safeList(current.sections,8):sectionSequence,process:safeList(current?.process,4),layout:clean(current?.layout,40)||'split',navigation:'minimal',content_density:'balanced',services_presentation:'service_grid',trust_strategy:['reviews','local_business_identity'],mobile_strategy:'sticky_primary_cta',imagery_strategy:['verified_service_action','representative_environment']};
 const imagePlan={schema_version:'1.0',roles:[{role:'hero',purpose:'Primary conversion visual',subjects:uniq([imageTheme,...services.slice(0,3)]).slice(0,6),composition:'wide landscape with headline negative space'},{role:'secondary',purpose:'Support services and trust',subjects:uniq([...services.slice(1,5),`${vertical} detail or environment`]).slice(0,6),composition:'distinct supporting landscape detail'}],universal_avoid:strategy.visual_strategy.avoid};
 return{strategy,design_model:design,image_plan:imagePlan,source:'deterministic_verified_profile'};
}

function normalizeArchitecture(raw,profile,current){
 const fallback=defaultArchitecture(profile,current),r=raw&&typeof raw==='object'?raw:{};
 const s=r.strategy||{},d=r.design_model||{},ip=r.image_plan||{};
 const strategy={...fallback.strategy,...s,conversion_strategy:{...fallback.strategy.conversion_strategy,...(s.conversion_strategy||{})},content_strategy:{...fallback.strategy.content_strategy,...(s.content_strategy||{})},visual_strategy:{...fallback.strategy.visual_strategy,...(s.visual_strategy||{})}};
 const design={...fallback.design_model,...d};if(!ARCHETYPES.includes(design.archetype))design.archetype=fallback.design_model.archetype;if(!MOODS.includes(design.mood))design.mood=fallback.design_model.mood;design.sections=safeList(design.sections,10);design.process=safeList(design.process,4);design.trust_strategy=safeList(design.trust_strategy,6);design.imagery_strategy=safeList(design.imagery_strategy,6);design.image_theme=clean(design.image_theme,300);design.headline=clean(design.headline,180);design.cta=clean(design.cta,70);
 const allowedRoles=new Set(['hero','secondary']);const roles=Array.isArray(ip.roles)?ip.roles.filter(x=>allowedRoles.has(x?.role)).map(x=>({role:x.role,purpose:clean(x.purpose,160),subjects:safeList(x.subjects,8),composition:clean(x.composition,180)})):[];
 const image_plan={...fallback.image_plan,...ip,roles:roles.length===2?roles:fallback.image_plan.roles,universal_avoid:uniq([...(fallback.image_plan.universal_avoid||[]),...safeList(ip.universal_avoid,12)])};
 return{strategy,design_model:design,image_plan,source:'ai_verified_profile'};
}

export async function compileConceptArchitecture(env,p){
 const profile=buildVerifiedBusinessProfile(p),directives=parse(p?.design_directives_json,{}),fallback=defaultArchitecture(profile,directives);
 if(profile.identity.confidence==='low')return{profile,...fallback,architecture_version:ARCHITECTURE_VERSION,build_readiness:'needs_identity_review'};
 if(!(profile.business.vertical.value||profile.business.services.length))return{profile,...fallback,architecture_version:ARCHITECTURE_VERSION,build_readiness:'needs_research_review'};
 if(!env?.OPENAI_API_KEY)return{profile,...fallback,architecture_version:ARCHITECTURE_VERSION,build_readiness:'ready'};
 const instructions=`You are the CajunSites Concept Strategy Compiler. Build a conversion-focused website strategy from ONLY the supplied Verified Business Profile. Never invent services, products, credentials, awards, warranties, affiliations, results, locations, staff, years in business, or claims. The design should feel specific to this business and industry, not generic. Return ONLY JSON with exactly three top-level objects: strategy, design_model, image_plan. strategy must include objective, primary_audience, value_proposition, conversion_strategy {primary_cta, secondary_cta, friction_reduction[]}, content_strategy {service_priority[], trust_signals[], section_sequence[]}, visual_strategy {tone[], image_direction, avoid[]}. design_model must include archetype, mood, image_theme, headline, cta, sections[], process[], layout, navigation, content_density, services_presentation, trust_strategy[], mobile_strategy, imagery_strategy[]. Allowed archetypes: ${ARCHETYPES.join(', ')}. Allowed moods: ${MOODS.join(', ')}. image_plan must contain exactly two roles: hero and secondary. Each role must have purpose, subjects[], composition. Subjects must be grounded in the verified vertical/services. Do not use fake branding or imply generated imagery shows the actual business.`;
 const input=`Verified Business Profile:\n${JSON.stringify(profile)}\n\nCurrent human-approved design directives (must be preserved unless incompatible with verified facts):\n${JSON.stringify(directives)}`;
 try{const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_CONCEPT_MODEL||env.OPENAI_DESIGN_MODEL||MODEL,instructions,input})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data?.error?.message||`Concept strategy request failed (${res.status})`);const normalized=normalizeArchitecture(parseJsonText(responseText(data)),profile,directives);return{profile,...normalized,architecture_version:ARCHITECTURE_VERSION,build_readiness:'ready'}}catch(error){return{profile,...fallback,architecture_version:ARCHITECTURE_VERSION,build_readiness:'ready',warning:`AI strategy fallback: ${clean(error?.message||error,500)}`}}
}

export function bridgeArchitectureIntoResearch(p,architecture){
 const r=parse(p?.research_json,{}),d=architecture.design_model;return{...r,verified_business_profile:architecture.profile,concept_strategy:architecture.strategy,concept_design_model:d,concept_image_plan:architecture.image_plan,design_profile:{...(r.design_profile||{}),...d},design_profile_origin:'concept_architecture'};
}

export {ARCHITECTURE_VERSION};
