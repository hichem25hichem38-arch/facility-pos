import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { getScanStatus, getStoredWsUrl, setStoredWsUrl } from '@/services/sync/scan.service';
import { CameraScanner } from '@/components/barcode/CameraScanner';
import { QRCode } from './QRCode';

/**
 * Normalises a user/QR-supplied address into a ws:// URL. Accepts a bare IP
 * (192.168.1.33), an IP:port, an http(s) URL or a full ws(s) URL, and appends
 * the default :8080 port only when the host has no explicit port.
 */
function normalizeWs(raw: string): string {
  let v = raw.trim();
  if (!v) return '';
  const scheme = /^wss:\/\//i.test(v) || /^https:\/\//i.test(v) ? 'wss://' : 'ws://';
  v = v.replace(/^(wss?|https?):\/\//i, '');
  // Keep everything from the first path/query character (the pairing token
  // arrives as ?key=… and must survive normalisation).
  const sep = v.search(/[/?]/);
  const host = sep === -1 ? v : v.slice(0, sep);
  const rest = sep === -1 ? '' : v.slice(sep);
  if (!host) return '';
  const hostWithPort = host.includes(':') ? host : `${host}:8080`;
  return `${scheme}${hostWithPort}${rest}`;
}

/**
 * Phone-side pairing UI: shows the desktop sync URL as a QR code, allows manual
 * entry or camera scanning, and reflects the live connection state.
 */
export function PhonePairingPanel() {
  const { t } = useT();
  const [url, setUrl] = useState(() => getStoredWsUrl() || '');
  const [stored, setStored] = useState(() => getStoredWsUrl());
  const [status, setStatus] = useState(() => getScanStatus());
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    setStatus(getScanStatus());
    const id = setInterval(() => setStatus(getScanStatus()), 1500);
    return () => clearInterval(id);
  }, []);

  const qrTarget = url.trim() ? normalizeWs(url) : status.url || stored || '';

  const applyStored = (value: string | null) => {
    setStoredWsUrl(value);
    setStored(value);
    setStatus(getScanStatus());
  };

  const save = () => {
    const raw = url.trim();
    if (!raw) {
      applyStored(null);
      setUrl('');
      toastSuccess(t('pairingCleared'));
      return;
    }
    const norm = normalizeWs(raw);
    setUrl(norm);
    applyStored(norm);
    toastSuccess(t('pairingSaved'));
    setTimeout(() => location.reload(), 800);
  };

  const clear = () => {
    applyStored(null);
    setUrl('');
    toastSuccess(t('pairingCleared'));
  };

  const onDetected = (value: string) => {
    const v = value.trim();
    const looksLikeUrl = /^wss?:\/\//i.test(v) || /^https?:\/\//i.test(v) || /^\d+\.\d+\.\d+\.\d+/.test(v);
    if (!looksLikeUrl) {
      toastError(t('invalidQrContent'));
      return;
    }
    const norm = normalizeWs(v);
    setScanOpen(false);
    setUrl(norm);
    applyStored(norm);
    toastSuccess(t('pairingSaved'));
    setTimeout(() => location.reload(), 800);
  };

  const connected = status.connected;
  const tone = connected ? 'ok' : status.connecting ? 'warn' : 'muted';
  const label = connected ? t('connected') : status.connecting ? t('connecting') : t('disconnected');

  return (
    <>
      <Card
        icon="link"
        title={t('phonePairing')}
        subtitle={t('phonePairingHint')}
        actions={
          <Badge tone={tone} icon={connected ? 'wifi' : status.connecting ? 'refresh' : 'wifi'}>
            {label}
          </Badge>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <div className="space-y-3">
            <Field label={t('serverUrl')} hint={t('pairingFooter')}>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                }}
                placeholder={t('wsUrlPlaceholder')}
                className="mono"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button icon="save" onClick={save}>
                {t('save')}
              </Button>
              <Button variant="secondary" icon="camera" onClick={() => setScanOpen(true)}>
                {t('scanQrToPair')}
              </Button>
              {stored && (
                <Button variant="ghost" icon="x" onClick={clear}>
                  {t('clearPairing')}
                </Button>
              )}
            </div>

            {status.url && (
              <p className="text-[0.72rem] font-semibold text-ink-muted">
                {t('currentUrl')}: <code className="mono select-all text-ink-2" dir="ltr">{status.url}</code>
              </p>
            )}
          </div>

          <div className="flex justify-center">
            {qrTarget ? (
              <QRCode text={qrTarget} size={168} />
            ) : (
              <div className="grid h-44 w-44 place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2 text-center text-ink-muted">
                <span className="flex flex-col items-center gap-2 px-4">
                  <Icon name="qr" size={38} strokeWidth={1.4} />
                  <span className="text-[0.72rem] font-bold">{t('pairingEmpty')}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={t('scanModalTitle')} icon="camera">
        {scanOpen && <CameraScanner onDetected={onDetected} onClose={() => setScanOpen(false)} />}
      </Modal>
    </>
  );
}
