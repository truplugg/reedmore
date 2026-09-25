/**
 * What a theme is made of (§5, §6, §34).
 *
 * This list lives on the server side rather than beside the seed, because
 * the publish endpoint checks a draft against it: a theme missing a slot
 * renders an unstyled page, so it may be saved but never served.
 */
export interface ThemeTokens {
  /** Which of the two built-in contrast modes the browser chrome should match. */
  colorScheme: 'light' | 'dark';
  colors: Record<string, string>;
  /** Decorative switches the sections read; no markup, only choices. */
  decor: {
    ornamentMotif: 'star' | 'rhomb' | 'cross' | 'zig';
    ornamentOpacity: number;
    grain: number;
    heroFigure: 'none' | 'leaves' | 'blossom' | 'sun' | 'snow';
    bandTrim: 'zig' | 'rhomb' | 'none';
  };
}

/** Every slot a theme must fill. The compiler checks a draft against this list
 *  so a half-filled theme cannot be published and leave the page unstyled. */
export const TOKEN_SLOTS = [
  'bg', 'bg-sunk', 'bg-raise', 'surface', 'surface-2', 'surface-ink',
  'text', 'text-dim', 'text-mute', 'text-on-ink', 'text-on-accent',
  'navy-900', 'navy-800', 'navy-700', 'navy-block',
  'line', 'line-soft', 'line-strong',
  'accent', 'accent-hot', 'accent-soft', 'accent-ink',
  'gold', 'ok', 'warn', 'danger',
  'header-bg', 'header-fg', 'header-line',
  'block-bg', 'block-text', 'block-dim', 'block-line', 'block-accent', 'block-surface',
  'hero-bg', 'hero-fg',
  'card-bg', 'card-line', 'card-shadow',
  'btn-primary-bg', 'btn-primary-fg', 'btn-primary-hover',
  'btn-ghost-fg', 'btn-ghost-line', 'btn-ghost-hover',
  'overlay', 'modal-bg', 'modal-line',
  'footer-bg', 'footer-fg', 'footer-line',
  'sh-color'
] as const;

export type TokenSlot = (typeof TOKEN_SLOTS)[number];
