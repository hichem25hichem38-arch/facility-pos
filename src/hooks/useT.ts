import { useAppStore } from '@/app/store/app.store';
import { dictionaries } from '@/i18n/dictionaries';
import { translate } from '@/i18n';

export function useT() {
  const locale = useAppStore((s) => s.locale);
  return {
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    locale,
    dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const),
    keys: dictionaries[locale],
  };
}
