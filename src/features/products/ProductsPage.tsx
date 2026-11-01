import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, Pagination, Row, SearchInput, Select, StatCard, Table, Td, Textarea, Toggle,
} from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { formatMoney } from '@/utils/format';
import { compressImage } from '@/utils/image';
import { newId, syncMeta } from '@/utils/helpers';
import { generateBarcode } from '@/utils/barcode';
import { exportToXlsx } from '@/utils/export';
import { AuditService } from '@/services/operations.service';
import { BarcodeGenerateButton, BarcodeSVG, MiniBarcode } from '@/components/barcode/BarcodeView';
import { ScannerSelector } from '@/components/barcode/ScannerSelector';
import { ProductDetailModal } from '@/components/product/ProductDetailModal';
import type { Product } from '@/types';

const PAGE_SIZE = 20;
const MAX_COPIES = 50;
const PREVIEW_LIMIT = 98;

interface FormState {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  purchasePrice: number;
  sellingPrice: number;
  stockQuantity: number;
  minimumStock: number;
  description: string;
  image: string;
  isActive: boolean;
}

const BLANK: FormState = {
  name: '', sku: '', barcode: '', categoryId: '',
  purchasePrice: 0, sellingPrice: 0, stockQuantity: 0, minimumStock: 0,
  description: '', image: '', isActive: true,
};

interface PrintItem {
  product: Product;
  copies: number;
}

const SORT_LABEL: Record<string, string> = {
  'name-asc': 'sort_nameAsc',
  'name-desc': 'sort_nameDesc',
  'price-asc': 'sort_priceAsc',
  'price-desc': 'sort_priceDesc',
  'stock-asc': 'sort_stockAsc',
  'stock-desc': 'sort_stockDesc',
  'newest': 'sort_newest',
};

function stockTone(p: Product): 'ok' | 'warn' | 'danger' {
  return p.stockQuantity <= 0 ? 'danger' : p.stockQuantity <= p.minimumStock ? 'warn' : 'ok';
}

function numValue(n: number): string {
  return n === 0 ? '' : String(n);
}

