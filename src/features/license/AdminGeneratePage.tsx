import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Field, IconButton, Input, Select } from '@/components/ui';
import { Icon, LogoMark } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { LOCALE_OPTIONS } from '@/i18n';
import { ActivationError, apiVendorIssue, apiVendorLogin } from '@/services/license/activation.api';

/*
 * Vendor key generator. Codes are minted by the hosted activation service, so
 * the app no longer ships any signing key: it authenticates with the vendor API
 * key and asks the service for a code bound to one device.
 */

const DAY_MS = 86_400_000;
const MAX_HISTORY = 12;
const TOKEN_KEY = 'pos.vendor.token';

interface IssuedEntry {
  code: string;
  deviceId: string;
  name: string;
  days: number;
  validUntil?: string;
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

function errorKey(error: unknown): string {
  if (!(error instanceof ActivationError)) return 'adminIssueFailed';
  switch (error.code) {
    case 'invalid_credentials':
      return 'adminKeyInvalid';
    case 'invalid_device_id':
      return 'deviceIdRequired';
    case 'rate_limited':
      return 'adminRateLimited';
    case 'offline':
    case 'timeout':
      return 'licOfflineError';
    case 'server_unavailable':
    case 'unknown':
      return 'adminServerError';
    default:
      return 'adminIssueFailed';
  }
}

export function AdminGeneratePage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const setLocale = useAppStore((s) => s.setLocale);
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);

  const [token, setToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [apiKey, setApiKey] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [storeName, setStoreName] = useState('');
  const [preset, setPreset] = useState('30');
  const [customDays, setCustomDays] = useState('45');
  const [formErr, setFormErr] = useState('');

  const [issued, setIssued] = useState<IssuedEntry | null>(null);
  const [history, setHistory] = useState<IssuedEntry[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const presets = useMemo(
    () => [
      { value: '7', label: t('daysCount', { count: 7 }) },
      { value: '30', label: t('oneMonth') },
      { value: '90', label: t('threeMonths') },
      { value: '180', label: t('sixMonths') },
      { value: '365', label: t('oneYear') },
      { value: '0', label: t('permanentNoExpiry') },
      { value: 'custom', label: t('customManual') },
    ],
    [t],
  );

  const signIn = async () => {
    setAuthErr('');
    if (apiKey.trim().length < 8) {
      setAuthErr(t('adminApiKeyRequired'));
      return;
    }
    setAuthBusy(true);
    try {
      const session = await apiVendorLogin(apiKey.trim());
      setToken(session.token);
      setApiKey('');
      try {
        sessionStorage.setItem(TOKEN_KEY, session.token);
      } catch {
        /* private mode */
      }
    } catch (error) {
      setAuthErr(t(errorKey(error)));
    } finally {
      setAuthBusy(false);
    }
  };

  const issue = async () => {
    const id = deviceId.trim().toUpperCase().replace(/\s+/g, '');
    setFormErr('');
    if (!id) {
      setFormErr(t('deviceIdRequired'));
      return;
    }
    const days = preset === 'custom' ? Number(customDays) : Number(preset);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      setFormErr(t('invalidDays'));
      return;
    }

    setBusy(true);
    try {
      const result = await apiVendorIssue(token, {
        deviceId: id,
        name: name.trim(),
        phone: phone.trim(),
        storeName: storeName.trim(),
        durationDays: Math.round(days),
      });
      const entry: IssuedEntry = {
        code: result.code,
        deviceId: result.deviceId,
        name: name.trim(),
        days: result.durationDays,
        validUntil: result.validUntil ?? undefined,
      };
      setIssued(entry);
      setHistory((prev) => [entry, ...prev.filter((h) => h.code !== entry.code)].slice(0, MAX_HISTORY));
    } catch (error) {
      setFormErr(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (entry: IssuedEntry) => {
    await copyText(entry.code);
    setCopiedKey(entry.code);
    setTimeout(() => setCopiedKey((cur) => (cur === entry.code ? null : cur)), 2000);
  };

  const sendWhatsApp = (entry: IssuedEntry) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(t('whatsappKeyMessage', { code: entry.code }))}`, '_blank');
  };

  const lock = () => {
    setToken('');
    setApiKey('');
    setAuthErr('');
    setIssued(null);
    setHistory([]);
    setDeviceId('');
    setName('');
    setPhone('');
    setStoreName('');
    setFormErr('');
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  };

  const daysLabel = (days: number) => (days === 0 ? t('keyPermanent') : t('adminDurationDays', { days }));

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-bg">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-70"
        style={{
          background:
            'radial-gradient(620px 260px at 12% 0%, rgb(var(--brand-rgb) / 0.18), transparent 65%), radial-gradient(520px 240px at 92% 4%, rgb(var(--purple-rgb) / 0.14), transparent 62%)',
        }}
      />

      <div className="relative ms-auto flex items-center gap-2 p-4">
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          aria-label={t('language')}
          className="h-9 rounded-md border border-line bg-surface-2 px-2 text-[0.78rem] font-bold text-ink outline-none focus:border-brand"
        >
          {LOCALE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
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

      <main className="relative flex flex-1 items-start justify-center px-4 pb-10 sm:items-center">
        {!token ? (
          <div className="panel anim-in w-full max-w-sm rounded-xl border border-line p-7 shadow-2">
            <div className="flex items-center gap-3">
              <LogoMark size={38} />
              <div className="min-w-0">
                <p className="text-[1rem] font-black text-ink">{t('appName')}</p>
                <p className="text-[0.7rem] font-bold text-ink-muted">{t('adminGenSubtitle')}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
                <Icon name="shield" size={21} />
              </span>
              <div className="min-w-0">
                <h1 className="text-[1.15rem] font-black leading-tight text-ink">{t('adminLoginTitle')}</h1>
                <p className="mt-1 text-[0.74rem] font-semibold text-ink-muted">{t('adminLoginHint')}</p>
              </div>
            </div>

            <div className="mt-5">
              <Field label={t('adminApiKey')} error={authErr} required>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (authErr) setAuthErr('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void signIn();
                  }}
                  placeholder={t('adminApiKeyPlaceholder')}
                  autoComplete="off"
                  className="mono tracking-wider"
                  dir="ltr"
                />
              </Field>
              <p className="mt-1.5 flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink-muted">
                <Icon name="wifi" size={13} className="shrink-0" /> {t('adminOnlineNote')}
              </p>
            </div>

            <Button size="lg" icon="lock" loading={authBusy} onClick={signIn} className="mt-4 w-full">
              {t('adminLogin')}
            </Button>

            <div className="mt-5 border-t border-line pt-4">
              <Link
                to="/"
                className="flex items-center justify-center gap-1.5 text-[0.76rem] font-bold text-ink-muted transition-colors hover:text-brand"
              >
                <Icon name="chevron-start" size={14} /> {t('dashboard')}
              </Link>
              <Link
                to="/license"
                className="mt-2 flex items-center justify-center gap-1.5 text-[0.76rem] font-bold text-ink-muted transition-colors hover:text-brand"
              >
                <Icon name="chevron-start" size={14} /> {t('activationPageLink')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="anim-in flex w-full max-w-3xl flex-col gap-4">
            <div className="panel flex flex-wrap items-center gap-3 rounded-xl border border-line p-5 shadow-1">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
                <Icon name="key" size={21} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[1.2rem] font-black leading-tight text-ink">{t('adminGenTitle')}</h1>
                <p className="mt-1 text-[0.76rem] font-semibold text-ink-muted">{t('adminGenSubtitle')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" icon="chevron-start" onClick={() => navigate('/')}>
                  {t('dashboard')}
                </Button>
                <Link
                  to="/license"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 text-[0.78rem] font-bold text-ink transition-colors hover:border-line-strong hover:bg-surface-3"
                >
                  <Icon name="chevron-start" size={14} /> {t('activationPageLink')}
                </Link>
                <Button variant="secondary" icon="lock" onClick={lock}>
                  {t('lock')}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="panel flex flex-col gap-4 rounded-xl border border-line p-5 shadow-1">
                <ol className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3.5">
                  <li className="mb-1 text-[0.76rem] font-black text-ink">{t('adminStepsIntro')}</li>
                  {[t('adminStep1'), t('adminStep2'), t('adminStep3')].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-[0.76rem] font-semibold text-ink-2">
                      <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand/12 text-[0.6rem] font-black text-brand">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>

                <Field label={t('deviceIdFromClient')} required>
                  <Input
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
                    placeholder={t('deviceIdPlaceholder')}
                    className="mono tracking-wider"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('adminClientName')} required>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('adminClientNamePlaceholder')} />
                  </Field>
                  <Field label={t('adminStoreName')} required>
                    <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder={t('adminStoreNamePlaceholder')} />
                  </Field>
                </div>

                <Field label={t('adminClientPhone')} required>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('adminClientPhonePlaceholder')}
                    dir="ltr"
                    inputMode="tel"
                  />
                </Field>

                <Field label={t('duration')}>
                  <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {presets.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                {preset === 'custom' && (
                  <Field label={t('customDays')}>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      className="num"
                      dir="ltr"
                    />
                  </Field>
                )}

                {formErr && (
                  <p className="anim-pop flex items-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[0.78rem] font-bold text-danger">
                    <Icon name="alert" size={14} strokeWidth={2.4} /> {formErr}
                  </p>
                )}

                <Button size="lg" icon="sparkles" loading={busy} onClick={issue} className="w-full">
                  {t('generateKey')}
                </Button>
              </section>

              <section className="panel flex flex-col gap-4 rounded-xl border border-line p-5 shadow-1">
                {issued ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-[0.9rem] font-extrabold text-ink">
                        <Icon name="check" size={16} strokeWidth={2.4} className="text-ok" />
                        {t('generatedKey')}
                      </h2>
                      <Badge tone={issued.days === 0 ? 'ok' : 'info'} icon={issued.days === 0 ? 'shield' : 'clock'}>
                        {daysLabel(issued.days)}
                      </Badge>
                    </div>

                    <code
                      className="mono scroll-y select-all overflow-x-auto rounded-md border border-ok/25 bg-ok/10 px-3 py-3 text-center text-[0.95rem] font-bold tracking-[0.14em] text-ink"
                      dir="ltr"
                    >
                      {issued.code}
                    </code>

                    <dl className="grid gap-2 text-[0.76rem] font-semibold">
                      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
                        <dt className="text-ink-muted">{t('licDeviceCode')}</dt>
                        <dd className="mono truncate text-ink" dir="ltr">
                          {issued.deviceId}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
                        <dt className="text-ink-muted">{t('adminClientName')}</dt>
                        <dd className="truncate text-ink">{issued.name || '—'}</dd>
                      </div>
                      {issued.validUntil && (
                        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
                          <dt className="text-ink-muted">{t('adminCodeValidUntil')}</dt>
                          <dd className="num text-ink">{new Date(issued.validUntil).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB')}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="secondary"
                        icon={copiedKey === issued.code ? 'check' : 'copy'}
                        onClick={() => void copy(issued)}
                        className="w-full"
                      >
                        {copiedKey === issued.code ? t('copied') : t('copyKey')}
                      </Button>
                      <Button variant="secondary" icon="link" onClick={() => sendWhatsApp(issued)} className="w-full">
                        {t('sendWhatsAppKey')}
                      </Button>
                    </div>

                    <p className="text-[0.7rem] font-semibold text-ink-muted">{t('sendKeyHint')}</p>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-4 py-10 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-ink-muted">
                      <Icon name="key" size={22} strokeWidth={1.7} />
                    </span>
                    <p className="text-[0.84rem] font-extrabold text-ink">{t('generateKey')}</p>
                    <p className="max-w-xs text-[0.74rem] font-semibold text-ink-muted">{t('adminStep2')}</p>
                  </div>
                )}
              </section>
            </div>

            <section className="panel rounded-xl border border-line shadow-1">
              <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-2">
                  <Icon name="history" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[0.9rem] font-extrabold text-ink">{t('keyHistory')}</h2>
                  <p className="num mt-0.5 text-[0.7rem] font-bold text-ink-muted">{history.length}</p>
                </div>
                {history.length > 0 && (
                  <IconButton icon="trash" label={t('clearHistory')} variant="danger" onClick={() => setHistory([])} />
                )}
              </header>

              {history.length === 0 ? (
                <p className="flex items-center justify-center gap-2 px-5 py-8 text-[0.78rem] font-semibold text-ink-muted">
                  <Icon name="info" size={15} /> {t('historyEmpty')}
                </p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {history.map((h) => (
                    <li key={h.code} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <code className="mono block truncate text-[0.8rem] font-bold text-ink" dir="ltr" title={h.code}>
                          {h.code}
                        </code>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.7rem] font-semibold text-ink-muted">
                          <span className="mono" dir="ltr">
                            {h.deviceId}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span>{daysLabel(h.days)}</span>
                          {h.name && (
                            <>
                              <span aria-hidden="true">•</span>
                              <span className="truncate">{h.name}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <IconButton
                          icon={copiedKey === h.code ? 'check' : 'copy'}
                          label={t('copyKey')}
                          variant="solid"
                          size={32}
                          onClick={() => void copy(h)}
                        />
                        <IconButton icon="link" label={t('sendWhatsAppKey')} variant="solid" size={32} onClick={() => sendWhatsApp(h)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="flex items-center justify-center gap-2 text-center text-[0.7rem] font-semibold text-ink-muted">
              <Icon name="wifi" size={14} /> {t('adminOnlineNote')}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
