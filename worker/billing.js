import appWorker from './prospect-enrichment.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const CUSTOMER_BILLING_RE=/^\/api\/admin\/customers\/(\d+)\/billing$/;
const CUSTOMER_INVOICES_RE=/^\/api\/admin\/customers\/(\d+)\/invoices$/;
const SEND_INVOICE_RE=/^\/api\/admin\/invoices\/(in_[A-Za-z0-9_]+)\/send$/;

async function getActor(request,env){
  const url=new URL(request.url);
  url.pathname='/api/admin/me';
  url.search='';
  const headers=new Headers();
  const cookie=request.headers.get('cookie');
  if(cookie)headers.set('cookie',cookie);
  const authResponse=await appWorker.fetch(new Request(url.toString(),{method:'GET',headers}),env);
  if(!authResponse.ok)return null;
  try{return (await authResponse.json()).user||null}catch{return null}
}

function canMutate(actor){return actor&&['owner','admin','operator'].includes(actor.role)}

async function stripeRequest(env,path,{method='GET',params=null}={}){
  if(!env.STRIPE_SECRET_KEY)throw new Error('STRIPE_SECRET_KEY is not configured');
  const init={method,headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'stripe-version':'2024-06-20'}};
  let url=`https://api.stripe.com/v1${path}`;
  if(params){
    const body=new URLSearchParams();
    for(const [key,value] of Object.entries(params)){
      if(value===undefined||value===null||value==='')continue;
      body.append(key,String(value));
    }
    if(method==='GET')url+=`?${body.toString()}`;
    else{
      init.headers['content-type']='application/x-www-form-urlencoded';
      init.body=body.toString();
    }
  }
  const response=await fetch(url,init);
  const text=await response.text();
  let payload={};
  try{payload=text?JSON.parse(text):{}}catch{payload={raw:text}}
  if(!response.ok){
    const message=payload?.error?.message||`Stripe request failed (${response.status})`;
    const error=new Error(message);
    error.status=response.status;
    throw error;
  }
  return payload;
}

async function getCustomer(env,id){
  if(!env.DB)return null;
  return env.DB.prepare('SELECT id,customer_name,business_name,email,stripe_customer_id,stripe_subscription_id,status FROM customers WHERE id=? LIMIT 1').bind(id).first();
}

function normalizeInvoice(invoice){
  return {
    id:invoice.id,
    number:invoice.number||null,
    status:invoice.status||'unknown',
    currency:(invoice.currency||'usd').toUpperCase(),
    amount_due:Number(invoice.amount_due||0),
    amount_paid:Number(invoice.amount_paid||0),
    amount_remaining:Number(invoice.amount_remaining||0),
    subtotal:Number(invoice.subtotal||0),
    total:Number(invoice.total||0),
    description:invoice.description||invoice.lines?.data?.[0]?.description||null,
    created:invoice.created||null,
    due_date:invoice.due_date||null,
    paid_at:invoice.status_transitions?.paid_at||null,
    hosted_invoice_url:invoice.hosted_invoice_url||null,
    invoice_pdf:invoice.invoice_pdf||null,
    customer_email:invoice.customer_email||null,
    collection_method:invoice.collection_method||null,
  };
}

function normalizeSubscription(subscription){
  if(!subscription)return null;
  const item=subscription.items?.data?.[0]||null;
  const price=item?.price||null;
  return {
    id:subscription.id,
    status:subscription.status,
    current_period_start:subscription.current_period_start||item?.current_period_start||null,
    current_period_end:subscription.current_period_end||item?.current_period_end||null,
    cancel_at_period_end:Boolean(subscription.cancel_at_period_end),
    cancel_at:subscription.cancel_at||null,
    currency:(price?.currency||'usd').toUpperCase(),
    amount:Number(price?.unit_amount||0),
    interval:price?.recurring?.interval||null,
    product:typeof price?.product==='string'?price.product:null,
  };
}

async function billingSnapshot(env,customer){
  if(!customer.stripe_customer_id){
    return {customer:{id:customer.id,business_name:customer.business_name,customer_name:customer.customer_name,email:customer.email,stripe_customer_id:null},stripe_customer:null,subscription:null,invoices:[],stripe_configured:Boolean(env.STRIPE_SECRET_KEY)};
  }
  const [stripeCustomer,invoices,subscriptions]=await Promise.all([
    stripeRequest(env,`/customers/${encodeURIComponent(customer.stripe_customer_id)}`),
    stripeRequest(env,'/invoices',{params:{customer:customer.stripe_customer_id,limit:100}}),
    stripeRequest(env,'/subscriptions',{params:{customer:customer.stripe_customer_id,status:'all',limit:20}}),
  ]);
  const preferred=(subscriptions.data||[]).find(s=>s.id===customer.stripe_subscription_id)||(subscriptions.data||[]).find(s=>['active','trialing','past_due','unpaid'].includes(s.status))||(subscriptions.data||[])[0]||null;
  return {
    customer:{id:customer.id,business_name:customer.business_name,customer_name:customer.customer_name,email:customer.email,stripe_customer_id:customer.stripe_customer_id},
    stripe_customer:{id:stripeCustomer.id,name:stripeCustomer.name||null,email:stripeCustomer.email||null,balance:Number(stripeCustomer.balance||0),delinquent:Boolean(stripeCustomer.delinquent)},
    subscription:normalizeSubscription(preferred),
    invoices:(invoices.data||[]).map(normalizeInvoice),
    stripe_configured:true,
  };
}

