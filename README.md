# Sthuthi: online store

A static, data-driven storefront for Sthuthi's made-to-order home mandirs. Every product page, collection page, filter, specification table, drawing, sitemap entry and schema block is generated from two files the owner maintains: the **catalogue CSV** and the **measurements workbook**.

## Stack and why
- **Astro 7 (static output)**: every page is pre-rendered HTML, so it is fast, crawlable and needs no server. JavaScript ships only for the interactive parts (gallery, fit checker, filters, compare, form), with no framework runtime.
- **Node data pipeline** (`scripts/build-data.mjs`): `csv-parse` and `exceljs` read the sources at build time; `sharp` produces responsive AVIF and WebP images.
- **Vanilla CSS with design tokens**. See `docs/BRAND_GUIDE.md`.
- **Payment server** (`server/`): a small Node server (no framework) that serves `dist/` and three API routes for Stripe Checkout. It is the only part that needs a server; everything else is static.

## Setup
```bash
cd site
npm install
npm run build      # data pipeline + images + site + sitemaps
npm run preview    # node server/server.mjs: the site plus the payment API, http://localhost:4321
```
`npm run dev` runs the pipeline and starts the dev server with hot reload.

Build settings (environment variables, or `site/.env`; rebuild after changing one):
| Variable | Purpose |
|---|---|
| `SITE_URL` | Live domain, e.g. `https://www.example.com`. Used for canonicals, sitemaps and schema. **Required before deploying.** |
| `CONTACT_EMAIL` | The one place the email address is set. While empty, no email address or email link appears anywhere (pages, footer, policies, schema). Once set, it appears on the contact page, in the footer, in the policy tables and in the Organization schema. |
| `PAYMENTS_ENABLED` | `true`: products priced below `FULL_PAYMENT_MAX_INR` get "Buy now — ₹price" (Stripe Checkout). `false`: nothing can be paid on the site, and every product gets the WhatsApp route. |
| `FULL_PAYMENT_MAX_INR` | The one price threshold (default `500000`). Below it: pay in full online. At or above it: "Chat with us on WhatsApp" and no payment option. Read from the CSV price, never a list of SKUs. Set it for both the build and the server. |
| `PUBLIC_CONSULT_ENDPOINT` | URL that receives the consultation form as JSON (`POST`). Every valid submission is also handed off to WhatsApp with the details prefilled; while this is empty, WhatsApp is the only route. |

Payment server settings (environment variables, or `site/.env`; restart the server after changing one):
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server only. `sk_test_…` until the flow is signed off, then the owner's live key. Without it, "Buy now" answers "Online payment is not available right now" and offers WhatsApp. |
| `STRIPE_PUBLISHABLE_KEY` | Kept for completeness. Hosted Checkout is opened by a server-side redirect, so the browser never needs it. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint `https://<domain>/api/stripe-webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`). Orders are confirmed only by a verified webhook. |
| `ORDER_ENDPOINT` | URL that receives each confirmed order as JSON (`POST`). Falls back to `PUBLIC_CONSULT_ENDPOINT`. |
| `ORDERS_DIR` | Where confirmed orders are stored as JSON (default `var/orders`). Keep it on persistent disk and out of the web root. |

Phone, WhatsApp number, seller identity, grievance officer and lead times are in `data/business.json`.

### How online payment works
1. The product page (price below the threshold) shows **Buy now — ₹price**. The buyer enters the delivery PIN code and room width, depth and ceiling height, and ticks "I have read the Delivery & Installation, Cancellation and Refund policies". The pay button stays disabled until the PIN is valid, the room passes the fit check and the box is ticked. If the fit check fails, the buyer is offered WhatsApp instead.
2. `POST /api/checkout` repeats every check on the server, using the server's own catalog for the price, and refuses products at or above the threshold. Only then does it create a Stripe Checkout Session (INR, amount in paise, shipping limited to India) and return its URL.
3. Stripe sends `checkout.session.completed` to `/api/stripe-webhook`. The signature is verified, the amount is compared with the catalog, the order is stored and sent to `ORDER_ENDPOINT`.
4. `/order/confirmed/` shows the order only after that webhook has arrived, then offers a WhatsApp follow-up with the order details.

Test mode: `stripe listen --forward-to localhost:4321/api/stripe-webhook` gives a `whsec_…` for local testing; pay with Stripe's test card 4242 4242 4242 4242.

