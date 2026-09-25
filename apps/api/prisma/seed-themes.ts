/**
 * The seeded themes (§5, §6).
 *
 * A theme is a flat map of named token slots — never CSS text, never markup.
 * The slot names are the ones the existing stylesheets already use, so a theme
 * change reaches the header, the hero, the cards, the modal and the footer
 * without any component knowing a theme engine exists.
 */
import type { ThemeTokens } from '../src/lib/theme-tokens.js';
export { TOKEN_SLOTS } from '../src/lib/theme-tokens.js';
export type { ThemeTokens, TokenSlot } from '../src/lib/theme-tokens.js';


const base = {
  gold: '#e0a93b', ok: '#3f7d5e', warn: '#c98a2e', danger: '#b23a24'
};

/** The site's own light ground — the one the prototype ships with. */
const paper: ThemeTokens = {
  colorScheme: 'light',
  colors: {
    ...base,
    bg: '#f0ece1', 'bg-sunk': '#e7e3d6', 'bg-raise': '#f6f3ea',
    surface: '#faf8f1', 'surface-2': '#f3efe4', 'surface-ink': '#1a3557',
    text: '#17212e', 'text-dim': '#46566b', 'text-mute': '#77849a',
    'text-on-ink': '#f2efe6', 'text-on-accent': '#fdf8ef',
    'navy-900': '#122238', 'navy-800': '#1a3557', 'navy-700': '#274a72', 'navy-block': '#1c3a5e',
    line: '#d6d0bf', 'line-soft': '#e4dfd1', 'line-strong': '#b9b2a0',
    accent: '#b23a24', 'accent-hot': '#e0563c', 'accent-soft': '#f2ddd5', 'accent-ink': '#8d2c1a',
    'header-bg': '#f0ece1', 'header-fg': '#17212e', 'header-line': '#d6d0bf',
    'block-bg': '#1c3a5e', 'block-text': '#f2efe6', 'block-dim': '#b9c6d8',
    'block-line': '#2f5077', 'block-accent': '#e0563c', 'block-surface': '#24446b',
    'hero-bg': '#f0ece1', 'hero-fg': '#17212e',
    'card-bg': '#faf8f1', 'card-line': '#e4dfd1', 'card-shadow': '26 24 16',
    'btn-primary-bg': '#b23a24', 'btn-primary-fg': '#fdf8ef', 'btn-primary-hover': '#8d2c1a',
    'btn-ghost-fg': '#17212e', 'btn-ghost-line': '#b9b2a0', 'btn-ghost-hover': '#e7e3d6',
    overlay: '18 34 56', 'modal-bg': '#faf8f1', 'modal-line': '#e4dfd1',
    'footer-bg': '#1c3a5e', 'footer-fg': '#f2efe6', 'footer-line': '#2f5077',
    'sh-color': '26 24 16'
  },
  decor: { ornamentMotif: 'star', ornamentOpacity: 0.42, grain: 0.035, heroFigure: 'none', bandTrim: 'zig' }
};

/** The dark stylistic identity the brief insists must survive (§5). These are
 *  the prototype's own dark values, lifted verbatim. */
const midnight: ThemeTokens = {
  colorScheme: 'dark',
  colors: {
    ...base,
    bg: '#152234', 'bg-sunk': '#101b2a', 'bg-raise': '#1b2b40',
    surface: '#1b2b40', 'surface-2': '#22364e', 'surface-ink': '#f0ece1',
    text: '#e9e5da', 'text-dim': '#b3bccb', 'text-mute': '#7f8ca0',
    'text-on-ink': '#152234', 'text-on-accent': '#fdf8ef',
    'navy-900': '#0c1624', 'navy-800': '#152234', 'navy-700': '#22364e', 'navy-block': '#f0ece1',
    line: '#2b3d55', 'line-soft': '#22334a', 'line-strong': '#3d5170',
    accent: '#e0563c', 'accent-hot': '#f4714f', 'accent-soft': '#3a2620', 'accent-ink': '#f4714f',
    'header-bg': '#152234', 'header-fg': '#e9e5da', 'header-line': '#2b3d55',
    'block-bg': '#f0ece1', 'block-text': '#17212e', 'block-dim': '#46566b',
    'block-line': '#d6d0bf', 'block-accent': '#b23a24', 'block-surface': '#faf8f1',
    'hero-bg': '#152234', 'hero-fg': '#e9e5da',
    'card-bg': '#1b2b40', 'card-line': '#2b3d55', 'card-shadow': '0 0 0',
    'btn-primary-bg': '#e0563c', 'btn-primary-fg': '#fdf8ef', 'btn-primary-hover': '#f4714f',
    'btn-ghost-fg': '#e9e5da', 'btn-ghost-line': '#3d5170', 'btn-ghost-hover': '#22364e',
    overlay: '4 9 16', 'modal-bg': '#1b2b40', 'modal-line': '#2b3d55',
    'footer-bg': '#f0ece1', 'footer-fg': '#17212e', 'footer-line': '#d6d0bf',
    'sh-color': '0 0 0'
  },
  decor: { ornamentMotif: 'star', ornamentOpacity: 0.5, grain: 0.05, heroFigure: 'none', bandTrim: 'zig' }
};

/** Seasonal themes are the light ground re-pitched, not new designs. The
 *  autumn one is the warm, leaf-lit room the brief describes. */
