import { cmToFtIn, formatINR } from '../lib/units.js';
import { enquiryMessage, buyLabel } from '../lib/tier.js';
const data = JSON.parse(document.querySelector('[data-compare-json]').textContent);
const out = document.querySelector('[data-compare]');
const form = document.querySelector('[data-pickers]');
const KEY = 'sthuthi-compare';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ft = () => document.documentElement.dataset.units === 'ft';
const L = (cm) => (ft() ? cmToFtIn(cm) : `${cm} cm`);
const D3 = (w, d, h) => (ft() ? `${cmToFtIn(w)} × ${cmToFtIn(d)} × ${cmToFtIn(h)}` : `${w} × ${d} × ${h} cm`);
const inch = (cm) => Math.round((cm / 2.54) * 10) / 10;
const sz = (arr) => { const a = arr.filter((x) => x !== null && x !== undefined); return ft() ? `${a.map(inch).join(' × ')} in` : `${a.join(' × ')} cm`; };

function render() {
  const skus = [form.p1.value, form.p2.value, form.p3.value].filter(Boolean);
  const uniq = [...new Set(skus)];
  history.replaceState(null, '', `${location.pathname}${uniq.length ? `?skus=${uniq.join(',')}` : ''}`);
  try { localStorage.setItem(KEY, JSON.stringify(uniq)); } catch (_) {}
  const ps = uniq.map((s) => data.products.find((p) => p.sku === s)).filter(Boolean);
  if (ps.length < 2) { out.innerHTML = '<p class="empty">Choose at least two mandirs to see them side by side.</p>'; return; }
  const cw = (p) => p.img.widths.find((w) => w >= 400) || p.img.widths[p.img.widths.length - 1];
  const img = (p) => p.img ? `<a href="/mandirs/${p.slug}/" style="display:block;position:relative;max-width:14rem"><picture><source type="image/avif" srcset="${p.img.base}-${cw(p)}.avif"><img src="${p.img.base}-${cw(p)}.webp" width="${cw(p)}" height="${Math.round(p.img.h / p.img.w * cw(p))}" alt="${esc(p.img.alt)}" loading="lazy"></picture>${p.img.kind !== 'photo' ? '<span class="vis-label">Visualisation</span>' : ''}</a>` : '';
  const rows = [
    ['', (p) => img(p)],
    ['Mandir', (p) => `<a class="link" href="/mandirs/${p.slug}/">${esc(p.name)}</a><span class="sub">${esc(p.collectionName)} · ${p.sku}</span>`],
    ['Price', (p) => `<strong>${formatINR(p.price)}</strong><span class="sub">Idols, pooja items, delivery and installation in India included</span><span class="tier-label ${p.tier}">${p.tier === 'buy' ? 'Buy online' : 'Enquire on WhatsApp'}</span>`],
    ['Material', (p) => esc(p.material)],
    ['Overall (W × D × H)', (p) => D3(p.widthCm, p.depthCm, p.heightCm)],
    ['Footprint', (p) => `${p.footprintM2} m²`],
    ['Niche / interior (W × D × H)', (p) => D3(p.niche.w, p.niche.d, p.niche.h)],
    ['Altar height', (p) => L(p.altarCm)],
    ['Weight', (p) => `${p.weightMin}–${p.weightMax} kg`],
    ['Ceiling needed', (p) => `${L(p.minCeilingCm)}${p.hasApartmentEdition ? `<span class="sub">Apartment edition: ${L(p.aptHeightCm)} high, needs ${L(p.aptMinCeilingCm)}</span>` : '<span class="sub">No separate apartment edition</span>'}`],
    ['Installation', (p) => (p.structuralSignOff ? 'Structural sign-off of the floor' : 'Standard RCC floor')],
    ['Idols', (p) => p.idolSets.map((s) => `${p.idolSets.length > 1 ? `<strong>${esc(s.label)}</strong><br>` : ''}${s.figures.map((f) => `${esc(f.figure)} <span class="sub" style="display:inline">${esc(f.material)}, ${sz([f.h, f.w, f.d])}</span>`).join('<br>')}`).join('<br><br>')],
    ['Pooja kit', (p) => p.kit.map((k) => `${k.qty} × ${esc(k.item)} <span class="sub" style="display:inline">${esc(k.material)}</span>`).join('<br>')],
    ['', (p) => (p.tier === 'buy'
      ? `<a class="btn btn-primary btn-small" href="/mandirs/${p.slug}/#buy">${buyLabel(p.price)}</a>`
      : `<a class="btn btn-primary btn-small" href="https://wa.me/${data.whatsapp}?text=${encodeURIComponent(enquiryMessage(p.sku, p.name, p.price))}" target="_blank" rel="noopener">Chat with us on WhatsApp</a>`)
      + `<br><a class="link" style="display:inline-block;margin-top:.5rem;font-size:var(--fs-sm)" href="/book-consultation/?sku=${p.sku}">Book a design consultation</a>`],
  ];
  out.innerHTML = `<div class="table-wrap"><table class="spec data compare-table"><caption>Dimensions and weights from the Sthuthi measurements sheet.</caption>
    <thead><tr><th scope="col"><span class="visually-hidden">Attribute</span></th>${ps.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([k, fn]) => `<tr><th scope="row">${k}</th>${ps.map((p) => `<td class="num">${fn(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const q = new URLSearchParams(location.search).get('skus');
let initial = q ? q.split(',') : [];
if (!initial.length) { try { initial = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) {} }
initial.slice(0, 3).forEach((s, i) => { if (form[`p${i + 1}`].querySelector(`option[value="${CSS.escape(s)}"]`)) form[`p${i + 1}`].value = s; });
form.addEventListener('change', render);
document.addEventListener('units-change', render);
render();
