import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, getDeviceId } from '@/database/db';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, Select, Spinner, Textarea, Toggle,
} from '@/components/ui';
import { Icon, LogoMark, type IconName } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { useAppStore } from '@/app/store/app.store';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import { SettingsService, UserService } from '@/services/settings/settings.service';
import { BackupService } from '@/services/backup/backup.service';
import { AutoBackupService } from '@/services/backup/autoBackup.service';
import { LanSyncService } from '@/services/sync/lan-sync.service';
import { getLicenseInfo, appVersion } from '@/services/license/license.service';
import { ACCENTS } from '@/config/theme';
import { exportToXlsx } from '@/utils/export';
import { formatDateTime, formatMoney } from '@/utils/format';
import { LOCALE_OPTIONS, type Locale } from '@/i18n';
import { DesktopSyncPanel } from '@/components/sync/DesktopSyncPanel';
import { PhonePairingPanel } from '@/components/sync/PhonePairingPanel';
import type { Permission, Role, User } from '@/types';

/* ------------------------------------------------------------------ */
/* Section model                                                       */
/* ------------------------------------------------------------------ */

type SectionId = 'store' | 'appearance' | 'users' | 'backup' | 'sync' | 'license' | 'about';

interface SectionDef {
  id: SectionId;
  icon: IconName;
  labelKey: string;
  permission?: Permission;
}

const SECTIONS: SectionDef[] = [
  { id: 'store', icon: 'home', labelKey: 'storeInfo' },
  { id: 'appearance', icon: 'sun', labelKey: 'appearance' },
  { id: 'users', icon: 'users', labelKey: 'users', permission: 'users.manage' },
  { id: 'backup', icon: 'database', labelKey: 'backupData' },
  { id: 'sync', icon: 'refresh', labelKey: 'syncDevices' },
  { id: 'license', icon: 'key', labelKey: 'license' },
  { id: 'about', icon: 'info', labelKey: 'about' },
];

const CURRENCIES = ['DZD', 'EUR', 'USD'];

