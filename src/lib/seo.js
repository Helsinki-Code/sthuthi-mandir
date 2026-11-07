import { SITE, BUSINESS, PHONE, leadTime, tierOf } from '../site.config.js';

export function organizationLd(site) {
  // Seller identity from data/business.json. Email only when CONTACT_EMAIL is set. No LocalBusiness.
  const s = BUSINESS.seller;
  const contact = { '@type': 'ContactPoint', contactType: 'customer service', telephone: PHONE.display, areaServed: 'IN',
    ...(SITE.contactEmail ? { email: SITE.contactEmail } : {}) };
  return { '@context': 'https://schema.org', '@type': 'Organization', '@id': `${site}/#org`, name: SITE.name, legalName: s.legalName, url: `${site}/`,
    logo: { '@type': 'ImageObject', url: `${site}/brand/logo-full.png` },
    brand: { '@type': 'Brand', name: BUSINESS.brand, logo: `${site}/brand/logo-full.png` },
    identifier: { '@type': 'PropertyValue', propertyID: 'CIN', value: s.cin },
    address: { '@type': 'PostalAddress', ...s.address },
    telephone: PHONE.display,
    ...(SITE.contactEmail ? { email: SITE.contactEmail } : {}),
    contactPoint: [contact] };
}
export function breadcrumbLd(site, items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, ...(it.href ? { item: new URL(it.href, site + '/').toString() } : {}) })) };
}
const qv = (value, unitCode) => ({ '@type': 'QuantitativeValue', value, unitCode });
export function productLd(site, p) {
  const s = p.structure;
  const o = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': `${site}/mandirs/${p.slug}/#product`,
    name: p.name, sku: p.sku, description: p.short, url: `${site}/mandirs/${p.slug}/`,
    brand: { '@type': 'Brand', name: SITE.name }, manufacturer: { '@id': `${site}/#org` }, category: p.collectionName, material: p.material,
    image: p.images.map((im) => `${site}${im.base}-${im.widths[im.widths.length - 1]}.webp`),
  };
  if (s) {
    o.width = qv(s.widthCm, 'CMT'); o.depth = qv(s.depthCm, 'CMT'); o.height = qv(s.heightCm, 'CMT');
    o.weight = { '@type': 'QuantitativeValue', minValue: s.weightMin, maxValue: s.weightMax, unitCode: 'KGM' };
    o.additionalProperty = [
      { '@type': 'PropertyValue', name: 'Minimum clear ceiling height', value: s.minCeilingCm, unitCode: 'CMT' },
      ...(s.hasApartmentEdition ? [{ '@type': 'PropertyValue', name: 'Apartment edition height', value: s.aptHeightCm, unitCode: 'CMT' }] : []),
      { '@type': 'PropertyValue', name: 'Installation requirement', value: s.installRequirement },
      { '@type': 'PropertyValue', name: 'Lead time', value: `${leadTime(p)}, ${BUSINESS.leadTimes.basis}` },
      ...p.idolSets.flatMap((set) => set.figures.map((f) => ({ '@type': 'PropertyValue', name: `Idol${p.idolSets.length > 1 ? ` (${set.label})` : ''}: ${f.figure}`,
        value: `${f.material}, ${[f.h, f.w, f.d].filter((x) => x !== null).join(' × ')} cm (H × W × D)` }))),
    ];
  }
  // Offer only where the price is actually charged online (below FULL_PAYMENT_MAX_INR); elsewhere the CSV price is indicative.
  if (tierOf(p) === 'buy' || SITE.pricesAreFixed) {
    o.offers = { '@type': 'Offer', price: p.priceINR, priceCurrency: 'INR', availability: 'https://schema.org/MadeToOrder', url: o.url,
      seller: { '@id': `${site}/#org` }, areaServed: 'IN' };
  }
  return o;
}
export function faqLd(items) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: items.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.text } })) };
}
