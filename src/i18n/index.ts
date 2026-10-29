import { dictionaries, LOCALE_OPTIONS } from './dictionaries';
import type { Locale } from './dictionaries';

export { LOCALE_OPTIONS };
export type { Locale };

export type PageDict = Partial<Record<Locale, Record<string, string>>>;

/*
 * Page-scoped dictionaries live in src/i18n/pages/*.ts and are merged over the
 * core dictionaries, so a page can ship its own labels without touching a
 * shared file. A page key with the same name as a core key wins.
 */
const modules = import.meta.glob<{ dict?: PageDict; default?: PageDict }>('./pages/*.ts', { eager: true });

const merged: Record<Locale, Record<string, string>> = {
  ar: { ...dictionaries.ar },
  fr: { ...dictionaries.fr },
  en: { ...dictionaries.en },
};

for (const mod of Object.values(modules)) {
  const dict = mod.dict ?? mod.default;
  if (!dict) continue;
  for (const locale of Object.keys(merged) as Locale[]) {
    Object.assign(merged[locale], dict[locale]);
  }
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = merged[locale][key] ?? merged.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{{${k}}}`, String(v));
  }
  return text;
}
