/**
 * The default avatar set (§16).
 *
 * Drawn here rather than uploaded, so a fresh install has them without any
 * storage service configured. Each is a small SVG in the shop's own palette:
 * a counted-stitch mark, a book form, or a plain typographic monogram — the
 * three registers the site already uses. Stored as data URLs in the media
 * table, which is the one case where bytes in the database is right: they are
 * a few hundred bytes each and never change.
 */

const PALETTE = [
  { bg: '#1d3b5c', fg: '#efe9db', ac: '#e0563c' },
  { bg: '#a63a2e', fg: '#f3e9d9', ac: '#e8c15c' },
  { bg: '#2f5d52', fg: '#ede7d6', ac: '#e8a13a' },
  { bg: '#3c3a6b', fg: '#efe9db', ac: '#e8c15c' },
  { bg: '#c9663a', fg: '#1d1a14', ac: '#2f5d52' },
  { bg: '#5c6b3f', fg: '#f1eedf', ac: '#e8c15c' },
  { bg: '#d9cdb4', fg: '#2a2419', ac: '#7a3b2e' },
  { bg: '#4a5560', fg: '#eee9de', ac: '#e0a93b' }
];

/** Counted-stitch marks on a 2px grid, the same vocabulary as the endpapers. */
const MARKS: Record<string, string> = {
  star:  '<rect x="16" y="0" width="4" height="4"/><rect x="12" y="4" width="12" height="4"/><rect x="8" y="8" width="4" height="4"/><rect x="16" y="8" width="4" height="4"/><rect x="24" y="8" width="4" height="4"/><rect x="4" y="12" width="4" height="4"/><rect x="16" y="12" width="4" height="4"/><rect x="28" y="12" width="4" height="4"/><rect x="0" y="16" width="36" height="4"/><rect x="4" y="20" width="4" height="4"/><rect x="16" y="20" width="4" height="4"/><rect x="28" y="20" width="4" height="4"/><rect x="8" y="24" width="4" height="4"/><rect x="16" y="24" width="4" height="4"/><rect x="24" y="24" width="4" height="4"/><rect x="12" y="28" width="12" height="4"/><rect x="16" y="32" width="4" height="4"/>',
  rhomb: '<rect x="16" y="0" width="4" height="4"/><rect x="12" y="4" width="4" height="4"/><rect x="20" y="4" width="4" height="4"/><rect x="8" y="8" width="4" height="4"/><rect x="24" y="8" width="4" height="4"/><rect x="4" y="12" width="4" height="4"/><rect x="28" y="12" width="4" height="4"/><rect x="0" y="16" width="4" height="4"/><rect x="16" y="16" width="4" height="4"/><rect x="32" y="16" width="4" height="4"/><rect x="4" y="20" width="4" height="4"/><rect x="28" y="20" width="4" height="4"/><rect x="8" y="24" width="4" height="4"/><rect x="24" y="24" width="4" height="4"/><rect x="12" y="28" width="4" height="4"/><rect x="20" y="28" width="4" height="4"/><rect x="16" y="32" width="4" height="4"/>',
  cross: '<rect x="0" y="0" width="4" height="4"/><rect x="16" y="0" width="4" height="4"/><rect x="32" y="0" width="4" height="4"/><rect x="4" y="4" width="4" height="4"/><rect x="28" y="4" width="4" height="4"/><rect x="8" y="8" width="4" height="4"/><rect x="24" y="8" width="4" height="4"/><rect x="12" y="12" width="4" height="4"/><rect x="20" y="12" width="4" height="4"/><rect x="16" y="16" width="4" height="4"/><rect x="12" y="20" width="4" height="4"/><rect x="20" y="20" width="4" height="4"/><rect x="8" y="24" width="4" height="4"/><rect x="24" y="24" width="4" height="4"/><rect x="4" y="28" width="4" height="4"/><rect x="28" y="28" width="4" height="4"/><rect x="0" y="32" width="4" height="4"/><rect x="16" y="32" width="4" height="4"/><rect x="32" y="32" width="4" height="4"/>',
  seed:  '<rect x="16" y="0" width="4" height="4"/><rect x="8" y="4" width="4" height="4"/><rect x="24" y="4" width="4" height="4"/><rect x="0" y="8" width="4" height="4"/><rect x="16" y="8" width="4" height="4"/><rect x="32" y="8" width="4" height="4"/><rect x="8" y="12" width="4" height="4"/><rect x="24" y="12" width="4" height="4"/><rect x="12" y="16" width="12" height="4"/><rect x="16" y="20" width="4" height="12"/><rect x="8" y="32" width="20" height="4"/>'
};

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">${inner}</svg>`;

