import prospectWorker from './prospects.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const DNS_API = 'https://cajun-sites-dns.vercel.app/api/dns';
const VERCEL_CONCEPT_PROJECT = 'cajun-sites-prospect-websites';

function slugify(value) {
  return clean(value, 200)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63);
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function ensureConceptSchema(env) {
  if (!env.DB) return;
  const alters = [
    "ALTER TABLE prospects ADD COLUMN concept_state TEXT NOT NULL DEFAULT 'Not Built'",
    'ALTER TABLE prospects ADD COLUMN concept_slug TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_deployment_id TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_build_error TEXT',
    'ALTER TABLE prospects ADD COLUMN concept_built_at TEXT',
  ];
  for (const sql of alters) {
    try { await env.DB.prepare(sql).run(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
  await env.DB.prepare(`UPDATE prospects
    SET concept_state = CASE WHEN COALESCE(concept_url,'') <> '' THEN 'Built' ELSE 'Not Built' END
    WHERE concept_state IS NULL OR concept_state = '' OR (concept_state = 'Not Built' AND COALESCE(concept_url,'') <> '')`).run();
  await env.DB.prepare(`UPDATE prospects SET stage='Qualified'
    WHERE stage='Concept Built' AND COALESCE(concept_url,'')='' AND COALESCE(concept_state,'Not Built')='Not Built'`).run();
}

async function currentUser(request, env) {
  const url = new URL(request.url);
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const response = await prospectWorker.fetch(new Request(new URL('/api/admin/me', url.origin), { method: 'GET', headers }), env);
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.user || null;
}

async function recordActivity(env, user, prospect, description, metadata = {}) {
  try {
    await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at)
      VALUES (NULL,'concept_build',?,?,CURRENT_TIMESTAMP)`)
      .bind(description, JSON.stringify({ prospect_id: prospect.id, business_name: prospect.business_name, ...metadata, actor: user ? { id:user.id,name:user.name,email:user.email,role:user.role } : null })).run();
  } catch {}
}

function buildConceptHtml(prospect) {
  const name = htmlEscape(prospect.business_name);
  const category = htmlEscape(prospect.category || 'Local Business');
  const city = htmlEscape(prospect.city || 'your community');
  const state = htmlEscape(prospect.state || '');
  const market = [city, state].filter(Boolean).join(', ');
  const phone = htmlEscape(prospect.phone || '');
  const email = htmlEscape(prospect.email || '');
  const contactItems = [
    phone ? `<a href="tel:${phone.replace(/[^+\d]/g, '')}">${phone}</a>` : '',
    email ? `<a href="mailto:${email}">${email}</a>` : '',
  ].filter(Boolean).join('');
  const contactBlock = contactItems || '<span>Contact the business for details.</span>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${name} | Concept Website</title>
<style>
:root{--navy:#173f64;--blue:#204f79;--gold:#f0b719;--cream:#fbf8f1;--ink:#17202a;--muted:#65717d;--line:#e8edf1}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:white;line-height:1.55}a{color:inherit}.concept-bar{background:#240643;color:#fff;text-align:center;padding:9px 18px;font-size:.78rem;font-weight:750}.concept-bar b{color:#f0b719}.nav{height:76px;display:flex;align-items:center;justify-content:space-between;width:min(1120px,calc(100% - 40px));margin:auto}.brand{font-size:1.15rem;font-weight:900;color:var(--navy)}.nav span{font-size:.88rem;color:var(--muted)}.hero{background:linear-gradient(135deg,var(--navy),var(--blue));color:#fff;padding:92px 20px}.hero-inner{width:min(1120px,100%);margin:auto;display:grid;grid-template-columns:1.1fr .9fr;gap:70px;align-items:center}.kicker{text-transform:uppercase;letter-spacing:.14em;color:#f5cc58;font-size:.76rem;font-weight:850}.hero h1{font-size:clamp(2.8rem,6vw,5rem);line-height:.96;letter-spacing:-.05em;margin:14px 0 20px}.hero p{font-size:1.15rem;color:#e5edf3;max-width:600px}.cta{display:inline-flex;margin-top:14px;background:#fff;color:var(--navy);padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:850}.visual{min-height:310px;border-radius:26px;background:linear-gradient(145deg,#f2eadc,#d9c9ad);position:relative;overflow:hidden}.visual:before{content:"";position:absolute;inset:44px;border:14px solid rgba(255,255,255,.9);clip-path:polygon(50% 0,100% 34%,100% 100%,0 100%,0 34%)}.section{padding:76px 20px}.inner{width:min(1120px,100%);margin:auto}.eyebrow{color:var(--blue);text-transform:uppercase;letter-spacing:.13em;font-size:.74rem;font-weight:850}.section h2{font-size:clamp(2rem,4vw,3.2rem);line-height:1;letter-spacing:-.04em;margin:8px 0 18px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px}.card{border:1px solid var(--line);border-radius:18px;padding:24px;background:#fff}.card strong{display:block;color:var(--navy);margin-bottom:8px}.card p{color:var(--muted);margin:0}.contact{background:var(--cream)}.contact-box{display:flex;justify-content:space-between;gap:24px;align-items:center;border-radius:22px;background:white;border:1px solid #ece4d6;padding:28px}.contact-links{display:flex;gap:12px;flex-wrap:wrap}.contact-links a,.contact-links span{padding:11px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;font-weight:750;color:var(--navy)}footer{padding:28px 20px;text-align:center;color:#7a727f;font-size:.78rem;border-top:1px solid var(--line)}@media(max-width:760px){.hero-inner,.cards{grid-template-columns:1fr}.visual{min-height:230px}.contact-box{display:block}.contact-links{margin-top:18px}.nav span{display:none}}
</style>
</head>
<body>
<div class="concept-bar">Concept website prepared by <b>CajunSites</b>. Business details should be confirmed before launch.</div>
<header class="nav"><div class="brand">${name}</div><span>${category} · ${market}</span></header>
<main>
<section class="hero"><div class="hero-inner"><div><div class="kicker">${category}</div><h1>${name}</h1><p>A professional online presence for ${name}, serving ${market}. This concept uses only currently recorded business information and is ready to be customized with confirmed services, photos, reviews, hours, and contact details.</p><a class="cta" href="#contact">Get in Touch</a></div><div class="visual" aria-hidden="true"></div></div></section>
<section class="section"><div class="inner"><div class="eyebrow">Built for local customers</div><h2>A clear, modern place to learn about the business.</h2><div class="cards"><div class="card"><strong>Services</strong><p>Present confirmed services in a simple, mobile-friendly format.</p></div><div class="card"><strong>Local Presence</strong><p>Give customers an easy way to find important business and service-area information.</p></div><div class="card"><strong>Easy Contact</strong><p>Make the next step clear with phone, email, quote, or contact options once confirmed.</p></div></div></div></section>
<section class="section contact" id="contact"><div class="inner"><div class="contact-box"><div><div class="eyebrow">Contact</div><h2 style="margin-bottom:0">Connect with ${name}</h2></div><div class="contact-links">${contactBlock}</div></div></div></section>
</main>
<footer>Concept preview created by CajunSites. Final website content is subject to customer review and approval.</footer>
</body></html>`;
}

function vercelQuery(env) {
  const params = new URLSearchParams();
  if (env.VERCEL_TEAM_ID) params.set('teamId', env.VERCEL_TEAM_ID);
  return params.toString() ? `?${params}` : '';
}

async function vercelFetch(env, path, options = {}) {
  const response = await fetch(`https://api.vercel.com${path}${vercelQuery(env)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.VERCEL_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `Vercel request failed (${response.status})`);
  return data;
}

async function ensureProspectDns(env, slug) {
  const response = await fetch(env.CAJUNSITES_DNS_API_URL || DNS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DNS_INTEGRATION_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: slug, content: 'cname.vercel-dns.com', proxied: false, ttl: 1 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `DNS request failed (${response.status})`);
  return data;
}

async function ensureVercelProjectDomain(env, alias) {
  try {
    return await vercelFetch(env, `/v10/projects/${encodeURIComponent(VERCEL_CONCEPT_PROJECT)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: alias }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|already added|domain.*exists/i.test(message)) return { name: alias, existing: true };
    throw error;
  }
}

async function waitForDeployment(env, deploymentId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const data = await vercelFetch(env, `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    const state = data.readyState || data.status;
    if (state === 'READY') return data;
    if (['ERROR','CANCELED'].includes(state)) throw new Error(`Vercel deployment ended in ${state}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Vercel deployment did not become ready in time. Try Build Concept again to check/redeploy.');
}

async function assignAliasWithRetry(env, deploymentId, alias) {
  let lastError;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await vercelFetch(env, `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias }),
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const mayProvision = /ssl|certificate|domain|verification|not configured/i.test(message);
      if (!mayProvision || attempt === 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError || new Error('Could not assign the concept domain alias.');
}

async function buildConcept(request, env, id) {
  if (!env.DB) return json({ ok:false,error:'Customer database is not configured.' },503);
  const user = await currentUser(request, env);
  if (!user) return json({ ok:false,error:'Authentication required.' },401);
  if (user.role === 'read_only') return json({ ok:false,error:'Your role is read only.' },403);
  await ensureConceptSchema(env);

  const prospect = await env.DB.prepare('SELECT * FROM prospects WHERE id=? LIMIT 1').bind(id).first();
  if (!prospect) return json({ ok:false,error:'Prospect not found.' },404);
  if (!env.VERCEL_API_TOKEN || !env.DNS_INTEGRATION_API_KEY) {
    return json({ ok:false,error:'Concept builder setup is incomplete. VERCEL_API_TOKEN and DNS_INTEGRATION_API_KEY must be configured as Worker secrets.' },503);
  }

  const slug = slugify(prospect.concept_slug || prospect.business_name);
  if (!slug) return json({ ok:false,error:'Could not create a valid concept subdomain from the business name.' },400);
  const alias = `${slug}.cajunsites.com`;
  const conceptUrl = `https://${alias}`;

  await env.DB.prepare(`UPDATE prospects SET concept_state='Building',concept_slug=?,concept_build_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slug,id).run();
  await recordActivity(env,user,prospect,`${user.name} started concept build for ${prospect.business_name}`,{slug});

  try {
    const deployment = await vercelFetch(env, '/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: VERCEL_CONCEPT_PROJECT,
        project: VERCEL_CONCEPT_PROJECT,
        target: 'production',
        files: [{ file: 'index.html', data: buildConceptHtml(prospect) }],
        projectSettings: { framework: null },
        meta: { cajunsites_prospect_id: String(id), cajunsites_slug: slug },
      }),
    });
    const deploymentId = deployment.id || deployment.uid;
    if (!deploymentId) throw new Error('Vercel did not return a deployment ID.');

    await waitForDeployment(env, deploymentId);
    await ensureProspectDns(env, slug);
    await ensureVercelProjectDomain(env, alias);
    await assignAliasWithRetry(env, deploymentId, alias);

    await env.DB.prepare(`UPDATE prospects SET concept_url=?,concept_state='Built',concept_slug=?,concept_deployment_id=?,concept_build_error=NULL,concept_built_at=CURRENT_TIMESTAMP,stage=CASE WHEN stage='Qualified' THEN 'Concept Built' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(conceptUrl,slug,deploymentId,id).run();
    await recordActivity(env,user,prospect,`${user.name} built concept site for ${prospect.business_name}`,{slug,concept_url:conceptUrl,deployment_id:deploymentId});
    return json({ ok:true,concept_url:conceptUrl,concept_state:'Built',deployment_id:deploymentId });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : String(error), 1000);
    await env.DB.prepare(`UPDATE prospects SET concept_state='Build Failed',concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message,id).run();
    await recordActivity(env,user,prospect,`Concept build failed for ${prospect.business_name}`,{slug,error:message});
    return json({ ok:false,error:message || 'Concept build failed.' },502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/admin/prospects')) {
      try { await ensureConceptSchema(env); } catch (error) { console.error('Concept schema setup failed', error); }
      const match = url.pathname.match(/^\/api\/admin\/prospects\/(\d+)\/build-concept$/);
      if (match) {
        if (request.method !== 'POST') return json({ok:false,error:'Method not allowed.'},405);
        try { return await buildConcept(request,env,Number(match[1])); }
        catch (error) {
          console.error('Concept build request failed', error);
          return json({ok:false,error:'Concept build request failed.'},500);
        }
      }
    }
    return prospectWorker.fetch(request, env);
  },
};
