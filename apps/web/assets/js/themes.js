/* ============================================================
   RIDMORE — theme engine
   A theme is data: a flat map of the same token names the
   stylesheets already read, plus a few decorative switches.
   Nothing here is CSS text or markup, so a theme can change
   the whole character of the site without being able to inject
   anything into it (§5, §6, §34).
   ============================================================ */

/** Every colour slot a theme must fill. A theme missing one falls back to
 *  Paper for that slot rather than leaving the page unstyled. */
export const SLOTS = [
  'bg', 'bg-sunk', 'bg-deep', 'surface', 'surface-2', 'surface-ink',
  'navy-900', 'navy-800', 'navy-700', 'navy-soft', 'navy-block',
  'block-bg', 'block-text', 'block-dim', 'block-mute', 'block-line',
  'block-line-soft', 'block-line-strong', 'block-surface', 'block-surface-2',
  'block-sunk', 'block-accent', 'block-accent-hot', 'block-teal', 'block-wheat',
  'text', 'text-dim', 'text-mute', 'text-on-ink', 'text-on-accent',
  'line', 'line-soft', 'line-strong',
  'accent', 'accent-hot', 'accent-soft', 'accent-line',
  'teal', 'teal-soft', 'wheat', 'wheat-soft',
  'ok', 'warn', 'crit', 'sh-color'
];

/* ---------- Paper: the shop's own light ground ---------- */
const paper = {
  scheme: 'light',
  colors: {
    'bg': '#f0ece1', 'bg-sunk': '#e7e3d6', 'bg-deep': '#1a3557',
    'surface': '#faf8f2', 'surface-2': '#fffdf8', 'surface-ink': '#1a3557',
    'navy-900': '#112339', 'navy-800': '#1a3557', 'navy-700': '#24466e',
    'navy-soft': 'rgb(26 53 87 / 0.08)', 'navy-block': '#1c3a5e',
    'block-bg': '#1c3a5e', 'block-text': '#f2eee3',
    'block-dim': 'rgb(242 238 227 / 0.78)', 'block-mute': 'rgb(242 238 227 / 0.54)',
    'block-line': 'rgb(242 238 227 / 0.20)', 'block-line-soft': 'rgb(242 238 227 / 0.10)',
    'block-line-strong': 'rgb(242 238 227 / 0.38)',
    'block-surface': 'rgb(242 238 227 / 0.07)', 'block-surface-2': 'rgb(242 238 227 / 0.11)',
    'block-sunk': 'rgb(6 16 30 / 0.36)',
    'block-accent': '#e8654a', 'block-accent-hot': '#f6836a',
    'block-teal': '#74c4b2', 'block-wheat': '#e6b45a',
    'text': '#16273d', 'text-dim': '#4a5b71', 'text-mute': '#7a879a',
    'text-on-ink': '#eceadf', 'text-on-accent': '#fdf6ef',
    'line': 'rgb(22 39 61 / 0.13)', 'line-soft': 'rgb(22 39 61 / 0.07)',
    'line-strong': 'rgb(22 39 61 / 0.30)',
    'accent': '#b23a24', 'accent-hot': '#d2452b',
    'accent-soft': 'rgb(178 58 36 / 0.10)', 'accent-line': 'rgb(178 58 36 / 0.30)',
    'teal': '#2f5d52', 'teal-soft': 'rgb(47 93 82 / 0.12)',
    'wheat': '#a8761c', 'wheat-soft': 'rgb(168 118 28 / 0.14)',
    'ok': '#2f6b45', 'warn': '#9a6510', 'crit': '#a33224',
    'sh-color': '28 22 14'
  },
  decor: { motif: 'star', ornament: 0.42, grain: 0.035, figure: 'none', trim: 'zig' }
};

