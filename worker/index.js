const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const CAJUNSITES_PAYMENT_LINK_ID = 'plink_1UETwWINepSxCPJz8VjC4MSO';
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

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

function parseStripeSignature(header) {
  const parts = String(header || '').split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  return {
    timestamp: timestampPart ? Number(timestampPart.slice(2)) : NaN,
    signatures,
  };
}

function hexFromBytes(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeHexEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!Number.isFinite(timestamp) || !signatures.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > STRIPE_SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = hexFromBytes(digest);

  return signatures.some((signature) => constantTimeHexEqual(expected, signature));
}

async function sendCustomerWelcome(env, customer) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const firstName = clean(customer.customer_name, 120).split(/\s+/)[0] || 'there';
  const businessName = clean(customer.business_name, 160) || 'your business';
  const onboardingUrl = 'https://cajunsites.com/onboarding/';

  const text = [
    `Hi ${firstName},`,
    '',
    `Thank you for choosing CajunSites for ${businessName}. Your payment was received and your website project is now in our queue.`,
    '',
    'The next step is to complete your customer onboarding form. This gives us the business details, services, contact information, photos, branding, and other information we need to build your site.',
    '',
    `Complete your onboarding here: ${onboardingUrl}`,
    '',
    'Once we receive your onboarding information, we will review it and begin the website build. If anything important is missing, we will contact you before moving forward.',
    '',
    'Thank you,',
    'CajunSites',
    'Websites Built for Small Business',
    'hello@cajunsites.com',
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': `cajunsites-welcome-${customer.stripe_checkout_session_id}`,
    },
    body: JSON.stringify({
      from: 'CajunSites <hello@cajunsites.com>',
      to: [customer.email],
      subject: 'Welcome to CajunSites - Next Step: Customer Onboarding',
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend welcome email failed (${response.status}): ${errorBody.slice(0, 1000)}`);
  }
}

async function processSuccessfulCheckout(session, env) {
  if (session.payment_link !== CAJUNSITES_PAYMENT_LINK_ID) {
    console.log('Ignoring Checkout Session from another Payment Link', session.id);
    return { ignored: true };
  }

  if (session.payment_status !== 'paid') {
    console.log('Checkout Session not paid yet', session.id, session.payment_status);
    return { ignored: true };
  }

  if (!env.DB) throw new Error('DB binding is not configured');

  const details = session.customer_details || {};
  const email = clean(details.email || session.customer_email, 254).toLowerCase();
  const customerName = clean(details.name, 120);
  const businessName = clean(details.business_name || details.name, 160);
  const stripeCustomerId = clean(session.customer, 255) || null;
  const subscriptionId = clean(session.subscription, 255) || null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Checkout Session ${session.id} does not contain a valid customer email`);
  }

  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO customers (
      stripe_customer_id,
      stripe_checkout_session_id,
      stripe_subscription_id,
      payment_link_id,
      customer_name,
      business_name,
      email,
      status,
      onboarding_completed,
      welcome_email_sent,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Paid - Awaiting Onboarding', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    stripeCustomerId,
    session.id,
    subscriptionId,
    session.payment_link,
    customerName,
    businessName,
    email,
  ).run();

  const customer = await env.DB.prepare(`
    SELECT * FROM customers WHERE stripe_checkout_session_id = ? LIMIT 1
  `).bind(session.id).first();

  if (!customer) throw new Error(`Customer record could not be loaded for Checkout Session ${session.id}`);

  if (!customer.welcome_email_sent) {
    await sendCustomerWelcome(env, customer);
    await env.DB.prepare(`
      UPDATE customers
      SET welcome_email_sent = 1, updated_at = CURRENT_TIMESTAMP
      WHERE stripe_checkout_session_id = ?
    `).bind(session.id).run();
  }

  if ((insert.meta?.changes || 0) > 0) {
    const internalText = [
      'New paid CajunSites customer',
      '',
      `Customer: ${customer.customer_name || 'Not provided'}`,
      `Business: ${customer.business_name || 'Not provided'}`,
      `Email: ${customer.email}`,
      `Status: ${customer.status}`,
      `Stripe customer: ${customer.stripe_customer_id || 'Not provided'}`,
      `Stripe subscription: ${customer.stripe_subscription_id || 'Not provided'}`,
      `Checkout session: ${customer.stripe_checkout_session_id}`,
      '',
      'Customer welcome email: sent',
      'Onboarding: https://cajunsites.com/onboarding/',
    ].join('\n');

    await env.SEND_EMAIL.send({
      from: 'hello@cajunsites.com',
      to: 'blaketaravella@gmail.com',
      subject: `Paid CajunSites customer: ${customer.business_name || customer.email}`,
      text: internalText,
    });
  }

  return { ignored: false, customerId: customer.id };
}

async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return json({ ok: false, error: 'Webhook is not configured.' }, 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ ok: false, error: 'Missing Stripe signature.' }, 400);

  const rawBody = await request.text();
  const verified = await verifyStripeWebhookSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    console.warn('Stripe webhook signature verification failed');
    return json({ ok: false, error: 'Invalid Stripe signature.' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await processSuccessfulCheckout(event.data.object, env);
    }

    return json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing error', {
      eventId: event.id || null,
      eventType: event.type || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: 'Webhook processing failed.' }, 500);
  }
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

    if (url.pathname === '/api/stripe-webhook') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return handleStripeWebhook(request, env);
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
