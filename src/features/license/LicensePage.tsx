import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Input, Spinner } from '@/components/ui';
import { Icon, LogoMark } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { LOCALE_OPTIONS } from '@/i18n';
import { IS_FULL_EDITION } from '@/config/edition';
import { activate, getLicenseInfo, platformLabel } from '@/services/license/license.service';
import type { ActivationErrorCode } from '@/services/license/activation.api';

const HIGHLIGHTS = [
  { icon: 'cart', key: 'loginFeature_pos' },
  { icon: 'wallet', key: 'loginFeature_installments' },
  { icon: 'layers', key: 'loginFeature_inventory' },
  { icon: 'chart', key: 'loginFeature_reports' },
] as const;

/** Server error codes → page keys. Unknown codes fall back to a generic message. */
const ERROR_KEYS: Record<ActivationErrorCode, string> = {
  offline: 'licOfflineError',
  timeout: 'licOfflineError',
  invalid_code: 'licInvalidCode',
  code_expired: 'licCodeExpired',
  code_locked: 'licCodeLocked',
  device_mismatch: 'licDeviceMismatch',
  license_revoked: 'licRevoked',
  license_expired: 'licExpiredCode',
  invalid_device_id: 'licUnknownError',
  rate_limited: 'licRateLimited',
  invalid_credentials: 'licUnknownError',
  invalid_duration: 'licUnknownError',
  unknown_device: 'licUnknownError',
  server_unavailable: 'licServerError',
  unknown: 'licUnknownError',
};

