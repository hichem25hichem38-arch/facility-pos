import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, EmptyState, PageHeader, Spinner, StatCard, Table, Tabs, Td, Row,
} from '@/components/ui';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { ReportService, type SalesReportData } from '@/services/reports/report.service';
import { endOfDay, formatDate, formatDateTime, formatMoney, round2, startOfDay } from '@/utils/format';
import { exportToXlsx } from '@/utils/export';
import type { Payment, Sale } from '@/types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type Section = 'sales' | 'profit' | 'inventory' | 'installments' | 'top';

interface DayBucket { key: string; label: string; sales: number; collections: number }

type InventoryReport = Awaited<ReturnType<ReportService['getInventoryReport']>>;
type InstallmentsReport = Awaited<ReturnType<ReportService['getInstallmentsReport']>>;
type TopProduct = Awaited<ReturnType<ReportService['getTopProducts']>>[number];

type ReportData =
  | { invalid: true }
  | {
      invalid: false;
      salesReport: SalesReportData;
      inventoryReport: InventoryReport;
      installmentsReport: InstallmentsReport;
      topProducts: TopProduct[];
      days: DayBucket[];
    };

/** Normalise NaN / -0 so nothing ugly reaches the UI or exports. */
function nz(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Object.is(n, -0) ? 0 : n;
}

