#!/usr/bin/env node
/**
 * Sthuthi data pipeline.
 *
 * Reads the two owner-maintained sources and produces one joined data model:
 *   data/mandir-catalogue.csv            -> names, prices, collections, descriptions, inclusions, SEO
 *   data/Sthuthi_Mandir_Measurements.xlsx -> every dimension, weight, idol, kit item and installation standard
 *   data/Products/<slug>/*.png            -> product images, matched to SKU by folder slug
 *   data/taxonomy.json                    -> classification rules only (deity names, material keywords); no product facts
 *   data/image-overrides.json             -> optional: mark an image as a real photograph, change order or alt text
 *   data/owner-resolutions.json           -> owner-confirmed fixes for CSV/workbook conflicts (applied before every check)
 *
 * Outputs:
 *   src/generated/catalog.json   (consumed by every Astro page)
 *   public/img/mandirs/...       (responsive AVIF + WebP)
 *   reports/data-audit.json + reports/data-audit.md (join results, conflicts, validation)
 *
 * Nothing about any product is typed into the site code. Change the CSV or workbook and re-run `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import sanitizeHtml from 'sanitize-html';
import { cmToFtIn, slugify } from '../src/lib/units.js';
import { loadResolutions, applyCsvResolutions, applyWorkbookResolutions } from './lib/resolutions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.STHUTHI_DATA_DIR || path.join(ROOT, 'data');
const OUT_JSON = path.join(ROOT, 'src/generated/catalog.json');
const IMG_OUT = path.join(ROOT, 'public/img/mandirs');
const REPORTS = process.env.STHUTHI_REPORTS_DIR || path.join(ROOT, 'reports');
const IMG_WIDTHS = [160, 400, 720, 1080];
const SKIP_IMAGES = process.argv.includes('--skip-images');

const audit = {
  generatedAt: new Date().toISOString(),
  errors: [],
  warnings: [],
  conflicts: [],
  sanitised: [],
  join: {},
  images: { matched: [], unmatchedFiles: [], skusWithoutImages: [], countMismatch: [], lowQuality: [], kind: {} },
  validation: [],
  resolutions: [],
};
const err = (m) => audit.errors.push(m);
const warn = (m) => audit.warnings.push(m);
const conflict = (sku, field, csv, wb, note) => audit.conflicts.push({ sku, field, csv, workbook: wb, note });

/* ------------------------------------------------------------------ CSV */
const csvFile = fs.readdirSync(DATA).find((f) => f.toLowerCase().endsWith('.csv'));
if (!csvFile) throw new Error('No CSV found in data/');
const rows = parse(fs.readFileSync(path.join(DATA, csvFile), 'utf8'), {
  columns: true, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true,
});

// Column resolution by meaning, so a re-ordered or lightly renamed column still works.
const headers = Object.keys(rows[0] || {});
const col = (re, required = true) => {
  const h = headers.find((x) => re.test(x));
  if (!h && required) err(`CSV: no column matching ${re}`);
  return h;
};
const C = {
  sku: col(/^sku$/i), name: col(/product name/i), slug: col(/^slug$/i), collection: col(/^collection$/i),
  type: col(/product type/i), inspired: col(/inspired by/i), arch: col(/architecture/i),
  material: col(/primary material/i), accents: col(/accents/i), deities: col(/deities/i),
  pooja: col(/pooja items/i), custom: col(/customis|customiz/i), indicative: col(/indicative dimensions/i, false),
  availability: col(/availability/i), priceINR: col(/price inr/i), priceUSD: col(/price usd/i, false),
  short: col(/short description/i), long: col(/long description/i), features: col(/key features/i),
  focus: col(/focus keyword/i, false), secondary: col(/secondary keywords/i, false), tags: col(/^tags$/i, false),
  metaTitle: col(/meta title/i, false), metaDesc: col(/meta description/i, false),
  altTexts: col(/product image alt/i, false), featuredAlt: col(/featured image alt/i, false), imageCount: col(/image count/i, false),
};

/* ------------------------------------------------------------- WORKBOOK */
const xlsxFile = fs.readdirSync(DATA).find((f) => f.toLowerCase().endsWith('.xlsx'));
if (!xlsxFile) throw new Error('No measurements workbook (.xlsx) found in data/');
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.join(DATA, xlsxFile));

/* ------------------------------------------------- OWNER RESOLUTIONS */
const RES = loadResolutions(DATA);
audit.resolutions = [...applyCsvResolutions(rows, RES), ...applyWorkbookResolutions(wb, RES)];
for (const r of audit.resolutions) if (!['applied', 'already in source'].includes(r.status)) warn(`Owner resolution for ${r.sku} (${r.column}) could not be applied: ${r.status}`);

const cellVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? null;           // formula with cached result
    if ('formula' in v || 'sharedFormula' in v) return null; // formula without cache -> recomputed below
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v.toISOString();
    if ('text' in v) return v.text;
  }
  return v;
};
function sheetRows(re) {
  const ws = wb.worksheets.find((w) => re.test(w.name));
  if (!ws) { err(`Workbook: no sheet matching ${re}`); return []; }
  const out = [];
  let hdr = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values.slice(1).map(cellVal);
    if (!hdr) { hdr = vals.map((x) => String(x ?? '').trim()); return; }
    if (vals.every((x) => x === null || x === '')) return;
    const o = {};
    hdr.forEach((h, i) => { if (h) o[h] = typeof vals[i] === 'string' ? vals[i].trim() : vals[i] ?? null; });
    out.push(o);
  });
  return out;
}
const pick = (o, re) => { const k = Object.keys(o).find((x) => re.test(x)); return k ? o[k] : null; };
const num = (x) => (x === null || x === '' || x === undefined ? null : Number(x));

/* Installation standards: located by meaning of the label, values come from the sheet. */
const stdRows = sheetRows(/installation standards/i);
const findStd = (re) => stdRows.find((r) => re.test(String(pick(r, /^standard$/i) || '')));
const stdVal = (re, label) => {
  const r = findStd(re);
  if (!r) { err(`Installation Standards: missing "${label}"`); return null; }
  return { value: pick(r, /^value$/i), unit: pick(r, /^unit$/i), detail: pick(r, /^detail$/i), label: pick(r, /^standard$/i) };
};
const standards = {
  floorLoad: stdVal(/floor design load/i, 'Residential floor design load'),
  ceilingClearance: stdVal(/ceiling clearance/i, 'Ceiling clearance above tallest point'),
  occupancy: stdVal(/occupancy/i, 'Design occupancy'),
  occupantWeight: stdVal(/occupant weight/i, 'Average occupant weight'),
  signOffWeight: stdVal(/structural sign-off/i, 'Cabinet weight requiring structural sign-off'),
  cabinInteriorHeight: stdVal(/interior clear height/i, 'Walk-in cabin interior clear height'),
  cabinDoor: stdVal(/door opening/i, 'Walk-in cabin door opening'),
  moduleWood: stdVal(/module.*wood/i, 'Max single transport module — wood'),
  moduleStone: stdVal(/module.*(stone|marble)/i, 'Max single transport module — stone/marble'),
  aptMaxHeight: stdVal(/apartment.*maximum height/i, 'Apartment-variant maximum height'),
};
const STD = Object.fromEntries(Object.entries(standards).map(([k, v]) => [k, v ? num(v.value) ?? v.value : null]));

const readMe = (() => {
  const ws = wb.worksheets.find((w) => /read ?me/i.test(w.name));
  const lines = [];
  ws?.eachRow((row) => { const v = cellVal(row.values[1]); if (v) lines.push(String(v)); });
  return lines;
})();

/* Structure sizes */
const structRows = sheetRows(/structure sizes/i);
const idolRows = sheetRows(/idol sizes/i);
const kitRows = sheetRows(/pooja kit/i);

const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8'));
const imageOverrides = fs.existsSync(path.join(DATA, 'image-overrides.json'))
  ? JSON.parse(fs.readFileSync(path.join(DATA, 'image-overrides.json'), 'utf8')) : {};

/* ---------------------------------------------------- helper functions */
const isWalkIn = (type) => /walk-in/i.test(type || '');
const splitList = (s, sep = /\s*\|\s*/) => (s ? String(s).split(sep).map((x) => x.trim()).filter(Boolean) : []);

// "replica" must never appear on the site (temple designs are "inspired by"). SEO fields in the CSV use it,
// so they are rewritten here and every rewrite is logged for the owner.
function noReplica(s, sku, field) {
  if (!s || !/replica/i.test(s)) return s;
  const out = s
    .replace(/\btemple\s+replica\b/gi, (m) => (m[0] === 'T' ? 'Temple-Inspired' : 'temple-inspired'))
    .replace(/\s*\breplicas?\b/gi, (m) => (/[A-Z]/.test(m.trim()[0]) ? ' Inspired' : ' inspired'));
  audit.sanitised.push({ sku, field, from: s, to: out });
  return out;
}

const HTML_OPTS = {
  allowedTags: ['p', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'br'],
  allowedAttributes: {},
};

function deitiesFromFigure(fig) {
  const f = fig.toLowerCase();
  const out = [];
  for (const d of taxonomy.deities) {
    if (d.match.some((m) => new RegExp(`\\b${m}`, 'i').test(f))) out.push(d.name);
  }
  return out;
}
function materialTags(text) {
  return taxonomy.materials.filter((m) => m.match.some((x) => new RegExp(`\\b${x}`, 'i').test(text))).map((m) => m.name);
}

function computeFloorLoad(s) {
  const occ = isWalkIn(s.type) ? (STD.occupancy || 0) * (STD.occupantWeight || 0) : 0;
  return Math.round((s.weightMax + occ) / s.footprintM2);
}
function computeInstall(s) {
  if (isWalkIn(s.type)) return s.floorLoad > STD.floorLoad ? 'Structural sign-off at installation' : 'Standard RCC floor';
  return s.weightMax > STD.signOffWeight ? 'Structural sign-off at installation' : 'Standard RCC floor';
}

