import {resolveImagePolicy} from './policy-resolver.js';

const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const IMAGE_MODEL='gpt-image-2.5-sunburst';
const QA_MODEL='gpt-5.6-luna';
const MAX_ATTEMPTS=3;
const ASSET_PATHS=Object.freeze({hero:'/assets/hero.webp',secondary:'/assets/secondary.webp'});

function readResearch(p){try{return p?.research_json?JSON.parse(p.research_json):{}}catch{return{}}}
function responseText(d){if(typeof d?.output_text==='string')return d.output_text.trim();const a=[];for(const i of d?.output||[])for(const c of i?.content||[])if(c?.type==='output_text'&&c?.text)a.push(c.text);return a.join('\n').trim()}
function parseJson(t){const s=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw new Error('Visual QA did not return JSON.');return JSON.parse(s.slice(a,b+1))}
export function bytesFromB64(v){const raw=atob(v),arr=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr}
function dataUrl(b64,mime='image/webp'){return`data:${mime};base64,${b64}`}
function shaLike(input){let h=2166136261;for(const ch of String(input)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}

export function buildImageBrief(prospect,role,policy,feedback=''){
  const r=readResearch(prospect),researchServices=(r.services||[]).filter(x=>x?.confidence==='high').map(x=>x.name),services=(policy?.verified_service_names?.length?policy.verified_service_names:researchServices).slice(0,8);
  const baseSubjects=policy?.allowed_image_subjects?.length?policy.allowed_image_subjects:policy?.generation?.preferred_subjects||[];
  const roleDirection=role==='hero'?'wide editorial commercial photograph, clear primary subject, 30 percent negative space suitable for website headline overlay, landscape composition':'wide commercial photograph clearly distinct from the hero, environmental or detail-oriented composition, landscape orientation';
  const conflict=policy?.identity?.conflict?`Stored research contains visual cues from a conflicting business family (${policy.identity.research_family}). The trusted business identity (${policy.identity.trusted_family}) controls this image. Ignore conflicting research imagery completely.`:'';
  const prompt=[`Create a photorealistic representative website image for ${prospect.business_name}.`,`Verified business specialty: ${policy?.display_name||r.vertical||prospect.category||'local business'}.`,services.length?`Verified services: ${services.join(', ')}.`:'',baseSubjects.length?`Appropriate subjects: ${baseSubjects.join('; ')}.`:'',conflict,`Image role: ${role}. ${roleDirection}.`,`The image is representative only. Do not depict or imply the actual business premises, actual employees, actual customers, actual completed projects, awards, credentials, branded fleet, or verified results unless supplied as source imagery.`,`No logos, trademarks, watermarks, readable signage, prices, claims, badges, seals, account data, legal text, medical records, license plates, or identifiable real people.`,`Avoid: ${(policy?.forbidden_image_subjects||[]).join('; ')||'unrelated industries, generated text, visual artifacts'}.`,`Professional local-small-business advertising photography, natural lighting, realistic anatomy and tools, believable environment.`,feedback?`Previous QA feedback to correct: ${clean(feedback,900)}.`:''].filter(Boolean).join(' ');
  return{role,prompt,policy_id:policy?.policy_id||'generic',policy_version:policy?.version||'1.0.0',expected_subjects:baseSubjects,verified_services:services,forbidden_subjects:policy?.forbidden_image_subjects||[],identity:policy?.identity||null};
}

async function generate(env,brief){
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for AI image generation.');
  const model=env.OPENAI_IMAGE_MODEL||IMAGE_MODEL;
  const res=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,prompt:brief.prompt,size:'1536x1024',quality:'medium',output_format:'webp',n:1})});
  const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d?.error?.message||`AI image generation failed (${res.status}).`);const item=d?.data?.[0],b64=item?.b64_json;if(!b64)throw new Error('AI image provider returned no image data.');return{b64,mime:'image/webp',model,revised_prompt:item?.revised_prompt||null};
}

