import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { endOfDay, formatMoney, round2, startOfDay } from '@/utils/format';
import type { Permission } from '@/types';

interface DayPoint { key: string; label: string; sales: number; collections: number }

interface DashboardData {
  productCount: number;
  inventoryValue: number;
  customerCount: number;
  todaySales: number;
  todayCount: number;
  todayCollections: number;
  todayProfit: number;
  totalRemaining: number;
  days: DayPoint[];
  lowStock: { id: string; name: string; stock: number; min: number }[];
  dueToday: { id: string; planId: string; customer: string; amount: number; number: number }[];
  overdue: { id: string; planId: string; customer: string; amount: number; days: number; number: number }[];
  top: { name: string; qty: number; revenue: number }[];
}

const EMPTY: DashboardData = {
  productCount: 0, inventoryValue: 0, customerCount: 0, todaySales: 0, todayCount: 0,
  todayCollections: 0, todayProfit: 0, totalRemaining: 0, days: [], lowStock: [],
  dueToday: [], overdue: [], top: [],
};

function useDashboard(locale: string): DashboardData {
  return useLiveQuery(async () => {
    const db = getDb();
    const now = Date.now();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(dayStart);
    const weekStart = startOfDay(now - 6 * 86_400_000);

    const [products, customers, plans, openInstallments, weekSales, weekPayments, activeSales] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      db.installmentPlans.toArray(),
      db.installments.where('status').anyOf(['PENDING', 'PARTIAL', 'OVERDUE']).toArray(),
      db.sales.where('saleDate').between(weekStart, dayEnd, true, true).toArray(),
      db.payments.where('paymentDate').between(weekStart, dayEnd, true, true).toArray(),
      db.sales.filter((s) => s.status !== 'CANCELLED').toArray(),
    ]);

    const sales = weekSales.filter((s) => s.status !== 'CANCELLED');
    const payments = weekPayments.filter((p) => p.status === 'ACTIVE');
    const todaySales = sales.filter((s) => s.saleDate >= dayStart && s.saleDate <= dayEnd);

    const costMap = new Map(products.map((p) => [p.id, p.purchasePrice]));
    const items = await db.saleItems.where('saleId').anyOf(todaySales.map((s) => s.id)).toArray();
    let profit = 0;
    for (const sale of todaySales) {
      const lines = items.filter((i) => i.saleId === sale.id);
      for (const line of lines) {
        profit += line.total - line.quantity * (costMap.get(line.productId) ?? 0);
      }
      if (sale.discount > 0 && sale.subtotal > 0) {
        profit -= sale.discount;
      }
    }

    const days: DayPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = startOfDay(now - i * 86_400_000);
      const end = endOfDay(start);
      days.push({
        key: String(start),
        label: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(start)),
        sales: round2(sales.filter((s) => s.saleDate >= start && s.saleDate <= end).reduce((a, s) => a + s.totalAmount, 0)),
        collections: round2(payments.filter((p) => p.paymentDate >= start && p.paymentDate <= end).reduce((a, p) => a + p.amount, 0)),
      });
    }

    const planMap = new Map(plans.map((p) => [p.id, p]));
    const saleMap = new Map(activeSales.map((s) => [s.id, s]));
    const customerName = new Map(customers.map((c) => [c.id, c.fullName]));
    const nameOf = (planId: string) => {
      const plan = planMap.get(planId);
      const sale = plan ? saleMap.get(plan.saleId) : undefined;
      return (sale?.customerId && customerName.get(sale.customerId)) || '—';
    };

    const open = openInstallments.filter((i) => i.remainingAmount > 0);
    const dueToday = open
      .filter((i) => i.dueDate >= dayStart && i.dueDate <= dayEnd)
      .map((i) => ({ id: i.id, planId: i.planId, customer: nameOf(i.planId), amount: i.remainingAmount, number: i.installmentNumber }))
      .sort((a, b) => b.amount - a.amount);
    const overdue = open
      .filter((i) => i.dueDate < dayStart)
      .map((i) => ({
        id: i.id,
        planId: i.planId,
        customer: nameOf(i.planId),
        amount: i.remainingAmount,
        number: i.installmentNumber,
        days: Math.max(1, Math.floor((dayStart - startOfDay(i.dueDate)) / 86_400_000)),
      }))
      .sort((a, b) => b.days - a.days);

    const revenueByProduct = new Map<string, { qty: number; rev: number }>();
    const validIds = new Set(activeSales.map((s) => s.id));
    const allItems = await db.saleItems.toArray();
    for (const item of allItems) {
      if (!validIds.has(item.saleId)) continue;
      const cur = revenueByProduct.get(item.productId) ?? { qty: 0, rev: 0 };
      cur.qty += item.quantity;
      cur.rev += item.total;
      revenueByProduct.set(item.productId, cur);
    }
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const top = [...revenueByProduct.entries()]
      .map(([pid, v]) => ({ name: productName.get(pid) ?? pid, qty: v.qty, revenue: round2(v.rev) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      productCount: products.filter((p) => p.isActive).length,
      inventoryValue: round2(products.filter((p) => p.isActive).reduce((a, p) => a + p.stockQuantity * p.purchasePrice, 0)),
      customerCount: customers.length,
      todaySales: round2(todaySales.reduce((a, s) => a + s.totalAmount, 0)),
      todayCount: todaySales.length,
      todayCollections: round2(payments.filter((p) => p.paymentDate >= dayStart && p.paymentDate <= dayEnd).reduce((a, p) => a + p.amount, 0)),
      todayProfit: round2(profit),
      totalRemaining: round2(open.reduce((a, i) => a + i.remainingAmount, 0)),
      days,
      lowStock: products
        .filter((p) => p.isActive && p.stockQuantity <= p.minimumStock)
        .sort((a, b) => a.stockQuantity - b.stockQuantity)
        .slice(0, 8)
        .map((p) => ({ id: p.id, name: p.name, stock: p.stockQuantity, min: p.minimumStock })),
      dueToday,
      overdue,
      top,
    };
  }, [locale], EMPTY) ?? EMPTY;
}

