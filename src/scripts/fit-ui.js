import { checkFit, validRoom } from '../lib/fit.js';
import { cmToFtIn, ftInToCm } from '../lib/units.js';

const fmt = (cm) => (document.documentElement.dataset.units === 'ft' ? cmToFtIn(Math.max(0, Math.round(cm))) : `${Math.round(cm)} cm`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function verdictText(r, p) {
  if (r.verdict === 'standard') return { cls: 'ok', t: p.hasApartmentEdition ? 'Yes. The villa edition fits.' : 'Yes, it fits.' };
  if (r.verdict === 'apartment') return { cls: 'part', t: 'The apartment edition fits. The villa edition needs a higher ceiling.' };
  if (r.verdict === 'footprint') return { cls: 'no', t: 'The ceiling works, but the floor area is too small.' };
  if (r.verdict === 'ceiling') return { cls: 'no', t: 'The floor area works, but the ceiling is too low.' };
  return { cls: 'no', t: 'It does not fit this room.' };
}

function renderOne(box, p, r, room) {
  const v = verdictText(r, p);
  const ed = r.fitting || r.editions[r.editions.length - 1];
  const cells = [];
  if (r.footprint.fits) {
    cells.push(['Width left over', fmt(r.footprint.spareW)], ['Depth left over', fmt(r.footprint.spareD)]);
  } else {
    if (r.footprint.shortW) cells.push(['Width short by', fmt(r.footprint.shortW)]);
    if (r.footprint.shortD) cells.push(['Depth short by', fmt(r.footprint.shortD)]);
  }
  for (const e of r.editions) {
    cells.push([`${e.label}: ${fmt(e.heightCm)} high`, e.fits
      ? `Fits. ${fmt(e.aboveTop)} to the ceiling (${fmt(e.margin)} beyond the ${r.clearance} cm clearance)`
      : `Needs a ${fmt(e.minCeilingCm)} ceiling: ${fmt(e.minCeilingCm - room.c)} more`]);
  }
  const notes = [];
  if (r.footprint.rotated) notes.push('It fits only when turned 90°, with its front on the shorter wall. Check which wall you want it to face.');
  notes.push('This checks the structure itself. Leave space in front to stand or sit for worship; your designer confirms this at the consultation.');
  if (r.signOff) notes.push('This mandir is installed after a structural engineer signs off the floor.');
  const q = new URLSearchParams({ sku: p.sku, w: Math.round(room.w), d: Math.round(room.d), c: Math.round(room.c) });
  box.innerHTML = `<p class="fit-verdict ${v.cls}">${esc(v.t)}</p>
    <div class="fit-grid">${cells.map(([k, val]) => `<div><div class="k">${esc(k)}</div><div class="v num">${esc(val)}</div></div>`).join('')}</div>
    ${notes.map((n) => `<p class="muted" style="font-size:var(--fs-sm);margin:.3rem 0">${esc(n)}</p>`).join('')}
    <p style="margin-top:1rem"><a class="btn btn-primary" href="/book-consultation/?${q}">Book a design consultation</a></p>`;
}

function renderAll(box, list, std, room) {
  const rows = list.map((p) => ({ p, r: checkFit(p, room, std) }));
  const order = { standard: 0, apartment: 1, ceiling: 2, footprint: 3, none: 4 };
  rows.sort((a, b) => order[a.r.verdict] - order[b.r.verdict] || a.p.price - b.p.price);
  const fits = rows.filter((x) => x.r.verdict === 'standard' || x.r.verdict === 'apartment');
  const tag = (r) => r.verdict === 'standard' ? '<span class="tag-ok">Fits</span>'
    : r.verdict === 'apartment' ? '<span class="tag-part">Apartment edition fits</span>'
    : r.verdict === 'ceiling' ? '<span class="tag-no">Ceiling too low</span>'
    : '<span class="tag-no">Floor too small</span>';
  const q = new URLSearchParams({ w: Math.round(room.w), d: Math.round(room.d), c: Math.round(room.c) });
  box.innerHTML = `<p class="fit-verdict ${fits.length ? 'ok' : 'no'}">${fits.length} of ${rows.length} mandirs fit this room.</p>
    <p class="muted" style="font-size:var(--fs-sm)">Footprint and ceiling only. Leave space in front for worship; we confirm everything at the consultation.</p>
    <ul class="fit-list">${rows.map(({ p, r }) => `<li><span><a href="/mandirs/${p.slug}/">${esc(p.name)}</a><br><span class="muted num" style="font-size:var(--fs-sm)">${fmt(p.widthCm)} × ${fmt(p.depthCm)} × ${fmt(p.heightCm)}${p.hasApartmentEdition ? ` · apartment ${fmt(p.aptHeightCm)}` : ''}</span></span>${tag(r)}</li>`).join('')}</ul>
    <p style="margin-top:1rem"><a class="btn btn-primary" href="/book-consultation/?${q}">Book a design consultation</a></p>`;
}

document.querySelectorAll('[data-fit]').forEach((sec) => {
  const data = JSON.parse(sec.querySelector('[data-fit-json]').textContent);
  const form = sec.querySelector('form');
  const box = sec.querySelector('[data-result]');
  const unitsSel = form.elements.units;
  const syncUnits = () => {
    const u = unitsSel.value;
    sec.querySelectorAll('[data-u]').forEach((el) => { el.hidden = el.dataset.u !== u; });
  };
  unitsSel.value = document.documentElement.dataset.units === 'ft' ? 'ft' : 'cm';
  syncUnits();
  unitsSel.addEventListener('change', syncUnits);
  // Pre-fill from ?w=&d=&c= (cm) so a shared link reproduces a result.
  const qs = new URLSearchParams(location.search);
  if (['w', 'd', 'c'].every((k) => qs.get(k))) ['w', 'd', 'c'].forEach((k) => { form.elements[k].value = qs.get(k); });
  let last = null;
  const run = () => {
    const ft = unitsSel.value === 'ft';
    const room = {};
    for (const k of ['w', 'd', 'c']) {
      room[k] = ft ? ftInToCm(form.elements[`${k}ft`].value, form.elements[`${k}in`].value) : Number(form.elements[k].value);
    }
    if (!validRoom(room)) {
      box.hidden = false;
      box.innerHTML = '<p class="fit-verdict no" role="alert">Please enter all three measurements.</p>';
      return;
    }
    last = room;
    box.hidden = false;
    if (sec.dataset.mode === 'all') renderAll(box, data.products, data.std, room);
    else renderOne(box, data.products[0], checkFit(data.products[0], room, data.std), room);
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  document.addEventListener('units-change', () => { if (last) run(); });
});
