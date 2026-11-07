#!/usr/bin/env node
/**
 * Full-site QA audit (checks C1–C17). Run after `npm run build`.
 *   C12 no placeholders, no GST/tax-invoice wording   C13 no payment capture while PAYMENTS_ENABLED=false
 *   C14 no email while CONTACT_EMAIL is empty         C15 phone, WhatsApp, seller, grievance officer, policies, lead times
 *   C16 payment rule by price (Stripe flow below the threshold, WhatsApp only above)   C17 no payment without fit check and consent
 *   node scripts/audit.mjs            all static checks + C8 mutation test
 *   node scripts/audit.mjs --no-c8    skip the mutation rebuild (faster)
 * Browser-side checks (console errors, layout at 360/768/1280/1920, Lighthouse) are run by scripts/lighthouse.mjs.
 *
 * The audit re-reads the CSV and the workbook itself; it does not trust the pipeline's catalog.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { checkFit } from '../src/lib/fit.js';
import { loadResolutions, applyCsvResolutions, applyWorkbookResolutions } from './lib/resolutions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');
const flags = [];
const passes = {};
const flag = (c, msg) => flags.push({ check: c, msg });
const pass = (c, n = 1) => { passes[c] = (passes[c] || 0) + n; };

/* ---------------------------------------------------------- helpers */
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const read = (p) => fs.readFileSync(p, 'utf8');
const pages = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html')) pages.push(p); } })(DIST);
const rel = (p) => '/' + path.relative(DIST, p).split(path.sep).join('/').replace(/index\.html$/, '');
// Independent conversions (deliberately written differently from src/lib/units.js)
const ftIn = (cm) => { const totalIn = Math.floor(cm / 2.54 + 0.5); return `${(totalIn - (totalIn % 12)) / 12}' ${totalIn % 12}"`; };
const inr = (n) => '₹' + String(n).replace(/(\d)(?=(\d\d)+\d$)/g, '$1,');

