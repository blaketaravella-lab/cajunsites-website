const clean=(v,m=1000)=>String(v??'').trim().slice(0,m);
const DEFAULT_IMAGE_MODEL='gpt-image-2.5-sunburst';
const DEFAULT_QA_MODEL='gpt-5.6-luna';

function responseText(d){if(typeof d?.output_text==='string')return d.output_text.trim();const out=[];for(const item of d?.output||[])for(const c of item?.content||[])if(c?.type==='output_text'&&c?.text)out.push(c.text);return out.join('\n').trim()}
function parseJson(t){const s=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw new Error('Visual QA did not return JSON.');return JSON.parse(s.slice(a,b+1))}
const dataUrl=(b64,mime='image/webp')=>`data:${mime};base64,${b64}`;

export function imageProviderName(env){return env.IMAGE_PROVIDER||'openai'}

export async function generateImageAsset(env,{prompt,size='1536x1024',quality='medium',format='webp'}){
  const provider=imageProviderName(env);if(provider!=='openai')throw new Error(`Unsupported image provider: ${provider}`);
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for AI image generation.');
  const model=env.OPENAI_IMAGE_MODEL||DEFAULT_IMAGE_MODEL,started=Date.now();
  const res=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,prompt,size,quality,output_format:format,n:1})});
  const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d?.error?.message||`AI image generation failed (${res.status}).`);
  const item=d?.data?.[0],b64=item?.b64_json;if(!b64)throw new Error('AI image provider returned no image data.');
  return{provider,model,b64,mime:`image/${format}`,revised_prompt:item?.revised_prompt||null,duration_ms:Date.now()-started,usage:d?.usage||null};
}

export async function evaluateImageAsset(env,{prompt,image,companion=null}){
  const provider=env.IMAGE_QA_PROVIDER||'openai';if(provider!=='openai')throw new Error(`Unsupported image QA provider: ${provider}`);
  if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for visual QA.');
  const model=env.OPENAI_IMAGE_QA_MODEL||DEFAULT_QA_MODEL,content=[{type:'input_text',text:prompt},{type:'input_image',image_url:dataUrl(image.b64,image.mime)}];
  if(companion)content.push({type:'input_text',text:'Compare against this already-approved companion image and score distinctiveness accordingly.'},{type:'input_image',image_url:dataUrl(companion.b64,companion.mime)});
  const started=Date.now(),res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'user',content}]})});
  const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d?.error?.message||`Visual QA failed (${res.status}).`);
  return{provider,model,result:parseJson(responseText(d)),duration_ms:Date.now()-started,usage:d?.usage||null};
}

export function providerDiagnostics(env){return{generation_provider:imageProviderName(env),generation_model:env.OPENAI_IMAGE_MODEL||DEFAULT_IMAGE_MODEL,qa_provider:env.IMAGE_QA_PROVIDER||'openai',qa_model:env.OPENAI_IMAGE_QA_MODEL||DEFAULT_QA_MODEL}}
