import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, Row, Select, StatCard, Table, Td, Textarea,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { PaymentService } from '@/services/payments/payment.service';
import { daysBetween, endOfDay, formatDate, formatMoney, round2, startOfDay } from '@/utils/format';
import { exportToXlsx } from '@/utils/export';
import type { Customer, Installment, InstallmentPlan, Payment, PaymentMethod, Sale } from '@/types';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type PlanStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
type DueChip = 'ALL' | 'TODAY' | 'WEEK';
type StatusFilter = 'ALL' | PlanStatus;

interface PlanRow {
  plan: InstallmentPlan;
  sale?: Sale;
  customer?: Customer;
  items: Installment[];
  collected: number;
  remaining: number;
  paidCount: number;
  nextDue?: number;
  daysLate?: number;
  status: PlanStatus;
  nextOpen?: Installment;
}

const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'banknote',
  BANK_TRANSFER: 'wallet',
  CHECK: 'file',
  CARD: 'credit-card',
};

const STATUS_TONE: Record<PlanStatus, 'ok' | 'warn' | 'danger' | 'info'> = {
  PAID: 'ok',
  OVERDUE: 'danger',
  PARTIAL: 'warn',
  PENDING: 'info',
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  PAID: 'paidStatus',
  OVERDUE: 'overdue',
  PARTIAL: 'partial',
  PENDING: 'pending',
};