function reTint(from: ThemeTokens, over: Partial<ThemeTokens['colors']>, decor: Partial<ThemeTokens['decor']>): ThemeTokens {
  return { ...from, colors: { ...from.colors, ...over }, decor: { ...from.decor, ...decor } };
}

const spring = reTint(paper, {
  bg: '#f2f0e6', 'bg-sunk': '#e8ece1', 'bg-raise': '#f8f6ee',
  accent: '#3f7d5e', 'accent-hot': '#569a76', 'accent-soft': '#dcebe1', 'accent-ink': '#2f6149',
  'block-bg': '#2f5d52', 'block-accent': '#e8a13a', 'block-surface': '#3a6f63',
  'btn-primary-bg': '#3f7d5e', 'btn-primary-hover': '#2f6149',
  'footer-bg': '#2f5d52', 'footer-line': '#3a6f63',
  'header-bg': '#f2f0e6', 'hero-bg': '#f2f0e6'
}, { ornamentMotif: 'rhomb', heroFigure: 'blossom', ornamentOpacity: 0.36 });

const summer = reTint(paper, {
  bg: '#f7f2e4', 'bg-sunk': '#efe7d3', 'bg-raise': '#fdf9ee',
  accent: '#c9663a', 'accent-hot': '#e0803f', 'accent-soft': '#f7e2d0', 'accent-ink': '#a04d28',
  'block-bg': '#24557a', 'block-accent': '#e8c15c', 'block-surface': '#2d6490',
  'btn-primary-bg': '#c9663a', 'btn-primary-hover': '#a04d28',
  'footer-bg': '#24557a', 'footer-line': '#2d6490',
  'header-bg': '#f7f2e4', 'hero-bg': '#f7f2e4'
}, { ornamentMotif: 'zig', heroFigure: 'sun', ornamentOpacity: 0.34 });

/** Autumn: a light room, warm light, leaves. */
const autumn = reTint(paper, {
  bg: '#f6f0e3', 'bg-sunk': '#efe5d2', 'bg-raise': '#fbf6ec',
  surface: '#fdf9f0', 'surface-2': '#f5ecdc',
  text: '#33241a', 'text-dim': '#6b543f', 'text-mute': '#9a8570',
  accent: '#b4551f', 'accent-hot': '#d9762f', 'accent-soft': '#f6e3cf', 'accent-ink': '#8c4016',
  gold: '#d19a2c',
  line: '#e0d2bb', 'line-soft': '#ece1cd', 'line-strong': '#c4ae90',
  'block-bg': '#6d3a1c', 'block-text': '#f9efe0', 'block-dim': '#d6bda2',
  'block-line': '#8a4f2c', 'block-accent': '#e8a13a', 'block-surface': '#7e472468',
  'btn-primary-bg': '#b4551f', 'btn-primary-hover': '#8c4016',
  'btn-ghost-fg': '#33241a', 'btn-ghost-line': '#c4ae90', 'btn-ghost-hover': '#efe5d2',
  'card-bg': '#fdf9f0', 'card-line': '#ece1cd', 'card-shadow': '60 38 20',
  'header-bg': '#f6f0e3', 'header-fg': '#33241a', 'header-line': '#e0d2bb',
  'hero-bg': '#f6f0e3', 'hero-fg': '#33241a',
  'footer-bg': '#6d3a1c', 'footer-fg': '#f9efe0', 'footer-line': '#8a4f2c',
  'modal-bg': '#fdf9f0', 'modal-line': '#ece1cd',
  overlay: '48 30 16', 'sh-color': '60 38 20'
}, { ornamentMotif: 'rhomb', heroFigure: 'leaves', ornamentOpacity: 0.4, grain: 0.045, bandTrim: 'rhomb' });

const winter = reTint(midnight, {
  bg: '#101a28', 'bg-sunk': '#0b131e', 'bg-raise': '#182538',
  accent: '#6d9fd0', 'accent-hot': '#8fbbe4', 'accent-soft': '#1d3049', 'accent-ink': '#8fbbe4',
  'block-bg': '#e8eef4', 'block-text': '#101a28', 'block-accent': '#3f6f9e',
  'btn-primary-bg': '#3f6f9e', 'btn-primary-hover': '#6d9fd0',
  'footer-bg': '#e8eef4', 'footer-fg': '#101a28',
  'header-bg': '#101a28', 'hero-bg': '#101a28'
}, { ornamentMotif: 'cross', heroFigure: 'snow', ornamentOpacity: 0.34 });

export const SEED_THEMES = [
  { key: 'paper',    name: 'Paper',    season: 'NONE'   as const, tokens: paper,
    description: "Ridmore's own light ground: unbleached stock, printer's navy, cinnabar." },
  { key: 'midnight', name: 'Midnight', season: 'NONE'   as const, tokens: midnight,
    description: 'The dark identity the shop was built in. Cream type on deep navy.' },
  { key: 'spring',   name: 'Spring',   season: 'SPRING' as const, tokens: spring,
    description: 'Green ground, blossom in the hero.' },
  { key: 'summer',   name: 'Summer',   season: 'SUMMER' as const, tokens: summer,
    description: 'Warm sand and terracotta, high sun.' },
  { key: 'autumn',   name: 'Autumn',   season: 'AUTUMN' as const, tokens: autumn,
    description: 'A light room, warm light, leaves across the hero.' },
  { key: 'winter',   name: 'Winter',   season: 'WINTER' as const, tokens: winter,
    description: 'Cold navy and frost blue, snow in the hero.' }
];
