import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { useAppStore } from '@/app/store/app.store';
import { useT } from '@/hooks/useT';
import { Icon, LogoMark, type IconName } from '@/components/icons';
import { endOfDay, formatMoney, startOfDay } from '@/utils/format';
import type { Permission } from '@/types';

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */

type CountKey = 'products' | 'customers' | 'lowStock' | 'overdue' | 'todaySales';

interface NavItem {
  to: string;
  icon: IconName;
  labelKey: string;
  permission?: Permission;
  end?: boolean;
  count?: CountKey;
  countTone?: 'danger' | 'warn';
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'navGroup_main',
    items: [{ to: '/', icon: 'dashboard', labelKey: 'dashboard', end: true, count: 'todaySales' }],
  },
  {
    labelKey: 'navGroup_sales',
    items: [
      { to: '/pos', icon: 'cart', labelKey: 'pos', permission: 'sales.create' },
      { to: '/sales', icon: 'receipt', labelKey: 'sales', permission: 'sales.view', count: 'todaySales' },
      { to: '/installments', icon: 'wallet', labelKey: 'installments', permission: 'payments.view', count: 'overdue', countTone: 'danger' },
    ],
  },
  {
    labelKey: 'navGroup_inventory',
    items: [
      { to: '/products', icon: 'box', labelKey: 'products', permission: 'products.view', count: 'products' },
      { to: '/categories', icon: 'tag', labelKey: 'categories', permission: 'products.view' },
      { to: '/inventory', icon: 'layers', labelKey: 'inventory', permission: 'inventory.view', count: 'lowStock', countTone: 'warn' },
      { to: '/scanner', icon: 'scan', labelKey: 'scanner', permission: 'inventory.view' },
    ],
  },
  {
    labelKey: 'navGroup_people',
    items: [{ to: '/customers', icon: 'users', labelKey: 'customers', permission: 'customers.view', count: 'customers' }],
  },
  {
    labelKey: 'navGroup_insights',
    items: [
      { to: '/reports', icon: 'chart', labelKey: 'reports', permission: 'reports.view' },
      { to: '/audit', icon: 'history', labelKey: 'audit' },
    ],
  },
  {
    labelKey: 'navGroup_system',
    items: [{ to: '/settings', icon: 'cog', labelKey: 'settings', permission: 'settings.manage' }],
  },
];

const MOBILE_TABS: NavItem[] = [
  { to: '/', icon: 'dashboard', labelKey: 'dashboard', end: true },
  { to: '/sales', icon: 'receipt', labelKey: 'sales', permission: 'sales.view' },
  { to: '/installments', icon: 'wallet', labelKey: 'installments', permission: 'payments.view' },
];

interface Stats {
  products: number;
  customers: number;
  lowStock: number;
  overdue: number;
  overdueAmount: number;
  dueToday: number;
  todaySales: number;
  todayRevenue: number;
}

const EMPTY_STATS: Stats = {
  products: 0, customers: 0, lowStock: 0, overdue: 0,
  overdueAmount: 0, dueToday: 0, todaySales: 0, todayRevenue: 0,
};

function useLiveStats(): Stats {
  return useLiveQuery(async () => {
    const db = getDb();
    const dayStart = startOfDay(Date.now());
    const dayEnd = endOfDay(dayStart);
    const [products, lowStock, customers, openInstallments, todaySalesRows] = await Promise.all([
      db.products.count(),
      db.products.filter((p) => p.isActive && p.stockQuantity <= p.minimumStock).count(),
      db.customers.count(),
      db.installments.where('status').anyOf(['PENDING', 'PARTIAL', 'OVERDUE']).toArray(),
      db.sales.where('saleDate').between(dayStart, dayEnd).toArray(),
    ]);
    const late = openInstallments.filter((i) => i.status === 'OVERDUE' || i.dueDate < dayStart);
    const sales = todaySalesRows.filter((s) => s.status !== 'CANCELLED');
    return {
      products,
      lowStock,
      customers,
      overdue: late.length,
      overdueAmount: late.reduce((sum, i) => sum + i.remainingAmount, 0),
      dueToday: openInstallments.filter((i) => i.dueDate >= dayStart && i.dueDate <= dayEnd).length,
      todaySales: sales.length,
      todayRevenue: sales.reduce((sum, s) => sum + s.paidAmount, 0),
    };
  }, [], EMPTY_STATS) ?? EMPTY_STATS;
}