function dateInputValue(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDateInput(v: string): number | undefined {
  if (!v) return undefined;
  const ts = new Date(`${v}T12:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function computeRange(preset: Preset, from: string, to: string): { fromTs: number; toTs: number } {
  const now = Date.now();
  const todayStart = startOfDay(now);
  switch (preset) {
    case 'today':
      return { fromTs: todayStart, toTs: endOfDay(todayStart) };
    case 'yesterday': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const ys = startOfDay(d.getTime());
      return { fromTs: ys, toTs: endOfDay(ys) };
    }
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { fromTs: startOfDay(d.getTime()), toTs: endOfDay(now) };
    }
    case 'month': {
      const d = new Date(now);
      d.setDate(1);
      return { fromTs: startOfDay(d.getTime()), toTs: endOfDay(now) };
    }
    case 'custom': {
      const f = parseDateInput(from);
      const tt = parseDateInput(to);
      if (f === undefined || tt === undefined) return { fromTs: NaN, toTs: NaN };
      return { fromTs: startOfDay(f), toTs: endOfDay(tt) };
    }
  }
}

/**
 * Local-day-safe bucketing. Deliberately does NOT use ReportService.byDay,
 * whose toISOString keys shift a day for UTC+1 and drift across DST.
 */
function buildDayBuckets(fromTs: number, toTs: number, sales: Sale[], payments: Payment[], locale: string): DayBucket[] {
  const salesByDay = new Map<number, number>();
  for (const s of sales) {
    const k = startOfDay(s.saleDate);
    salesByDay.set(k, round2((salesByDay.get(k) ?? 0) + s.totalAmount));
  }
  const payByDay = new Map<number, number>();
  for (const p of payments) {
    const k = startOfDay(p.paymentDate);
    payByDay.set(k, round2((payByDay.get(k) ?? 0) + p.amount));
  }
  const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
  const buckets: DayBucket[] = [];
  let cur = startOfDay(fromTs);
  const end = startOfDay(toTs);
  let guard = 0;
  while (cur <= end && guard < 366) {
    buckets.push({
      key: String(cur),
      label: fmt.format(new Date(cur)),
      sales: nz(salesByDay.get(cur) ?? 0),
      collections: nz(payByDay.get(cur) ?? 0),
    });
    const d = new Date(cur);
    d.setDate(d.getDate() + 1);
    cur = startOfDay(d.getTime());
    guard++;
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

function SalesChart({ days, currency }: { days: DayBucket[]; currency: string }) {
  const { t } = useT();
  const max = Math.max(1, ...days.map((d) => Math.max(d.sales, d.collections)));
  const height = (v: number) => `${v <= 0 ? 2 : Math.max(4, (v / max) * 100)}%`;
  const every = days.length > 15 ? Math.ceil(days.length / 10) : 1;

  if (days.length === 0 || days.every((d) => d.sales === 0 && d.collections === 0)) {
    return <EmptyState icon="chart" title={t('noData')} hint={t('salesTrendHint')} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> {t('sales')}
        </span>
        <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-ok" /> {t('collections')}
        </span>
      </div>
      <div className="flex h-48 items-stretch gap-0.5 sm:gap-1.5">
        {days.map((d, i) => (
          <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end justify-center gap-0.5">
              <div
                title={`${d.label} · ${t('sales')}: ${formatMoney(d.sales, currency)}`}
                className="w-1/2 max-w-5 rounded-t-[3px] bg-brand transition-all duration-300 hover:bg-brand-hover"
                style={{ height: height(d.sales) }}
              />
              <div
                title={`${d.label} · ${t('collections')}: ${formatMoney(d.collections, currency)}`}
                className="w-1/2 max-w-5 rounded-t-[3px] bg-ok/75 transition-all duration-300 hover:bg-ok"
                style={{ height: height(d.collections) }}
              />
            </div>
            <span className="truncate text-[0.6rem] font-bold text-ink-muted">
              {i % every === 0 ? d.label : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function ReportsPage() {
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);
  const storeName = useAppStore((s) => s.storeName);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(() => dateInputValue(Date.now() - 30 * 86_400_000));
  const [to, setTo] = useState(() => dateInputValue(Date.now()));
  const [section, setSection] = useState<Section>('sales');

  const { fromTs, toTs } = useMemo(() => computeRange(preset, from, to), [preset, from, to]);

  const data = useLiveQuery<ReportData | undefined>(async () => {
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
      return { invalid: true };
    }
    const db = getDb();
    const service = new ReportService();
    const [salesReport, inventoryReport, installmentsReport, topProducts, rawSales, rawPayments] = await Promise.all([
      service.getSalesReport(fromTs, toTs),
      service.getInventoryReport(),
      service.getInstallmentsReport(),
      service.getTopProducts(10, fromTs, toTs),
      db.sales.where('saleDate').between(fromTs, toTs, true, true).toArray(),
      db.payments.where('paymentDate').between(fromTs, toTs, true, true).toArray(),
    ]);
    const sales = rawSales.filter((s) => s.status !== 'CANCELLED');
    const payments = rawPayments.filter((p) => p.status === 'ACTIVE');
    return {
      invalid: false,
      salesReport,
      inventoryReport,
      installmentsReport,
      topProducts,
      days: buildDayBuckets(fromTs, toTs, sales, payments, dateLocale),
    };
  }, [fromTs, toTs, dateLocale]);

  const rangeLabel =
    Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs <= toTs
      ? `${formatDate(fromTs, dateLocale)} — ${formatDate(toTs, dateLocale)}`
      : t('customRange');

  const PRESETS: { value: Preset; label: string }[] = [
    { value: 'today', label: t('today') },
    { value: 'yesterday', label: t('yesterday') },
    { value: 'week', label: t('thisWeek') },
    { value: 'month', label: t('thisMonth') },
    { value: 'custom', label: t('customRange') },
  ];

  /* ---------------- Export handlers ---------------- */

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportSales = () => {
    if (!data || data.invalid) return;
    const rows = data.days.map((d) => ({
      [t('date')]: d.label,
      [t('sales')]: nz(d.sales),
      [t('collections')]: nz(d.collections),
    }));
    rows.push({
      [t('date')]: t('total'),
      [t('sales')]: nz(data.salesReport.revenue),
      [t('collections')]: nz(data.days.reduce((a, d) => a + d.collections, 0)),
    });
    exportToXlsx(rows, `sales-report-${stamp()}.xlsx`, t('salesReport'));
  };

  const exportProfit = () => {
    if (!data || data.invalid) return;
    const revenue = nz(data.salesReport.revenue);
    const profit = nz(data.salesReport.profit);
    const cost = nz(round2(revenue - profit));
    const margin = revenue > 0 ? nz(round2((profit / revenue) * 100)) : 0;
    exportToXlsx(
      [{ [t('revenue')]: revenue, [t('cost')]: cost, [t('profit')]: profit, [t('profitMargin')]: `${margin}%` }],
      `profit-report-${stamp()}.xlsx`,
      t('profitReport'),
    );
  };

  const exportInventory = () => {
    if (!data || data.invalid) return;
    const rows = data.inventoryReport.lowStock.map((p) => ({
      [t('product')]: p.name,
      [t('stock')]: p.stockQuantity,
      [t('minimumStock')]: p.minimumStock,
    }));
    exportToXlsx(rows, `inventory-report-${stamp()}.xlsx`, t('inventoryReport'));
  };

  const exportInstallments = () => {
    if (!data || data.invalid) return;
    const r = data.installmentsReport;
    exportToXlsx(
      [{
        [t('contractsCount')]: r.totalPlans,
        [t('financedAmount')]: nz(r.financedTotal),
        [t('paid')]: nz(r.collectedTotal),
        [t('remaining')]: nz(r.remainingTotal),
        [t('dueTodayAlert')]: r.dueCount,
        [t('overdueAlert')]: r.overdueCount,
      }],
      `installments-report-${stamp()}.xlsx`,
      t('installmentsReport'),
    );
  };

  const exportTop = () => {
    if (!data || data.invalid) return;
    const rows = data.topProducts.map((p) => ({
      [t('product')]: p.name,
      [t('quantitySold')]: p.quantitySold,
      [t('revenue')]: nz(p.revenue),
    }));
    exportToXlsx(rows, `top-products-${stamp()}.xlsx`, t('topProducts'));
  };

  /* ---------------- Render ---------------- */

  const loading = data === undefined;
  const invalid = data?.invalid === true;
  const d = data && !data.invalid ? data : null;

  const salesHasData = !!d && (d.salesReport.totalSales > 0 || d.days.some((x) => x.sales > 0 || x.collections > 0));
  const totalCollections = d ? nz(round2(d.days.reduce((a, x) => a + x.collections, 0))) : 0;

  return (
    <>
      <div className="no-print flex flex-col gap-5">
        <PageHeader
          icon="chart"
          title={t('reports')}
          subtitle={t('reportsSubtitle')}
          actions={
            <>
              <Badge tone="muted" icon="calendar">{rangeLabel}</Badge>
              <Button icon="print" variant="secondary" onClick={() => window.print()}>{t('printReport')}</Button>
            </>
          }
        />

        {/* Range presets */}
        <Card padded>
          <div className="flex flex-wrap items-center gap-2">
            <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPreset(p.value)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-[0.8rem] font-extrabold transition-colors ${
                    preset === p.value
                      ? 'border-brand/40 bg-brand/12 text-brand'
                      : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 ms-auto">
                <label className="flex items-center gap-1.5 text-[0.74rem] font-bold text-ink-2">
                  {t('from')}
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9 rounded-md border border-line bg-surface-2 px-2 text-[0.8rem] font-semibold text-ink outline-none focus:border-brand"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[0.74rem] font-bold text-ink-2">
                  {t('to')}
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9 rounded-md border border-line bg-surface-2 px-2 text-[0.8rem] font-semibold text-ink outline-none focus:border-brand"
                  />
                </label>
              </div>
            )}
          </div>
        </Card>

        {/* Section tabs */}
        <Tabs
          value={section}
          onChange={(v) => setSection(v as Section)}
          tabs={[
            { value: 'sales', label: t('salesReport'), icon: 'receipt' },
            { value: 'profit', label: t('profitReport'), icon: 'trend-up' },
            { value: 'inventory', label: t('inventoryReport'), icon: 'box' },
            { value: 'installments', label: t('installmentsReport'), icon: 'wallet' },
            { value: 'top', label: t('topProducts'), icon: 'trophy' },
          ]}
        />

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-ink-muted">
            <Spinner size={18} />
            <span className="text-[0.84rem] font-bold">{t('loading')}</span>
          </div>
        ) : invalid ? (
          <EmptyState icon="calendar" title={t('noRangeData')} hint={t('noRangeDataHint')} />
        ) : d ? (
          <>
            {/* -------- Sales -------- */}
            {section === 'sales' && (
              salesHasData ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard icon="banknote" tone="ok" label={t('revenue')} value={formatMoney(nz(d.salesReport.revenue), currency)} />
                    <StatCard icon="wallet" tone="brand" label={t('collections')} value={formatMoney(totalCollections, currency)} />
                    <StatCard icon="receipt" tone="info" label={t('operationsCount')} value={String(d.salesReport.totalSales)} />
                    <StatCard
                      icon="chart"
                      tone="purple"
                      label={t('avgSale')}
                      value={formatMoney(d.salesReport.totalSales > 0 ? nz(round2(d.salesReport.revenue / d.salesReport.totalSales)) : 0, currency)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info" icon="banknote">{t('cashSales')}: {d.salesReport.cashSales}</Badge>
                    <Badge tone="purple" icon="wallet">{t('installmentSales')}: {d.salesReport.installmentSales}</Badge>
                  </div>
                  <Card
                    icon="chart"
                    title={t('salesVsCollections')}
                    subtitle={rangeLabel}
                    actions={<Button size="sm" variant="secondary" icon="download" onClick={exportSales}>{t('exportData')}</Button>}
                  >
                    <SalesChart days={d.days} currency={currency} />
                  </Card>
                </div>
              ) : (
                <EmptyState icon="receipt" title={t('noRangeData')} hint={t('noRangeDataHint')} />
              )
            )}

            {/* -------- Profit -------- */}
            {section === 'profit' && (
              salesHasData ? (
                <Card
                  icon="trend-up"
                  title={t('profitReport')}
                  subtitle={rangeLabel}
                  actions={<Button size="sm" variant="secondary" icon="download" onClick={exportProfit}>{t('exportData')}</Button>}
                >
                  {(() => {
                    const revenue = nz(d.salesReport.revenue);
                    const profit = nz(d.salesReport.profit);
                    const cost = nz(round2(revenue - profit));
                    const margin = revenue > 0 ? nz(round2((profit / revenue) * 100)) : 0;
                    return (
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatCard icon="banknote" tone="ok" label={t('revenue')} value={formatMoney(revenue, currency)} />
                        <StatCard icon="percent" tone="warn" label={t('cost')} value={formatMoney(cost, currency)} />
                        <StatCard
                          icon={profit >= 0 ? 'trend-up' : 'trend-down'}
                          tone={profit >= 0 ? 'ok' : 'danger'}
                          label={t('profit')}
                          value={formatMoney(profit, currency)}
                        />
                        <StatCard
                          icon="percent"
                          tone={margin >= 0 ? 'brand' : 'danger'}
                          label={t('profitMargin')}
                          value={`${margin}%`}
                          delta={t('profit')}
                          deltaTone={margin >= 0 ? 'ok' : 'danger'}
                        />
                      </div>
                    );
                  })()}
                </Card>
              ) : (
                <EmptyState icon="trend-up" title={t('noRangeData')} hint={t('noRangeDataHint')} />
              )
            )}

            {/* -------- Inventory -------- */}
            {section === 'inventory' && (
              <Card
                icon="box"
                title={t('inventoryReport')}
                actions={<Button size="sm" variant="secondary" icon="download" onClick={exportInventory}>{t('exportData')}</Button>}
                padded={false}
              >
                <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
                  <StatCard icon="database" tone="info" label={t('inventoryValue')} value={formatMoney(nz(d.inventoryReport.inventoryValue), currency)} delta={t('valueAtPurchase')} deltaTone="muted" />
                  <StatCard icon="box" tone="brand" label={t('totalProducts')} value={String(d.inventoryReport.totalProducts)} />
                  <StatCard
                    icon="alert"
                    tone={d.inventoryReport.lowStock.length > 0 ? 'warn' : 'muted'}
                    label={t('lowStockCount')}
                    value={String(d.inventoryReport.lowStock.length)}
                  />
                </div>
                {d.inventoryReport.lowStock.length === 0 ? (
                  <EmptyState icon="check" title={t('lowStockEmpty')} />
                ) : (
                  <div className="border-t border-line">
                    <Table head={[t('product'), t('stock'), t('minimumStock')]}>
                      {d.inventoryReport.lowStock.map((p, i) => (
                        <Row key={`${p.name}-${i}`}>
                          <Td><span className="block max-w-64 truncate font-bold text-ink">{p.name}</span></Td>
                          <Td><Badge tone={p.stockQuantity <= 0 ? 'danger' : 'warn'}>{p.stockQuantity}</Badge></Td>
                          <Td><span className="num text-ink-muted">{p.minimumStock}</span></Td>
                        </Row>
                      ))}
                    </Table>
                  </div>
                )}
              </Card>
            )}

            {/* -------- Installments -------- */}
            {section === 'installments' && (
              <Card
                icon="wallet"
                title={t('installmentsReport')}
                actions={<Button size="sm" variant="secondary" icon="download" onClick={exportInstallments}>{t('exportData')}</Button>}
              >
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <StatCard icon="banknote" tone="brand" label={t('financedAmount')} value={formatMoney(nz(d.installmentsReport.financedTotal), currency)} />
                  <StatCard icon="wallet" tone="ok" label={t('paid')} value={formatMoney(nz(d.installmentsReport.collectedTotal), currency)} />
                  <StatCard icon="clock" tone="warn" label={t('remaining')} value={formatMoney(nz(d.installmentsReport.remainingTotal), currency)} />
                  <StatCard icon="file" tone="purple" label={t('contractsCount')} value={String(d.installmentsReport.totalPlans)} />
                  <StatCard icon="calendar" tone="info" label={t('dueTodayAlert')} value={String(d.installmentsReport.dueCount)} />
                  <StatCard icon="alert" tone={d.installmentsReport.overdueCount > 0 ? 'danger' : 'muted'} label={t('overdueAlert')} value={String(d.installmentsReport.overdueCount)} />
                </div>
              </Card>
            )}

            {/* -------- Top products -------- */}
            {section === 'top' && (
              d.topProducts.length === 0 ? (
                <EmptyState icon="trophy" title={t('noData')} hint={t('salesTrendHint')} />
              ) : (
                <Card
                  icon="trophy"
                  title={t('topProducts')}
                  subtitle={rangeLabel}
                  actions={<Button size="sm" variant="secondary" icon="download" onClick={exportTop}>{t('exportData')}</Button>}
                  padded={false}
                >
                  <TopList items={d.topProducts} currency={currency} />
                </Card>
              )
            )}
          </>
        ) : null}
      </div>

      {/* Real print root */}
      {d && (
        <div className="print-only">
          <div className="print-area">
            <ReportPrintDoc
              data={d}
              storeName={storeName || t('appName')}
              rangeLabel={rangeLabel}
              generated={formatDateTime(Date.now(), dateLocale)}
              currency={currency}
              totalCollections={totalCollections}
              t={t}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Top products list (on screen)                                       */
/* ------------------------------------------------------------------ */

function TopList({ items, currency }: { items: TopProduct[]; currency: string }) {
  const { t } = useT();
  const maxQty = Math.max(1, ...items.map((p) => p.quantitySold));
  return (
    <ul className="divide-y divide-line">
      {items.map((p, i) => (
        <li key={`${p.name}-${i}`} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-[0.74rem] font-black text-ink-2">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.86rem] font-bold text-ink">{p.name}</span>
              <span className="num block text-[0.7rem] font-semibold text-ink-muted">
                {t('quantitySold')}: {p.quantitySold}
              </span>
            </span>
            <span className="num shrink-0 text-[0.9rem] font-black text-ink">{formatMoney(nz(p.revenue), currency)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${(p.quantitySold / maxQty) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Print document                                                      */
/* ------------------------------------------------------------------ */

/* Print-only document: plain black/white inline styles are the sanctioned
 * exception to the token rule (paper output must not depend on theme). */
const P: Record<string, CSSProperties> = {
  h: { fontWeight: 800, fontSize: '13pt', margin: '0 0 1mm' },
  section: { marginTop: '6mm' },
  sectionTitle: {
    fontWeight: 800,
    fontSize: '10.5pt',
    borderBottom: '1px solid #000',
    paddingBottom: '1mm',
    marginBottom: '2mm',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '9pt' },
  th: { border: '1px solid #000', padding: '1.5mm', textAlign: 'start', fontWeight: 800, background: '#eee' },
  td: { border: '1px solid #000', padding: '1.5mm', textAlign: 'start' },
  kv: { display: 'flex', flexWrap: 'wrap', gap: '4mm', fontSize: '9.5pt' },
  kvItem: { minWidth: '34mm' },
  kvLabel: { fontWeight: 700, color: '#333' },
  kvValue: { fontWeight: 800, fontSize: '11pt' },
};

function ReportPrintDoc({
  data, storeName, rangeLabel, generated, currency, totalCollections, t,
}: {
  data: Extract<ReportData, { invalid: false }>;
  storeName: string;
  rangeLabel: string;
  generated: string;
  currency: string;
  totalCollections: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const s = data.salesReport;
  const revenue = nz(s.revenue);
  const profit = nz(s.profit);
  const cost = nz(round2(revenue - profit));
  const margin = revenue > 0 ? nz(round2((profit / revenue) * 100)) : 0;
  const inv = data.inventoryReport;
  const inst = data.installmentsReport;

  return (
    <div dir="rtl" style={{ color: '#000', background: '#fff', padding: '4mm', fontFamily: 'var(--font)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #000', paddingBottom: '2mm' }}>
        <div style={P.h}>{storeName} — {t('reportTitle')}</div>
        <div style={{ fontSize: '8.5pt' }}>{t('generatedAt')}: {generated}</div>
      </div>
      <div style={{ fontSize: '9pt', marginTop: '1.5mm' }}>{t('reportRange')}: {rangeLabel}</div>

      {/* Sales */}
      <div style={P.section}>
        <div style={P.sectionTitle}>{t('salesReport')}</div>
        <div style={P.kv}>
          <PrintKV label={t('revenue')} value={`${revenue.toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('collections')} value={`${totalCollections.toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('operationsCount')} value={String(s.totalSales)} />
          <PrintKV label={t('cashSales')} value={String(s.cashSales)} />
          <PrintKV label={t('installmentSales')} value={String(s.installmentSales)} />
        </div>
      </div>

      {/* Profit */}
      <div style={P.section}>
        <div style={P.sectionTitle}>{t('profitReport')}</div>
        <div style={P.kv}>
          <PrintKV label={t('revenue')} value={`${revenue.toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('cost')} value={`${cost.toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('profit')} value={`${profit.toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('profitMargin')} value={`${margin}%`} />
        </div>
      </div>

      {/* Top products */}
      {data.topProducts.length > 0 && (
        <div style={P.section}>
          <div style={P.sectionTitle}>{t('topProducts')}</div>
          <table style={P.table}>
            <thead>
              <tr>
                <th style={P.th}>#</th>
                <th style={P.th}>{t('product')}</th>
                <th style={P.th}>{t('quantitySold')}</th>
                <th style={P.th}>{t('revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td style={P.td}>{i + 1}</td>
                  <td style={P.td}>{p.name}</td>
                  <td style={P.td}>{p.quantitySold}</td>
                  <td style={P.td}>{`${nz(p.revenue).toLocaleString('ar-DZ')} ${currency}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inventory */}
      <div style={P.section}>
        <div style={P.sectionTitle}>{t('inventoryReport')}</div>
        <div style={P.kv}>
          <PrintKV label={t('inventoryValue')} value={`${nz(inv.inventoryValue).toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('totalProducts')} value={String(inv.totalProducts)} />
          <PrintKV label={t('lowStockCount')} value={String(inv.lowStock.length)} />
        </div>
      </div>

      {/* Installments */}
      <div style={P.section}>
        <div style={P.sectionTitle}>{t('installmentsReport')}</div>
        <div style={P.kv}>
          <PrintKV label={t('contractsCount')} value={String(inst.totalPlans)} />
          <PrintKV label={t('financedAmount')} value={`${nz(inst.financedTotal).toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('paid')} value={`${nz(inst.collectedTotal).toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('remaining')} value={`${nz(inst.remainingTotal).toLocaleString('ar-DZ')} ${currency}`} />
          <PrintKV label={t('dueTodayAlert')} value={String(inst.dueCount)} />
          <PrintKV label={t('overdueAlert')} value={String(inst.overdueCount)} />
        </div>
      </div>
    </div>
  );
}

function PrintKV({ label, value }: { label: string; value: string }) {
  return (
    <div style={P.kvItem}>
      <div style={P.kvLabel}>{label}</div>
      <div style={P.kvValue}>{value}</div>
    </div>
  );
}
