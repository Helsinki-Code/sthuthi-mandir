/** One Stripe client for both entry points (server/server.mjs and the Vercel functions in api/). */
import Stripe from 'stripe';

export function makeStripe(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  const opts = {};
  // A local Stripe API stand-in is allowed for automated tests, and only with a test-mode key.
  if (env.STRIPE_API_HOST && key.startsWith('sk_test_')) {
    Object.assign(opts, { host: env.STRIPE_API_HOST, port: Number(env.STRIPE_API_PORT || 443), protocol: env.STRIPE_API_PROTOCOL || 'https' });
  }
  return new Stripe(key, opts);
}

export function stripeMode(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  return !key ? 'no Stripe key (Buy now returns "not available")' : key.startsWith('sk_test_') ? 'Stripe TEST mode' : 'Stripe LIVE mode';
}
