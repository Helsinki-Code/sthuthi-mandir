/**
 * Sthuthi payment server: serves the static site (dist/) and three API routes.
 *
 *   POST /api/checkout        Creates a Stripe Checkout Session (hosted, INR) for a product priced below
 *                             FULL_PAYMENT_MAX_INR. The price, name and fit data come from the catalog on
 *                             the server (src/generated/catalog.json, built from the CSV and workbook);
 *                             nothing the browser sends about price is used. Refuses unless the delivery PIN
 *                             is valid, the room passes the fit check and the policy consent is ticked.
 *   POST /api/stripe-webhook  Verifies the Stripe signature (STRIPE_WEBHOOK_SECRET). On a paid
 *                             checkout.session.completed (or async_payment_succeeded) it confirms the order:
 *                             stores it, sends it to ORDER_ENDPOINT, and makes it visible to the confirmation page.
 *   GET  /api/order-status    Used by /order/confirmed/. "confirmed" only after the verified webhook.
 *
 * Orders are kept in one of two stores (ORDER_STORE):
 *   file    (default) one JSON file per order in ORDERS_DIR, for a long-running Node host.
 *   stripe  on serverless hosts such as Vercel, where the disk does not persist: the verified webhook writes the
 *           order status onto the PaymentIntent's metadata in Stripe, and the status page reads it back from there.
 *
 * Keys come from environment variables only: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { checkFit } from '../src/lib/fit.js';
import { paymentTier, PAYABLE_VERDICTS, PIN_RE, ROOM_LIMITS, enquiryMessage } from '../src/lib/tier.js';
import { formatINR } from '../src/lib/units.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.webmanifest', '.svg']);
const cache = new Map();
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export function createApp({ root, env = process.env, stripe = null, fetchImpl = globalThis.fetch, log = console, catalog = null, business = null }) {
  const dist = path.join(root, 'dist');
  catalog ||= JSON.parse(fs.readFileSync(path.join(root, 'src/generated/catalog.json'), 'utf8'));
  business ||= JSON.parse(fs.readFileSync(path.join(root, 'data/business.json'), 'utf8'));
  const ordersDir = path.resolve(root, env.ORDERS_DIR || 'var/orders');
  const storeKind = String(env.ORDER_STORE || 'file').trim() === 'stripe' ? 'stripe' : 'file';
  const paymentsEnabled = String(env.PAYMENTS_ENABLED || '').trim() === 'true';
  const maxInr = Number(env.FULL_PAYMENT_MAX_INR || 500000);
  const orderEndpoint = (env.ORDER_ENDPOINT || env.PUBLIC_CONSULT_ENDPOINT || '').trim();
  const wa = (text) => `https://wa.me/${business.phone.whatsapp}?text=${encodeURIComponent(text)}`;
  const product = (sku) => catalog.products.find((p) => p.sku === sku);
  const tier = (p) => paymentTier(p.priceINR, { maxInr, paymentsEnabled });
  const configuredOrigin = (() => { const u = (env.SITE_URL || '').replace(/\/$/, ''); return u && !/\.example$/.test(new URL(u).hostname) ? u : ''; })();
  const originOf = (req) => configuredOrigin || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  const send = (res, status, body, headers = {}) => {
    const json = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': json ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  /* ---------------------------------------------------------------- checkout */
  async function checkout(req, res) {
    let b; try { b = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'invalid_request', message: 'The request could not be read.' }); }
    const p = product(String(b.sku || ''));
    if (!p || !p.structure) return send(res, 404, { error: 'unknown_product', message: 'This mandir was not found.' });
    if (tier(p) !== 'buy') {
      return send(res, 403, { error: 'not_payable_online', message: 'This mandir is not sold online. Please chat with us on WhatsApp.', whatsapp: wa(enquiryMessage(p.sku, p.name, p.priceINR)) });
    }
    const pin = String(b.pin || '').trim();
    const room = { w: Number(b.roomWidthCm), d: Number(b.roomDepthCm), c: Number(b.ceilingHeightCm) };
    const errors = [];
    if (!PIN_RE.test(pin)) errors.push('Enter a 6-digit delivery PIN code.');
    for (const [k, [lo, hi]] of Object.entries(ROOM_LIMITS)) if (!Number.isFinite(room[k]) || room[k] < lo || room[k] > hi) errors.push(`Enter the room ${{ w: 'width', d: 'depth', c: 'ceiling height' }[k]} in cm (${lo}–${hi}).`);
    if (b.consent !== true) errors.push('Please confirm that you have read the Delivery & Installation, Cancellation and Refund policies.');
    if (errors.length) return send(res, 400, { error: 'invalid_request', message: errors.join(' '), errors });

    // The fit check runs again here, on the server's own product data.
    const fit = checkFit(p.structure, room, catalog.std);
    const roomText = `My room is ${room.w} × ${room.d} cm with a ${room.c} cm ceiling.`;
    if (!PAYABLE_VERDICTS.includes(fit.verdict)) {
      return send(res, 422, { error: 'fit_failed', verdict: fit.verdict, message: 'This mandir does not fit the room you entered, so it cannot be paid for online. Chat with us on WhatsApp and a designer will suggest what fits.',
        whatsapp: wa(`${enquiryMessage(p.sku, p.name, p.priceINR)} ${roomText} It did not pass the fit check.`) });
    }
    if (!stripe) return send(res, 503, { error: 'payments_unavailable', message: 'Online payment is not available right now. Please chat with us on WhatsApp.', whatsapp: wa(`${enquiryMessage(p.sku, p.name, p.priceINR)} ${roomText}`) });

    const edition = fit.fitting?.label || 'Standard edition';
    const lead = p.structure.walkIn ? business.leadTimes.walkInCabin : business.leadTimes.cabinet;
    const metadata = {
      sku: p.sku, price_inr: String(p.priceINR), delivery_pin: pin, room_cm: `${room.w}x${room.d}x${room.c}`, fit_verdict: fit.verdict, edition,
      policy_consent: 'Delivery & Installation, Cancellation and Refund policies', policies_effective: business.policiesEffective, consent_at: new Date().toISOString(),
    };
    const origin = originOf(req);
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        currency: 'inr',
        client_reference_id: p.sku,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'inr',
            unit_amount: p.priceINR * 100, // paise, from the catalog
            product_data: { name: p.name, description: `${p.sku} · ${edition}. Includes the structure, idols, pooja items, and delivery and installation in India. Made to order in ${lead}, ${business.leadTimes.basis}.`, metadata: { sku: p.sku } },
          },
        }],
        shipping_address_collection: { allowed_countries: ['IN'] },
        billing_address_collection: 'required',
        phone_number_collection: { enabled: true },
        customer_creation: 'always',
        metadata,
        payment_intent_data: { description: `${p.sku} ${p.name}`, metadata },
        success_url: `${origin}/order/confirmed/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/mandirs/${p.slug}/?checkout=cancelled#buy`,
      });
      return send(res, 200, { url: session.url });
    } catch (e) {
      log.error('checkout error', e?.type || '', e?.message || e);
      return send(res, 502, { error: 'stripe_error', message: 'The payment page could not be opened. Please try again, or chat with us on WhatsApp.', whatsapp: wa(`${enquiryMessage(p.sku, p.name, p.priceINR)} ${roomText}`) });
    }
  }

  /* ---------------------------------------------------------------- order store */
  const piId = (s) => (s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent.id : s.payment_intent) || null;
  function buildOrder(s, mark) {
    const p = product(s.metadata?.sku);
    const md = s.metadata || {};
    return {
      orderRef: mark.orderRef || `STH-${s.id.slice(-10).toUpperCase()}`, sessionId: s.id, status: mark.status,
      confirmedAt: mark.confirmedAt, eventId: mark.eventId, livemode: !!s.livemode,
      sku: p?.sku || md.sku, name: p?.name || '', priceINR: p?.priceINR ?? null, amountPaidINR: (s.amount_total || 0) / 100, currency: s.currency,
      paymentIntent: piId(s),
      customer: { name: s.customer_details?.name || '', email: s.customer_details?.email || '', phone: s.customer_details?.phone || '' },
      shipping: s.collected_information?.shipping_details || s.shipping_details || null,
      delivery: { pin: md.delivery_pin, roomCm: md.room_cm, fitVerdict: md.fit_verdict, edition: md.edition },
      consent: { policies: md.policy_consent, policiesEffective: md.policies_effective, at: md.consent_at },
      ...(mark.notified === undefined ? {} : { notified: mark.notified }),
    };
  }
  const orderFile = (id) => path.join(ordersDir, `${id}.json`);
  const stores = {
    file: {
      async get(id) { return fs.existsSync(orderFile(id)) ? JSON.parse(fs.readFileSync(orderFile(id), 'utf8')) : null; },
      async put(o) {
        fs.mkdirSync(ordersDir, { recursive: true });
        fs.writeFileSync(orderFile(o.sessionId) + '.tmp', JSON.stringify(o, null, 2));
        fs.renameSync(orderFile(o.sessionId) + '.tmp', orderFile(o.sessionId));
      },
    },
    stripe: {
      // The order status lives on the PaymentIntent (metadata keys sthuthi_*), written only by the verified webhook.
      async get(id) {
        let s;
        try { s = await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent'] }); }
        catch (e) { if (e?.statusCode === 404 || e?.code === 'resource_missing') return null; throw e; }
        const m = (s.payment_intent && typeof s.payment_intent === 'object' && s.payment_intent.metadata) || {};
        if (!m.sthuthi_status) return null;
        return buildOrder(s, { status: m.sthuthi_status, orderRef: m.sthuthi_order_ref, confirmedAt: m.sthuthi_confirmed_at, eventId: m.sthuthi_event,
          notified: m.sthuthi_notified ? m.sthuthi_notified === 'true' : undefined });
      },
      async put(o) {
        if (!o.paymentIntent) throw new Error(`order ${o.orderRef}: the session has no PaymentIntent to record the order on`);
        await stripe.paymentIntents.update(o.paymentIntent, { metadata: {
          sthuthi_status: o.status, sthuthi_order_ref: o.orderRef, sthuthi_confirmed_at: o.confirmedAt, sthuthi_event: o.eventId,
          sthuthi_notified: o.notified === undefined ? '' : String(o.notified),
        } });
      },
    },
  };
  const store = stores[storeKind];

  /* ---------------------------------------------------------------- webhook */
  async function webhook(req, res) {
    const secret = env.STRIPE_WEBHOOK_SECRET || '';
    if (!stripe || !secret) return send(res, 503, { error: 'webhook_not_configured' });
    let event;
    try { event = stripe.webhooks.constructEvent(await readBody(req, 512 * 1024), req.headers['stripe-signature'] || '', secret); }
    catch (e) { return send(res, 400, { error: 'invalid_signature' }); }
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return send(res, 200, { received: true });
    const s = event.data.object;
    if (s.payment_status !== 'paid') return send(res, 200, { received: true, status: 'awaiting_payment' });
    if (!SESSION_RE.test(s.id)) return send(res, 400, { error: 'bad_session' });
    if (await store.get(s.id)) return send(res, 200, { received: true, status: 'already_confirmed' });
    const p = product(s.metadata?.sku);
    const ok = p && tier(p) === 'buy' && s.currency === 'inr' && s.amount_total === p.priceINR * 100;
    const order = buildOrder(s, { status: ok ? 'confirmed' : 'needs_review', confirmedAt: new Date().toISOString(), eventId: event.id });
    await store.put(order);
    if (!ok) log.error(`order ${order.orderRef}: amount or product does not match the catalog; marked needs_review`);
    if (orderEndpoint) {
      try {
        const r = await fetchImpl(orderEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'sthuthi.order', order }) });
        order.notified = r.ok;
      } catch (e) { order.notified = false; log.error('order endpoint error', e?.message || e); }
      await store.put(order);
    }
    return send(res, 200, { received: true, status: order.status });
  }

  /* ---------------------------------------------------------------- order status */
  async function orderStatus(req, res, url) {
    const id = url.searchParams.get('session_id') || '';
    if (!SESSION_RE.test(id)) return send(res, 400, { error: 'bad_session' });
    if (storeKind === 'stripe' && !stripe) return send(res, 200, { status: 'pending' });
    const o = await store.get(id);
    if (!o) return send(res, 200, { status: 'pending' });
    if (o.status !== 'confirmed') return send(res, 200, { status: 'review', whatsapp: wa(`Hello Sthuthi, I have paid for order ${o.orderRef} and would like to check its status.`) });
    const p = product(o.sku);
    return send(res, 200, {
      status: 'confirmed',
      order: { orderRef: o.orderRef, sku: o.sku, name: o.name, slug: p?.slug, amount: formatINR(o.amountPaidINR), pin: o.delivery.pin, edition: o.delivery.edition, customerName: o.customer.name },
      whatsapp: wa(`Hello Sthuthi, I have paid for order ${o.orderRef}: ${o.sku} – ${o.name} (${formatINR(o.amountPaidINR)}). Delivery PIN ${o.delivery.pin}.`),
    });
  }

  /* ---------------------------------------------------------------- static files */
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    let file = path.join(dist, rel);
    if (!file.startsWith(dist)) return send(res, 400, 'Bad request');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!rel.endsWith('/')) { res.writeHead(301, { Location: rel + '/' + url.search }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    let status = 200;
    if (!fs.existsSync(file)) { file = path.join(dist, '404.html'); status = 404; }
    const ext = path.extname(file);
    const immutable = /^\/(_astro|img)\//.test(rel);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
    // Text files are sent brotli- or gzip-compressed (cached in memory per file version).
    const accept = String(req.headers['accept-encoding'] || '');
    const enc = COMPRESSIBLE.has(ext) ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null) : null;
    if (enc) {
      const st = fs.statSync(file); const key = `${file}:${st.mtimeMs}:${enc}`;
      let buf = cache.get(key);
      if (!buf) {
        const raw = fs.readFileSync(file);
        buf = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : zlib.gzipSync(raw, { level: 9 });
        cache.set(key, buf);
      }
      res.writeHead(status, { ...headers, 'Content-Encoding': enc, 'Content-Length': buf.length });
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/api/checkout') return req.method === 'POST' ? await checkout(req, res) : send(res, 405, { error: 'method_not_allowed' });
      if (url.pathname === '/api/stripe-webhook') return req.method === 'POST' ? await webhook(req, res) : send(res, 405, { error: 'method_not_allowed' });
      if (url.pathname === '/api/order-status') return req.method === 'GET' ? await orderStatus(req, res, url) : send(res, 405, { error: 'method_not_allowed' });
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      log.error(e);
      return send(res, 500, { error: 'server_error' });
    }
  };
}
