const clean=(v,m=2000)=>String(v??'').trim().slice(0,m);
const safeUrl=v=>{try{const u=new URL(String(v||''));return /^https:$/.test(u.protocol)?u.toString():''}catch{return''}};
function readResearch(p){try{return p?.research_json?JSON.parse(p.research_json):null}catch{return null}}
function stableNumber(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}

const SUBJECT_RULES=[
  {key:'barber',rx:/barber|barbershop|barber shop|men'?s grooming|haircut|fade\b|beard trim/,query:'professional barbershop barber haircut barber chair clippers',positive:['barber','barbershop','haircut','hair','beard','salon'],negative:['mechanic','automotive','engine','car','garage','vehicle']},
  {key:'salon',rx:/salon|hair studio|hairstyl|beauty|nail|lash/,query:'professional hair salon stylist beauty interior',positive:['salon','hair','stylist','beauty'],negative:['mechanic','automotive','engine','garage']},
  {key:'mechanic',rx:/mechanic|auto repair|automotive|diesel|engine|transmission|brake|tire shop/,query:'professional auto repair mechanic garage automotive service',positive:['mechanic','automotive','car','engine','garage'],negative:['barber','haircut','salon']},
  {key:'plumbing',rx:/plumb|drain|water heater|sewer/,query:'professional plumber plumbing residential service',positive:['plumber','plumbing','pipe'],negative:['barber','salon','mechanic']},
  {key:'cleaning',rx:/cleaning|janitor|maid|housekeeping/,query:'professional residential cleaning service clean home',positive:['cleaning','clean','housekeeping'],negative:['mechanic','garage']},
  {key:'restaurant',rx:/restaurant|burger|steak|grill|cafe|coffee|bakery|pizza|seafood|food truck|catering/,query:'restaurant dining food hospitality interior',positive:['restaurant','food','dining','chef'],negative:['mechanic','garage']},
  {key:'massage',rx:/massage|therapeutic|spa|wellness/,query:'professional massage therapy wellness spa treatment room',positive:['massage','spa','wellness','therapy'],negative:['mechanic','automotive']},
  {key:'childcare',rx:/childcare|daycare|learning center|preschool|school|tutor/,query:'childcare learning center classroom children education',positive:['child','classroom','learning','school','education'],negative:['mechanic','garage']},
  {key:'floral',rx:/florist|floral|flower|bouquet/,query:'florist flower shop bouquets floral design',positive:['flower','floral','bouquet','florist'],negative:['mechanic','garage']},
  {key:'fitness',rx:/fitness|gym|personal train|crossfit|boxing|martial/,query:'professional fitness gym training workout',positive:['fitness','gym','training','workout'],negative:['mechanic','garage']},
  {key:'pet',rx:/pet|veterinar|animal|groom|kennel|boarding/,query:'professional pet care veterinary grooming dog',positive:['pet','dog','animal','veterinary','grooming'],negative:['mechanic','garage']},
  {key:'medical',rx:/dent|medical|clinic|doctor|healthcare|optometr/,query:'professional healthcare clinic medical office',positive:['medical','clinic','doctor','healthcare'],negative:['mechanic','garage']},
  {key:'retail',rx:/retail|boutique|store|shop|apparel|jewelry/,query:'small business boutique retail shop interior',positive:['retail','shop','store','boutique'],negative:['mechanic','garage']},
  {key:'professional',rx:/law|legal|account|consult|financial|insurance|real estate|architect/,query:'professional services office client meeting',positive:['office','professional','meeting'],negative:['mechanic','garage']},
  {key:'home_service',rx:/electric|hvac|roof|landscap|contractor|construction|handyman|remodel|pest|painting|concrete/,query:'professional home service contractor residential work',positive:['contractor','home','service','construction'],negative:['barber','salon']}
];

function trustedIdentityText(p){return [p?.business_name,p?.category,p?.business_vertical].filter(Boolean).join(' | ').toLowerCase()}
function researchIdentityText(p){const r=readResearch(p);return [r?.vertical,r?.design_profile?.image_theme,...(r?.services||[]).map(x=>x?.name)].filter(Boolean).join(' | ').toLowerCase()}
export function resolveImageSubject(p){
  const trusted=trustedIdentityText(p), researched=researchIdentityText(p);
  let rule=SUBJECT_RULES.find(x=>x.rx.test(trusted));
  let source='trusted_identity';
  if(!rule){rule=SUBJECT_RULES.find(x=>x.rx.test(researched));source='research'}
  if(!rule){rule={key:'local_business',query:'professional local small business customer service',positive:['business','professional','service'],negative:[]};source='fallback'}
  const researchRule=SUBJECT_RULES.find(x=>x.rx.test(researched));
  return {key:rule.key,query:rule.query,positive:rule.positive||[],negative:rule.negative||[],source,conflict:Boolean(source==='trusted_identity'&&researchRule&&researchRule.key!==rule.key),research_subject:researchRule?.key||null};
}

function scorePhoto(photo,subject){
  const text=String(photo?.alt||'').toLowerCase();
  let score=0;
  for(const word of subject.positive)if(text.includes(word))score+=4;
  for(const word of subject.negative)if(text.includes(word))score-=8;
  const w=Number(photo?.width)||0,h=Number(photo?.height)||0;
  if(w>h)score+=3;
  if(w>=1600)score+=2;
  return score;
}
function normalizePhoto(photo){
  const url=safeUrl(photo?.src?.large2x||photo?.src?.large||photo?.src?.landscape||photo?.src?.original);
  if(!url)return null;
  return {id:String(photo.id||''),url,alt:clean(photo.alt,240),photographer:clean(photo.photographer,160),photographer_url:safeUrl(photo.photographer_url),pexels_url:safeUrl(photo.url),width:Number(photo.width)||0,height:Number(photo.height)||0};
}

export async function selectProductionImages(env,prospect){
  if(!env.PEXELS_API_KEY)throw new Error('Production image provider is not configured. Add the PEXELS_API_KEY Worker secret.');
  const subject=resolveImageSubject(prospect);
  const url=new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query',subject.query);
  url.searchParams.set('orientation','landscape');
  url.searchParams.set('size','large');
  url.searchParams.set('per_page','30');
  const response=await fetch(url,{headers:{Authorization:env.PEXELS_API_KEY}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||`Pexels image search failed (${response.status}).`);
  const photos=(Array.isArray(data.photos)?data.photos:[]).map(p=>({photo:normalizePhoto(p),score:scorePhoto(p,subject)})).filter(x=>x.photo).sort((a,b)=>b.score-a.score);
  if(photos.length<2)throw new Error(`Production image search did not return enough usable ${subject.key} imagery.`);
  const seed=stableNumber(`${prospect?.id||''}:${prospect?.business_name||''}:${subject.key}`);
  const strong=photos.filter(x=>x.score>=0);
  const pool=strong.length>=2?strong:photos;
  const first=pool[seed%Math.min(pool.length,8)]?.photo||pool[0].photo;
  const secondPool=pool.filter(x=>x.photo.id!==first.id);
  const second=secondPool[(seed+3)%Math.min(secondPool.length,8)]?.photo||secondPool[0]?.photo;
  if(!second)throw new Error('Production image search could not select two distinct images.');
  return {provider:'pexels',subject:subject.key,query:subject.query,subject_source:subject.source,identity_conflict:subject.conflict,research_subject:subject.research_subject,hero:first,secondary:second};
}

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function replaceAllLiteral(value,from,to){return from?String(value).split(from).join(to):String(value)}
export function applyProductionImages(html,system,selection){
  let out=replaceAllLiteral(html,system?.hero,selection.hero.url);
  out=replaceAllLiteral(out,system?.secondary,selection.secondary.url);
  const credits=[selection.hero,selection.secondary].map(p=>`Photo by <a href="${esc(p.photographer_url||p.pexels_url)}" target="_blank" rel="noopener">${esc(p.photographer||'Pexels contributor')}</a> on <a href="${esc(p.pexels_url||'https://www.pexels.com')}" target="_blank" rel="noopener">Pexels</a>`).join(' · ');
  out=out.replace('Representative imagery shown for concept direction only.',`Representative ${esc(selection.subject.replaceAll('_',' '))} imagery · ${credits}`);
  out=out.replace('Final content is subject to customer approval.</footer>',`Final content is subject to customer approval. ${credits}</footer>`);
  return out;
}