/** Effective status derived from amounts + time (stored status can be stale). */
function effectiveStatus(i: Installment, now: number): PlanStatus {
  if (i.remainingAmount <= 0) return 'PAID';
  if (i.dueDate < now) return 'OVERDUE';
  if (i.amountPaid > 0) return 'PARTIAL';
  return 'PENDING';
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

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function InstallmentsPage() {
  const { t, locale } = useT();
  const [params] = useSearchParams();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [dueChip, setDueChip] = useState<DueChip>('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [focusPlan, setFocusPlan] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [plans, sales, customers, installments, payments] = await Promise.all([
      db.installmentPlans.toArray(),
      db.sales.toArray(),
      db.customers.toArray(),
      db.installments.toArray(),
      db.payments.toArray(),
    ]);
    return { plans, sales, customers, installments, payments };
  }, []);

  /* URL query params honored by the app shell links */
  useEffect(() => {
    const st = params.get('status');
    if (st === 'PENDING' || st === 'PARTIAL' || st === 'PAID' || st === 'OVERDUE') setStatusFilter(st);
    if (params.get('due') === 'today') setDueChip('TODAY');
    const plan = params.get('plan');
    if (plan) {
      setExpanded((prev) => new Set(prev).add(plan));
      setFocusPlan(plan);
    }
  }, [params]);

  const rows = useMemo<PlanRow[]>(() => {
    if (!data) return [];
    const now = Date.now();
    const saleMap = new Map(data.sales.map((s) => [s.id, s]));
    const custMap = new Map(data.customers.map((c) => [c.id, c]));
    const itemsByPlan = new Map<string, Installment[]>();
    for (const i of data.installments) {
      const list = itemsByPlan.get(i.planId);
      if (list) list.push(i);
      else itemsByPlan.set(i.planId, [i]);
    }
    const out: PlanRow[] = [];
    for (const plan of data.plans) {
      const sale = saleMap.get(plan.saleId);
      if (plan.status === 'CANCELLED' || sale?.status === 'CANCELLED') continue;
      const items = (itemsByPlan.get(plan.id) ?? []).slice().sort((a, b) => a.installmentNumber - b.installmentNumber);
      const collected = round2(items.reduce((s, i) => s + i.amountPaid, 0));
      const remaining = round2(items.reduce((s, i) => s + Math.max(0, i.remainingAmount), 0));
      const open = items.filter((i) => i.remainingAmount > 0).sort((a, b) => a.dueDate - b.dueDate);
      const late = open.find((i) => i.dueDate < now);
      const status: PlanStatus =
        remaining <= 0 ? 'PAID' : late ? 'OVERDUE' : collected > 0 ? 'PARTIAL' : 'PENDING';
      out.push({
        plan,
        sale,
        customer: sale?.customerId ? custMap.get(sale.customerId) : undefined,
        items,
        collected,
        remaining,
        paidCount: items.length - open.length,
        nextDue: open[0]?.dueDate,
        daysLate: late ? Math.max(1, daysBetween(late.dueDate, now)) : undefined,
        status,
        nextOpen: open[0],
      });
    }
    out.sort((a, b) => {
      if (a.daysLate !== undefined && b.daysLate === undefined) return -1;
      if (a.daysLate === undefined && b.daysLate !== undefined) return 1;
      if (a.daysLate !== undefined && b.daysLate !== undefined) return b.daysLate - a.daysLate;
      return (a.nextDue ?? Number.MAX_SAFE_INTEGER) - (b.nextDue ?? Number.MAX_SAFE_INTEGER);
    });
    return out;
  }, [data]);

  /* Auto-scroll to ?plan= once rows are rendered */
  useEffect(() => {
    if (!focusPlan || rows.length === 0) return;
    if (!rows.some((r) => r.plan.id === focusPlan)) {
      setFocusPlan(null);
      return;
    }
    const el = document.getElementById(`plan-${focusPlan}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusPlan);
      setFocusPlan(null);
      const id = setTimeout(() => setHighlightId(null), 2600);
      return () => clearTimeout(id);
    }
  }, [focusPlan, rows]);

  const planCustomers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.customer && !seen.has(r.customer.id)) seen.set(r.customer.id, r.customer.fullName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const from = parseDateInput(dueFrom) !== undefined ? startOfDay(parseDateInput(dueFrom)!) : undefined;
    const to = parseDateInput(dueTo) !== undefined ? endOfDay(parseDateInput(dueTo)!) : undefined;
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const weekEnd = endOfDay(now + 7 * 86_400_000);
    return rows.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (customerFilter !== 'ALL' && r.customer?.id !== customerFilter) return false;
      if (from || to) {
        const hit = r.items.some(
          (i) => i.remainingAmount > 0 && (!from || i.dueDate >= from) && (!to || i.dueDate <= to),
        );
        if (!hit) return false;
      }
      if (dueChip === 'TODAY') {
        if (!r.items.some((i) => i.remainingAmount > 0 && i.dueDate >= dayStart && i.dueDate <= dayEnd)) return false;
      }
      if (dueChip === 'WEEK') {
        if (!r.items.some((i) => i.remainingAmount > 0 && i.dueDate >= dayStart && i.dueDate <= weekEnd)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, customerFilter, dueFrom, dueTo, dueChip]);

  const stats = useMemo(() => {
    const now = Date.now();
    let financed = 0;
    let collected = 0;
    let remaining = 0;
    let overdue = 0;
    for (const r of filtered) {
      financed += r.plan.financedAmount;
      collected += r.collected;
      remaining += r.remaining;
      overdue += r.items.filter((i) => i.remainingAmount > 0 && i.dueDate < now).length;
    }
    return { financed: round2(financed), collected: round2(collected), remaining: round2(remaining), overdue };
  }, [filtered]);

  const paymentsByInstallment = useMemo(() => {
    const map = new Map<string, Payment[]>();
    if (!data) return map;
    for (const p of data.payments) {
      if (!p.installmentId) continue;
      const list = map.get(p.installmentId);
      if (list) list.push(p);
      else map.set(p.installmentId, [p]);
    }
    for (const list of map.values()) list.sort((a, b) => b.paymentDate - a.paymentDate);
    return map;
  }, [data]);

  /* ---------------- payment modal ---------------- */
  const [payFor, setPayFor] = useState<{ inst: Installment; row: PlanRow } | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [payDate, setPayDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [payErrors, setPayErrors] = useState<Record<string, string>>({});
  const [savingPay, setSavingPay] = useState(false);
  const [cancelPay, setCancelPay] = useState<{ payment: Payment; row: PlanRow } | null>(null);

  const openPay = (inst: Installment, row: PlanRow) => {
    const remaining = Math.max(0, round2(inst.remainingAmount));
    setPayFor({ inst, row });
    setAmount(remaining > 0 ? String(remaining) : '');
    setMethod('CASH');
    setPayDate(dateInputValue(Date.now()));
    setReference('');
    setNotes('');
    setPayErrors({});
  };

  const submitPayment = async () => {
    if (!payFor) return;
    const remaining = Math.max(0, round2(payFor.inst.remainingAmount));
    const n = Number(amount);
    const errors: Record<string, string> = {};
    if (!Number.isFinite(n) || n <= 0) errors.amount = t('amountPositive');
    else if (round2(n) > remaining) errors.amount = t('amountExceedsRemaining');
    setPayErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSavingPay(true);
    try {
      await new PaymentService().recordInstallmentPayment({
        installmentId: payFor.inst.id,
        amount: round2(n),
        paymentMethod: method,
        paymentDate: parseDateInput(payDate) ?? Date.now(),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        userId: useAppStore.getState().authUser?.id ?? '',
      });
      toastSuccess(`${t('paymentRecorded')} — ${formatMoney(round2(n), currency)}`);
      setPayFor(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'PAYMENT_EXCEEDS_REMAINING') toastError(t('amountExceedsRemaining'));
      else if (msg === 'INVALID_PAYMENT_AMOUNT') toastError(t('amountPositive'));
      else toastError(t('errorGeneric'));
    } finally {
      setSavingPay(false);
    }
  };

  const confirmCancelPayment = async () => {
    if (!cancelPay) return;
    try {
      await new PaymentService().cancelPayment(cancelPay.payment.id, useAppStore.getState().authUser?.id ?? '');
      toastSuccess(t('paymentCancelledOk'));
    } catch {
      toastError(t('errorGeneric'));
    }
    setCancelPay(null);
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportRows = () => {
    const now = Date.now();
    const out: Record<string, unknown>[] = [];
    for (const r of filtered) {
      for (const i of r.items) {
        const st = effectiveStatus(i, now);
        out.push({
          [t('customer')]: r.customer?.fullName ?? t('walkInCustomer'),
          [t('invoiceNumber')]: r.sale?.invoiceNumber ?? '—',
          [t('installments')]: `${i.installmentNumber}/${r.plan.numberOfInstallments}`,
          [t('dueDate')]: formatDate(i.dueDate, dateLocale),
          [t('amountDue')]: i.amountDue,
          [t('amountPaidCol')]: i.amountPaid,
          [t('remaining')]: Math.max(0, i.remainingAmount),
          [t('status')]: t(STATUS_LABEL[st]),
          [t('overdue')]: st === 'OVERDUE' ? Math.max(1, daysBetween(i.dueDate, now)) : 0,
        });
      }
    }
    exportToXlsx(out, `installments-${new Date().toISOString().slice(0, 10)}.xlsx`, t('installments'));
  };

  const filtersActive = statusFilter !== 'ALL' || customerFilter !== 'ALL' || dueChip !== 'ALL' || !!dueFrom || !!dueTo;
  const resetFilters = () => {
    setStatusFilter('ALL');
    setDueChip('ALL');
    setCustomerFilter('ALL');
    setDueFrom('');
    setDueTo('');
  };

  const chips: { label: string; active: boolean; onClick: () => void }[] = [
    {
      label: t('all'),
      active: statusFilter === 'ALL' && dueChip === 'ALL',
      onClick: () => { setStatusFilter('ALL'); setDueChip('ALL'); },
    },
    {
      label: t('overdue'),
      active: statusFilter === 'OVERDUE',
      onClick: () => setStatusFilter(statusFilter === 'OVERDUE' ? 'ALL' : 'OVERDUE'),
    },
    {
      label: t('today'),
      active: dueChip === 'TODAY',
      onClick: () => setDueChip(dueChip === 'TODAY' ? 'ALL' : 'TODAY'),
    },
    {
      label: t('thisWeek'),
      active: dueChip === 'WEEK',
      onClick: () => setDueChip(dueChip === 'WEEK' ? 'ALL' : 'WEEK'),
    },
  ];

  return (
    <>
      <PageHeader
        icon="wallet"
        title={t('installments')}
        subtitle={t('installmentsSubtitle')}
        actions={
          <>
            <Badge tone="muted" icon="file">{t('plansCount', { count: filtered.length })}</Badge>
            <Button variant="secondary" icon="download" onClick={exportRows}>{t('exportData')}</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="wallet" tone="brand" label={t('financedAmount')} value={formatMoney(stats.financed, currency)} />
        <StatCard icon="banknote" tone="ok" label={t('collectedTotal')} value={formatMoney(stats.collected, currency)} />
        <StatCard
          icon="clock"
          tone={stats.remaining > 0 ? 'warn' : 'muted'}
          label={t('totalRemaining')}
          value={formatMoney(stats.remaining, currency)}
        />
        <StatCard
          icon="alert"
          tone={stats.overdue > 0 ? 'danger' : 'muted'}
          label={t('overdueAlert')}
          value={String(stats.overdue)}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        {/* Filters */}
        <div className="flex flex-col gap-2.5 border-b border-line p-3">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.76rem] font-extrabold transition-colors ${
                  c.active
                    ? 'border-brand/40 bg-brand/12 text-brand'
                    : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-auto min-w-36"
              aria-label={t('status')}
            >
              <option value="ALL">{t('all')} — {t('status')}</option>
              <option value="PENDING">{t('pending')}</option>
              <option value="PARTIAL">{t('partial')}</option>
              <option value="PAID">{t('paidStatus')}</option>
              <option value="OVERDUE">{t('overdue')}</option>
            </Select>
            <Select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="w-auto min-w-40"
              aria-label={t('customer')}
            >
              <option value="ALL">{t('allCustomers')}</option>
              {planCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <label className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-muted">
              {t('dueRangeFrom')}
              <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} className="num h-9 w-auto px-2 text-[0.78rem]" dir="ltr" />
            </label>
            <label className="flex items-center gap-1.5 text-[0.72rem] font-bold text-ink-muted">
              {t('dueRangeTo')}
              <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} className="num h-9 w-auto px-2 text-[0.78rem]" dir="ltr" />
            </label>
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
              {t('plansCount', { count: filtered.length })}
            </span>
          </div>
        </div>

        {/* Plans */}
        {rows.length === 0 ? (
          <EmptyState icon="wallet" title={t('installmentsEmpty')} hint={t('installmentsEmptyHint')} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="search"
            title={t('noResults')}
            action={<Button variant="secondary" size="sm" onClick={resetFilters}>{t('clearFilters')}</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-3 p-3">
            {filtered.map((r) => (
              <PlanCard
                key={r.plan.id}
                row={r}
                expanded={expanded.has(r.plan.id)}
                highlighted={highlightId === r.plan.id}
                onToggle={() => toggleExpand(r.plan.id)}
                onPay={hasPermission('payments.create') ? openPay : undefined}
                onCancelPayment={hasPermission('payments.cancel') ? (p) => setCancelPay({ payment: p, row: r }) : undefined}
                paymentsByInstallment={paymentsByInstallment}
                currency={currency}
                dateLocale={dateLocale}
                t={t}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Record payment */}
      <Modal
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={t('recordPayment')}
        subtitle={
          payFor
            ? `${payFor.row.customer?.fullName ?? t('walkInCustomer')} · ${t('installmentLabel', { n: payFor.inst.installmentNumber })} · ${formatDate(payFor.inst.dueDate, dateLocale)}`
            : undefined
        }
        icon="banknote"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayFor(null)}>{t('cancel')}</Button>
            <Button icon="save" loading={savingPay} onClick={submitPayment}>{t('save')}</Button>
          </>
        }
      >
        {payFor && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <SummaryTile label={t('amountDue')} value={formatMoney(payFor.inst.amountDue, currency)} />
              <SummaryTile label={t('amountPaidCol')} value={formatMoney(payFor.inst.amountPaid, currency)} />
              <SummaryTile
                label={t('remainingForInstallment')}
                value={formatMoney(Math.max(0, round2(payFor.inst.remainingAmount)), currency)}
                strong
              />
            </div>
            <Field label={t('amount')} required error={payErrors.amount}>
              <Input
                type="number"
                min={0.01}
                max={Math.max(0, round2(payFor.inst.remainingAmount))}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num"
                dir="ltr"
                autoFocus
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('paymentMethod')}>
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="CASH">{t('pm_CASH')}</option>
                  <option value="BANK_TRANSFER">{t('pm_BANK_TRANSFER')}</option>
                  <option value="CHECK">{t('pm_CHECK')}</option>
                  <option value="CARD">{t('pm_CARD')}</option>
                </Select>
              </Field>
              <Field label={t('paymentDate')}>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="num" dir="ltr" />
              </Field>
              <Field label={t('reference')} className="sm:col-span-2">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mono" dir="ltr" maxLength={60} />
              </Field>
              <Field label={t('notes')} className="sm:col-span-2">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
              </Field>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel payment */}
      <ConfirmDialog
        open={!!cancelPay}
        onClose={() => setCancelPay(null)}
        onConfirm={confirmCancelPayment}
        title={t('cancelPaymentTitle')}
        message={
          <span>
            {t('confirmCancelPayment')}
            <br />
            <b className="num">
              {cancelPay ? formatMoney(cancelPay.payment.amount, currency) : ''}
            </b>
            {cancelPay?.row.customer?.fullName ? ` — ${cancelPay.row.customer.fullName}` : ''}
          </span>
        }
        confirmLabel={t('cancelPaymentTitle')}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Plan card                                                           */
/* ------------------------------------------------------------------ */

function PlanCard({
  row,
  expanded,
  highlighted,
  onToggle,
  onPay,
  onCancelPayment,
  paymentsByInstallment,
  currency,
  dateLocale,
  t,
}: {
  row: PlanRow;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onPay?: (inst: Installment, row: PlanRow) => void;
  onCancelPayment?: (p: Payment) => void;
  paymentsByInstallment: Map<string, Payment[]>;
  currency: string;
  dateLocale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const now = Date.now();
  const financed = Math.max(row.plan.financedAmount, 0.0001);
  const pct = Math.min(100, Math.max(0, (row.collected / financed) * 100));
  const planPayments = row.items.flatMap((i) => paymentsByInstallment.get(i.id) ?? []);
  const numberByInstallmentId = new Map(row.items.map((i) => [i.id, i.installmentNumber]));

  return (
    <li
      id={`plan-${row.plan.id}`}
      className={`panel overflow-hidden rounded-lg border shadow-1 transition-all duration-300 ${
        highlighted ? 'border-brand/50 ring-4 ring-brand/15' : 'border-line'
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[0.78rem] font-black ${
            row.status === 'OVERDUE' ? 'bg-danger/12 text-danger' : row.status === 'PAID' ? 'bg-ok/12 text-ok' : 'bg-brand/12 text-brand'
          }`}
        >
          {(row.customer?.fullName ?? t('walkInCustomer')).trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          {row.customer ? (
            <Link
              to={`/customers/${row.customer.id}`}
              className="block max-w-56 truncate text-[0.88rem] font-extrabold text-ink hover:text-brand"
            >
              {row.customer.fullName}
            </Link>
          ) : (
            <span className="block text-[0.88rem] font-extrabold text-ink">{t('walkInCustomer')}</span>
          )}
          <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
            {row.sale?.invoiceNumber ?? '—'}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[row.status]}>{t(STATUS_LABEL[row.status])}</Badge>
          {row.daysLate !== undefined && row.status === 'OVERDUE' && (
            <Badge tone="danger" icon="alert">{t('daysLate', { days: row.daysLate })}</Badge>
          )}
          <Badge tone="muted">{row.plan.numberOfInstallments} × {t('monthly')}</Badge>
        </span>
        <span className="ms-auto flex items-center gap-1">
          {row.nextOpen && onPay && (
            <Button size="sm" icon="banknote" onClick={() => onPay(row.nextOpen!, row)}>
              {t('recordPayment')}
            </Button>
          )}
          <Link
            to={`/contracts/${row.plan.saleId}`}
            title={t('viewContractLabel')}
            aria-label={t('viewContractLabel')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Icon name="file" size={15} />
          </Link>
          <IconButton
            icon={expanded ? 'chevron-down' : 'chevron-end'}
            label={expanded ? t('collapseSchedule') : t('expandSchedule')}
            onClick={onToggle}
          />
        </span>
      </div>

      {/* Progress */}
      <div className="px-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.72rem] font-bold text-ink-muted">
          <span>{t('collectedOfFinanced')}</span>
          <span className="num">
            {formatMoney(row.collected, currency)} / {formatMoney(row.plan.financedAmount, currency)}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full rounded-full transition-all duration-500 ${row.status === 'OVERDUE' ? 'bg-danger' : row.status === 'PAID' ? 'bg-ok' : 'bg-brand'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[0.74rem] sm:grid-cols-4">
          <Metric label={t('remaining')} value={formatMoney(row.remaining, currency)} tone={row.remaining > 0 ? 'danger' : 'ok'} />
          <Metric label={t('downPayment')} value={formatMoney(row.plan.downPayment, currency)} />
          <Metric
            label={t('nextDue')}
            value={row.nextDue !== undefined ? formatDate(row.nextDue, dateLocale) : '—'}
          />
          <Metric label={t('progressPaid', { paid: row.paidCount, total: row.plan.numberOfInstallments })} value={`${Math.round((row.paidCount / Math.max(1, row.items.length)) * 100)}%`} />
        </div>
      </div>

      {/* Expanded schedule + payments */}
      {expanded && (
        <div className="anim-in border-t border-line">
          {row.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.8rem] font-bold text-ink-muted">{t('noOpenInstallments')}</p>
          ) : (
            <Table
              head={['#', t('dueDate'), t('amountDue'), t('amountPaidCol'), t('remaining'), t('status'), '']}
            >
              {row.items.map((i) => {
                const st = effectiveStatus(i, now);
                const remaining = Math.max(0, round2(i.remainingAmount));
                return (
                  <Row key={i.id}>
                    <Td className="num font-black">{i.installmentNumber}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="num">{formatDate(i.dueDate, dateLocale)}</span>
                      {st === 'OVERDUE' && (
                        <span className="block text-[0.68rem] font-bold text-danger">
                          {t('daysLate', { days: Math.max(1, daysBetween(i.dueDate, now)) })}
                        </span>
                      )}
                    </Td>
                    <Td className="num">{formatMoney(i.amountDue, currency)}</Td>
                    <Td className="num text-ok">{i.amountPaid > 0 ? formatMoney(i.amountPaid, currency) : '—'}</Td>
                    <Td className={`num font-black ${remaining > 0 ? 'text-danger' : 'text-ink-muted'}`}>
                      {formatMoney(remaining, currency)}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[st]}>{t(STATUS_LABEL[st])}</Badge></Td>
                    <Td className="text-end">
                      {remaining > 0 && onPay ? (
                        <Button size="sm" variant="secondary" icon="banknote" onClick={() => onPay(i, row)}>
                          {t('recordPayment')}
                        </Button>
                      ) : st === 'PAID' ? (
                        <Icon name="check" size={15} className="text-ok" />
                      ) : null}
                    </Td>
                  </Row>
                );
              })}
            </Table>
          )}

          <div className="border-t border-line p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[0.7rem] font-black uppercase tracking-wide text-ink-muted">
              <Icon name="banknote" size={12} /> {t('paymentsTitle')}
            </p>
            {planPayments.length === 0 ? (
              <p className="py-2 text-center text-[0.78rem] font-semibold text-ink-muted">{t('noPayments')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {planPayments.map((p) => (
                  <li
                    key={p.id}
                    className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-2.5 py-1.5 text-[0.76rem] ${
                      p.status === 'CANCELLED' ? 'border-line bg-surface-2 opacity-60' : 'border-line bg-surface-2'
                    }`}
                  >
                    <Icon
                      name={p.status === 'CANCELLED' ? 'undo' : METHOD_ICON[p.paymentMethod]}
                      size={14}
                      className={p.status === 'CANCELLED' ? 'text-ink-muted' : 'text-brand'}
                    />
                    <span className="font-extrabold text-ink">
                      {t('installmentLabel', { n: numberByInstallmentId.get(p.installmentId ?? '') ?? '—' })}
                    </span>
                    <span className={`num font-black ${p.status === 'CANCELLED' ? 'text-ink-muted line-through' : 'text-ok'}`}>
                      {formatMoney(p.amount, currency)}
                    </span>
                    <span className="num text-[0.7rem] font-semibold text-ink-muted">
                      {formatDate(p.paymentDate, dateLocale)} · {t(`pm_${p.paymentMethod}`)}
                    </span>
                    {p.reference && (
                      <span className="mono text-[0.66rem] font-semibold text-ink-muted" dir="ltr">{p.reference}</span>
                    )}
                    {p.notes && <span className="truncate text-[0.68rem] font-semibold text-ink-muted">{p.notes}</span>}
                    <span className="ms-auto flex items-center gap-1">
                      {p.status === 'CANCELLED' ? (
                        <Badge tone="muted">{t('paymentStatus_CANCELLED')}</Badge>
                      ) : (
                        <>
                          <Badge tone="ok">{t('paymentStatus_ACTIVE')}</Badge>
                          {onCancelPayment && (
                            <IconButton
                              icon="trash"
                              variant="danger"
                              size={28}
                              label={t('cancelPaymentTitle')}
                              onClick={() => onCancelPayment(p)}
                            />
                          )}
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-1.5">
      <p className="truncate text-[0.66rem] font-bold text-ink-muted">{label}</p>
      <p
        className={`num mt-0.5 truncate text-[0.8rem] font-black ${
          tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SummaryTile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${strong ? 'border-brand/30 bg-brand/8' : 'border-line bg-surface-2'}`}>
      <p className="truncate text-[0.66rem] font-bold text-ink-muted">{label}</p>
      <p className={`num mt-0.5 truncate text-[0.82rem] font-black ${strong ? 'text-brand' : 'text-ink'}`}>{value}</p>
    </div>
  );
}
