export type AccentId =
  | 'blue' | 'indigo' | 'violet' | 'crimson' | 'green'
  | 'teal' | 'cyan' | 'gold' | 'copper' | 'graphite';

export interface AccentPreset {
  id: AccentId;
  labelKey: string;
  /** Light-theme RGB triplets, for the picker swatch only */
  brand: string;
  purple: string;
}

/**
 * The runtime colors live in the [data-accent] blocks in styles/index.css: a
 * theme has to repaint dark mode too, and CSS variables are what Tailwind
 * reads. These triplets exist only to paint the swatch, so a new accent has to
 * be added in both places.
 */
export const DEFAULT_ACCENT: AccentId = 'blue';

export const ACCENTS: AccentPreset[] = [
  { id: 'blue', labelKey: 'accentBlue', brand: '37 99 235', purple: '124 58 247' },
  { id: 'indigo', labelKey: 'accentIndigo', brand: '79 70 229', purple: '139 92 246' },
  { id: 'violet', labelKey: 'accentViolet', brand: '124 58 247', purple: '219 39 119' },
  { id: 'crimson', labelKey: 'accentCrimson', brand: '190 24 93', purple: '147 51 234' },
  { id: 'green', labelKey: 'accentGreen', brand: '21 128 61', purple: '13 148 136' },
  { id: 'teal', labelKey: 'accentTeal', brand: '13 148 136', purple: '2 132 199' },
  { id: 'cyan', labelKey: 'accentCyan', brand: '3 105 161', purple: '124 58 247' },
  { id: 'gold', labelKey: 'accentGold', brand: '161 98 7', purple: '219 39 119' },
  { id: 'copper', labelKey: 'accentCopper', brand: '194 91 2', purple: '236 72 153' },
  { id: 'graphite', labelKey: 'accentGraphite', brand: '51 65 85', purple: '100 116 139' },
];
