const form = document.querySelector('[data-filters]');
const cards = [...document.querySelectorAll('[data-cards] .card')];
const grid = document.querySelector('[data-cards]');
const countEl = document.querySelector('[data-count]');
const empty = document.querySelector('[data-empty]');
const sortSel = document.querySelector('[data-sort]');
const toggle = document.querySelector('[data-filters-toggle]');
const original = [...cards];
const wide = matchMedia('(min-width: 1000px)');
const syncOpen = () => { if (wide.matches) form.hidden = false; };
syncOpen(); wide.addEventListener('change', syncOpen);
toggle.addEventListener('click', () => { form.hidden = !form.hidden; toggle.setAttribute('aria-expanded', String(!form.hidden)); });

const vals = (n) => [...form.querySelectorAll(`[name="${n}"]:checked`)].map((i) => i.value);
function apply() {
  const f = {
    collection: vals('collection'), deity: vals('deity'), material: vals('material'), band: vals('band'),
    multi: form.querySelector('[name="multi"]:checked')?.value || '',
    maxw: +form.maxw.value, maxh: +form.maxh.value, maxfp: +form.maxfp.value,
    ceil: form.ceil.value ? +form.ceil.value : null, apt: form.apt.checked,
  };
  let n = 0;
  for (const c of cards) {
    const d = c.dataset;
    const deities = d.alldeities.split('|'); const mats = d.materials.split('|'); const price = +d.price;
    const ok = (!f.collection.length || f.collection.includes(d.collection))
      && (!f.deity.length || f.deity.some((x) => deities.includes(x)))
      && (!f.material.length || f.material.some((x) => mats.includes(x)))
      && (!f.band.length || f.band.some((b) => { const [lo, hi] = b.split('-'); return price >= +lo && (hi === '' || price < +hi); }))
      && (f.multi === '' || d.multi === f.multi)
      && +d.w <= f.maxw && +d.h <= f.maxh && +d.fp <= f.maxfp + 1e-9
      && (f.ceil === null || +d.minceil <= f.ceil)
      && (!f.apt || d.apt === '1');
    c.hidden = !ok; if (ok) n++;
  }
  countEl.textContent = `${n} mandir${n === 1 ? '' : 's'}`;
  empty.hidden = n > 0;
  form.querySelectorAll('[data-rangeval]').forEach((el) => { el.textContent = `Up to ${form[el.dataset.rangeval].value} ${el.dataset.unit}`; });
  // Shareable URL
  const q = new URLSearchParams();
  for (const k of ['collection', 'deity', 'material', 'band']) f[k].forEach((v) => q.append(k, v));
  if (f.multi) q.set('multi', f.multi);
  for (const k of ['maxw', 'maxh', 'maxfp']) if (form[k].value !== form[k].max) q.set(k, form[k].value);
  if (f.ceil) q.set('ceil', f.ceil);
  if (f.apt) q.set('apt', '1');
  if (sortSel.value !== 'default') q.set('sort', sortSel.value);
  history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
}
function sort() {
  const v = sortSel.value;
  const key = { 'price-asc': (c) => +c.dataset.price, 'price-desc': (c) => -c.dataset.price, 'h-asc': (c) => +c.dataset.h, 'fp-asc': (c) => +c.dataset.fp }[v];
  const list = key ? [...original].sort((a, b) => key(a) - key(b)) : original;
  list.forEach((c) => grid.appendChild(c));
}
// Restore from URL
const q = new URLSearchParams(location.search);
for (const k of ['collection', 'deity', 'material', 'band']) q.getAll(k).forEach((v) => { const i = form.querySelector(`[name="${k}"][value="${CSS.escape(v)}"]`); if (i) i.checked = true; });
if (q.get('multi')) { const r = form.querySelector(`[name="multi"][value="${q.get('multi')}"]`); if (r) r.checked = true; }
for (const k of ['maxw', 'maxh', 'maxfp']) if (q.get(k)) form[k].value = q.get(k);
if (q.get('ceil')) form.ceil.value = q.get('ceil');
if (q.get('apt')) form.apt.checked = true;
if (q.get('sort')) sortSel.value = q.get('sort');
form.addEventListener('input', apply);
form.addEventListener('change', apply);
form.addEventListener('reset', () => setTimeout(apply, 0));
sortSel.addEventListener('change', () => { sort(); apply(); });
sort(); apply();
