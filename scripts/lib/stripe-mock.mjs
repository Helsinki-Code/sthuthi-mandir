/**
 * A local stand-in for the two Stripe calls the payment server makes, for automated tests only
 * (server/server.mjs accepts it only with an sk_test_ key). It records every request so the audit
 * can check exactly what would have been sent to Stripe, and it doubles as the order endpoint.
 */
import http from 'node:http';
import crypto from 'node:crypto';

export async function startStripeMock() {
  const calls = []; const orders = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const params = Object.fromEntries(new URLSearchParams(body));
        const id = `cs_test_mock${crypto.randomBytes(12).toString('hex')}`;
        calls.push({ params, auth: req.headers.authorization || '', id });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Request-Id': 'req_mock' });
        return res.end(JSON.stringify({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, mode: 'payment', currency: 'inr', livemode: false }));
      }
      if (req.method === 'POST' && req.url === '/orders') { orders.push(JSON.parse(body || '{}')); res.writeHead(200); return res.end('{}'); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"not mocked"}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, calls, orders, close: () => new Promise((r) => server.close(r)) };
}
