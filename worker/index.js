const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.cajunsites.com') {
      url.hostname = 'cajunsites.com';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname !== '/api/lead') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405);
    }

    try {
      const type = request.headers.get('content-type') || '';
      let data;
      if (type.includes('application/json')) {
        data = await request.json();
      } else {
        const form = await request.formData();
        data = Object.fromEntries(form.entries());
      }

      // Honeypot. Bots commonly fill hidden fields; real visitors never see this.
      if (clean(data.website, 200)) {
        return json({ ok: true });
      }

      const turnstileToken = clean(data['cf-turnstile-response'], 2048);
      if (!turnstileToken) {
        return json({ ok: false, error: 'Please complete the security check and try again.' }, 400);
      }

      if (!env.TURNSTILE_SECRET) {
        console.error('TURNSTILE_SECRET is not configured');
        return json({ ok: false, error: 'Security verification is temporarily unavailable. Please try again.' }, 500);
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
        return json({ ok: false, error: 'Security verification is temporarily unavailable. Please try again.' }, 503);
      }

      const verification = await verifyResponse.json();

      if (!verification.success || verification.action !== 'lead') {
        console.warn('Turnstile verification failed', {
          errors: verification['error-codes'] || [],
          action: verification.action || null,
          hostname: verification.hostname || null,
        });
        return json({ ok: false, error: 'Security verification failed. Please try again.' }, 403);
      }

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
        'Main services:',
        services || 'Not provided',
        '',
        'Additional notes:',
        notes || 'Not provided',
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
  },
};
