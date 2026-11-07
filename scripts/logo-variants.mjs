#!/usr/bin/env node
/**
 * Produces clean logo variants from data/sthuthi-logo.png without altering the artwork:
 *  - background removed by colour-to-alpha against the logo's own paper colour (artwork pixels unchanged
 *    when composited back on that colour)
 *  - crops: full lockup, temple mark, wordmark (text + lotus rule)
 *  - favicons cut from the mark, on the logo's paper colour
 * Crops are found from the artwork itself (rows of ink), not hard-coded pixel boxes.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/sthuthi-logo.png');
const OUT = path.join(ROOT, 'public/brand');
fs.mkdirSync(OUT, { recursive: true });

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
// Paper colour = median of the border pixels.
const border = [];
for (let x = 0; x < W; x += 4) { border.push(x * 3, ((H - 1) * W + x) * 3); }
const med = (k) => { const v = border.map((i) => data[i + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
const bg = [med(0), med(1), med(2)];

const rgba = Buffer.alloc(W * H * 4);
for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  let a = 0;
  for (let k = 0; k < 3; k++) {
    const c = data[i + k]; const b = bg[k];
    const ak = c >= b ? 0 : (b - c) / (b || 1); // ink is always darker than the paper
    if (ak > a) a = ak;
  }
  if (a < 0.035) a = 0;
  for (let k = 0; k < 3; k++) {
    rgba[j + k] = a === 0 ? 0 : Math.max(0, Math.min(255, Math.round((data[i + k] - bg[k]) / a + bg[k])));
  }
  rgba[j + 3] = Math.round(a * 255);
}
const transparent = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });

// Ink rows/cols
const inkRow = (y, x0 = 0, x1 = W) => { for (let x = x0; x < x1; x++) if (rgba[(y * W + x) * 4 + 3] > 40) return true; return false; };
const bands = []; let s = null;
for (let y = 0; y < H; y++) { const r = inkRow(y); if (r && s === null) s = y; if (!r && s !== null) { bands.push([s, y]); s = null; } }
if (s !== null) bands.push([s, H]);
// Merge bands closer than 12px (parts of the same element).
const merged = [];
for (const b of bands) { const l = merged[merged.length - 1]; if (l && b[0] - l[1] < 12) l[1] = b[1]; else merged.push([...b]); }
// The tallest band is the temple mark; the next is the wordmark; the last is the lotus rule.
console.log("bands", merged);
const byHeight = [...merged].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
const mark = byHeight[0];
const after = merged.filter((b) => b[0] >= mark[1]);
const word = [after[0][0], after[after.length - 1][1]];
const colsFor = ([y0, y1]) => {
  let x0 = W, x1 = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return [x0, x1 + 1];
};
const box = (yr, pad) => { const [x0, x1] = colsFor(yr); return { left: Math.max(0, x0 - pad), top: Math.max(0, yr[0] - pad), width: Math.min(W, x1 + pad) - Math.max(0, x0 - pad), height: Math.min(H, yr[1] + pad) - Math.max(0, yr[0] - pad) }; };
const full = box([merged[0][0], merged[merged.length - 1][1]], 24);
const markBox = box(mark, 16);
const wordBox = box(word, 12);

const png = await transparent.png().toBuffer();
const out = async (name, region, width) => {
  let p = sharp(png).extract(region);
  if (width) p = p.resize({ width });
  await p.clone().png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));
  await p.clone().webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(OUT, `${name}.webp`));
  const m = await sharp(path.join(OUT, `${name}.png`)).metadata();
  return { name, width: m.width, height: m.height };
};
const results = [
  await out('logo-full', full, 900),
  await out('logo-mark', markBox, 400),
  await out('logo-wordmark', wordBox, 640),
];
// Favicons: the mark centred on the logo's own paper colour.
const paper = { r: bg[0], g: bg[1], b: bg[2], alpha: 1 };
const markPng = await sharp(png).extract(markBox).png().toBuffer();
for (const size of [32, 180, 192, 512]) {
  const inner = Math.round(size * 0.84);
  const m = await sharp(markPng).resize({ height: inner, width: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: paper } })
    .composite([{ input: m, gravity: 'center' }]).png().toFile(path.join(OUT, size === 32 ? 'favicon-32.png' : `icon-${size}.png`));
}
// Original, untouched, for reference/download.
fs.copyFileSync(SRC, path.join(OUT, 'sthuthi-logo-original.png'));
const paperHex = '#' + bg.map((v) => v.toString(16).padStart(2, '0')).join('');
fs.writeFileSync(path.join(ROOT, 'src/generated/brand.json'), JSON.stringify({ paper: paperHex, variants: results }, null, 1));
console.log('paper', paperHex, results, { full, markBox, wordBox });
