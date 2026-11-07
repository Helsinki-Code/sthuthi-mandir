// Global cm <-> ft-in toggle. Elements carry data-cm and data-ft; buttons carry data-units-set.
const KEY = 'sthuthi-units';
function apply(u) {
  document.documentElement.dataset.units = u;
  document.querySelectorAll('[data-cm][data-ft]').forEach((el) => { el.textContent = u === 'ft' ? el.dataset.ft : el.dataset.cm; });
  document.querySelectorAll('[data-units-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unitsSet === u)));
  document.dispatchEvent(new CustomEvent('units-change', { detail: u }));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-units-set]');
  if (!b) return;
  const u = b.dataset.unitsSet;
  try { localStorage.setItem(KEY, u); } catch (_) {}
  apply(u);
});
apply(document.documentElement.dataset.units === 'ft' ? 'ft' : 'cm');
window.sthuthiApplyUnits = () => apply(document.documentElement.dataset.units === 'ft' ? 'ft' : 'cm');
