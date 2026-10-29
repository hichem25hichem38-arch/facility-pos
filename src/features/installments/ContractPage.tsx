import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { SettingsService } from '@/services/settings/settings.service';
import { daysBetween, formatDate, formatMoney, round2 } from '@/utils/format';
import type { Customer, Installment, InstallmentPlan, Product, Sale, SaleItem } from '@/types';

/*
 * The contract is physical paper: like InvoicePrint it is intentionally
 * black-on-white with millimetre dimensions, independent of UI tokens.
 */
const CSS = `
.ct { background:#fff; color:#000; font-family: var(--font, system-ui, sans-serif); box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.ct * , .ct *::before, .ct *::after { box-sizing:border-box; }
.ct-paper { width:210mm; min-height:297mm; margin:0 auto; padding:10mm 12mm; }
.ct-screen .ct-paper { width:100%; min-height:0; padding:6mm 7mm; }
.ct-head { display:flex; align-items:center; gap:4mm; border-bottom:2px solid #000; padding-bottom:3mm; margin-bottom:4mm; }
.ct-logo { width:20mm; height:20mm; object-fit:contain; border:1px solid #ccc; background:#fff; padding:1mm; flex-shrink:0; }
.ct-logo-ph { display:flex; align-items:center; justify-content:center; border:1px dashed #999; color:#555; font-size:6.5pt; text-align:center; }
.ct-store { flex:1; min-width:0; }
.ct-store-name { font-size:15pt; font-weight:800; line-height:1.2; }
.ct-store-meta { font-size:8pt; color:#333; margin-top:0.8mm; }
.ct-titles { text-align:left; flex-shrink:0; }
.ct-doc-title { font-size:13pt; font-weight:800; margin-bottom:1.2mm; }
.ct-nums { font-size:8pt; line-height:1.55; }
.ct-nums b { font-weight:800; }
.ct-parties { display:flex; gap:4mm; margin-bottom:4mm; }
.ct-party { flex:1; border:1px solid #999; padding:2.5mm 3mm; font-size:8.5pt; }
.ct-party h4 { margin:0 0 1.5mm; font-size:9pt; font-weight:800; border-bottom:1px solid #bbb; padding-bottom:1mm; }
.ct-party p { margin:0.7mm 0; }
.ct-party .lbl { font-weight:700; color:#333; }
.ct-h { font-size:10pt; font-weight:800; margin:0 0 1.8mm; padding-bottom:1mm; border-bottom:1.5px solid #000; }
.ct-sec { margin-bottom:4.5mm; break-inside:avoid; page-break-inside:avoid; }
.ct-table { width:100%; border-collapse:collapse; font-size:8.5pt; table-layout:fixed; }
.ct-table th { background:#eee; border:0.6px solid #999; padding:1.5mm; font-weight:800; font-size:8pt; }
.ct-table td { border:0.6px solid #bbb; padding:1.4mm 1.6mm; vertical-align:middle; }
.ct-table tr { break-inside:avoid; page-break-inside:avoid; }
.ct-c { text-align:center; }
.ct-fin { display:flex; gap:4mm; }
.ct-fin > table { flex:1; }
.ct-fin td { border:0.6px solid #bbb; padding:1.4mm 2mm; font-size:8.5pt; }
.ct-fin .lbl { font-weight:700; background:#f5f5f5; }
.ct-fin .val { text-align:left; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.ct-fin tr.grand td { background:#eee; border-color:#000; font-weight:800; font-size:9.5pt; }
.ct-terms { border:1px solid #999; padding:2.5mm 3mm; font-size:8.5pt; }
.ct-terms ol { margin:1.5mm 0 0; padding-inline-start:5mm; }
.ct-terms li { margin-bottom:1.2mm; line-height:1.5; }
.ct-sign { display:flex; gap:8mm; margin-top:8mm; }
.ct-sign-cell { flex:1; text-align:center; font-size:8.5pt; font-weight:700; }
.ct-sign-line { border-bottom:1px solid #000; height:12mm; margin-bottom:1.5mm; }
.ct-foot { margin-top:6mm; border-top:0.8px dashed #999; padding-top:2mm; text-align:center; font-size:7.5pt; color:#333; }
`;

const PRINT_CSS = `@media print {
  .ct-paper { width: auto !important; min-height: 0 !important; padding: 0 !important; }
}`;

