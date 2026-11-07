// Shared by the build scripts and the browser. Keep dependency-free.

/** cm -> ft-in, using the same rule as the measurements workbook: round to the nearest inch, then split. */
export function cmToFtIn(cm) {
  if (cm === null || cm === undefined || Number.isNaN(Number(cm))) return '';
  const inches = Math.round(Number(cm) / 2.54);
  return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}
/** ft + in -> cm (one decimal). */
export function ftInToCm(ft, inch = 0) {
  return Math.round((Number(ft || 0) * 12 + Number(inch || 0)) * 2.54 * 10) / 10;
}
export function cmToIn(cm) { return Math.round((cm / 2.54) * 10) / 10; }
export function m2ToFt2(m2) { return Math.round(m2 * 10.7639 * 10) / 10; }

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export function formatINR(n) { return inr.format(n); }
/** Rupees -> "₹N lakh" */
export function formatLakh(n) {
  // Not rounded, so a price is never misstated.
  return `₹${String(n / 100000)} lakh`;
}
export function dimCm(w, d, h) { return `${w} × ${d} × ${h} cm`; }
export function dimFt(w, d, h) { return `${cmToFtIn(w)} × ${cmToFtIn(d)} × ${cmToFtIn(h)}`; }
