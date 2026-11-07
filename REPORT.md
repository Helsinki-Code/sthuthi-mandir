# Sthuthi store: delivery report

Updated 6 November 2026. The site is in `site/`. Build it with `npm install && npm run build`, then run it with `npm run preview` (the site plus the payment API). See `README.md`.

## Current state
- **61 pages built.** 59 are in the sitemap; `404.html` and `/order/confirmed/` (noindex) are not.
  - Home, the all-mandirs listing, compare
  - 3 collection hubs and **33 product pages**
  - How it works; what's included; materials; size guide; book a consultation; about; FAQ; contact
  - **Policies index + 7 policy pages**
  - Journal index + 3 guides
  - Order confirmation
- **Payment rule by price** (threshold `FULL_PAYMENT_MAX_INR=500000`, read from the CSV price):
  - **2 SKUs** are under ₹5,00,000 and can be bought online in full with Stripe Checkout: SDM-02 (₹3,85,000) and SDM-11 (₹4,55,000).
  - **31 SKUs** at ₹5,00,000 and above have no payment option. Their primary CTA is "Chat with us on WhatsApp", with the prefilled message.
- **Seller identity, contact and policies** come from your documents:
  - `data/business.json`
  - `data/store-policies.md` (word for word)
- Email is hidden everywhere until `CONTACT_EMAIL` is set.

