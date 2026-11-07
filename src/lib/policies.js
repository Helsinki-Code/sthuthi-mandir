/**
 * Store policies, read word for word from data/store-policies.md (the owner's document).
 * The file is split into an introduction (the /policies/ page) and seven numbered sections,
 * one page each. Text is never rewritten; the renderer only adds links (phone, WhatsApp,
 * "section N" cross-references, the consumer helpline) around the original words.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SITE, PHONE, WHATSAPP_URL, TEL_URL } from '../site.config.js';

const SLUGS = ['delivery-installation', 'deposit-payment-cancellation', 'refunds', 'warranty', 'privacy', 'terms', 'grievance-redressal'];
const src = fs.readFileSync(path.join(process.cwd(), 'data/store-policies.md'), 'utf8').replace(/\r\n/g, '\n');

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('### ')) { blocks.push({ t: 'h3', text: l.slice(4).trim() }); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const sep = rows.findIndex((r) => /^\s*\|[\s:|-]+\|\s*$/.test(r));
      if (sep === 1) blocks.push({ t: 'table', head: cells(rows[0]), rows: rows.slice(2).map(cells) });
      else blocks.push({ t: 'table', head: null, rows: rows.map(cells) });
      continue;
    }
    if (/^- /.test(l)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2).trim()); i++; }
      blocks.push({ t: 'ul', items }); continue;
    }
    if (/^\d+\. /.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '').trim()); i++; }
      blocks.push({ t: 'ol', items }); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(### |- |\d+\. |\s*\|)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    blocks.push({ t: 'p', text: para.join(' ') });
  }
  return blocks;
}

const lines = src.split('\n');
const docTitle = lines.find((l) => l.startsWith('# ')).slice(2).trim();
const starts = lines.map((l, i) => (/^## \d+\. /.test(l) ? i : -1)).filter((i) => i >= 0);
const intro = parseBlocks(lines.slice(lines.findIndex((l) => l.startsWith('# ')) + 1, starts[0]));
export const policies = starts.map((s, k) => {
  const m = lines[s].match(/^## (\d+)\. (.+)$/);
  const blocks = parseBlocks(lines.slice(s + 1, starts[k + 1] ?? lines.length));
  return {
    num: +m[1], title: m[2].trim(), slug: SLUGS[+m[1] - 1],
    label: m[2].trim().replace(/ Policy$/, ''),
    lede: blocks.find((b) => b.t === 'p')?.text || '',
    blocks,
  };
});
export const policyDoc = { title: docTitle, intro };
export const policyUrl = (p) => `/policies/${p.slug}/`;

/* ------------------------------------------------------------- rendering */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PHONE_RE = new RegExp(PHONE.display.replace(/[+]/g, '\\+').replace(/\s/g, '\\s'), 'g');

/** Escape one run of original text and add links. `mode` is 'prose' or 'cell'. */
export function inline(text, mode = 'prose') {
  let h = esc(text);
  // A sentence that mentions WhatsApp links the number to WhatsApp; anywhere else it is a phone link.
  const toWa = mode === 'prose' && /WhatsApp/.test(text);
  h = h.replace(PHONE_RE, (m) => `<a class="link" href="${toWa ? WHATSAPP_URL : TEL_URL}"${toWa ? ' target="_blank" rel="noopener"' : ''}>${m}</a>`);
  h = h.replace(/\bsection (\d)\b/g, (m, n) => {
    const p = policies.find((x) => x.num === +n);
    return p ? `<a class="link" href="${policyUrl(p)}">${m}</a>` : m;
  });
  h = h.replace(/\bconsumerhelpline\.gov\.in\b/g, (m) => `<a class="link" href="https://consumerhelpline.gov.in/" target="_blank" rel="noopener">${m}</a>`);
  return h;
}

/** Table rows, with an Email row added after "Phone / WhatsApp" only when CONTACT_EMAIL is set. */
export function tableRows(block) {
  if (!SITE.contactEmail) return block.rows;
  const out = [];
  for (const r of block.rows) {
    out.push(r);
    if (r[0] === 'Phone / WhatsApp' && r.length === 2) out.push(['Email', SITE.contactEmail]);
  }
  return out;
}
export function cellHtml(c) {
  if (SITE.contactEmail && c === SITE.contactEmail) return `<a class="link" href="mailto:${esc(c)}">${esc(c)}</a>`;
  return inline(c, 'cell');
}
