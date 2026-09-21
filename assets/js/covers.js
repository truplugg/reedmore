/* ============================================================
   READMORE — generated covers
   Every cover is an original typographic design built from the
   book's own palette and one geometric plate, in the register of
   Ukrainian avant-garde book jackets. No publisher artwork is
   reproduced anywhere on this site.
   ============================================================ */

import { STITCH } from './stitch.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* geometric plates, drawn to the cover's own aspect box */
function motif(name, pal) {
  const a = pal.accent;
  const i = pal.ink;
  const box = (inner) => `<svg viewBox="0 0 100 153" preserveAspectRatio="none" aria-hidden="true" focusable="false">${inner}</svg>`;

  switch (name) {
    case 'bars':
      return box(`
        <rect x="0" y="18" width="74" height="4" fill="${a}"/>
        <rect x="0" y="27" width="46" height="4" fill="${i}" opacity=".35"/>
        <rect x="0" y="36" width="88" height="4" fill="${a}" opacity=".55"/>`);
    case 'circle':
      return box(`
        <circle cx="66" cy="44" r="30" fill="${a}" opacity=".9"/>
        <circle cx="66" cy="44" r="30" fill="none" stroke="${i}" stroke-width="0.6" opacity=".4"/>`);
    case 'arc':
      return box(`
        <path d="M0 74 A50 50 0 0 1 100 74 Z" fill="${a}" opacity=".92"/>
        <path d="M14 74 A36 36 0 0 1 86 74" fill="none" stroke="${i}" stroke-width="0.8" opacity=".45"/>`);
    case 'grid':
      return box(`
        <g fill="none" stroke="${a}" stroke-width="0.9" opacity=".85">
          ${[0, 1, 2].map((c) => [0, 1, 2, 3].map((r) =>
            `<rect x="${12 + c * 26}" y="${16 + r * 26}" width="20" height="20"/>`).join('')).join('')}
        </g>
        <rect x="38" y="68" width="20" height="20" fill="${a}"/>`);
    case 'diag':
      return box(`
        <g stroke="${a}" stroke-width="2.4" opacity=".9">
          ${Array.from({ length: 9 }, (_, n) =>
            `<line x1="${-30 + n * 16}" y1="153" x2="${40 + n * 16}" y2="0"/>`).join('')}
        </g>`);
    case 'dots':
      return box(`<g fill="${a}">${
        Array.from({ length: 7 }, (_, r) => Array.from({ length: 5 }, (_, c) =>
          `<circle cx="${12 + c * 19}" cy="${18 + r * 15}" r="${Math.max(0.8, 5 - r * 0.62)}"/>`).join('')).join('')
      }</g>`);
    case 'square':
      return box(`
        <rect x="14" y="16" width="72" height="72" fill="none" stroke="${a}" stroke-width="1.6"/>
        <rect x="14" y="16" width="34" height="34" fill="${a}"/>`);
    case 'wave':
      return box(`<g fill="none" stroke="${a}" stroke-width="1.2" opacity=".85">${
        Array.from({ length: 7 }, (_, n) =>
          `<path d="M0 ${132 - n * 15} Q 33 ${112 - n * 15}, 60 ${132 - n * 15} T 120 ${132 - n * 15}"/>`).join('')
      }</g>`);
    default:
      return '';
  }
}

/* wrap a title into balanced lines for the stacked template */
function stackLines(title, max = 4) {
  const words = title.replace(/[«»]/g, '').split(/\s+/);
  if (words.length <= max) return words;
  const out = [];
  const per = Math.ceil(words.length / max);
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '));
  return out.slice(0, max);
}

/**
 * Cover artwork markup. `compact` drops the imprint line for
 * thumbnails, where it would only add noise.
 */
export function coverHTML(book, { compact = false } = {}) {
  /* A book added through the admin desk carries its own artwork; the rest
     of the catalogue is set from the templates below. */
  if (book.cover.front) {
    return `<div class="cv cv--photo"><img src="${esc(book.cover.front)}" alt="" draggable="false"></div>`;
  }
  const { style = 'stack', pal, motif: art = 'none' } = book.cover;
  const title = esc(book.title);
  const author = esc(book.author);
  const imprint = compact ? '' : `<div class="cv__imprint">${esc(book.publisher)}</div>`;

  let body;
  switch (style) {
    case 'stack':
      body = `
        <div class="cv__author">${author}</div>
        <div class="cv__rule"></div>
        <h3 class="cv__title">${stackLines(title).map(esc).join('<br>')}</h3>
        ${imprint}`;
      break;
    case 'band':
      body = `
        ${imprint}
        <div style="margin-block:auto;display:flex;flex-direction:column;gap:.45em">
          <div class="cv__rule"></div>
          <h3 class="cv__title">${title}</h3>
          <div class="cv__rule"></div>
          <div class="cv__author" style="margin-block-start:.5em">${author}</div>
        </div>`;
      break;
    case 'plate':
      body = `
        <div class="cv__author">${author}</div>
        <h3 class="cv__title" style="margin-block-start:auto">${title}</h3>
        ${imprint}`;
      break;
    case 'column':
      body = `
        <div class="cv__author">${author}</div>
        <h3 class="cv__title" style="margin-block-start:.6em">${title}</h3>
        <div class="cv__rule" style="inline-size:40%;margin-block-start:auto"></div>
        ${imprint}`;
      break;
    case 'serif':
      body = `
        <div class="cv__author">${author}</div>
        <div class="cv__rule"></div>
        <h3 class="cv__title">${title}</h3>
        <div class="cv__rule"></div>
        ${imprint}`;
      break;
    default: /* split */
      body = `
        <div>
          <div class="cv__author">${author}</div>
          ${imprint}
        </div>
        <h3 class="cv__title">${title}</h3>`;
  }

  const columnBand = style === 'column'
    ? `<div style="position:absolute;inset-block:0;inset-inline-end:0;inline-size:18%;background:${pal.accent};opacity:.95"></div>`
    : '';

  return `
    <div class="cv cv--${esc(style)}" style="--cv-p:${pal.paper}">
      <div class="cv__art">${motif(art, pal)}</div>
      ${columnBand}
      <div class="cv__body">${body}</div>
    </div>`;
}

/** Small cover used in the cart, palette and related rows. */
export function thumbHTML(book) {
  return `<div class="line__thumb" style="background:${book.cover.pal.paper};color:${book.cover.pal.ink}">${
    coverHTML(book, { compact: true })
  }</div>`;
}

/**
 * The endpaper. Each title gets a cross-stitch motif from the Ukrainian
 * embroidery vocabulary — an eight-pointed star, a hooked rhombus, a
 * counted cross, a running zigzag — tiled in the book's own accent and
 * printed back, the way a real paste-down is.
 */
export function endpaperSVG(kind, uid) {
  const m = STITCH[kind] || STITCH.star;
  const id = `ep-${kind}-${uid}`;
  const gap = 10;                       /* five stitches of plain ground */
  const w = m.w + gap, h = m.h + gap;
  return `<svg class="endpaper" viewBox="0 0 100 153" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="scale(.66)">
      <g fill="currentColor" transform="translate(${gap / 2},${gap / 2})">${m.d}</g>
    </pattern></defs>
    <rect width="100" height="153" fill="url(#${id})"/>
  </svg>`;
}

/** The shop's device: one embroidered rhombus, set on the title page. */
export function deviceSVG() {
  const m = STITCH.rhomb;
  return `<svg class="book__device" viewBox="0 0 ${m.w} ${m.h}" aria-hidden="true"><g fill="currentColor">${m.d}</g></svg>`;
}
