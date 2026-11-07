#!/usr/bin/env node
/**
 * Start the Sthuthi site with its payment API:  node server/server.mjs [--port 4321] [--host 127.0.0.1]
 * Reads site/.env (values already in the environment win). Serves dist/, so run `npm run build` first.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { makeStripe, stripeMode } from './stripe-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt; };
const port = Number(arg('port', process.env.PORT || 4321));
const host = arg('host', process.env.HOST || '127.0.0.1');

const stripe = makeStripe(process.env);
const mode = stripeMode(process.env);
http.createServer(createApp({ root: ROOT, env: process.env, stripe })).listen(port, host, () => {
  console.log(`Sthuthi on http://${host}:${port}/  (${mode}; orders in ${process.env.ORDER_STORE === 'stripe' ? 'Stripe' : 'files'}; payments ${process.env.PAYMENTS_ENABLED === 'true' ? 'on' : 'off'} below ₹${process.env.FULL_PAYMENT_MAX_INR || 500000})`);
});