/* ------------------------------------------------------------- JOIN */
const csvSkus = rows.map((r) => r[C.sku]);
const wbSkus = structRows.map((r) => pick(r, /^sku$/i));
const dup = (a) => a.filter((x, i) => a.indexOf(x) !== i);
if (dup(csvSkus).length) err(`Duplicate SKUs in CSV: ${dup(csvSkus).join(', ')}`);
if (dup(wbSkus).length) err(`Duplicate SKUs in Structure Sizes: ${dup(wbSkus).join(', ')}`);
const slugs = rows.map((r) => r[C.slug]);
if (dup(slugs).length) err(`Duplicate slugs in CSV: ${dup(slugs).join(', ')}`);
audit.join = {
  csvCount: csvSkus.length,
  workbookCount: wbSkus.length,
  inCsvNotWorkbook: csvSkus.filter((s) => !wbSkus.includes(s)),
  inWorkbookNotCsv: wbSkus.filter((s) => !csvSkus.includes(s)),
  idolSkusNotInCsv: [...new Set(idolRows.map((r) => pick(r, /^sku$/i)))].filter((s) => !csvSkus.includes(s)),
  kitSkusNotInCsv: [...new Set(kitRows.map((r) => pick(r, /^sku$/i)))].filter((s) => !csvSkus.includes(s)),
  csvSkusWithoutIdols: csvSkus.filter((s) => !idolRows.some((r) => pick(r, /^sku$/i) === s)),
  csvSkusWithoutKit: csvSkus.filter((s) => !kitRows.some((r) => pick(r, /^sku$/i) === s)),
};
for (const k of ['inCsvNotWorkbook', 'csvSkusWithoutIdols', 'csvSkusWithoutKit']) {
  if (audit.join[k].length) warn(`${k}: ${audit.join[k].join(', ')}`);
}
if (audit.join.inWorkbookNotCsv.length) warn(`Workbook SKUs not in CSV (no page will be built): ${audit.join.inWorkbookNotCsv.join(', ')}`);

// Collections: in CSV order of first appearance.
const collections = [];
for (const r of rows) {
  const name = r[C.collection];
  if (!collections.find((c) => c.name === name)) {
    collections.push({ name, slug: slugify(name.replace(/\s+collection$/i, '')), shortName: name.replace(/\s+collection$/i, '') });
  }
}

const range = (label, v, lo, hi, sku) => {
  if (v === null || Number.isNaN(v)) { audit.validation.push({ sku, field: label, issue: 'empty' }); return; }
  if (v < lo || v > hi) audit.validation.push({ sku, field: label, issue: `out of expected range ${lo}–${hi}`, value: v });
};