function stitchAvatar(p: typeof PALETTE[number], mark: string) {
  return svg(
    `<rect width="160" height="160" fill="${p.bg}"/>` +
    `<g fill="${p.ac}" opacity=".9" transform="translate(62,62)">${MARKS[mark]}</g>`
  );
}

/** A book seen at the shelf's own resting angle. */
function bookAvatar(p: typeof PALETTE[number]) {
  return svg(
    `<rect width="160" height="160" fill="${p.bg}"/>` +
    `<g transform="translate(48,34)">` +
      `<rect x="52" y="4" width="10" height="88" fill="${p.fg}" opacity=".55"/>` +
      `<rect x="0" y="0" width="56" height="92" rx="2" fill="${p.fg}"/>` +
      `<rect x="0" y="0" width="8" height="92" fill="${p.ac}"/>` +
      `<rect x="18" y="26" width="28" height="3" fill="${p.bg}" opacity=".55"/>` +
      `<rect x="18" y="36" width="20" height="3" fill="${p.bg}" opacity=".35"/>` +
      `<circle cx="32" cy="62" r="11" fill="${p.ac}" opacity=".85"/>` +
    `</g>`
  );
}

/** An open spread, flat on. */
function spreadAvatar(p: typeof PALETTE[number]) {
  return svg(
    `<rect width="160" height="160" fill="${p.bg}"/>` +
    `<g transform="translate(24,48)">` +
      `<path d="M0 8 Q28 0 54 8 L54 62 Q28 54 0 62 Z" fill="${p.fg}"/>` +
      `<path d="M112 8 Q84 0 58 8 L58 62 Q84 54 112 62 Z" fill="${p.fg}"/>` +
      `<rect x="54" y="8" width="4" height="54" fill="${p.ac}"/>` +
      `<g fill="${p.bg}" opacity=".3">` +
        `<rect x="10" y="20" width="34" height="3"/><rect x="10" y="29" width="30" height="3"/><rect x="10" y="38" width="34" height="3"/>` +
        `<rect x="68" y="20" width="34" height="3"/><rect x="68" y="29" width="30" height="3"/><rect x="68" y="38" width="34" height="3"/>` +
      `</g>` +
    `</g>`
  );
}

/** A quiet geometric ground for anyone who wants no figure at all. */
function markAvatar(p: typeof PALETTE[number], n: number) {
  const r = 20 + (n % 3) * 12;
  return svg(
    `<rect width="160" height="160" fill="${p.bg}"/>` +
    `<circle cx="${n % 2 ? 108 : 52}" cy="${n % 3 ? 58 : 102}" r="${r}" fill="${p.ac}" opacity=".9"/>` +
    `<rect x="0" y="${112 - (n % 2) * 56}" width="160" height="6" fill="${p.fg}" opacity=".5"/>`
  );
}

interface SeedAvatar { key: string; url: string; alt: string; bytes: number }

function build(): SeedAvatar[] {
  const out: SeedAvatar[] = [];
  const push = (key: string, body: string, alt: string) => {
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(body)}`;
    out.push({ key, url, alt, bytes: Buffer.byteLength(body, 'utf8') });
  };

  const marks = Object.keys(MARKS);
  marks.forEach((m, i) => push(`avatar/stitch-${m}`, stitchAvatar(PALETTE[i % PALETTE.length]!, m), `Embroidered ${m} motif`));
  PALETTE.slice(0, 4).forEach((p, i) => push(`avatar/book-${i + 1}`, bookAvatar(p), 'A standing book'));
  PALETTE.slice(2, 6).forEach((p, i) => push(`avatar/spread-${i + 1}`, spreadAvatar(p), 'An open book'));
  PALETTE.forEach((p, i) => push(`avatar/mark-${i + 1}`, markAvatar(p, i), 'An abstract mark'));
  return out;
}

export const SEED_AVATARS = build();
