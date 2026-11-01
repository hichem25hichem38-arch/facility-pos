import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Badge, Button, EmptyState, Modal, Spinner } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { formatDateTime, formatMoney } from '@/utils/format';
import { BarcodeSVG } from '@/components/barcode/BarcodeView';
import type { InventoryTransaction, Product } from '@/types';

interface ProductDetailModalProps {
  open: boolean;
  onClose: () => void;
  barcode: string | null;
}

type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'purple' | 'muted';

const MOVEMENT_META: Record<InventoryTransaction['type'], { icon: IconName; tone: Tone }> = {
  PURCHASE: { icon: 'download', tone: 'info' },
  SALE: { icon: 'cart', tone: 'purple' },
  RETURN: { icon: 'undo', tone: 'warn' },
  ADJUSTMENT: { icon: 'layers', tone: 'muted' },
  STOCK_IN: { icon: 'arrow-up', tone: 'ok' },
  STOCK_OUT: { icon: 'arrow-down', tone: 'danger' },
};

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
  brand: 'bg-brand/12 text-brand',
  info: 'bg-info/12 text-info',
  purple: 'bg-purple/12 text-purple',
  muted: 'bg-surface-3 text-ink-muted',
};

export function ProductDetailModal({ open, onClose, barcode }: ProductDetailModalProps) {
  const { t, locale } = useT();
  const currency = useAppStore((s) => s.currency);

  const product = useLiveQuery(
    async (): Promise<Product | null> => {
      if (!open || !barcode) return null;
      return (await getDb().products.where('barcode').equals(barcode).first()) ?? null;
    },
    [open, barcode],
    undefined as Product | null | undefined,
  );

  const category = useLiveQuery(
    async () => (product?.categoryId ? getDb().categories.get(product.categoryId) : undefined),
    [product?.categoryId],
    undefined,
  );

  const movements = useLiveQuery(
    async () =>
      product
        ? getDb()
            .inventoryTransactions.where('[productId+createdAt]')
            .between([product.id, 0], [product.id, Infinity])
            .reverse()
            .limit(6)
            .toArray()
        : [],
    [product?.id],
    [],
  );

  if (!open) return null;

  const dateLocale = locale === 'ar' ? 'ar-DZ' : 'fr-DZ';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product?.name ?? t('productDetails')}
      subtitle={t('productDetails')}
      icon="box"
      wide
      footer={<Button variant="secondary" onClick={onClose}>{t('close')}</Button>}
    >
      {product === undefined ? (
        <div className="flex justify-center py-12">
          <Spinner size={22} />
        </div>
      ) : product === null ? (
        <EmptyState icon="box" title={t('productNotFoundBarcode')} hint={barcode ?? undefined} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="h-44 w-full rounded-lg border border-line bg-surface-3 object-contain"
              />
            ) : (
              <span className="grid h-44 w-full place-items-center rounded-lg border border-dashed border-line-strong bg-surface-2 text-ink-muted">
                <Icon name="image" size={30} strokeWidth={1.6} />
              </span>
            )}

            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={product.isActive ? 'ok' : 'muted'} icon={product.isActive ? 'check' : 'eye-off'}>
                  {product.isActive ? t('active') : t('inactive')}
                </Badge>
                <Badge tone="brand" icon="tag">
                  {category?.name ?? t('uncategorized')}
                </Badge>
                {product.isActive && product.stockQuantity <= product.minimumStock && (
                  <Badge tone={product.stockQuantity <= 0 ? 'danger' : 'warn'} icon="alert">
                    {t('lowStockAlert')}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Tile label={t('purchasePrice')} value={formatMoney(product.purchasePrice, currency)} />
                <Tile label={t('sellingPrice')} value={formatMoney(product.sellingPrice, currency)} strong tone="ok" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Tile
                  label={t('marginPercent')}
                  value={
                    product.sellingPrice > 0
                      ? `${Math.round(((product.sellingPrice - product.purchasePrice) / product.sellingPrice) * 100)}%`
                      : '—'
                  }
                  tone={product.sellingPrice > product.purchasePrice ? 'ok' : 'danger'}
                />
                <Tile label={t('sku')} value={product.sku || '—'} mono />
              </div>

              {/* Stock vs minimum */}
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.7rem] font-black uppercase tracking-wide text-ink-muted">{t('stock')}</span>
                  <span
                    className={`num text-[0.95rem] font-black ${
                      product.stockQuantity <= 0
                        ? 'text-danger'
                        : product.stockQuantity <= product.minimumStock
                          ? 'text-warn'
                          : 'text-ok'
                    }`}
                  >
                    {product.stockQuantity}
                    <span className="text-[0.68rem] font-bold text-ink-muted"> / {t('minimumStock')} {product.minimumStock}</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      product.stockQuantity <= 0
                        ? 'bg-danger'
                        : product.stockQuantity <= product.minimumStock
                          ? 'bg-warn'
                          : 'bg-ok'
                    }`}
                    style={{
                      width: `${
                        product.stockQuantity <= 0
                          ? 0
                          : Math.min(100, Math.round((product.stockQuantity / Math.max(1, product.minimumStock * 2)) * 100))
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {product.barcode && (
            <div className="flex justify-center rounded-lg border border-line bg-surface-2 p-3">
              <BarcodeSVG value={product.barcode} height={52} />
            </div>
          )}

          {product.description && (
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-[0.7rem] font-black uppercase tracking-wide text-ink-muted">{t('description')}</p>
              <p className="mt-1 text-[0.84rem] font-semibold leading-relaxed text-ink-2">{product.description}</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-[0.76rem] font-black uppercase tracking-wide text-ink-muted">{t('lastMovements')}</p>
            {movements.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-2 px-3 py-5 text-center text-[0.78rem] font-semibold text-ink-muted">
                {t('noMovements')}
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {movements.map((m) => {
                  const meta = MOVEMENT_META[m.type] ?? { icon: 'info' as IconName, tone: 'muted' as Tone };
                  const positive = m.newQuantity >= m.previousQuantity;
                  const labelKey = `movementType_${m.type}`;
                  const label = t(labelKey) === labelKey ? m.type : t(labelKey);
                  return (
                    <li key={m.id} className="flex items-center gap-2.5 bg-surface-2 px-3 py-2">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${TONE_CHIP[meta.tone]}`}>
                        <Icon name={meta.icon} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8rem] font-bold text-ink">{label}</span>
                        {m.reason && <span className="block truncate text-[0.68rem] font-semibold text-ink-muted">{m.reason}</span>}
                      </span>
                      <span className={`num shrink-0 text-[0.8rem] font-black ${positive ? 'text-ok' : 'text-danger'}`}>
                        {positive ? '+' : '−'}
                        {Math.abs(m.quantity)}
                      </span>
                      <span className="num w-10 shrink-0 text-end text-[0.72rem] font-bold text-ink-2">{m.newQuantity}</span>
                      <span className="num hidden shrink-0 text-[0.68rem] font-semibold text-ink-muted sm:block">
                        {formatDateTime(m.createdAt, dateLocale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="num text-center text-[0.68rem] font-semibold text-ink-muted">
            {t('createdAt')}: {formatDateTime(product.createdAt, dateLocale)} · {t('updatedAt')}: {formatDateTime(product.updatedAt, dateLocale)}
          </p>
        </div>
      )}
    </Modal>
  );
}

function Tile({
  label,
  value,
  mono,
  strong,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  tone?: 'ok' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className="text-[0.68rem] font-black uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={`mt-0.5 truncate text-[0.88rem] font-bold text-ink ${mono ? 'num' : ''} ${strong ? 'font-black' : ''} ${
          tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : ''
        }`}
        dir={mono ? 'ltr' : undefined}
      >
        {value}
      </p>
    </div>
  );
}
