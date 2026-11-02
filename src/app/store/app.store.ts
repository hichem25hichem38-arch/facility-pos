import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from '@/i18n';
import type { AccentId } from '@/config/theme';
import { DEFAULT_ACCENT } from '@/config/theme';
import type { Permission } from '@/types';

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
}

export interface AppState {
  authUser: AuthUser | null;
  permissions: Permission[];
  locale: Locale;
  darkMode: boolean;
  accent: AccentId;
  currency: string;
  storeName: string;

  setAuth(user: AuthUser | null, permissions: Permission[]): void;
  hasPermission(p: Permission): boolean;
  setLocale(l: Locale): void;
  setDarkMode(v: boolean): void;
  setAccent(a: AccentId): void;
  setCurrency(c: string): void;
  setStoreName(n: string): void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      authUser: null,
      permissions: [],
      locale: 'ar',
      darkMode: false,
      accent: DEFAULT_ACCENT,
      currency: 'DZD',
      storeName: '',

      setAuth: (authUser, permissions) => set({ authUser, permissions }),
      hasPermission: (p) => get().permissions.includes(p),
      setLocale: (locale) => set({ locale }),
      setDarkMode: (darkMode) => set({ darkMode }),
      setAccent: (accent) => set({ accent }),
      setCurrency: (currency) => set({ currency }),
      setStoreName: (storeName) => set({ storeName }),
    }),
    { name: 'app-ui-prefs', partialize: (s) => ({ locale: s.locale, darkMode: s.darkMode, accent: s.accent, authUser: s.authUser, permissions: s.permissions, currency: s.currency, storeName: s.storeName }) },
  ),
);
