import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Button, EmptyState, Field, IconButton, Input, Modal, SearchInput, Select } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PaperFit } from '@/components/common/PaperFit';
import { ScannerSelector } from '@/components/barcode/ScannerSelector';
import { InvoicePrint } from '@/components/sales/InvoicePrint';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess, toastWarning } from '@/app/store/toast.store';
import { SaleService, type CartLine } from '@/services/sales/sale.service';
import { calculateInstallmentPlan, type PlanCalculation } from '@/services/installments/calculator';
import { formatDate, formatMoney, round2 } from '@/utils/format';
import type { Category, Customer, PaymentMethod, Product, SaleType } from '@/types';

const INSTALLMENT_OPTIONS = [3, 6, 9, 12, 18, 24, 36];
const GRID_LIMIT = 60;

/* Same print contract as SalesPage: only the invoice ids reach the paper */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden !important; }
  #invoice-a4, #invoice-a4 *, #invoice-8x11, #invoice-8x11 * { visibility: visible !important; }
  #invoice-a4 { position: absolute !important; left: 50% !important; top: 0 !important; transform: translateX(-50%) !important; width: 210mm !important; min-height: 297mm !important; box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  #invoice-8x11 { position: absolute !important; left: 50% !important; top: 0 !important; transform: translateX(-50%) !important; width: 80mm !important; height: 110mm !important; min-height: 110mm !important; max-height: 110mm !important; overflow: hidden !important; box-sizing: border-box !important; border: 0.3mm solid #000 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

