/**
 * Owner resolutions (data/owner-resolutions.json): field-level fixes the owner has confirmed for
 * conflicts between the CSV and the workbook. Used by the data pipeline and by the audit, so both
 * read the same corrected sources. An entry whose replacement is already in the source is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadResolutions(dataDir) {
  const f = path.join(dataDir, 'owner-resolutions.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { csv: [], workbook: [] };
}

/** rows: CSV rows keyed by header. Returns a log of what happened to each entry. */
export function applyCsvResolutions(rows, res) {
  const log = [];
  for (const e of res.csv || []) {
    const row = rows.find((r) => r.SKU === e.sku);
    const cur = row?.[e.column];
    if (typeof cur !== 'string') { log.push({ ...e, status: 'not found' }); continue; }
    if (cur.includes(e.find)) { row[e.column] = cur.split(e.find).join(e.replace); log.push({ ...e, status: 'applied' }); }
    else if (cur.includes(e.replace)) log.push({ ...e, status: 'already in source' });
    else log.push({ ...e, status: 'not found' });
  }
  return log;
}

const cellText = (v) => (v && typeof v === 'object' ? (v.result ?? v.richText?.map((t) => t.text).join('') ?? v.text ?? null) : v);

/** wb: an ExcelJS workbook, modified in memory only (the file on disk is not touched). */
export function applyWorkbookResolutions(wb, res) {
  const log = [];
  for (const e of res.workbook || []) {
    const ws = wb.getWorksheet(e.sheet);
    if (!ws) { log.push({ ...e, status: 'sheet not found' }); continue; }
    let hdr = null; let status = 'not found';
    ws.eachRow((row, n) => {
      const v = row.values.slice(1).map(cellText);
      if (!hdr) { hdr = v.map((x) => String(x ?? '').trim()); return; }
      const get = (name) => v[hdr.indexOf(name)];
      if (get('SKU') !== e.sku) return;
      if (!Object.entries(e.where || {}).every(([k, want]) => String(get(k) ?? '').trim() === want)) return;
      const ci = hdr.indexOf(e.column) + 1;
      const cur = String(cellText(row.getCell(ci).value) ?? '').trim();
      if (cur === e.replace) status = 'already in source';
      else if (cur === e.find) { row.getCell(ci).value = e.replace; status = 'applied'; }
      else status = `source now reads "${cur}"`;
    });
    log.push({ ...e, status });
  }
  return log;
}
