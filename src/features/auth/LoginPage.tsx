import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { Icon, LogoMark } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { LOCALE_OPTIONS } from '@/i18n';
import { AuthService } from '@/services/auth/auth.service';
import { useAppStore } from '@/app/store/app.store';
import { toastError } from '@/app/store/toast.store';

const HIGHLIGHTS = [
  { icon: 'cart', key: 'loginFeature_pos' },
  { icon: 'wallet', key: 'loginFeature_installments' },
  { icon: 'layers', key: 'loginFeature_inventory' },
  { icon: 'chart', key: 'loginFeature_reports' },
] as const;

export function LoginPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const setAuth = useAppStore((s) => s.setAuth);
  const setLocale = useAppStore((s) => s.setLocale);
  const locale = useAppStore((s) => s.locale);
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!username.trim() || !password) {
      setError(t('requiredField'));
      return;
    }
    setBusy(true);
    try {
      const service = new AuthService();
      const user = await service.login(username.trim(), password);
      const permissions = await service.getPermissions(user.id);
      setAuth(
        { id: user.id, username: user.username, displayName: user.displayName, roleId: user.roleId },
        permissions,
      );
      navigate('/', { replace: true });
    } catch {
      const msg = t('invalidCredentials');
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-bg">
      {/* Brand panel */}
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
            <p className="text-[0.72rem] font-bold text-white/55">Apex POS Studio</p>
          </div>
        </div>
        <div className="relative">
          <h1 className="max-w-sm text-[2.1rem] font-black leading-[1.25] text-white">
            {t('loginHeroTitle')}
          </h1>
          <p className="mt-3 max-w-sm text-[0.88rem] font-semibold leading-relaxed text-white/65">
            {t('loginHeroSubtitle')}
          </p>
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
        <p className="relative text-[0.7rem] font-semibold text-white/40">
          {t('loginFooterNote')}
        </p>
      </aside>

      {/* Form */}
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

        <form onSubmit={submit} noValidate className="panel anim-in w-full max-w-sm rounded-xl border border-line p-7 shadow-2">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <LogoMark size={38} />
            <div>
              <p className="text-[1rem] font-black text-ink">{t('appName')}</p>
              <p className="text-[0.7rem] font-bold text-ink-muted">Apex POS Studio</p>
            </div>
          </div>

          <h2 className="text-[1.3rem] font-black text-ink">{t('login')}</h2>
          <p className="mt-1 text-[0.8rem] font-semibold text-ink-muted">{t('loginSubtitle')}</p>

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[0.78rem] font-bold text-ink-2">{t('username')}</span>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-muted">
                  <Icon name="user" size={16} />
                </span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  placeholder={t('username')}
                  className="ps-9"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.78rem] font-bold text-ink-2">{t('password')}</span>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-muted">
                  <Icon name="lock" size={16} />
                </span>
                <Input
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="ps-9 pe-10"
                />
                <button
                  type="button"
                  onClick={() => setReveal(!reveal)}
                  aria-label={reveal ? t('hide') : t('show')}
                  className="absolute inset-y-0 end-2 flex items-center text-ink-muted transition-colors hover:text-ink"
                >
                  <Icon name={reveal ? 'eye-off' : 'eye'} size={16} />
                </button>
              </div>
            </label>
          </div>

          {error && (
            <p className="anim-pop mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[0.78rem] font-bold text-danger">
              <Icon name="alert" size={14} strokeWidth={2.4} /> {error}
            </p>
          )}

          <Button type="submit" size="lg" loading={busy} className="mt-6 w-full" icon={busy ? undefined : 'logout'}>
            {t('login')}
          </Button>

          <p className="mt-5 text-center text-[0.7rem] font-semibold text-ink-muted">
            {t('loginFooterNote')}
          </p>
        </form>
      </main>
    </div>
  );
}
