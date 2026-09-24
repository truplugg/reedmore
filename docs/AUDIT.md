# Ridmore — audit of the existing project

Taken at commit `47071d9`, before any change. 28 tracked files, 7 979 lines.

## 1. Stack as found

| Question | Answer |
|---|---|
| Framework | **None.** Hand-written HTML + native ES modules. |
| Build step | **None.** `index.html` loads `assets/js/main.js` as `type="module"`; the browser resolves the graph. |
| Routing | **None.** One page (`index.html`) plus a second document (`admin.html`). Navigation is in-page anchors; catalogue state is mirrored into the query string (`?q=&g=&f=&s=&w=`) by hand. |
| State management | `assets/js/store.js` — a 103-line store: one object, `subscribe/emit`, persisted to `localStorage` under `readmore.v1`. Holds `lang, currency, theme, view, cart{id:qty}, wish[]`. Every storage access is already try/caught. |
| Styling | 8 hand-written stylesheets, 3 258 lines, driven by **131 custom properties** in `tokens.css`. Themes are declared three times: bare `:root` (light), `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. A `--block-*` set inverts between themes and is mapped by `.block-ground` / `.section--block`. |
| 3D | **CSS 3D, not WebGL.** `transform-style: preserve-3d` + `perspective`. No three.js, no canvas, no dependency of any kind. |
| Dependencies | **Zero.** No `package.json`. |
| Backend | None. |
| Database | None. `assets/js/data/books.js` is a 403-line literal of 26 books. |
| Auth | None. |
| API | None. |
| Admin | `admin.html` + `admin.js` — a real, working book-composer with live 3D preview, cover upload (canvas downscale → WebP), and `localStorage` persistence (`readmore.books.v1`). No server, no accounts. |
| Storage | `localStorage` only, including base64 cover images (with a quota guard in `custom.js`). |
| Deployment | Static. `.nojekyll` + `robots.txt` imply GitHub Pages. |

## 2. What exists and is worth keeping

Everything below is production-quality and must survive.

**The book object** — `book3d.js` (372 lines) + `book.css` (762 lines).
A real six-face volume: front board, back board, spine, fore-edge, page block, endpaper.
`bookHTML(book, {mode})` renders it; `mountBooks(root, {onDetails})` wires behaviour.
Three view states already exist (`setBookView`: front / spread / back) and the fore-edge is
built to survive rasterisation at every pixel ratio. **Reuse wholesale.**

**Cover artwork** — `covers.js` (233 lines): six typographic templates, nine cross-stitch
motifs (`stitch.js`), a generated back board with barcode, endpapers. Covers are *generated*
from a palette + style + motif, or replaced by an uploaded photo. This is exactly the
"apply an image to the 3D template" mechanism the brief asks for — it already exists.

**Catalogue** — `catalog.js` (306 lines): filter by genre/format/wishlist, search, five sort
orders, URL sync, grid/list views, animated "show more" that measures and grows the shelf.

**Record modal** — `dialog.js` (186 lines) + `.dialog` in `overlays.css`: focus trap, phone
sheet layout, related books, the three-view switch. **Keep; extend.**

**Cart** — `cart.js` (157 lines) + `.drawer`: side drawer, quantities, free-shipping goal,
wishlist counter. **Keep; extend.**

**Motion** — `motion.js` (261 lines): reveals, the scroll-driven band, hero, counters,
embroidery stitch-in, parallax. All gated on `prefers-reduced-motion`.

**i18n** — `i18n.js` (449 lines): `t()`, `data-i18n` / `data-i18n-attr` application, a
subscribe hook. The mechanism is sound; only the dictionary needs changing.

**Shell** — `ui.js`: theme toggle, toasts, header scroll state, mobile nav, section spy.

## 3. What the brief requires that does not exist

Backend, database, auth, RBAC, admin beyond the book composer, media storage, journal CMS,
wishlists, gift flow, orders, checkout, theme engine with draft/publish, German locale,
per-currency prices, server-side SEO, tests.

## 4. Gaps against the brief in what *does* exist

- **Brand**: `Readmore` appears 43 times across 26 files.
- **Languages**: `LANGS = { uk, en }` — no German.
- **Currencies**: five (`UAH EUR PLN CZK GBP`) with a *derived* rate. The brief requires two
  independent, admin-entered prices.
- **Countries**: ten shipping zones across the EU. The brief requires two.
- **Catalogue books open their covers** on hover/hold — the brief removes this.
- **Hero book** is vertical and opens once. The brief wants a horizontal spread that opens
  and turns pages on every visit.
- **Prices** are a single `price` integer in UAH, converted at a hardcoded rate.
- Admin state lives in `localStorage`, so it is per-browser and cannot be shared or secured.

## 5. Consequence for the plan

The frontend is *not* the problem — it is the asset. The absence of a server is the problem.
So: keep every stylesheet, the book object, the covers, the catalogue, the modal, the cart
and the motion layer; move them under `apps/web` untouched; and build a real API beneath
them, swapping the hardcoded data modules for fetches one at a time.