async function qa(env,prospect,brief,generated,policy,otherImageDataUrl=null){
  const thresholds=policy?.thresholds||{overall_auto_approve:80,business_relevance_min:28,service_relevance_min:10,composition_min:10,realism_min:10,brand_fit_min:7,safety_min:5,distinctiveness_min:3};
  const rules=(policy?.hard_reject_rules||[]).map(x=>`${x.code}: ${x.description}`).join('\n');
  const identityNote=policy?.identity?.conflict?`Trusted identity is ${policy.identity.trusted_family}; conflicting research family ${policy.identity.research_family} must NOT appear.`:'';
  const prompt=`You are the fail-closed visual QA system for CajunSites. Evaluate the attached AI-generated website image for this exact business context. Business: ${prospect.business_name}. Specialty: ${policy?.display_name||'local business'}. ${identityNote} Image role: ${brief.role}. Verified services: ${brief.verified_services.join(', ')||'none supplied'}. Expected subjects: ${brief.expected_subjects.join('; ')||'professional relevant business imagery'}. Forbidden subjects: ${brief.forbidden_subjects.join('; ')||'unrelated industry content'}. Hard reject rules:\n${rules||'Wrong industry, misleading claims, visible logos/text, severe generation defects, unsafe or implausible work.'}\nReturn ONLY JSON: {"hard_reject":true|false,"hard_reject_code":"code_or_null","overall_score":0-100,"business_relevance":0-35,"service_relevance":0-15,"composition":0-15,"realism":0-15,"brand_fit":0-10,"safety":0-5,"distinctiveness":0-5,"detected_subjects":["..."],"notes":"short factual QA explanation"}. Reject any clear industry/specialty mismatch, unsupported service/capability/result/credential/affiliation, visible fabricated text/logo, severe anatomy/tool/equipment defect, or unsafe trade practice. For hero imagery require a usable landscape composition with meaningful negative space. The approval thresholds are overall ${thresholds.overall_auto_approve}, business ${thresholds.business_relevance_min}/35, service ${thresholds.service_relevance_min}/15, composition ${thresholds.composition_min}/15, realism ${thresholds.realism_min}/15, brand ${thresholds.brand_fit_min}/10, safety ${thresholds.safety_min}/5${otherImageDataUrl?`, distinctiveness ${thresholds.distinctiveness_min}/5`:''}.`;
  const content=[{type:'input_text',text:prompt},{type:'input_image',image_url:dataUrl(generated.b64,generated.mime)}];
  if(otherImageDataUrl)content.push({type:'input_text',text:'Compare against this already-approved companion image and score distinctiveness accordingly. Reject a near-duplicate composition, subject pose, camera angle, or environment.'},{type:'input_image',image_url:otherImageDataUrl});
  const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_IMAGE_QA_MODEL||QA_MODEL,input:[{role:'user',content}]})});
  const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d?.error?.message||`Visual QA failed (${res.status}).`);const q=parseJson(responseText(d));
  const approved=!q.hard_reject&&Number(q.overall_score)>=thresholds.overall_auto_approve&&Number(q.business_relevance)>=thresholds.business_relevance_min&&Number(q.service_relevance)>=thresholds.service_relevance_min&&Number(q.composition)>=thresholds.composition_min&&Number(q.realism)>=thresholds.realism_min&&Number(q.brand_fit)>=thresholds.brand_fit_min&&Number(q.safety)>=thresholds.safety_min&&(!otherImageDataUrl||Number(q.distinctiveness)>=thresholds.distinctiveness_min);
  return{...q,approved};
}

async function ensureSchema(env){
  if(!env.DB)return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL,
    build_id TEXT,
    image_role TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    policy_id TEXT,
    policy_version TEXT,
    policy_hash TEXT,
    asset_path TEXT,
    deployment_id TEXT,
    generation_status TEXT NOT NULL,
    qa_status TEXT,
    qa_score INTEGER,
    qa_json TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    representation_class TEXT NOT NULL DEFAULT 'representative_service',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    deployed_at TEXT
  )`).run();
  for(const sql of [
    'ALTER TABLE concept_images ADD COLUMN build_id TEXT',
    'ALTER TABLE concept_images ADD COLUMN asset_path TEXT',
    'ALTER TABLE concept_images ADD COLUMN deployment_id TEXT',
    'ALTER TABLE concept_images ADD COLUMN qa_score INTEGER',
    'ALTER TABLE concept_images ADD COLUMN deployed_at TEXT'
  ]){try{await env.DB.prepare(sql).run()}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_concept_images_prospect ON concept_images(prospect_id,image_role,created_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_concept_images_build ON concept_images(build_id,image_role,attempt_number)`).run();
}