export function ContractPage() {
  const { saleId = '' } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  const data = useLiveQuery(async () => {
    const db = getDb();
    const sale = await db.sales.get(saleId);
    if (!sale) return null;
    const plan = await db.installmentPlans.where('saleId').equals(saleId).first();
    if (!plan) return null;
    const customer = sale.customerId ? await db.customers.get(sale.customerId) : undefined;
    const saleItems = await db.saleItems.where('saleId').equals(saleId).toArray();
    const products = await Promise.all(saleItems.map((it) => db.products.get(it.productId)));
    const installments = await db.installments.where('planId').equals(plan.id).sortBy('installmentNumber');
    const settings = await new SettingsService().get();
    return {
      sale,
      plan,
      customer,
      items: saleItems.map((it, idx) => ({ item: it, product: products[idx] })),
      installments,
      settings,
    };
  }, [saleId]);

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
        icon="file"
        title={t('contractNotFound')}
        hint={t('contractNotFoundHint')}
        action={<Button variant="secondary" icon="chevron-start" onClick={() => navigate('/sales')}>{t('back')}</Button>}
      />
    );
  }

  const { sale, plan, customer, items, installments, settings } = data;
  const now = Date.now();
  const collected = round2(installments.reduce((s, i) => s + i.amountPaid, 0) + plan.downPayment);
  const remaining = round2(installments.reduce((s, i) => s + Math.max(0, i.remainingAmount), 0));
  const firstDue = installments[0]?.dueDate;
  const statusOf = (i: Installment): string => {
    if (i.remainingAmount <= 0) return t('paidStatus');
    if (i.dueDate < now) return `${t('overdue')} (${t('daysLate', { days: Math.max(1, daysBetween(i.dueDate, now)) })})`;
    if (i.amountPaid > 0) return t('partial');
    return t('pending');
  };

  return (
    <>
      <style>{CSS}</style>
      <style>{PRINT_CSS}</style>

      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon="chevron-start" onClick={() => navigate(-1)}>{t('back')}</Button>
        <span className="min-w-0 flex-1 truncate text-[0.74rem] font-semibold text-ink-muted">{t('contractPrintHint')}</span>
        <Button icon="print" onClick={() => window.print()}>{t('printContract')}</Button>
      </div>

      {/* Paper — on screen shown as a document, on paper full A4 */}
      <div className="ct-screen no-print overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 shadow-1">
        <div className="ct mx-auto w-full max-w-[210mm] border border-line shadow-2 print:border-0 print:shadow-none">
          <ContractDoc
            sale={sale}
            plan={plan}
            customer={customer}
            items={items}
            installments={installments}
            collected={collected}
            remaining={remaining}
            firstDue={firstDue}
            settings={settings}
            currency={currency}
            dateLocale={dateLocale}
            statusOf={statusOf}
            t={t}
          />
        </div>
      </div>

      {/* Real print root */}
      <div className="print-only">
        <div className="print-area">
          <div className="ct ct-paper" dir="rtl">
            <ContractDoc
              sale={sale}
              plan={plan}
              customer={customer}
              items={items}
              installments={installments}
              collected={collected}
              remaining={remaining}
              firstDue={firstDue}
              settings={settings}
              currency={currency}
              dateLocale={dateLocale}
              statusOf={statusOf}
              t={t}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

interface DocProps {
  sale: Sale;
  plan: InstallmentPlan;
  customer?: Customer;
  items: { item: SaleItem; product?: Product }[];
  installments: Installment[];
  collected: number;
  remaining: number;
  firstDue?: number;
  settings: { storeName: string; storePhone: string; storeAddress: string; storeLogo?: string };
  currency: string;
  dateLocale: string;
  statusOf: (i: Installment) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function ContractDoc({
  sale, plan, customer, items, installments,
  collected, remaining, firstDue, settings, currency, dateLocale, statusOf, t,
}: DocProps) {
  return (
    <div className="ct-paper" dir="rtl">
      {/* Header */}
      <div className="ct-head">
        {settings.storeLogo ? (
          <img src={settings.storeLogo} alt="" className="ct-logo" />
        ) : (
          <div className="ct-logo ct-logo-ph">{t('invoiceLogoPlaceholder')}</div>
        )}
        <div className="ct-store">
          <div className="ct-store-name">{settings.storeName}</div>
          {(settings.storeAddress || settings.storePhone) && (
            <div className="ct-store-meta">
              {settings.storeAddress}
              {settings.storePhone ? ` — ${settings.storePhone}` : ''}
            </div>
          )}
        </div>
        <div className="ct-titles">
          <div className="ct-doc-title">{t('contractDocTitle')}</div>
          <div className="ct-nums">
            <div><b>{t('contractNumber')}:</b> {sale.invoiceNumber}</div>
            <div><b>{t('invoiceNumber')}:</b> {sale.invoiceNumber}</div>
            <div><b>{t('contractDate')}:</b> {formatDate(sale.saleDate, dateLocale)}</div>
          </div>
        </div>
      </div>

      {/* Parties */}
      <div className="ct-parties">
        <div className="ct-party">
          <h4>{t('sellerParty')}</h4>
          <p><span className="lbl">{t('storeName')}:</span> {settings.storeName}</p>
          {settings.storePhone && <p><span className="lbl">{t('phone')}:</span> <span dir="ltr">{settings.storePhone}</span></p>}
          {settings.storeAddress && <p><span className="lbl">{t('address')}:</span> {settings.storeAddress}</p>}
        </div>
        <div className="ct-party">
          <h4>{t('buyerParty')} — {t('contractCustomerBlock')}</h4>
          <p>
            <span className="lbl">{t('fullName')}:</span>{' '}
            {customer ? customer.fullName : t('walkInCustomer')}
          </p>
          {customer && (
            <>
              <p><span className="lbl">{t('customerNumber')}:</span> {customer.customerNumber}</p>
              {customer.phone && <p><span className="lbl">{t('phone')}:</span> <span dir="ltr">{customer.phone}</span></p>}
              {customer.nationalId && <p><span className="lbl">{t('nationalId')}:</span> {customer.nationalId}</p>}
              {customer.address && <p><span className="lbl">{t('address')}:</span> {customer.address}</p>}
            </>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="ct-sec">
        <h3 className="ct-h">{t('contractItemsTitle')}</h3>
        <table className="ct-table">
          <thead>
            <tr>
              <th style={{ width: '8mm' }}>#</th>
              <th>{t('product')}</th>
              <th style={{ width: '16mm' }}>{t('quantity')}</th>
              <th style={{ width: '30mm' }}>{t('unitPriceCol')}</th>
              <th style={{ width: '32mm' }}>{t('lineTotalCol')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ item, product }, idx) => (
              <tr key={item.id}>
                <td className="ct-c">{idx + 1}</td>
                <td style={{ fontWeight: 700 }}>{product?.name ?? '—'}</td>
                <td className="ct-c">{item.quantity}</td>
                <td className="ct-c">{formatMoney(item.unitPrice, currency)}</td>
                <td className="ct-c" style={{ fontWeight: 800 }}>{formatMoney(item.total, currency)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="ct-c">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Financial summary */}
      <div className="ct-sec">
        <h3 className="ct-h">{t('contractFinancialTitle')}</h3>
        <div className="ct-fin">
          <table>
            <tbody>
              <tr>
                <td className="lbl">{t('total')}</td>
                <td className="val">{formatMoney(sale.totalAmount, currency)}</td>
              </tr>
              <tr>
                <td className="lbl">{t('downPayment')}</td>
                <td className="val">{formatMoney(plan.downPayment, currency)}</td>
              </tr>
              <tr className="grand">
                <td className="lbl">{t('financedAmount')}</td>
                <td className="val">{formatMoney(plan.financedAmount, currency)}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr>
                <td className="lbl">{t('numberOfInstallments')}</td>
                <td className="val">{plan.numberOfInstallments} × {t('monthly')}</td>
              </tr>
              <tr>
                <td className="lbl">{t('installmentAmount')}</td>
                <td className="val">{formatMoney(plan.installmentAmount, currency)}</td>
              </tr>
              <tr>
                <td className="lbl">{t('firstDueDate')}</td>
                <td className="val">{firstDue !== undefined ? formatDate(firstDue, dateLocale) : '—'}</td>
              </tr>
              <tr>
                <td className="lbl">{t('paid')} / {t('remaining')}</td>
                <td className="val">{formatMoney(collected, currency)} / {formatMoney(remaining, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Full schedule */}
      <div className="ct-sec">
        <h3 className="ct-h">{t('contractScheduleTitle')}</h3>
        <table className="ct-table">
          <thead>
            <tr>
              <th style={{ width: '9mm' }}>#</th>
              <th style={{ width: '34mm' }}>{t('dueDate')}</th>
              <th>{t('amountDue')}</th>
              <th>{t('amountPaidCol')}</th>
              <th>{t('remaining')}</th>
              <th style={{ width: '38mm' }}>{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((i) => (
              <tr key={i.id}>
                <td className="ct-c" style={{ fontWeight: 800 }}>{i.installmentNumber}</td>
                <td className="ct-c">{formatDate(i.dueDate, dateLocale)}</td>
                <td className="ct-c">{formatMoney(i.amountDue, currency)}</td>
                <td className="ct-c">{formatMoney(i.amountPaid, currency)}</td>
                <td className="ct-c" style={{ fontWeight: 700 }}>{formatMoney(Math.max(0, i.remainingAmount), currency)}</td>
                <td className="ct-c">{statusOf(i)}</td>
              </tr>
            ))}
            {installments.length === 0 && (
              <tr>
                <td colSpan={6} className="ct-c">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Terms */}
      <div className="ct-sec ct-terms">
        <h3 className="ct-h" style={{ border: 0, margin: 0, padding: 0 }}>{t('contractTermsTitle')}</h3>
        <ol>
          <li>{t('contractTerm1')}</li>
          <li>{t('contractTerm2')}</li>
          <li>{t('contractTerm3')}</li>
          <li>{t('contractTerm4')}</li>
        </ol>
      </div>

      {/* Signatures */}
      <div className="ct-sign">
        <div className="ct-sign-cell">
          <div className="ct-sign-line" />
          {t('signatureSeller')}
        </div>
        <div className="ct-sign-cell">
          <div className="ct-sign-line" />
          {t('signatureBuyer')}
          {customer && <div style={{ fontWeight: 400, fontSize: '7.5pt', marginTop: '1mm' }}>{customer.fullName}</div>}
        </div>
      </div>

      <div className="ct-foot">
        {settings.storeName} — {sale.invoiceNumber} — {formatDate(sale.saleDate, dateLocale)}
      </div>
    </div>
  );
}
