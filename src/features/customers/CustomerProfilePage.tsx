import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader,
  Row, Spinner, StatCard, Table, Tabs, Td, Textarea,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { AuditService } from '@/services/operations.service';
import { daysBetween, formatDate, formatDateTime, formatMoney, round2 } from '@/utils/format';
import type { Installment, InstallmentPlan, Payment, PaymentMethod, SaleStatus } from '@/types';

type TabValue = 'purchases' | 'schedule' | 'payments';

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

interface FormState {
  fullName: string;
  phone: string;
  address: string;
  nationalId: string;
  notes: string;
}

export function CustomerProfilePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const [tab, setTab] = useState<TabValue>('purchases');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const customer = await db.customers.get(id);
    if (!customer) return null;
    const sales = await db.sales.where('customerId').equals(id).toArray();
    sales.sort((a, b) => b.saleDate - a.saleDate);
    const saleIds = sales.map((s) => s.id);
    const plans: InstallmentPlan[] = saleIds.length
      ? await db.installmentPlans.where('saleId').anyOf(saleIds).toArray()
      : [];
    const activePlans = plans.filter((p) => p.status !== 'CANCELLED');
    const planIds = activePlans.map((p) => p.id);
    const installments: Installment[] = planIds.length
      ? await db.installments.where('planId').anyOf(planIds).toArray()
      : [];
    const instPayments: Payment[] = installments.length
      ? await db.payments.where('installmentId').anyOf(installments.map((i) => i.id)).toArray()
      : [];
    const directPayments: Payment[] = saleIds.length
      ? await db.payments.where('saleId').anyOf(saleIds).toArray()
      : [];
    return { customer, sales, plans: activePlans, installments, payments: [...directPayments, ...instPayments] };
  }, [id]);

  const saleById = useMemo(
    () => new Map((data?.sales ?? []).map((s) => [s.id, s])),
    [data],
  );
  const planById = useMemo(
    () => new Map((data?.plans ?? []).map((p) => [p.id, p])),
    [data],
  );
  const installmentById = useMemo(
    () => new Map((data?.installments ?? []).map((i) => [i.id, i])),
    [data],
  );

  const kpi = useMemo(() => {
    if (!data) return { contracts: 0, purchases: 0, paid: 0, remaining: 0, overdue: 0 };
    const now = Date.now();
    const active = data.sales.filter((s) => s.status !== 'CANCELLED');
    return {
      contracts: data.plans.length,
      purchases: round2(active.reduce((sum, s) => sum + s.totalAmount, 0)),
      paid: round2(active.reduce((sum, s) => sum + s.paidAmount, 0)),
      remaining: round2(active.reduce((sum, s) => sum + Math.max(0, s.remainingAmount), 0)),
      overdue: data.installments.filter((i) => i.remainingAmount > 0 && i.dueDate < now).length,
    };
  }, [data]);

  const installmentsSorted = useMemo(() => {
    if (!data) return [];
    return data.installments.slice().sort((a, b) => a.dueDate - b.dueDate || a.installmentNumber - b.installmentNumber);
  }, [data]);

  const paymentsSorted = useMemo(() => {
    if (!data) return [];
    return data.payments.slice().sort((a, b) => b.paymentDate - a.paymentDate);
  }, [data]);

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-muted">
        <Spinner size={18} />
        <span className="text-[0.84rem] font-bold">{t('loading')}</span>
      </div>
    );
  }

  if (data === null) {
    return (
      <EmptyState
        icon="user"
        title={t('customerNotFound')}
        hint={t('customerNotFoundHint')}
        action={<Button variant="secondary" icon="chevron-start" onClick={() => navigate('/customers')}>{t('back')}</Button>}
      />
    );
  }

  const { customer } = data;
  const now = Date.now();

  const openEdit = () => {
    setForm({
      fullName: customer.fullName,
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      nationalId: customer.nationalId ?? '',
      notes: customer.notes ?? '',
    });
    setFormError('');
  };

  const save = async () => {
    if (!form) return;
    const name = form.fullName.trim();
    if (!name) {
      setFormError(t('requiredField'));
      return;
    }
    setSaving(true);
    try {
      const db = getDb();
      const existing = await db.customers.get(customer.id);
      await db.customers.update(customer.id, {
        fullName: name,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        nationalId: form.nationalId.trim() || undefined,
        notes: form.notes.trim() || undefined,
        updatedAt: Date.now(),
        version: (existing?.version ?? 1) + 1,
      });
      const auth = useAppStore.getState().authUser;
      new AuditService().log({
        userId: auth?.id,
        username: auth?.displayName,
        action: 'UPDATE_CUSTOMER',
        entity: 'Customer',
        entityId: customer.id,
        oldValue: { fullName: existing?.fullName, phone: existing?.phone },
        newValue: { fullName: name, phone: form.phone },
      }).catch(() => {});
      toastSuccess(t('updatedOk'));
      setForm(null);
    } catch {
      toastError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const invoiceOfPlan = (planId: string): string => {
    const plan = planById.get(planId);
    const sale = plan ? saleById.get(plan.saleId) : undefined;
    return sale?.invoiceNumber ?? '—';
  };

  return (
    <>
      <PageHeader
        icon="user"
        title={t('customerProfileTitle')}
        subtitle={`${t('customers')} · ${customer.customerNumber}`}
        actions={
          <>
            <Button variant="secondary" icon="chevron-start" onClick={() => navigate('/customers')}>{t('back')}</Button>
            {hasPermission('customers.update') && (
              <Button icon="edit" onClick={openEdit}>{t('editCustomer')}</Button>
            )}
          </>
        }
      />

      {/* Identity card */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-brand/12 text-[1.5rem] font-black text-brand">
            {customer.fullName.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.1rem] font-black text-ink">{customer.fullName}</h2>
              <Badge tone="brand" icon="user">
                <span className="mono" dir="ltr">{customer.customerNumber}</span>
              </Badge>
              {kpi.overdue > 0 && (
                <Badge tone="danger" icon="alert">{t('overdueCountBadge', { count: kpi.overdue })}</Badge>
              )}
            </div>
            <div className="mt-2.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
              <InfoLine icon="phone" label={t('phone')} value={customer.phone} ltr />
              <InfoLine icon="home" label={t('address')} value={customer.address} />
              <InfoLine icon="shield" label={t('nationalId')} value={customer.nationalId} ltr />
              <InfoLine icon="calendar" label={t('memberSince')} value={formatDate(customer.createdAt, dateLocale)} />
            </div>
            {customer.notes && (
              <p className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[0.78rem] font-semibold leading-relaxed text-ink-2">
                <span className="font-black text-ink-muted">{t('notes')}: </span>
                {customer.notes}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="file" tone="purple" label={t('contractsCount')} value={String(kpi.contracts)} />
        <StatCard icon="cart" tone="brand" label={t('totalPurchases')} value={formatMoney(kpi.purchases, currency)} />
        <StatCard icon="banknote" tone="ok" label={t('paid')} value={formatMoney(kpi.paid, currency)} />
        <StatCard
          icon="clock"
          tone={kpi.remaining > 0 ? 'warn' : 'muted'}
          label={t('remaining')}
          value={formatMoney(kpi.remaining, currency)}
        />
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { value: 'purchases', label: t('tabPurchases'), icon: 'receipt', count: data.sales.length },
          { value: 'schedule', label: t('tabSchedule'), icon: 'calendar', count: installmentsSorted.length },
          { value: 'payments', label: t('tabPayments'), icon: 'banknote', count: paymentsSorted.length },
        ]}
        value={tab}
        onChange={(v) => setTab(v as TabValue)}
      />

      {tab === 'purchases' && (
        <Card padded={false} className="overflow-hidden">
          {data.sales.length === 0 ? (
            <EmptyState icon="receipt" title={t('noPurchases')} />
          ) : (
            <Table
              head={[t('invoiceNumber'), t('date'), t('saleType'), t('total'), t('paid'), t('remaining'), t('status'), '']}
            >
              {data.sales.map((s) => (
                <Row key={s.id}>
                  <Td className="mono whitespace-nowrap text-[0.74rem] font-bold text-ink-muted">
                    <span dir="ltr">{s.invoiceNumber}</span>
                  </Td>
                  <Td className="num whitespace-nowrap text-ink-2">{formatDate(s.saleDate, dateLocale)}</Td>
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
                    {s.saleType === 'INSTALLMENT' && s.status !== 'CANCELLED' ? (
                      <Link
                        to={`/contracts/${s.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[0.74rem] font-bold text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                      >
                        <Icon name="file" size={13} /> {t('viewContractLabel')}
                      </Link>
                    ) : null}
                  </Td>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'schedule' && (
        <Card padded={false} className="overflow-hidden">
          {installmentsSorted.length === 0 ? (
            <EmptyState icon="calendar" title={t('noInstallmentsYet')} />
          ) : (
            <Table
              head={[t('relatedInvoice'), '#', t('dueDate'), t('amountDue'), t('amountPaidCol'), t('remaining'), t('status'), '']}
            >
              {installmentsSorted.map((i) => {
                const paidOff = i.remainingAmount <= 0;
                const late = !paidOff && i.dueDate < now;
                const status: 'PAID' | 'OVERDUE' | 'PARTIAL' | 'PENDING' = paidOff
                  ? 'PAID'
                  : late
                    ? 'OVERDUE'
                    : i.amountPaid > 0
                      ? 'PARTIAL'
                      : 'PENDING';
                const tone = status === 'PAID' ? 'ok' : status === 'OVERDUE' ? 'danger' : status === 'PARTIAL' ? 'warn' : 'info';
                const labelKey = status === 'PAID' ? 'paidStatus' : status === 'OVERDUE' ? 'overdue' : status === 'PARTIAL' ? 'partial' : 'pending';
                const plan = planById.get(i.planId);
                return (
                  <Row key={i.id}>
                    <Td className="mono text-[0.72rem] font-bold text-ink-muted">
                      <span dir="ltr">{plan ? invoiceOfPlan(plan.id) : '—'}</span>
                    </Td>
                    <Td className="num font-black">{i.installmentNumber}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="num">{formatDate(i.dueDate, dateLocale)}</span>
                      {late && (
                        <span className="block text-[0.68rem] font-bold text-danger">
                          {t('daysLate', { days: Math.max(1, daysBetween(i.dueDate, now)) })}
                        </span>
                      )}
                    </Td>
                    <Td className="num">{formatMoney(i.amountDue, currency)}</Td>
                    <Td className="num text-ok">{i.amountPaid > 0 ? formatMoney(i.amountPaid, currency) : '—'}</Td>
                    <Td className={`num font-black ${!paidOff ? 'text-danger' : 'text-ink-muted'}`}>
                      {formatMoney(Math.max(0, i.remainingAmount), currency)}
                    </Td>
                    <Td><Badge tone={tone}>{t(labelKey)}</Badge></Td>
                    <Td className="text-end">
                      {plan && (
                        <Link
                          to={`/installments?plan=${plan.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[0.74rem] font-bold text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                        >
                          <Icon name="wallet" size={13} /> {t('openCollections')}
                        </Link>
                      )}
                    </Td>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === 'payments' && (
        <Card padded={false} className="overflow-hidden">
          {paymentsSorted.length === 0 ? (
            <EmptyState icon="banknote" title={t('noPaymentsYet')} />
          ) : (
            <Table
              head={[t('date'), t('amount'), t('paymentMethod'), t('relatedInvoice'), t('reference'), t('status')]}
            >
              {paymentsSorted.map((p) => {
                const inst = p.installmentId ? installmentById.get(p.installmentId) : undefined;
                const plan = inst ? planById.get(inst.planId) : undefined;
                const sale = plan ? saleById.get(plan.saleId) : (p.saleId ? saleById.get(p.saleId) : undefined);
                return (
                  <Row key={p.id}>
                    <Td className="num whitespace-nowrap text-ink-2">{formatDateTime(p.paymentDate, dateLocale)}</Td>
                    <Td className={`num font-black ${p.status === 'CANCELLED' ? 'text-ink-muted line-through' : 'text-ok'}`}>
                      {formatMoney(p.amount, currency)}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 font-bold">
                        <Icon name={METHOD_ICON[p.paymentMethod]} size={14} className="text-ink-muted" />
                        {t(`pm_${p.paymentMethod}`)}
                      </span>
                    </Td>
                    <Td>
                      <span className="mono text-[0.72rem] font-bold text-ink-muted" dir="ltr">
                        {sale?.invoiceNumber ?? '—'}
                      </span>
                      {inst && (
                        <span className="block text-[0.68rem] font-bold text-ink-2">
                          {t('installmentLabel', { n: inst.installmentNumber })}
                        </span>
                      )}
                      {!inst && !p.installmentId && (
                        <span className="block text-[0.68rem] font-bold text-ink-2">{t('downPaymentLabel')}</span>
                      )}
                    </Td>
                    <Td>
                      {p.reference ? (
                        <span className="mono text-[0.7rem] font-semibold text-ink-muted" dir="ltr">{p.reference}</span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                      {p.notes && <span className="block truncate text-[0.68rem] font-semibold text-ink-muted">{p.notes}</span>}
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'ACTIVE' ? 'ok' : 'muted'}>
                        {t(`paymentStatus_${p.status}`)}
                      </Badge>
                    </Td>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {/* Edit modal */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={t('editCustomer')}
        subtitle={customer.fullName}
        icon="user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button>
            <Button icon="save" loading={saving} onClick={save}>{t('save')}</Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fullName')} required error={formError} className="sm:col-span-2">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
            </Field>
            <Field label={t('phone')}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" dir="ltr" className="text-start" />
            </Field>
            <Field label={t('nationalId')}>
              <Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className="mono" dir="ltr" />
            </Field>
            <Field label={t('address')} className="sm:col-span-2">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('notes')} className="sm:col-span-2">
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */

function InfoLine({ icon, label, value, ltr }: { icon: IconName; label: string; value?: string; ltr?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[0.8rem]">
      <Icon name={icon} size={14} className="shrink-0 text-ink-muted" />
      <span className="shrink-0 font-bold text-ink-muted">{label}:</span>
      <span className={`truncate font-extrabold text-ink ${value ? '' : 'text-ink-muted font-semibold'}`} dir={ltr && value ? 'ltr' : undefined}>
        {value || '—'}
      </span>
    </span>
  );
}
