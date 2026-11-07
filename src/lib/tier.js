// Payment rule by price, shared by the pages, the payment server and the audit.
// One threshold, FULL_PAYMENT_MAX_INR (default 500000), and it is read from the CSV price only:
//   price below the threshold (and PAYMENTS_ENABLED=true) -> 'buy'      pay in full online with Stripe Checkout
//   price at or above the threshold                       -> 'whatsapp' no payment option; enquire on WhatsApp
import { formatINR } from './units.js';

export const DEFAULT_FULL_PAYMENT_MAX_INR = 500000;
export function paymentTier(priceINR, { maxInr = DEFAULT_FULL_PAYMENT_MAX_INR, paymentsEnabled = false } = {}) {
  return paymentsEnabled && Number(priceINR) < Number(maxInr) ? 'buy' : 'whatsapp';
}
export const tierLabel = (tier) => (tier === 'buy' ? 'Buy online' : 'Enquire on WhatsApp');
export const buyLabel = (priceINR) => `Buy now — ${formatINR(priceINR)}`;
/** The WhatsApp message for products at or above the threshold (owner's wording). */
export const enquiryMessage = (sku, name, priceINR) => `Hi Sthuthi, I'm interested in ${sku} – ${name} (${formatINR(priceINR)}).`;
/** Fit verdicts that allow payment: the room takes the standard edition, or the apartment edition. */
export const PAYABLE_VERDICTS = ['standard', 'apartment'];
export const PIN_RE = /^[1-9][0-9]{5}$/;
export const ROOM_LIMITS = { w: [50, 3000], d: [50, 3000], c: [150, 1500] };