## Data files (`site/data/`)
| File | Owns |
|---|---|
| `mandir-catalogue.csv` | Names, slugs, collections, prices, descriptions, inclusions, customisation, SEO fields, image alt texts |
| `Sthuthi_Mandir_Measurements.xlsx` | All dimensions, weights, idols, pooja-kit items, installation standards |
| `Products/<slug>/*.png` | Product images. The folder name must equal the CSV `Slug`. |
| `sthuthi-logo.png` | Logo source. Run `npm run logo` after replacing it. |
| `taxonomy.json` | Classification rules only (deity names, material keywords) used to build filters. No product facts. |
| `image-overrides.json` | Optional per-image changes, e.g. `{ "somnath-…/file.png": { "kind": "photo", "alt": "…", "order": 0 } }` |
| `owner-resolutions.json` | Owner-confirmed fixes for CSV/workbook conflicts (currently JYL-10 yoni finish, RHM-05 tiers). Applied in memory by the pipeline and the audit; the source files are not rewritten. An entry becomes a no-op once the master file says the same thing. |
| `business.json` | Seller identity (legal name, CIN, PAN, registered office), phone and WhatsApp, grievance officer, lead times, policy effective date. |
| `store-policies.md` | The "Sthuthi Store Policies" document, word for word. Section 1–7 become `/policies/<slug>/`; the text before section 1 is `/policies/`. Edit the wording here, never in page code. |

### CSV columns used
`SKU`, `Product Name`, `Slug`, `Collection`, `Product Type`, `Inspired By`, `Architecture Style`, `Primary Material`, `Accents & Finishes`, `Deities Included`, `Pooja Items Included`, `Customisation`, `Availability`, `Price INR (India, indicative)`, `Short Description`, `Long Description (HTML)`, `Key Features` (`|`-separated), `Meta Title`, `Meta Description`, `Focus Keyword`, `Secondary Keywords`, `Tags`, `Product Image Alt Texts` (`|`-separated, same order as the Drive links), `Image Count`. Columns are found by name, so their order does not matter.

### Workbook sheets used
- **Structure Sizes**: one row per SKU. Width, depth and height (cm), apartment edition height, niche W/D/H, altar height, door opening, weight min/max, design notes. The ft-in, footprint, minimum ceiling, floor load and installation requirement are **recomputed** from these and the standards, then checked against the workbook's own cached values. A mismatch fails the data audit.
- **Idol Sizes**: one row per figure. `Set` is `Single`, `Shown` or `Alternate`; Shown and Alternate become tabs on the product page.
- **Pooja Kit Sizes**: one row per item.
- **Installation Standards**: ceiling clearance, floor design load, occupancy, sign-off weight, transport modules, apartment maximum height. Rows are found by their label.

## Updating products and sizes
1. Edit the CSV and/or the workbook (keep the SKU identical in both).
2. For a new product, add a CSV row, a Structure Sizes row, its idol and kit rows, and an image folder `data/Products/<slug>/`.
3. `npm run build`, then check `reports/data-audit.md` for join gaps and conflicts.
4. `npm run audit` (static QA, C1–C17, including the payment flow against a local Stripe stand-in), then with `npm run preview` running, `node scripts/browser-audit.mjs` (C9 layouts at 360/768/1280/1920, console errors, Lighthouse).

Nothing about a product is typed into the site's code. The audit's C8 check changes a price and a height in a temporary copy, rebuilds, and confirms every page picks up the change.

## Deploying
```bash
cd site
SITE_URL=https://www.your-domain.in npm run build
PORT=8080 HOST=0.0.0.0 node server/server.mjs
```
The site now needs a Node 20+ host (a VPS, Render, Railway, Fly.io, or similar) because Stripe Checkout and the webhook run on the server. Put HTTPS in front (a reverse proxy or the platform's own). `server/server.mjs` serves `dist/` with long cache headers for `/img/` and `/_astro/` and `404.html` for missing paths, so no separate static host is needed. If you prefer a static host for the pages, deploy `dist/` there and the three `/api/*` routes (`server/app.mjs`) as functions on the same domain.

## Reports
- `reports/data-audit.md`: join results, CSV/workbook conflicts, SEO rewrites, image matching
- `reports/qa-audit.md`, `reports/browser-audit.md`: latest QA run
- `reports/placeholders.md`: build settings that are still empty (the site itself shows no placeholders)
- `REPORT.md` (repo root of `site/`): delivery report