/* ------------------------------------------------------------------ */
/* Global search                                                       */
/* ------------------------------------------------------------------ */

interface SearchHits {
  products: { id: string; name: string; sku: string; price: number; stock: number }[];
  customers: { id: string; fullName: string; phone?: string; customerNumber: string }[];
}

function useGlobalSearch(term: string): SearchHits | null {
  return useLiveQuery(async () => {
    const q = term.trim();
    if (!q) return null;
    const db = getDb();
    const [byName, bySku, byBarcode, custByName, custByPhone, custByNumber] = await Promise.all([
      db.products.where('name').startsWithIgnoreCase(q).limit(6).toArray(),
      db.products.where('sku').startsWithIgnoreCase(q).limit(6).toArray(),
      q.length >= 4 ? db.products.where('barcode').startsWith(q).limit(4).toArray() : Promise.resolve([]),
      db.customers.where('fullName').startsWithIgnoreCase(q).limit(5).toArray(),
      q.length >= 3 ? db.customers.where('phone').startsWith(q).limit(5).toArray() : Promise.resolve([]),
      db.customers.where('customerNumber').startsWithIgnoreCase(q).limit(5).toArray(),
    ]);
    const uniq = <T extends { id: string }>(rows: T[]) => {
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    };
    return {
      products: uniq([...byBarcode, ...bySku, ...byName])
        .slice(0, 5)
        .map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.sellingPrice, stock: p.stockQuantity })),
      customers: uniq([...custByNumber, ...custByPhone, ...custByName])
        .slice(0, 4)
        .map((c) => ({ id: c.id, fullName: c.fullName, phone: c.phone, customerNumber: c.customerNumber })),
    };
  }, [term], null);
}

