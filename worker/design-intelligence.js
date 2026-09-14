const clean=(v,m=240)=>String(v??'').trim().slice(0,m);
const arr=(v,n=10)=>Array.isArray(v)?v.map(x=>clean(x,120)).filter(Boolean).slice(0,n):[];
function parse(v,f={}){try{return v?JSON.parse(v):f}catch{return f}}
function research(p){return parse(p?.research_json,{})}
function directives(p){return parse(p?.design_directives_json,{})}
function designModel(p,r){return parse(p?.concept_design_model_json,null)||r?.concept_design_model||r?.design_profile||{}}
function strategy(p,r){return parse(p?.concept_strategy_json,null)||r?.concept_strategy||{}}
function normalizeModel(model,visual={},source='concept_architecture'){
 const m=model||{};
 return{schema_version:'2.0',vertical_policy:'profile_driven',objective:clean(m.objective)||'contact',personality:arr(m.personality).length?arr(m.personality):[clean(m.mood)||'confident','local','credible'],content_density:clean(m.content_density)||'balanced',hero:clean(m.hero)||clean(m.layout)||visual.layout||'split',navigation:clean(m.navigation)||'minimal',services_presentation:clean(m.services_presentation)||'service_grid',trust_strategy:arr(m.trust_strategy).length?arr(m.trust_strategy):['local_business_identity'],cta_strategy:arr(m.cta_strategy).length?arr(m.cta_strategy):[clean(m.cta)||'Contact Us'],mobile_strategy:clean(m.mobile_strategy)||'sticky_primary_cta',imagery_strategy:arr(m.imagery_strategy).length?arr(m.imagery_strategy):['verified_service_action','representative_environment'],section_sequence:arr(m.section_sequence,12).length?arr(m.section_sequence,12):arr(m.sections,12).length?arr(m.sections,12):['hero','services','trust','about','reviews','location','cta'],headline:clean(m.headline,180)||clean(visual.headline,180),image_theme:clean(m.image_theme,420),process:arr(m.process,5),source};
}
export function resolveDesignSpec(p,visual={}){
 const r=research(p),s=strategy(p,r),d=directives(p),model=designModel(p,r),merged={...model,...d};
 if(s?.objective&&!merged.objective)merged.objective=s.objective;
 if(s?.conversion_strategy?.primary_cta&&!merged.cta)merged.cta=s.conversion_strategy.primary_cta;
 if(Array.isArray(s?.content_strategy?.section_sequence)&&!merged.sections)merged.sections=s.content_strategy.section_sequence;
 if(Array.isArray(s?.visual_strategy?.tone)&&!merged.personality)merged.personality=s.visual_strategy.tone;
 if(s?.visual_strategy?.image_direction&&!merged.image_theme)merged.image_theme=s.visual_strategy.image_direction;
 const source=Object.keys(d).length?'design_studio_override':(p?.concept_design_model_json||r?.concept_design_model)?'concept_architecture':'research_fallback';
 return normalizeModel(merged,visual,source);
}
export function designSpecSummary(s){return `${s.vertical_policy}; objective=${s.objective}; hero=${s.hero}; services=${s.services_presentation}; trust=${s.trust_strategy.join(',')}; CTA=${s.cta_strategy.join('/')}; mobile=${s.mobile_strategy}; sections=${s.section_sequence.join('>')}`}
