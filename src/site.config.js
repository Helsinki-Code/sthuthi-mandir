/**
 * Site configuration. Owner-supplied business facts live in data/business.json; switches come from
 * environment variables (or site/.env) at build time. Nothing here may be filled with a guess:
 * a value that does not exist yet is left empty and every element that would show it is left out.
 */
import business from '../data/business.json';
import { paymentTier, DEFAULT_FULL_PAYMENT_MAX_INR } from './lib/tier.js';

const env = (k) => String(process.env[k] ?? import.meta.env?.[k] ?? '').trim();

export const SITE = {
  name: business.brand,
  url: process.env.SITE_URL || import.meta.env?.SITE || 'https://www.sthuthi.example',
  locale: 'en-IN',
  tagline: 'Complete home mandirs, made to order',
  // Consultation form posts JSON here (PUBLIC_CONSULT_ENDPOINT). Every submission is also handed off to WhatsApp.
  consultEndpoint: env('PUBLIC_CONSULT_ENDPOINT'),
  // CONTACT_EMAIL: empty = no email address or email link anywhere on the site or in the schema.
  contactEmail: env('CONTACT_EMAIL'),
  // PAYMENTS_ENABLED: while false, nothing can be paid on the site. While true, only products priced
  // below FULL_PAYMENT_MAX_INR get "Buy now" (Stripe Checkout, hosted, created by server/app.mjs).
  paymentsEnabled: env('PAYMENTS_ENABLED') === 'true',
  fullPaymentMaxInr: Number(env('FULL_PAYMENT_MAX_INR') || DEFAULT_FULL_PAYMENT_MAX_INR),
  // Show schema.org Offer only if prices are fixed public prices. The CSV labels prices "indicative".
  pricesAreFixed: false,
};

export const BUSINESS = business;
export const PHONE = business.phone;
export const WHATSAPP_URL = `https://wa.me/${business.phone.whatsapp}`;
export const TEL_URL = `tel:${business.phone.e164}`;
export const waLink = (text) => (text ? `${WHATSAPP_URL}?text=${encodeURIComponent(text)}` : WHATSAPP_URL);
/** Lead time for a product, from data/business.json. */
export const leadTime = (p) => (p?.structure?.walkIn ? business.leadTimes.walkInCabin : business.leadTimes.cabinet);
/** 'buy' or 'whatsapp' for a product, from its CSV price (see src/lib/tier.js). */
export const tierOf = (p) => paymentTier(p.priceINR ?? p.price, { maxInr: SITE.fullPaymentMaxInr, paymentsEnabled: SITE.paymentsEnabled });
