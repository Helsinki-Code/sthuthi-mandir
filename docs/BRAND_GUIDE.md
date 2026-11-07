# Sthuthi brand guide (web)

Every decision here traces back to the Sthuthi logo or to the product visualisations.

## Source of truth: the logo
- **Paper `#fef9f2`**: sampled from the logo's background (median of its border pixels, `scripts/logo-variants.mjs`). It is the light-theme page colour, so the original artwork sits on the colour it was drawn on.
- **Maroon `#770f0a`**: the temple and wordmark colour. Used for primary actions and emphasis (10.8:1 on paper).
- **Temple gold `#c8902f`**: the finial, arch outline and lotus. Used only for hairlines, numerals and ornament. Gold text uses the deeper `#8a5a12` (5.6:1) so it passes WCAG AA.
- **Shapes**: the cusped arch over the logo's sanctum is the site's one signature motif. It masks the hero and collection imagery (`#arch-clip`). The lotus under the wordmark is redrawn as a line ornament for section rules.
- **Line quality**: the logo is flat, crisp and unshaded, so the UI uses hairlines, a 2 px radius on tables and inputs (drafting precision), and almost no shadow.

### Logo variants (`public/brand/`)
| File | Use |
|---|---|
| `logo-full.*` | Stacked lockup: footer, About |
| `logo-wordmark.*` | Header (crop of the wordmark and lotus rule) |
| `logo-mark.*` | Temple mark (crop), source for icons |
| `favicon-32.png`, `icon-180/192/512.png` | Favicon, touch and manifest icons: the mark on its own paper colour |
| `sthuthi-logo-original.png` | Untouched original |

Background removal is colour-to-alpha against the logo's own paper colour, so the artwork is unchanged when shown on that colour. **The logo is never recoloured.** On dark surfaces it sits on a paper-coloured plate (`.logo-plate`), the way a brass nameplate sits on dark wood. Every `<img>` of the logo has width and height in the file's exact ratio; the audit (C11) checks this.

## Two environments, not one inverted palette
- **Light, "Mandapa"**: the bright outer hall. Paper, rosewood-ink text `#241713`, maroon actions.
- **Dark, "Garbhagriha"**: the lamp-lit sanctum seen in the visualisations. Stone-brown `#17110f` (never pure black), ivory text `#efe6d8`, and gold `#e2b868` takes over as the accent because maroon falls flat on dark. Maroon actions are lifted to `#8e1d15`.
- Dark "sanctum" bands appear in light mode too (fit checker, floor load, footer). They are the deliberate change of mood, the step from the hall into the sanctum.
- The theme follows `prefers-color-scheme`; the toggle overrides it and is remembered. The switch is a single 200 ms crossfade.

## Typography
- **Display: Cormorant Garamond.** A high-contrast serif with the same sharp, flared terminals as the Sthuthi wordmark. Used at 500 weight; italic for one emphasised phrase per hero.
- **Body: Noto Sans.** Chosen for Indian scripts: Noto Sans Devanagari, Tamil, Telugu, Kannada and Malayalam (and Noto Serif Devanagari for display) share its metrics, so any regional text added later sets consistently. They are declared with `unicode-range` and download only when a page contains that script. Set `lang="hi"`, `lang="ta"` and so on on regional text, and mark it for native-speaker review (`data-review="native-speaker"`). The supplied workbook contains no regional-language text, so none is published.
- Only Latin subsets of the brand fonts load. ₹ comes from a 1 KB subset cut from each font (`src/assets/fonts/`).
- Numbers in specifications use tabular lining figures.

## Tokens (`src/styles/global.css`)
- Colour: `--paper`, `--paper-2/3`, `--ink`, `--ink-2/3`, `--line`, `--line-strong`, `--accent`, `--gold`, `--gold-text`, `--surface-dark`, `--on-dark`, `--focus`, each with a dark-theme value.
- Type scale: `--fs-xs` to `--fs-2xl` (fluid `clamp`), `--lh-*`.
- Space: `--s-1` to `--s-9` (4 px base); `--gutter` is fluid with a 16 px minimum.
- Radius: `--r-1` 2 px (tables, inputs), `--r-2` 6 px (buttons), `--r-pill`.
- Shadow: `--shadow-1`, `--shadow-2`, used only on the floating compare tray.
- Motion: `--ease`, `--t-fast` 140 ms, `--t-med` 260 ms. `prefers-reduced-motion` removes all of it.

## Layout and patterns
- Asymmetric hero (6:5) with the arch-masked image. Sections alternate paper, deeper ivory and the dark sanctum.
- Lists of steps or inclusions use a **numbered ledger** (gold numeral, title, text on hairlines) instead of icon cards.
- Collections are alternating editorial rows, not a card grid.
- Product specifications look like a drafting sheet: hairline tables plus a to-scale SVG elevation drawn from the data.

## Voice
Warm, calm, specific. Button-styled calls to action are fixed by the price rule: below the payment threshold the primary is "Buy now — ₹price"; at or above it, "Chat with us on WhatsApp". "Book a design consultation" is always the secondary, and "Chat on WhatsApp" is used elsewhere. Nothing else invites payment ("Pay", "Reserve", "Add to cart"). Other actions are text links or form controls ("Check the fit"). No superlatives, no invented claims. Temple designs are always "inspired by", never anything implying a copy or an affiliation. "Ivory" always comes with "Ivory-finish paint. No animal ivory used."

## Imagery
Every product image is shown on its own (no collages) and labelled **Visualisation** until it is marked as a photograph in `data/image-overrides.json`.
