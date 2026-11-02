import { useEffect } from 'react';
import { useAppStore } from '@/app/store/app.store';
import { DEFAULT_ACCENT } from '@/config/theme';

export function useApplyTheme() {
  const { locale, darkMode, accent } = useAppStore();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('data-accent', accent || DEFAULT_ACCENT);
    // تلقائي حسب النظام إذا لم يختر المستخدم — نحترم تفضيل النظام عند أول تحميل
    const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const hasUserChoice = localStorage.getItem('app-ui-prefs');
    const effectiveDark = hasUserChoice ? darkMode : (prefersDark ?? darkMode);
    document.documentElement.classList.toggle('dark', effectiveDark);
    document.documentElement.setAttribute('data-theme', effectiveDark ? 'dark' : 'light');
    // استمع لتغيير النظام إذا لم يكن هناك اختيار يدوي لاحق
    if (!hasUserChoice && typeof window !== 'undefined') {
      const m = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.classList.toggle('dark', e.matches);
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      };
      m.addEventListener?.('change', handler);
      return () => m.removeEventListener?.('change', handler);
    }
  }, [locale, darkMode, accent]);
}