/* ---------- Midnight: the dark identity the shop was built in ---------- */
const midnight = {
  scheme: 'dark',
  colors: {
    'bg': '#152234', 'bg-sunk': '#101b2a', 'bg-deep': '#f0ece1',
    'surface': '#1b2b40', 'surface-2': '#22364e', 'surface-ink': '#f0ece1',
    'navy-900': '#0c1624', 'navy-800': '#152234', 'navy-700': '#22364e',
    'navy-soft': 'rgb(236 234 223 / 0.07)', 'navy-block': '#f0ece1',
    'block-bg': '#f0ece1', 'block-text': '#16273d',
    'block-dim': 'rgb(22 39 61 / 0.76)', 'block-mute': 'rgb(22 39 61 / 0.52)',
    'block-line': 'rgb(22 39 61 / 0.16)', 'block-line-soft': 'rgb(22 39 61 / 0.08)',
    'block-line-strong': 'rgb(22 39 61 / 0.32)',
    'block-surface': 'rgb(22 39 61 / 0.05)', 'block-surface-2': 'rgb(22 39 61 / 0.09)',
    'block-sunk': 'rgb(22 39 61 / 0.10)',
    'block-accent': '#b23a24', 'block-accent-hot': '#d2452b',
    'block-teal': '#2f5d52', 'block-wheat': '#a8761c',
    'text': '#e9e5da', 'text-dim': '#b2bdcd', 'text-mute': '#7e8ca1',
    'text-on-ink': '#152234', 'text-on-accent': '#fdf6ef',
    'line': 'rgb(233 229 218 / 0.14)', 'line-soft': 'rgb(233 229 218 / 0.07)',
    'line-strong': 'rgb(233 229 218 / 0.30)',
    'accent': '#e0563c', 'accent-hot': '#f4714f',
    'accent-soft': 'rgb(224 86 60 / 0.16)', 'accent-line': 'rgb(224 86 60 / 0.34)',
    'teal': '#74c4b2', 'teal-soft': 'rgb(116 196 178 / 0.14)',
    'wheat': '#e6b45a', 'wheat-soft': 'rgb(230 180 90 / 0.16)',
    'ok': '#5fae82', 'warn': '#d9a03f', 'crit': '#e0563c',
    'sh-color': '0 0 0'
  },
  decor: { motif: 'star', ornament: 0.50, grain: 0.05, figure: 'none', trim: 'zig' }
};

/** Seasonal themes are the light ground re-pitched, not new designs, so the
 *  layout and the typography stay exactly as they were. */
const tint = (base, colors, decor) => ({
  scheme: base.scheme,
  colors: { ...base.colors, ...colors },
  decor: { ...base.decor, ...decor }
});

const spring = tint(paper, {
  'bg': '#f2f1e6', 'bg-sunk': '#e7ece1', 'surface': '#fbfaf3', 'surface-2': '#ffffff',
  'accent': '#3f7d5e', 'accent-hot': '#4f9873',
  'accent-soft': 'rgb(63 125 94 / 0.11)', 'accent-line': 'rgb(63 125 94 / 0.30)',
  'bg-deep': '#2f5d52', 'navy-block': '#2f5d52', 'surface-ink': '#2f5d52',
  'block-bg': '#2f5d52', 'block-accent': '#e6b45a', 'block-accent-hot': '#f0c878',
  'teal': '#3f7d5e', 'wheat': '#b08a2a', 'sh-color': '32 44 30'
}, { motif: 'rhomb', figure: 'blossom', ornament: 0.34 });

const summer = tint(paper, {
  'bg': '#f8f3e4', 'bg-sunk': '#f0e8d4', 'surface': '#fdfaf1', 'surface-2': '#fffefa',
  'accent': '#c9663a', 'accent-hot': '#e07f45',
  'accent-soft': 'rgb(201 102 58 / 0.12)', 'accent-line': 'rgb(201 102 58 / 0.30)',
  'bg-deep': '#24557a', 'navy-block': '#24557a', 'surface-ink': '#24557a',
  'block-bg': '#24557a', 'block-accent': '#e8c15c', 'block-accent-hot': '#f2d37e',
  'wheat': '#b8860b', 'sh-color': '70 52 24'
}, { motif: 'zig', figure: 'sun', ornament: 0.32 });

/* ---------- Autumn: a light room, warm light, leaves ---------- */
const autumn = tint(paper, {
  'bg': '#f7f1e4', 'bg-sunk': '#efe5d3', 'surface': '#fdf9f0', 'surface-2': '#fffdf7',
  'text': '#34251a', 'text-dim': '#6c5540', 'text-mute': '#9b8671',
  'line': 'rgb(52 37 26 / 0.14)', 'line-soft': 'rgb(52 37 26 / 0.07)',
  'line-strong': 'rgb(52 37 26 / 0.28)',
  'accent': '#b4551f', 'accent-hot': '#d9762f',
  'accent-soft': 'rgb(180 85 31 / 0.12)', 'accent-line': 'rgb(180 85 31 / 0.32)',
  'bg-deep': '#6d3a1c', 'navy-block': '#6d3a1c', 'surface-ink': '#6d3a1c',
  'navy-900': '#3d1f0e', 'navy-800': '#6d3a1c', 'navy-700': '#8a4f2c',
  'block-bg': '#6d3a1c', 'block-text': '#f9efe0',
  'block-dim': 'rgb(249 239 224 / 0.78)', 'block-mute': 'rgb(249 239 224 / 0.54)',
  'block-line': 'rgb(249 239 224 / 0.20)', 'block-line-soft': 'rgb(249 239 224 / 0.10)',
  'block-line-strong': 'rgb(249 239 224 / 0.38)',
  'block-surface': 'rgb(249 239 224 / 0.07)', 'block-surface-2': 'rgb(249 239 224 / 0.12)',
  'block-accent': '#e8a13a', 'block-accent-hot': '#f5bb60',
  'block-wheat': '#f0c878', 'block-teal': '#c2a06a',
  'teal': '#7a6a3a', 'teal-soft': 'rgb(122 106 58 / 0.12)',
  'wheat': '#b07d18', 'wheat-soft': 'rgb(176 125 24 / 0.16)',
  'sh-color': '74 44 22'
}, { motif: 'rhomb', figure: 'leaves', ornament: 0.38, grain: 0.045, trim: 'rhomb' });