const products = [];
for (const r of rows) {
  const sku = r[C.sku];
  for (const [k, h] of Object.entries(C)) if (h && (r[h] === undefined || r[h] === '') && !['indicative', 'priceUSD', 'secondary', 'tags'].includes(k)) {
    audit.validation.push({ sku, field: h, issue: 'empty in CSV' });
  }
  const sr = structRows.find((x) => pick(x, /^sku$/i) === sku);
  if (!sr) { err(`${sku}: missing from Structure Sizes – page will be built without specifications`); }

  /* structure */
  let structure = null;
  if (sr) {
    const s = {
      nameWb: pick(sr, /^product$/i), collectionWb: pick(sr, /^collection$/i), type: pick(sr, /^type$/i),
      materialWb: pick(sr, /main material/i),
      widthCm: num(pick(sr, /^width \(cm\)/i)), depthCm: num(pick(sr, /^depth \(cm\)/i)), heightCm: num(pick(sr, /^height \(cm\)/i)),
      aptHeightCm: num(pick(sr, /apartment edition height/i)),
      niche: { w: num(pick(sr, /niche width/i)), d: num(pick(sr, /niche depth/i)), h: num(pick(sr, /niche clear height/i)) },
      altarCm: num(pick(sr, /altar/i)), door: pick(sr, /door opening/i),
      weightMin: num(pick(sr, /weight min/i)), weightMax: num(pick(sr, /weight max/i)),
      notes: pick(sr, /design notes/i),
    };
    // Derived values are recomputed from the raw cm figures and the standards, then checked against the workbook.
    s.ftIn = { w: cmToFtIn(s.widthCm), d: cmToFtIn(s.depthCm), h: cmToFtIn(s.heightCm) };
    s.footprintM2 = Math.round((s.widthCm * s.depthCm) / 100) / 100;
    s.minCeilingCm = s.heightCm + STD.ceilingClearance;
    s.hasApartmentEdition = s.aptHeightCm !== null && s.aptHeightCm < s.heightCm;
    s.aptMinCeilingCm = s.hasApartmentEdition ? s.aptHeightCm + STD.ceilingClearance : null;
    s.floorLoad = computeFloorLoad(s);
    s.installRequirement = computeInstall(s);
    s.structuralSignOff = /sign-off/i.test(s.installRequirement);
    s.walkIn = isWalkIn(s.type);

    const wbChecks = [
      ['Width (ft-in)', pick(sr, /width \(ft-in\)/i), s.ftIn.w],
      ['Depth (ft-in)', pick(sr, /depth \(ft-in\)/i), s.ftIn.d],
      ['Height (ft-in)', pick(sr, /height \(ft-in\)/i), s.ftIn.h],
      ['Footprint (m²)', num(pick(sr, /footprint/i)), s.footprintM2],
      ['Min clear ceiling needed (cm)', num(pick(sr, /min clear ceiling/i)), s.minCeilingCm],
      ['Floor load incl. occupants (kg/m²)', num(pick(sr, /floor load/i)), s.floorLoad],
      ['Installation requirement', pick(sr, /installation requirement/i), s.installRequirement],
    ];
    for (const [field, wbv, ours] of wbChecks) {
      if (wbv === null || wbv === undefined) { warn(`${sku}: workbook has no cached value for ${field}; using computed ${ours}`); continue; }
      if (String(wbv) !== String(ours)) err(`${sku}: ${field} workbook=${wbv} computed=${ours}`);
    }
    range('Width (cm)', s.widthCm, 40, 400, sku); range('Depth (cm)', s.depthCm, 30, 400, sku); range('Height (cm)', s.heightCm, 100, 400, sku);
    range('Niche width', s.niche.w, 20, s.widthCm, sku); range('Niche depth', s.niche.d, 20, s.depthCm, sku); range('Niche height', s.niche.h, 20, s.heightCm, sku);
    range('Altar height', s.altarCm, 0, 150, sku); range('Weight min', s.weightMin, 10, 5000, sku); range('Weight max', s.weightMax, s.weightMin, 5000, sku);
    if (s.hasApartmentEdition && STD.aptMaxHeight && s.aptHeightCm > STD.aptMaxHeight) err(`${sku}: apartment edition ${s.aptHeightCm} cm exceeds standard ${STD.aptMaxHeight} cm`);
    if (s.walkIn && s.niche.h !== STD.cabinInteriorHeight) warn(`${sku}: cabin interior height ${s.niche.h} differs from standard ${STD.cabinInteriorHeight}`);

    if (s.nameWb && s.nameWb !== r[C.name]) conflict(sku, 'Product name', r[C.name], s.nameWb, 'CSV name is used on the site.');
    if (s.collectionWb && !r[C.collection].toLowerCase().startsWith(String(s.collectionWb).toLowerCase())) conflict(sku, 'Collection', r[C.collection], s.collectionWb, 'CSV collection is used.');
    if (s.materialWb && s.materialWb.toLowerCase() !== r[C.material].toLowerCase()) {
      conflict(sku, 'Material', r[C.material], s.materialWb, 'Wording differs. CSV "Primary Material" is shown as the material; workbook "Main material" is not displayed.');
    }
    structure = s;
  }

  /* idols */
  const figs = idolRows.filter((x) => pick(x, /^sku$/i) === sku).map((x) => {
    const f = {
      set: pick(x, /^set$/i) || 'Single', figure: pick(x, /figure/i), material: pick(x, /^material$/i), form: pick(x, /posture|form/i),
      h: num(pick(x, /^height \(cm\)/i)), w: num(pick(x, /^width \(cm\)/i)), d: num(pick(x, /depth/i)),
      weightMin: num(pick(x, /weight min/i)), weightMax: num(pick(x, /weight max/i)),
      placement: pick(x, /^placement$/i), offset: num(pick(x, /offset/i)), notes: pick(x, /notes/i),
    };
    f.hIn = Math.round((f.h / 2.54) * 10) / 10;
    const wbIn = num(pick(x, /height \(in\)/i));
    if (wbIn !== null && wbIn !== f.hIn) err(`${sku} ${f.figure}: idol height in workbook=${wbIn} computed=${f.hIn}`);
    if (structure) {
      f.clearance = structure.niche.h - f.offset - f.h;
      const wbClear = num(pick(x, /clearance above/i));
      if (wbClear !== null && wbClear !== f.clearance) err(`${sku} ${f.figure}: clearance workbook=${wbClear} computed=${f.clearance}`);
      if (f.clearance < 10) err(`${sku} ${f.figure}: too tall for niche (clearance ${f.clearance} cm)`);
    }
    range(`Idol ${f.figure} height`, f.h, 2, 120, sku);
    f.deities = deitiesFromFigure(`${f.figure} ${f.form || ""}`);
    return f;
  });
  const setOrder = ['Single', 'Shown', 'Alternate'];
  const idolSets = [...new Set(figs.map((f) => f.set))]
    .sort((a, b) => setOrder.indexOf(a) - setOrder.indexOf(b))
    .map((key) => ({
      key,
      label: key === 'Shown' ? 'Set shown in the visualisations' : key === 'Alternate' ? 'Alternate deity set' : 'Idols included',
      figures: figs.filter((f) => f.set === key),
    }));

  /* kit */
  const kit = kitRows.filter((x) => pick(x, /^sku$/i) === sku).map((x) => ({
    item: pick(x, /^item$/i), qty: num(pick(x, /^qty$/i)), material: pick(x, /^material$/i),
    h: num(pick(x, /^height/i)), dia: num(pick(x, /diameter|width/i)), len: num(pick(x, /length|depth/i)), notes: pick(x, /notes/i),
  }));

  /* deity classification (from idol data, using the taxonomy only for naming) */
  const allDeities = [...new Set(figs.flatMap((f) => f.deities))];
  const principal = (set) => [...new Set(set.figures.flatMap((f) => f.deities))].filter((d) => !taxonomy.attendants.includes(d));
  const primarySet = idolSets.find((s) => s.key !== 'Alternate') || idolSets[0];
  const principalPrimary = primarySet ? principal(primarySet) : [];
  for (const f of figs) if (!f.deities.length && !taxonomy.nonDeityElements.some((e) => new RegExp(e, 'i').test(f.figure))) {
    warn(`${sku}: idol "${f.figure}" not classified by taxonomy.json (add it to deities or nonDeityElements)`);
  }

  // Deity list conflict check: each principal deity in the workbook must be named in the CSV deity text, and vice versa.
  const csvDeityText = `${r[C.deities]} ${r[C.name]}`;
  for (const d of [...new Set(figs.flatMap((f) => f.deities))]) {
    const t = taxonomy.deities.find((x) => x.name === d);
    if (!t.match.some((m) => new RegExp(`\\b${m}`, 'i').test(csvDeityText))) conflict(sku, 'Deities', r[C.deities], d, `Workbook lists ${d}; CSV deity text does not name it.`);
  }
  for (const t of taxonomy.deities) {
    if (t.match.some((m) => new RegExp(`\\b${m}`, 'i').test(r[C.deities])) && !allDeities.includes(t.name)) {
      conflict(sku, 'Deities', r[C.deities], figs.map((f) => f.figure).join('; '), `CSV names ${t.name}; workbook idol sheet has no matching figure.`);
    }
  }

  // Finish conflicts: the finish word nearest before an element in the CSV text vs the workbook material.
  const csvFinishText = `${r[C.deities]} ; ${r[C.accents]} ; ${r[C.features]}`.toLowerCase();
  const ELEMENTS = ['yoni', 'naga', 'cobra', 'nandi', 'linga', 'mukha', 'prabhavali', 'jaladhari'];
  const FINISH = /(gold-plated|silver-plated|black stone|brass|bronze|marble)/g;
  for (const el of ELEMENTS) {
    const wbFigs = figs.filter((f) => new RegExp(`\\b${el}`, 'i').test(f.figure));
    if (!wbFigs.length) continue;
    for (const m of csvFinishText.matchAll(new RegExp(`\\b${el}`, 'g'))) {
      let seg = csvFinishText.slice(Math.max(0, m.index - 40), m.index);
      seg = seg.split(/[,;|.]| with | facing | under | on | in /).pop();
      const fins = [...seg.matchAll(FINISH)];
      if (!fins.length) continue;
      const last = fins[fins.length - 1];
      const between = seg.slice(last.index + last[0].length);
      const otherEl = ELEMENTS.filter((e) => e !== el).some((e) => new RegExp(`\\b${e}`).test(between));
      if (otherEl && !/\band\s*$/.test(between)) continue;
      const fin = last[1];
      if (!wbFigs.some((f) => (f.material || '').toLowerCase().includes(fin))) {
        conflict(sku, `Idol finish (${el})`, `${fin} ${el}`, wbFigs.map((f) => `${f.figure}: ${f.material}`).join('; '),
          'Not resolved automatically. The workbook material is shown in the Idols table; please confirm with the workshop.');
      }
    }
  }
  // Altar tiers: "two-tier"/"three-tier" in the CSV vs the tiers used in the workbook idol placements.
  const tierWord = (r[C.features] + ' ' + r[C.long]).match(/\b(two|three|four)-tier\b/i);
  const wbTiers = new Set(figs.map((f) => (f.placement || '').match(/tier\s*(\d)/i)?.[1]).filter(Boolean));
  if (tierWord && wbTiers.size) {
    const n = { two: 2, three: 3, four: 4 }[tierWord[1].toLowerCase()];
    if (n !== wbTiers.size) conflict(sku, 'Altar tiers', tierWord[0], `${wbTiers.size} tiers in idol placements`, 'CSV wording is kept in the description; idol placements follow the workbook.');
  }
  // Pooja kit materials: "<material> <item>" in the CSV pooja text vs the kit sheet.
  const poojaText = (r[C.pooja] || '').toLowerCase();
  for (const m of poojaText.matchAll(/\b(brass|copper|silver-plated|gold-plated|bronze)\s+([a-z]+)/g)) {
    const stem = m[2].replace(/(es|s)$/, '').slice(0, 5);
    const items = kit.filter((k) => k.item.toLowerCase().includes(stem));
    if (items.length && !items.some((k) => k.material.toLowerCase().includes(m[1]))) {
      conflict(sku, 'Pooja kit material', m[0], items.map((k) => `${k.item}: ${k.material}`).join('; '), 'Kit table follows the workbook.');
    }
  }

  /* SEO + text */
  const seo = {
    title: noReplica(r[C.metaTitle], sku, 'Meta Title') || `${r[C.name]} | Sthuthi`,
    description: noReplica(r[C.metaDesc], sku, 'Meta Description') || r[C.short],
    focusKeyword: noReplica(r[C.focus], sku, 'Focus Keyword'),
    secondary: splitList(noReplica(r[C.secondary], sku, 'Secondary Keywords'), /\s*,\s*/),
  };
  const tags = splitList(noReplica(r[C.tags], sku, 'Tags'), /\s*,\s*/);
  for (const f of ['name', 'short', 'long', 'features', 'material', 'accents', 'deities', 'inspired', 'arch']) {
    if (/replica/i.test(r[C[f]] || '')) err(`${sku}: "${C[f]}" contains the word replica – must be reworded in the CSV`);
  }
  if (r[C.metaTitle] && r[C.metaTitle].length > 65) audit.validation.push({ sku, field: 'Meta Title', issue: `length ${r[C.metaTitle].length} > 65` });
  if (r[C.metaDesc] && r[C.metaDesc].length > 160) audit.validation.push({ sku, field: 'Meta Description', issue: `length ${r[C.metaDesc].length} > 160` });

  // Long description is rendered exactly, except the "Size:" line, which repeats the CSV's indicative
  // dimensions. Dimensions are owned by the workbook, so that one line is removed and logged.
  let longHtml = sanitizeHtml(r[C.long] || '', HTML_OPTS);
  const sizeLi = longHtml.match(/<li><strong>Size:<\/strong>[^<]*<\/li>/i);
  if (sizeLi) longHtml = longHtml.replace(sizeLi[0], '');
  if (C.indicative && r[C.indicative] && structure) {
    conflict(sku, 'Dimensions', r[C.indicative],
      `${structure.widthCm} W × ${structure.depthCm} D × ${structure.heightCm} H cm (${structure.ftIn.w} × ${structure.ftIn.d} × ${structure.ftIn.h})`,
      'CSV "Indicative Dimensions" (also repeated in the long description) differs from the workbook. Workbook values are shown; the CSV size line is not displayed.');
  }

  const price = num(String(r[C.priceINR]).replace(/[^\d.]/g, ''));
  range('Price INR', price, 10000, 100000000, sku);
  const ivoryText = [r[C.name], r[C.material], r[C.accents], r[C.short], r[C.long], r[C.features], structure?.materialWb, structure?.notes].join(' ');

  products.push({
    sku, slug: r[C.slug], name: r[C.name],
    collection: collections.find((c) => c.name === r[C.collection]).slug,
    collectionName: r[C.collection],
    productType: r[C.type], inspiredBy: r[C.inspired], architecture: r[C.arch], material: r[C.material], accents: r[C.accents],
    deitiesText: r[C.deities], poojaText: r[C.pooja], customisation: r[C.custom], availability: r[C.availability],
    priceINR: price, priceUSD: C.priceUSD ? num(String(r[C.priceUSD]).replace(/[^\d.]/g, '')) : null,
    short: r[C.short], longHtml, keyFeatures: splitList(r[C.features]), seo, tags,
    csvImageCount: C.imageCount ? num(r[C.imageCount]) : null,
    csvAlts: splitList(r[C.altTexts]),
    structure, idolSets, kit,
    deities: allDeities,
    principalDeities: principalPrimary,
    multiDeity: principalPrimary.length > 1 || idolSets.length > 1,
    configurable: idolSets.length > 1,
    materials: materialTags(`${r[C.material]}`),
    ivory: /\bivory\b/i.test(ivoryText),
    templeInspired: Boolean(r[C.inspired]),
  });
}

