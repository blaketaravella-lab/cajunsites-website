import {resolveImagePolicy} from './policy-resolver.js';
import {generateImageAsset,evaluateImageAsset} from '../providers/image-generation.js';

const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const MAX_ATTEMPTS=3;
const ASSET_PATHS=Object.freeze({hero:'/assets/hero.webp',secondary:'/assets/secondary.webp'});
let schemaChecked=false;

function readResearch(p){try{return p?.research_json?JSON.parse(p.research_json):{}}catch{return{}}}
export function bytesFromB64(v){const raw=atob(v),arr=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr}
function shaLike(input){let h=2166136261;for(const ch of String(input)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}

export function buildImageBrief(prospect,role,policy,feedback=''){
  const r=readResearch(prospect),researchServices=(r.services||[]).filter(x=>x?.confidence==='high').map(x=>x.name),services=(policy?.verified_service_names?.length?policy.verified_service_names:researchServices).slice(0,8);
  const baseSubjects=policy?.allowed_image_subjects?.length?policy.allowed_image_subjects:policy?.generation?.preferred_subjects||[];
  const roleDirection=role==='hero'?'wide editorial commercial photograph, clear primary subject, 30 percent negative space suitable for website headline overlay, landscape composition':'wide commercial photograph clearly distinct from the hero, environmental or detail-oriented composition, landscape orientation';
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

function qaSpec(prospect,brief,policy,hasCompanion){
  const t=policy?.thresholds||{overall_auto_approve:80,business_relevance_min:28,service_relevance_min:10,composition_min:10,realism_min:10,brand_fit_min:7,safety_min:5,distinctiveness_min:3};
  const rules=(policy?.hard_reject_rules||[]).map(x=>`${x.code}: ${x.description}`).join('\n');
  const identityNote=policy?.identity?.conflict?`Trusted identity is ${policy.identity.trusted_family}; conflicting research family ${policy.identity.research_family} must NOT appear.`:'';
  return{thresholds:t,prompt:`You are the fail-closed visual QA system for CajunSites. Evaluate the attached AI-generated website image for this exact business context. Business: ${prospect.business_name}. Specialty: ${policy?.display_name||'local business'}. ${identityNote} Image role: ${brief.role}. Verified services: ${brief.verified_services.join(', ')||'none supplied'}. Expected subjects: ${brief.expected_subjects.join('; ')||'professional relevant business imagery'}. Forbidden subjects: ${brief.forbidden_subjects.join('; ')||'unrelated industry content'}. Hard reject rules:\n${rules||'Wrong industry, misleading claims, visible logos/text, severe generation defects, unsafe or implausible work.'}\nReturn ONLY JSON: {"hard_reject":true|false,"hard_reject_code":"code_or_null","overall_score":0-100,"business_relevance":0-35,"service_relevance":0-15,"composition":0-15,"realism":0-15,"brand_fit":0-10,"safety":0-5,"distinctiveness":0-5,"detected_subjects":["..."],"notes":"short factual QA explanation"}. Reject any clear industry/specialty mismatch, unsupported service/capability/result/credential/affiliation, visible fabricated text/logo, severe anatomy/tool/equipment defect, or unsafe trade practice. For hero imagery require a usable landscape composition with meaningful negative space. The approval thresholds are overall ${t.overall_auto_approve}, business ${t.business_relevance_min}/35, service ${t.service_relevance_min}/15, composition ${t.composition_min}/15, realism ${t.realism_min}/15, brand ${t.brand_fit_min}/10, safety ${t.safety_min}/5${hasCompanion?`, distinctiveness ${t.distinctiveness_min}/5`:''}.`};
}

async function qa(env,prospect,brief,generated,policy,companion=null){
  const spec=qaSpec(prospect,brief,policy,Boolean(companion));
  const evaluated=await evaluateImageAsset(env,{prompt:spec.prompt,image:generated,companion:companion?.generated||null});
  await trackUsage(env,prospect.id,evaluated,'image_qa',{role:brief.role});
  const q=evaluated.result,t=spec.thresholds;
  const approved=!q.hard_reject&&Number(q.overall_score)>=t.overall_auto_approve&&Number(q.business_relevance)>=t.business_relevance_min&&Number(q.service_relevance)>=t.service_relevance_min&&Number(q.composition)>=t.composition_min&&Number(q.realism)>=t.realism_min&&Number(q.brand_fit)>=t.brand_fit_min&&Number(q.safety)>=t.safety_min&&(!companion||Number(q.distinctiveness)>=t.distinctiveness_min);
  return{...q,approved,qa_provider:evaluated.provider,qa_model:evaluated.model};
}

async function record(env,prospect,buildId,brief,generated,attempt,qaResult){
  if(!env.DB)return null;await ensureSchema(env);
  const assetPath=qaResult?.approved?ASSET_PATHS[brief.role]||null:null;
  const result=await env.DB.prepare(`INSERT INTO concept_images (prospect_id,build_id,image_role,provider,model,prompt,policy_id,policy_version,policy_hash,asset_path,generation_status,qa_status,qa_score,qa_json,attempt_number,representation_class,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(prospect.id,buildId,brief.role,generated?.provider||'openai',generated?.model||'unknown',brief.prompt,brief.policy_id,brief.policy_version,shaLike(JSON.stringify({id:brief.policy_id,version:brief.policy_version,expected:brief.expected_subjects,forbidden:brief.forbidden_subjects,identity:brief.identity})),assetPath,generated?'generated':'failed',qaResult?.approved?'approved':'rejected',Number.isFinite(Number(qaResult?.overall_score))?Number(qaResult.overall_score):null,JSON.stringify(qaResult||{}),attempt,'representative_service',qaResult?.approved?'approved':'rejected').run();
  return result.meta?.last_row_id||null;
}

async function generateRole(env,prospect,buildId,role,policy,companion=null){
  let feedback='';
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    const brief=buildImageBrief(prospect,role,policy,feedback);let generated;
    try{
      generated=await generateImageAsset(env,{prompt:brief.prompt,size:'1536x1024',quality:'medium',format:'webp'});
      await trackUsage(env,prospect.id,generated,'image_generation',{role,attempt});
      const q=await qa(env,prospect,brief,generated,policy,companion);
      const imageId=await record(env,prospect,buildId,brief,generated,attempt,q);
      if(q.approved)return{role,asset_path:ASSET_PATHS[role],qa:q,brief,generated,image_id:imageId,attempt};
      feedback=`Rejected (${q.hard_reject_code||'quality threshold'}). ${q.notes||''} Detected: ${(q.detected_subjects||[]).join(', ')}.`;
    }catch(e){await record(env,prospect,buildId,brief,generated,attempt,{approved:false,hard_reject:false,notes:clean(e?.message||e,800)});feedback=clean(e?.message||e,800)}
  }
  throw new Error(`Suitable ${role} imagery could not be verified after ${MAX_ATTEMPTS} attempts.`);
}

export async function generateApprovedConceptImages(env,prospect,buildId){
  if(!buildId)throw new Error('AI image build requires a build ID.');
  const policy=resolveImagePolicy(prospect);await ensureSchema(env);
  const hero=await generateRole(env,prospect,buildId,'hero',policy);
  const secondary=await generateRole(env,prospect,buildId,'secondary',policy,hero);
  return{provider:hero.generated.provider,model:hero.generated.model,policy_id:policy.policy_id,policy_version:policy.version,identity:policy.identity,hero,secondary};
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
  out=out.replace('Representative imagery shown for concept direction only.',`AI-generated representative imagery for concept direction only. Visual QA policy: ${selection.policy_id}.`);
  return out;
}

export async function finalizeConceptImageDeployment(env,buildId,deploymentId){
  if(!env.DB||!buildId||!deploymentId)return;
  await ensureSchema(env);
  await env.DB.prepare(`UPDATE concept_images SET deployment_id=?,deployed_at=CURRENT_TIMESTAMP WHERE build_id=? AND qa_status='approved' AND asset_path IS NOT NULL`).bind(deploymentId,buildId).run();
}
