import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, SearchInput, Select } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ScannerSelector } from '@/components/barcode/ScannerSelector';
import { InvoicePrint } from '@/components/sales/InvoicePrint';
import { DesktopSyncPanel, PhoneSyncBadge } from '@/components/sync/DesktopSyncPanel';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { SaleService, type CartLine } from '@/services/sales/sale.service';
import { calculateInstallmentPlan, type PlanCalculation } from '@/services/installments/calculator';
import { formatDate, formatMoney, round2 } from '@/utils/format';
import type { Customer, Frequency, PaymentMethod, Product, SaleType } from '@/types';

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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountS, setDiscountS] = useState('');
  const [saleType, setSaleType] = useState<SaleType>('CASH');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerModal, setCustomerModal] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [installmentModal, setInstallmentModal] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cartSheet, setCartSheet] = useState(false);
  const [invoice, setInvoice] = useState<{ saleId: string; type: SaleType } | null>(null);
  const [invoicePaper, setInvoicePaper] = useState<'A4' | '8x11'>('A4');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [lastRemoteScan, setLastRemoteScan] = useState<string | null>(null);

  const [receivedS, setReceivedS] = useState('');
  const [downS, setDownS] = useState('');
  const [numInstallments, setNumInstallments] = useState(12);
  const [firstDue, setFirstDue] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');

  const searchRef = useRef<HTMLInputElement>(null);

  const isDesktop =
    typeof window !== 'undefined' && !!(window as unknown as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;

  const products = useLiveQuery(() => getDb().products.filter((p) => p.isActive).toArray(), [], [] as Product[]);
  const customers = useLiveQuery(() => getDb().customers.toArray(), [], [] as Customer[]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, GRID_LIMIT);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q),
      )
      .slice(0, GRID_LIMIT);
  }, [products, search]);

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.fullName.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || c.customerNumber.toLowerCase().includes(q),
    );
  }, [customers, custSearch]);

  /* ---------------- money ---------------- */
  const subtotal = useMemo(() => round2(cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0)), [cart]);
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
      return calculateInstallmentPlan(total, downNum, numInstallments, firstDueTs, frequency);
    } catch {
      return null;
    }
  }, [saleType, cart.length, discountError, total, downNum, numInstallments, firstDueTs, frequency]);

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
    (p: Product, qty = 1) => {
      if (p.stockQuantity <= 0) {
        toastError(`${t('outOfStock')}: ${p.name}`);
        return;
      }
      const existing = cart.find((l) => l.productId === p.id);
      const next = (existing?.quantity ?? 0) + qty;
      if (next > p.stockQuantity) {
        toastError(t('stockLimitReached', { count: p.stockQuantity }));
        return;
      }
      if (existing) {
        setCart((prev) => prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + qty } : l)));
      } else {
        setCart((prev) => [...prev, { productId: p.id, name: p.name, quantity: qty, unitPrice: p.sellingPrice }]);
      }
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
    let flash: ReturnType<typeof setTimeout> | null = null;
    import('@/services/sync/scan.service').then((m) => {
      if (cancelled) return;
      off = m.onScan((barcode) => {
        setLastRemoteScan(barcode);
        toastSuccess(`${t('remoteScanReceived')}: ${barcode}`);
        try { navigator.vibrate?.(60); } catch {}
        searchRef.current?.focus();
        handleCode(barcode);
        if (flash) clearTimeout(flash);
        flash = setTimeout(() => setLastRemoteScan(null), 3000);
      });
    });
    return () => {
      cancelled = true;
      if (off) off();
      if (flash) clearTimeout(flash);
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
    setCartSheet(false);
    setInstallmentModal(false);
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
      setInstallmentModal(false);
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

  /* Keyboard shortcuts: F2 search · F4 customer · F8 complete · Esc close */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); setCustomerModal(true); }
      else if (e.key === 'F8') {
        e.preventDefault();
        if (saleType === 'CASH') completeCash();
        else if (plan) setInstallmentModal(true);
      } else if (e.key === 'Escape') {
        setCustomerModal(false);
        setInstallmentModal(false);
        setScannerOpen(false);
        setCartSheet(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saleType, completeCash, plan]);

  /* ---------------- shared fragments ---------------- */
  const cartRows = (
    <ul className="scroll-y max-h-[38vh] divide-y divide-line overflow-y-auto px-3 py-1 lg:max-h-80">
      {cart.map((l) => {
        const p = productMap.get(l.productId);
        const stock = p?.stockQuantity ?? l.quantity;
        const atLimit = l.quantity >= stock;
        return (
          <li key={l.productId} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.82rem] font-extrabold text-ink">{l.name}</p>
              <p className="num mt-0.5 text-[0.68rem] font-semibold text-ink-muted">
                {formatMoney(l.unitPrice, currency)} · {t('stock')}:{' '}
                <span className={atLimit ? 'font-black text-warn' : ''}>{stock}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton icon="minus" size={28} label="-" onClick={() => updateQty(l.productId, l.quantity - 1)} />
              <input
                type="number"
                min={1}
                max={stock}
                value={l.quantity}
                dir="ltr"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') return;
                  const n = Math.floor(Number(v));
                  if (Number.isFinite(n)) updateQty(l.productId, n);
                }}
                className="num h-8 w-11 rounded-md border border-line bg-surface-2 text-center text-[0.82rem] font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <IconButton icon="plus" size={28} label="+" className={atLimit ? 'opacity-45' : ''} onClick={() => updateQty(l.productId, l.quantity + 1)} />
            </div>
            <span className="num w-24 shrink-0 text-end text-[0.84rem] font-black text-ink">
              {formatMoney(round2(l.quantity * l.unitPrice), currency)}
            </span>
            <IconButton icon="trash" variant="danger" size={28} label={t('removeLine')} onClick={() => updateQty(l.productId, 0)} />
          </li>
        );
      })}
    </ul>
  );

  const checkout = (
    <div className="flex flex-col gap-3">
      {/* customer */}
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

      {/* sale type */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1">
        {(['CASH', 'INSTALLMENT'] as SaleType[]).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => { setSaleType(st); setFormError(''); }}
            className={`flex h-9.5 items-center justify-center gap-2 rounded-md text-[0.8rem] font-extrabold transition-all duration-150 ${
              saleType === st ? 'bg-brand text-brand-contrast shadow-brand' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon name={st === 'CASH' ? 'banknote' : 'calendar'} size={15} />
            {st === 'CASH' ? t('cashSale') : t('installmentSale')}
          </button>
        ))}
      </div>

      {/* discount */}
      <Field label={t('discount')} error={discountError}>
        <Input
          type="number"
          min={0}
          step="0.01"
          dir="ltr"
          inputMode="decimal"
          className="num"
          value={discountS}
          placeholder="0.00"
          onChange={(e) => { setDiscountS(e.target.value); setFormError(''); }}
        />
      </Field>

      {/* totals */}
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
        <div className="flex items-center justify-between text-[0.76rem] font-semibold text-ink-2">
          <span>{t('subtotal')}</span>
          <span className="num font-bold">{formatMoney(subtotal, currency)}</span>
        </div>
        {discount > 0 && (
          <div className="mt-1 flex items-center justify-between text-[0.76rem] font-semibold text-warn">
            <span>{t('discount')}</span>
            <span className="num font-bold">-{formatMoney(discount, currency)}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
          <span className="text-[0.86rem] font-black text-ink">{t('total')}</span>
          <span className="num text-[1.05rem] font-black text-brand">{formatMoney(total, currency)}</span>
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
        <button
          type="button"
          onClick={() => setInstallmentModal(true)}
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-start transition-colors hover:border-brand/40"
        >
          <span className="flex items-center justify-between gap-2 text-[0.78rem] font-extrabold text-ink">
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={14} className="text-brand" />
              {numInstallments} × {t('monthly')}
            </span>
            <Icon name="chevron-start" size={13} className="text-ink-muted" />
          </span>
          {plan ? (
            <span className="mt-1.5 grid grid-cols-3 gap-1.5">
              <span className="rounded-md bg-surface px-2 py-1.5">
                <span className="block text-[0.62rem] font-bold text-ink-muted">{t('downPayment')}</span>
                <span className="num block truncate text-[0.74rem] font-black text-ink">{formatMoney(downNum, currency)}</span>
              </span>
              <span className="rounded-md bg-surface px-2 py-1.5">
                <span className="block text-[0.62rem] font-bold text-ink-muted">{t('financedAmount')}</span>
                <span className="num block truncate text-[0.74rem] font-black text-ink">{formatMoney(plan.financedAmount, currency)}</span>
              </span>
              <span className="rounded-md bg-surface px-2 py-1.5">
                <span className="block text-[0.62rem] font-bold text-ink-muted">{t('installmentAmount')}</span>
                <span className="num block truncate text-[0.74rem] font-black text-brand">{formatMoney(plan.installmentAmount, currency)}</span>
              </span>
            </span>
          ) : (
            <span className="mt-1 block text-[0.72rem] font-bold text-ink-muted">{t('schedulePreview')}</span>
          )}
        </button>
      )}

      {saleType === 'INSTALLMENT' && installmentError && (
        <p className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-bold text-danger">
          <Icon name="alert" size={13} /> {installmentError}
        </p>
      )}
      {formError && (
        <p className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-bold text-danger">
          <Icon name="alert" size={13} /> {formError}
        </p>
      )}

      {saleType === 'CASH' ? (
        <Button
          size="lg"
          variant="success"
          icon="check"
          className="w-full"
          disabled={cart.length === 0 || !!discountError || !!receivedError}
          loading={saving}
          onClick={completeCash}
        >
          {t('completeSale')} — {formatMoney(total, currency)}
        </Button>
      ) : (
        <Button
          size="lg"
          icon="calendar"
          className="w-full"
          disabled={cart.length === 0 || !!discountError || !plan}
          onClick={() => setInstallmentModal(true)}
        >
          {t('installmentSale')}
        </Button>
      )}
      <Button
        variant="ghost"
        icon="trash"
        className="w-full"
        disabled={cart.length === 0}
        onClick={() => { setCart([]); setFormError(''); }}
      >
        {t('clearCart')}
      </Button>
    </div>
  );

  /* ---------------- render ---------------- */
  return (
    <>
      <div className="no-print flex flex-col gap-4">
        {/* Sync banner: desktop shows the pairing QR, phone a badge + scanner link */}
        {isDesktop ? (
          <DesktopSyncPanel />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <PhoneSyncBadge />
            <Link
              to="/scanner"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[0.76rem] font-bold text-brand-contrast shadow-brand transition-colors hover:bg-brand-hover"
            >
              <Icon name="scan" size={14} /> {t('openScannerPage')}
            </Link>
            {lastRemoteScan && (
              <Badge tone="ok" icon="download" className="anim-pop">
                <span className="mono" dir="ltr">{lastRemoteScan}</span>
              </Badge>
            )}
          </div>
        )}
        {!isDesktop && lastRemoteScan && (
          <div className="anim-pop flex items-center justify-center gap-2 rounded-lg border border-ok/25 bg-ok/12 px-3 py-2 text-[0.8rem] font-bold text-ok">
            <Icon name="download" size={14} />
            {t('remoteScanReceived')}: <span className="mono" dir="ltr">{lastRemoteScan}</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_370px] lg:items-start xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* Products: search + scan + grid */}
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t('scanBarcode')}
                className="min-w-44 flex-1"
                inputRef={searchRef}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCode(search); }}
              />
              <Button variant="secondary" icon="scan" className="shrink-0" onClick={() => setScannerOpen(true)}>
                <span className="hidden sm:inline">{t('openScanner')}</span>
              </Button>
              <Badge tone="muted" className="hidden shrink-0 xl:inline-flex">{t('posShortcuts')}</Badge>
            </div>
            {isDesktop && (
              <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-[0.7rem] font-semibold text-ink-muted">
                {t('desktopScanHint')}
              </p>
            )}
            {visibleProducts.length === 0 ? (
              <EmptyState
                icon={search ? 'search' : 'box'}
                title={search ? t('noResults') : t('noData')}
                hint={search ? undefined : t('cartEmptyHint')}
              />
            ) : (
              <div className="scroll-y grid max-h-[52vh] grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:max-h-[calc(100dvh-15rem)] xl:grid-cols-4">
                {visibleProducts.map((p) => {
                  const soldOut = p.stockQuantity <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={soldOut}
                      onClick={() => addToCart(p)}
                      className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2 p-2.5 text-start transition-all duration-150 hover:border-brand/45 hover:bg-surface-3 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
                    >
                      {p.image ? (
                        <img src={p.image} alt="" className="h-16 w-full rounded-md border border-line object-cover" />
                      ) : (
                        <span className="grid h-16 w-full place-items-center rounded-md bg-surface-3 text-ink-muted">
                          <Icon name="image" size={22} strokeWidth={1.6} />
                        </span>
                      )}
                      <span className="line-clamp-2 min-h-8 text-[0.76rem] font-bold leading-tight text-ink">{p.name}</span>
                      <span className="num text-[0.84rem] font-black text-brand">{formatMoney(p.sellingPrice, currency)}</span>
                      <span className="flex items-center justify-between gap-1">
                        <Badge tone={soldOut ? 'danger' : p.stockQuantity <= p.minimumStock ? 'warn' : 'muted'}>
                          {t('stock')}: {p.stockQuantity}
                        </Badge>
                        {p.barcode && (
                          <span className="mono hidden max-w-16 truncate text-[0.6rem] font-semibold text-ink-muted sm:block" dir="ltr">
                            {p.barcode}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Desktop checkout column */}
          <div className="hidden min-w-0 lg:sticky lg:top-0 lg:flex lg:flex-col lg:gap-4">
            <Card
              padded={false}
              title={`${t('cart')} (${cart.length})`}
              icon="cart"
              actions={
                cart.length > 0 ? (
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => { setCart([]); setFormError(''); }}>
                    {t('clearCart')}
                  </Button>
                ) : undefined
              }
            >
              {cart.length === 0 ? (
                <EmptyState icon="cart" title={t('emptyCart')} hint={t('cartEmptyHint')} />
              ) : (
                cartRows
              )}
            </Card>
            <Card title={t('completeSale')} icon="wallet">
              {checkout}
            </Card>
          </div>
        </div>
      </div>

      {/* Mobile floating cart summary — sits above the bottom navigation */}
      {cart.length > 0 && (
        <button
          type="button"
          onClick={() => setCartSheet(true)}
          className="no-print anim-pop fixed inset-x-3 bottom-[calc(5rem_+_env(safe-area-inset-bottom,0px))] z-30 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-2 lg:hidden"
        >
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon name="cart" size={19} />
            <span className="num absolute -top-1.5 -end-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.64rem] font-black text-brand-contrast">
              {cart.length}
            </span>
          </span>
          <span className="min-w-0 flex-1 text-start">
            <span className="block text-[0.68rem] font-bold text-ink-muted">{t('total')}</span>
            <span className="num block truncate text-[1rem] font-black text-ink">{formatMoney(total, currency)}</span>
          </span>
          <span className="shrink-0 rounded-md bg-brand px-3.5 py-2 text-[0.8rem] font-bold text-brand-contrast shadow-brand">
            {t('showCart')}
          </span>
        </button>
      )}

      {/* Mobile cart sheet */}
      <Modal open={cartSheet} onClose={() => setCartSheet(false)} title={`${t('cart')} (${cart.length})`} icon="cart">
        <div className="flex flex-col gap-4">
          {cart.length === 0 ? (
            <EmptyState icon="cart" title={t('emptyCart')} hint={t('cartEmptyHint')} />
          ) : (
            <div className="rounded-lg border border-line">{cartRows}</div>
          )}
          {checkout}
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

      {/* Installment plan */}
      <Modal
        open={installmentModal}
        onClose={() => setInstallmentModal(false)}
        title={t('installmentSale')}
        subtitle={t('schedulePreview')}
        icon="calendar"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setInstallmentModal(false)}>{t('cancel')}</Button>
            <Button icon="check" loading={saving} disabled={!plan} onClick={completeInstallment}>
              {t('completeSale')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('total')}>
            <Input readOnly className="num" dir="ltr" value={formatMoney(total, currency)} />
          </Field>
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
          <Field label={t('firstDueDate')}>
            <Input type="date" dir="ltr" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
          </Field>
          <Field label={t('frequency')} className="sm:col-span-2">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="MONTHLY">{t('monthly')}</option>
            </Select>
          </Field>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 sm:col-span-2">
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
            <p className="flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-bold text-danger sm:col-span-2">
              <Icon name="alert" size={13} /> {installmentError}
            </p>
          )}

          <div className="scroll-y max-h-60 overflow-y-auto rounded-lg border border-line sm:col-span-2">
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
        </div>
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
            <div className="scroll-y flex max-h-[60vh] justify-center overflow-auto rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
              <InvoicePrint saleId={invoice.saleId} paper={invoicePaper} />
            </div>
          </div>
        )}
      </Modal>
      {invoice && <style>{PRINT_CSS}</style>}
    </>
  );
}