function TrendChart({ days }: { days: DayPoint[] }) {
  const { t } = useT();
  const currency = useAppStore((s) => s.currency);
  const max = Math.max(1, ...days.map((d) => Math.max(d.sales, d.collections)));
  const height = (v: number) => `${v <= 0 ? 2 : Math.max(4, (v / max) * 100)}%`;

  if (days.every((d) => d.sales === 0 && d.collections === 0)) {
    return <EmptyState icon="chart" title={t('noData')} hint={t('salesTrendHint')} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> {t('sales')}
        </span>
        <span className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-ok" /> {t('todayCollections')}
        </span>
      </div>
      <div className="flex h-44 items-stretch gap-1.5 sm:gap-3">
        {days.map((d) => (
          <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              <div
                title={`${t('sales')}: ${formatMoney(d.sales, currency)}`}
                className="w-1/2 max-w-6 rounded-t-[4px] bg-brand transition-all duration-300 hover:bg-brand-hover"
                style={{ height: height(d.sales) }}
              />
              <div
                title={`${t('todayCollections')}: ${formatMoney(d.collections, currency)}`}
                className="w-1/2 max-w-6 rounded-t-[4px] bg-ok/75 transition-all duration-300 hover:bg-ok"
                style={{ height: height(d.collections) }}
              />
            </div>
            <span className="truncate text-[0.66rem] font-bold text-ink-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const data = useDashboard(locale === 'ar' ? 'ar-DZ' : 'fr-DZ');

  const margin = data.todaySales > 0 ? Math.round((data.todayProfit / data.todaySales) * 100) : 0;
  const maxQty = useMemo(() => Math.max(1, ...data.top.map((p) => p.qty)), [data.top]);

  const quick: { icon: IconName; label: string; to: string; tone: string; permission?: Permission }[] = [
    { icon: 'cart', label: t('pos'), to: '/pos', tone: 'bg-brand/12 text-brand', permission: 'sales.create' },
    { icon: 'box', label: t('addProduct'), to: '/products?new=1', tone: 'bg-purple/12 text-purple', permission: 'products.create' },
    { icon: 'user', label: t('addCustomer'), to: '/customers?new=1', tone: 'bg-info/12 text-info', permission: 'customers.create' },
    { icon: 'wallet', label: t('recordPayment'), to: '/installments', tone: 'bg-ok/12 text-ok', permission: 'payments.create' },
    { icon: 'chart', label: t('reports'), to: '/reports', tone: 'bg-warn/12 text-warn', permission: 'reports.view' },
    { icon: 'scan', label: t('scanner'), to: '/scanner', tone: 'bg-danger/12 text-danger' },
  ];

  return (
    <>
      <PageHeader
        icon="dashboard"
        title={t('dashboard')}
        subtitle={`${new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : 'fr-DZ', { dateStyle: 'full' }).format(new Date())}`}
        actions={
          hasPermission('sales.create') ? (
            <Button icon="cart" size="lg" onClick={() => navigate('/pos')}>{t('pos')}</Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="banknote" tone="ok" label={t('todaySales')} value={formatMoney(data.todaySales, currency)} delta={`${data.todayCount} ${t('records')}`} />
        <StatCard icon="wallet" tone="brand" label={t('todayCollections')} value={formatMoney(data.todayCollections, currency)} />
        <StatCard
          icon={data.todayProfit >= 0 ? 'trend-up' : 'trend-down'}
          tone={data.todayProfit >= 0 ? 'ok' : 'danger'}
          label={t('profitToday')}
          value={formatMoney(data.todayProfit, currency)}
          delta={`${margin}%`}
          deltaTone={margin >= 0 ? 'ok' : 'danger'}
        />
        <StatCard icon="clock" tone="warn" label={t('totalRemaining')} value={formatMoney(data.totalRemaining, currency)} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="box" tone="purple" label={t('totalProducts')} value={String(data.productCount)} />
        <StatCard icon="database" tone="info" label={t('inventoryValue')} value={formatMoney(data.inventoryValue, currency)} />
        <StatCard icon="users" tone="brand" label={t('totalCustomers')} value={String(data.customerCount)} />
        <StatCard
          icon="alert"
          tone={data.overdue.length ? 'danger' : 'muted'}
          label={t('overdueAlert')}
          value={String(data.overdue.length)}
          delta={data.lowStock.length ? t('lowStockItems', { count: data.lowStock.length }) : undefined}
          deltaTone="muted"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" icon="chart" title={t('salesTrend')} subtitle={t('last7Days')} padded>
          <TrendChart days={data.days} />
        </Card>

        <Card icon="sparkles" title={t('quickActions')} padded={false}>
          <div className="grid grid-cols-2 gap-2 p-3">
            {quick.filter((q) => !q.permission || hasPermission(q.permission)).map((q) => (
              <button
                key={q.to}
                type="button"
                onClick={() => navigate(q.to)}
                className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-3.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface"
              >
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${q.tone}`}>
                  <Icon name={q.icon} size={17} />
                </span>
                <span className="text-[0.74rem] font-bold leading-tight text-ink-2">{q.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          icon="trophy"
          title={t('topProducts')}
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>{t('viewAll')}</Button>}
        >
          {data.top.length === 0 ? (
            <EmptyState icon="chart" title={t('noData')} />
          ) : (
            <ul className="space-y-2.5">
              {data.top.map((p, i) => (
                <li key={p.name}>
                  <div className="flex items-center gap-2.5">
                    <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-2 text-[0.7rem] font-black text-ink-2">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-ink">{p.name}</span>
                    <span className="num shrink-0 text-[0.78rem] font-black text-ink">{formatMoney(p.revenue, currency)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          icon="clock"
          title={t('dueTodayAlert')}
          actions={<Badge tone={data.dueToday.length ? 'warn' : 'muted'}>{data.dueToday.length}</Badge>}
          padded={false}
        >
          {data.dueToday.length === 0 ? (
            <EmptyState icon="check" title={t('dueTodayEmpty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.dueToday.slice(0, 6).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/installments?plan=${i.planId}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-warn/12 text-warn">
                      <Icon name="wallet" size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-bold text-ink">{i.customer}</span>
                      <span className="num block text-[0.7rem] font-semibold text-ink-muted">
                        {t('installmentAmount')} {i.number}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[0.84rem] font-black text-ink">{formatMoney(i.amount, currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          icon="alert"
          title={t('overdueAlert')}
          actions={<Badge tone={data.overdue.length ? 'danger' : 'muted'}>{data.overdue.length}</Badge>}
          padded={false}
        >
          {data.overdue.length === 0 ? (
            <EmptyState icon="check" title={t('overdueEmpty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.overdue.slice(0, 6).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/installments?plan=${i.planId}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-danger/12 text-danger">
                      <Icon name="alert" size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-bold text-ink">{i.customer}</span>
                      <span className="block text-[0.7rem] font-bold text-danger">{t('daysLate', { days: i.days })}</span>
                    </span>
                    <span className="num shrink-0 text-[0.84rem] font-black text-ink">{formatMoney(i.amount, currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        icon="box"
        title={t('lowStockAlert')}
        actions={<Button variant="ghost" size="sm" onClick={() => navigate('/inventory')}>{t('viewAll')}</Button>}
        padded={false}
      >
        {data.lowStock.length === 0 ? (
          <EmptyState icon="check" title={t('lowStockEmpty')} />
        ) : (
          <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.lowStock.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${p.stock <= 0 ? 'bg-danger/12 text-danger' : 'bg-warn/12 text-warn'}`}>
                  <Icon name={p.stock <= 0 ? 'alert' : 'box'} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.82rem] font-bold text-ink">{p.name}</span>
                  <span className="num block text-[0.68rem] font-semibold text-ink-muted">{t('minimumStock')}: {p.min}</span>
                </span>
                <Badge tone={p.stock <= 0 ? 'danger' : 'warn'}>{p.stock}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