interface LicenseInfo {
  deviceId: string;
  licensed: boolean;
  storeName: string;
  expiry?: number;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function LicensePage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const setLocale = useAppStore((s) => s.setLocale);
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);
  const dateLocale = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB';

  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activated, setActivated] = useState(false);

  const platform = useMemo(() => platformLabel(), []);
  const isDesktop = platform === 'desktop';
  const deviceKindKey = isDesktop ? 'desktopDevice' : platform === 'web' ? 'browserDevice' : 'mobileDevice';

  useEffect(() => {
    let alive = true;
    getLicenseInfo().then((lic) => {
      if (alive) setInfo({ deviceId: lic.deviceId, licensed: lic.licensed, storeName: lic.storeName, expiry: lic.expiry });
    });
    return () => {
      alive = false;
    };
  }, []);

  const expiry = useMemo(() => {
    if (!info?.expiry) return null;
    return {
      date: new Date(info.expiry).toLocaleDateString(dateLocale),
      daysLeft: Math.ceil((info.expiry - Date.now()) / 86_400_000),
    };
  }, [info?.expiry, dateLocale]);

  const runActivation = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 8) {
      setMsg({ type: 'err', text: t('licCodeRequired') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = await activate(trimmed);
      if (result.ok) {
        setActivated(true);
        setMsg({ type: 'ok', text: t('licSuccess') });
        setInfo((prev) =>
          prev ? { ...prev, licensed: true, storeName: result.storeName || prev.storeName, expiry: result.expiresAt ?? undefined } : prev,
        );
        setTimeout(() => navigate('/'), 1200);
      } else {
        setMsg({ type: 'err', text: t(ERROR_KEYS[result.code] ?? 'licUnknownError') });
      }
    } finally {
      setBusy(false);
    }
  };

  const copyId = async () => {
    if (!info?.deviceId) return;
    await copyText(info.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    if (!info?.deviceId) return;
    const text = `${t('licRequestMessage')}\n${t('licDeviceCode')}: ${info.deviceId}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const licensed = !!info?.licensed;
  const expired = licensed && !!expiry && expiry.daysLeft < 0;

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-bg">
      <aside className="relative hidden w-[46%] max-w-xl shrink-0 flex-col justify-between overflow-hidden bg-rail p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(680px 420px at 18% 8%, rgb(var(--brand-rgb) / 0.45), transparent 62%), radial-gradient(520px 380px at 92% 92%, rgb(var(--purple-rgb) / 0.32), transparent 60%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <LogoMark size={38} />
          <div>
            <p className="text-[1.05rem] font-black text-white">{t('appName')}</p>
            <p className="text-[0.72rem] font-bold text-white/60">Apex POS Studio</p>
          </div>
        </div>
        <div className="relative">
          <h1 className="max-w-sm text-[2.1rem] font-black leading-[1.25] text-white">{t('licenseHeroTitle')}</h1>
          <p className="mt-3 max-w-sm text-[0.88rem] font-semibold leading-relaxed text-white/70">{t('licenseHeroSubtitle')}</p>
          <ul className="mt-8 grid max-w-md gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <li key={h.key} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-white">
                  <Icon name={h.icon} size={16} />
                </span>
                <span className="text-[0.78rem] font-bold text-white/85">{t(h.key)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[0.7rem] font-semibold text-white/40">{t('loginFooterNote')}</p>
      </aside>

      <main className="scroll-y relative flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-5">
        <div className="absolute end-4 top-4 flex items-center gap-2">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
            aria-label={t('language')}
            className="h-9 rounded-md border border-line bg-surface-2 px-2 text-[0.78rem] font-bold text-ink outline-none focus:border-brand"
          >
            {LOCALE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={t('darkMode')}
            className="grid h-9 w-9 place-items-center rounded-md border border-line bg-surface-2 text-ink-2 transition-colors hover:text-ink"
          >
            <Icon name={darkMode ? 'sun' : 'moon'} size={17} />
          </button>
        </div>

        {!info ? (
          <div className="flex items-center gap-2 text-ink-muted">
            <Spinner size={18} />
            <span className="text-[0.84rem] font-bold">{t('loading')}</span>
          </div>
        ) : (
          <div className="panel anim-in w-full max-w-md rounded-xl border border-line p-7 shadow-2">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <LogoMark size={38} />
              <div>
                <p className="text-[1rem] font-black text-ink">{t('appName')}</p>
                <p className="text-[0.7rem] font-bold text-ink-muted">Apex POS Studio</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${
                  licensed && !expired ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn'
                }`}
              >
                <Icon name={licensed && !expired ? 'shield' : 'lock'} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[1.25rem] font-black leading-tight text-ink">
                  {licensed ? t('licActivatedTitle') : t('licLockedTitle')}
                </h2>
                <p className="mt-1 text-[0.76rem] font-semibold text-ink-muted">
                  {licensed ? info.storeName || t('licenseActive') : t('licLockedSubtitle')}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.72rem] font-bold text-ink-muted">
                  <Badge tone="muted" icon={isDesktop ? 'monitor' : 'smartphone'}>
                    {t(deviceKindKey)}
                  </Badge>
                  {licensed && !expired && expiry && <Badge tone={expiry.daysLeft <= 7 ? 'warn' : 'ok'} icon="clock">{expiry.date}</Badge>}
                  {licensed && !expired && !expiry && <Badge tone="ok" icon="shield">{t('permanentLicense')}</Badge>}
                  {expired && <Badge tone="danger" icon="alert">{t('licenseExpired')}</Badge>}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <span className="mb-1.5 block text-[0.78rem] font-bold text-ink-2">{t('licDeviceCode')}</span>
              <div className="flex items-stretch gap-2">
                <code
                  className="mono scroll-y flex-1 select-all overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center text-[0.95rem] font-bold tracking-widest text-ink"
                  dir="ltr"
                >
                  {info.deviceId || '…'}
                </code>
                <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={copyId} className="shrink-0">
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
              <p className="mt-1.5 text-[0.68rem] font-semibold text-ink-muted">
                {isDesktop ? t('licDeviceBoundDesktop') : t('licDeviceBoundMobile')}
              </p>
            </div>

            <div className="mt-4">
              {licensed && !expired && expiry && (
                <Banner tone={expiry.daysLeft <= 7 ? 'warn' : 'ok'} icon="clock">
                  {t('licValidUntil')}: {expiry.date} — {t('betaDaysLeft', { days: Math.max(0, expiry.daysLeft) })}
                </Banner>
              )}
              {licensed && !expired && !expiry && <Banner tone="ok" icon="shield">{t('permanentLicense')}</Banner>}
              {expired && <Banner tone="danger" icon="alert">{t('licenseExpired')}</Banner>}
            </div>

            {!licensed || expired ? (
              <>
                <ol className="mt-5 space-y-1.5 rounded-lg border border-line bg-surface-2 p-3.5">
                  <li className="mb-1 text-[0.76rem] font-black text-ink">{t('licStepsTitle')}</li>
                  {[t('licStep1'), t('licStep2'), t('licStep3')].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-[0.76rem] font-semibold text-ink-2">
                      <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand/12 text-[0.6rem] font-black text-brand">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>

                <Button variant="secondary" icon="link" onClick={shareWhatsApp} className="mt-4 w-full">
                  {t('licShareCode')}
                </Button>

                <div className="mt-5">
                  <label className="block">
                    <span className="mb-1.5 block text-[0.78rem] font-bold text-ink-2">{t('licCodeLabel')}</span>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !busy) void runActivation();
                      }}
                      placeholder={t('licCodePlaceholder')}
                      className="mono text-center tracking-[0.16em]"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={activated}
                    />
                  </label>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink-muted">
                    <Icon name="wifi" size={13} className="shrink-0" /> {t('licInternetNote')}
                  </p>
                </div>

                {msg && (
                  <p
                    className={`anim-pop mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[0.78rem] font-bold ${
                      msg.type === 'ok' ? 'border-ok/25 bg-ok/10 text-ok' : 'border-danger/25 bg-danger/10 text-danger'
                    }`}
                    role="status"
                  >
                    <Icon name={msg.type === 'ok' ? 'check' : 'alert'} size={14} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">{msg.text}</span>
                  </p>
                )}

                <Button size="lg" icon="key" loading={busy} onClick={runActivation} className="mt-4 w-full" disabled={activated}>
                  {busy ? t('licActivating') : t('activate')}
                </Button>
              </>
            ) : (
              <>
                {msg?.type === 'ok' && (
                  <p className="anim-pop mt-4 flex items-center gap-2 rounded-md border border-ok/25 bg-ok/10 px-3 py-2 text-[0.78rem] font-bold text-ok">
                    <Icon name="check" size={14} strokeWidth={2.4} /> {msg.text}
                  </p>
                )}
                <Button size="lg" icon="home" onClick={() => navigate('/')} className="mt-5 w-full">
                  {t('licOpenApp')}
                </Button>
              </>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <span className="text-[0.68rem] font-semibold text-ink-muted">{t('licSupportNote')}</span>
              {IS_FULL_EDITION && (
                <Link
                  to="/license/generate"
                  className="flex items-center gap-1.5 text-[0.74rem] font-bold text-ink-muted transition-colors hover:text-brand"
                >
                  <Icon name="key" size={14} /> {t('adminGeneratorLink')}
                </Link>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: 'ok' | 'warn' | 'danger'; icon: 'shield' | 'clock' | 'alert'; children: ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-ok/25 bg-ok/10 text-ok'
      : tone === 'warn'
        ? 'border-warn/25 bg-warn/10 text-warn'
        : 'border-danger/25 bg-danger/10 text-danger';
  return (
    <p className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[0.78rem] font-bold ${cls}`}>
      <Icon name={icon} size={15} strokeWidth={2.2} className="shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
