import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, Pagination, Row, SearchInput, Select, StatCard, Table, Tabs, Td,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { formatDateTime, formatMoney, round2 } from '@/utils/format';
import { exportToXlsx } from '@/utils/export';
import { AuditService, InventoryService } from '@/services/operations.service';
import type { InventoryTransactionType, Product } from '@/types';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'purple' | 'muted';

const ADJUST_TYPES: InventoryTransactionType[] = ['PURCHASE', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN'];

const TYPE_TONE: Record<InventoryTransactionType, Tone> = {
  PURCHASE: 'brand',
  STOCK_IN: 'ok',
  STOCK_OUT: 'danger',
  ADJUSTMENT: 'purple',
  RETURN: 'info',
  SALE: 'warn',
};

const TYPE_ICON: Record<InventoryTransactionType, IconName> = {
  PURCHASE: 'download',
  STOCK_IN: 'plus',
  STOCK_OUT: 'minus',
  ADJUSTMENT: 'edit',
  RETURN: 'undo',
  SALE: 'cart',
};

const PAGE_SIZE = 25;

interface AdjustState {
  productId: string;
  type: InventoryTransactionType;
  qty: number;
  reason: string;
  dir: 'in' | 'out';
}

function stockTone(p: Product): Tone {
  return p.stockQuantity <= 0 ? 'danger' : p.stockQuantity <= p.minimumStock ? 'warn' : 'ok';
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function InventoryPage() {
  const { t, locale } = useT();
  const [params] = useSearchParams();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [term, setTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [adjust, setAdjust] = useState<AdjustState | null>(null);
  const [adjustError, setAdjustError] = useState('');
  const [saving, setSaving] = useState(false);

  const [moveProduct, setMoveProduct] = useState('ALL');
  const [moveType, setMoveType] = useState('ALL');

  const products = useLiveQuery(() => getDb().products.toArray(), [], []);
  const categories = useLiveQuery(() => getDb().categories.orderBy('name').toArray(), [], []);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /* Movements re-fetch whenever the transaction count changes (live) */
  const txCount = useLiveQuery(() => getDb().inventoryTransactions.count(), [], 0);
  const movements = useLiveQuery(
    () => new InventoryService().listTransactions(moveProduct === 'ALL' ? undefined : moveProduct, 500),
    [moveProduct, txCount],
    [],
  );

  /* ?filter=low — the app shell notification links here */
  useEffect(() => {
    if (params.get('filter') === 'low') {
      setLowOnly(true);
      setTab('stock');
      setPage(1);
    }
  }, [params]);

  const stats = useMemo(() => {
    const active = products.filter((p) => p.isActive);
    return {
      total: active.length,
      value: round2(active.reduce((a, p) => a + p.stockQuantity * p.purchasePrice, 0)),
      low: active.filter((p) => p.stockQuantity <= p.minimumStock).length,
      out: active.filter((p) => p.stockQuantity <= 0).length,
    };
  }, [products]);

  const stockList = useMemo(() => {
    const q = term.trim().toLowerCase();
    const list = products.filter((p) => {
      if (!p.isActive) return false;
      if (categoryFilter === 'NONE' && p.categoryId) return false;
      if (categoryFilter !== 'ALL' && categoryFilter !== 'NONE' && p.categoryId !== categoryFilter) return false;
      if (lowOnly && !(p.stockQuantity <= p.minimumStock)) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
    list.sort((a, b) => a.stockQuantity - b.stockQuantity || a.name.localeCompare(b.name, 'ar'));
    return list;
  }, [products, term, categoryFilter, lowOnly]);

  const pages = Math.max(1, Math.ceil(stockList.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = stockList.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const filteredMovements = useMemo(() => {
    if (moveType === 'ALL') return movements;
    return movements.filter((m) => m.type === moveType);
  }, [movements, moveType]);

  const filtersActive = !!term || categoryFilter !== 'ALL' || lowOnly;
  const resetFilters = () => { setTerm(''); setCategoryFilter('ALL'); setLowOnly(false); setPage(1); };

  /* ---------------- Adjustment ---------------- */

  const openAdjust = (productId = '') => {
    setAdjust({ productId, type: 'STOCK_IN', qty: 1, reason: '', dir: 'in' });
    setAdjustError('');
  };

  const adjustProduct = adjust ? productMap.get(adjust.productId) : undefined;
  const signedDelta = useMemo(() => {
    if (!adjust) return 0;
    const q = Math.abs(adjust.qty) || 0;
    if (adjust.type === 'STOCK_OUT') return -q;
    if (adjust.type === 'ADJUSTMENT') return adjust.dir === 'out' ? -q : q;
    return q; // PURCHASE, STOCK_IN, RETURN
  }, [adjust]);
  const resulting = adjustProduct ? adjustProduct.stockQuantity + signedDelta : 0;
  const qtyInvalid = !!adjust && (!Number.isFinite(adjust.qty) || Math.abs(adjust.qty) <= 0);
  const wouldGoNegative = !!adjustProduct && resulting < 0;

  const applyAdjust = async () => {
    if (!adjust) return;
    if (!adjust.productId || !adjustProduct) { setAdjustError(t('chooseProduct')); return; }
    if (qtyInvalid) { setAdjustError(t('invalidQuantity')); return; }
    if (wouldGoNegative) { setAdjustError(t('negativeStockError')); return; }

    setSaving(true);
    setAdjustError('');
    try {
      const auth = useAppStore.getState().authUser;
      const previous = adjustProduct.stockQuantity;
      const newQty = await new InventoryService().applyTransaction({
        productId: adjustProduct.id,
        type: adjust.type,
        quantity: signedDelta,
        reason: adjust.reason.trim() || undefined,
        createdBy: auth?.id ?? '',
      });
      new AuditService().log({
        userId: auth?.id, username: auth?.displayName,
        action: 'ADJUST_INVENTORY', entity: 'Product', entityId: adjustProduct.id,
        oldValue: { stock: previous }, newValue: { stock: newQty, type: adjust.type },
      }).catch(() => {});
      toastSuccess(`${adjustProduct.name}: ${previous} → ${newQty}`);
      setAdjust(null);
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'INSUFFICIENT_STOCK'
          ? t('negativeStockError')
          : e instanceof Error
            ? e.message
            : t('errorGeneric');
      setAdjustError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- Export ---------------- */

  const exportStock = () => {
    const rows = stockList.map((p) => ({
      [t('product')]: p.name,
      [t('sku')]: p.sku,
      [t('category')]: (p.categoryId && categoryName.get(p.categoryId)) || t('uncategorized'),
      [t('stock')]: p.stockQuantity,
      [t('minimumStock')]: p.minimumStock,
      [t('purchasePrice')]: p.purchasePrice,
      [t('inventoryValue')]: round2(p.stockQuantity * p.purchasePrice),
    }));
    exportToXlsx(rows, `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`, t('inventory'));
  };

  const exportMovements = () => {
    const rows = filteredMovements.map((m) => ({
      [t('product')]: productMap.get(m.productId)?.name ?? m.productId,
      [t('movementType')]: t(`movementType_${m.type}`),
      [t('quantity')]: m.quantity,
      [t('from')]: m.previousQuantity,
      [t('to')]: m.newQuantity,
      [t('reason')]: m.reason ?? '—',
      [t('date')]: formatDateTime(m.createdAt, dateLocale),
      [t('byUser')]: m.createdBy || '—',
    }));
    exportToXlsx(rows, `inventory-movements-${new Date().toISOString().slice(0, 10)}.xlsx`, t('history'));
  };

  const activeProducts = useMemo(
    () => products.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [products],
  );

  return (
    <>
      <PageHeader
        icon="layers"
        title={t('inventory')}
        subtitle={t('inventorySubtitle')}
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={tab === 'stock' ? exportStock : exportMovements}>
              {t('exportData')}
            </Button>
            {hasPermission('inventory.adjust') && (
              <Button icon="plus" onClick={() => openAdjust()}>{t('stockAdjustment')}</Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="box" tone="brand" label={t('totalProducts')} value={String(stats.total)} />
        <StatCard icon="database" tone="info" label={t('inventoryValue')} value={formatMoney(stats.value, currency)} delta={t('valueAtPurchase')} deltaTone="muted" />
        <StatCard icon="alert" tone={stats.low > 0 ? 'warn' : 'muted'} label={t('lowStockAlert')} value={String(stats.low)} />
        <StatCard icon="eye-off" tone={stats.out > 0 ? 'danger' : 'muted'} label={t('outOfStock')} value={String(stats.out)} />
      </div>

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as 'stock' | 'movements')}
        tabs={[
          { value: 'stock', label: t('stockTab'), icon: 'box', count: stockList.length },
          { value: 'movements', label: t('movementsTab'), icon: 'history', count: filteredMovements.length },
        ]}
      />

      {tab === 'stock' ? (
        <Card padded={false} className="overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <SearchInput
              value={term}
              onChange={(v) => { setTerm(v); setPage(1); }}
              placeholder={t('search')}
              className="min-w-52 flex-1"
            />
            <Select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="w-auto min-w-36"
              aria-label={t('category')}
            >
              <option value="ALL">{t('allCategories')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="NONE">{t('uncategorized')}</option>
            </Select>
            <button
              type="button"
              onClick={() => { setLowOnly((v) => !v); setPage(1); }}
              aria-pressed={lowOnly}
              className={`flex h-9.5 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[0.76rem] font-bold transition-colors ${
                lowOnly ? 'border-warn/40 bg-warn/12 text-warn' : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong'
              }`}
            >
              <Icon name="alert" size={13} /> {t('lowStockFilter')}
            </button>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex h-9.5 shrink-0 items-center gap-1 rounded-md px-2 text-[0.76rem] font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={13} /> {t('resetFilters')}
              </button>
            )}
            <span className="num ms-auto text-[0.74rem] font-bold text-ink-muted">
              {t('totalRecords', { count: stockList.length })}
            </span>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon="box"
              title={filtersActive ? t('noResults') : t('productsEmpty')}
              hint={filtersActive ? t('stockEmptyHint') : t('productsEmptyHint')}
            />
          ) : (
            <Table
              head={[t('product'), t('category'), t('purchasePrice'), t('stock'), t('minimumStock'), t('inventoryValue'), '']}
            >
              {visible.map((p) => (
                <Row key={p.id}>
                  <Td>
                    <span className="flex items-center gap-2.5">
                      {p.image ? (
                        <img src={p.image} alt="" className="h-9 w-9 shrink-0 rounded-md border border-line bg-surface-3 object-contain" />
                      ) : (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-muted">
                          <Icon name="image" size={15} strokeWidth={1.6} />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block max-w-56 truncate text-[0.85rem] font-extrabold text-ink">{p.name}</span>
                        <span className="mono block max-w-40 truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
                          {p.barcode || p.sku}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="block max-w-36 truncate text-[0.78rem] font-bold text-ink-2">
                      {(p.categoryId && categoryName.get(p.categoryId)) || <span className="text-ink-muted">{t('uncategorized')}</span>}
                    </span>
                  </Td>
                  <Td><span className="num block font-bold text-ink-2">{formatMoney(p.purchasePrice, currency)}</span></Td>
                  <Td><Badge tone={stockTone(p)}>{p.stockQuantity}</Badge></Td>
                  <Td><span className="num block text-[0.8rem] font-bold text-ink-muted">{p.minimumStock}</span></Td>
                  <Td><span className="num block font-black text-ink">{formatMoney(p.stockQuantity * p.purchasePrice, currency)}</span></Td>
                  <Td className="text-end">
                    {hasPermission('inventory.adjust') ? (
                      <IconButton icon="edit" label={t('openAdjust')} size={30} onClick={() => openAdjust(p.id)} />
                    ) : null}
                  </Td>
                </Row>
              ))}
            </Table>
          )}

          <Pagination page={current} pages={pages} total={stockList.length} onPage={setPage} />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Select
              value={moveProduct}
              onChange={(e) => setMoveProduct(e.target.value)}
              className="w-auto min-w-44 flex-1 sm:flex-none"
              aria-label={t('product')}
            >
              <option value="ALL">{t('allProducts')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select
              value={moveType}
              onChange={(e) => setMoveType(e.target.value)}
              className="w-auto min-w-36"
              aria-label={t('movementType')}
            >
              <option value="ALL">{t('all')} — {t('movementType')}</option>
              {(['PURCHASE', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN', 'SALE'] as InventoryTransactionType[]).map((ty) => (
                <option key={ty} value={ty}>{t(`movementType_${ty}`)}</option>
              ))}
            </Select>
            <span className="num ms-auto text-[0.74rem] font-bold text-ink-muted">
              {t('totalRecords', { count: filteredMovements.length })}
            </span>
          </div>

          {filteredMovements.length === 0 ? (
            <EmptyState icon="history" title={t('noMovements')} hint={t('lastMovements')} />
          ) : (
            <Table
              head={[t('product'), t('movementType'), t('quantityChange'), t('reason'), t('date'), t('byUser')]}
            >
              {filteredMovements.map((m) => {
                const p = productMap.get(m.productId);
                return (
                  <Row key={m.id}>
                    <Td>
                      <span className="block max-w-52 truncate text-[0.84rem] font-bold text-ink">
                        {p?.name ?? <span className="mono text-ink-muted">{m.productId.slice(0, 8)}</span>}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={TYPE_TONE[m.type] ?? 'muted'} icon={TYPE_ICON[m.type] ?? 'info'}>
                        {t(`movementType_${m.type}`)}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="num flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                        <span className="text-ink-2">{m.previousQuantity}</span>
                        <Icon name="chevron-end" size={12} className="text-ink-muted" />
                        <span className="font-black text-ink">{m.newQuantity}</span>
                        <span className={`num rounded-md px-1.5 text-[0.7rem] font-black ${m.quantity >= 0 ? 'bg-ok/12 text-ok' : 'bg-danger/12 text-danger'}`}>
                          {m.quantity >= 0 ? '+' : ''}{m.quantity}
                        </span>
                      </span>
                    </Td>
                    <Td><span className="block max-w-40 truncate text-[0.78rem] font-semibold text-ink-2">{m.reason || '—'}</span></Td>
                    <Td className="num whitespace-nowrap text-ink-2">{formatDateTime(m.createdAt, dateLocale)}</Td>
                    <Td><span className="mono block max-w-24 truncate text-[0.7rem] font-semibold text-ink-muted">{m.createdBy || '—'}</span></Td>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {/* Stock adjustment modal */}
      <Modal
        open={!!adjust}
        onClose={() => setAdjust(null)}
        title={t('stockAdjustment')}
        subtitle={adjustProduct?.name}
        icon="layers"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjust(null)}>{t('cancel')}</Button>
            <Button
              icon="save"
              loading={saving}
              disabled={!adjust?.productId || qtyInvalid || wouldGoNegative}
              onClick={applyAdjust}
            >
              {t('save')}
            </Button>
          </>
        }
      >
        {adjust && (
          <div className="grid gap-4">
            <Field label={t('product')} required error={!adjust.productId ? t('chooseProduct') : undefined}>
              <Select
                value={adjust.productId}
                onChange={(e) => setAdjust({ ...adjust, productId: e.target.value })}
              >
                <option value="">{t('chooseProduct')}</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {t('stock')}: {p.stockQuantity}</option>
                ))}
              </Select>
            </Field>

            <Field label={t('movementType')}>
              <Select
                value={adjust.type}
                onChange={(e) => {
                  const type = e.target.value as InventoryTransactionType;
                  const dir = type === 'STOCK_OUT' ? 'out' : type === 'ADJUSTMENT' ? adjust.dir : 'in';
                  setAdjust({ ...adjust, type, dir });
                }}
              >
                {ADJUST_TYPES.map((ty) => <option key={ty} value={ty}>{t(`movementType_${ty}`)}</option>)}
              </Select>
            </Field>

            {adjust.type === 'ADJUSTMENT' && (
              <Field label={t('quantityChange')} hint={t('adjustStockHint')}>
                <div className="flex gap-2">
                  {(['in', 'out'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setAdjust({ ...adjust, dir: d })}
                      className={`flex h-9.5 flex-1 items-center justify-center gap-1.5 rounded-md border text-[0.8rem] font-bold transition-colors ${
                        adjust.dir === d
                          ? d === 'in'
                            ? 'border-ok/40 bg-ok/12 text-ok'
                            : 'border-danger/40 bg-danger/12 text-danger'
                          : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong'
                      }`}
                    >
                      <Icon name={d === 'in' ? 'plus' : 'minus'} size={14} />
                      {d === 'in' ? t('increaseStock') : t('decreaseStock')}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label={t('quantity')} required error={qtyInvalid ? t('invalidQuantity') : undefined}>
              <Input
                type="number"
                min={1}
                step={1}
                value={adjust.qty === 0 ? '' : String(adjust.qty)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setAdjust({ ...adjust, qty: Number.isFinite(n) ? n : 0 });
                }}
                className="num"
                dir="ltr"
                autoFocus
              />
            </Field>

            <Field label={t('reason')}>
              <Input
                value={adjust.reason}
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
                placeholder={t('adjustReasonPlaceholder')}
                maxLength={120}
              />
            </Field>

            {adjustProduct && (
              <div
                className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 ${
                  wouldGoNegative ? 'border-danger/30 bg-danger/8' : 'border-line bg-surface-2'
                }`}
              >
                <span className="text-[0.76rem] font-bold text-ink-2">{t('resultingStock')}</span>
                <span className="num flex items-center gap-2 text-[0.9rem] font-black">
                  <span className="text-ink-muted">{adjustProduct.stockQuantity}</span>
                  <Icon name="chevron-end" size={14} className="text-ink-muted" />
                  <span className={wouldGoNegative ? 'text-danger' : signedDelta >= 0 ? 'text-ok' : 'text-warn'}>
                    {resulting}
                  </span>
                </span>
              </div>
            )}

            {(adjustError || wouldGoNegative) && (
              <p className="anim-pop flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[0.78rem] font-bold text-danger">
                <Icon name="alert" size={14} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                <span>{adjustError || t('negativeStockError')}</span>
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