/* --------------------------------------------------------------- IMAGES */
const tokens = (s) => new Set(slugify(s).split('-').filter((t) => t.length > 2));
function jaccard(a, b) { const i = [...a].filter((x) => b.has(x)).length; return i / (a.size + b.size - i || 1); }

const productDirs = fs.existsSync(path.join(DATA, 'Products')) ? fs.readdirSync(path.join(DATA, 'Products')).filter((d) => !d.startsWith('.')) : [];
for (const d of productDirs) if (!products.find((p) => p.slug === d)) audit.images.unmatchedFiles.push(`${d}/ (folder matches no SKU slug)`);

fs.mkdirSync(IMG_OUT, { recursive: true });
let encoded = 0;
for (const p of products) {
  // Folder match: exact slug, else a folder whose name contains the SKU code or best token overlap with the name.
  let dir = productDirs.find((d) => d === p.slug)
    || productDirs.find((d) => d.toLowerCase().includes(p.sku.toLowerCase()))
    || productDirs.map((d) => [d, jaccard(tokens(d), tokens(p.name))]).sort((a, b) => b[1] - a[1]).find(([, s]) => s > 0.6)?.[0];
  if (!dir) { audit.images.skusWithoutImages.push(p.sku); p.images = []; continue; }
  const files = fs.readdirSync(path.join(DATA, 'Products', dir)).filter((f) => /\.(png|jpe?g|webp|avif|tiff?)$/i.test(f)).sort();
  if (p.csvImageCount !== null && p.csvImageCount !== files.length) {
    audit.images.countMismatch.push({ sku: p.sku, csv: p.csvImageCount, folder: files.length });
  }
  const nameTok = tokens(p.name);
  // Alt texts from the CSV are "<Product> - <view>"; match each file to the most similar alt by view tokens.
  const altViews = p.csvAlts.map((a, i) => ({ i, alt: a, tok: new Set([...tokens(a.split(' - ').slice(1).join(' ') || a)].filter((t) => !nameTok.has(t))) }));
  const used = new Set();
  const scored = files.map((f) => {
    const ftok = new Set([...tokens(f.replace(/\.[a-z]+$/i, ''))].filter((t) => !nameTok.has(t)));
    let best = null;
    for (const a of altViews) { const s = jaccard(ftok, a.tok); if (!best || s > best.s) best = { ...a, s }; }
    return { f, ftok, best };
  }).sort((a, b) => (b.best?.s || 0) - (a.best?.s || 0));
  const imgs = [];
  for (const sc of scored) {
    let alt = null; let order = 999;
    if (sc.best && sc.best.s >= 0.5 && !used.has(sc.best.i)) { used.add(sc.best.i); alt = sc.best.alt; order = sc.best.i; }
    const view = sc.f.replace(/\.[a-z]+$/i, '').replace(new RegExp(`^${p.slug}-?`), '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
    if (!alt) alt = `${p.name} – ${view.charAt(0).toUpperCase()}${view.slice(1)}`;
    const ov = imageOverrides[`${dir}/${sc.f}`] || {};
    imgs.push({ file: sc.f, order: ov.order ?? order, alt: ov.alt || alt.replace(/\s+-\s+/, ' – '), kind: ov.kind || 'render', matchScore: sc.best ? Math.round(sc.best.s * 100) / 100 : 0, view });
  }
  imgs.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
  p.images = [];
  for (const [i, im] of imgs.entries()) {
    const src = path.join(DATA, 'Products', dir, im.file);
    const meta = await sharp(src).metadata();
    const base = `${String(i + 1).padStart(2, '0')}-${slugify(im.view || 'view').slice(0, 60)}`;
    const outDir = path.join(IMG_OUT, p.slug);
    fs.mkdirSync(outDir, { recursive: true });
    const widths = [...IMG_WIDTHS.filter((w) => w < meta.width), meta.width];
    if (!SKIP_IMAGES) {
      for (const w of widths) {
        for (const fmt of ['avif', 'webp']) {
          const out = path.join(outDir, `${base}-${w}.${fmt}`);
          if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) continue;
          const pipe = sharp(src).resize({ width: w, withoutEnlargement: true });
          await (fmt === 'avif' ? pipe.avif({ quality: 52, effort: 4 }) : pipe.webp({ quality: 74 })).toFile(out);
          encoded++;
        }
      }
    }
    if (meta.width < 800 || meta.height < 800) audit.images.lowQuality.push(`${p.sku} ${im.file} (${meta.width}×${meta.height})`);
    audit.images.matched.push({ sku: p.sku, file: `${dir}/${im.file}`, alt: im.alt, altSource: im.matchScore >= 0.5 ? 'CSV' : 'filename', score: im.matchScore, kind: im.kind });
    audit.images.kind[im.kind] = (audit.images.kind[im.kind] || 0) + 1;
    p.images.push({ base: `/img/mandirs/${p.slug}/${base}`, widths, width: meta.width, height: meta.height, alt: im.alt, kind: im.kind });
  }
  if (!p.images.length) audit.images.skusWithoutImages.push(p.sku);
}

