/**
 * A local stand-in for the Stripe calls the payment server makes, for automated tests only
 * (server/server.mjs accepts it only with an sk_test_ key). It records every request so the audit
 * can check exactly what would have been sent to Stripe, and it doubles as the order endpoint.
 */
import http from 'node:http';
import crypto from 'node:crypto';

export async function startStripeMock() {
  const calls = []; const orders = []; const intents = {};
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Request-Id': 'req_mock' }); res.end(JSON.stringify(body)); };
  const missing = (res) => json(res, 404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such object' } });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const params = Object.fromEntries(new URLSearchParams(body));
        const id = `cs_test_mock${crypto.randomBytes(12).toString('hex')}`;
        const pi = `pi_mock${crypto.randomBytes(8).toString('hex')}`;
        intents[pi] = {};
        calls.push({ params, auth: req.headers.authorization || '', id, pi });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Request-Id': 'req_mock' });
        return res.end(JSON.stringify({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, mode: 'payment', currency: 'inr', livemode: false }));
      }
      const route = req.url.split('?')[0];
      // Retrieve a Checkout Session (with its PaymentIntent expanded), as the Stripe order store does.
      let m = route.match(/^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/);
      if (req.method === 'GET' && m) {
        const c = calls.find((x) => x.id === m[1]); if (!c) return missing(res);
        const P = c.params;
        return json(res, 200, { id: c.id, object: 'checkout.session', mode: 'payment', livemode: false, currency: P.currency,
          amount_total: Number(P['line_items[0][price_data][unit_amount]']), payment_status: 'paid', customer_details: { name: 'Audit Buyer' },
          metadata: Object.fromEntries(Object.entries(P).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])),
          payment_intent: { id: c.pi, object: 'payment_intent', metadata: { ...intents[c.pi] } } });
      }
      // Update a PaymentIntent's metadata (an empty value removes the key, as in Stripe).
      m = route.match(/^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/);
      if (req.method === 'POST' && m) {
        if (!intents[m[1]]) return missing(res);
        for (const [k, v] of new URLSearchParams(body)) {
          const mk = k.match(/^metadata\[(.+)\]$/); if (!mk) continue;
          if (v === '') delete intents[m[1]][mk[1]]; else intents[m[1]][mk[1]] = v;
        }
        return json(res, 200, { id: m[1], object: 'payment_intent', metadata: { ...intents[m[1]] } });
      }
      if (req.method === 'POST' && req.url === '/orders') { orders.push(JSON.parse(body || '{}')); res.writeHead(200); return res.end('{}'); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"not mocked"}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, calls, orders, intents, close: () => new Promise((r) => server.close(r)) };
}