function numChange(v: string): number {
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function PosPage() {
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);
  const authUser = useAppStore((s) => s.authUser);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('ALL');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountS, setDiscountS] = useState('');
  const [saleType, setSaleType] = useState<SaleType>('CASH');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerModal, setCustomerModal] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [invoice, setInvoice] = useState<{ saleId: string; type: SaleType } | null>(null);
  const [invoicePaper, setInvoicePaper] = useState<'A4' | '8x11'>('A4');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [receivedS, setReceivedS] = useState('');
  const [downS, setDownS] = useState('');
  const [numInstallments, setNumInstallments] = useState(12);
  const [firstDue, setFirstDue] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));

  const barcodeRef = useRef<HTMLInputElement>(null);

  const isDesktop =
    typeof window !== 'undefined' && !!(window as unknown as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;

  const products = useLiveQuery(() => getDb().products.filter((p) => p.isActive).toArray(), [], [] as Product[]);
  const categories = useLiveQuery(() => getDb().categories.orderBy('name').toArray(), [], [] as Category[]);
  const customers = useLiveQuery(() => getDb().customers.toArray(), [], [] as Customer[]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /* drop a category filter whose category was deleted */
  useEffect(() => {
    if (categoryId !== 'ALL' && !categories.some((c) => c.id === categoryId)) setCategoryId('ALL');
  }, [categories, categoryId]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inCategory = (p: Product) => categoryId === 'ALL' || p.categoryId === categoryId;
    if (!q) return products.filter(inCategory).slice(0, GRID_LIMIT);
    return products
      .filter(
        (p) =>
          inCategory(p) &&
          (p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.barcode.toLowerCase().includes(q)),
      )
      .slice(0, GRID_LIMIT);
  }, [products, search, categoryId]);

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.fullName.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || c.customerNumber.toLowerCase().includes(q),
    );
  }, [customers, custSearch]);

  /* ---------------- money ---------------- */
  const subtotal = useMemo(() => round2(cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0)), [cart]);
  const totalQty = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart]);
  const discount = numChange(discountS);
  const discountError = discount > subtotal ? t('discountTooBig') : '';
  const total = round2(subtotal - discount);

  const received = receivedS === '' ? total : numChange(receivedS);
  const receivedError = receivedS !== '' && received < total ? t('cashInsufficient') : '';
  const changeDue = receivedS === '' ? 0 : round2(received - total);

  const downNum = numChange(downS);
  const firstDueTs = useMemo(() => (firstDue ? new Date(firstDue).getTime() : NaN), [firstDue]);

  /* Schedule preview — computed by the SERVICE calculator so it always matches the contract */
  const plan: PlanCalculation | null = useMemo(() => {
    if (saleType !== 'INSTALLMENT' || cart.length === 0 || discountError) return null;
    if (!Number.isFinite(firstDueTs)) return null;
    try {
      return calculateInstallmentPlan(total, downNum, numInstallments, firstDueTs, 'MONTHLY');
    } catch {
      return null;
    }
  }, [saleType, cart.length, discountError, total, downNum, numInstallments, firstDueTs]);

  const installmentError =
    saleType === 'INSTALLMENT' && cart.length === 0
      ? ''
      : saleType === 'INSTALLMENT' && !plan
        ? downNum > total
          ? t('downPaymentExceeds')
          : discountError || t('invalidAmount')
        : '';

  /* ---------------- cart ---------------- */
  const addToCart = useCallback(
    (p: Product) => {
      if (p.stockQuantity <= 0) {
        toastError(`${t('outOfStock')}: ${p.name}`);
        return;
      }
      /* one line per product: the quantity is changed from the cart */
      if (cart.some((l) => l.productId === p.id)) {
        toastWarning(`${t('alreadyInCart')}: ${p.name}`);
        return;
      }
      setCart((prev) => [...prev, { productId: p.id, name: p.name, quantity: 1, unitPrice: p.sellingPrice }]);
      setSearch('');
      setFormError('');
    },
    [cart, t],
  );

  const updateQty = useCallback(
    (productId: string, qty: number) => {
      if (qty <= 0) {
        setCart((c) => c.filter((l) => l.productId !== productId));
        return;
      }
      const p = productMap.get(productId);
      if (p && qty > p.stockQuantity) {
        toastError(t('stockLimitReached', { count: p.stockQuantity }));
        return;
      }
      setCart((c) => c.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l)));
    },
    [productMap, t],
  );

  /* Scan / search entry: exact barcode or SKU first, then name matches */
  const handleCode = useCallback(
    (code: string) => {
      const q = code.trim();
      if (!q) return;
      const lower = q.toLowerCase();
      const exact = products.find((p) => p.barcode === q || p.sku.toLowerCase() === lower);
      if (exact) { addToCart(exact); return; }
      const matches = products.filter(
        (p) => p.name.toLowerCase().includes(lower) || p.sku.toLowerCase().includes(lower) || p.barcode.includes(q),
      );
      if (matches.length === 1) { addToCart(matches[0]); return; }
      if (matches.length === 0 && /^[A-Za-z0-9-]{6,}$/.test(q)) {
        toastError(t('productNotFoundBarcode'));
        setSearch(q);
      }
    },
    [products, addToCart, t],
  );

  /* Desktop + web: scans arriving from the phone scanner over socket.io */
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    import('@/services/sync/scan.service').then((m) => {
      if (cancelled) return;
      off = m.onScan((code) => {
        toastSuccess(`${t('remoteScanReceived')}: ${code}`);
        try { navigator.vibrate?.(60); } catch {}
        handleCode(code);
        barcodeRef.current?.focus();
      });
    });
    return () => {
      cancelled = true;
      if (off) off();
    };
  }, [handleCode, t]);

  /* ---------------- completion ---------------- */
  const mapSaleError = useCallback(
    (e: unknown): string => {
      const msg = e instanceof Error ? e.message : '';
      if (msg.startsWith('INSUFFICIENT_STOCK')) return `${t('outOfStock')}: ${msg.split(':')[1] ?? ''}`;
      if (msg.startsWith('PRODUCT_NOT_FOUND')) return t('productNotFoundBarcode');
      if (msg === 'CASH_INSUFFICIENT_PAYMENT') return t('cashInsufficient');
      if (msg === 'INVALID_DISCOUNT') return t('discountTooBig');
      if (msg === 'DOWN_PAYMENT_EXCEEDS_TOTAL') return t('downPaymentExceeds');
      if (msg === 'EMPTY_CART') return t('emptyCart');
      if (msg === 'CUSTOMER_REQUIRED_FOR_INSTALLMENT') return t('customerRequiredInstallment');
      return t('errorGeneric');
    },
    [t],
  );

  const resetAll = useCallback(() => {
    setCart([]);
    setDiscountS('');
    setReceivedS('');
    setDownS('');
    setCustomer(null);
    setSaleType('CASH');
    setFormError('');
    setCheckoutOpen(false);
  }, []);

  const completeCash = useCallback(async () => {
    if (cart.length === 0 || !authUser || saving) return;
    if (discountError) { setFormError(discountError); return; }
    if (received < total) { setFormError(t('cashInsufficient')); return; }
    setSaving(true);
    setFormError('');
    try {
      const sale = await new SaleService().createSale({
        cart,
        discount,
        saleType: 'CASH',
        customerId: customer?.id,
        /* record exactly the total: the surplus is physical change handed back,
           never a negative remaining balance on the sale */
        paidAmount: total,
        paymentMethod: 'CASH' as PaymentMethod,
        userId: authUser.id,
      });
      toastSuccess(`${t('saleCompleted')} — ${formatMoney(total, currency, locale)}`);
      resetAll();
      setInvoice({ saleId: sale.id, type: sale.saleType });
      setInvoicePaper('A4');
    } catch (e) {
      console.error(e);
      const msg = mapSaleError(e);
      setFormError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }, [cart, authUser, saving, discountError, discount, received, total, customer, currency, locale, t, resetAll, mapSaleError]);

  const completeInstallment = useCallback(async () => {
    if (!plan || cart.length === 0 || !authUser || saving) return;
    if (!customer) {
      setFormError(t('customerRequiredInstallment'));
      toastError(t('customerRequiredInstallment'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const sale = await new SaleService().createSale({
        cart,
        discount,
        saleType: 'INSTALLMENT',
        customerId: customer?.id,
        paidAmount: 0,
        paymentMethod: 'CASH' as PaymentMethod,
        installmentConfig: {
          downPayment: downNum,
          numberOfInstallments: numInstallments,
          firstDueDate: firstDueTs,
        },
        userId: authUser.id,
      });
      toastSuccess(`${t('saleCompleted')} — ${formatMoney(total, currency, locale)}`);
      resetAll();
      setInvoice({ saleId: sale.id, type: sale.saleType });
      setInvoicePaper('A4');
    } catch (e) {
      console.error(e);
      const msg = mapSaleError(e);
      setFormError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }, [plan, cart, authUser, saving, discount, customer, downNum, numInstallments, firstDueTs, total, currency, locale, t, resetAll, mapSaleError]);

  /* Keyboard shortcuts: F8 checkout · Esc close */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0) setCheckoutOpen(true);
      } else if (e.key === 'Escape') {
        setCustomerModal(false);
        setCheckoutOpen(false);
        setScannerOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart.length]);

  /* ---------------- cart panel (desktop column and mobile inline block) ---------------- */
  const cartPanel = () => (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <h2 className="flex items-center gap-2 text-[0.98rem] font-extrabold text-ink">
          <Icon name="cart" size={17} className="text-brand" />
          {t('cart')} <span className="num text-ink-muted">({totalQty})</span>
        </h2>
        {cart.length > 0 && (
          <button
            type="button"
            onClick={() => { setCart([]); setFormError(''); }}
            className="text-[0.76rem] font-bold text-danger transition-opacity hover:opacity-75"
          >
            {t('clearCart')}
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-y px-3 py-2">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-12 text-center text-ink-muted">
            <Icon name="cart" size={38} strokeWidth={1.5} className="opacity-30" />
            <p className="text-[0.86rem] font-bold text-ink-2">{t('emptyCart')}</p>
            <p className="text-[0.72rem] font-semibold">{t('cartEmptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {cart.map((l) => {
              const p = productMap.get(l.productId);
              const atLimit = !!p && l.quantity >= p.stockQuantity;
              return (
                <li key={l.productId} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-extrabold text-ink">{l.name}</p>
                    <p className="num mt-0.5 text-[0.68rem] font-semibold text-ink-muted">
                      {formatMoney(l.unitPrice, currency)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton icon="minus" size={26} label={t('removeLine')} onClick={() => updateQty(l.productId, l.quantity - 1)} />
                    <input
                      type="number"
                      min={1}
                      max={p?.stockQuantity}
                      value={l.quantity}
                      dir="ltr"
                      inputMode="numeric"
                      aria-label={t('quantity')}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') return;
                        const n = Math.floor(Number(v));
                        if (Number.isFinite(n) && n >= 0) updateQty(l.productId, n);
                      }}
                      className="num h-7 w-10 rounded-md border border-line bg-surface-2 text-center text-[0.8rem] font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                    <IconButton
                      icon="plus"
                      size={26}
                      label="+"
                      className={atLimit ? 'opacity-45' : ''}
                      onClick={() => updateQty(l.productId, l.quantity + 1)}
                    />
                  </div>
                  <span className="num shrink-0 whitespace-nowrap text-end text-[0.8rem] font-black text-ink">
                    {formatMoney(round2(l.quantity * l.unitPrice), currency)}
                  </span>
                  <IconButton
                    icon="trash"
                    variant="danger"
                    size={26}
                    label={t('removeLine')}
                    onClick={() => updateQty(l.productId, 0)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex items-center justify-between text-[0.78rem] font-semibold text-ink-2">
          <span>{t('subtotal')}</span>
          <span className="num font-bold text-ink">{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[0.78rem] font-semibold text-ink-2">
          <span>{t('discount')}</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            inputMode="decimal"
            className="num h-8 w-24 text-end"
            value={discountS}
            placeholder="0"
            onChange={(e) => { setDiscountS(e.target.value); setFormError(''); }}
          />
        </div>
        {discountError && (
          <p className="flex items-center gap-1 text-[0.72rem] font-bold text-danger">
            <Icon name="alert" size={12} /> {discountError}
          </p>
        )}
        <div className="flex items-center justify-between border-t border-line pt-2">
          <span className="text-[0.9rem] font-black text-ink">{t('total')}</span>
          <span className="num text-[1.18rem] font-black text-brand">{formatMoney(total, currency)}</span>
        </div>
        <Button
          size="lg"
          variant="success"
          icon="check"
          className="w-full"
          disabled={cart.length === 0}
          onClick={() => { setFormError(''); setReceivedS(''); setCheckoutOpen(true); }}
        >
          {t('completeSale')}
        </Button>
      </div>
    </>
  );

  /* ---------------- render ---------------- */
  return (
    <>
      <div className="no-print grid h-[calc(100dvh-11.5rem)] grid-rows-[minmax(0,1fr)_auto] gap-3 sm:h-[calc(100dvh-12.5rem)] lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1">
        {/* Catalog: barcode + search, categories, products */}
        <section className="panel flex min-h-0 flex-col overflow-hidden rounded-lg border border-line shadow-1">
          <div className="flex flex-col gap-2.5 border-b border-line p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-brand">
                  <Icon name="scan" size={15} />
                </span>
                <input
                  ref={barcodeRef}
                  value={barcode}
                  autoFocus
                  dir="ltr"
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    handleCode(barcode);
                    setBarcode('');
                  }}
                  placeholder={t('barcodePlaceholder')}
                  className="h-9.5 w-full rounded-md border-2 border-brand/45 bg-brand/5 ps-9 pe-24 text-[0.85rem] font-semibold text-ink outline-none transition-all placeholder:font-medium placeholder:text-ink-muted focus:border-brand focus:ring-4 focus:ring-brand/15"
                />
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="absolute inset-y-1 end-1 inline-flex items-center gap-1 rounded bg-brand px-2.5 text-[0.72rem] font-bold text-brand-contrast transition-colors hover:bg-brand-hover"
                >
                  <Icon name="scan" size={13} />
                  <span className="hidden sm:inline">{t('scannerCamera')}</span>
                </button>
              </div>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t('searchProductsPlaceholder')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCode(search); }}
              />
            </div>

            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-0.5">
              {[{ id: 'ALL', name: t('all') }, ...categories].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-bold transition-all duration-150 ${
                    categoryId === c.id
                      ? 'border-brand bg-brand text-brand-contrast shadow-brand'
                      : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-y p-3">
            {visibleProducts.length === 0 ? (
              <EmptyState
                icon={search ? 'search' : 'box'}
                title={search ? t('noResults') : t('noData')}
                hint={search ? undefined : t('cartEmptyHint')}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {visibleProducts.map((p) => {
                  const soldOut = p.stockQuantity <= 0;
                  const low = p.stockQuantity > 0 && p.stockQuantity <= p.minimumStock;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={soldOut}
                      onClick={() => addToCart(p)}
                      className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface-2 p-2.5 text-center transition-all duration-150 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
                    >
                      {p.image ? (
                        <img src={p.image} alt="" className="h-16 w-full rounded-md border border-line bg-surface-3 object-contain" />
                      ) : (
                        <span className="grid h-16 w-full place-items-center rounded-md bg-surface-3 text-ink-muted">
                          <Icon name="image" size={22} strokeWidth={1.6} />
                        </span>
                      )}
                      <span className="line-clamp-2 min-h-9 text-[0.78rem] font-bold leading-tight text-ink">{p.name}</span>
                      <span className="num text-[0.92rem] font-black text-ok">{formatMoney(p.sellingPrice, currency)}</span>
                      <span
                        className={`num rounded-full px-2 py-0.5 text-[0.64rem] font-bold ${
                          soldOut ? 'bg-danger/12 text-danger' : low ? 'bg-warn/12 text-warn' : 'bg-surface-3 text-ink-muted'
                        }`}
                      >
                        {soldOut ? t('outOfStock') : `${t('stock')}: ${p.stockQuantity}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cart (desktop) */}
        <section className="panel hidden min-h-0 flex-col overflow-hidden rounded-lg border border-line shadow-1 lg:flex">
          {cartPanel()}
        </section>

        {/* Cart (phone) — always on the page: a slim strip while empty, the full cart once it has lines */}
        <section className={`panel flex min-h-0 flex-col overflow-hidden rounded-lg border border-line shadow-1 lg:hidden ${cart.length === 0 ? '' : 'max-h-[50dvh]'}`}>
          {cart.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex shrink-0 items-center gap-2 text-[0.86rem] font-extrabold text-ink">
                <Icon name="cart" size={16} className="text-brand" />
                {t('cart')} <span className="num text-ink-muted">(0)</span>
              </span>
              <span className="truncate text-[0.72rem] font-semibold text-ink-muted">{t('cartEmptyHint')}</span>
            </div>
          ) : (
            cartPanel()
          )}
        </section>
      </div>

      {/* Checkout: payment method + customer + installment plan */}
      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title={t('completeSale')}
        subtitle={`${totalQty} × ${t('products')} · ${formatMoney(total, currency)}`}
        icon="wallet"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>{t('cancel')}</Button>
            {saleType === 'CASH' ? (
              <Button
                variant="success"
                icon="check"
                loading={saving}
                disabled={cart.length === 0 || !!discountError || !!receivedError}
                onClick={completeCash}
              >
                {t('completeSale')} — {formatMoney(total, currency)}
              </Button>
            ) : (
              <Button
                icon="check"
                loading={saving}
                disabled={!plan || !customer}
                onClick={completeInstallment}
              >
                {t('completeSale')} — {formatMoney(total, currency)}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-[0.78rem] font-bold text-ink-2">{t('paymentMethod')}</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1">
              {(['CASH', 'INSTALLMENT'] as SaleType[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setSaleType(st);
                    setFormError('');
                    if (st === 'CASH') setCustomer(null);
                  }}
                  className={`flex h-9.5 items-center justify-center gap-2 rounded-md text-[0.8rem] font-extrabold transition-all duration-150 ${
                    saleType === st ? 'bg-brand text-brand-contrast shadow-brand' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon name={st === 'CASH' ? 'banknote' : 'calendar'} size={15} />
                  {st === 'CASH' ? t('cashSale') : t('installmentSale')}
                </button>
              ))}
            </div>
          </div>

          {saleType === 'CASH' ? (
            <>
              <Field label={t('receivedAmount')} error={receivedError}>
                <span className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    inputMode="decimal"
                    className="num flex-1"
                    value={receivedS}
                    placeholder={formatMoney(total, currency)}
                    onChange={(e) => { setReceivedS(e.target.value); setFormError(''); }}
                  />
                  <Button variant="secondary" className="shrink-0" onClick={() => setReceivedS(String(total))}>
                    {t('exactAmount')}
                  </Button>
                </span>
              </Field>
              {changeDue > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-ok/25 bg-ok/12 px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[0.78rem] font-bold text-ok">
                    <Icon name="banknote" size={14} /> {t('changeDue')}
                  </span>
                  <span className="num text-[0.95rem] font-black text-ok">{formatMoney(changeDue, currency)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setCustSearch(''); setCustomerModal(true); }}
                className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-start transition-colors hover:border-line-strong"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
                  <Icon name="user" size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.66rem] font-bold text-ink-muted">{t('customer')}</span>
                  <span className="block truncate text-[0.84rem] font-extrabold text-ink">
                    {customer ? customer.fullName : t('walkInCustomer')}
                  </span>
                </span>
                <Icon name="chevron-start" size={14} className="shrink-0 text-ink-muted" />
              </button>
              {!customer && (
                <p className="flex items-center gap-1 text-[0.72rem] font-bold text-warn">
                  <Icon name="alert" size={12} /> {t('customerRequiredInstallment')}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('downPayment')} error={downNum > total ? t('downPaymentExceeds') : undefined}>
                  <Input
                    type="number"
                    min={0}
                    max={total}
                    step="0.01"
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    value={downS}
                    placeholder="0.00"
                    onChange={(e) => setDownS(e.target.value)}
                  />
                </Field>
                <Field label={t('numberOfInstallments')}>
                  <Select value={String(numInstallments)} onChange={(e) => setNumInstallments(Number(e.target.value))}>
                    {INSTALLMENT_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('firstDueDate')} className="sm:col-span-2">
                  <Input type="date" dir="ltr" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <span className="flex-1 text-[0.78rem] font-semibold text-ink-2">
                  {t('financedAmount')}:{' '}
                  <b className="num text-ink">{plan ? formatMoney(plan.financedAmount, currency) : '—'}</b>
                </span>
                <span className="flex-1 text-[0.78rem] font-semibold text-ink-2">
                  {t('installmentAmount')}:{' '}
                  <b className="num text-brand">{plan ? formatMoney(plan.installmentAmount, currency) : '—'}</b>
                </span>
              </div>

              {installmentError && (
                <p className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-bold text-danger">
                  <Icon name="alert" size={13} /> {installmentError}
                </p>
              )}

              <div className="scroll-y max-h-56 overflow-y-auto rounded-lg border border-line">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-[1]">
                    <tr className="bg-surface-2">
                      <th className="border-b border-line px-3 py-2 text-start text-[0.68rem] font-extrabold uppercase tracking-wide text-ink-muted">#</th>
                      <th className="border-b border-line px-3 py-2 text-start text-[0.68rem] font-extrabold uppercase tracking-wide text-ink-muted">{t('dueDate')}</th>
                      <th className="border-b border-line px-3 py-2 text-end text-[0.68rem] font-extrabold uppercase tracking-wide text-ink-muted">{t('amountDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plan?.drafts ?? []).map((d) => (
                      <tr key={d.installmentNumber} className="transition-colors hover:bg-surface-2/70">
                        <td className="num border-b border-line/70 px-3 py-2 text-[0.8rem] font-bold text-ink-muted">{d.installmentNumber}</td>
                        <td className="num border-b border-line/70 px-3 py-2 text-[0.8rem] font-semibold text-ink">{formatDate(d.dueDate)}</td>
                        <td className="num border-b border-line/70 px-3 py-2 text-end text-[0.8rem] font-black text-ink">{formatMoney(d.amountDue, currency)}</td>
                      </tr>
                    ))}
                    {!plan && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-[0.8rem] font-semibold text-ink-muted">{t('noData')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {formError && (
            <p className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-bold text-danger">
              <Icon name="alert" size={13} /> {formError}
            </p>
          )}
        </div>
      </Modal>

      {/* Customer picker */}
      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title={t('selectCustomer')} icon="users">
        <SearchInput
          value={custSearch}
          onChange={setCustSearch}
          placeholder={t('searchCustomers')}
          className="mb-3"
        />
        <ul className="scroll-y max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          <li>
            <button
              type="button"
              onClick={() => { setCustomer(null); setCustomerModal(false); }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-[0.84rem] font-bold text-ink transition-colors hover:bg-surface-2"
            >
              <Icon name="user" size={15} className="text-ink-muted" />
              {t('walkInCustomer')}
              {!customer && <Icon name="check" size={14} className="ms-auto text-brand" strokeWidth={2.4} />}
            </button>
          </li>
          {filteredCustomers.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { setCustomer(c); setCustomerModal(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84rem] font-extrabold text-ink">{c.fullName}</span>
                  <span className="mono block truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">
                    {c.customerNumber}{c.phone ? ` · ${c.phone}` : ''}
                  </span>
                </span>
                {customer?.id === c.id && <Icon name="check" size={14} className="shrink-0 text-brand" strokeWidth={2.4} />}
              </button>
            </li>
          ))}
          {filteredCustomers.length === 0 && (
            <li className="px-3 py-6 text-center text-[0.8rem] font-semibold text-ink-muted">{t('noResults')}</li>
          )}
        </ul>
      </Modal>

      {/* Scanner source picker */}
      <Modal open={scannerOpen} onClose={() => setScannerOpen(false)} title={t('openScanner')} icon="scan">
        <ScannerSelector
          isDesktop={isDesktop}
          onDetected={(v) => { setScannerOpen(false); handleCode(v); }}
          onClose={() => setScannerOpen(false)}
        />
      </Modal>

      {/* Invoice after sale */}
      <Modal
        open={!!invoice}
        onClose={() => setInvoice(null)}
        title={t('invoiceModalTitle')}
        subtitle={invoicePaper === 'A4' ? t('paperA4') : t('paper8x11')}
        icon="receipt"
        wide
        footer={
          <>
            {invoice?.type === 'INSTALLMENT' && (
              <Button
                variant="secondary"
                icon="file"
                onClick={() => {
                  const id = invoice.saleId;
                  setInvoice(null);
                  navigate(`/contracts/${id}`);
                }}
              >
                {t('viewContract')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setInvoice(null)}>{t('close')}</Button>
            <Button icon="print" onClick={() => window.print()}>{t('print')}</Button>
          </>
        }
      >
        {invoice && (
          <div className="flex flex-col gap-3">
            <div className="no-print flex flex-wrap gap-2">
              <Button variant={invoicePaper === 'A4' ? 'primary' : 'secondary'} size="sm" onClick={() => setInvoicePaper('A4')}>
                {t('paperA4')}
              </Button>
              <Button variant={invoicePaper === '8x11' ? 'primary' : 'secondary'} size="sm" onClick={() => setInvoicePaper('8x11')}>
                {t('paper8x11')}
              </Button>
            </div>
            <div className="scroll-y flex max-h-[60vh] justify-start overflow-auto rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
              <PaperFit width={invoicePaper === 'A4' ? '210mm' : '80mm'}>
                <InvoicePrint saleId={invoice.saleId} paper={invoicePaper} />
              </PaperFit>
            </div>
          </div>
        )}
      </Modal>
      {invoice && <style>{PRINT_CSS}</style>}
    </>
  );
}