/* ---------------------------------------------------------- FACETS */
const deityOptions = taxonomy.deities.map((d) => d.name)
  .filter((n) => !taxonomy.attendants.includes(n) && products.some((p) => p.deities.includes(n)));
const materialOptions = taxonomy.materials.map((m) => m.name).filter((n) => products.some((p) => p.materials.includes(n)));
for (const p of products) if (!p.materials.length) warn(`${p.sku}: material "${p.material}" matches no material in taxonomy.json`);
const prices = products.map((p) => p.priceINR).sort((a, b) => a - b);
// Price bands: edges sit near the quartiles of the actual prices, each moved to the roundest figure
// within ±10 % of that quartile. Nothing here is typed by hand.
const roundest = (lo, hi) => {
  for (const step of [1000000, 500000, 200000, 100000, 50000, 10000, 1000]) {
    const c = Math.ceil(lo / step) * step;
    if (c <= hi) return c;
  }
  return Math.round((lo + hi) / 2);
};
const quart = (f) => prices[Math.min(prices.length - 1, Math.floor(f * prices.length))];
const edges = [...new Set([0.25, 0.5, 0.75].map((f) => roundest(quart(f) * 0.9, quart(f) * 1.1)))].sort((a, b) => a - b);
const priceBands = [];
let lo = 0;
for (const e of edges) { priceBands.push({ min: lo, max: e }); lo = e; }
priceBands.push({ min: lo, max: null });
const st = products.filter((p) => p.structure).map((p) => p.structure);
const minmax = (arr) => [Math.min(...arr), Math.max(...arr)];
const facets = {
  deities: deityOptions,
  materials: materialOptions,
  priceBands: priceBands.filter((b) => products.some((p) => p.priceINR >= b.min && (b.max === null || p.priceINR < b.max))),
  width: minmax(st.map((s) => s.widthCm)),
  depth: minmax(st.map((s) => s.depthCm)),
  height: minmax(st.map((s) => s.heightCm)),
  footprint: minmax(st.map((s) => s.footprintM2)),
  minCeiling: minmax(st.map((s) => (s.hasApartmentEdition ? s.aptMinCeilingCm : s.minCeilingCm))),
  price: minmax(prices),
};

