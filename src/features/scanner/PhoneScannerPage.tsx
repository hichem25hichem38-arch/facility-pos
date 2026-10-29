import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { CameraScanner } from '@/components/barcode/CameraScanner';
import { PhonePairingPanel } from '@/components/sync/PhonePairingPanel';
import { emitScanSync, getScanStatus } from '@/services/sync/scan.service';
import { toastSuccess, toastError } from '@/app/store/toast.store';
import { Badge, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { formatMoney } from '@/utils/format';
import type { Product } from '@/types';

interface HistoryEntry {
  code: string;
  at: number;
  sent: boolean;
  mode: 'pc' | 'local';
}

export function PhoneScannerPage() {
  const { t } = useT();
  const currency = useAppStore((s) => s.currency);
  const [active, setActive] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState(getScanStatus());
  const [scanMode, setScanMode] = useState<'pc' | 'local'>('pc');
  const [localProduct, setLocalProduct] = useState<Product | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  const productsReady = useLiveQuery(() => getDb().products.count(), [], 0);

  useEffect(() => {
    const id = setInterval(() => setStatus(getScanStatus()), 1500);
    return () => clearInterval(id);
  }, []);

  const pushHistory = (entry: HistoryEntry) => setHistory((h) => [entry, ...h].slice(0, 20));

  const handleDetected = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    setLastBarcode(clean);
    if (scanMode === 'pc') {
      const sent = emitScanSync(clean);
      pushHistory({ code: clean, at: Date.now(), sent, mode: 'pc' });
      setLocalProduct(null);
      setLocalError(null);
      if (sent) toastSuccess(t('sentToDesktop', { code: clean }));
      else toastError(t('sendFailedPairing'));
      try { navigator.vibrate?.(100); } catch {}
    } else {
      try {
        const db = getDb();
        const p = await db.products.where('barcode').equals(clean).first();
        const found: Product | null = p ?? (await db.products.where('sku').equals(clean).first()) ?? null;
        if (found) {
          setLocalProduct(found);
          setLocalError(null);
          toastSuccess(found.name);
          pushHistory({ code: clean, at: Date.now(), sent: true, mode: 'local' });
        } else {
          setLocalProduct(null);
          setLocalError(t('productNotFoundLocal'));
          toastError(t('productNotFoundLocal'));
          pushHistory({ code: clean, at: Date.now(), sent: false, mode: 'local' });
        }
        try { navigator.vibrate?.(80); } catch {}
      } catch {
        setLocalError(t('searchError'));
        toastError(t('searchError'));
      }
    }
    /* camera stays open for continuous scanning */
  };

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    handleDetected(code).catch(console.error);
  };

  const historyForMode = history.filter((h) => h.mode === scanMode);

  return (
    <>
      <PageHeader icon="scan" title={t('scanner')} subtitle={t('phoneScannerSubtitle')} />

      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Card padded={false} className="overflow-hidden">
          {/* Mode switch — big thumb targets */}
          <div className="grid grid-cols-2 gap-1 border-b border-line bg-surface-2 p-1.5">
            <button
              type="button"
              onClick={() => { setScanMode('pc'); setLocalError(null); }}
              className={`flex h-12 items-center justify-center gap-2 rounded-md text-[0.85rem] font-extrabold transition-all duration-150 ${
                scanMode === 'pc' ? 'bg-brand text-brand-contrast shadow-brand' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name="upload" size={16} /> {t('modeSendPc')}
            </button>
            <button
              type="button"
              onClick={() => { setScanMode('local'); setActive(false); }}
              className={`flex h-12 items-center justify-center gap-2 rounded-md text-[0.85rem] font-extrabold transition-all duration-150 ${
                scanMode === 'local' ? 'bg-ok text-white shadow-ok' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name="smartphone" size={16} /> {t('modeLocal')}
            </button>
          </div>

          <div className="flex flex-col gap-3 p-3.5">
            {/* Connection status */}
            {scanMode === 'pc' ? (
              <div
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[0.76rem] font-bold ${
                  status.connected ? 'border-ok/25 bg-ok/12 text-ok' : 'border-warn/25 bg-warn/12 text-warn'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Icon name={status.connected ? 'wifi' : 'alert'} size={14} />
                  {status.connected ? t('connected') : `${t('notConnected')} — ${t('notPaired')}`}
                </span>
                <span className="mono truncate text-[0.68rem] font-semibold opacity-80" dir="ltr">
                  {status.connected ? t('readyToSend') : status.url || t('waitingPairing')}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-info/25 bg-info/12 px-3 py-2 text-[0.76rem] font-bold text-info">
                <span className="flex items-center gap-1.5">
                  <Icon name="info" size={14} /> {t('localModeHint')}
                </span>
                <Badge tone="info">{productsReady ?? 0}</Badge>
              </div>
            )}

            {/* Camera */}
            {!active ? (
              <button
                type="button"
                onClick={() => setActive(true)}
                className={`flex w-full flex-col items-center gap-1.5 rounded-xl py-8 font-black text-white shadow-2 transition-transform active:scale-[0.98] ${
                  scanMode === 'pc' ? 'bg-brand shadow-brand' : 'bg-ok shadow-ok'
                }`}
              >
                <Icon name="camera" size={34} strokeWidth={1.8} />
                <span className="text-[1rem]">{scanMode === 'pc' ? t('openCameraSend') : t('openCameraLocal')}</span>
                <span className="text-[0.72rem] font-semibold opacity-80">
                  {scanMode === 'pc' ? t('scanSendsDirect') : t('scanSearchesLocal')}
                </span>
              </button>
            ) : (
              <CameraScanner onDetected={(v) => { handleDetected(v).catch(console.error); }} onClose={() => setActive(false)} continuous />
            )}

            {/* Last scanned code — high contrast */}
            {lastBarcode && (
              <div className="anim-pop rounded-xl bg-rail px-4 py-3 text-center text-white">
                <p className="text-[0.68rem] font-bold text-rail-text">
                  {scanMode === 'pc' ? t('lastSentBarcode') : t('lastLocalBarcode')}
                </p>
                <p className="mono mt-0.5 break-all text-[1.15rem] font-black tracking-widest" dir="ltr">{lastBarcode}</p>
              </div>
            )}

            {/* Local lookup result */}
            {scanMode === 'local' && (localProduct || localError) && (
              localProduct ? (
                <div className="flex items-center gap-3 rounded-lg border border-ok/25 bg-ok/12 p-3">
                  {localProduct.image ? (
                    <img src={localProduct.image} alt="" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-surface text-ink-muted">
                      <Icon name="image" size={20} strokeWidth={1.6} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.86rem] font-extrabold text-ink">{localProduct.name}</p>
                    <p className="mono truncate text-[0.68rem] font-semibold text-ink-muted" dir="ltr">{localProduct.barcode}</p>
                    <p className="num mt-0.5 text-[0.84rem] font-black text-brand">{formatMoney(localProduct.sellingPrice, currency)}</p>
                  </div>
                  <Badge tone={localProduct.stockQuantity <= localProduct.minimumStock ? 'warn' : 'ok'}>
                    {t('stock')}: {localProduct.stockQuantity}
                  </Badge>
                </div>
              ) : (
                <p className="flex items-center justify-center gap-1.5 rounded-lg border border-danger/25 bg-danger/12 px-3 py-2 text-[0.78rem] font-bold text-danger">
                  <Icon name="alert" size={14} /> {localError}
                </p>
              )
            )}

            {/* Manual entry fallback */}
            <Field label={t('manualEntry')} hint={t('manualEntryHint')}>
              <span className="flex gap-2">
                <Input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
                  placeholder={t('barcode')}
                  className="mono flex-1"
                  dir="ltr"
                  inputMode="numeric"
                />
                <Button icon={scanMode === 'pc' ? 'upload' : 'search'} className="shrink-0" disabled={!manualCode.trim()} onClick={submitManual}>
                  {scanMode === 'pc' ? t('send') : t('search')}
                </Button>
              </span>
            </Field>
          </div>
        </Card>

        {/* History */}
        {historyForMode.length > 0 && (
          <Card
            padded={false}
            title={`${t('historyTitle')} (${historyForMode.length})`}
            icon="history"
            actions={
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setHistory([])}>
                {t('clearHistory')}
              </Button>
            }
          >
            <ul className="scroll-y max-h-56 divide-y divide-line overflow-y-auto">
              {historyForMode.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <span className="mono min-w-0 truncate text-[0.8rem] font-bold text-ink" dir="ltr">{h.code}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="num text-[0.68rem] font-semibold text-ink-muted">
                      {new Date(h.at).toLocaleTimeString('fr-DZ')}
                    </span>
                    <Badge tone={h.sent ? 'ok' : 'danger'} icon={h.sent ? 'check' : 'x'}>
                      {h.sent ? t('sentBadge') : t('failedBadge')}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <PhonePairingPanel />

        <p className="pb-2 text-center text-[0.7rem] font-semibold leading-relaxed text-ink-muted">
          {t('phoneScannerFooter')}
        </p>
      </div>
    </>
  );
}
