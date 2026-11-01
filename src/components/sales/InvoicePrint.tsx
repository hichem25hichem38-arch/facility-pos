import { useEffect, useState } from 'react';
import { getDb } from '@/database/db';
import { SettingsService } from '@/services/settings/settings.service';
import { formatMoney, formatDate } from '@/utils/format';
import { useAppStore } from '@/app/store/app.store';
import { useT } from '@/hooks/useT';
import type { Sale, SaleItem, Product, Customer, InstallmentPlan } from '@/types';

interface Props {
  saleId: string;
  paper: 'A4' | '8x11';
}

interface StoreInfo {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeLogo?: string;
}

/*
 * Print-only stylesheet. A receipt is physical paper, so it is intentionally
 * black-on-white and independent of the light/dark UI tokens.
 */
const CSS = `
.inv { background:#fff; color:#000; font-family: var(--font, system-ui, sans-serif); display:flex; flex-direction:column; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.inv *, .inv *::before, .inv *::after { box-sizing:border-box; }
.inv-a4 { width:210mm; min-height:297mm; padding:10mm; }
.inv-t { width:80mm; min-height:110mm; max-height:110mm; overflow:hidden; padding:3mm; }
.inv-head { display:flex; align-items:center; gap:3mm; border-bottom:1.5px solid #000; padding-bottom:2.5mm; margin-bottom:3mm; flex-shrink:0; }
.inv-t .inv-head { gap:2mm; border-bottom-width:1px; padding-bottom:1.5mm; margin-bottom:2mm; }
.inv-logo { width:18mm; height:18mm; object-fit:contain; border:1px solid #ccc; background:#fff; padding:1mm; flex-shrink:0; }
.inv-t .inv-logo { width:12mm; height:12mm; }
.inv-logo-ph { display:flex; align-items:center; justify-content:center; border:1px dashed #999; color:#555; font-size:6pt; }
.inv-store { flex:1; min-width:0; }
.inv-name { font-size:14pt; font-weight:800; line-height:1.15; overflow-wrap:break-word; }
.inv-t .inv-name { font-size:9pt; }
.inv-meta { font-size:7.5pt; color:#333; overflow-wrap:break-word; margin-top:0.6mm; }
.inv-t .inv-meta { font-size:5.5pt; }
.inv-kind { font-size:7pt; color:#666; margin-top:0.4mm; }
.inv-t .inv-kind { font-size:5pt; }
.inv-nums { text-align:left; font-size:7.5pt; line-height:1.45; flex-shrink:0; }
.inv-t .inv-nums { font-size:5.5pt; line-height:1.35; }
.inv-nums b { font-weight:800; }
.inv-cust { display:flex; justify-content:space-between; gap:2mm; font-size:8.5pt; border:0.8px solid #bbb; padding:1.8mm 2mm; margin-bottom:3mm; background:#f5f5f5; flex-shrink:0; }
.inv-t .inv-cust { font-size:6pt; padding:1.2mm 1.5mm; margin-bottom:2mm; }
.inv-cust > div { overflow-wrap:break-word; }
.inv-cust > div:last-child { flex-shrink:0; }
.inv-items { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8.5pt; margin-bottom:3mm; }
.inv-t .inv-items { font-size:6pt; margin-bottom:2mm; }
.inv-items th { background:#eee; border:0.6px solid #999; padding:1.4mm; font-weight:800; font-size:7.5pt; }
.inv-t .inv-items th { padding:1mm; font-size:5.5pt; }
.inv-items td { border:0.6px solid #bbb; padding:1.3mm 1.4mm; vertical-align:middle; }
.inv-t .inv-items td { padding:0.9mm 1mm; }
.inv-items tr { break-inside:avoid; page-break-inside:avoid; }
.inv-item-name { font-weight:700; overflow-wrap:break-word; }
.inv-t .inv-item-name { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.inv-item-code { font-family:var(--font-mono, monospace); font-size:6pt; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.inv-t .inv-item-code { font-size:4.5pt; }
.inv-sum-wrap { display:flex; justify-content:flex-end; margin-bottom:3mm; flex-shrink:0; }
.inv-t .inv-sum-wrap { margin-bottom:2mm; }
.inv-sum { border-collapse:collapse; min-width:62mm; font-size:8.5pt; }
.inv-t .inv-sum { min-width:44mm; font-size:6.5pt; }
.inv-sum td { border:0.6px solid #bbb; padding:1.3mm 2mm; }
.inv-t .inv-sum td { padding:0.9mm 1.2mm; }
.inv-sum .lbl { font-weight:700; }
.inv-sum .val { text-align:left; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.inv-sum .grand td { background:#eee; border-color:#000; font-weight:800; font-size:9.5pt; }
.inv-t .inv-sum .grand td { font-size:7pt; }
.inv-credit { border:0.8px solid #999; padding:2mm; margin-bottom:3mm; font-size:8pt; flex-shrink:0; break-inside:avoid; page-break-inside:avoid; }
.inv-t .inv-credit { padding:1.2mm; margin-bottom:2mm; font-size:5.5pt; }
.inv-credit h4 { margin:0 0 1.2mm; font-size:8.5pt; font-weight:800; }
.inv-t .inv-credit h4 { font-size:6pt; margin-bottom:0.8mm; }
.inv-credit table { width:100%; border-collapse:collapse; }
.inv-credit td { padding:0.7mm 0; border-bottom:0.4px dotted #999; }
.inv-credit td:last-child { text-align:left; font-weight:700; white-space:nowrap; }
.inv-foot { margin-top:auto; border-top:0.8px dashed #999; padding-top:2mm; text-align:center; color:#333; font-size:7.5pt; flex-shrink:0; }
.inv-t .inv-foot { padding-top:1.2mm; font-size:5.5pt; }
.inv-foot .tick { font-family:var(--font-mono, monospace); font-size:6.5pt; color:#555; margin-top:0.8mm; }
.inv-t .inv-foot .tick { font-size:4.5pt; }
`;

