import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Badge, Card, EmptyState, Modal, PageHeader, Pagination, Row, SearchInput, Select, Table, Td } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { formatDateTime } from '@/utils/format';
import type { AuditLog } from '@/types';

const ACTION_ICON: Record<string, IconName> = {
  CREATE_SALE: 'receipt',
  CANCEL_SALE: 'undo',
  RECORD_PAYMENT: 'banknote',
  CANCEL_PAYMENT: 'undo',
  UPDATE_PRODUCT: 'edit',
  CREATE_PRODUCT: 'plus',
  DELETE_PRODUCT: 'trash',
  ADJUST_INVENTORY: 'layers',
  CREATE_CUSTOMER: 'user',
  UPDATE_CUSTOMER: 'edit',
  LOGIN: 'logout',
  LOGOUT: 'logout',
};

const PAGE_SIZE = 25;

export function AuditPage() {
  const { t, locale } = useT();
  const [term, setTerm] = useState('');
  const [action, setAction] = useState('ALL');
  const [entity, setEntity] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const logs = useLiveQuery(() => getDb().auditLogs.orderBy('createdAt').reverse().limit(2000).toArray(), [], []);

  const label = (prefix: string, value: string) => {
    const key = `${prefix}${value}`;
    const text = t(key);
    return text === key ? value : text;
  };

  const actions = useMemo(() => [...new Set(logs.map((l) => l.action))].sort(), [logs]);
  const entities = useMemo(() => [...new Set(logs.map((l) => l.entity))].sort(), [logs]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return logs.filter((l) => {
      if (action !== 'ALL' && l.action !== action) return false;
      if (entity !== 'ALL' && l.entity !== entity) return false;
      if (!q) return true;
      return (
        (l.username ?? '').toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.entity.toLowerCase().includes(q) ||
        (l.entityId ?? '').toLowerCase().includes(q)
      );
    });
  }, [logs, term, action, entity]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const changes = useMemo(() => {
    if (!selected) return [];
    const oldObj = (selected.oldValue ?? {}) as Record<string, unknown>;
    const newObj = (selected.newValue ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])];
    return keys
      .map((k) => ({ key: k, from: oldObj[k], to: newObj[k] }))
      .filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
  }, [selected]);

  const reset = () => { setTerm(''); setAction('ALL'); setEntity('ALL'); setPage(1); };

  return (
    <>
      <PageHeader
        icon="history"
        title={t('audit')}
        subtitle={t('auditSubtitle')}
        actions={
          <Badge tone="muted" icon="database">
            {t('totalRecords', { count: filtered.length })}
          </Badge>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={term} onChange={(v) => { setTerm(v); setPage(1); }} placeholder={t('search')} className="min-w-52 flex-1" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-auto min-w-40">
            <option value="ALL">{t('all')} — {t('auditActionLabel')}</option>
            {actions.map((a) => <option key={a} value={a}>{label('auditAction_', a)}</option>)}
          </Select>
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="w-auto min-w-36">
            <option value="ALL">{t('all')} — {t('auditEntityLabel')}</option>
            {entities.map((e) => <option key={e} value={e}>{label('auditEntity_', e)}</option>)}
          </Select>
          {(term || action !== 'ALL' || entity !== 'ALL') && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[0.76rem] font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="x" size={13} /> {t('cancel')}
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="history" title={t('auditEmpty')} hint={t('auditEmptyHint')} />
        ) : (
          <Table
            head={[t('users'), t('auditActionLabel'), t('auditEntityLabel'), t('createdAt'), '']}
          >
            {rows.map((log) => (
              <Row key={log.id} onClick={() => setSelected(log)}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[0.68rem] font-black text-ink-2">
                      {(log.username ?? '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate font-bold">{log.username ?? '—'}</span>
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <Icon name={ACTION_ICON[log.action] ?? 'info'} size={14} className="text-ink-muted" />
                    <span className="font-bold">{label('auditAction_', log.action)}</span>
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Badge tone="brand">{label('auditEntity_', log.entity)}</Badge>
                    {log.entityId && <span className="mono truncate text-[0.68rem] text-ink-muted">{log.entityId.slice(0, 8)}</span>}
                  </span>
                </Td>
                <Td className="num whitespace-nowrap text-ink-2">{formatDateTime(log.createdAt, locale === 'ar' ? 'ar-DZ' : 'fr-DZ')}</Td>
                <Td className="text-end">
                  <Icon name="chevron-end" size={15} className="text-ink-muted" />
                </Td>
              </Row>
            ))}
          </Table>
        )}

        <Pagination page={current} pages={pages} total={filtered.length} onPage={setPage} />
      </Card>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? label('auditAction_', selected.action) : ''}
        subtitle={selected ? `${label('auditEntity_', selected.entity)}${selected.entityId ? ` · ${selected.entityId}` : ''}` : undefined}
        icon={selected ? (ACTION_ICON[selected.action] ?? 'info') : 'info'}
        wide
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <InfoTile label={t('users')} value={selected.username ?? '—'} />
              <InfoTile label={t('createdAt')} value={formatDateTime(selected.createdAt, locale === 'ar' ? 'ar-DZ' : 'fr-DZ')} />
            </div>

            {changes.length > 0 && (
              <div>
                <p className="mb-2 text-[0.76rem] font-black uppercase tracking-wide text-ink-muted">{t('changedFields')}</p>
                <div className="overflow-hidden rounded-lg border border-line">
                  {changes.map((c) => (
                    <div key={c.key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-[0.8rem] last:border-0">
                      <span className="num truncate text-start font-bold text-danger line-through">{format(c.from)}</span>
                      <span className="mono text-[0.7rem] font-black text-ink-muted">{c.key}</span>
                      <span className="num truncate text-end font-bold text-ok">{format(c.to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(selected.oldValue != null || selected.newValue != null) && (
              <details className="rounded-lg border border-line bg-surface-2 p-3">
                <summary className="cursor-pointer text-[0.78rem] font-bold text-ink-2">{t('rawPayload')}</summary>
                <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[0.7rem] text-ink-2">
{JSON.stringify({ old: selected.oldValue ?? null, new: selected.newValue ?? null }, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className="text-[0.68rem] font-black uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-[0.85rem] font-bold text-ink">{value}</p>
    </div>
  );
}

function format(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
