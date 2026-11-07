#!/usr/bin/env node
/**
 * Runs the Vercel Functions in api/ on a local port, routed the way Vercel routes them (/api/<file name>),
 * so the audit can test the exact files Vercel deploys:  node scripts/lib/vercel-local.mjs --port 4700
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api');
const routes = {};
for (const f of fs.readdirSync(API).filter((f) => f.endsWith('.mjs'))) routes[`/api/${f.replace(/\.mjs$/, '')}`] = (await import(path.join(API, f))).default;
const i = process.argv.indexOf('--port'); const port = Number(i > 0 ? process.argv[i + 1] : 4700);
http.createServer((req, res) => {
  const h = routes[new URL(req.url, 'http://local').pathname];
  if (!h) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not_found"}'); }
  return h(req, res);
}).listen(port, '127.0.0.1', () => console.log(`Sthuthi on http://127.0.0.1:${port}/ (Vercel functions: ${Object.keys(routes).join(', ')})`));