export function InvoicePrint({ saleId, paper }: Props) {
  const { t } = useT();
  const currency = useAppStore((s) => s.currency);
  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<(SaleItem & { product?: Product })[]>([]);
  const [plan, setPlan] = useState<InstallmentPlan | null>(null);
  const [store, setStore] = useState<StoreInfo>({ storeName: '', storePhone: '', storeAddress: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const s = await db.sales.get(saleId);
      if (!s || cancelled) return;
      setSale(s);
      if (s.customerId) setCustomer((await db.customers.get(s.customerId)) ?? null);
      const saleItems = await db.saleItems.where('saleId').equals(saleId).toArray();
      const prods = await Promise.all(
        saleItems.map(async (it) => ({ ...it, product: await db.products.get(it.productId) })),
      );
      if (cancelled) return;
      setItems(prods);
      if (s.saleType === 'INSTALLMENT') {
        const p = await db.installmentPlans.where('saleId').equals(saleId).first();
        if (!cancelled) setPlan(p ?? null);
      }
      const st = await new SettingsService().get();
      if (!cancelled) {
        setStore({ storeName: st.storeName, storePhone: st.storePhone, storeAddress: st.storeAddress, storeLogo: st.storeLogo });
      }
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [saleId]);

  if (!sale) {
    return <div className="p-8 text-center text-[0.85rem] font-semibold text-ink-muted">{t('loading')}</div>;
  }

  const isA4 = paper === 'A4';
  const id = isA4 ? 'invoice-a4' : 'invoice-8x11';
  /* Thermal 80×110mm is a fixed sheet — cap the rows so the totals stay on paper */
  const maxRows = isA4 ? items.length : 12;
  const rows = items.slice(0, maxRows);
  const hidden = items.length - rows.length;

  return (
    <>
      <style>{CSS}</style>
      <div id={id} className={`print-area inv ${isA4 ? 'inv-a4' : 'inv-t'}`} dir="rtl">
        {/* Header */}
        <div className="inv-head">
          {store.storeLogo ? (
            <img src={store.storeLogo} alt="" className="inv-logo" />
          ) : (
            <div className="inv-logo inv-logo-ph">{t('invoiceLogoPlaceholder')}</div>
          )}
          <div className="inv-store">
            <div className="inv-name">{store.storeName}</div>
            {(store.storeAddress || store.storePhone) && (
              <div className="inv-meta">
                {store.storeAddress}
                {store.storePhone ? ` — ${store.storePhone}` : ''}
              </div>
            )}
            <div className="inv-kind">{t('invoiceSale')}</div>
          </div>
          <div className="inv-nums">
            <div><b>{t('invoiceNumber')}:</b> {sale.invoiceNumber}</div>
            <div><b>{t('date')}:</b> {formatDate(sale.saleDate)}</div>
            <div>
              <b>{t('saleType')}:</b>{' '}
              {sale.saleType === 'CASH' ? t('invoiceTypeCash') : t('invoiceTypeCredit')}
            </div>
          </div>
        </div>

        {/* Customer */}
        <div className="inv-cust">
          <div>
            <b>{t('customer')}:</b>{' '}
            {customer ? `${customer.fullName} (${customer.customerNumber})` : t('walkInCustomer')}
            {customer?.phone ? ` — ${customer.phone}` : ''}
          </div>
          <div style={{ flexShrink: 0 }}>
            <b>{t('status')}:</b> {t(`status_${sale.status}`)}
          </div>
        </div>

        {/* Items */}
        <table className="inv-items">
          <thead>
            <tr>
              <th style={{ width: isA4 ? '8mm' : '6mm' }}>#</th>
              <th style={{ textAlign: 'right' }}>{t('product')}</th>
              <th style={{ width: isA4 ? '14mm' : '10mm' }}>{t('quantity')}</th>
              <th style={{ width: isA4 ? '24mm' : '17mm' }}>{t('invoiceUnitPrice')}</th>
              <th style={{ width: isA4 ? '26mm' : '19mm' }}>{t('invoiceLineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, idx) => (
              <tr key={it.id}>
                <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                <td>
                  <div className="inv-item-name">{it.product?.name ?? '—'}</div>
                  {(it.product?.barcode || it.product?.sku) && (
                    <div className="inv-item-code" dir="ltr">
                      {it.product?.barcode ?? ''}
                      {it.product?.sku ? ` — ${it.product.sku}` : ''}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                <td style={{ textAlign: 'center' }}>{formatMoney(it.unitPrice, currency)}</td>
                <td style={{ textAlign: 'center', fontWeight: 800 }}>{formatMoney(it.total, currency)}</td>
              </tr>
            ))}
            {hidden > 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#555' }}>
                  {t('invoiceExtraItems', { count: hidden })}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="inv-sum-wrap">
          <table className="inv-sum">
            <tbody>
              <tr>
                <td className="lbl">{t('subtotal')}</td>
                <td className="val">{formatMoney(sale.subtotal, currency)}</td>
              </tr>
              {sale.discount > 0 && (
                <tr>
                  <td className="lbl">{t('discount')}</td>
                  <td className="val">-{formatMoney(sale.discount, currency)}</td>
                </tr>
              )}
              <tr className="grand">
                <td className="lbl">{t('total')}</td>
                <td className="val">{formatMoney(sale.totalAmount, currency)}</td>
              </tr>
              <tr>
                <td className="lbl">{t('paid')}</td>
                <td className="val">{formatMoney(sale.paidAmount, currency)}</td>
              </tr>
              <tr>
                <td className="lbl">{t('remaining')}</td>
                <td className="val" style={{ fontWeight: 800 }}>
                  {formatMoney(sale.remainingAmount, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Credit / installment summary */}
        {sale.saleType === 'INSTALLMENT' && plan && (
          <div className="inv-credit">
            <h4>{t('invoiceInstallmentsSummary')}</h4>
            <table>
              <tbody>
                <tr>
                  <td>{t('downPayment')}</td>
                  <td>{formatMoney(plan.downPayment, currency)}</td>
                </tr>
                <tr>
                  <td>{t('financedAmount')}</td>
                  <td>{formatMoney(plan.financedAmount, currency)}</td>
                </tr>
                <tr>
                  <td>{t('numberOfInstallments')}</td>
                  <td>{plan.numberOfInstallments} × {t('monthly')}</td>
                </tr>
                <tr>
                  <td>{t('installmentAmount')}</td>
                  <td>{formatMoney(plan.installmentAmount, currency)}</td>
                </tr>
                <tr>
                  <td>{t('invoiceFirstInstallmentDue')}</td>
                  <td>{formatDate(plan.startDate + 30 * 86_400_000)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="inv-foot">
          <div>{t('invoiceThanks', { store: store.storeName })}</div>
          <div className="tick" dir="ltr">
            {sale.invoiceNumber} — {new Date().toLocaleString('fr-DZ')}
          </div>
        </div>
      </div>
    </>
  );
}
