#!/usr/bin/env node
/**
 * Browser half of the QA audit, against a running `npm run preview` (default http://localhost:4321):
 *  C9  every page at 360 / 768 / 1280 / 1920 px: console errors, failed requests, horizontal overflow, broken images
 *  C10 Lighthouse (performance, accessibility, best practices, SEO) on one page per template, mobile + desktop
 * Usage: node scripts/browser-audit.mjs [--base http://localhost:4321] [--no-lighthouse]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] || 'http://localhost:4321').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const flags = [];
const flag = (c, m) => flags.push({ check: c, msg: m });

const sitemap = fs.readFileSync(path.join(ROOT, 'dist/sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>[^<]*?(\/[^<]*)<\/loc>/g)].map((m) => new URL(m[1].replace(/^https?:\/\/[^/]+/, ''), BASE).pathname);
urls.push('/404.html');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const widths = [360, 768, 1280, 1920];
let loads = 0;
for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 900 });
  for (const u of urls) {
    const errs = [];
    const onConsole = (m) => { if (m.type() === 'error') errs.push(m.text()); };
    const onPageErr = (e) => errs.push(String(e));
    const onFail = (r) => { if (!/favicon/.test(r.url())) errs.push(`request failed ${r.url()}`); };
    const onResp = (r) => { if (r.status() >= 400 && !r.url().endsWith('/404.html')) errs.push(`HTTP ${r.status()} ${r.url()}`); };
    page.on('console', onConsole); page.on('pageerror', onPageErr); page.on('requestfailed', onFail); page.on('response', onResp);
    await page.goto(BASE + u, { waitUntil: 'networkidle0', timeout: 60000 });
    // scroll through to trigger lazy images
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 150));
    const res = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth - window.innerWidth;
      const wide = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return false;
        let p = el.parentElement; // ignore content inside intentionally scrollable containers
        while (p && p !== document.body && p !== document.documentElement) { const ov = getComputedStyle(p).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') return false; p = p.parentElement; }
        return r.right > window.innerWidth + 1;
      }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.currentSrc || i.src);
      return { over, wide, broken };
    });
    loads++;
    if (res.over > 1) flag('C9', `${u} @${w}px: horizontal overflow ${res.over}px (${res.wide.join(', ')})`);
    if (res.broken.length) flag('C9', `${u} @${w}px: broken images ${res.broken.slice(0, 3).join(', ')}`);
    for (const e of errs) flag('C9', `${u} @${w}px: ${e}`);
    page.off('console', onConsole); page.off('pageerror', onPageErr); page.off('requestfailed', onFail); page.off('response', onResp);
  }
  await page.close();
}

// C17 in the browser: the payment button stays disabled until the PIN, a passing fit check and the consent are all in place.
{
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/generated/catalog.json'), 'utf8'));
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  for (const p of cat.products) {
    await page.goto(`${BASE}/mandirs/${p.slug}/`, { waitUntil: 'networkidle0' });
    const has = await page.$('[data-buy]');
    if (!has) continue;
    const s = p.structure; const clr = cat.std.ceilingClearance;
    const r = await page.evaluate(async (s, clr) => {
      const f = document.querySelector('[data-buy] form'); const sb = f.querySelector('[data-buy-submit]');
      const set = (n, v) => { f[n].value = v; f[n].dispatchEvent(new Event('input', { bubbles: true })); };
      const tick = (on) => { f.consent.checked = on; f.consent.dispatchEvent(new Event('change', { bubbles: true })); };
      const out = { initial: sb.disabled };
      set('pin', '517501'); set('w', String(Math.max(50, Math.min(s.widthCm, s.depthCm) - 1))); set('d', String(Math.max(50, Math.min(s.widthCm, s.depthCm) - 1))); set('c', String(s.heightCm + clr + 20)); tick(true);
      out.failFit = sb.disabled; out.failShowsWhatsApp = !document.querySelector('[data-buy-fail]').hidden && /wa\.me\/918951618186/.test(document.querySelector('[data-buy-wa]').href);
      set('w', String(s.widthCm + 50)); set('d', String(s.depthCm + 50)); tick(false); out.noConsent = sb.disabled;
      set('pin', '01234'); tick(true); out.badPin = sb.disabled;
      set('pin', '517501'); out.ready = !sb.disabled;
      return out;
    }, s, clr);
    if (!r.initial) flag('C17', `${p.sku}: payment button enabled on load`);
    if (!r.failFit) flag('C17', `${p.sku}: payment button enabled although the fit check fails`);
    if (!r.failShowsWhatsApp) flag('C17', `${p.sku}: failed fit check does not offer WhatsApp`);
    if (!r.noConsent) flag('C17', `${p.sku}: payment button enabled without policy consent`);
    if (!r.badPin) flag('C17', `${p.sku}: payment button enabled with an invalid PIN`);
    if (!r.ready) flag('C17', `${p.sku}: payment button stays disabled when every check passes`);
  }
  await page.close();
}

const lh = {};
if (!process.argv.includes('--no-lighthouse')) {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/generated/catalog.json'), 'utf8'));
  const heaviest = [...cat.products].sort((a, b) => b.images.length - a.images.length)[0];
  const sample = ['/', '/mandirs/', urls.find((u) => /^\/mandirs\/.+/.test(u)), `/mandirs/${heaviest.slug}/`, urls.find((u) => /^\/collections\//.test(u)), '/compare/', '/size-guide/', '/book-consultation/', `/mandirs/${cat.products.filter((p) => p.priceINR < Number(process.env.FULL_PAYMENT_MAX_INR || 500000)).sort((a, b) => b.images.length - a.images.length)[0]?.slug || heaviest.slug}/`, '/faq/', '/policies/privacy/', '/policies/deposit-payment-cancellation/', '/contact/', '/journal/'];
  const port = Number(new URL(browser.wsEndpoint()).port);
  for (const formFactor of ['mobile', 'desktop']) {
    for (const u of sample) {
      const cfg = formFactor === 'desktop'
        ? { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 } } }
        : { extends: 'lighthouse:default' };
      const r = await lighthouse(BASE + u, { port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] }, cfg);
      const cats = Object.fromEntries(Object.entries(r.lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
      lh[`${formFactor} ${u}`] = cats;
      for (const [k, v] of Object.entries(cats)) if (v < 90) {
        const failing = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && r.lhr.categories[k].auditRefs.some((ref) => ref.id === a.id && ref.weight > 0)).map((a) => a.id).slice(0, 6);
        flag('C10', `Lighthouse ${formFactor} ${u}: ${k} ${v} (${failing.join(', ')})`);
      }
      const a11y = Object.values(r.lhr.audits).filter((a) => a.score === 0 && r.lhr.categories.accessibility.auditRefs.some((ref) => ref.id === a.id));
      for (const a of a11y) flag('C10', `a11y ${formFactor} ${u}: ${a.id}: ${(a.details?.items || []).slice(0, 2).map((i) => i.node?.snippet || '').join(' | ')}`);
    }
  }
}
await browser.close();

const out = ['# Browser audit', '', `Page loads: ${loads} (${urls.length} pages × ${widths.join('/')} px)`, '', '## Lighthouse', '', '| Run | Perf | A11y | Best practices | SEO |', '|---|---|---|---|---|',
  ...Object.entries(lh).map(([k, v]) => `| ${k} | ${v.performance} | ${v.accessibility} | ${v['best-practices']} | ${v.seo} |`), '', `## Flags (${flags.length})`, ...flags.map((f) => `- [${f.check}] ${f.msg}`)];
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/browser-audit.md'), out.join('\n'));
console.log(out.join('\n'));
process.exitCode = flags.length ? 1 : 0;