export function SettingsPage() {
  const { t } = useT();
  const hasPermission = useAppStore((s) => s.hasPermission);
  const [active, setActive] = useState<SectionId>('store');
  const isDesktop = useMemo(() => typeof window !== 'undefined' && !!window.desktop?.isDesktop, []);

  const sections = useMemo(
    () => SECTIONS.filter((s) => !s.permission || hasPermission(s.permission)),
    [hasPermission],
  );

  useEffect(() => {
    if (!sections.some((s) => s.id === active)) setActive(sections[0]?.id ?? 'store');
  }, [sections, active]);

  return (
    <>
      <PageHeader icon="cog" title={t('settings')} subtitle={t('settingsSubtitle')} />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start lg:gap-5">
        <nav className="panel no-scrollbar flex gap-1.5 overflow-x-auto rounded-lg border border-line p-1.5 lg:sticky lg:top-0 lg:flex-col lg:overflow-visible">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-current={active === s.id}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[0.82rem] font-bold transition-colors lg:w-full ${
                active === s.id ? 'bg-brand/12 text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <Icon name={s.icon} size={16} />
              <span className="whitespace-nowrap">{t(s.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div key={active} className="anim-in min-w-0">
          {active === 'store' && <StoreSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'users' && <UsersSection canManage={hasPermission('users.manage')} />}
          {active === 'backup' && <BackupSection />}
          {active === 'sync' && <SyncSection isDesktop={isDesktop} />}
          {active === 'license' && <LicenseSection />}
          {active === 'about' && <AboutSection isDesktop={isDesktop} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Store info                                                          */
/* ------------------------------------------------------------------ */

interface StoreForm {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeEmail: string;
  currency: string;
  defaultInstallments: number;
  storeLogo: string;
  receiptFooter: string;
}

function StoreSection() {
  const { t } = useT();
  const setStoreName = useAppStore((s) => s.setStoreName);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const [form, setForm] = useState<StoreForm | null>(null);
  const [saved, setSaved] = useState<StoreForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await new SettingsService().get();
        const rf = await getDb().settings.get('receiptFooter');
        if (!alive) return;
        const next: StoreForm = {
          storeName: s.storeName ?? '',
          storePhone: s.storePhone ?? '',
          storeAddress: s.storeAddress ?? '',
          storeEmail: s.storeEmail ?? '',
          currency: s.currency ?? 'DZD',
          defaultInstallments: Number(s.defaultInstallments ?? 12),
          storeLogo: s.storeLogo ?? '',
          receiptFooter: typeof rf?.value === 'string' ? rf.value : '',
        };
        setForm(next);
        setSaved(next);
      } catch {
        /* db not ready */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (!form) return <SectionSkeleton />;

  const set = <K extends keyof StoreForm>(key: K, value: StoreForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) {
      setErrors((er) => ({ ...er, logo: t('logoSizeError') }));
      return;
    }
    setErrors((er) => ({ ...er, logo: '' }));
    const reader = new FileReader();
    reader.onload = () => set('storeLogo', String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const next: Record<string, string> = {};
    if (!form.storeName.trim()) next.storeName = t('requiredField');
    if (!Number.isFinite(form.defaultInstallments) || form.defaultInstallments < 1) {
      next.defaultInstallments = t('invalidAmount');
    }
    setErrors((er) => ({ ...er, ...next }));
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await new SettingsService().update({
        storeName: form.storeName.trim(),
        storePhone: form.storePhone.trim(),
        storeAddress: form.storeAddress.trim(),
        storeEmail: form.storeEmail.trim(),
        currency: form.currency,
        defaultInstallments: form.defaultInstallments,
        storeLogo: form.storeLogo || undefined,
      });
      await getDb().settings.put({ key: 'receiptFooter', value: form.receiptFooter });
      setStoreName(form.storeName.trim());
      setCurrency(form.currency);
      setSaved(form);
      toastSuccess(t('savedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setForm(saved);
    setErrors({});
  };

  return (
    <Card
      icon="home"
      title={t('storeInfo')}
      subtitle={t('storeSectionHint')}
      actions={dirty ? <Badge tone="warn" icon="alert">{t('unsavedChanges')}</Badge> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('storeName')} required error={errors.storeName}>
          <Input value={form.storeName} onChange={(e) => set('storeName', e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('storePhone')}>
          <Input
            value={form.storePhone}
            onChange={(e) => set('storePhone', e.target.value)}
            placeholder={t('storePhonePlaceholder')}
            dir="ltr"
            className="num"
            maxLength={30}
          />
        </Field>
        <Field label={t('storeEmail')} className="sm:col-span-2">
          <Input
            value={form.storeEmail}
            onChange={(e) => set('storeEmail', e.target.value)}
            type="email"
            dir="ltr"
            maxLength={80}
          />
        </Field>
        <Field label={t('storeAddress')} className="sm:col-span-2">
          <Input value={form.storeAddress} onChange={(e) => set('storeAddress', e.target.value)} maxLength={160} />
        </Field>
        <Field label={t('currency')}>
          <Select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('defaultInstallments')} error={errors.defaultInstallments}>
          <Input
            type="number"
            min={1}
            max={60}
            value={form.defaultInstallments}
            onChange={(e) => set('defaultInstallments', Number(e.target.value))}
            className="num"
            dir="ltr"
          />
        </Field>

        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-[0.78rem] font-bold text-ink-2">{t('storeLogo')}</span>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
            {form.storeLogo ? (
              <img
                src={form.storeLogo}
                alt=""
                className="h-16 w-16 shrink-0 rounded-md border border-line bg-white object-contain p-1"
              />
            ) : (
              <span className="grid h-16 w-16 shrink-0 place-items-center gap-1 rounded-md border border-dashed border-line-strong text-ink-muted">
                <Icon name="image" size={20} strokeWidth={1.6} />
                <span className="text-[0.56rem] font-bold">{t('noLogo')}</span>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[0.72rem] font-semibold text-ink-muted">{t('storeLogoHint')}</p>
              {errors.logo && (
                <p className="mt-1 flex items-center gap-1 text-[0.72rem] font-bold text-danger">
                  <Icon name="alert" size={12} /> {errors.logo}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
                  {t('chooseImage')}
                </Button>
                {form.storeLogo && (
                  <Button size="sm" variant="danger" icon="trash" onClick={() => set('storeLogo', '')}>
                    {t('removeLogo')}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogo} />
        </div>

        <Field label={t('receiptFooter')} hint={t('receiptFooterHint')} className="sm:col-span-2">
          <Textarea
            rows={2}
            value={form.receiptFooter}
            onChange={(e) => set('receiptFooter', e.target.value)}
            maxLength={200}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {dirty && (
          <Button variant="ghost" icon="undo" onClick={discard}>
            {t('discard')}
          </Button>
        )}
        <Button icon="save" loading={saving} onClick={save} disabled={!dirty}>
          {t('saveChanges')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

function AppearanceSection() {
  const { t } = useT();
  const locale = useAppStore((s) => s.locale);
  const darkMode = useAppStore((s) => s.darkMode);
  const accent = useAppStore((s) => s.accent);
  const currency = useAppStore((s) => s.currency);
  const storeName = useAppStore((s) => s.storeName);
  const setLocale = useAppStore((s) => s.setLocale);
  const setDarkMode = useAppStore((s) => s.setDarkMode);
  const setAccent = useAppStore((s) => s.setAccent);

  const changeLocale = (value: Locale) => {
    setLocale(value);
    new SettingsService().update({ locale: value }).catch(() => {});
  };
  const changeDark = (value: boolean) => {
    setDarkMode(value);
    new SettingsService().update({ darkMode: value }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-4">
      <Card icon="sun" title={t('appearance')} subtitle={t('appearanceHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('language')} hint={t('languageHint')}>
            <Select value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
              {LOCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Icon name={darkMode ? 'moon' : 'sun'} size={17} className="shrink-0 text-ink-muted" />
              <div className="min-w-0">
                <p className="truncate text-[0.82rem] font-bold text-ink">
                  {darkMode ? t('themeDark') : t('themeLight')}
                </p>
                <p className="text-[0.7rem] font-semibold text-ink-muted">{t('currentTheme')}</p>
              </div>
            </div>
            <Toggle checked={darkMode} onChange={changeDark} label={t('darkMode')} />
          </div>

          <div className="sm:col-span-2">
            <Field label={t('accentColor')} hint={t('accentColorHint')}>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => {
                  const selected = a.id === accent;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAccent(a.id)}
                      aria-pressed={selected}
                      className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 transition-colors ${
                        selected
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:bg-surface-3'
                      }`}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/25"
                        style={{ background: `linear-gradient(140deg, rgb(${a.brand}), rgb(${a.purple}))` }}
                      />
                      <span className="text-[0.74rem] font-bold">{t(a.labelKey)}</span>
                      {selected && <Icon name="check" size={13} strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card icon="eye" title={t('livePreview')}>
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <LogoMark size={26} />
              <div className="min-w-0">
                <p className="truncate text-[0.9rem] font-black text-ink">{storeName || t('storeName')}</p>
                <p className="text-[0.68rem] font-semibold text-ink-muted">{t('previewInvoice')}</p>
              </div>
            </div>
            <Badge tone="brand" icon="receipt">
              {LOCALE_OPTIONS.find((o) => o.value === locale)?.label ?? locale}
            </Badge>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-line pt-3">
            <PreviewRow label={t('previewItem')} value={formatMoney(1500, currency)} />
            <PreviewRow label={t('previewItem')} value={formatMoney(2300, currency)} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[0.8rem] font-black text-ink">{t('total')}</span>
            <span className="num text-[1rem] font-black text-brand">{formatMoney(3800, currency)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[0.8rem]">
      <span className="font-semibold text-ink-2">{label}</span>
      <span className="num font-bold text-ink">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users & roles                                                       */
/* ------------------------------------------------------------------ */

function UsersSection({ canManage }: { canManage: boolean }) {
  const { t } = useT();
  const authUser = useAppStore((s) => s.authUser);
  const users = useLiveQuery(() => getDb().users.toArray(), [], [] as User[]);
  const roles = useLiveQuery(() => getDb().roles.toArray(), [], [] as Role[]);
  const [modal, setModal] = useState<{ mode: 'add' | 'edit' | 'reset'; user?: User } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const toggleActive = async (u: User) => {
    try {
      await new UserService().setUserActive(u.id, !u.isActive);
      toastSuccess(t('savedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
  };

  const doDelete = async (u: User) => {
    try {
      await new UserService().deleteUser(u.id);
      toastSuccess(t('deletedOk'));
    } catch (e) {
      const m = (e as Error).message;
      toastError(
        m === 'CANNOT_DELETE_ADMIN'
          ? t('cannotDeleteAdmin')
          : m === 'CANNOT_DELETE_LAST_USER'
            ? t('cannotDeleteLastUser')
            : m || t('errorGeneric'),
      );
    }
  };

  if (!canManage) {
    return (
      <Card icon="users" title={t('users')}>
        <EmptyState icon="lock" title={t('noPermission')} />
      </Card>
    );
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '—';
  const roleTone = (name: string): 'purple' | 'info' | 'brand' | 'muted' =>
    name === 'ADMIN' ? 'purple' : name === 'MANAGER' ? 'info' : name === 'CASHIER' ? 'brand' : 'muted';
  const roleLabel = (name: string) =>
    name === 'ADMIN' ? t('roleAdmin') : name === 'MANAGER' ? t('roleManager') : name === 'CASHIER' ? t('roleCashier') : name;

  return (
    <>
      <Card
        icon="users"
        title={t('users')}
        subtitle={t('usersSectionHint')}
        actions={
          <>
            <Badge tone="muted" icon="users">{t('usersCount', { count: users.length })}</Badge>
            <Button size="sm" icon="plus" onClick={() => setModal({ mode: 'add' })}>
              {t('addUser')}
            </Button>
          </>
        }
      >
        {users.length === 0 ? (
          <EmptyState icon="users" title={t('noUsersYet')} />
        ) : (
          <ul className="divide-y divide-line">
            {users.map((u) => {
              const rn = roleName(u.roleId);
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-3 text-[0.8rem] font-black text-ink-2">
                    {(u.displayName || u.username || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[0.86rem] font-bold text-ink">
                      <span className="truncate">{u.displayName || u.username}</span>
                      {authUser?.id === u.id && <Badge tone="brand">{t('youBadge')}</Badge>}
                    </p>
                    <p className="mono truncate text-[0.7rem] font-semibold text-ink-muted" dir="ltr">
                      @{u.username}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={roleTone(rn)} icon="shield">{roleLabel(rn)}</Badge>
                    <Badge tone={u.isActive ? 'ok' : 'muted'}>{u.isActive ? t('active') : t('inactive')}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton icon="edit" label={t('editUser')} size={30} onClick={() => setModal({ mode: 'edit', user: u })} />
                    <IconButton icon="key" label={t('resetPassword')} size={30} onClick={() => setModal({ mode: 'reset', user: u })} />
                    <IconButton
                      icon={u.isActive ? 'lock' : 'check'}
                      label={u.isActive ? t('deactivate') : t('activateUser')}
                      size={30}
                      onClick={() => toggleActive(u)}
                    />
                    {authUser?.id !== u.id && (
                      <IconButton icon="trash" label={t('delete')} size={30} variant="danger" onClick={() => setDeleteTarget(u)} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {modal && <UserModal modal={modal} roles={roles} onClose={() => setModal(null)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && doDelete(deleteTarget)}
        title={t('delete')}
        message={
          <span>
            {t('deleteUserConfirm')} <b>{deleteTarget?.displayName || deleteTarget?.username}</b>
          </span>
        }
        confirmLabel={t('delete')}
      />
    </>
  );
}

function UserModal({
  modal,
  roles,
  onClose,
}: {
  modal: { mode: 'add' | 'edit' | 'reset'; user?: User };
  roles: Role[];
  onClose: () => void;
}) {
  const { t } = useT();
  const isAdd = modal.mode === 'add';
  const isReset = modal.mode === 'reset';
  const [form, setForm] = useState({
    username: modal.user?.username ?? '',
    displayName: modal.user?.displayName ?? '',
    roleId: modal.user?.roleId ?? roles[0]?.id ?? '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const score = pwScore(form.password);
  const strengthLabel = form.password
    ? score <= 2
      ? t('passwordWeak')
      : score === 3
        ? t('passwordMedium')
        : t('passwordStrong')
    : '';
  const strengthTone: 'danger' | 'warn' | 'ok' = score <= 2 ? 'danger' : score === 3 ? 'warn' : 'ok';
  const title = isAdd ? t('addUser') : isReset ? t('resetPassword') : t('editUser');

  const submit = async () => {
    const next: Record<string, string> = {};
    if (isAdd) {
      if (!form.username.trim()) next.username = t('usernameRequired');
      if (!form.displayName.trim()) next.displayName = t('displayNameRequired');
      if (!form.roleId) next.roleId = t('roleRequired');
    }
    const needPw = isAdd || isReset || !!form.password;
    if (needPw) {
      if (form.password.length < 6) next.password = t('passwordTooShort');
      else if (form.password !== form.confirm) next.confirm = t('passwordsMismatch');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const svc = new UserService();
      if (isAdd) {
        await svc.createUser({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          roleId: form.roleId,
        });
        toastSuccess(t('addedOk'));
      } else if (isReset) {
        await svc.updateUser(modal.user!.id, { password: form.password });
        toastSuccess(t('savedOk'));
      } else {
        await svc.updateUser(modal.user!.id, {
          displayName: form.displayName.trim(),
          roleId: form.roleId,
          ...(form.password ? { password: form.password } : {}),
        });
        toastSuccess(t('updatedOk'));
      }
      onClose();
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'USERNAME_TAKEN') setErrors((er) => ({ ...er, username: t('usernameTaken') }));
      else if (m === 'USER_NOT_FOUND') toastError(t('userNotFound'));
      else toastError(m || t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={modal.user ? `@${modal.user.username}` : t('users')}
      icon={isReset ? 'key' : 'user'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button icon="save" loading={saving} onClick={submit}>{t('save')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!isReset && (
          <>
            <Field label={t('username')} required error={errors.username}>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                disabled={!isAdd}
                className="mono"
                dir="ltr"
                maxLength={40}
              />
            </Field>
            <Field label={t('fullName')} required error={errors.displayName}>
              <Input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                maxLength={80}
              />
            </Field>
            <Field label={t('role')} required error={errors.roleId}>
              <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {isReset && <p className="text-[0.76rem] font-semibold text-ink-muted">{t('resetPasswordHint')}</p>}

        <Field
          label={isAdd || isReset ? t('newPassword') : t('password')}
          required={isAdd || isReset}
          hint={!isAdd && !isReset ? t('leavePasswordEmpty') : undefined}
          error={errors.password}
        >
          <div className="relative">
            <Input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="pe-10"
              dir="ltr"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? t('hide') : t('show')}
              className="absolute inset-y-0 end-2 flex items-center text-ink-muted hover:text-ink"
            >
              <Icon name={showPw ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>
        </Field>

        {form.password && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[0.66rem] font-black uppercase tracking-wide text-ink-muted">
              {t('passwordStrength')}
            </span>
            <div className="flex h-1.5 flex-1 gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full transition-colors ${
                    i < score ? (score <= 2 ? 'bg-danger' : score === 3 ? 'bg-warn' : 'bg-ok') : 'bg-surface-3'
                  }`}
                />
              ))}
            </div>
            <Badge tone={strengthTone}>{strengthLabel}</Badge>
          </div>
        )}

        <Field label={t('confirmPassword')} required={isAdd || isReset} error={errors.confirm}>
          <Input
            type={showPw ? 'text' : 'password'}
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            dir="ltr"
            autoComplete="new-password"
          />
        </Field>
      </div>
    </Modal>
  );
}

function pwScore(pw: string): number {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

/* ------------------------------------------------------------------ */
/* Backup & data                                                       */
/* ------------------------------------------------------------------ */

function BackupSection() {
  const { t } = useT();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const [autoEnabled, setAutoEnabled] = useState(() => AutoBackupService.isEnabled());
  const [lastDate, setLastDate] = useState<string | null>(() => AutoBackupService.getLastDate());
  const [running, setRunning] = useState(false);
  const sizeRow = useLiveQuery(() => getDb().settings.get('lastAutoBackupSizeKB'), [], undefined);
  const size = typeof sizeRow?.value === 'string' ? sizeRow.value : '';

  const exportBackup = async () => {
    setExporting(true);
    try {
      const svc = new BackupService();
      const payload = await svc.createBackup();
      const saved = await svc.downloadBackup(payload);
      toastSuccess(saved.uri ? t('backupSavedDocuments', { file: saved.fileName }) : t('backupCreated'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setExporting(false);
    }
  };

  const onPickRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPendingFile(file);
  };

  const doRestore = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    setRestoring(true);
    try {
      const text = await readFileText(file);
      const svc = new BackupService();
      await svc.restoreBackup(svc.parseBackupFile(text));
      toastSuccess(t('restoreSuccess'));
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      const m = (e as Error)?.message;
      toastError(m === 'INVALID_BACKUP_FILE' ? t('invalidBackupFile') : t('errorGeneric'));
      setRestoring(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await AutoBackupService.runNow();
      setLastDate(AutoBackupService.getLastDate());
      if (r.did) toastSuccess(t('backupCreated'));
      else toastError(t('errorGeneric'));
    } catch {
      toastError(t('errorGeneric'));
    } finally {
      setRunning(false);
    }
  };

  const downloadLast = async () => {
    try {
      const saved = await AutoBackupService.downloadLast();
      toastSuccess(saved?.uri ? t('backupSavedDocuments', { file: saved.fileName }) : t('backupCreated'));
    } catch {
      toastError(t('errorGeneric'));
    }
  };

  const toggleAuto = (value: boolean) => {
    AutoBackupService.setEnabled(value);
    setAutoEnabled(value);
  };

  const exportTable = async (kind: 'products' | 'customers' | 'sales') => {
    try {
      const db = getDb();
      const date = new Date().toISOString().slice(0, 10);
      if (kind === 'products') {
        const rows = await db.products.toArray();
        exportToXlsx(
          rows.map((p) => ({
            [t('name')]: p.name,
            [t('sku')]: p.sku,
            [t('barcode')]: p.barcode,
            [t('purchasePrice')]: p.purchasePrice,
            [t('sellingPrice')]: p.sellingPrice,
            [t('stock')]: p.stockQuantity,
            [t('status')]: p.isActive ? t('active') : t('inactive'),
          })),
          `products-${date}.xlsx`,
          t('products'),
        );
      } else if (kind === 'customers') {
        const rows = await db.customers.toArray();
        exportToXlsx(
          rows.map((c) => ({
            [t('customerNumber')]: c.customerNumber,
            [t('fullName')]: c.fullName,
            [t('phone')]: c.phone ?? '',
            [t('address')]: c.address ?? '',
            [t('nationalId')]: c.nationalId ?? '',
            [t('notes')]: c.notes ?? '',
          })),
          `customers-${date}.xlsx`,
          t('customers'),
        );
      } else {
        const rows = await db.sales.toArray();
        const names = new Map((await db.customers.toArray()).map((c) => [c.id, c.fullName]));
        exportToXlsx(
          rows.map((s) => ({
            [t('invoiceNumber')]: s.invoiceNumber,
            [t('customer')]: (s.customerId ? names.get(s.customerId) : undefined) ?? t('walkInCustomer'),
            [t('date')]: formatDateTime(s.saleDate, 'fr-DZ'),
            [t('saleType')]: s.saleType === 'CASH' ? t('cashSale') : t('installmentSale'),
            [t('total')]: s.totalAmount,
            [t('paid')]: s.paidAmount,
            [t('remaining')]: s.remainingAmount,
            [t('status')]: t(`status_${s.status}`),
          })),
          `sales-${date}.xlsx`,
          t('sales'),
        );
      }
      toastSuccess(t('exportData'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card icon="database" title={t('backupData')} subtitle={t('backupSectionHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-[0.84rem] font-bold text-ink">{t('exportBackup')}</p>
            <p className="mt-0.5 text-[0.72rem] font-semibold text-ink-muted">{t('exportBackupHint')}</p>
            <Button icon="download" loading={exporting} onClick={exportBackup} className="mt-2.5">
              {t('backup')}
            </Button>
          </div>
          <div className="rounded-lg border border-danger/25 bg-danger/8 p-3">
            <p className="text-[0.84rem] font-bold text-ink">{t('importRestore')}</p>
            <p className="mt-0.5 text-[0.72rem] font-semibold text-ink-muted">{t('importRestoreHint')}</p>
            <Button variant="danger" icon="upload" loading={restoring} onClick={() => restoreRef.current?.click()} className="mt-2.5">
              {t('restore')}
            </Button>
            <input
              ref={restoreRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={onPickRestore}
            />
          </div>
        </div>
      </Card>

      <Card icon="clock" title={t('autoBackup')}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.76rem] font-semibold text-ink-muted">{t('autoBackupHint')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={autoEnabled ? 'ok' : 'muted'}>
              {autoEnabled ? t('autoBackupEnabled') : t('autoBackupDisabled')}
            </Badge>
            <Toggle checked={autoEnabled} onChange={toggleAuto} label={t('autoBackup')} />
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <InfoTile label={t('lastRun')} value={lastDate ?? t('notRunYet')} />
          <InfoTile label={t('backupSize')} value={size ? `${size} KB` : t('never')} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" icon="refresh" loading={running} onClick={runNow}>
            {t('runNow')}
          </Button>
          <Button variant="secondary" icon="download" onClick={downloadLast}>
            {t('downloadLast')}
          </Button>
        </div>
      </Card>

      <Card icon="file" title={t('excelExports')} subtitle={t('excelExportsHint')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="box" onClick={() => exportTable('products')}>
            {t('exportProducts')}
          </Button>
          <Button variant="secondary" icon="users" onClick={() => exportTable('customers')}>
            {t('exportCustomers')}
          </Button>
          <Button variant="secondary" icon="receipt" onClick={() => exportTable('sales')}>
            {t('exportSales')}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!pendingFile}
        onClose={() => setPendingFile(null)}
        onConfirm={doRestore}
        title={t('restoreConfirmTitle')}
        message={t('restoreWarning')}
        confirmLabel={t('restore')}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sync & devices                                                      */
/* ------------------------------------------------------------------ */

function SyncSection({ isDesktop }: { isDesktop: boolean }) {
  const { t } = useT();
  const [deviceId, setDeviceId] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getDeviceId()
      .then((id) => {
        if (alive) setDeviceId(id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const copy = async () => {
    if (!deviceId) return;
    await copyText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.78rem] font-semibold text-ink-muted">{t('syncSectionHint')}</p>

      <Card icon="smartphone" title={t('deviceId')} subtitle={t('deviceIdHint')}>
        <div className="flex items-stretch gap-2">
          <code
            className="mono scroll-y flex-1 select-all overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center text-[0.9rem] font-bold text-ink"
            dir="ltr"
          >
            {deviceId || '…'}
          </code>
          <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={copy} className="shrink-0">
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      </Card>

      {isDesktop ? <DesktopSyncPanel /> : <PhonePairingPanel />}

      <ManualSyncCard />
    </div>
  );
}

function ManualSyncCard() {
  const { t } = useT();
  const [busy, setBusy] = useState<'export' | 'import' | 'auto' | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const lan = useMemo(() => new LanSyncService(), []);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const doExport = async () => {
    setBusy('export');
    try {
      const json = await lan.exportPayload();
      const fileName = `lan-sync-${Date.now()}.json`;
      const cap = (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({ path: fileName, data: json, directory: Directory.Documents });
        toastSuccess(t('lanSavedDocuments'));
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toastSuccess(t('lanDownloaded'));
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(null);
    }
  };

  const importRaw = async (raw: string) => {
    setBusy('import');
    try {
      await lan.importPayload(raw);
      toastSuccess(t('lanImported'));
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      toastError(`${t('lanInvalidFile')}${detail ? `: ${detail}` : ''}`.slice(0, 120));
      setBusy(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const raw = await readFileText(file);
    importRaw(raw);
  };

  const doAuto = async () => {
    setBusy('auto');
    try {
      const { SyncService } = await import('@/services/sync/sync.service');
      const result = await new SyncService().sync();
      if (result.ok) {
        toastSuccess(t('lanSyncOk'));
        setTimeout(() => location.reload(), 800);
      } else {
        const key = result.reason === 'unpaired'
          ? 'lanSyncUnpaired'
          : result.reason === 'timeout'
            ? 'lanSyncTimeout'
            : 'lanSyncFail';
        toastError(t(key));
        setBusy(null);
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
      setBusy(null);
    }
  };

  return (
    <Card
      icon="wifi"
      title={t('lanManualSync')}
      subtitle={t('lanImportHint')}
      actions={
        <Badge tone={online ? 'ok' : 'muted'} icon={online ? 'wifi' : 'alert'}>
          {online ? t('lanOnline') : t('lanOffline')}
        </Badge>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button icon="download" loading={busy === 'export'} onClick={doExport}>
          {t('lanExport')}
        </Button>
        <Button variant="secondary" icon="upload" loading={busy === 'import'} onClick={() => fileRef.current?.click()}>
          {t('lanImportFile')}
        </Button>
        <Button variant="secondary" icon="refresh" loading={busy === 'auto'} onClick={doAuto}>
          {t('lanAutoSync')}
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      </div>

      <button
        type="button"
        onClick={() => setPasteOpen((o) => !o)}
        className="mt-3 flex items-center gap-1 text-[0.76rem] font-bold text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name={pasteOpen ? 'chevron-down' : 'chevron-end'} size={14} /> {t('lanPasteJson')}
      </button>
      {pasteOpen && (
        <div className="mt-2 space-y-2">
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('jsonPlaceholder')}
            className="mono text-[0.74rem]"
            dir="ltr"
          />
          <Button
            variant="secondary"
            icon="upload"
            disabled={!text.trim()}
            loading={busy === 'import'}
            onClick={() => importRaw(text)}
          >
            {t('lanImportText')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* License                                                             */
/* ------------------------------------------------------------------ */

function LicenseSection() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ deviceId: string; licensed: boolean; storeName: string; expiry?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getLicenseInfo()
      .then((li) => {
        if (alive) setInfo({ deviceId: li.deviceId, licensed: li.licensed, storeName: li.storeName, expiry: li.expiry });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!info) return <SectionSkeleton />;

  const licensed = info.licensed;
  const expired = licensed && !!info.expiry && info.expiry < Date.now();

  let tone: 'ok' | 'warn' | 'danger' = licensed && !expired ? 'ok' : 'warn';
  const statusLabel = licensed
    ? expired
      ? t('licExpired')
      : info.expiry
        ? t('licActive')
        : t('licPermanent')
    : t('licInactive');
  if (expired) tone = 'danger';

  return (
    <Card
      icon="key"
      title={t('licStatus')}
      subtitle={t('license')}
      actions={
        <Button size="sm" icon="external" onClick={() => navigate('/license')}>
          {t('licManage')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone} icon={licensed && !expired ? 'shield' : 'alert'}>
            {statusLabel}
          </Badge>
          {licensed && !info.expiry && !expired && (
            <Badge tone="ok" icon="check">{t('licPermanent')}</Badge>
          )}
          {licensed && info.expiry && !expired && (
            <Badge tone="muted" icon="clock">
              {t('licExpiresOn')}: {new Date(info.expiry).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB')}
            </Badge>
          )}
          {licensed && info.storeName && (
            <Badge tone="muted" icon="home">{info.storeName}</Badge>
          )}
        </div>
        <div>
          <p className="mb-1 text-[0.72rem] font-black uppercase tracking-wide text-ink-muted">{t('deviceId')}</p>
          <code
            className="mono block select-all break-all rounded-md border border-line bg-surface-2 px-3 py-2 text-[0.8rem] font-bold text-ink"
            dir="ltr"
          >
            {info.deviceId || '…'}
          </code>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

function AboutSection({ isDesktop }: { isDesktop: boolean }) {
  const { t } = useT();
  const locale = useAppStore((s) => s.locale);
  const darkMode = useAppStore((s) => s.darkMode);
  const [version, setVersion] = useState('');

  useEffect(() => {
    let alive = true;
    void appVersion()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isAndroid = useMemo(() => {
    try {
      return !!(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor?.isNativePlatform();
    } catch {
      return false;
    }
  }, []);

  const target = isDesktop ? t('targetDesktop') : isAndroid ? t('targetAndroid') : t('targetBrowser');
  const edition = import.meta.env.VITE_BUILD_EDITION === 'trial' ? t('editionTrial') : t('editionFull');

  return (
    <Card icon="info" title={t('about')} subtitle={t('aboutHint')}>
      <div className="flex items-center gap-3">
        <LogoMark size={42} />
        <div className="min-w-0">
          <p className="truncate text-[1.1rem] font-black text-ink">{t('appName')}</p>
          <p className="text-[0.72rem] font-bold text-ink-muted">{t('poweredBy')}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <InfoTile label={t('appVersion')} value={version || t('versionUnavailable')} />
        <InfoTile label={t('buildTarget')} value={target} />
        <InfoTile label={t('buildEdition')} value={edition} />
        <InfoTile label={t('language')} value={LOCALE_OPTIONS.find((o) => o.value === locale)?.label ?? locale} />
        <InfoTile label={t('currentTheme')} value={darkMode ? t('themeDark') : t('themeLight')} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function SectionSkeleton() {
  const { t } = useT();
  return (
    <Card>
      <div className="flex items-center justify-center gap-2 py-12 text-ink-muted">
        <Spinner size={18} />
        <span className="text-[0.82rem] font-bold">{t('loading')}</span>
      </div>
    </Card>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className="text-[0.66rem] font-black uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-[0.84rem] font-bold text-ink" title={value}>{value}</p>
    </div>
  );
}

async function readFileText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}

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