function numChange(v: string): number {
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function ProductsPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const currency = useAppStore((s) => s.currency);
  const hasPermission = useAppStore((s) => s.hasPermission);

  const [term, setTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [detailBarcode, setDetailBarcode] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const isDesktop =
    typeof window !== 'undefined' && !!(window as unknown as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printItems, setPrintItems] = useState<PrintItem[] | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const products = useLiveQuery(() => getDb().products.toArray(), [], []);
  const categories = useLiveQuery(() => getDb().categories.orderBy('name').toArray(), [], []);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const openCreate = () => {
    setForm({ ...BLANK, sku: `SKU-${Date.now().toString().slice(-6)}` });
    setErrors({});
  };

  /* ?q= — global search jumps here with a prefilled term */
  useEffect(() => {
    const q = params.get('q');
    if (q) {
      setTerm(q);
      setStatusFilter('ALL');
      setPage(1);
    }
  }, [params]);

  /* ?new=1 — dashboard quick action opens the add form */
  useEffect(() => {
    if (params.get('new') === '1') {
      params.delete('new');
      setParams(params, { replace: true });
      if (hasPermission('products.create')) openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams, hasPermission]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    const list = products.filter((p) => {
      if (statusFilter === 'ACTIVE' && !p.isActive) return false;
      if (statusFilter === 'INACTIVE' && p.isActive) return false;
      if (categoryFilter === 'NONE' && p.categoryId) return false;
      if (categoryFilter !== 'ALL' && categoryFilter !== 'NONE' && p.categoryId !== categoryFilter) return false;
      if (lowOnly && !(p.isActive && p.stockQuantity <= p.minimumStock)) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'name-desc': return b.name.localeCompare(a.name, 'ar');
        case 'price-asc': return a.sellingPrice - b.sellingPrice;
        case 'price-desc': return b.sellingPrice - a.sellingPrice;
        case 'stock-asc': return a.stockQuantity - b.stockQuantity;
        case 'stock-desc': return b.stockQuantity - a.stockQuantity;
        case 'newest': return b.createdAt - a.createdAt;
        default: return a.name.localeCompare(b.name, 'ar');
      }
    });
    return list;
  }, [products, term, categoryFilter, statusFilter, lowOnly, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const stats = useMemo(() => {
    const active = products.filter((p) => p.isActive);
    return {
      total: products.length,
      inventoryValue: active.reduce((a, p) => a + p.stockQuantity * p.purchasePrice, 0),
      low: active.filter((p) => p.stockQuantity <= p.minimumStock).length,
      inactive: products.length - active.length,
    };
  }, [products]);

  const selectedProducts = useMemo(() => products.filter((p) => selectedIds.has(p.id)), [products, selectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((p) => next.delete(p.id));
      else filtered.forEach((p) => next.add(p.id));
      return next;
    });

  const openPrint = (list: Product[]) => {
    if (list.length === 0) return;
    setPrintItems(list.map((product) => ({ product, copies: 1 })));
  };

  const expandedLabels = useMemo(() => {
    if (!printItems) return [];
    const out: Product[] = [];
    for (const it of printItems) {
      const n = Math.max(1, Math.min(MAX_COPIES, it.copies));
      for (let i = 0; i < n; i++) out.push(it.product);
    }
    return out;
  }, [printItems]);
  const totalLabels = printItems ? printItems.reduce((s, i) => s + Math.max(1, Math.min(MAX_COPIES, i.copies)), 0) : 0;

  const openEdit = (p: Product) => {
    setForm({
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, categoryId: p.categoryId ?? '',
      purchasePrice: p.purchasePrice, sellingPrice: p.sellingPrice, stockQuantity: p.stockQuantity,
      minimumStock: p.minimumStock, description: p.description ?? '', image: p.image ?? '', isActive: p.isActive,
    });
    setErrors({});
  };

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    const sku = form.sku.trim();
    const barcode = form.barcode.trim();
    const next: Record<string, string> = {};
    if (!name) next.name = t('requiredField');
    if (form.purchasePrice < 0 || form.sellingPrice < 0 || form.stockQuantity < 0 || form.minimumStock < 0) {
      next.prices = t('invalidAmount');
    }
    if (sku && products.some((p) => p.id !== form.id && p.sku.toLowerCase() === sku.toLowerCase())) next.sku = t('skuExists');
    if (barcode && products.some((p) => p.id !== form.id && p.barcode === barcode)) next.barcode = t('barcodeExists');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    const db = getDb();
    try {
      const meta = await syncMeta();
      const auth = useAppStore.getState().authUser;
      if (form.id) {
        const existing = await db.products.get(form.id);
        await db.products.update(form.id, {
          name, sku, barcode,
          categoryId: form.categoryId || undefined,
          purchasePrice: form.purchasePrice,
          sellingPrice: form.sellingPrice,
          minimumStock: form.minimumStock,
          description: form.description.trim() || undefined,
          image: form.image || undefined,
          isActive: form.isActive,
          updatedAt: Date.now(),
          version: (existing?.version ?? 1) + 1,
        });
        new AuditService().log({
          userId: auth?.id, username: auth?.displayName,
          action: 'UPDATE_PRODUCT', entity: 'Product', entityId: form.id,
          oldValue: { sellingPrice: existing?.sellingPrice, purchasePrice: existing?.purchasePrice },
          newValue: { sellingPrice: form.sellingPrice, purchasePrice: form.purchasePrice },
        }).catch(() => {});
        toastSuccess(t('updatedOk'));
      } else {
        const id = newId();
        await db.products.add({
          id, name, sku, barcode,
          categoryId: form.categoryId || undefined,
          purchasePrice: form.purchasePrice,
          sellingPrice: form.sellingPrice,
          stockQuantity: form.stockQuantity,
          minimumStock: form.minimumStock,
          description: form.description.trim() || undefined,
          image: form.image || undefined,
          isActive: form.isActive,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...meta,
        });
        if (form.stockQuantity > 0) {
          await db.inventoryTransactions.add({
            id: newId(), productId: id, type: 'STOCK_IN',
            quantity: form.stockQuantity, previousQuantity: 0, newQuantity: form.stockQuantity,
            reason: 'Initial stock', createdAt: Date.now(), createdBy: auth?.id ?? '',
          });
        }
        new AuditService().log({
          userId: auth?.id, username: auth?.displayName,
          action: 'CREATE_PRODUCT', entity: 'Product', entityId: id,
          newValue: { name, sellingPrice: form.sellingPrice, stockQuantity: form.stockQuantity },
        }).catch(() => {});
        toastSuccess(t('addedOk'));
      }
      setForm(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async () => {
    if (!deleteTarget) return;
    try {
      await getDb().products.update(deleteTarget.id, { isActive: false, updatedAt: Date.now() });
      const auth = useAppStore.getState().authUser;
      new AuditService().log({
        userId: auth?.id, username: auth?.displayName,
        action: 'DELETE_PRODUCT', entity: 'Product', entityId: deleteTarget.id,
        oldValue: { isActive: true }, newValue: { isActive: false },
      }).catch(() => {});
      toastSuccess(t('deletedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
    setDeleteTarget(null);
  };

  const reactivate = async (p: Product) => {
    try {
      await getDb().products.update(p.id, { isActive: true, updatedAt: Date.now() });
      toastSuccess(t('updatedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
  };

  const assignBarcode = async (p: Product) => {
    try {
      const db = getDb();
      const taken = new Set((await db.products.toArray()).map((x) => x.barcode).filter(Boolean));
      let code = generateBarcode();
      for (let i = 0; i < 5 && taken.has(code); i++) code = generateBarcode();
      await db.products.update(p.id, { barcode: code, updatedAt: Date.now() });
      toastSuccess(t('savedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
  };

  const copyBarcode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toastSuccess(`${t('copied')}: ${code}`);
  };

  const onImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const image = await compressImage(file);
      setForm((f) => (f ? { ...f, image } : f));
      setErrors((er) => ({ ...er, image: '' }));
    } catch {
      setErrors((er) => ({ ...er, image: t('imageProcessError') }));
    }
  };

  const exportRows = () => {
    const data = filtered.map((p) => ({
      [t('name')]: p.name,
      [t('sku')]: p.sku,
      [t('barcode')]: p.barcode,
      [t('category')]: (p.categoryId && categoryName.get(p.categoryId)) || t('uncategorized'),
      [t('purchasePrice')]: p.purchasePrice,
      [t('sellingPrice')]: p.sellingPrice,
      [t('stock')]: p.stockQuantity,
      [t('minimumStock')]: p.minimumStock,
      [t('status')]: p.isActive ? t('active') : t('inactive'),
      [t('description')]: p.description ?? '',
    }));
    exportToXlsx(data, `products-${new Date().toISOString().slice(0, 10)}.xlsx`, t('products'));
  };

  const filtersActive = !!term || categoryFilter !== 'ALL' || statusFilter !== 'ACTIVE' || lowOnly;
  const resetFilters = () => {
    setTerm('');
    setCategoryFilter('ALL');
    setStatusFilter('ACTIVE');
    setLowOnly(false);
    setPage(1);
  };

  return (
    <>
      <div className="no-print flex flex-col gap-5">
        <PageHeader
          icon="box"
          title={t('products')}
          subtitle={t('productsSubtitle')}
          actions={
            <>
              <Button variant="secondary" icon="download" onClick={exportRows}>{t('exportData')}</Button>
              {hasPermission('products.create') && <Button icon="plus" onClick={openCreate}>{t('addProduct')}</Button>}
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon="box" tone="brand" label={t('totalProducts')} value={String(stats.total)} />
          <StatCard icon="database" tone="info" label={t('inventoryValue')} value={formatMoney(stats.inventoryValue, currency)} />
          <StatCard icon="alert" tone={stats.low > 0 ? 'warn' : 'muted'} label={t('lowStockAlert')} value={String(stats.low)} />
          <StatCard icon="eye-off" tone="muted" label={t('inactiveStat')} value={String(stats.inactive)} />
        </div>

        <Card padded={false} className="overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <SearchInput
              value={term}
              onChange={(v) => { setTerm(v); setPage(1); }}
              placeholder={t('scanBarcode')}
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
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-auto min-w-28"
              aria-label={t('status')}
            >
              <option value="ALL">{t('all')}</option>
              <option value="ACTIVE">{t('active')}</option>
              <option value="INACTIVE">{t('inactive')}</option>
            </Select>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-auto min-w-40"
              aria-label={t('sortBy')}
            >
              {Object.entries(SORT_LABEL).map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
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
              {t('totalRecords', { count: filtered.length })}
            </span>
          </div>

          {/* Selection bar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand/8 px-3 py-2">
              <Badge tone="brand" icon="check">{t('selectedCount', { count: selectedIds.size })}</Badge>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>{t('clearSelection')}</Button>
                <Button size="sm" icon="print" onClick={() => openPrint(selectedProducts)}>{t('printLabels')}</Button>
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon="box"
              title={filtersActive ? t('noResults') : t('productsEmpty')}
              hint={filtersActive ? undefined : t('productsEmptyHint')}
              action={
                !filtersActive && hasPermission('products.create') ? (
                  <Button icon="plus" onClick={openCreate}>{t('addProduct')}</Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Cards — small screens */}
              <ul className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 md:hidden">
                {visible.map((p) => (
                  <li
                    key={p.id}
                    className={`rounded-lg border bg-surface-2 p-3 transition-colors ${
                      selectedIds.has(p.id) ? 'border-brand/50' : 'border-line'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Check
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        label={t('selectProduct')}
                      />
                      {p.image ? (
                        <img src={p.image} alt="" className="h-12 w-12 shrink-0 rounded-md border border-line bg-surface-3 object-contain" />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-surface-3 text-ink-muted">
                          <Icon name="image" size={18} strokeWidth={1.6} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => p.barcode && setDetailBarcode(p.barcode)}
                          className="block w-full truncate text-start text-[0.86rem] font-extrabold text-ink hover:text-brand"
                        >
                          {p.name}
                        </button>
                        <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
                          {p.barcode || p.sku}
                        </span>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={stockTone(p)}>{t('stock')}: {p.stockQuantity}</Badge>
                          {!p.isActive && <Badge tone="muted">{t('inactive')}</Badge>}
                          <span className="num ms-auto text-[0.86rem] font-black text-ink">
                            {formatMoney(p.sellingPrice, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                      <IconButton icon="eye" label={t('viewDetails')} size={30} onClick={() => p.barcode && setDetailBarcode(p.barcode)} />
                      {hasPermission('products.update') && (
                        <IconButton icon="edit" label={t('edit')} size={30} onClick={() => openEdit(p)} />
                      )}
                      <IconButton icon="print" label={t('printLabel')} size={30} onClick={() => openPrint([p])} />
                      {p.barcode ? (
                        <IconButton icon="copy" label={t('copyBarcode')} size={30} onClick={() => copyBarcode(p.barcode)} />
                      ) : (
                        hasPermission('products.update') && (
                          <IconButton icon="barcode" label={t('generateBarcode')} size={30} onClick={() => assignBarcode(p)} />
                        )
                      )}
                      <span className="ms-auto flex items-center gap-1">
                        {!p.isActive && hasPermission('products.update') && (
                          <IconButton icon="refresh" label={t('activateProduct')} size={30} onClick={() => reactivate(p)} />
                        )}
                        {p.isActive && hasPermission('products.delete') && (
                          <IconButton icon="trash" label={t('delete')} size={30} variant="danger" onClick={() => setDeleteTarget(p)} />
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Table — desktop */}
              <div className="hidden md:block">
                <Table
                  head={[
                    <Check checked={allFilteredSelected} onChange={toggleSelectAll} label={t('selectAll')} key="all" />,
                    t('product'),
                    t('category'),
                    t('sellingPrice'),
                    t('stock'),
                    t('status'),
                    '',
                  ]}
                >
                  {visible.map((p) => (
                    <Row key={p.id}>
                      <Td>
                        <Check checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} label={t('selectProduct')} />
                      </Td>
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
                            <button
                              type="button"
                              onClick={() => p.barcode && setDetailBarcode(p.barcode)}
                              className="block max-w-64 truncate text-start text-[0.85rem] font-extrabold text-ink hover:text-brand"
                            >
                              {p.name}
                            </button>
                            {p.barcode ? (
                              <span className="flex items-center gap-1">
                                <span className="mono block max-w-44 truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
                                  {p.barcode}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyBarcode(p.barcode)}
                                  aria-label={t('copyBarcode')}
                                  title={t('copyBarcode')}
                                  className="text-ink-muted transition-colors hover:text-brand"
                                >
                                  <Icon name="copy" size={11} />
                                </button>
                              </span>
                            ) : (
                              hasPermission('products.update') && (
                                <button
                                  type="button"
                                  onClick={() => assignBarcode(p)}
                                  className="flex items-center gap-1 text-[0.68rem] font-bold text-warn hover:text-brand"
                                >
                                  <Icon name="barcode" size={11} /> {t('generateBarcode')}
                                </button>
                              )
                            )}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="block max-w-40 truncate text-[0.78rem] font-bold text-ink-2">
                          {(p.categoryId && categoryName.get(p.categoryId)) || <span className="text-ink-muted">{t('uncategorized')}</span>}
                        </span>
                      </Td>
                      <Td>
                        <span className="num block font-black text-ink">{formatMoney(p.sellingPrice, currency)}</span>
                        <span className="num block text-[0.68rem] font-semibold text-ink-muted">
                          {formatMoney(p.purchasePrice, currency)}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <Badge tone={stockTone(p)}>{p.stockQuantity}</Badge>
                          <span className="num text-[0.68rem] font-semibold text-ink-muted">/ {p.minimumStock}</span>
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={p.isActive ? 'ok' : 'muted'}>{p.isActive ? t('active') : t('inactive')}</Badge>
                      </Td>
                      <Td className="text-end">
                        <span className="flex items-center justify-end gap-1">
                          <IconButton icon="eye" label={t('viewDetails')} size={30} onClick={() => p.barcode && setDetailBarcode(p.barcode)} />
                          {hasPermission('products.update') && (
                            <IconButton icon="edit" label={t('edit')} size={30} onClick={() => openEdit(p)} />
                          )}
                          <IconButton icon="print" label={t('printLabel')} size={30} onClick={() => openPrint([p])} />
                          {!p.isActive && hasPermission('products.update') && (
                            <IconButton icon="refresh" label={t('activateProduct')} size={30} onClick={() => reactivate(p)} />
                          )}
                          {p.isActive && hasPermission('products.delete') && (
                            <IconButton icon="trash" label={t('delete')} size={30} variant="danger" onClick={() => setDeleteTarget(p)} />
                          )}
                        </span>
                      </Td>
                    </Row>
                  ))}
                </Table>
              </div>
            </>
          )}

          <Pagination page={current} pages={pages} total={filtered.length} onPage={setPage} />
        </Card>
      </div>

      {/* Real print root — label sheet 3cm x 2cm */}
      <div className="print-only">
        <div className="print-area">
          <div className="label-sheet">
            {expandedLabels.map((p, i) => (
              <LabelCell key={i} p={p} price={formatMoney(p.sellingPrice, currency)} />
            ))}
          </div>
        </div>
      </div>

      {/* Product form */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('editProduct') : t('addProduct')}
        subtitle={t('products')}
        icon="box"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button>
            <Button icon="save" loading={saving} onClick={save}>{t('save')}</Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('name')} required error={errors.name} className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
                maxLength={120}
              />
            </Field>

            <Field label={t('sku')} error={errors.sku}>
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="mono"
                dir="ltr"
                maxLength={40}
              />
            </Field>

            <Field label={t('category')}>
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t('uncategorized')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>

            <Field label={t('barcode')} error={errors.barcode} className="sm:col-span-2">
              <span className="flex flex-wrap items-center gap-2">
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="mono min-w-40 flex-1"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={32}
                />
                <Button type="button" variant="secondary" icon="scan" onClick={() => setScanOpen(true)}>
                  {t('scanCode')}
                </Button>
                <BarcodeGenerateButton onGenerated={(c) => setForm((f) => (f ? { ...f, barcode: c } : f))} />
              </span>
            </Field>

            {form.barcode.trim() && (
              <div className="flex justify-center rounded-lg border border-line bg-surface-2 p-2 sm:col-span-2">
                <BarcodeSVG value={form.barcode.trim()} height={44} />
              </div>
            )}

            <Field label={t('purchasePrice')} error={errors.prices}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={numValue(form.purchasePrice)}
                onChange={(e) => setForm({ ...form, purchasePrice: numChange(e.target.value) })}
                className="num"
                dir="ltr"
              />
            </Field>

            <Field label={t('sellingPrice')}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={numValue(form.sellingPrice)}
                onChange={(e) => setForm({ ...form, sellingPrice: numChange(e.target.value) })}
                className="num"
                dir="ltr"
              />
            </Field>

            {form.id ? (
              <Field label={t('stock')} hint={t('stockViaInventory')}>
                <Input value={String(form.stockQuantity)} readOnly className="num" dir="ltr" />
              </Field>
            ) : (
              <Field label={t('quantity')}>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={numValue(form.stockQuantity)}
                  onChange={(e) => setForm({ ...form, stockQuantity: numChange(e.target.value) })}
                  className="num"
                  dir="ltr"
                />
              </Field>
            )}

            <Field label={t('minimumStock')}>
              <Input
                type="number"
                min={0}
                step="1"
                value={numValue(form.minimumStock)}
                onChange={(e) => setForm({ ...form, minimumStock: numChange(e.target.value) })}
                className="num"
                dir="ltr"
              />
            </Field>

            <Field label={t('description')} className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={500}
              />
            </Field>

            <Field label={t('image')} hint={t('productImageHint')} error={errors.image} className="sm:col-span-2">
              <span className="flex flex-wrap items-center gap-3">
                {form.image ? (
                  <img src={form.image} alt="" className="h-20 w-28 rounded-md border border-line bg-surface-3 object-contain" />
                ) : (
                  <span className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-line-strong bg-surface-2 text-ink-muted">
                    <Icon name="image" size={22} strokeWidth={1.6} />
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                    {t('chooseImage')}
                  </Button>
                  {form.image && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      icon="trash"
                      onClick={() => setForm((f) => (f ? { ...f, image: '' } : f))}
                    >
                      {t('removeImage')}
                    </Button>
                  )}
                </span>
              </span>
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 sm:col-span-2">
              <div className="min-w-0">
                <p className="text-[0.82rem] font-bold text-ink">{t('status')}</p>
                <p className="text-[0.7rem] font-semibold text-ink-muted">
                  {form.isActive ? t('active') : t('inactive')}
                </p>
              </div>
              <Toggle
                checked={form.isActive}
                onChange={(v) => setForm((f) => (f ? { ...f, isActive: v } : f))}
                label={t('status')}
              />
            </div>

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImagePick} />
          </div>
        )}
      </Modal>

      {/* Label sheet printing */}
      <Modal
        open={!!printItems}
        onClose={() => setPrintItems(null)}
        title={t('printLabelsTitle')}
        subtitle={t('labelsCount', { count: totalLabels })}
        icon="print"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setPrintItems(null)}>{t('cancel')}</Button>
            <Button icon="print" disabled={totalLabels === 0} onClick={() => window.print()}>
              {t('print')} ({totalLabels})
            </Button>
          </>
        }
      >
        {printItems && (
          <div className="space-y-4">
            <ul className="scroll-y max-h-44 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {printItems.map((it) => (
                <li key={it.product.id} className="flex items-center gap-3 bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] font-bold text-ink">{it.product.name}</span>
                    <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
                      {it.product.barcode || it.product.sku}
                    </span>
                  </span>
                  <span className="num hidden shrink-0 text-[0.76rem] font-black text-ink sm:block">
                    {formatMoney(it.product.sellingPrice, currency)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[0.72rem] font-bold text-ink-2">
                    {t('copies')}
                    <Input
                      type="number"
                      min={1}
                      max={MAX_COPIES}
                      value={it.copies}
                      onChange={(e) =>
                        setPrintItems((list) =>
                          list?.map((x) =>
                            x.product.id === it.product.id
                              ? { ...x, copies: Math.max(1, Math.min(MAX_COPIES, numChange(e.target.value) || 1)) }
                              : x,
                          ) ?? null,
                        )
                      }
                      className="num w-16 px-2 text-center"
                      dir="ltr"
                    />
                  </span>
                  <IconButton
                    icon="x"
                    label={t('delete')}
                    size={28}
                    onClick={() =>
                      setPrintItems((list) => {
                        const next = list?.filter((x) => x.product.id !== it.product.id) ?? [];
                        return next.length > 0 ? next : null;
                      })
                    }
                  />
                </li>
              ))}
            </ul>

            <div>
              <p className="mb-2 text-center text-[0.72rem] font-semibold text-ink-muted">{t('previewNote')}</p>
              <div className="scroll-y max-h-72 overflow-x-auto rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
                <div className="label-sheet">
                  {expandedLabels.slice(0, PREVIEW_LIMIT).map((p, i) => (
                    <LabelCell key={i} p={p} price={formatMoney(p.sellingPrice, currency)} />
                  ))}
                </div>
                {expandedLabels.length > PREVIEW_LIMIT && (
                  <p className="num mt-2 text-center text-[0.72rem] font-bold text-warn">
                    {t('moreLabels', { count: expandedLabels.length - PREVIEW_LIMIT })}
                  </p>
                )}
              </div>
              <p className="mt-2 text-center text-[0.7rem] font-semibold text-ink-muted">{t('printTip')}</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={t('scanCode')} icon="scan">
        {scanOpen && (
          <ScannerSelector
            isDesktop={isDesktop}
            onDetected={(v) => {
              setScanOpen(false);
              setForm((f) => (f ? { ...f, barcode: v.trim() } : f));
            }}
            onClose={() => setScanOpen(false)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeProduct}
        title={t('confirmDeleteProduct')}
        message={
          <span>
            <b>{deleteTarget?.name}</b> — {t('deleteProductHint')}
          </span>
        }
        confirmLabel={t('delete')}
      />

      <ProductDetailModal
        open={!!detailBarcode}
        onClose={() => setDetailBarcode(null)}
        barcode={detailBarcode}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${
        checked
          ? 'border-brand bg-brand text-brand-contrast'
          : 'border-line-strong bg-surface-2 text-transparent hover:border-brand/50'
      }`}
    >
      <Icon name="check" size={12} strokeWidth={3} />
    </button>
  );
}

function LabelCell({ p, price }: { p: Product; price: string }) {
  return (
    <div className="label-cell" style={{ border: '0.25pt solid currentColor' }}>
      <span className="block w-full truncate text-center" style={{ fontSize: '6.5pt', fontWeight: 700, lineHeight: '7.5pt' }}>
        {p.name}
      </span>
      <MiniBarcode value={p.barcode} />
      <span className="mono block" style={{ fontSize: '5pt', letterSpacing: '0.3pt', marginTop: '0.4mm' }} dir="ltr">
        {p.barcode}
      </span>
      <span className="block" style={{ fontSize: '6pt', fontWeight: 700, marginTop: '0.3mm' }}>
        {price}
      </span>
    </div>
  );
}