const winter = tint(midnight, {
  'bg': '#111c2b', 'bg-sunk': '#0c1521', 'surface': '#182538',
  'surface-2': '#1f2e44',
  'accent': '#6d9fd0', 'accent-hot': '#8fbbe4',
  'accent-soft': 'rgb(109 159 208 / 0.16)', 'accent-line': 'rgb(109 159 208 / 0.34)',
  'bg-deep': '#e8eef4', 'navy-block': '#e8eef4', 'surface-ink': '#e8eef4',
  'block-bg': '#e8eef4', 'block-text': '#111c2b',
  'block-accent': '#3f6f9e', 'block-accent-hot': '#5b8dc0',
  'teal': '#8fbbe4', 'wheat': '#cdd9e6',
  'sh-color': '0 6 14'
}, { motif: 'cross', figure: 'snow', ornament: 0.32 });

export const THEMES = {
  paper:    { name: { de: 'Papier',   uk: 'Папір',    en: 'Paper' },    season: null,     tokens: paper },
  midnight: { name: { de: 'Mitternacht', uk: 'Північ', en: 'Midnight' }, season: null,    tokens: midnight },
  spring:   { name: { de: 'Frühling', uk: 'Весна',    en: 'Spring' },   season: 'spring', tokens: spring },
  summer:   { name: { de: 'Sommer',   uk: 'Літо',     en: 'Summer' },   season: 'summer', tokens: summer },
  autumn:   { name: { de: 'Herbst',   uk: 'Осінь',    en: 'Autumn' },   season: 'autumn', tokens: autumn },
  winter:   { name: { de: 'Winter',   uk: 'Зима',     en: 'Winter' },   season: 'winter', tokens: winter }
};

export const DEFAULT_THEME = 'paper';
export const isDark = (key) => (THEMES[key] ?? THEMES[DEFAULT_THEME]).tokens.scheme === 'dark';

/**
 * Write a theme onto the document.
 *
 * Values are written as custom properties on :root, which is why every
 * component follows without being touched: the stylesheets already read
 * these names. A slot a theme forgot falls back to Paper's value, so a
 * half-filled theme degrades rather than breaking the page.
 */
export function applyTheme(key, root = document.documentElement) {
  const theme = THEMES[key] ?? THEMES[DEFAULT_THEME];
  const { colors, decor, scheme } = theme.tokens;

  for (const slot of SLOTS) {
    root.style.setProperty(`--${slot}`, colors[slot] ?? paper.colors[slot]);
  }
  root.style.setProperty('color-scheme', scheme);
  root.style.setProperty('--grain-alpha', String(decor.grain));
  root.style.setProperty('--ornament-alpha', String(decor.ornament));

  root.dataset.theme = key;
  root.dataset.scheme = scheme;
  root.dataset.season = decor.figure === 'none' ? '' : theme.season ?? '';
  root.dataset.figure = decor.figure;
  root.dataset.motif = decor.motif;
  root.dataset.trim = decor.trim;

  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    ?? Object.assign(document.head.appendChild(document.createElement('meta')), { name: 'theme-color' });
  meta.setAttribute('content', colors.bg ?? paper.colors.bg);

  return theme;
}

/** Every slot filled, for every theme — checked in the test, not assumed. */
export function auditThemes() {
  const gaps = [];
  for (const [key, t] of Object.entries(THEMES)) {
    for (const slot of SLOTS) if (!(slot in t.tokens.colors)) gaps.push(`${key}/${slot}`);
  }
  return gaps;
}
