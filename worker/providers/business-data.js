const clean=(v,m=300)=>String(v??'').trim().slice(0,m);

export const SOURCE_TTLS={
  research_days:30,
  identity_days:90,
  google_reviews_days:7,
  visual_inspiration_days:30,
};

export function normalizeIdentity(prospect){
  return [prospect?.business_name,prospect?.city,prospect?.state,prospect?.phone]
    .map(v=>clean(v,200).toLowerCase().replace(/\s+/g,' '))
    .join('|');
}

export async function identityCacheKey(prospect){
  const bytes=new TextEncoder().encode(normalizeIdentity(prospect));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

export function isFresh(timestamp,days){
  if(!timestamp)return false;
  const t=Date.parse(String(timestamp).replace(' ','T')+(String(timestamp).includes('Z')?'':'Z'));
  return Number.isFinite(t)&&(Date.now()-t)<days*86400000;
}

export function shouldUseGoogleVisuals(prospect,{force=false}={}){
  if(force)return true;
  const confidence=clean(prospect?.identity_confidence||'',20).toLowerCase();
  if(confidence&&confidence!=='high')return true;
  if(!clean(prospect?.category||prospect?.business_vertical,160))return true;
  return false;
}

export function sourcePlan(prospect,{forceGoogle=false}={}){
  const confidence=clean(prospect?.identity_confidence||'',20).toLowerCase()||'unknown';
  return {
    strategy:'free_first_confidence_driven',
    identity_confidence:confidence,
    public_web:true,
    google_places:shouldUseGoogleVisuals(prospect,{force:forceGoogle}),
    ai_synthesis:true,
    reason:forceGoogle?'forced':confidence==='high'?'high-confidence identity; skip paid visual lookup':'identity/category needs stronger confirmation',
  };
}