async function handleBillingGet(env,customerId){
  const customer=await getCustomer(env,customerId);
  if(!customer)return json({ok:false,error:'Customer not found.'},404);
  try{return json({ok:true,...await billingSnapshot(env,customer)})}
  catch(error){
    console.error('Stripe billing snapshot failed',{customerId,error:error instanceof Error?error.message:String(error)});
    return json({ok:false,error:error instanceof Error?error.message:'Unable to load Stripe billing.'},error?.status===401?503:502);
  }
}

async function createInvoice(request,env,actor,customerId){
  if(!canMutate(actor))return json({ok:false,error:'Your role is read only.'},403);
  const customer=await getCustomer(env,customerId);
  if(!customer)return json({ok:false,error:'Customer not found.'},404);
  if(!customer.stripe_customer_id)return json({ok:false,error:'This customer is not linked to a Stripe customer yet.'},409);
  let data;try{data=await request.json()}catch{return json({ok:false,error:'Invalid request.'},400)}
  const description=clean(data.description,500);
  const amountDollars=Number(data.amount);
  const dueDays=Math.max(1,Math.min(90,Number.parseInt(data.due_days,10)||14));
  const memo=clean(data.memo,1000);
  if(!description)return json({ok:false,error:'Invoice description is required.'},400);
  if(!Number.isFinite(amountDollars)||amountDollars<=0)return json({ok:false,error:'Enter a valid invoice amount greater than $0.'},400);
  const amount=Math.round(amountDollars*100);
  try{
    const invoice=await stripeRequest(env,'/invoices',{method:'POST',params:{customer:customer.stripe_customer_id,collection_method:'send_invoice',days_until_due:dueDays,description:memo||undefined,'metadata[cajunsites_customer_id]':customer.id,'metadata[cajunsites_business_name]':customer.business_name||''}});
    await stripeRequest(env,'/invoiceitems',{method:'POST',params:{customer:customer.stripe_customer_id,invoice:invoice.id,amount,currency:'usd',description}});
    const refreshed=await stripeRequest(env,`/invoices/${encodeURIComponent(invoice.id)}`);
    return json({ok:true,invoice:normalizeInvoice(refreshed)},201);
  }catch(error){
    console.error('Stripe invoice creation failed',{customerId,error:error instanceof Error?error.message:String(error)});
    return json({ok:false,error:error instanceof Error?error.message:'Unable to create invoice.'},error?.status===401?503:502);
  }
}

async function sendInvoice(env,actor,invoiceId){
  if(!canMutate(actor))return json({ok:false,error:'Your role is read only.'},403);
  try{
    let invoice=await stripeRequest(env,`/invoices/${encodeURIComponent(invoiceId)}`);
    const linked=await env.DB.prepare('SELECT id,business_name,email FROM customers WHERE stripe_customer_id=? LIMIT 1').bind(invoice.customer).first();
    if(!linked)return json({ok:false,error:'That Stripe invoice does not belong to a CajunSites customer.'},403);
    if(invoice.status==='draft')invoice=await stripeRequest(env,`/invoices/${encodeURIComponent(invoiceId)}/finalize`,{method:'POST'});
    if(invoice.status==='paid')return json({ok:false,error:'This invoice is already paid.'},409);
    if(invoice.status==='void'||invoice.status==='uncollectible')return json({ok:false,error:`This invoice cannot be sent because it is ${invoice.status}.`},409);
    const sent=await stripeRequest(env,`/invoices/${encodeURIComponent(invoiceId)}/send`,{method:'POST'});
    return json({ok:true,invoice:normalizeInvoice(sent)});
  }catch(error){
    console.error('Stripe invoice send failed',{invoiceId,error:error instanceof Error?error.message:String(error)});
    return json({ok:false,error:error instanceof Error?error.message:'Unable to send invoice.'},error?.status===401?503:502);
  }
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    const billingMatch=url.pathname.match(CUSTOMER_BILLING_RE);
    const invoiceMatch=url.pathname.match(CUSTOMER_INVOICES_RE);
    const sendMatch=url.pathname.match(SEND_INVOICE_RE);
    if(!billingMatch&&!invoiceMatch&&!sendMatch)return appWorker.fetch(request,env);

    const actor=await getActor(request,env);
    if(!actor)return json({ok:false,error:'Authentication required.'},401);
    if(!env.DB)return json({ok:false,error:'Customer database is not configured.'},503);

    if(billingMatch){
      if(request.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
      return handleBillingGet(env,Number(billingMatch[1]));
    }
    if(invoiceMatch){
      if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);
      return createInvoice(request,env,actor,Number(invoiceMatch[1]));
    }
    if(sendMatch){
      if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405);
      return sendInvoice(env,actor,sendMatch[1]);
    }
    return json({ok:false,error:'Not found.'},404);
  }
};
