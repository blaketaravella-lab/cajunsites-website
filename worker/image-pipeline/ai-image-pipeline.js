import {resolveImagePolicy} from './policy-resolver.js';
import {generateImageAsset,evaluateImageAsset} from '../providers/image-generation.js';

const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const HERO_ATTEMPTS=4;
const SECONDARY_ATTEMPTS=2;
const QA_RETRIES=2;
const ASSET_PATHS=Object.freeze({hero:'/assets/hero.webp',secondary:'/assets/secondary.webp'});
let schemaChecked=false;

function readResearch(p){try{return p?.research_json?JSON.parse(p.research_json):{}}catch{return{}}}
export function bytesFromB64(v){const raw=atob(v),arr=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr}
function shaLike(input){let h=2166136261;for(const ch of String(input)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}

export function buildImageBrief(prospect,role,policy,feedback=''){
  const r=readResearch(prospect),researchServices=(r.services||[]).filter(x=>x?.confidence==='high').map(x=>x.name),services=(policy?.verified_service_names?.length?policy.verified_service_names:researchServices).slice(0,8);
  const baseSubjects=policy?.allowed_image_subjects?.length?policy.allowed_image_subjects:policy?.generation?.preferred_subjects||[];
  const roleDirection=role==='hero'?'wide editorial commercial photograph, clear primary subject, 30 percent negative space suitable for website headline overlay, landscape composition':'wide commercial photograph distinct in composition from the hero, environmental, atmosphere, preparation, service-detail, or product-detail oriented, landscape orientation; it does not need to depict a different verified service if it remains clearly relevant to the same business';
  const conflict=policy?.identity?.conflict?`Stored research contains visual cues from a conflicting business family (${policy.identity.research_family}). The trusted business identity (${policy.identity.trusted_family}) controls this image. Ignore conflicting research imagery completely.`:'';
  const prompt=[`Create a photorealistic representative website image for ${prospect.business_name}.`,`Verified business specialty: ${policy?.display_name||r.vertical||prospect.category||'local business'}.`,services.length?`Verified services: ${services.join(', ')}.`:'',baseSubjects.length?`Appropriate subjects: ${baseSubjects.join('; ')}.`:'',conflict,`Image role: ${role}. ${roleDirection}.`,`The image is representative only. Do not depict or imply the actual business premises, actual employees, actual customers, actual completed projects, awards, credentials, branded fleet, or verified results unless supplied as source imagery.`,`No logos, trademarks, watermarks, readable signage, prices, claims, badges, seals, account data, legal text, medical records, license plates, or identifiable real people.`,`Avoid: ${(policy?.forbidden_image_subjects||[]).join('; ')||'unrelated industries, generated text, visual artifacts'}.`,`Professional local-small-business advertising photography, natural lighting, realistic anatomy and tools, believable environment.`,feedback?`Previous QA feedback to correct: ${clean(feedback,900)}.`:''].filter(Boolean).join(' ');
  return{role,prompt,policy_id:policy?.policy_id||'generic',policy_version:policy?.version||'1.0.0',expected_subjects:baseSubjects,verified_services:services,forbidden_subjects:policy?.forbidden_image_subjects||[],identity:policy?.identity||null};
}

async function ensureSchema(env){
  if(schemaChecked||!env.DB)return;
  await env.DB.prepare('SELECT id,prospect_id,build_id,image_role,provider,model,prompt,policy_id,policy_version,policy_hash,asset_path,deployment_id,generation_status,qa_status,qa_score,qa_json,attempt_number,representation_class,created_at,approved_at,deployed_at FROM concept_images LIMIT 0').all();
  schemaChecked=true;
}

async function trackUsage(env,prospectId,result,operation,extra={}){
  if(!env.DB)return;
  try{await env.DB.prepare(`INSERT INTO provider_usage_events (prospect_id,provider,operation,model,cache_hit,duration_ms,request_count,usage_json,created_at) VALUES (?,?,?,?,0,?,1,?,CURRENT_TIMESTAMP)`).bind(prospectId,result?.provider||'openai',operation,result?.model||null,result?.duration_ms||null,JSON.stringify({usage:result?.usage||null,...extra})).run()}catch{}
}

function effectiveThresholds(policy,role,hasCompanion){
  const t=policy?.thresholds||{overall_auto_approve:80,business_relevance_min:28,service_relevance_min:10,composition_min:10,realism_min:10,brand_fit_min:7,safety_min:5,distinctiveness_min:3};
  if(role!=='secondary')return{...t};
  return{
    ...t,
    overall_auto_approve:Math.min(Number(t.overall_auto_approve||80),78),
    business_relevance_min:Math.min(Number(t.business_relevance_min||28),26),
    service_relevance_min:Math.min(Number(t.service_relevance_min||10),5),
    composition_min:Math.min(Number(t.composition_min||10),9),
    realism_min:Math.min(Number(t.realism_min||10),9),
    brand_fit_min:Math.min(Number(t.brand_fit_min||7),6),
    distinctiveness_min:hasCompanion?Math.min(Number(t.distinctiveness_min||3),1):0,
  };
}

function qaSpec(prospect,brief,policy,hasCompanion){
  const t=effectiveThresholds(policy,brief.role,hasCompanion);
  const rules=(policy?.hard_reject_rules||[]).map(x=>`${x.code}: ${x.description}`).join('\n');
  const specialty=(policy?.qa_instructions?.specialty_checks||[]).join(' ');
  const technical=(policy?.qa_instructions?.technical_checks||[]).join(' ');
  const identityNote=policy?.identity?.conflict?`Trusted identity is ${policy.identity.trusted_family}; conflicting research family ${policy.identity.research_family} must NOT appear.`:'';
  const secondaryNote=brief.role==='secondary'?'For a secondary image, relevant atmosphere, preparation, product detail, service detail, equipment detail, or environmental imagery is acceptable. Do not penalize it merely because it does not depict a different verified service. Distinctiveness is a composition goal, not a reason to reject otherwise safe and relevant imagery unless the image is effectively a duplicate.':'';
  return{thresholds:t,prompt:`You are the fail-closed visual QA system for CajunSites. Evaluate the attached AI-generated website image for this exact business context. Business: ${prospect.business_name}. Specialty: ${policy?.display_name||'local business'}. ${identityNote} Image role: ${brief.role}. Verified services: ${brief.verified_services.join(', ')||'none supplied'}. Expected subjects: ${brief.expected_subjects.join('; ')||'professional relevant business imagery'}. Forbidden subjects: ${brief.forbidden_subjects.join('; ')||'unrelated industry content'}. Hard reject rules:\n${rules||'Wrong industry, misleading claims, visible logos/text, severe generation defects, unsafe or implausible work.'}\n${specialty} ${technical} ${secondaryNote}\nReturn ONLY JSON: {"hard_reject":true|false,"hard_reject_code":"code_or_null","overall_score":0-100,"business_relevance":0-35,"service_relevance":0-15,"composition":0-15,"realism":0-15,"brand_fit":0-10,"safety":0-5,"distinctiveness":0-5,"detected_subjects":["..."],"notes":"short factual QA explanation"}. Reject any clear industry/specialty mismatch, unsupported capability/result/credential/affiliation, visible fabricated text/logo, severe anatomy/tool/equipment defect, or unsafe trade practice. Do not hard-reject representative concept imagery merely because it does not prove the prospect actually owns the depicted scene; representative imagery is expected. For hero imagery require a usable landscape composition with meaningful negative space. The approval thresholds are overall ${t.overall_auto_approve}, business ${t.business_relevance_min}/35, service ${t.service_relevance_min}/15, composition ${t.composition_min}/15, realism ${t.realism_min}/15, brand ${t.brand_fit_min}/10, safety ${t.safety_min}/5${hasCompanion?`, distinctiveness ${t.distinctiveness_min}/5`:''}.`};
}

async function evaluateWithRetry(env,args){
  let lastError;
  for(let attempt=1;attempt<=QA_RETRIES;attempt++){
    try{return await evaluateImageAsset(env,args)}catch(error){lastError=error;if(attempt<QA_RETRIES)await new Promise(r=>setTimeout(r,150*attempt))}
  }
  throw lastError;
}

async function qa(env,prospect,brief,generated,policy,companion=null){
  const spec=qaSpec(prospect,brief,policy,Boolean(companion));
  const evaluated=await evaluateWithRetry(env,{prompt:spec.prompt,image:generated,companion:companion?.generated||null});
  await trackUsage(env,prospect.id,evaluated,'image_qa',{role:brief.role});
  const q=evaluated.result,t=spec.thresholds;
  const approved=!q.hard_reject&&Number(q.overall_score)>=t.overall_auto_approve&&Number(q.business_relevance)>=t.business_relevance_min&&Number(q.service_relevance)>=t.service_relevance_min&&Number(q.composition)>=t.composition_min&&Number(q.realism)>=t.realism_min&&Number(q.brand_fit)>=t.brand_fit_min&&Number(q.safety)>=t.safety_min&&(!companion||Number(q.distinctiveness)>=t.distinctiveness_min);
  return{...q,approved,applied_thresholds:t,qa_provider:evaluated.provider,qa_model:evaluated.model};
}

function safeQualityFloor(q,role){
  if(!q||q.hard_reject)return false;
  const overall=Number(q.overall_score||0),business=Number(q.business_relevance||0),service=Number(q.service_relevance||0),composition=Number(q.composition||0),realism=Number(q.realism||0),brand=Number(q.brand_fit||0),safety=Number(q.safety||0);
  if(role==='hero')return overall>=72&&business>=24&&service>=5&&composition>=8&&realism>=8&&brand>=5&&safety>=5;
  return overall>=68&&business>=22&&composition>=8&&realism>=8&&brand>=4&&safety>=5;
}

async function record(env,prospect,buildId,brief,generated,attempt,qaResult){
  if(!env.DB)return null;await ensureSchema(env);
  const assetPath=qaResult?.approved?ASSET_PATHS[brief.role]||null:null;
  const result=await env.DB.prepare(`INSERT INTO concept_images (prospect_id,build_id,image_role,provider,model,prompt,policy_id,policy_version,policy_hash,asset_path,generation_status,qa_status,qa_score,qa_json,attempt_number,representation_class,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(prospect.id,buildId,brief.role,generated?.provider||'openai',generated?.model||'unknown',brief.prompt,brief.policy_id,brief.policy_version,shaLike(JSON.stringify({id:brief.policy_id,version:brief.policy_version,expected:brief.expected_subjects,forbidden:brief.forbidden_subjects,identity:brief.identity})),assetPath,generated?'generated':'failed',qaResult?.approved?'approved':'rejected',Number.isFinite(Number(qaResult?.overall_score))?Number(qaResult.overall_score):null,JSON.stringify(qaResult||{}),attempt,'representative_service',qaResult?.approved?'approved':'rejected').run();
  return result.meta?.last_row_id||null;
}

async function promote(env,imageId,role,qaResult){
  if(!env.DB||!imageId)return;
  await env.DB.prepare(`UPDATE concept_images SET qa_status='approved',asset_path=?,qa_json=?,approved_at=CURRENT_TIMESTAMP WHERE id=?`).bind(ASSET_PATHS[role],JSON.stringify(qaResult),imageId).run();
}

async function generateRole(env,prospect,buildId,role,policy,companion=null){
  let feedback='',best=null,lastMessage='';
  const maxAttempts=role==='hero'?HERO_ATTEMPTS:SECONDARY_ATTEMPTS;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const brief=buildImageBrief(prospect,role,policy,feedback);let generated;
    try{
      generated=await generateImageAsset(env,{prompt:brief.prompt,size:'1536x1024',quality:'medium',format:'webp'});
      await trackUsage(env,prospect.id,generated,'image_generation',{role,attempt});
      const q=await qa(env,prospect,brief,generated,policy,companion);
      const imageId=await record(env,prospect,buildId,brief,generated,attempt,q);
      if(q.approved)return{role,asset_path:ASSET_PATHS[role],qa:{...q,approval_mode:'strict'},brief,generated,image_id:imageId,attempt};
      if(!q.hard_reject&&(!best||Number(q.overall_score||0)>Number(best.q.overall_score||0)))best={brief,generated,q,imageId,attempt};
      lastMessage=`Rejected (${q.hard_reject_code||'quality threshold'}). ${q.notes||''} Detected: ${(q.detected_subjects||[]).join(', ')}.`;
      feedback=lastMessage;
    }catch(e){
      lastMessage=clean(e?.message||e,800);
      await record(env,prospect,buildId,brief,generated,attempt,{approved:false,hard_reject:false,notes:lastMessage});
      feedback=lastMessage;
    }
  }
  if(best&&safeQualityFloor(best.q,role)){
    const promotedQa={...best.q,approved:true,approval_mode:'safe_quality_floor',notes:`${best.q.notes||''} Accepted after retry exhaustion because the image cleared CajunSites safety and relevance quality floors.`.trim()};
    await promote(env,best.imageId,role,promotedQa);
    return{role,asset_path:ASSET_PATHS[role],qa:promotedQa,brief:best.brief,generated:best.generated,image_id:best.imageId,attempt:best.attempt};
  }
  throw new Error(`Suitable ${role} imagery could not be verified after ${maxAttempts} attempts${lastMessage?`: ${clean(lastMessage,500)}`:''}.`);
}

async function secondaryFallbackFromHero(env,prospect,buildId,policy,hero,error){
  const brief=buildImageBrief(prospect,'secondary',policy,'Use the already-approved hero as a safe visual fallback.');
  const qaResult={...hero.qa,approved:true,hard_reject:false,approval_mode:'approved_hero_fallback',fallback_from:'hero',notes:`Secondary generation did not produce a better verified asset, so the already-approved hero image is reused as a safe fallback. ${clean(error?.message||error,400)}`};
  const imageId=await record(env,prospect,buildId,brief,hero.generated,SECONDARY_ATTEMPTS+1,qaResult);
  return{role:'secondary',asset_path:ASSET_PATHS.secondary,qa:qaResult,brief,generated:hero.generated,image_id:imageId,attempt:SECONDARY_ATTEMPTS+1,fallback:true};
}

export async function generateApprovedConceptImages(env,prospect,buildId){
  if(!buildId)throw new Error('AI image build requires a build ID.');
  const policy=resolveImagePolicy(prospect);await ensureSchema(env);
  const hero=await generateRole(env,prospect,buildId,'hero',policy);
  let secondary;
  try{secondary=await generateRole(env,prospect,buildId,'secondary',policy,hero)}catch(error){secondary=await secondaryFallbackFromHero(env,prospect,buildId,policy,hero,error)}
  return{provider:hero.generated.provider,model:hero.generated.model,policy_id:policy.policy_id,policy_version:policy.version,identity:policy.identity,hero,secondary,degraded:Boolean(secondary.fallback)};
}

function ensureLocalAssetReferences(html,selection){
  let out=String(html);
  const assets=[selection?.hero?.asset_path||ASSET_PATHS.hero,selection?.secondary?.asset_path||ASSET_PATHS.secondary].filter(Boolean);
  const missing=assets.filter(path=>!out.includes(path));
  if(!missing.length)return out;
  const preload=missing.map(path=>`<link rel="preload" as="image" href="${path}">`).join('');
  if(/<\/head>/i.test(out))return out.replace(/<\/head>/i,`${preload}</head>`);
  return `${preload}${out}`;
}

export function applyAIImages(html,system,selection){
  let out=String(html);
  if(system?.hero)out=out.split(system.hero).join(selection.hero.asset_path);
  if(system?.secondary)out=out.split(system.secondary).join(selection.secondary.asset_path);
  out=ensureLocalAssetReferences(out,selection);
  const fallbackNote=selection?.secondary?.fallback?' Secondary visual safely reuses the approved hero because no distinct secondary asset cleared QA.':'';
  out=out.replace('Representative imagery shown for concept direction only.',`AI-generated representative imagery for concept direction only. Visual QA policy: ${selection.policy_id}.${fallbackNote}`);
  return out;
}

export async function finalizeConceptImageDeployment(env,buildId,deploymentId){
  if(!env.DB||!buildId||!deploymentId)return;
  await ensureSchema(env);
  await env.DB.prepare(`UPDATE concept_images SET deployment_id=?,deployed_at=CURRENT_TIMESTAMP WHERE build_id=? AND qa_status='approved' AND asset_path IS NOT NULL`).bind(deploymentId,buildId).run();
}
