const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

async function parseRequestData(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

async function verifyTurnstile(request, env, data, expectedAction) {
  const turnstileToken = clean(data['cf-turnstile-response'], 2048);
  if (!turnstileToken) {
    return { ok: false, response: json({ ok: false, error: 'Please complete the security check and try again.' }, 400) };
  }

  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET is not configured');
    return { ok: false, response: json({ ok: false, error: 'Security verification is temporarily unavailable. Please try again.' }, 500) };
  }

  const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: turnstileToken,
      remoteip: request.headers.get('CF-Connecting-IP') || '',
    }),
  });

  if (!verifyResponse.ok) {
    console.error('Turnstile Siteverify HTTP error', verifyResponse.status);
    return { ok: false, response: json({ ok: false, error: 'Security verification is temporarily unavailable. Please try again.' }, 503) };
  }

  const verification = await verifyResponse.json();
  if (!verification.success || verification.action !== expectedAction) {
    console.warn('Turnstile verification failed', {
      errors: verification['error-codes'] || [],
      action: verification.action || null,
      hostname: verification.hostname || null,
      expectedAction,
    });
    return { ok: false, response: json({ ok: false, error: 'Security verification failed. Please try again.' }, 403) };
  }

  return { ok: true };
}

async function handleLead(request, env) {
  try {
    const data = await parseRequestData(request);

    if (clean(data.website, 200)) return json({ ok: true });

    const verification = await verifyTurnstile(request, env, data, 'lead');
    if (!verification.ok) return verification.response;

    const name = clean(data.name, 120);
    const business = clean(data.business, 160);
    const email = clean(data.email, 254);
    const phone = clean(data.phone, 80);
    const industry = clean(data.industry, 160);
    const domain = clean(data.domain, 80);
    const services = clean(data.services, 3000);
    const notes = clean(data.notes, 3000);

    if (!name || !business || !email) {
      return json({ ok: false, error: 'Please complete your name, business name and email.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
    }

    const text = [
      'New CajunSites website inquiry',
      '',
      `Name: ${name}`,
      `Business: ${business}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      `Business type: ${industry || 'Not provided'}`,
      `Domain status: ${domain || 'Not provided'}`,
      '',
      'Main services:', services || 'Not provided',
      '',
      'Additional notes:', notes || 'Not provided',
      '',
      `Submitted: ${new Date().toISOString()}`,
    ].join('\n');

    await env.SEND_EMAIL.send({
      from: 'hello@cajunsites.com',
      to: 'blaketaravella@gmail.com',
      subject: `New website inquiry: ${business}`,
      text,
    });

    return json({ ok: true });
  } catch (error) {
    console.error('Lead form error', error);
    return json({ ok: false, error: 'We could not send your information right now. Please try again.' }, 500);
  }
}

async function handleOnboarding(request, env) {
  try {
    const data = await parseRequestData(request);

    if (clean(data.website, 200)) return json({ ok: true });

    const verification = await verifyTurnstile(request, env, data, 'onboarding');
    if (!verification.ok) return verification.response;

    const contactName = clean(data.contact_name, 120);
    const businessName = clean(data.business_name, 160);
    const publicEmail = clean(data.public_email, 254);
    const accuracyConfirmed = clean(data.accuracy_confirmed, 20);

    if (!contactName || !businessName || !clean(data.services, 4000)) {
      return json({ ok: false, error: 'Please complete your name, business name, and services.' }, 400);
    }
    if (publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail)) {
      return json({ ok: false, error: 'Please enter a valid public email address.' }, 400);
    }
    if (accuracyConfirmed !== 'yes') {
      return json({ ok: false, error: 'Please confirm that the information and materials you provided are accurate and authorized for use.' }, 400);
    }

    const section = (title, rows) => [
      title,
      ...rows.map(([label, key, max = 4000]) => `${label}: ${clean(data[key], max) || 'Not provided'}`),
      '',
    ];

    const text = [
      'New CajunSites customer onboarding submission',
      '',
      ...section('BUSINESS DETAILS', [
        ['Contact name', 'contact_name', 120],
        ['Business name', 'business_name', 160],
        ['Business type', 'business_type', 160],
        ['Years in business', 'years_business', 80],
        ['Business description', 'business_description'],
        ['What makes them different', 'unique_points'],
      ]),
      ...section('SERVICES & SERVICE AREAS', [
        ['Services', 'services'],
        ['Service areas', 'service_areas'],
        ['Priority service/customer', 'priority_service', 500],
      ]),
      ...section('HOURS & CONTACT', [
        ['Public phone', 'public_phone', 80],
        ['Public email', 'public_email', 254],
        ['Business address', 'business_address', 300],
        ['Business hours', 'hours'],
        ['Preferred visitor contact method', 'contact_preference'],
      ]),
      ...section('DOMAIN & EXISTING WEBSITE', [
        ['Domain name', 'domain_name', 300],
        ['Domain provider', 'domain_provider', 200],
        ['Existing website', 'existing_website', 500],
        ['Existing content to reuse', 'existing_content'],
      ]),
      ...section('LOGO, PHOTOS & BRAND ASSETS', [
        ['Logo / brand files', 'logo_link', 1000],
        ['Business photos', 'photos_link', 1000],
        ['Photo notes', 'photo_notes'],
      ]),
      ...section('SOCIAL & GOOGLE BUSINESS PROFILE', [
        ['Facebook', 'facebook', 1000],
        ['Instagram', 'instagram', 1000],
        ['LinkedIn', 'linkedin', 1000],
        ['Other social', 'other_social', 1000],
        ['Google Business Profile / Maps', 'google_business', 1000],
      ]),
      ...section('REVIEWS & TESTIMONIALS', [
        ['Authorized testimonials', 'testimonials'],
        ['Public review page', 'reviews_link', 1000],
      ]),
      ...section('DESIGN PREFERENCES', [
        ['Design style', 'design_style'],
        ['Brand colors', 'brand_colors', 500],
        ['Colors to avoid', 'avoid_colors', 500],
        ['Example websites', 'example_sites'],
        ['Things to avoid', 'design_avoid'],
      ]),
      ...section('FINAL NOTES', [
        ['Additional notes', 'additional_notes'],
        ['Accuracy / authorization confirmed', 'accuracy_confirmed', 20],
      ]),
      `Submitted: ${new Date().toISOString()}`,
    ].join('\n');

    await env.SEND_EMAIL.send({
      from: 'hello@cajunsites.com',
      to: 'blaketaravella@gmail.com',
      subject: `Customer onboarding: ${businessName}`,
      text,
    });

    return json({ ok: true });
  } catch (error) {
    console.error('Onboarding form error', error);
    return json({ ok: false, error: 'We could not submit your onboarding information right now. Please try again.' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.cajunsites.com') {
      url.hostname = 'cajunsites.com';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/lead') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return handleLead(request, env);
    }

    if (url.pathname === '/api/onboarding') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return handleOnboarding(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