## QA audit cycles
| Cycle | Flags | What was found and fixed |
|---|---|---|
| 1–5 | 10 → 69 → 2 → 0 → 0 | Original build (see the earlier sections of this file's history): layout overflow, fonts, accessibility, gallery performance. |
| 6 | 0 static | After the owner data update (seller, policies, no GST, no placeholders). C12–C15 added. The first run of the new checks found empty form-error containers (live regions, correctly exempted), one genuinely empty table header (fixed), and link markup breaking the verbatim policy comparison (the check was fixed; the text was already verbatim). |
| 7 | 0 static, 11 browser | After the payment rule. C16–C17 added. The browser found the new "Buy online" label and the current policy link unreadable in **dark mode** (maroon text on the dark sanctum). Mobile performance on two listing pages fell to 87–89, because the new Node server sent files uncompressed. Fixed with a text-safe accent token and brotli/gzip in the server. |
| 8 | **0** | Final run: static and browser both clean. |

Cycle 8:
- **Static audit** (`reports/qa-audit.md`): **0 flags** across C1–C17 (C9: 7,758 links and sources resolve; C12: 4,010 assertions; C15: 1,347; C16: 215; C17: 42; C8 and C14 mutation rebuilds pass)
- **Browser audit** (`reports/browser-audit.md`): **0 flags.** 240 page loads (60 pages × 360/768/1280/1920 px) with no overflow, console errors, failed requests or broken images. The browser C17 test passes on both buy-tier SKUs. Lighthouse on 14 page types, mobile and desktop: Accessibility, Best Practices and SEO 100 on every run; Performance 91–100 (lowest: home page on mobile).

What C12–C17 check:
- **C12.** No `[…]`, TBC, "to be confirmed", "coming soon" or empty fields on any page or in any schema or meta tag. No GST, GSTIN or tax-invoice wording anywhere.
- **C13.** Payment only where the price rule allows it:
  - No gateway script, card field or Stripe key reaches the browser.
  - No payment wording outside the two buy-tier product pages.
  - Every consultation button reads "Book a design consultation"; every WhatsApp button reads "Chat on WhatsApp" or "Chat with us on WhatsApp".
- **C14.**
  - With `CONTACT_EMAIL` empty, no email address or mailto link appears in any HTML, JS, JSON or XML file.
  - The mutation rebuild sets `CONTACT_EMAIL` and confirms the address then appears on the contact page, in the footer, in both policy tables and in the Organization schema.
- **C15.** Checked against values typed from your instruction, not read from the site's own data file:
  - On every page: phone, `tel:` and `wa.me` links, CIN, PAN, seller name, registered address, the footer line, the footer links to all 7 policies, and the Organization schema.
  - Lead times: only "10–16 weeks" and "18–28 weeks" may appear, and each product page and its schema show the right one.
  - Every heading, paragraph, list item and table cell of the policy document appears word for word on its page.
- **C16.**
  - Each SKU's tier is computed independently from the CSV price, then checked on its product page, listing card, compare data and schema (an Offer only where the price is actually charged).
  - The real payment server is then started against a local Stripe stand-in:
    - Buy tier: the Checkout Session gets the catalog price in paise and ignores a tampered price from the browser. A signed webhook confirms the order, the order reaches the business endpoint, and the confirmation status turns "confirmed".
    - WhatsApp tier: the server refuses checkout (403) and returns the correct WhatsApp link.
- **C17.**
  - Server side: no consent, consent sent as text, an invalid PIN, a missing room, too small a floor, too low a ceiling, or a browser claiming "it fits" are all refused before Stripe is called.
  - The order is not shown before the webhook arrives, and not shown after a webhook with a bad signature, an unpaid session or a wrong amount.
  - Browser side: the pay button is disabled on load, on a failed fit (WhatsApp is offered instead), without consent and with a bad PIN. It is enabled only when everything passes.

## Stripe test mode, checked through the connector
- The connector reaches one account, **"Sthuthi", test mode only**.
- I created one Checkout Session for SDM-02 with exactly the parameters the server sends. Stripe accepted it:
  - `currency: inr`, `amount_total: 38500000` (₹3,85,000)
  - shipping limited to India
  - payment methods **card and Link**
- That session (`cs_test_a1UIW3…`) cannot be expired through the connector; it expires on its own within 24 hours.
- No money moved, and no live-mode call was made.
- **Not yet done:** a full purchase with a test card and a real webhook delivery. That needs your test keys in `site/.env` (`STRIPE_SECRET_KEY=sk_test_…` and the `whsec_…` from `stripe listen`). Every step of the flow passes against the local Stripe stand-in (C16/C17).

## Data resolutions (6 November 2026)
Both are applied from `data/owner-resolutions.json`; your master files are not rewritten.
- **JYL-10:** the yoni / peetham is now "Black stone, silver-plated", at 20 × 45 × 60 cm. This shows in the Idols table, the data model and the Product schema (`additionalProperty`).
- **RHM-05:** now reads "three-tier altar" in its description and highlights. The design notes keep the tiers at 60 / 80 / 100 cm.
- Conflicts went from 60 to 57. What remains are the known dimension and material wording notes.
- Update the master CSV and workbook when convenient; the resolutions then become no-ops automatically.

## Pages changed
- **New:**
  - `/policies/`
  - `/policies/deposit-payment-cancellation/` (replaces `/policies/deposit-cancellation/`, now removed)
  - `/policies/grievance-redressal/`
  - `/order/confirmed/`
- **Every page:**
  - Footer: seller line, phone and WhatsApp, links to all 7 policies
  - Header: CTA now "Book a design consultation"; WhatsApp added in the mobile menu
  - Organization schema: legal name, brand, CIN, address, telephone
- **Content changed:**
  - `/` (CTAs, commission steps, lead times, price rule)
  - `/mandirs/` (Buy online / Enquire on WhatsApp labels)
  - `/compare/` (tier label and tier CTA)
  - all **33 product pages**:
    - GST line removed
    - lead time added
    - tier CTAs
    - kit notes moved under item names (no empty cells)
    - on SDM-02 and SDM-11: the buy panel and an Offer schema
  - `/about/`, `/contact/`, `/faq/`, `/how-it-works/`, `/book-consultation/` (WhatsApp handoff), `/materials-craftsmanship/`, `/journal/walk-in-pooja-cabin-or-mandir-cabinet/`
  - the 5 existing policy pages, rewritten from your document
- **Header, footer and schema only:**
  - `/404.html`
  - the 3 collection pages
  - `/complete-sanctum/`, `/size-guide/`
  - `/journal/` and its other 2 guides
  - The size guide's fit-result button now reads "Book a design consultation".

## Decisions and open items for you
1. **The payment policy does not cover online payment yet.** Section 2 still describes the four-stage schedule, while SDM-02 and SDM-11 are now paid in full. I kept your policy text word for word and am waiting for the revised text you mentioned. Please don't switch to live keys before it is published.
2. **GST.** Your previous instruction was "No GST yet → the site takes no payments". Online payment is now on for the two SKUs under ₹5 lakh.
   - No GST wording is shown, and Stripe's automatic tax is off.
   - Please confirm with your CA that collecting payment before GST registration is fine for your turnover.
3. **"Indicative price".** The CSV calls every price indicative, but SDM-02 and SDM-11 are now charged that exact amount.
   - Their label reads "Price, paid in full online", and they carry an Offer in the schema.
   - The other 31 keep "Indicative price".
4. **Hosting.** On Vercel (https://sthuthi-mandir.vercel.app) the three payment routes run as Vercel Functions (`api/*.mjs`), and orders are kept in Stripe on each PaymentIntent, because Vercel's disk does not persist. On any other Node host, `server/server.mjs` serves the site and the routes and stores orders as files. C16/C17 run the full payment flow against both. Cycle 9 (7 November): 0 flags.
5. **UPI.** The Stripe test account offers card and Link only. If you want UPI, enable it in the Stripe dashboard; no code change is needed.
6. **`STRIPE_PUBLISHABLE_KEY`** is read but not needed: hosted Checkout opens through a server-side redirect.
7. **Grievance policy, step 1** says "Email or call the Grievance Officer", but there is no email yet. It is kept word for word.
8. **No Diwali banner exists** on the site, so none was changed or added. Send the wording if you want one; it would reserve a consultation slot only.
9. **`SITE_URL`** is still the example domain in canonicals, sitemaps and schema. On Vercel, set it to `https://sthuthi-mandir.vercel.app` (or the custom domain) in the project's environment variables, together with `PAYMENTS_ENABLED=true`; the live build currently has neither, so SDM-02 and SDM-11 still show the WhatsApp button there.

## Dependency note
- `stripe` 23.0.1 was added (released 22 October 2026).
- `npm audit` still reports the 2 moderate `uuid` advisories in `exceljs`. They are build-time only and never reach the browser.
