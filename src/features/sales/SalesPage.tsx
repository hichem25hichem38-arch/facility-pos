import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Input, Modal,
  PageHeader, Pagination, Row, SearchInput, Select, StatCard, Table, Td,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { SaleService } from '@/services/sales/sale.service';
import { endOfDay, formatDate, formatDateTime, formatMoney, startOfDay } from '@/utils/format';
import { exportToXlsx } from '@/utils/export';
import { InvoicePrint } from '@/components/sales/InvoicePrint';
import { PaperFit } from '@/components/common/PaperFit';
import type { Customer, Installment, Payment, PaymentMethod, Sale, SaleStatus } from '@/types';

const PAGE_SIZE = 20;

type Preset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

const STATUS_TONE: Record<SaleStatus, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  PAID: 'ok',
  PARTIALLY_PAID: 'warn',
  PENDING: 'info',
  OVERDUE: 'danger',
  CANCELLED: 'muted',
};

const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'banknote',
  BANK_TRANSFER: 'wallet',
  CHECK: 'file',
  CARD: 'credit-card',
};

/* Same print contract as PosPage: only the invoice ids reach the paper */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden !important; }
  #invoice-a4, #invoice-a4 *, #invoice-8x11, #invoice-8x11 * { visibility: visible !important; }
  #invoice-a4 { position: absolute !important; left: 50% !important; top: 0 !important; transform: translateX(-50%) !important; width: 210mm !important; min-height: 297mm !important; box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  #invoice-8x11 { position: absolute !important; left: 50% !important; top: 0 !important; transform: translateX(-50%) !important; width: 80mm !important; height: 110mm !important; min-height: 110mm !important; max-height: 110mm !important; overflow: hidden !important; box-sizing: border-box !important; border: 0.3mm solid #000 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

