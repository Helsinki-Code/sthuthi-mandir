/**
 * Entry point for the Vercel Functions in api/ (checkout, stripe-webhook, order-status).
 * Vercel serves the built pages from dist/ itself; these functions only handle /api/*.
 * Vercel's disk does not persist between requests, so orders are kept in Stripe (ORDER_STORE=stripe, see app.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../src/generated/catalog.json' with { type: 'json' };
import business from '../data/business.json' with { type: 'json' };
import { createApp } from './app.mjs';
import { makeStripe } from './stripe-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let app = null;

export default function handler(req, res) {
  app ||= createApp({ root, catalog, business, env: { ...process.env, ORDER_STORE: process.env.ORDER_STORE || 'stripe' }, stripe: makeStripe(process.env) });
  return app(req, res);
}
