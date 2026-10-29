import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, Pagination,
  Row, SearchInput, Table, Td, Textarea,
} from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { formatMoney } from '@/utils/format';
import { newId, syncMeta } from '@/utils/helpers';
import { AuditService } from '@/services/operations.service';
import { exportToXlsx } from '@/utils/export';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import type { Customer } from '@/types';

const PAGE_SIZE = 20;

interface FormState {
  id?: string;
  fullName: string;
  phone: string;
  address: string;
  nationalId: string;
  notes: string;
}

const BLANK: FormState = { fullName: '', phone: '', address: '', nationalId: '', notes: '' };

export function CustomersPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);

  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const rows = useLiveQuery(async () => {
    const db = getDb();
    const [customers, sales, plans, installments] = await Promise.all([
      db.customers.toArray(),
      db.sales.filter((s) => s.status !== 'CANCELLED').toArray(),
      db.installmentPlans.toArray(),
      db.installments.toArray(),
    ]);
    const planBySale = new Map(plans.map((p) => [p.saleId, p.id]));
    const remainingByPlan = new Map<string, number>();
    for (const i of installments) {
      remainingByPlan.set(i.planId, (remainingByPlan.get(i.planId) ?? 0) + Math.max(0, i.remainingAmount));
    }
    return customers.map((c) => {
      const own = sales.filter((s) => s.customerId === c.id);
      const remaining = own.reduce((sum, s) => {
        const planId = planBySale.get(s.id);
        return sum + (planId ? (remainingByPlan.get(planId) ?? 0) : Math.max(0, s.remainingAmount));
      }, 0);
      return { customer: c, contracts: own.filter((s) => s.saleType === 'INSTALLMENT').length, remaining };
    });
  }, [], []);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ customer: c }) =>
      c.fullName.toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      c.customerNumber.toLowerCase().includes(q) ||
      (c.nationalId ?? '').toLowerCase().includes(q),
    );
  }, [rows, term]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  useEffect(() => {
    if (params.get('new') === '1' && hasPermission('customers.create')) {
      setForm(BLANK);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, hasPermission]);

  const openAdd = () => { setForm(BLANK); setErrors({}); };
  const openEdit = (c: Customer) => {
    setForm({ id: c.id, fullName: c.fullName, phone: c.phone ?? '', address: c.address ?? '', nationalId: c.nationalId ?? '', notes: c.notes ?? '' });
    setErrors({});
  };

  const save = async () => {
    if (!form) return;
    const name = form.fullName.trim();
    if (!name) { setErrors({ fullName: t('requiredField') }); return; }
    setSaving(true);
    const db = getDb();
    try {
      const meta = await syncMeta();
      if (form.id) {
        const existing = await db.customers.get(form.id);
        await db.customers.update(form.id, {
          fullName: name,
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          nationalId: form.nationalId.trim() || undefined,
          notes: form.notes.trim() || undefined,
          updatedAt: Date.now(),
          version: (existing?.version ?? 1) + 1,
        });
        new AuditService().log({
          action: 'UPDATE_CUSTOMER', entity: 'Customer', entityId: form.id,
          oldValue: { fullName: existing?.fullName, phone: existing?.phone },
          newValue: { fullName: name, phone: form.phone },
        }).catch(() => {});
        toastSuccess(t('updatedOk'));
      } else {
        const all = await db.customers.toArray();
        const maxNum = all.reduce((max, c) => {
          const n = Number.parseInt(c.customerNumber.replace(/\D/g, ''), 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        await db.customers.add({
          id: newId(),
          customerNumber: `C-${String(maxNum + 1).padStart(5, '0')}`,
          fullName: name,
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          nationalId: form.nationalId.trim() || undefined,
          notes: form.notes.trim() || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...meta,
        });
        toastSuccess(t('addedOk'));
      }
      setForm(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const exportRows = () => {
    const data = filtered.map(({ customer: c, contracts, remaining }) => ({
      [t('customerNumber')]: c.customerNumber,
      [t('fullName')]: c.fullName,
      [t('phone')]: c.phone ?? '',
      [t('address')]: c.address ?? '',
      [t('nationalId')]: c.nationalId ?? '',
      [t('contractsCount')]: contracts,
      [t('remaining')]: remaining,
      [t('notes')]: c.notes ?? '',
    }));
    exportToXlsx(data, `customers-${new Date().toISOString().slice(0, 10)}.xlsx`, t('customers'));
  };

  return (
    <>
      <PageHeader
        icon="users"
        title={t('customers')}
        subtitle={t('totalRecords', { count: filtered.length })}
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={exportRows}>{t('exportData')}</Button>
            {hasPermission('customers.create') && <Button icon="plus" onClick={openAdd}>{t('add')}</Button>}
          </>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={term} onChange={(v) => { setTerm(v); setPage(1); }} placeholder={t('search')} className="min-w-52 flex-1" />
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon="users"
            title={term ? t('noResults') : t('customersEmpty')}
            hint={term ? undefined : t('customersEmptyHint')}
            action={!term && hasPermission('customers.create') ? <Button icon="plus" onClick={openAdd}>{t('add')}</Button> : undefined}
          />
        ) : (
          <Table head={['#', t('fullName'), t('phone'), t('contractsCount'), t('remaining'), '']}>
            {visible.map(({ customer: c, contracts, remaining }) => (
              <Row key={c.id}>
                <Td className="mono text-[0.74rem] font-bold text-ink-muted">{c.customerNumber}</Td>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/12 text-[0.72rem] font-black text-brand">
                      {c.fullName.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold">{c.fullName}</span>
                      {c.nationalId && <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted">{c.nationalId}</span>}
                    </span>
                  </span>
                </Td>
                <Td className="num">{c.phone || '—'}</Td>
                <Td><Badge tone={contracts ? 'purple' : 'muted'}>{contracts}</Badge></Td>
                <Td className={`num font-black ${remaining > 0 ? 'text-danger' : 'text-ok'}`}>
                  {formatMoney(remaining, currency)}
                </Td>
                <Td className="text-end">
                  <span className="flex items-center justify-end gap-1">
                    <Link
                      to={`/customers/${c.id}`}
                      className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[0.74rem] font-bold text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                    >
                      {t('profile')} <Icon name="chevron-end" size={13} />
                    </Link>
                    {hasPermission('customers.update') && <IconButton icon="edit" label={t('edit')} size={30} onClick={() => openEdit(c)} />}
                  </span>
                </Td>
              </Row>
            ))}
          </Table>
        )}

        <Pagination page={current} pages={pages} total={filtered.length} onPage={setPage} />
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('edit') : t('add')}
        subtitle={t('customers')}
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
            <Field label={t('fullName')} required error={errors.fullName} className="sm:col-span-2">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
            </Field>
            <Field label={t('phone')}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" dir="ltr" className="text-start" />
            </Field>
            <Field label={t('nationalId')}>
              <Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
            </Field>
            <Field label={t('address')} className="sm:col-span-2">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('notes')} className="sm:col-span-2">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