/* Collection summaries, all computed. */
for (const c of collections) {
  const ps = products.filter((p) => p.collection === c.slug);
  const s = ps.filter((p) => p.structure).map((p) => p.structure);
  c.count = ps.length;
  c.skus = ps.map((p) => p.sku);
  c.price = minmax(ps.map((p) => p.priceINR));
  c.width = minmax(s.map((x) => x.widthCm)); c.depth = minmax(s.map((x) => x.depthCm)); c.height = minmax(s.map((x) => x.heightCm));
  c.minCeiling = minmax(s.map((x) => x.minCeilingCm));
  c.apt = s.some((x) => x.hasApartmentEdition) ? minmax(s.filter((x) => x.hasApartmentEdition).map((x) => x.aptHeightCm)) : null;
  c.types = [...new Set(s.map((x) => x.type))];
  c.walkIn = s.every((x) => x.walkIn);
  c.deities = deityOptions.filter((d) => ps.some((p) => p.deities.includes(d)));
  c.signOff = ps.filter((p) => p.structure?.structuralSignOff).map((p) => p.sku);
  c.cover = ps.find((p) => p.images.length >= 3)?.sku || ps[0]?.sku;
}

const catalog = { generatedAt: audit.generatedAt, sources: { csv: csvFile, workbook: xlsxFile }, standards, std: STD, readMe, collections, products, facets };
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(catalog, null, 1));

