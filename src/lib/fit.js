// "Will it fit my space?" logic. Shared by the product page, the size guide room checker and the audit tests.
// Every threshold comes from the measurements workbook (product data + Installation Standards).

/**
 * @param {object} p   { widthCm, depthCm, heightCm, aptHeightCm, hasApartmentEdition, walkIn, structuralSignOff }
 * @param {object} room { w, d, c } in cm
 * @param {object} std  { ceilingClearance }
 */
export function checkFit(p, room, std) {
  const clr = Number(std.ceilingClearance);
  const W = Number(room.w), D = Number(room.d), Cc = Number(room.c);
  const asIs = p.widthCm <= W && p.depthCm <= D;
  const rotated = !asIs && p.depthCm <= W && p.widthCm <= D;
  const fw = rotated ? p.depthCm : p.widthCm;
  const fd = rotated ? p.widthCm : p.depthCm;
  const footprint = {
    fits: asIs || rotated, rotated,
    spareW: W - fw, spareD: D - fd,
    shortW: Math.max(0, p.widthCm - W), shortD: Math.max(0, p.depthCm - D),
  };
  const editions = [{
    key: 'standard',
    label: p.hasApartmentEdition ? 'Villa edition' : 'Standard edition',
    heightCm: p.heightCm,
    minCeilingCm: p.heightCm + clr,
  }];
  if (p.hasApartmentEdition) editions.push({ key: 'apartment', label: 'Apartment edition', heightCm: p.aptHeightCm, minCeilingCm: p.aptHeightCm + clr });
  for (const e of editions) {
    e.fits = Cc >= e.minCeilingCm;
    e.aboveTop = Cc - e.heightCm;              // gap between the finial and the ceiling
    e.margin = Cc - e.minCeilingCm;            // gap left after the required installation clearance
  }
  const fitting = editions.find((e) => e.fits);
  let verdict;
  if (!footprint.fits && !fitting) verdict = 'none';
  else if (!footprint.fits) verdict = 'footprint';
  else if (!fitting) verdict = 'ceiling';
  else verdict = fitting.key; // 'standard' | 'apartment'
  return { verdict, footprint, editions, fitting: fitting || null, clearance: clr, signOff: !!p.structuralSignOff };
}

export function validRoom(room) {
  return ['w', 'd', 'c'].every((k) => Number.isFinite(Number(room[k])) && Number(room[k]) > 0 && Number(room[k]) < 5000);
}
