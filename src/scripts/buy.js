import { checkFit } from '../lib/fit.js';
import { PAYABLE_VERDICTS, PIN_RE, ROOM_LIMITS, enquiryMessage } from '../lib/tier.js';

const box = document.querySelector('[data-buy]');
if (box) {
  const { std, product: p } = JSON.parse(box.querySelector('[data-buy-json]').textContent);
  const form = box.querySelector('form');
  const fitOut = box.querySelector('[data-buy-fit]');
  const fail = box.querySelector('[data-buy-fail]');
  const waBtn = box.querySelector('[data-buy-wa]');
  const submit = box.querySelector('[data-buy-submit]');
  const why = box.querySelector('[data-buy-why]');
  const status = box.querySelector('[data-buy-status]');
  const pinErr = box.querySelector('#b-pin-e');
  const waBase = `https://wa.me/${box.dataset.wa}?text=`;
  if (new URLSearchParams(location.search).get('checkout') === 'cancelled') box.querySelector('[data-buy-cancelled]').hidden = false;

  const room = () => ({ w: Number(form.w.value), d: Number(form.d.value), c: Number(form.c.value) });
  const roomOk = (r) => Object.entries(ROOM_LIMITS).every(([k, [lo, hi]]) => form[k].value !== '' && r[k] >= lo && r[k] <= hi);
  const verdictText = { standard: p.hasApartmentEdition ? 'It fits: the villa edition suits this room.' : 'It fits this room.', apartment: 'The apartment edition fits this room.',
    ceiling: 'The ceiling is too low for this mandir.', footprint: 'The floor area is too small for this mandir.', none: 'This mandir does not fit this room.' };

  function update() {
    const r = room();
    const pin = form.pin.value.trim();
    const pinOk = PIN_RE.test(pin);
    pinErr.textContent = pin.length === 6 && !pinOk ? 'Enter a valid 6-digit Indian PIN code.' : '';
    let fitOk = false;
    if (roomOk(r)) {
      const res = checkFit(p, r, std);
      fitOk = PAYABLE_VERDICTS.includes(res.verdict);
      fitOut.className = `full buy-fit ${fitOk ? 'ok' : 'no'}`;
      fitOut.textContent = verdictText[res.verdict];
      fail.hidden = fitOk;
      waBtn.href = waBase + encodeURIComponent(`${enquiryMessage(p.sku, p.name, p.price)} My room is ${r.w} × ${r.d} cm with a ${r.c} cm ceiling. It did not pass the fit check.`);
    } else { fitOut.className = 'full buy-fit'; fitOut.textContent = ''; fail.hidden = true; }
    const ready = pinOk && fitOk && form.consent.checked;
    submit.disabled = !ready;
    why.textContent = ready ? '' : !pinOk ? 'Enter your delivery PIN code to continue.' : !roomOk(r) ? 'Enter your room measurements to continue.' : !fitOk ? 'Payment is available only when the mandir fits your room.' : 'Tick the policy box to continue.';
    return ready;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);

  // Carry over measurements from the "Will it fit my space?" checker (cm mode).
  document.querySelector('[data-fit] form')?.addEventListener('submit', (e) => {
    const f = e.currentTarget;
    if (f.units?.value !== 'cm') return;
    for (const k of ['w', 'd', 'c']) if (f[k]?.value && !form[k].value) form[k].value = Math.round(Number(f[k].value));
    update();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!update()) return;
    submit.disabled = true;
    status.hidden = false; status.className = 'full form-status'; status.textContent = 'Opening the secure payment page…';
    const r = room();
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: p.sku, pin: form.pin.value.trim(), roomWidthCm: r.w, roomDepthCm: r.d, ceilingHeightCm: r.c, consent: form.consent.checked === true }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.url) { location.assign(out.url); return; }
      status.className = 'full form-status bad';
      status.replaceChildren(Object.assign(document.createElement('p'), { textContent: out.message || 'The payment page could not be opened.', style: 'margin:0 0 .6rem' }));
      if (out.whatsapp) status.append(Object.assign(document.createElement('a'), { className: 'btn btn-ghost', href: out.whatsapp, target: '_blank', rel: 'noopener', textContent: 'Chat on WhatsApp' }));
    } catch (_) {
      status.className = 'full form-status bad'; status.textContent = 'The payment page could not be opened. Please check your connection and try again.';
    }
    update();
  });
  update();
}
