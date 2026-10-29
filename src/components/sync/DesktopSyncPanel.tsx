import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Spinner } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { formatDateTime } from '@/utils/format';
import { getScanStatus, onClients } from '@/services/sync/scan.service';
import { QRCode } from './QRCode';

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* noop */
    }
    ta.remove();
  }
}

/**
 * Desktop-only sync server card. Reads live server info through the Electron
 * bridge (window.desktop) and falls back to a short "desktop only" hint when
 * the bridge is absent (plain browser / Android).
 */
export function DesktopSyncPanel() {
  const { t, locale } = useT();
  const isDesktop = typeof window !== 'undefined' && !!window.desktop?.isDesktop;

  const [info, setInfo] = useState<SyncServerInfo | null>(null);
  const [clients, setClients] = useState(0);
  const [portInput, setPortInput] = useState('8080');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    let alive = true;
    const load = async () => {
      try {
        const inf = await window.desktop?.getSyncInfo();
        if (!alive || !inf) return;
        setInfo(inf);
        setPortInput((prev) => (inf.port ? String(inf.port) : prev));
      } catch {
        /* bridge not ready yet */
      }
    };
    load();
    const id = setInterval(load, 4000);
    const off = onClients((c) => {
      if (alive) setClients(c);
    });
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [isDesktop]);

  if (!isDesktop) {
    return (
      <Card icon="monitor" title={t('desktopOnly')}>
        <p className="flex items-start gap-2 text-[0.8rem] font-semibold leading-relaxed text-ink-2">
          <Icon name="info" size={15} className="mt-0.5 shrink-0 text-ink-muted" />
          {t('desktopOnlyHint')}
        </p>
      </Card>
    );
  }

  const primaryUrl = info?.primaryWsUrl || info?.localWsUrl || '';
  const urls = info?.wsUrls?.length ? info.wsUrls : primaryUrl ? [primaryUrl] : [];
  const running = !!info?.running;

  const copy = async (value: string) => {
    await copyText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1500);
  };

  const restart = async () => {
    const port = Number(portInput);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      toastError(t('invalidPort'));
      return;
    }
    setBusy(true);
    try {
      const inf = await window.desktop?.restartSync(port);
      if (inf) {
        setInfo(inf);
        setPortInput(String(inf.port));
      }
      toastSuccess(t('restartOk'));
    } catch {
      toastError(t('restartFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon="refresh"
      title={t('syncServer')}
      subtitle={t('scanQrHint')}
      actions={
        <Badge tone={running ? 'ok' : 'warn'} icon={running ? 'wifi' : 'alert'}>
          {running ? t('serverRunning') : t('serverStopped')}
        </Badge>
      }
    >
      {!info ? (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
          <Spinner size={18} />
          <span className="text-[0.82rem] font-bold">{t('loading')}</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="space-y-4">
            {!running && (
              <p className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/10 px-3 py-2 text-[0.76rem] font-bold text-warn">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('serverOfflineHint')}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat icon="link" label={t('port')} value={String(info.port || 8080)} />
              <MiniStat icon="smartphone" label={t('connectedClients')} value={String(clients)} tone={clients > 0 ? 'ok' : undefined} />
              <MiniStat icon="scan" label={t('scanCount')} value={String(info.scanCount ?? 0)} />
              <MiniStat
                icon="clock"
                label={t('lastSync')}
                value={info.latestAt ? formatDateTime(info.latestAt, locale === 'ar' ? 'ar-DZ' : 'fr-DZ') : t('never')}
                small
              />
            </div>

            <div>
              <p className="mb-1.5 text-[0.74rem] font-black uppercase tracking-wide text-ink-muted">{t('lanAddresses')}</p>
              {info.ips?.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {info.ips.map((ip) => (
                    <Badge key={ip} tone="muted" icon="wifi">
                      <span className="mono" dir="ltr">{ip}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
              <ul className="space-y-1.5">
                {urls.map((u) => (
                  <li key={u} className="flex items-center gap-2">
                    <code
                      className="mono min-w-0 flex-1 select-all truncate rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[0.74rem] font-semibold text-ink"
                      dir="ltr"
                    >
                      {u}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={copied === u ? 'check' : 'copy'}
                      onClick={() => copy(u)}
                      className="shrink-0"
                    >
                      {copied === u ? t('copied') : t('copy')}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.7rem] font-semibold text-ink-muted">
                {t('firewallHint')} {info.port || 8080}.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="mb-2 text-[0.74rem] font-black text-ink">{t('changePort')}</p>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  type="number"
                  min={1024}
                  max={65535}
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  className="num w-28"
                  dir="ltr"
                  aria-label={t('port')}
                />
                <Button icon="refresh" loading={busy} onClick={restart}>
                  {t('restartServer')}
                </Button>
              </div>
              <p className="mt-1.5 text-[0.68rem] font-semibold text-ink-muted">{t('portHint')}</p>
            </div>
          </div>

          <div className="flex justify-center md:justify-start">
            {primaryUrl ? (
              <QRCode text={primaryUrl} size={176} />
            ) : (
              <div className="grid h-44 w-44 place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2 text-ink-muted">
                <Icon name="qr" size={40} strokeWidth={1.4} />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone,
  small,
}: {
  icon: 'link' | 'smartphone' | 'scan' | 'clock';
  label: string;
  value: string;
  tone?: 'ok';
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-[0.66rem] font-bold text-ink-muted">
        <Icon name={icon} size={12} /> {label}
      </span>
      <span
        className={`num mt-0.5 block truncate font-black ${small ? 'text-[0.72rem]' : 'text-[0.95rem]'} ${
          tone === 'ok' ? 'text-ok' : 'text-ink'
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Compact connection pill for the phone/browser side (used on the POS page).
 * Hidden on desktop, where the full DesktopSyncPanel is shown instead.
 */
export function PhoneSyncBadge() {
  const { t } = useT();
  const [status, setStatus] = useState(() => getScanStatus());
  const isDesktop = typeof window !== 'undefined' && !!window.desktop?.isDesktop;

  useEffect(() => {
    setStatus(getScanStatus());
    const id = setInterval(() => setStatus(getScanStatus()), 1500);
    return () => clearInterval(id);
  }, []);

  if (isDesktop) return null;

  const tone = status.connected ? 'ok' : status.connecting ? 'warn' : 'muted';
  const label = status.connected ? t('connected') : status.connecting ? t('connecting') : t('disconnected');
  return (
    <Badge tone={tone} icon={status.connected ? 'wifi' : status.connecting ? 'refresh' : 'wifi'}>
      {label}
      {status.url ? <span className="mono ms-1 hidden sm:inline" dir="ltr">· {status.url}</span> : null}
    </Badge>
  );
}
