import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCENTS, DEFAULT_ACCENT } from '@/config/theme';
import { LOCALE_OPTIONS, translate } from '@/i18n';

const css = readFileSync('src/styles/index.css', 'utf8');

describe('accent palettes', () => {
  it('offers the default accent among the presets', () => {
    expect(ACCENTS.map((a) => a.id)).toContain(DEFAULT_ACCENT);
  });

  /** The swatches live in JS while the runtime colors live in CSS: both must list every accent. */
  it('declares a light and a dark token block for every accent', () => {
    for (const accent of ACCENTS) {
      expect(css).toContain(`[data-accent='${accent.id}']`);
      expect(css).toContain(`[data-theme='dark'][data-accent='${accent.id}']`);
    }
  });

  it('names every accent in every locale', () => {
    for (const locale of LOCALE_OPTIONS.map((o) => o.value)) {
      for (const accent of ACCENTS) {
        expect(translate(locale, accent.labelKey)).not.toBe(accent.labelKey);
      }
      expect(translate(locale, 'accentColor')).not.toBe('accentColor');
    }
  });
});