async function record(env,prospect,buildId,brief,generated,attempt,qaResult){
  if(!env.DB)return null;await ensureSchema(env);
  const assetPath=qaResult?.approved?ASSET_PATHS[brief.role]||null:null;
  const result=await env.DB.prepare(`INSERT INTO concept_images (prospect_id,build_id,image_role,provider,model,prompt,policy_id,policy_version,policy_hash,asset_path,generation_status,qa_status,qa_score,qa_json,attempt_number,representation_class,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(prospect.id,buildId,brief.role,'openai',generated?.model||env.OPENAI_IMAGE_MODEL||IMAGE_MODEL,brief.prompt,brief.policy_id,brief.policy_version,shaLike(JSON.stringify({id:brief.policy_id,version:brief.policy_version,expected:brief.expected_subjects,forbidden:brief.forbidden_subjects,identity:brief.identity})),assetPath,generated?'generated':'failed',qaResult?.approved?'approved':'rejected',Number.isFinite(Number(qaResult?.overall_score))?Number(qaResult.overall_score):null,JSON.stringify(qaResult||{}),attempt,'representative_service',qaResult?.approved?'approved':'rejected').run();
  return result.meta?.last_row_id||null;
}

async function generateRole(env,prospect,buildId,role,policy,companion=null){
  let feedback='';
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    const brief=buildImageBrief(prospect,role,policy,feedback);let generated;
    try{
      generated=await generate(env,brief);
      const q=await qa(env,prospect,brief,generated,policy,companion?dataUrl(companion.generated.b64,companion.generated.mime):null);
      const imageId=await record(env,prospect,buildId,brief,generated,attempt,q);
      if(q.approved)return{role,asset_path:ASSET_PATHS[role],qa:q,brief,generated,image_id:imageId,attempt};
      feedback=`Rejected (${q.hard_reject_code||'quality threshold'}). ${q.notes||''} Detected: ${(q.detected_subjects||[]).join(', ')}.`;
    }catch(e){
      await record(env,prospect,buildId,brief,generated,attempt,{approved:false,hard_reject:false,notes:clean(e?.message||e,800)});
      feedback=clean(e?.message||e,800);
    }
  }
  throw new Error(`Suitable ${role} imagery could not be verified after ${MAX_ATTEMPTS} attempts.`);
}

export async function generateApprovedConceptImages(env,prospect,buildId){
  if(!buildId)throw new Error('AI image build requires a build ID.');
  const policy=resolveImagePolicy(prospect);await ensureSchema(env);
  const hero=await generateRole(env,prospect,buildId,'hero',policy);
  const secondary=await generateRole(env,prospect,buildId,'secondary',policy,hero);
  return{provider:'openai',model:hero.generated.model,policy_id:policy.policy_id,policy_version:policy.version,identity:policy.identity,hero,secondary};
}

export function applyAIImages(html,system,selection){
  let out=String(html).split(system.hero).join(selection.hero.asset_path).split(system.secondary).join(selection.secondary.asset_path);
  out=out.replace('Representative imagery shown for concept direction only.',`AI-generated representative imagery for concept direction only. Visual QA policy: ${selection.policy_id}.`);
  return out;
}

export async function finalizeConceptImageDeployment(env,buildId,deploymentId){
  if(!env.DB||!buildId||!deploymentId)return;
  await ensureSchema(env);
  await env.DB.prepare(`UPDATE concept_images SET deployment_id=?,deployed_at=CURRENT_TIMESTAMP WHERE build_id=? AND qa_status='approved' AND asset_path IS NOT NULL`).bind(deploymentId,buildId).run();
}
