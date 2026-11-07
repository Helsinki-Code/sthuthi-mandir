#!/usr/bin/env node
// Writes sitemap.xml, image-sitemap.xml and robots.txt into dist/ from the built pages and the catalog.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = (process.env.SITE_URL || 'https://www.sthuthi.example').replace(/\/$/, '');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/generated/catalog.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f === 'index.html') pages.push('/' + path.relative(DIST, path.dirname(p)).split(path.sep).join('/'));
  }
})(DIST);
const urls = pages.map((u) => (u === '/' ? '/' : `${u.replace(/\/?$/, '/')}`)).filter((u) => !u.startsWith('/404') && !u.startsWith('/order/')).sort();
const lastmod = catalog.generatedAt.slice(0, 10);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE + u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(DIST, 'image-sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${catalog.products.map((p) => `  <url><loc>${esc(`${SITE}/mandirs/${p.slug}/`)}</loc>
${p.images.map((im) => `    <image:image><image:loc>${esc(`${SITE}${im.base}-${im.widths[im.widths.length - 1]}.webp`)}</image:loc></image:image>`).join('\n')}
  </url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /order/\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/image-sitemap.xml\n`);
console.log(`postbuild: ${urls.length} URLs in sitemap, ${catalog.products.reduce((n, p) => n + p.images.length, 0)} images in image sitemap`);