/* ---------------------------------------------------------- REPORT */
fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, 'data-audit.json'), JSON.stringify(audit, null, 2));
const md = [
  `# Data audit`, `Generated ${audit.generatedAt} from \`${csvFile}\` and \`${xlsxFile}\`.`, '',
  `## Join`, `- CSV SKUs: ${audit.join.csvCount}; workbook structure SKUs: ${audit.join.workbookCount}`,
  ...Object.entries(audit.join).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `- ${k}: ${v.length ? v.join(', ') : 'none'}`), '',
  `## Errors (${audit.errors.length})`, ...audit.errors.map((e) => `- ${e}`), '',
  `## Warnings (${audit.warnings.length})`, ...audit.warnings.map((e) => `- ${e}`), '',
  `## Conflicts between CSV and workbook (${audit.conflicts.length})`,
  '| SKU | Field | CSV | Workbook | Resolution |', '|---|---|---|---|---|',
  ...audit.conflicts.map((c) => `| ${c.sku} | ${c.field} | ${String(c.csv).replace(/\|/g, '/')} | ${String(c.workbook).replace(/\|/g, '/')} | ${c.note} |`), '',
  `## Owner resolutions applied (${audit.resolutions.length})`,
  '| SKU | Source field | Was | Now | Status | Reason |', '|---|---|---|---|---|---|',
  ...audit.resolutions.map((r) => `| ${r.sku} | ${r.sheet ? `${r.sheet}: ${Object.values(r.where || {}).join(' ')} ${r.column}` : `CSV ${r.column}`} | ${r.find} | ${r.replace} | ${r.status} | ${r.why} |`), '',
  `## SEO text rewritten to remove "replica" (${audit.sanitised.length})`,
  ...audit.sanitised.map((s) => `- ${s.sku} ${s.field}: "${s.from}" → "${s.to}"`), '',
  `## Validation`, ...(audit.validation.length ? audit.validation.map((v) => `- ${v.sku} ${v.field}: ${v.issue}${v.value !== undefined ? ` (${v.value})` : ''}`) : ['- No empty fields or out-of-range values.']), '',
  `## Images`, `- Matched: ${audit.images.matched.length} (${Object.entries(audit.images.kind).map(([k, v]) => `${v} ${k}`).join(', ')})`,
  `- Alt text from CSV: ${audit.images.matched.filter((m) => m.altSource === 'CSV').length}; generated from filename: ${audit.images.matched.filter((m) => m.altSource !== 'CSV').length}`,
  `- SKUs without images: ${audit.images.skusWithoutImages.join(', ') || 'none'}`,
  `- Unmatched files/folders: ${audit.images.unmatchedFiles.join(', ') || 'none'}`,
  `- Image count differs from CSV "Image Count": ${audit.images.countMismatch.map((m) => `${m.sku} (CSV ${m.csv}, folder ${m.folder})`).join(', ') || 'none'}`,
  `- Low resolution (< 800 px): ${audit.images.lowQuality.join(', ') || 'none'}`,
  '', '| SKU | File | Alt source | Score |', '|---|---|---|---|',
  ...audit.images.matched.map((m) => `| ${m.sku} | ${m.file} | ${m.altSource} | ${m.score} |`),
].join('\n');
fs.writeFileSync(path.join(REPORTS, 'data-audit.md'), md);

console.log(`catalog: ${products.length} products, ${collections.length} collections; images encoded this run: ${encoded}`);
console.log(`errors ${audit.errors.length}, warnings ${audit.warnings.length}, conflicts ${audit.conflicts.length}, replica rewrites ${audit.sanitised.length}`);
if (audit.errors.length) { console.error(audit.errors.join('\n')); }