function GlobalSearch({ autoFocus, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) {
  const { t } = useT();
  const currency = useAppStore((s) => s.currency);
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hits = useGlobalSearch(debounced);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 160);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    if (!autoFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
    setTerm('');
    onNavigate?.();
  };

  const first = hits?.products[0] ? `/products?q=${encodeURIComponent(hits.products[0].name)}` : null;
  const total = (hits?.products.length ?? 0) + (hits?.customers.length ?? 0);

  return (
    <div ref={boxRef} className="relative w-full">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-muted">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && first) go(first); }}
        placeholder={t('globalSearchPlaceholder')}
        className="h-9 w-full rounded-md border border-line bg-surface-2 ps-9 pe-14 text-[0.85rem] font-semibold text-ink outline-none transition-all duration-150 placeholder:font-medium placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/15"
      />
      {autoFocus && (
        <kbd className="pointer-events-none absolute inset-y-0 end-2 hidden items-center gap-0.5 self-center rounded border border-line bg-surface px-1.5 py-0.5 text-[0.62rem] font-black text-ink-muted lg:flex">
          F2
        </kbd>
      )}
      {term && (
        <button
          type="button"
          onClick={() => setTerm('')}
          aria-label={t('cancel')}
          className="absolute inset-y-0 end-2 flex items-center text-ink-muted hover:text-ink lg:end-9"
        >
          <Icon name="x" size={14} />
        </button>
      )}

      {open && term.trim() && (
        <div className="panel anim-pop absolute inset-x-0 top-11 z-50 overflow-hidden rounded-lg border border-line shadow-3">
          {total === 0 ? (
            <p className="px-4 py-6 text-center text-[0.82rem] font-bold text-ink-muted">{t('noResults')}</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto scroll-y py-1.5">
              {hits?.products.length ? (
                <>
                  <p className="px-3 pb-1 pt-1.5 text-[0.66rem] font-black uppercase tracking-wider text-ink-muted">{t('products')}</p>
                  {hits.products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => go(`/products?q=${encodeURIComponent(p.name)}`)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/12 text-brand">
                        <Icon name="box" size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-bold text-ink">{p.name}</span>
                        <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted">{p.sku}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="num block text-[0.8rem] font-black text-ink">{formatMoney(p.price, currency)}</span>
                        <span className={`num block text-[0.68rem] font-bold ${p.stock <= 0 ? 'text-danger' : 'text-ink-muted'}`}>
                          {p.stock} {t('stock')}
                        </span>
                      </span>
                    </button>
                  ))}
                </>
              ) : null}
              {hits?.customers.length ? (
                <>
                  <p className="px-3 pb-1 pt-2.5 text-[0.66rem] font-black uppercase tracking-wider text-ink-muted">{t('customers')}</p>
                  {hits.customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => go(`/customers/${c.id}`)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple/12 text-purple">
                        <Icon name="user" size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-bold text-ink">{c.fullName}</span>
                        <span className="num block truncate text-[0.68rem] font-semibold text-ink-muted">
                          {c.customerNumber}{c.phone ? ` · ${c.phone}` : ''}
                        </span>
                      </span>
                      <Icon name="chevron-end" size={14} className="shrink-0 text-ink-muted" />
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Electron window controls                                            */
/* ------------------------------------------------------------------ */

function WindowControls({ maximized }: { maximized: boolean }) {
  const { t } = useT();
  const wc = typeof window !== 'undefined' ? window.desktop?.windowControls : undefined;
  if (!wc) return null;
  const base =
    'no-drag grid h-8 w-11 place-items-center rounded-md text-rail-text transition-colors duration-150 hover:bg-white/10 hover:text-white';
  return (
    <div className="ms-1 flex items-center gap-0.5">
      <button type="button" className={base} onClick={() => wc.minimize()} title={t('winMinimize')} aria-label={t('winMinimize')}>
        <Icon name="minimize" size={14} strokeWidth={2.2} />
      </button>
      <button type="button" className={base} onClick={() => wc.maximize()} title={t('winMaximize')} aria-label={t('winMaximize')}>
        <Icon name={maximized ? 'restore' : 'maximize'} size={13} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        className={`${base} hover:bg-danger hover:text-white`}
        onClick={() => wc.close()}
        title={t('winClose')}
        aria-label={t('winClose')}
      >
        <Icon name="x" size={15} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export function MainLayout() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const authUser = useAppStore((s) => s.authUser);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);
  const setAuth = useAppStore((s) => s.setAuth);
  const currency = useAppStore((s) => s.currency);
  const stats = useLiveStats();

  const [menu, setMenu] = useState<'none' | 'bell' | 'user'>('none');
  const [moreOpen, setMoreOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMemo(() => typeof window !== 'undefined' && !!window.desktop?.isDesktop, []);
  const wc = useMemo(() => (typeof window !== 'undefined' ? window.desktop?.windowControls : undefined), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!wc) return;
    let dispose: (() => void) | undefined;
    wc.isMaximized().then(setMaximized).catch(() => {});
    try { dispose = wc.onMaximizedChange(setMaximized); } catch { /* older bridge */ }
    return () => dispose?.();
  }, [wc]);

  useEffect(() => { setMenu('none'); }, [location.pathname]);

  useEffect(() => {
    if (menu === 'none') return;
    const onDown = (e: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(e.target as Node)) setMenu('none');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const groups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || hasPermission(i.permission)) }))
      .filter((g) => g.items.length > 0),
    [hasPermission],
  );
  const mobileTabs = useMemo(() => MOBILE_TABS.filter((i) => !i.permission || hasPermission(i.permission)), [hasPermission]);
  const canSell = hasPermission('sales.create');

  const alerts = [
    stats.overdue > 0 && { icon: 'alert' as IconName, tone: 'danger' as const, label: t('overdueAlert'), value: stats.overdue, hint: formatMoney(stats.overdueAmount, currency), to: '/installments?status=OVERDUE' },
    stats.dueToday > 0 && { icon: 'clock' as IconName, tone: 'warn' as const, label: t('dueTodayAlert'), value: stats.dueToday, to: '/installments?due=today' },
    stats.lowStock > 0 && { icon: 'box' as IconName, tone: 'info' as const, label: t('lowStockAlert'), value: stats.lowStock, to: '/inventory?filter=low' },
  ].filter(Boolean) as { icon: IconName; tone: 'danger' | 'warn' | 'info'; label: string; value: number; hint?: string; to: string }[];

  const counterOf = (key?: CountKey) => (key ? stats[key] : 0);

  const logout = () => {
    setAuth(null, []);
    navigate('/login', { replace: true });
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[0.84rem] font-bold transition-all duration-150 ${
      isActive ? 'bg-white/10 text-white' : 'text-rail-text hover:bg-white/5 hover:text-white'
    }`;

  return (
    <div ref={shellRef} className="relative z-10 flex h-dvh flex-col overflow-hidden">
      {/* Title bar — doubles as the drag region for the frameless desktop window */}
      <header
        data-shell
        className="drag-region no-print relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-black/20 bg-rail px-2 text-rail-text sm:h-14 sm:px-3"
      >
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label={t('more')}
          className="no-drag grid h-9 w-9 shrink-0 place-items-center rounded-md text-rail-text transition-colors hover:bg-white/10 hover:text-white lg:hidden"
        >
          <Icon name="menu" size={19} />
        </button>

        <div className="flex shrink-0 items-center gap-2.5">
          <LogoMark size={26} />
          <div className="hidden leading-tight sm:block">
            <p className="text-[0.86rem] font-black text-white">{t('appName')}</p>
            <p className="text-[0.64rem] font-bold text-rail-text/70">{isDesktop ? t('desktopEdition') : t('mobileEdition')}</p>
          </div>
        </div>

        <div className="no-drag mx-auto hidden w-full max-w-md md:block">
          <GlobalSearch autoFocus />
        </div>

        <div className="no-drag ms-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label={t('search')}
            className="grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-white/10 hover:text-white md:hidden"
          >
            <Icon name="search" size={18} />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === 'bell' ? 'none' : 'bell')}
              aria-label={t('notifications')}
              className={`grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-white/10 hover:text-white ${menu === 'bell' ? 'bg-white/10 text-white' : ''}`}
            >
              <Icon name="bell" size={18} />
              {alerts.length > 0 && (
                <span className="num absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-black text-white ring-2 ring-rail">
                  {alerts.reduce((s, a) => s + a.value, 0)}
                </span>
              )}
            </button>
            {menu === 'bell' && (
              <div className="panel anim-pop absolute end-0 top-11 z-50 w-80 overflow-hidden rounded-lg border border-line shadow-3">
                <p className="border-b border-line px-4 py-2.5 text-[0.82rem] font-black text-ink">{t('notifications')}</p>
                {alerts.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[0.82rem] font-bold text-ink-muted">{t('allClear')}</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto scroll-y py-1">
                    {alerts.map((a) => (
                      <button
                        key={a.to}
                        type="button"
                        onClick={() => { navigate(a.to); setMenu('none'); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-2"
                      >
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
                            a.tone === 'danger' ? 'bg-danger/12 text-danger' : a.tone === 'warn' ? 'bg-warn/12 text-warn' : 'bg-info/12 text-info'
                          }`}
                        >
                          <Icon name={a.icon} size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.82rem] font-bold text-ink">{a.label}</span>
                          {a.hint && <span className="num block text-[0.7rem] font-bold text-ink-muted">{a.hint}</span>}
                        </span>
                        <span className="num shrink-0 text-[0.9rem] font-black text-ink">{a.value}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={t('darkMode')}
            title={t('darkMode')}
            className="grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name={darkMode ? 'sun' : 'moon'} size={18} />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === 'user' ? 'none' : 'user')}
              className={`no-drag flex items-center gap-2 rounded-md py-1 pe-1 ps-2 transition-colors hover:bg-white/10 ${menu === 'user' ? 'bg-white/10' : ''}`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/20 text-[0.72rem] font-black text-white">
                {(authUser?.displayName || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-28 truncate text-[0.8rem] font-bold text-white xl:block">
                {authUser?.displayName}
              </span>
              <Icon name="chevron-down" size={13} className="hidden xl:block" />
            </button>
            {menu === 'user' && (
              <div className="panel anim-pop absolute end-0 top-11 z-50 w-60 overflow-hidden rounded-lg border border-line shadow-3">
                <div className="border-b border-line px-4 py-3">
                  <p className="truncate text-[0.88rem] font-black text-ink">{authUser?.displayName}</p>
                  <p className="mono truncate text-[0.7rem] font-semibold text-ink-muted">@{authUser?.username}</p>
                </div>
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => { navigate('/settings'); setMenu('none'); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-start text-[0.84rem] font-bold text-ink transition-colors hover:bg-surface-2"
                  >
                    <Icon name="cog" size={16} className="text-ink-muted" /> {t('settings')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { navigate('/license'); setMenu('none'); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-start text-[0.84rem] font-bold text-ink transition-colors hover:bg-surface-2"
                  >
                    <Icon name="key" size={16} className="text-ink-muted" /> {t('license')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDarkMode(!darkMode)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-start text-[0.84rem] font-bold text-ink transition-colors hover:bg-surface-2"
                  >
                    <Icon name={darkMode ? 'sun' : 'moon'} size={16} className="text-ink-muted" />
                    {darkMode ? t('lightMode') : t('darkMode')}
                  </button>
                </div>
                <div className="border-t border-line p-1.5">
                  <button
                    type="button"
                    onClick={logout}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start text-[0.84rem] font-black text-danger transition-colors hover:bg-danger/10"
                  >
                    <Icon name="logout" size={16} /> {t('logout')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {isDesktop && <WindowControls maximized={maximized} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar — desktop only */}
        <aside data-shell className="no-print hidden w-60 shrink-0 flex-col border-e border-black/20 bg-rail lg:flex">
          <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
            {groups.map((g) => (
              <div key={g.labelKey} className="mb-5 last:mb-0">
                <p className="px-3 pb-1.5 text-[0.64rem] font-black uppercase tracking-[0.14em] text-rail-text/50">
                  {t(g.labelKey)}
                </p>
                <div className="space-y-0.5">
                  {g.items.map((item) => (
                    <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand" />}
                          <Icon name={item.icon} size={17} className={isActive ? 'text-brand' : ''} />
                          <span className="flex-1 truncate">{t(item.labelKey)}</span>
                          {counterOf(item.count) > 0 && (
                            <span
                              className={`num rounded-full px-1.5 text-[0.64rem] font-black ${
                                item.countTone === 'danger'
                                  ? 'bg-danger text-white'
                                  : item.countTone === 'warn'
                                    ? 'bg-warn/20 text-warn'
                                    : 'bg-white/10 text-rail-text'
                              }`}
                            >
                              {counterOf(item.count)}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[0.72rem] font-bold text-ok">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
              </span>
              {t('systemReady')}
            </div>
            <p className="num mt-1.5 text-[0.68rem] font-semibold text-rail-text/60">
              {t('todaySales')}: {stats.todaySales} · {formatMoney(stats.todayRevenue, currency)}
            </p>
          </div>
        </aside>

        {/* Content */}
        <main className="scroll-y relative min-w-0 flex-1 overflow-y-auto bg-bg pb-24 lg:pb-0">
          <div className="anim-in mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-5">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        data-shell
        className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface/95 backdrop-blur-lg lg:hidden"
      >
        {mobileTabs.slice(0, 2).map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
        <div className="flex w-16 shrink-0 items-start justify-center">
          {canSell && (
            <button
              type="button"
              onClick={() => navigate('/pos')}
              aria-label={t('pos')}
              className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-brand ring-4 ring-bg transition-transform active:scale-95"
            >
              <Icon name="cart" size={24} strokeWidth={2.3} />
            </button>
          )}
        </div>
        {mobileTabs.slice(2, 3).map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.64rem] font-bold text-ink-muted transition-colors active:text-brand"
        >
          <Icon name="grid" size={20} />
          {t('more')}
        </button>
      </nav>

      {/* More sheet (mobile) */}
      {moreOpen && (
        <div
          className="no-print fixed inset-0 z-[900] flex items-end justify-center bg-overlay/60 backdrop-blur-sm lg:hidden"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setMoreOpen(false); }}
        >
          <div className="panel anim-pop max-h-[85dvh] w-full overflow-y-auto scroll-y rounded-t-xl border border-line pb-2">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface-2 px-4 py-3">
              <p className="text-[0.95rem] font-black text-ink">{t('more')}</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t('cancel')}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                <Icon name="x" size={17} />
              </button>
            </div>
            <div className="px-4 py-3">
              <GlobalSearch onNavigate={() => setMoreOpen(false)} />
            </div>
            <div className="grid grid-cols-3 gap-2 px-3 pb-4">
              {groups.flatMap((g) => g.items).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-center transition-colors ${
                      isActive ? 'border-brand/30 bg-brand/12 text-brand' : 'border-line bg-surface-2 text-ink-2'
                    }`
                  }
                >
                  <Icon name={item.icon} size={20} />
                  <span className="text-[0.7rem] font-bold leading-tight">{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </div>
            <div className="border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-danger/10 py-2.5 text-[0.84rem] font-black text-danger"
              >
                <Icon name="logout" size={16} /> {t('logout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileTab({ item }: { item: NavItem }) {
  const { t } = useT();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.64rem] font-bold transition-colors ${
          isActive ? 'text-brand' : 'text-ink-muted'
        }`
      }
    >
      <Icon name={item.icon} size={20} />
      <span className="truncate">{t(item.labelKey)}</span>
    </NavLink>
  );
}