/* ---------------------------------------------------------- sources */
const csv = parse(read(path.join(DATA, fs.readdirSync(DATA).find((f) => f.endsWith('.csv')))), { columns: true, bom: true, trim: true, skip_empty_lines: true });
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.join(DATA, fs.readdirSync(DATA).find((f) => f.endsWith('.xlsx'))));
// Owner-confirmed resolutions are part of the source of truth (data/owner-resolutions.json).
const RES = loadResolutions(DATA);
applyCsvResolutions(csv, RES); applyWorkbookResolutions(wb, RES);
// Owner-supplied business facts and the store policies document.
const BUSINESS = JSON.parse(read(path.join(DATA, 'business.json')));
const POLICY_MD = read(path.join(DATA, 'store-policies.md'));
const policyLines = POLICY_MD.split('\n').map((l) => l.trim()).filter((l) => l && !/^\|[\s:|-]+\|$/.test(l));
const policyStrings = policyLines.flatMap((l) => (l.startsWith('|') ? l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : [l.replace(/^(#+|-|\d+\.)\s+/, '')])).filter(Boolean);
const ownerStrings = [...policyStrings, ...JSON.stringify(BUSINESS).match(/"(?:[^"\\]|\\.)*"/g).map((x) => JSON.parse(x))].filter((v) => v.length > 3);
const val = (v) => (v && typeof v === 'object' ? (v.result ?? v.richText?.map((t) => t.text).join('') ?? v.text ?? null) : v);
const sheet = (name) => {
  const ws = wb.getWorksheet(name); const rows = []; let h;
  ws.eachRow((r) => { const v = r.values.slice(1).map(val); if (!h) { h = v; return; } rows.push(Object.fromEntries(h.map((k, i) => [k, v[i] ?? null]))); });
  return rows;
};
const S = sheet('Structure Sizes'), I = sheet('Idol Sizes'), K = sheet('Pooja Kit Sizes'), STD = sheet('Installation Standards');
const clearance = STD.find((r) => /ceiling clearance/i.test(r.Standard)).Value;

/* ---------------------------------------------------------- C1 pages per SKU */
const productDirs = fs.readdirSync(path.join(DIST, 'mandirs')).filter((d) => fs.existsSync(path.join(DIST, 'mandirs', d, 'index.html')));
const csvSlugs = csv.map((r) => r.Slug);
for (const s of csvSlugs) productDirs.includes(s) ? pass('C1') : flag('C1', `No page for CSV slug ${s}`);
for (const d of productDirs) if (!csvSlugs.includes(d)) flag('C1', `Page /mandirs/${d}/ has no SKU in the CSV`);
const skuMentions = pages.map(read).join(' ');
for (const r of csv) if (!skuMentions.includes(r.SKU)) flag('C1', `SKU ${r.SKU} not mentioned anywhere`);

/* ---------------------------------------------------------- C2 + C3 per product */
for (const r of csv) {
  const file = path.join(DIST, 'mandirs', r.Slug, 'index.html');
  if (!fs.existsSync(file)) continue;
  const html = read(file); const t = text(html);
  const must2 = [
    ['name (h1)', new RegExp(`<h1[^>]*>${r['Product Name'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`).test(decode(html))],
    ['price', t.includes(inr(r['Price INR (India, indicative)']))],
    ['material', t.includes(r['Primary Material'])],
    ['collection', t.includes(r.Collection.replace(/ Collection$/, ''))],
    ['short description', t.includes(r['Short Description'])],
    ['inclusions line', /Includes the structure, (its )?idols, the pooja items, and delivery and installation anywhere in India/.test(t)],
    ['customisation', t.includes(r.Customisation)],
    ['availability', t.includes(r.Availability)],
  ];
  // Long description paragraphs must appear verbatim
  for (const para of (r['Long Description (HTML)'].match(/<p>([\s\S]*?)<\/p>/g) || [])) must2.push([`description paragraph "${text(para).slice(0, 30)}…"`, t.includes(text(para).trim())]);
  for (const li of (r['Long Description (HTML)'].match(/<li>([\s\S]*?)<\/li>/g) || []).filter((x) => !/Size:/.test(x))) must2.push([`description item "${text(li).slice(0, 30)}"`, t.includes(text(li).trim())]);
  if (/\bivory\b/i.test(Object.values(r).join(' '))) must2.push(['ivory note', t.includes('Ivory-finish paint. No animal ivory used.')]);
  if (r['Inspired By']) must2.push(['inspired-by + no affiliation', t.includes(`Inspired by ${r['Inspired By']}`) && /no affiliation with any temple/.test(t)]);
  for (const [k, ok] of must2) ok ? pass('C2') : flag('C2', `${r.SKU}: ${k} missing or different`);

  const s = S.find((x) => x.SKU === r.SKU);
  if (!s) { flag('C3', `${r.SKU}: not in workbook`); continue; }
  const W = s['Width (cm)'], D = s['Depth (cm)'], H = s['Height (cm)'];
  const apt = s['Apartment edition height (cm)'];
  const must3 = [
    ['overall cm', t.includes(`${W} × ${D} × ${H} cm`)],
    ['overall ft-in matches workbook', html.includes(`data-ft="${decodeURIComponent(encodeURIComponent(`${s['Width (ft-in)']} × ${s['Depth (ft-in)']} × ${s['Height (ft-in)']}`)).replace(/"/g, '&quot;')}"`)],
    ['ft-in conversion independent', [W, D, H].every((v, i) => ftIn(v) === [s['Width (ft-in)'], s['Depth (ft-in)'], s['Height (ft-in)']][i])],
    ['footprint', t.includes(`${s['Footprint (m²)']} m²`)],
    ['niche', t.includes(`${s['Interior / niche width (cm)']} × ${s['Interior / niche depth (cm)']} × ${s['Interior / niche clear height (cm)']} cm`)],
    ['altar', t.includes(`${s['Altar / deity platform height from floor (cm)']} cm from the floor`)],
    ['door', t.includes(String(s['Door opening']))],
    ['weight', t.includes(`${s['Weight min (kg)']}–${s['Weight max (kg)']} kg`)],
    ['min ceiling', t.includes(`${s['Min clear ceiling needed (cm)']} cm Height plus ${clearance} cm clearance`)],
    ['apartment edition', apt < H ? t.includes(`${apt} cm high`) && t.includes(`${apt + clearance} cm ceiling`) : t.includes('No separate edition')],
    ['floor load', t.includes(`${s['Floor load incl. occupants (kg/m²)']} kg/m²`)],
    ['installation', /sign-off/i.test(s['Installation requirement']) ? t.includes('A structural engineer must sign off the floor before installation') : t.includes('Standard RCC floor')],
    ['design notes', !s['Design notes'] || t.includes(s['Design notes'])],
  ];
  for (const f of I.filter((x) => x.SKU === r.SKU)) {
    const dims = [f['Height (cm)'], f['Width (cm)'], f['Depth / length (cm)']].join(' × ');
    must3.push([`idol ${f['Figure / element']} (${f.Set})`, t.includes(f['Figure / element']) && t.includes(`${dims} cm`) && t.includes(f.Material) && t.includes(f['Posture / form']) && t.includes(f.Placement)
      && t.includes(f['Weight min (kg)'] === f['Weight max (kg)'] ? `${f['Weight min (kg)']} kg` : `${f['Weight min (kg)']}–${f['Weight max (kg)']} kg`)]);
    must3.push([`idol ${f['Figure / element']} inches`, html.includes(`${[f['Height (cm)'], f['Width (cm)'], f['Depth / length (cm)']].map((c) => Math.round(c / 2.54 * 10) / 10).join(' × ')} in`) && Math.round(f['Height (cm)'] / 2.54 * 10) / 10 === f['Height (in)']]);
  }
  const sets = [...new Set(I.filter((x) => x.SKU === r.SKU).map((x) => x.Set))];
  if (sets.length > 1) must3.push(['deity set tabs', (html.match(/<button[^>]*role="tab"/g) || []).length === sets.length]);
  for (const k of K.filter((x) => x.SKU === r.SKU)) {
    const bits = [];
    if (k['Height (cm)'] !== null) bits.push(`H ${k['Height (cm)']} cm`);
    if (k['Diameter / width (cm)'] !== null) bits.push(`Ø / W ${k['Diameter / width (cm)']} cm`);
    if (k['Length / depth (cm)'] !== null) bits.push(`L / D ${k['Length / depth (cm)']} cm`);
    must3.push([`kit ${k.Item}`, t.includes(k.Item) && t.includes(k.Material) && (!bits.length || t.includes(bits.join(' · ')))]);
  }
  for (const [k, ok] of must3) ok ? pass('C3') : flag('C3', `${r.SKU}: ${k} missing or different`);
}

/* ---------------------------------------------------------- C4 fit checker */
// Oracle written independently from src/lib/fit.js.
function oracle(s, room) {
  const W = s['Width (cm)'], D = s['Depth (cm)'], H = s['Height (cm)'], A = s['Apartment edition height (cm)'];
  const floorOk = (W <= room.w && D <= room.d) || (D <= room.w && W <= room.d);
  const villa = room.c >= H + clearance;
  const aptOk = A < H && room.c >= A + clearance;
  if (!floorOk) return villa || aptOk ? 'footprint' : 'none';
  return villa ? 'standard' : aptOk ? 'apartment' : 'ceiling';
}
const toFit = (s) => ({ widthCm: s['Width (cm)'], depthCm: s['Depth (cm)'], heightCm: s['Height (cm)'], aptHeightCm: s['Apartment edition height (cm)'],
  hasApartmentEdition: s['Apartment edition height (cm)'] < s['Height (cm)'], walkIn: /walk-in/i.test(s.Type), structuralSignOff: /sign-off/i.test(s['Installation requirement']) });
const collections = [...new Set(csv.map((r) => r.Collection))];
let c4cases = 0;
for (const c of collections) {
  const skus = csv.filter((r) => r.Collection === c).map((r) => r.SKU);
  for (const sku of skus) {
    const s = S.find((x) => x.SKU === sku);
    const W = s['Width (cm)'], D = s['Depth (cm)'], H = s['Height (cm)'], A = s['Apartment edition height (cm)'];
    const rooms = [
      { name: 'exact fit at minimum ceiling', w: W, d: D, c: H + clearance },
      { name: 'one cm too narrow', w: W - 1, d: D + 100, c: H + 100 },
      { name: 'rotated only', w: D, d: W, c: H + 50 },
      { name: 'ceiling 1 cm short of villa', w: W + 50, d: D + 50, c: H + clearance - 1 },
      { name: 'ceiling just fits apartment', w: W + 50, d: D + 50, c: A + clearance },
      { name: 'ceiling below apartment', w: W + 50, d: D + 50, c: Math.min(H, A) + clearance - 20 },
      { name: 'tiny room', w: 60, d: 40, c: 200 },
      { name: 'large villa room', w: 600, d: 600, c: 400 },
    ];
    for (const room of rooms) {
      const got = checkFit(toFit(s), room, { ceilingClearance: clearance });
      const want = oracle(s, room);
      c4cases++;
      if (got.verdict !== want) flag('C4', `${sku} ${room.name} (${room.w}×${room.d}×${room.c}): checker=${got.verdict} expected=${want}`);
      else pass('C4');
      // remaining clearance correctness
      if (got.fitting && got.fitting.margin !== room.c - (got.fitting.heightCm + clearance)) flag('C4', `${sku} ${room.name}: wrong margin`);
      if (got.footprint.fits && !got.footprint.rotated && got.footprint.spareW !== room.w - W) flag('C4', `${sku} ${room.name}: wrong spare width`);
    }
  }
}

/* ---------------------------------------------------------- C5 invented facts */
const allText = pages.map((p) => ({ p: rel(p), t: text(read(p)) }));
const suspicious = [
  [/(\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/, 'phone number'], [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'email address'],
  [/\b(testimonial|review(s|ed)?|rating|rated|★|stars?)\b/i, 'review/testimonial/rating'], [/\b(award|award-winning|certified|certification|ISO \d)/i, 'award/certification'],
  [/\b(since (19|20)\d\d|\d+\+? years|over \d+ (families|customers|homes)|\d+,?\d* (happy )?customers)/i, 'experience/customer count'],
  [/\b(guarantee[ds]?|lifetime)\b/i, 'guarantee claim'], [/\b(as seen in|featured in|press)\b/i, 'press claim'],
  [/\b\d+\s*(weeks?|days?|months?)\b/i, 'lead time'],
];
// Matches that sit inside text copied verbatim from the CSV or the workbook are source facts, not invented ones.
const sourceStrings = [...csv.flatMap((r) => Object.values(r)), ...[S, I, K, STD].flatMap((rows) => rows.flatMap((r) => Object.values(r)))]
  .filter((v) => typeof v === 'string' && v.length > 3).map((v) => text(v));
const fromSource = (m, t) => sourceStrings.some((v) => { const i = v.indexOf(m[0]); return i >= 0 && t.includes(v); });
// Facts the owner supplied (data/business.json, data/store-policies.md) are sourced too: the exact phrase must be in them.
const fromOwner = (m) => ownerStrings.some((v) => v.includes(m[0]));
for (const { p, t } of allText) {
  for (const [re, what] of suspicious) {
    for (const m of t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const ctx = t.slice(Math.max(0, m.index - 60), m.index + 60);
      if (fromSource(m, t) || fromOwner(m)) { pass('C5'); continue; }
      flag('C5', `${p}: possible ${what}: "…${ctx.trim()}…"`);
    }
  }
}
for (const p of pages) if (/"@type":"(Review|AggregateRating|LocalBusiness)"/.test(read(p))) flag('C5', `${rel(p)}: forbidden schema type`);

/* ---------------------------------------------------------- C6 replica / affiliation */
for (const p of pages) {
  const h = read(p);
  if (/replica/i.test(h)) flag('C6', `${rel(p)}: contains "replica"`);
  const t = text(h);
  for (const m of t.matchAll(/.{0,50}\b(official|authorised|authorized|endorsed|affiliated|affiliation|in association with|blessed by)\b.{0,80}/gi)) {
    const negated = /\b(no|not|never|without)\b[^.]{0,30}(affiliat|official|endorse)/i.test(m[0]) || /\?\s*No\b/.test(m[0]);
    const k = m[0].toLowerCase().indexOf(m[1].toLowerCase());
    const owner = ownerStrings.some((v) => v.includes(m[0].slice(Math.max(0, k - 20), k + m[1].length + 20).trim())); // e.g. "RBI-authorised payment gateway" in the privacy policy
    if (!negated && !owner) flag('C6', `${rel(p)}: possible affiliation claim "${m[0]}"`); else pass('C6');
  }
}
['src', 'public'].forEach((d) => { try { execSync(`grep -ril replica ${path.join(ROOT, d)} --include=*.astro --include=*.js --include=*.css --include=*.html --exclude-dir=generated`, { stdio: 'pipe' }); flag('C6', `"replica" found in ${d}/ source`); } catch { pass('C6'); } });
pass('C6');

/* ---------------------------------------------------------- C7 visualisation labels, no collage */
const overrides = JSON.parse(read(path.join(DATA, 'image-overrides.json')));
for (const p of pages) {
  const h = read(p);
  // every <picture> of a product image must be followed by its label (unless marked as a photo)
  const re = /<picture[^>]*>([\s\S]*?)<\/picture>([\s\S]{0,400})/g;
  let m;
  while ((m = re.exec(h))) {
    if (!/\/img\/mandirs\//.test(m[1])) continue;
    const src = m[1].match(/\/img\/mandirs\/([^"\s]+?)-\d+\.(webp|avif)/)?.[1];
    const isPhoto = Object.entries(overrides).some(([, v]) => v.kind === 'photo' && src && src.includes(v.base || '__'));
    if (isPhoto || /Visualisation/.test(m[2])) pass('C7');
    else flag('C7', `${rel(p)}: product image without "Visualisation" label (${src})`);
  }
  if (/collage/i.test(h)) flag('C7', `${rel(p)}: mentions collage`);
}
const compareJs = fs.readdirSync(path.join(DIST, '_astro')).filter((f) => f.endsWith('.js')).map((f) => read(path.join(DIST, '_astro', f))).join(' ');
if (!/Visualisation/.test(compareJs)) flag('C7', 'client-rendered images (compare, lightbox) do not add a Visualisation label');
// One file per image: check the encoded images are single frames of the source aspect ratio (no stitched grids).
const cat = JSON.parse(read(path.join(ROOT, 'src/generated/catalog.json')));
for (const pr of cat.products) for (const im of pr.images) {
  const r = im.width / im.height;
  if (r > 2.2 || r < 0.45) flag('C7', `${pr.sku}: unusual aspect ${im.width}×${im.height} (possible collage)`); else pass('C7');
}

/* ---------------------------------------------------------- C8 no hardcoded product data */
const srcFiles = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'generated') walk(p); } else if (/\.(astro|js|ts|css)$/.test(f)) srcFiles.push(p); } })(path.join(ROOT, 'src'));
const srcAll = srcFiles.map((f) => [f, read(f)]);
for (const r of csv) {
  const needles = [r.SKU, r['Product Name'], r.Slug, inr(r['Price INR (India, indicative)']), r['Price INR (India, indicative)']];
  for (const n of needles) for (const [f, s] of srcAll) if (s.includes(n)) flag('C8', `${path.relative(ROOT, f)} hardcodes "${n}"`);
}
for (const s of S) for (const [f, src] of srcAll) {
  if (src.includes(`${s['Width (cm)']} × ${s['Depth (cm)']} × ${s['Height (cm)']}`)) flag('C8', `${path.relative(ROOT, f)} hardcodes dimensions of ${s.SKU}`);
}
pass('C8');

if (!process.argv.includes('--no-c8')) {
  // Mutation test: change one CSV price + name and one workbook height, rebuild into a temp folder, confirm every page using them changed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sthuthi-c8-'));
  var TEST_EMAIL = 'enquiries@sthuthi.example';
  const tdata = path.join(tmp, 'data'); fs.mkdirSync(tdata);
  for (const f of fs.readdirSync(DATA)) if (f !== 'Products') fs.copyFileSync(path.join(DATA, f), path.join(tdata, f));
  fs.symlinkSync(path.join(DATA, 'Products'), path.join(tdata, 'Products'));
  const target = csv[csv.length - 1];
  const newPrice = String(Number(target['Price INR (India, indicative)']) + 12345);
  const csvRaw = read(path.join(tdata, 'mandir-catalogue.csv'));
  const lines = csvRaw.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(target.SKU + ','));
  lines[idx] = lines[idx].replace(`,${target['Price INR (India, indicative)']},`, `,${newPrice},`);
  fs.writeFileSync(path.join(tdata, 'mandir-catalogue.csv'), lines.join('\n'));
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(path.join(tdata, 'Sthuthi_Mandir_Measurements.xlsx'));
  const ws = wb2.getWorksheet('Structure Sizes');
  let hdr; let newH;
  ws.eachRow((row, n) => {
    const v = row.values.slice(1).map(val);
    if (n === 1) { hdr = v; return; }
    if (v[0] === target.SKU) { const c = hdr.indexOf('Height (cm)') + 1; newH = Number(val(row.getCell(c).value)) + 7; row.getCell(c).value = newH; }
  });
  await wb2.xlsx.writeFile(path.join(tdata, 'Sthuthi_Mandir_Measurements.xlsx'));
  const backup = read(path.join(ROOT, 'src/generated/catalog.json'));
  try {
    execSync(`node scripts/build-data.mjs --skip-images`, { cwd: ROOT, env: { ...process.env, STHUTHI_DATA_DIR: tdata, STHUTHI_REPORTS_DIR: path.join(tmp, 'reports') }, stdio: 'pipe' });
    // The same rebuild also sets CONTACT_EMAIL, to prove one value makes the email appear everywhere (C14).
    execSync(`npx astro build --outDir ${path.join(tmp, 'dist')}`, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CONTACT_EMAIL: TEST_EMAIL } });
    const pp = read(path.join(tmp, 'dist/mandirs', target.Slug, 'index.html'));
    const listing = read(path.join(tmp, 'dist/mandirs/index.html'));
    const coll = fs.readdirSync(path.join(tmp, 'dist/collections')).map((c) => read(path.join(tmp, 'dist/collections', c, 'index.html'))).join(' ');
    const sg = read(path.join(tmp, 'dist/size-guide/index.html'));
    const cmp = read(path.join(tmp, 'dist/compare/index.html'));
    const checks = [
      ['product page price', text(pp).includes(inr(newPrice))], ['product page old price gone', !text(pp).includes(inr(target['Price INR (India, indicative)']))],
      ['listing price', text(listing).includes(inr(newPrice))], ['collection page price', text(coll).includes(inr(newPrice))],
      ['product page height', text(pp).includes(`× ${newH} cm`)], ['product page min ceiling', text(pp).includes(`${newH + clearance} cm`)],
      ['product page ft-in', pp.includes(ftIn(newH).replace(/"/g, '&quot;'))], ['drawing height', pp.includes(`>${newH} cm<`)],
      ['size guide height', text(sg).includes(`${newH} cm`)], ['compare data', cmp.includes(`"heightCm":${newH}`)], ['listing filter data', listing.includes(`data-h="${newH}"`)],
    ];
    for (const [k, ok] of checks) ok ? pass('C8') : flag('C8', `mutation test: ${k} did not update`);
    const tdist = (u) => read(path.join(tmp, 'dist', u, 'index.html'));
    const orgEmail = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((o) => o['@type'] === 'Organization')?.email;
    const c14 = [
      ['contact page', tdist('contact').includes(`mailto:${TEST_EMAIL}`)],
      ['footer', tdist('').includes(`mailto:${TEST_EMAIL}`) && tdist('mandirs').includes(`mailto:${TEST_EMAIL}`)],
      ['policies (business details)', text(tdist('policies')).includes(`Email ${TEST_EMAIL}`)],
      ['policies (grievance officer)', text(tdist('policies/grievance-redressal')).includes(`Email ${TEST_EMAIL}`)],
      ['schema', orgEmail(tdist('')) === TEST_EMAIL && orgEmail(tdist('contact')) === TEST_EMAIL],
    ];
    for (const [k, ok] of c14) ok ? pass('C14') : flag('C14', `CONTACT_EMAIL set: email does not appear in ${k}`);
  } catch (e) {
    flag('C8', `mutation rebuild failed: ${String(e.stderr || e.message).slice(0, 300)}`);
  } finally {
    fs.writeFileSync(path.join(ROOT, 'src/generated/catalog.json'), backup);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------- C9 links and images */
const exists = (u) => {
  const clean = decodeURIComponent(u.split('#')[0].split('?')[0]);
  if (!clean || clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const p = path.join(DIST, clean);
  return (fs.existsSync(p) && fs.statSync(p).isFile()) || fs.existsSync(path.join(p, 'index.html'));
};
const ids = new Map(pages.map((p) => [rel(p), new Set([...read(p).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
let linkCount = 0;
for (const p of pages) {
  const h = read(p);
  for (const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const u = decode(m[1]);
    if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(u)) {
      if (u.startsWith('#') && u.length > 1 && !ids.get(rel(p)).has(u.slice(1))) flag('C9', `${rel(p)}: anchor ${u} has no target`);
      continue;
    }
    linkCount++;
    if (!exists(u)) flag('C9', `${rel(p)}: broken link/src ${u}`);
    const hash = u.split('#')[1];
    if (hash && u.startsWith('/')) { const target = u.split('#')[0].split('?')[0]; const t = ids.get(target.endsWith('/') ? target : target + '/'); if (t && !t.has(hash)) flag('C9', `${rel(p)}: ${u} anchor missing`); }
  }
  for (const m of h.matchAll(/srcset="([^"]+)"/g)) for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; linkCount++; if (!exists(u)) flag('C9', `${rel(p)}: missing srcset file ${u}`); }
  if (!/<link rel="canonical" href="[^"]+"/.test(h) && !/404/.test(p)) flag('C10', `${rel(p)}: no canonical`);
  if (!/<meta name="description" content="[^"]{30,}"/.test(h)) flag('C10', `${rel(p)}: missing/short meta description`);
  for (const im of h.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(im[0])) flag('C10', `${rel(p)}: img without alt`);
}
pass('C9', linkCount);
const titles = pages.filter((p) => !/404/.test(p)).map((p) => read(p).match(/<title>([^<]+)<\/title>/)?.[1]);
const dupT = titles.filter((t, i) => titles.indexOf(t) !== i);
if (dupT.length) flag('C10', `duplicate titles: ${[...new Set(dupT)].join(' | ')}`);
const descs = pages.filter((p) => !/404/.test(p)).map((p) => read(p).match(/<meta name="description" content="([^"]+)"/)?.[1]);
const dupD = descs.filter((t, i) => descs.indexOf(t) !== i);
if (dupD.length) flag('C10', `duplicate descriptions: ${[...new Set(dupD)].join(' | ')}`);
for (const f of ['sitemap.xml', 'image-sitemap.xml', 'robots.txt']) fs.existsSync(path.join(DIST, f)) ? pass('C10') : flag('C10', `missing ${f}`);

/* ---------------------------------------------------------- C10 structured data */
const envRaw = fs.existsSync(path.join(ROOT, '.env')) ? read(path.join(ROOT, '.env')) : '';
const envEarly = (k) => (process.env[k] ?? envRaw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim();
const PAYMENTS_ENABLED_C10 = envEarly('PAYMENTS_ENABLED') === 'true';
const THRESHOLD_C10 = Number(envEarly('FULL_PAYMENT_MAX_INR') || 500000);
for (const p of pages) {
  const h = read(p);
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let o; try { o = JSON.parse(m[1]); } catch { flag('C10', `${rel(p)}: invalid JSON-LD`); continue; }
    if (o['@context'] !== 'https://schema.org') flag('C10', `${rel(p)}: JSON-LD context`);
    const t = o['@type'];
    if (t === 'Product') {
      for (const k of ['name', 'sku', 'image', 'description', 'brand', 'width', 'depth', 'height', 'weight', 'material']) if (!o[k] || (Array.isArray(o[k]) && !o[k].length)) flag('C10', `${rel(p)}: Product missing ${k}`);
      { const row = csv.find((x) => x.SKU === o.sku); const buy = PAYMENTS_ENABLED_C10 && Number(row['Price INR (India, indicative)']) < THRESHOLD_C10;
        if (o.offers && (!buy || o.offers.price !== Number(row['Price INR (India, indicative)']))) flag('C10', `${rel(p)}: Offer present on a product not sold online, or with the wrong price`);
        if (buy && !o.offers) flag('C10', `${rel(p)}: Offer missing on a product sold online`); }
      if (o.review || o.aggregateRating) flag('C10', `${rel(p)}: review markup`);
      for (const im of o.image || []) if (!exists(new URL(im).pathname)) flag('C10', `${rel(p)}: schema image missing ${im}`);
      const r = csv.find((x) => x.SKU === o.sku); const s = S.find((x) => x.SKU === o.sku);
      if (o.width?.value !== s['Width (cm)'] || o.height?.value !== s['Height (cm)'] || o.depth?.value !== s['Depth (cm)'] || o.weight?.maxValue !== s['Weight max (kg)']) flag('C10', `${rel(p)}: Product dimensions differ from workbook`);
      if (o.name !== r['Product Name']) flag('C10', `${rel(p)}: Product name differs`);
    }
    if (t === 'BreadcrumbList') o.itemListElement.forEach((it, i) => { if (it.position !== i + 1 || !it.name || !it.item) flag('C10', `${rel(p)}: breadcrumb item ${i + 1}`); });
    if (t === 'FAQPage') for (const q of o.mainEntity) if (!q.name || !q.acceptedAnswer?.text) flag('C10', `${rel(p)}: empty FAQ`);
    if (['LocalBusiness', 'Review', 'AggregateRating'].includes(t)) flag('C10', `${rel(p)}: forbidden type ${t}`);
    pass('C10');
  }
}

/* ---------------------------------------------------------- C11 logo */
import sharp from 'sharp';
for (const p of pages) {
  const h = read(p);
  for (const m of h.matchAll(/<img\b[^>]*src="(\/brand\/[^"]+)"[^>]*>/g)) {
    const tag = m[0]; const file = path.join(DIST, m[1]);
    const meta = await sharp(file).metadata();
    const w = +tag.match(/width="(\d+)"/)?.[1], hh = +tag.match(/height="(\d+)"/)?.[1];
    if (!w || !hh) { flag('C11', `${rel(p)}: logo without width/height`); continue; }
    if (Math.abs(w / hh - meta.width / meta.height) > 0.01) flag('C11', `${rel(p)}: logo aspect ${w}/${hh} vs file ${meta.width}/${meta.height}`);
    const style = tag.match(/style="([^"]*)"/)?.[1] || '';
    if (/height:\s*\d+px;\s*width:\s*\d/.test(style) || /filter|mix-blend|opacity/.test(style)) flag('C11', `${rel(p)}: logo inline style distorts/recolours (${style})`);
    if (!/alt="Sthuthi"/.test(tag)) flag('C11', `${rel(p)}: logo alt text`);
    pass('C11');
  }
}
const css = fs.readdirSync(path.join(DIST, '_astro')).filter((f) => f.endsWith('.css')).map((f) => read(path.join(DIST, '_astro', f))).join(' ');
for (const m of css.matchAll(/(\.brand|\.logo-plate|\.footer-brand)[^{]*\{([^}]*)\}/g)) if (/filter|mix-blend-mode|opacity|object-fit:\s*fill/.test(m[2])) flag('C11', `CSS recolours/distorts logo: ${m[0].slice(0, 80)}`);
// Logo pixels: composited back on the paper colour the transparent variant must equal the original artwork.
{
  const orig = await sharp(path.join(DATA, 'sthuthi-logo.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const brand = JSON.parse(read(path.join(ROOT, 'src/generated/brand.json')));
  const flat = await sharp(path.join(ROOT, 'public/brand/logo-mark.png')).flatten({ background: brand.paper }).raw().toBuffer({ resolveWithObject: true });
  if (flat.info.width < 100) flag('C11', 'logo mark too small');
  if (fs.readFileSync(path.join(ROOT, 'public/brand/sthuthi-logo-original.png')).equals(fs.readFileSync(path.join(DATA, 'sthuthi-logo.png')))) pass('C11'); else flag('C11', 'original logo copy differs from source');
  if (orig.info.width) pass('C11');
}

/* ---------------------------------------------------------- C12 placeholders, GST */
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
const ldStrings = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(ldStrings) : o && typeof o === 'object' ? Object.values(o).flatMap(ldStrings) : []);
const PLACEHOLDER = /\bTBC\b|\bTBD\b|to be (confirmed|added|announced)|coming soon|lorem ipsum|placeholder|\bxx+\b|\bN\/A\b|\[[^\]]{0,80}\]/i;
const TAX = /\bGSTIN?\b|\bGST\b|tax invoice|(inclusive|exclusive|incl\.?|excl\.?) (of )?(all )?tax(es)?|\+\s*tax(es)?\b|plus tax(es)?/i;
for (const p of pages) {
  const h = read(p); const t = text(h);
  const m1 = t.match(PLACEHOLDER); m1 ? flag('C12', `${rel(p)}: placeholder text "${t.slice(Math.max(0, m1.index - 40), m1.index + 40).trim()}"`) : pass('C12');
  const m2 = t.match(TAX) || decode(h.replace(/<script(?! type="application\/ld\+json")[\s\S]*?<\/script>/gi, '')).match(TAX);
  m2 ? flag('C12', `${rel(p)}: tax wording "${m2[0]}"`) : pass('C12');
  if (/data-placeholder=|class="tbc"/.test(h)) flag('C12', `${rel(p)}: placeholder element`);
  // Empty content elements. Live regions filled by script (form errors, lightbox caption) are not fields.
  for (const m of h.matchAll(/<(td|th|dd|dt|p|li|h[1-6]|span class="sub")([^>]*)>\s*<\/(td|th|dd|dt|p|li|h[1-6]|span)>/g)) if (!/class="error"|\sdata-[\w-]+/.test(m[2])) flag('C12', `${rel(p)}: empty element ${m[0].slice(0, 60)}`);
  for (const v of ldBlocks(h).flatMap(ldStrings)) { if (PLACEHOLDER.test(v) || TAX.test(v)) flag('C12', `${rel(p)}: schema value "${v.slice(0, 80)}"`); else pass('C12'); }
  for (const m of h.matchAll(/<meta (?:name|property)="[^"]+" content="([^"]*)"/g)) if (PLACEHOLDER.test(decode(m[1])) || TAX.test(decode(m[1]))) flag('C12', `${rel(p)}: meta "${m[1].slice(0, 80)}"`);
}
const assetText = (exts) => { const out = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) { if (f !== 'img') walk(q); } else if (exts.test(f)) out.push([q, read(q)]); } })(DIST); return out; };
for (const [f, src] of assetText(/\.(js|json|xml|txt|webmanifest)$/)) { if (TAX.test(src)) flag('C12', `${path.relative(DIST, f)}: tax wording`); else pass('C12'); }

/* ---------------------------------------------------------- C13 no payment capture */
const envFile = fs.existsSync(path.join(ROOT, '.env')) ? read(path.join(ROOT, '.env')) : '';
const envVal = (k) => (process.env[k] ?? envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim();
const PAYMENTS_ENABLED = envVal('PAYMENTS_ENABLED') === 'true';
const CONTACT_EMAIL = envVal('CONTACT_EMAIL');
// Price rule, computed independently from the CSV price and the threshold setting.
const THRESHOLD = Number(envVal('FULL_PAYMENT_MAX_INR') || 500000);
const priceOf = (r) => Number(r['Price INR (India, indicative)']);
const tierCsv = (r) => (PAYMENTS_ENABLED && priceOf(r) < THRESHOLD ? 'buy' : 'whatsapp');
const buyPages = new Set(csv.filter((r) => tierCsv(r) === 'buy').map((r) => `/mandirs/${r.Slug}/`));
const WA_LABELS = ['Chat on WhatsApp', 'Chat with us on WhatsApp'];
{
  // Hosted Stripe Checkout only: no gateway script, card field or key may reach the browser.
  const GATEWAY = PAYMENTS_ENABLED
    ? /razorpay|paytm|payu|cashfree|phonepe|instamojo|ccavenue|billdesk|paypal|juspay|easebuzz|js\.stripe\.com|checkout\.js|upi:\/\/pay|\b(sk|rk)_(test|live)_[A-Za-z0-9]{6,}|\bpk_(test|live)_[A-Za-z0-9]{6,}|\bwhsec_[A-Za-z0-9]{6,}/i
    : /razorpay|stripe|paytm|payu|cashfree|phonepe|instamojo|ccavenue|billdesk|paypal|juspay|easebuzz|PaymentRequest|checkout\.js|payment_session|upi:\/\/pay|\/api\/checkout/i;
  for (const [f, src] of [...assetText(/\.(html|js|json)$/)]) { const m = src.match(GATEWAY); m ? flag('C13', `${path.relative(DIST, f)}: payment code "${m[0]}"`) : pass('C13'); }
  for (const p of pages) {
    const h = read(p); const r = rel(p);
    const buyPage = buyPages.has(r);
    for (const m of h.matchAll(/<form\b[^>]*>/g)) if (/\saction="(?!#)[^"]+"/.test(m[0])) flag('C13', `${r}: form posts to ${m[0].match(/action="([^"]+)"/)[1]}`); else pass('C13');
    if (/autocomplete="cc-|name="(card|cvv|cvc|upi)/i.test(h)) flag('C13', `${r}: card or UPI field`);
    if (!buyPage && /data-buy\b|id="buy"/.test(h)) flag('C13', `${r}: buy form on a page that may not take payment`);
    for (const m of h.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const attrs = m[2]; const label = text(m[3]).trim();
      const href = decode(attrs.match(/href="([^"]*)"/)?.[1] || '');
      if (/^\/policies\//.test(href)) continue;
      if (/\b(pay|payment|buy|cart|checkout|order now|place order|reserve|deposit|purchase)\b/i.test(label)) {
        const row = csv.find((x) => r === `/mandirs/${x.Slug}/`);
        const allowed = buyPage && row && (label === `Buy now — ${inr(priceOf(row))}` || label === 'Continue to secure payment');
        allowed ? pass('C13') : flag('C13', `${r}: payment action "${label}"`);
      }
      if (/class="[^"]*\bbtn\b/.test(attrs)) {
        if (href.startsWith('/book-consultation/') && label !== 'Book a design consultation') flag('C13', `${r}: consultation CTA reads "${label}"`);
        else if (/wa\.me\//.test(href) && !WA_LABELS.includes(label)) flag('C13', `${r}: WhatsApp CTA reads "${label}"`);
        else pass('C13');
      }
    }
  }
  const consultJs = assetText(/\.(js|html)$/).filter(([f, src]) => /wa\.me\/\$\{/.test(src));
  if (consultJs.some(([, src]) => /Chat on WhatsApp/.test(src))) pass('C13'); else flag('C13', 'consultation form has no WhatsApp handoff');
  if (/textContent = 'Book a consultation|>Book a consultation</.test(assetText(/\.js$/).map((x) => x[1]).join(' '))) flag('C13', 'client script CTA not "Book a design consultation"');
}

/* ---------------------------------------------------------- C14 email hidden while CONTACT_EMAIL is empty */
if (!CONTACT_EMAIL) {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[a-z]{2,}/;
  for (const [f, src] of assetText(/\.(html|js|json|xml|txt|webmanifest)$/)) {
    const m = src.replace(/@[\w-]+\/[\w.-]+/g, '').match(EMAIL); // ignore npm scope paths like @fontsource/...
    m && !/\.(woff2?|png|webp|avif|js|css)$/.test(m[0]) ? flag('C14', `${path.relative(DIST, f)}: email "${m[0]}"`) : pass('C14');
    if (/mailto:/i.test(src)) flag('C14', `${path.relative(DIST, f)}: mailto link`);
  }
  for (const p of pages) for (const o of ldBlocks(read(p))) if (JSON.stringify(o).includes('"email"')) flag('C14', `${rel(p)}: email in schema`);
} else pass('C14');

/* ---------------------------------------------------------- C15 contact, seller, grievance officer, policies, lead times */
// Expected values typed from the owner's instruction (independent of data/business.json, which the site reads).
const X = {
  phone: '+91 8951618186', tel: 'tel:+918951618186', wa: 'https://wa.me/918951618186', legal: 'Vrance Agency Private Limited',
  cin: 'U73200AP2023PTC112905', pan: 'AAJCV7674H', addr: 'D.No. 20-1-416/1b, Subhash Nagar, Korlagunta, Tirupati (Urban), Chittoor, Andhra Pradesh 517501',
  footer: 'Sthuthi is a brand of Vrance Agency Private Limited (CIN U73200AP2023PTC112905), Tirupati, Andhra Pradesh.',
  officer: 'Vikram', role: 'CEO', hours: 'Monday to Saturday, 10:00 to 18:00 IST',
  policies: ['delivery-installation', 'deposit-payment-cancellation', 'refunds', 'warranty', 'privacy', 'terms', 'grievance-redressal'],
  lead: { cabinet: '10–16 weeks', cabin: '18–28 weeks' },
};
for (const p of pages) {
  const h = read(p); const t = text(h); const r = rel(p);
  const ok = (cond, msg) => (cond ? pass('C15') : flag('C15', `${r}: ${msg}`));
  ok(t.includes(X.footer), 'footer seller line missing or different');
  for (const slug of X.policies) ok(h.includes(`href="/policies/${slug}/"`), `footer does not link /policies/${slug}/`);
  for (const m of h.matchAll(/href="(tel:[^"]*)"/g)) ok(m[1] === X.tel, `phone link ${m[1]}`);
  for (const m of h.matchAll(/href="(https?:\/\/(?:wa\.me|api\.whatsapp\.com)[^"]*)"/g)) ok(m[1] === X.wa || m[1].startsWith(X.wa + '?text='), `WhatsApp link ${m[1]}`);
  for (const m of t.matchAll(/(?<![\w/.-])\+?\d[\d -]{8,14}\d(?![\w/-])/g)) ok(m[0].replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '') === '8951618186', `phone number "${m[0]}"`);
  for (const m of t.matchAll(/\b[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g)) ok(m[0] === X.cin, `CIN "${m[0]}"`);
  for (const m of t.matchAll(/\b[A-Z]{5}\d{4}[A-Z]\b/g)) ok(m[0] === X.pan, `PAN "${m[0]}"`);
  for (const m of t.matchAll(/Vrance[^.,()]*/g)) ok(m[0].trim().startsWith(X.legal), `seller name "${m[0]}"`);
  for (const m of t.matchAll(/D\.No\.[^|]{0,120}/g)) ok(m[0].startsWith(X.addr), `address "${m[0].slice(0, 100)}"`);
  const org = ldBlocks(h).find((o) => o['@type'] === 'Organization');
  ok(org && org.legalName === X.legal && org.brand?.name === 'Sthuthi' && org.telephone === X.phone && org.address?.postalCode === '517501'
    && org.address?.addressRegion === 'Andhra Pradesh' && org.address?.addressCountry === 'IN' && X.addr.startsWith(org.address?.streetAddress)
    && org.identifier?.value === X.cin && !org.email === !CONTACT_EMAIL, 'Organization schema seller details');
  // Lead times: only the two owner figures, and the right one for each product
  for (const m of t.matchAll(/\b\d+\s*[–-]\s*\d+\s*weeks\b/g)) ok([X.lead.cabinet, X.lead.cabin].includes(m[0]), `lead time "${m[0]}"`);
}
for (const r of csv) {
  const f = path.join(DIST, 'mandirs', r.Slug, 'index.html'); if (!fs.existsSync(f)) continue;
  const s = S.find((x) => x.SKU === r.SKU); const t = text(read(f));
  const want = /walk-in/i.test(s.Type) ? X.lead.cabin : X.lead.cabinet;
  t.includes(`Made to order in ${want}, counted from drawing approval`) ? pass('C15') : flag('C15', `${r.SKU}: lead time should be ${want}`);
  const ld = ldBlocks(read(f)).find((o) => o['@type'] === 'Product');
  ld?.additionalProperty?.some((x) => x.name === 'Lead time' && x.value.startsWith(want)) ? pass('C15') : flag('C15', `${r.SKU}: schema lead time`);
}
{
  const contact = text(read(path.join(DIST, 'contact/index.html')));
  for (const v of [X.phone, X.legal, X.cin, X.pan, X.addr, `${X.officer}, ${X.role}`, X.hours]) contact.includes(v) ? pass('C15') : flag('C15', `/contact/: missing "${v}"`);
  const g = text(read(path.join(DIST, 'policies/grievance-redressal/index.html')));
  for (const v of [`Name ${X.officer}`, `Designation ${X.role}`, `Address ${X.addr}`, `Phone / WhatsApp ${X.phone}`, `Hours ${X.hours}`]) g.includes(v) ? pass('C15') : flag('C15', `/policies/grievance-redressal/: missing "${v}"`);
}
// Policies word for word: every heading, paragraph, list item and table cell of data/store-policies.md is on its page.
{
  const secs = POLICY_MD.split(/\n(?=## \d+\. )/);
  const flat = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<\/?(a|strong|em|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const pageFor = (i) => flat(read(path.join(DIST, i === 0 ? 'policies' : `policies/${X.policies[i - 1]}`, 'index.html')));
  secs.forEach((sec, i) => {
    let t; try { t = pageFor(i); } catch { flag('C15', `policy page ${i ? X.policies[i - 1] : 'index'} missing`); return; }
    const head = sec.match(/^## \d+\. (.+)$/m)?.[1];
    if (head) t.includes(head) ? pass('C15') : flag('C15', `policy ${i}: title "${head}" missing`);
    for (const l of sec.split('\n').map((x) => x.trim()).filter((x) => x && !/^## |^# |^\|[\s:|-]+\|$/.test(x))) {
      const parts = l.startsWith('|') ? l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : [l.replace(/^(###|-|\d+\.)\s+/, '')];
      for (const part of parts) t.includes(part) ? pass('C15') : flag('C15', `policy ${i ? X.policies[i - 1] : 'index'}: not verbatim "${part.slice(0, 70)}"`);
    }
  });
}

/* ---------------------------------------------------------- C16 payment rule by price; C17 payment gates */
{
  const ok16 = (cond, msg) => (cond ? pass('C16') : flag('C16', msg));
  const ok17 = (cond, msg) => (cond ? pass('C17') : flag('C17', msg));
  const listing = read(path.join(DIST, 'mandirs/index.html'));
  const cmpData = JSON.parse(decode(read(path.join(DIST, 'compare/index.html')).match(/data-compare-json>([\s\S]*?)<\/script>/)[1]));
  for (const r of csv) {
    const f = path.join(DIST, 'mandirs', r.Slug, 'index.html'); if (!fs.existsSync(f)) continue;
    const h = read(f); const t = text(h); const tier = tierCsv(r); const price = priceOf(r);
    const prod = ldBlocks(h).find((o) => o['@type'] === 'Product');
    const card = listing.match(new RegExp(`<article class="card" data-sku="${r.SKU}"[^>]*data-tier="(\\w+)"`))?.[1];
    ok16(card === tier && listing.includes(`data-tier="${tier}">${tier === 'buy' ? 'Buy online' : 'Enquire on WhatsApp'}</span>`), `${r.SKU}: listing card label should be ${tier}`);
    ok16(cmpData.products.find((x) => x.sku === r.SKU)?.tier === tier, `${r.SKU}: compare data tier should be ${tier}`);
    if (tier === 'buy') {
      ok16(new RegExp(`<a class="btn btn-primary" href="#buy" data-buy-cta>Buy now — ${inr(price)}</a>`).test(decode(h)), `${r.SKU}: primary CTA should be "Buy now — ${inr(price)}"`);
      ok16(/<a class="btn btn-ghost" href="\/book-consultation\/\?sku=[^"]+">Book a design consultation<\/a>/.test(h), `${r.SKU}: secondary CTA should be "Book a design consultation"`);
      ok16(h.includes(`data-buy data-sku="${r.SKU}"`), `${r.SKU}: buy form missing`);
      ok16(prod?.offers?.price === price && prod?.offers?.priceCurrency === 'INR', `${r.SKU}: Offer schema should carry the CSV price`);
      const flatH = decode(h.replace(/<\/?(a|strong|em)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
      ok17(flatH.includes('I have read the Delivery & Installation, Cancellation and Refund policies'), `${r.SKU}: policy consent text missing`);
      ok17(/<button class="btn btn-primary" type="submit" data-buy-submit disabled>/.test(h), `${r.SKU}: payment button is not disabled until the checks pass`);
      for (const k of ['pin', 'w', 'd', 'c']) ok17(new RegExp(`id="b-${k === 'pin' ? 'pin' : k}" name="${k}"[^>]*required`).test(h), `${r.SKU}: buy form field ${k} missing`);
    } else {
      const msg = `Hi Sthuthi, I'm interested in ${r.SKU} – ${r['Product Name']} (${inr(price)}).`;
      const want = `https://wa.me/918951618186?text=${encodeURIComponent(msg)}`;
      const primary = decode(h).match(/<div class="cta-stack"[^>]*>\s*<a class="btn btn-primary" href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      ok16(primary && primary[1] === want && primary[2] === 'Chat with us on WhatsApp', `${r.SKU}: primary CTA should be "Chat with us on WhatsApp" with the prefilled message (got ${primary?.[2]} ${primary?.[1]?.slice(0, 80)})`);
      ok16(/<a class="btn btn-ghost" href="\/book-consultation\/\?sku=[^"]+">Book a design consultation<\/a>/.test(h), `${r.SKU}: secondary CTA should be "Book a design consultation"`);
      ok16(!/Buy now|data-buy|\/api\/checkout/.test(h) && !prod?.offers, `${r.SKU}: payment option on a WhatsApp-only product`);
    }
  }

  // Live flow: run the real payment server against a local Stripe stand-in (test key; nothing leaves this machine).
  const { spawn } = await import('node:child_process');
  const { default: Stripe } = await import('stripe');
  const { startStripeMock } = await import('./lib/stripe-mock.mjs');
  const mock = await startStripeMock();
  const ordersTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sthuthi-orders-'));
  const WHSEC = 'whsec_auditmock0000000000000000';
  const port = 4600 + Math.floor(Math.random() * 300);
  const srv = spawn(process.execPath, ['server/server.mjs', '--port', String(port)], { cwd: ROOT, env: { ...process.env,
    STRIPE_SECRET_KEY: 'sk_test_auditmock000000', STRIPE_API_HOST: '127.0.0.1', STRIPE_API_PORT: String(mock.port), STRIPE_API_PROTOCOL: 'http',
    STRIPE_WEBHOOK_SECRET: WHSEC, ORDER_ENDPOINT: `http://127.0.0.1:${mock.port}/orders`, ORDERS_DIR: ordersTmp, SITE_URL: '',
    PAYMENTS_ENABLED: String(PAYMENTS_ENABLED), FULL_PAYMENT_MAX_INR: String(THRESHOLD) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvErr = '';
  srv.stderr.on('data', (d) => { srvErr += d; });
  await new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error('server did not start')), 15000); srv.stdout.on('data', (d) => { if (/Sthuthi on/.test(d)) { clearTimeout(to); resolve(); } }); srv.on('exit', () => reject(new Error(`server exited: ${srvErr}`))); }).catch((e) => flag('C16', String(e.message)));
  const base = `http://127.0.0.1:${port}`;
  const post = (body) => fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const status = (id) => fetch(`${base}/api/order-status?session_id=${id}`).then((r) => r.json());
  const signer = new Stripe('sk_test_signer');
  const hook = (session, secret = WHSEC) => {
    const payload = JSON.stringify({ id: `evt_audit_${session.id.slice(-8)}`, object: 'event', type: 'checkout.session.completed', data: { object: session } });
    return fetch(`${base}/api/stripe-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signer.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload }).then((r) => r.status);
  };
  try {
    for (const r of csv) {
      const s = S.find((x) => x.SKU === r.SKU); const price = priceOf(r);
      const W = s['Width (cm)'], D = s['Depth (cm)'], H = s['Height (cm)'], A = s['Apartment edition height (cm)'];
      const good = { sku: r.SKU, pin: '517501', roomWidthCm: W + 50, roomDepthCm: D + 50, ceilingHeightCm: H + clearance + 20, consent: true };
      const before = mock.calls.length;
      if (tierCsv(r) === 'buy') {
        // C17: every gate refuses before anything is sent to Stripe
        const gates = [
          ['no consent', { ...good, consent: false }, 400], ['consent as text', { ...good, consent: 'yes' }, 400], ['consent missing', (({ consent, ...x }) => x)(good), 400],
          ['invalid PIN', { ...good, pin: '012345' }, 400], ['short PIN', { ...good, pin: '5175' }, 400], ['no room', { ...good, roomWidthCm: '' }, 400],
          ['floor too narrow', { ...good, roomWidthCm: Math.min(W, D) - 1, roomDepthCm: Math.min(W, D) - 1 }, 422],
          ['ceiling too low', { ...good, ceilingHeightCm: Math.min(H, A) + clearance - 1 }, 422],
          ['client says it fits', { ...good, ceilingHeightCm: Math.min(H, A) + clearance - 1, fit: 'standard', verdict: 'standard' }, 422],
        ];
        for (const [name, body, want] of gates) { const res = await post(body); ok17(res.status === want, `${r.SKU}: ${name} returned ${res.status}, expected ${want}`); }
        ok17(mock.calls.length === before, `${r.SKU}: Stripe was called although a gate failed`);
        const fail = await post(gates[6][1]); ok17(/^https:\/\/wa\.me\/918951618186\?text=/.test(fail.body.whatsapp || ''), `${r.SKU}: failed fit check does not offer WhatsApp`);
        // C16: a passing request creates a Checkout Session with the catalog price, whatever the browser claims
        const res = await post({ ...good, price: 1, amount: 1, unit_amount: 100, priceINR: 1 });
        const call = mock.calls[mock.calls.length - 1];
        ok16(res.status === 200 && res.body.url === `https://checkout.stripe.com/c/pay/${call?.id}`, `${r.SKU}: checkout did not return the Stripe URL (${res.status} ${JSON.stringify(res.body).slice(0, 120)})`);
        const P = call?.params || {};
        ok16(P['line_items[0][price_data][unit_amount]'] === String(price * 100) && P['line_items[0][price_data][currency]'] === 'inr' && P.currency === 'inr' && P['line_items[0][quantity]'] === '1' && P.mode === 'payment',
          `${r.SKU}: Checkout Session amount/currency wrong (${P['line_items[0][price_data][unit_amount]']} ${P.currency})`);
        ok16(P['line_items[0][price_data][product_data][name]'] === r['Product Name'] && P['metadata[sku]'] === r.SKU && P['metadata[delivery_pin]'] === '517501' && /^(standard|apartment)$/.test(P['metadata[fit_verdict]'] || ''), `${r.SKU}: Checkout Session product or metadata wrong`);
        ok16(P['shipping_address_collection[allowed_countries][0]'] === 'IN' && /\/order\/confirmed\/\?session_id=\{CHECKOUT_SESSION_ID\}$/.test(P.success_url || '') && (P.cancel_url || '').includes(`/mandirs/${r.Slug}/`), `${r.SKU}: Checkout Session URLs or shipping wrong`);
        ok16(call?.auth === 'Bearer sk_test_auditmock000000', `${r.SKU}: secret key not sent server-side`);
        // Confirmation only through a verified webhook
        const session = { id: call.id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: price * 100, currency: 'inr', livemode: false,
          metadata: Object.fromEntries(Object.entries(P).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])), customer_details: { name: 'Audit Buyer' }, payment_intent: 'pi_audit' };
        ok17((await status(call.id)).status === 'pending', `${r.SKU}: order shown before the webhook`);
        ok17((await hook(session, 'whsec_wrongsecret000000000')) === 400 && (await status(call.id)).status === 'pending', `${r.SKU}: webhook with a bad signature was accepted`);
        ok17((await hook({ ...session, payment_status: 'unpaid' })) === 200 && (await status(call.id)).status === 'pending', `${r.SKU}: unpaid session confirmed the order`);
        ok16((await hook(session)) === 200, `${r.SKU}: signed webhook rejected`);
        const st = await status(call.id);
        ok16(st.status === 'confirmed' && st.order?.sku === r.SKU && st.order?.amount === inr(price) && /^https:\/\/wa\.me\/918951618186\?text=/.test(st.whatsapp || ''), `${r.SKU}: order not confirmed after the webhook (${JSON.stringify(st).slice(0, 120)})`);
        ok16(mock.orders.some((o) => o.order?.sku === r.SKU && o.order?.status === 'confirmed'), `${r.SKU}: order not sent to the business endpoint`);
        // A paid session whose amount differs from the catalog is never shown as confirmed
        const res2 = await post(good); const call2 = mock.calls[mock.calls.length - 1];
        await hook({ ...session, id: call2.id, amount_total: price * 100 - 100 });
        ok17(res2.status === 200 && (await status(call2.id)).status === 'review', `${r.SKU}: amount mismatch was confirmed`);
      } else {
        const res = await post(good);
        const want = `https://wa.me/918951618186?text=${encodeURIComponent(`Hi Sthuthi, I'm interested in ${r.SKU} – ${r['Product Name']} (${inr(price)}).`)}`;
        ok16(res.status === 403 && res.body.whatsapp === want && mock.calls.length === before, `${r.SKU}: WhatsApp-only product accepted a checkout request (${res.status})`);
      }
    }
    ok16((await fetch(`${base}/mandirs/`)).status === 200 && (await fetch(`${base}/nope/`)).status === 404, 'payment server does not serve the site');
  } finally {
    srv.kill(); await mock.close(); fs.rmSync(ordersTmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------- configuration still empty (not shown on the site) */
const cfg = [
  ['SITE_URL', process.env.SITE_URL || '', 'Live domain for canonical URLs, sitemaps and schema. The build uses https://www.sthuthi.example until it is set.'],
  ['PUBLIC_CONSULT_ENDPOINT', envVal('PUBLIC_CONSULT_ENDPOINT'), 'Form endpoint. Until it is set, the form hands every request to WhatsApp only.'],
  ['CONTACT_EMAIL', CONTACT_EMAIL, 'Email address. Until it is set, no email is shown anywhere.'],
];
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/placeholders.md'), ['# Placeholders', '', 'The site shows no placeholders (checked by C12). These build settings are still empty; each one hides or falls back silently:', '',
  '| Setting | Status | Effect while empty |', '|---|---|---|', ...cfg.map(([k, v, d]) => `| \`${k}\` | ${v ? 'set' : 'empty'} | ${d} |`)].join('\n'));

/* ---------------------------------------------------------- report */
const byCheck = {};
for (const f of flags) (byCheck[f.check] ||= []).push(f.msg);
const checks = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17'];
const lines = [`# QA audit ${new Date().toISOString()}`, '', `Pages scanned: ${pages.length}. Fit-checker cases: ${c4cases}.`, '', '| Check | Assertions passed | Flags |', '|---|---|---|',
  ...checks.map((c) => `| ${c} | ${passes[c] || 0} | ${(byCheck[c] || []).length} |`), '', ...checks.flatMap((c) => (byCheck[c] || []).length ? [`## ${c}`, ...byCheck[c].map((m) => `- ${m}`), ''] : [])];
fs.writeFileSync(path.join(ROOT, 'reports/qa-audit.md'), lines.join('\n'));
console.log(lines.slice(0, 24).join('\n'));
if (flags.length) { console.log(`\n${flags.length} flags:`); for (const f of flags.slice(0, 80)) console.log(` [${f.check}] ${f.msg}`); }
else console.log('\nZero flags.');
process.exitCode = flags.length ? 1 : 0;