export function SalesPage() {
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const [term, setTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [preset, setPreset] = useState<Preset>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [invoice, setInvoice] = useState<{ saleId: string; paper: 'A4' | '8x11' } | null>(null);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [sales, customers] = await Promise.all([db.sales.toArray(), db.customers.toArray()]);
    sales.sort((a, b) => b.saleDate - a.saleDate);
    return { sales, customers };
  }, [], { sales: [] as Sale[], customers: [] as Customer[] });

  const sales = data?.sales ?? [];
  const customerMap = useMemo(() => new Map(data?.customers.map((c) => [c.id, c]) ?? []), [data]);

  const range = useMemo(() => {
    const now = Date.now();
    const sd = startOfDay(now);
    switch (preset) {
      case 'TODAY':
        return { from: sd, to: endOfDay(now) };
      case 'YESTERDAY':
        return { from: sd - 86_400_000, to: sd - 1 };
      case 'WEEK': {
        const d = new Date(now);
        const dayIdx = (d.getDay() + 6) % 7; // Monday first
        return { from: startOfDay(now - dayIdx * 86_400_000), to: endOfDay(now) };
      }
      case 'MONTH': {
        const d = new Date(now);
        return { from: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime()), to: endOfDay(now) };
      }
      case 'CUSTOM': {
        const f = from ? startOfDay(new Date(`${from}T00:00:00`).getTime()) : undefined;
        const tt = to ? endOfDay(new Date(`${to}T00:00:00`).getTime()) : undefined;
        return { from: f, to: tt };
      }
      default:
        return { from: undefined, to: undefined };
    }
  }, [preset, from, to]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return sales.filter((s) => {
      if (range.from !== undefined && s.saleDate < range.from) return false;
      if (range.to !== undefined && s.saleDate > range.to) return false;
      if (typeFilter !== 'ALL' && s.saleType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (q) {
        const c = s.customerId ? customerMap.get(s.customerId) : undefined;
        const hit =
          s.invoiceNumber.toLowerCase().includes(q) ||
          (c?.fullName.toLowerCase().includes(q) ?? false) ||
          (c?.customerNumber.toLowerCase().includes(q) ?? false) ||
          ((c?.phone ?? '').toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [sales, term, typeFilter, statusFilter, range, customerMap]);

  /* Cancelled sales are excluded from money KPIs — cancelSale does not reverse
     their payments, so their paidAmount cannot be trusted (service bug). */
  const kpi = useMemo(() => {
    const active = filtered.filter((s) => s.status !== 'CANCELLED');
    return {
      count: filtered.length,
      revenue: active.reduce((sum, s) => sum + s.totalAmount, 0),
      collected: active.reduce((sum, s) => sum + s.paidAmount, 0),
      remaining: active.reduce((sum, s) => sum + Math.max(0, s.remainingAmount), 0),
    };
  }, [filtered]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [term, typeFilter, statusFilter, preset, from, to]);

  /* Detail modal data */
  const detail = useLiveQuery(async () => {
    if (!selectedId) return null;
    const db = getDb();
    const sale = await db.sales.get(selectedId);
    if (!sale) return null;
    const saleItems = await db.saleItems.where('saleId').equals(selectedId).toArray();
    const products = await Promise.all(saleItems.map((it) => db.products.get(it.productId)));
    const direct = await db.payments.where('saleId').equals(selectedId).toArray();
    const plan = await db.installmentPlans.where('saleId').equals(selectedId).first();
    let installments: Installment[] = [];
    let instPayments: Payment[] = [];
    if (plan) {
      installments = await db.installments.where('planId').equals(plan.id).toArray();
      instPayments = installments.length
        ? await db.payments.where('installmentId').anyOf(installments.map((i) => i.id)).toArray()
        : [];
    }
    const payments = [...direct, ...instPayments].sort((a, b) => b.paymentDate - a.paymentDate);
    return {
      sale,
      items: saleItems.map((it, idx) => ({ item: it, product: products[idx] })),
      payments,
      installments,
    };
  }, [selectedId], null);

  const doCancelSale = async () => {
    if (!cancelTarget) return;
    try {
      await new SaleService().cancelSale(cancelTarget.id, useAppStore.getState().authUser?.id ?? '');
      toastSuccess(t('saleCancelledOk'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toastError(msg === 'SALE_NOT_CANCELLABLE' ? t('noResults') : t('errorGeneric'));
    }
    setCancelTarget(null);
  };

  const exportRows = () => {
    const rows = filtered.map((s) => {
      const c = s.customerId ? customerMap.get(s.customerId) : undefined;
      return {
        [t('invoiceNumber')]: s.invoiceNumber,
        [t('customer')]: c?.fullName ?? t('walkInCustomer'),
        [t('date')]: formatDate(s.saleDate, dateLocale),
        [t('saleType')]: s.saleType === 'CASH' ? t('cashSale') : t('installmentSale'),
        [t('total')]: s.totalAmount,
        [t('discount')]: s.discount,
        [t('paid')]: s.paidAmount,
        [t('remaining')]: Math.max(0, s.remainingAmount),
        [t('status')]: t(`status_${s.status}`),
      };
    });
    exportToXlsx(rows, `sales-${new Date().toISOString().slice(0, 10)}.xlsx`, t('sales'));
  };

  const filtersActive = !!term || typeFilter !== 'ALL' || statusFilter !== 'ALL' || preset !== 'ALL';
  const resetFilters = () => {
    setTerm(''); setTypeFilter('ALL'); setStatusFilter('ALL'); setPreset('ALL'); setFrom(''); setTo('');
  };

  const presets: { value: Preset; label: string }[] = [
    { value: 'ALL', label: t('allTime') },
    { value: 'TODAY', label: t('today') },
    { value: 'YESTERDAY', label: t('yesterday') },
    { value: 'WEEK', label: t('thisWeek') },
    { value: 'MONTH', label: t('thisMonth') },
    { value: 'CUSTOM', label: t('customRange') },
  ];

  return (
    <>
      <PageHeader
        icon="receipt"
        title={t('sales')}
        subtitle={t('salesSubtitle')}
        actions={
          <Button variant="secondary" icon="download" onClick={exportRows}>{t('exportData')}</Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="receipt" tone="brand" label={t('statInvoices')} value={String(kpi.count)} />
        <StatCard icon="chart" tone="info" label={t('statRevenue')} value={formatMoney(kpi.revenue, currency)} delta={t('exclCancelled')} deltaTone="muted" />
        <StatCard icon="banknote" tone="ok" label={t('collectedInPeriod')} value={formatMoney(kpi.collected, currency)} />
        <StatCard
          icon="clock"
          tone={kpi.remaining > 0 ? 'warn' : 'muted'}
          label={t('remainingInPeriod')}
          value={formatMoney(kpi.remaining, currency)}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-2.5 border-b border-line p-3">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(p.value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.76rem] font-extrabold transition-colors ${
                  preset === p.value
                    ? 'border-brand/40 bg-brand/12 text-brand'
                    : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={term}
              onChange={setTerm}
              placeholder={t('searchSalesPlaceholder')}
              className="min-w-52 flex-1"
            />
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto min-w-36" aria-label={t('saleType')}>
              <option value="ALL">{t('all')} — {t('saleType')}</option>
              <option value="CASH">{t('cashSale')}</option>
              <option value="INSTALLMENT">{t('installmentSale')}</option>
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto min-w-36" aria-label={t('status')}>
              <option value="ALL">{t('all')} — {t('status')}</option>
              <option value="PAID">{t('status_PAID')}</option>
              <option value="PARTIALLY_PAID">{t('status_PARTIALLY_PAID')}</option>
              <option value="PENDING">{t('status_PENDING')}</option>
              <option value="OVERDUE">{t('status_OVERDUE')}</option>
              <option value="CANCELLED">{t('status_CANCELLED')}</option>
            </Select>
            {preset === 'CUSTOM' && (
              <>
                <label className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-muted">
                  {t('from')}
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num h-9 w-auto px-2 text-[0.78rem]" dir="ltr" />
                </label>
                <label className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-muted">
                  {t('to')}
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num h-9 w-auto px-2 text-[0.78rem]" dir="ltr" />
                </label>
              </>
            )}
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex h-9 items-center gap-1 rounded-md px-2 text-[0.76rem] font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={13} /> {t('clearFilters')}
              </button>
            )}
            <span className="num ms-auto text-[0.74rem] font-bold text-ink-muted">
              {t('totalRecords', { count: filtered.length })}
            </span>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={filtersActive ? t('noResults') : t('salesEmpty')}
            hint={filtersActive ? undefined : t('salesEmptyHint')}
            action={filtersActive ? <Button variant="secondary" size="sm" onClick={resetFilters}>{t('clearFilters')}</Button> : undefined}
          />
        ) : (
          <>
            {/* Cards — small screens */}
            <ul className="grid grid-cols-1 gap-2.5 p-3 md:hidden">
              {visible.map((s) => {
                const c = s.customerId ? customerMap.get(s.customerId) : undefined;
                return (
                  <li key={s.id} className="rounded-lg border border-line bg-surface-2 p-3">
                    <div className="flex items-start gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/12 text-brand">
                        <Icon name={s.saleType === 'CASH' ? 'banknote' : 'calendar'} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mono block truncate text-[0.72rem] font-bold text-ink-muted" dir="ltr">{s.invoiceNumber}</span>
                        <span className="block truncate text-[0.86rem] font-extrabold text-ink">
                          {c?.fullName ?? t('walkInCustomer')}
                        </span>
                        <span className="num block text-[0.7rem] font-semibold text-ink-muted">
                          {formatDateTime(s.saleDate, dateLocale)}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="num block text-[0.9rem] font-black text-ink">{formatMoney(s.totalAmount, currency)}</span>
                        <Badge tone={STATUS_TONE[s.status]} className="mt-1">{t(`status_${s.status}`)}</Badge>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                      <IconButton icon="eye" label={t('saleDetailsTitle')} size={30} onClick={() => setSelectedId(s.id)} />
                      <IconButton icon="print" label={t('printReceipt')} size={30} onClick={() => setInvoice({ saleId: s.id, paper: 'A4' })} />
                      {s.saleType === 'INSTALLMENT' && s.status !== 'CANCELLED' && (
                        <Link
                          to={`/contracts/${s.id}`}
                          aria-label={t('viewContractLabel')}
                          title={t('viewContractLabel')}
                          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand"
                        >
                          <Icon name="file" size={15} />
                        </Link>
                      )}
                      {hasPermission('sales.cancel') && s.status !== 'CANCELLED' && (
                        <span className="ms-auto">
                          <IconButton icon="trash" variant="danger" label={t('cancelSaleAction')} size={30} onClick={() => setCancelTarget(s)} />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Table — desktop */}
            <div className="hidden md:block">
              <Table
                head={[
                  t('invoiceNumber'),
                  t('customer'),
                  t('date'),
                  t('saleType'),
                  t('total'),
                  t('paid'),
                  t('remaining'),
                  t('status'),
                  '',
                ]}
              >
                {visible.map((s) => {
                  const c = s.customerId ? customerMap.get(s.customerId) : undefined;
                  return (
                    <Row key={s.id} onClick={() => setSelectedId(s.id)}>
                      <Td className="mono whitespace-nowrap text-[0.74rem] font-bold text-ink-muted" >
                        <span dir="ltr">{s.invoiceNumber}</span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[0.68rem] font-black text-ink-2">
                            {(c?.fullName ?? t('walkInCustomer')).trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-44 truncate font-extrabold">{c?.fullName ?? t('walkInCustomer')}</span>
                            {c?.phone && <span className="num block text-[0.68rem] font-semibold text-ink-muted" dir="ltr">{c.phone}</span>}
                          </span>
                        </span>
                      </Td>
                      <Td className="num whitespace-nowrap text-ink-2">{formatDateTime(s.saleDate, dateLocale)}</Td>
                      <Td>
                        <Badge tone={s.saleType === 'CASH' ? 'info' : 'purple'} icon={s.saleType === 'CASH' ? 'banknote' : 'calendar'}>
                          {s.saleType === 'CASH' ? t('cashSale') : t('installmentSale')}
                        </Badge>
                      </Td>
                      <Td className="num font-black">{formatMoney(s.totalAmount, currency)}</Td>
                      <Td className="num text-ok">{formatMoney(s.paidAmount, currency)}</Td>
                      <Td className={`num font-black ${s.remainingAmount > 0 && s.status !== 'CANCELLED' ? 'text-danger' : 'text-ink-muted'}`}>
                        {formatMoney(Math.max(0, s.remainingAmount), currency)}
                      </Td>
                      <Td><Badge tone={STATUS_TONE[s.status]}>{t(`status_${s.status}`)}</Badge></Td>
                      <Td className="text-end">
                        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <IconButton icon="eye" label={t('saleDetailsTitle')} size={30} onClick={() => setSelectedId(s.id)} />
                          <IconButton icon="print" label={t('printReceipt')} size={30} onClick={() => setInvoice({ saleId: s.id, paper: 'A4' })} />
                          {s.saleType === 'INSTALLMENT' && s.status !== 'CANCELLED' && (
                            <Link
                              to={`/contracts/${s.id}`}
                              aria-label={t('viewContractLabel')}
                              title={t('viewContractLabel')}
                              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand"
                            >
                              <Icon name="file" size={15} />
                            </Link>
                          )}
                          {hasPermission('sales.cancel') && s.status !== 'CANCELLED' && (
                            <IconButton icon="trash" variant="danger" label={t('cancelSaleAction')} size={30} onClick={() => setCancelTarget(s)} />
                          )}
                        </span>
                      </Td>
                    </Row>
                  );
                })}
              </Table>
            </div>
          </>
        )}

        <Pagination page={current} pages={pages} total={filtered.length} onPage={setPage} />
      </Card>

      {/* Detail modal */}
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={t('saleDetailsTitle')}
        subtitle={detail ? `${detail.sale.invoiceNumber} · ${formatDateTime(detail.sale.saleDate, dateLocale)}` : undefined}
        icon="receipt"
        wide
        footer={
          detail && (
            <>
              {detail.sale.saleType === 'INSTALLMENT' && detail.sale.status !== 'CANCELLED' && (
                <Link
                  to={`/contracts/${detail.sale.id}`}
                  className="inline-flex h-9.5 items-center gap-2 rounded-md border border-line bg-surface-2 px-4 text-[0.85rem] font-bold text-ink transition-colors hover:border-brand/40 hover:text-brand"
                >
                  <Icon name="file" size={16} /> {t('viewContractLabel')}
                </Link>
              )}
              <Button
                variant="secondary"
                icon="print"
                onClick={() => { setInvoice({ saleId: detail.sale.id, paper: 'A4' }); setSelectedId(null); }}
              >
                {t('printReceipt')}
              </Button>
              {hasPermission('sales.cancel') && detail.sale.status !== 'CANCELLED' && (
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={() => { setCancelTarget(detail.sale); setSelectedId(null); }}
                >
                  {t('cancelSaleAction')}
                </Button>
              )}
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <DetailTile label={t('subtotal')} value={formatMoney(detail.sale.subtotal, currency)} />
              <DetailTile label={t('discount')} value={formatMoney(detail.sale.discount, currency)} />
              <DetailTile label={t('total')} value={formatMoney(detail.sale.totalAmount, currency)} strong />
              <DetailTile
                label={t('remaining')}
                value={formatMoney(Math.max(0, detail.sale.remainingAmount), currency)}
                tone={detail.sale.remainingAmount > 0 && detail.sale.status !== 'CANCELLED' ? 'danger' : 'ok'}
              />
            </div>

            {/* Items */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[0.7rem] font-black uppercase tracking-wide text-ink-muted">
                <Icon name="box" size={12} /> {t('itemsTitle')}
              </p>
              {detail.items.length === 0 ? (
                <p className="py-3 text-center text-[0.78rem] font-semibold text-ink-muted">{t('noData')}</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-line">
                  <Table head={[t('product'), t('quantity'), t('unitPriceCol'), t('lineTotalCol')]} className="max-h-56">
                    {detail.items.map(({ item, product }) => (
                      <Row key={item.id}>
                        <Td>
                          <span className="flex items-center gap-2">
                            {product?.image ? (
                              <img src={product.image} alt="" className="h-7 w-7 shrink-0 rounded border border-line bg-surface-3 object-contain" />
                            ) : (
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-surface-2 text-ink-muted">
                                <Icon name="box" size={13} strokeWidth={1.6} />
                              </span>
                            )}
                            <span className="max-w-52 truncate font-bold">{product?.name ?? '—'}</span>
                          </span>
                        </Td>
                        <Td className="num">{item.quantity}</Td>
                        <Td className="num">{formatMoney(item.unitPrice, currency)}</Td>
                        <Td className="num font-black">{formatMoney(item.total, currency)}</Td>
                      </Row>
                    ))}
                  </Table>
                </div>
              )}
            </div>

            {/* Payments */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[0.7rem] font-black uppercase tracking-wide text-ink-muted">
                <Icon name="banknote" size={12} /> {t('paymentsTitle')}
              </p>
              {detail.payments.length === 0 ? (
                <p className="py-3 text-center text-[0.78rem] font-semibold text-ink-muted">{t('noPayments')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {detail.payments.map((p) => {
                    const inst = p.installmentId
                      ? detail.installments.find((i) => i.id === p.installmentId)
                      : undefined;
                    return (
                      <li
                        key={p.id}
                        className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[0.76rem] ${
                          p.status === 'CANCELLED' ? 'opacity-60' : ''
                        }`}
                      >
                        <Icon
                          name={p.status === 'CANCELLED' ? 'undo' : METHOD_ICON[p.paymentMethod]}
                          size={14}
                          className={p.status === 'CANCELLED' ? 'text-ink-muted' : 'text-brand'}
                        />
                        <span className={`num font-black ${p.status === 'CANCELLED' ? 'text-ink-muted line-through' : 'text-ok'}`}>
                          {formatMoney(p.amount, currency)}
                        </span>
                        <span className="num text-[0.7rem] font-semibold text-ink-muted">
                          {formatDateTime(p.paymentDate, dateLocale)} · {t(`pm_${p.paymentMethod}`)}
                        </span>
                        <span className="text-[0.7rem] font-bold text-ink-2">
                          {inst ? t('installmentLabel', { n: inst.installmentNumber }) : t('downPaymentLabel')}
                        </span>
                        {p.reference && <span className="mono text-[0.66rem] font-semibold text-ink-muted" dir="ltr">{p.reference}</span>}
                        <span className="ms-auto">
                          <Badge tone={p.status === 'ACTIVE' ? 'ok' : 'muted'}>
                            {t(`paymentStatus_${p.status}`)}
                          </Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel sale */}
      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={doCancelSale}
        title={t('cancelSaleAction')}
        message={
          <span>
            {t('confirmCancelSale')}
            <br />
            <b className="mono" dir="ltr">{cancelTarget?.invoiceNumber}</b>
            {' — '}
            <b className="num">{cancelTarget ? formatMoney(cancelTarget.totalAmount, currency) : ''}</b>
            {cancelTarget?.customerId && customerMap.get(cancelTarget.customerId)
              ? ` — ${customerMap.get(cancelTarget!.customerId)!.fullName}`
              : ''}
          </span>
        }
        confirmLabel={t('cancelSaleAction')}
      />

      {/* Receipt printing */}
      <Modal
        open={!!invoice}
        onClose={() => setInvoice(null)}
        title={t('receiptModalTitle')}
        subtitle={invoice?.paper === 'A4' ? t('paperA4Label') : t('paperThermalLabel')}
        icon="print"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setInvoice(null)}>{t('cancel')}</Button>
            <Button icon="print" onClick={() => window.print()}>{t('print')}</Button>
          </>
        }
      >
        {invoice && (
          <div className="flex flex-col gap-3">
            <div className="no-print flex flex-wrap gap-2">
              <Button variant={invoice.paper === 'A4' ? 'primary' : 'secondary'} size="sm" onClick={() => setInvoice({ ...invoice, paper: 'A4' })}>
                {t('paperA4Label')}
              </Button>
              <Button variant={invoice.paper === '8x11' ? 'primary' : 'secondary'} size="sm" onClick={() => setInvoice({ ...invoice, paper: '8x11' })}>
                {t('paperThermalLabel')}
              </Button>
            </div>
            <div className="scroll-y flex max-h-[60vh] justify-start overflow-auto rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
              <PaperFit width={invoice.paper === 'A4' ? '210mm' : '80mm'}>
                <InvoicePrint saleId={invoice.saleId} paper={invoice.paper} />
              </PaperFit>
            </div>
            <p className="text-center text-[0.7rem] font-semibold text-ink-muted">{t('contractPrintHint')}</p>
          </div>
        )}
      </Modal>
      {invoice && <style>{PRINT_CSS}</style>}
    </>
  );
}

/* ------------------------------------------------------------------ */

function DetailTile({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'ok' | 'danger' }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${strong ? 'border-brand/30 bg-brand/8' : 'border-line bg-surface-2'}`}>
      <p className="truncate text-[0.66rem] font-bold text-ink-muted">{label}</p>
      <p
        className={`num mt-0.5 truncate text-[0.84rem] font-black ${
          tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : strong ? 'text-brand' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
