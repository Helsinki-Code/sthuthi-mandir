const form = document.querySelector('[data-consult]');
const status = form.querySelector('[data-status]');
const q = new URLSearchParams(location.search);
// Pre-fill from the fit checker / product page (?sku=&w=&d=&c=, all cm).
const pre = { sku: 'sku', w: 'roomWidthCm', d: 'roomDepthCm', c: 'ceilingHeightCm' };
for (const [k, name] of Object.entries(pre)) {
  const v = q.get(k);
  if (!v) continue;
  const el = form.elements[name];
  if (el.tagName === 'SELECT' ? el.querySelector(`option[value="${CSS.escape(v)}"]`) : /^\d{1,4}(\.\d+)?$/.test(v)) el.value = el.tagName === 'SELECT' ? v : Math.round(+v);
}
const rules = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Please enter your name.'),
  phone: (v) => (/^\+?[0-9][0-9\s-]{8,16}[0-9]$/.test(v.trim()) && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15 ? '' : 'Please enter a phone number with 10 to 15 digits.'),
  city: (v) => (v.trim().length >= 2 ? '' : 'Please enter your city.'),
  propertyType: (v) => (v ? '' : 'Please choose a property type.'),
  roomWidthCm: (v) => (v && +v >= 50 && +v <= 3000 ? '' : 'Enter the room width in cm (50–3000).'),
  roomDepthCm: (v) => (v && +v >= 50 && +v <= 3000 ? '' : 'Enter the room depth in cm (50–3000).'),
  ceilingHeightCm: (v) => (v && +v >= 150 && +v <= 1500 ? '' : 'Enter the ceiling height in cm (150–1500).'),
  budgetBand: (v) => (v ? '' : 'Please choose a budget band.'),
  sku: (v) => (v ? '' : 'Please choose a mandir, or "Not decided yet".'),
  handoverDate: (v) => (v && v >= new Date().toISOString().slice(0, 10) ? '' : 'Please choose a date from today onwards.'),
  consent: (_, el) => (el.checked ? '' : 'Please agree so that we can contact you.'),
};
const errId = { name: 'e-name', phone: 'e-phone', city: 'e-city', propertyType: 'e-prop', roomWidthCm: 'e-w', roomDepthCm: 'e-d', ceilingHeightCm: 'e-c', budgetBand: 'e-budget', sku: 'e-sku', handoverDate: 'e-date', consent: 'e-consent' };
function check(name) {
  const el = form.elements[name];
  const msg = rules[name](el.value, el);
  el.setAttribute('aria-invalid', String(!!msg));
  document.getElementById(errId[name]).textContent = msg;
  return !msg;
}
Object.keys(rules).forEach((n) => form.elements[n].addEventListener('blur', () => check(n)));
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const bad = Object.keys(rules).filter((n) => !check(n));
  if (bad.length) { form.elements[bad[0]].focus(); return; }
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.consent = true;
  payload.source = location.href;
  payload.submittedAt = new Date().toISOString();
  const endpoint = form.dataset.endpoint;
  // WhatsApp handoff: the same details, ready to send from the visitor's own WhatsApp.
  const label = (name) => { const el = form.elements[name]; return el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text || '' : el.value; };
  const lines = [
    'Hello Sthuthi, I would like to book a design consultation.',
    `Name: ${payload.name}`, `Phone: ${payload.phone}`, `City: ${payload.city}`, `Property: ${payload.propertyType}`,
    `Room: ${payload.roomWidthCm} × ${payload.roomDepthCm} cm, ceiling ${payload.ceilingHeightCm} cm`,
    `Budget: ${payload.budgetBand}`, `Mandir: ${label('sku')}`, `Handover date: ${payload.handoverDate}`,
    ...(payload.message ? [`Notes: ${payload.message}`] : []),
  ];
  const waHref = `https://wa.me/${form.dataset.wa}?text=${encodeURIComponent(lines.join('\n'))}`;
  const show = (cls, msg) => {
    status.hidden = false; status.className = `full form-status ${cls}`;
    status.replaceChildren();
    const p = document.createElement('p'); p.style.margin = '0 0 .75rem'; p.textContent = msg;
    const a = document.createElement('a'); a.className = 'btn btn-primary'; a.href = waHref; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Chat on WhatsApp';
    status.append(p, a);
  };
  if (!endpoint) {
    show('ok', 'Your details are ready. Send them to Sthuthi on WhatsApp to book your consultation.');
    return;
  }
  status.hidden = false; status.className = 'full form-status'; status.textContent = 'Sending…';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(String(res.status));
    show('ok', 'Thank you. Your request has been sent, and a Sthuthi designer will contact you. You can also send the same details on WhatsApp now.');
    form.reset();
  } catch (err) {
    show('bad', 'Sorry, your request could not be sent from this page. Please send the same details on WhatsApp instead.');
  }
});
