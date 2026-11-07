import { tierOf } from '../site.config.js';
import catalog from '../generated/catalog.json';
export { catalog };
export const products = catalog.products;
export const collections = catalog.collections;
export const std = catalog.std;
export const standards = catalog.standards;
export const facets = catalog.facets;

export const productUrl = (p) => `/mandirs/${p.slug}/`;
export const collectionUrl = (c) => `/collections/${c.slug}/`;
export const getCollection = (slug) => collections.find((c) => c.slug === slug);
export const productsIn = (slug) => products.filter((p) => p.collection === slug);
export const bySku = (sku) => products.find((p) => p.sku === sku);

/** Compact record for client-side filtering, compare and fit checks. */
export function compact(p) {
  const s = p.structure || {};
  return {
    tier: tierOf(p),
    sku: p.sku, slug: p.slug, name: p.name, collection: p.collection, collectionName: p.collectionName,
    price: p.priceINR, material: p.material, deities: p.principalDeities, allDeities: p.deities, materials: p.materials, multi: p.multiDeity,
    img: p.images[0] ? { base: p.images[0].base, widths: p.images[0].widths, w: p.images[0].width, h: p.images[0].height, alt: p.images[0].alt, kind: p.images[0].kind } : null,
    widthCm: s.widthCm, depthCm: s.depthCm, heightCm: s.heightCm, ftIn: s.ftIn, footprintM2: s.footprintM2,
    aptHeightCm: s.aptHeightCm, hasApartmentEdition: s.hasApartmentEdition, minCeilingCm: s.minCeilingCm, aptMinCeilingCm: s.aptMinCeilingCm,
    niche: s.niche, altarCm: s.altarCm, weightMin: s.weightMin, weightMax: s.weightMax, walkIn: s.walkIn,
    structuralSignOff: s.structuralSignOff, installRequirement: s.installRequirement, door: s.door, type: s.type,
    idolSets: p.idolSets.map((set) => ({ label: set.label, key: set.key, figures: set.figures.map((f) => ({ figure: f.figure, material: f.material, h: f.h, w: f.w, d: f.d })) })),
    kit: p.kit.map((k) => ({ item: k.item, qty: k.qty, material: k.material, h: k.h, dia: k.dia, len: k.len })),
  };
}

/** Related products: same deity, same collection, similar footprint, similar budget. */
export function related(p, n = 4) {
  const fp = p.structure?.footprintM2 || 0;
  return products.filter((q) => q.sku !== p.sku).map((q) => {
    const reasons = [];
    let score = 0;
    const shared = q.principalDeities.filter((d) => p.principalDeities.includes(d));
    if (shared.length) { score += 3 + shared.length * 0.2; reasons.push(`Also for ${shared.slice(0, 2).join(' & ')}`); }
    if (q.collection === p.collection) { score += 2; }
    const qfp = q.structure?.footprintM2 || 0;
    if (fp && qfp && Math.abs(qfp - fp) / Math.max(qfp, fp) <= 0.25) { score += 1.5; reasons.push('Similar footprint'); }
    if (Math.abs(q.priceINR - p.priceINR) / Math.max(q.priceINR, p.priceINR) <= 0.2) { score += 1.5; reasons.push('Similar budget'); }
    if (q.collection === p.collection && !reasons.length) reasons.push('Same collection');
    return { q, score, reasons };
  }).sort((a, b) => b.score - a.score || a.q.priceINR - b.q.priceINR).slice(0, n);
}

export const isPlaceholder = (v) => v === null || v === undefined || v === '';
