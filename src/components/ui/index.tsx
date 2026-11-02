import React, { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icons';
import { useToastStore } from '@/app/store/toast.store';
import { useT } from '@/hooks/useT';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-brand-contrast border border-transparent shadow-brand hover:bg-brand-hover active:translate-y-px',
  success:
    'bg-ok text-white border border-transparent shadow-ok hover:brightness-110 active:translate-y-px',
  secondary:
    'bg-surface-2 text-ink border border-line hover:border-line-strong hover:bg-surface-3',
  danger:
    'bg-danger/10 text-danger border border-danger/25 hover:bg-danger hover:text-white',
  ghost:
    'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink',
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.78rem] gap-1.5 rounded-md',
  md: 'h-9.5 px-4 text-[0.85rem] gap-2 rounded-md',
  lg: 'h-11 px-5 text-[0.95rem] gap-2 rounded-lg',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  loading,
  icon,
  className = '',
  title,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center justify-center font-bold whitespace-nowrap transition-all duration-150 ease-spring select-none
        ${BTN_VARIANT[variant]} ${BTN_SIZE[size]}
        disabled:opacity-45 disabled:pointer-events-none ${className}`}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
  variant = 'ghost',
  size = 34,
  className = '',
  active,
}: {
  icon: IconName;
  onClick?: () => void;
  label: string;
  variant?: 'ghost' | 'solid' | 'danger';
  size?: number;
  className?: string;
  active?: boolean;
}) {
  const styles =
    variant === 'solid'
      ? 'bg-surface-2 border border-line text-ink-2 hover:text-ink hover:border-line-strong'
      : variant === 'danger'
        ? 'bg-danger/10 border border-transparent text-danger hover:bg-danger hover:text-white'
        : `border border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink ${active ? 'bg-surface-2 text-ink' : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center rounded-md transition-colors duration-150 shrink-0 ${styles} ${className}`}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

const FIELD_BASE =
  'w-full bg-surface-2 border border-line rounded-md text-ink placeholder:text-ink-muted ' +
  'transition-all duration-150 outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 ' +
  'disabled:opacity-50 read-only:opacity-70';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input {...rest} ref={ref} className={`${FIELD_BASE} h-9.5 px-3 text-[0.88rem] ${className}`} />;
  },
);

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={`${FIELD_BASE} h-9.5 px-3 pe-8 text-[0.88rem] appearance-none cursor-pointer ${className}`}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-ink-muted">
        <Icon name="chevron-down" size={14} />
      </span>
    </div>
  );
}

export function Textarea({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD_BASE} px-3 py-2 text-[0.88rem] min-h-20 ${className}`} />;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-[0.78rem] font-bold text-ink-2">
          {label}
          {required && <span className="text-danger">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-[0.72rem] font-bold text-danger">
          <Icon name="alert" size={12} /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[0.7rem] font-semibold text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useT();
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-muted">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`${FIELD_BASE} h-9.5 ps-9 pe-8 text-[0.88rem]`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('clear')}
          className="absolute inset-y-0 end-2 flex items-center text-ink-muted hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-brand' : 'bg-surface-3 border border-line'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${
          checked ? 'start-[22px]' : 'start-0.5'
        }`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`panel rounded-lg border border-line shadow-1 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          {icon && (
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Icon name={icon} size={16} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[0.95rem] font-extrabold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[0.74rem] font-semibold text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {icon && (
        <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon name={icon} size={19} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-[1.35rem] font-black leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[0.8rem] font-semibold text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'purple' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok border-ok/25',
  warn: 'bg-warn/12 text-warn border-warn/25',
  danger: 'bg-danger/12 text-danger border-danger/25',
  brand: 'bg-brand/12 text-brand border-brand/25',
  info: 'bg-info/12 text-info border-info/25',
  purple: 'bg-purple/12 text-purple border-purple/25',
  muted: 'bg-surface-2 text-ink-muted border-line',
};

export function Badge({
  children,
  tone = 'muted',
  icon,
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.7rem] font-extrabold ${TONE_CLASS[tone]} ${className}`}
    >
      {icon && <Icon name={icon} size={11} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

export function Table({
  head,
  children,
  className = '',
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`scroll-y overflow-x-auto ${className}`}>
      <table className="w-full min-w-[560px] border-collapse text-start">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-surface-2">
            {head.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap border-b border-line px-3 py-2.5 text-start text-[0.7rem] font-extrabold uppercase tracking-wide text-ink-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className = '',
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border-b border-line/70 px-3 py-2.5 text-[0.84rem] font-semibold text-ink ${className}`}>
      {children}
    </td>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors hover:bg-surface-2/70 ${onClick ? 'cursor-pointer' : ''}`}
    >
      {children}
    </tr>
  );
}

export function EmptyState({
  icon = 'box',
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
        <Icon name={icon} size={26} strokeWidth={1.6} />
      </span>
      <div>
        <p className="text-[0.92rem] font-extrabold text-ink">{title}</p>
        {hint && <p className="mt-1 text-[0.78rem] font-semibold text-ink-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  icon: IconName;
  tone?: Tone;
  delta?: string;
  deltaTone?: 'ok' | 'danger' | 'muted';
}) {
  const iconTone: Record<Tone, string> = {
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/12 text-warn',
    danger: 'bg-danger/12 text-danger',
    brand: 'bg-brand/12 text-brand',
    info: 'bg-info/12 text-info',
    purple: 'bg-purple/12 text-purple',
    muted: 'bg-surface-2 text-ink-muted',
  };
  return (
    <div className="panel relative overflow-hidden rounded-lg border border-line p-4 shadow-1 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone[tone]}`}>
          <Icon name={icon} size={17} />
        </span>
        {delta && (
          <span
            className={`flex items-center gap-1 text-[0.7rem] font-extrabold ${
              deltaTone === 'ok' ? 'text-ok' : deltaTone === 'danger' ? 'text-danger' : 'text-ink-muted'
            }`}
          >
            {deltaTone === 'ok' && <Icon name="trend-up" size={12} />}
            {deltaTone === 'danger' && <Icon name="trend-down" size={12} />}
            {delta}
          </span>
        )}
      </div>
      <p className="mt-3 text-[0.74rem] font-bold text-ink-muted">{label}</p>
      <p className="num mt-1 truncate text-[1.3rem] font-black leading-tight text-ink">{value}</p>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string; icon?: IconName; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[0.8rem] font-extrabold transition-all duration-150 ${
            value === t.value
              ? 'bg-surface text-ink shadow-1'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {typeof t.count === 'number' && (
            <span className="num rounded-full bg-brand/12 px-1.5 text-[0.66rem] font-black text-brand">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
  total,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  total: number;
}) {
  const { t } = useT();
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="num text-[0.74rem] font-bold text-ink-muted">
        {t('records')}: {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton icon="chevron-start" label={t('previous')} size={30} onClick={() => onPage(Math.max(1, page - 1))} />
        <span className="num px-2 text-[0.78rem] font-extrabold text-ink">
          {page} / {pages}
        </span>
        <IconButton icon="chevron-end" label={t('next')} size={30} onClick={() => onPage(Math.min(pages, page + 1))} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  /*
   * Portaled to <body>: the page shell animates with a transform, and a transformed
   * ancestor makes position:fixed behave like position:absolute — which pushes the
   * top of the dialog (title and first fields) above the viewport.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-overlay/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`anim-pop flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-3 sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Icon name={icon} size={17} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[1.02rem] font-extrabold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[0.74rem] font-semibold text-ink-muted">{subtitle}</p>}
          </div>
          <IconButton icon="x" label={t('close')} onClick={onClose} />
        </header>
        <div className="scroll-y flex-1 px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  tone = 'danger',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
}) {
  const { t } = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={tone === 'danger' ? 'alert' : 'info'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[0.88rem] font-semibold leading-relaxed text-ink-2">{message}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

const TOAST_STYLE: Record<string, { icon: IconName; cls: string }> = {
  success: { icon: 'check', cls: 'border-ok/30 text-ok' },
  error: { icon: 'alert', cls: 'border-danger/30 text-danger' },
  warning: { icon: 'alert', cls: 'border-warn/30 text-warn' },
  info: { icon: 'info', cls: 'border-brand/30 text-brand' },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[2000] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => {
        const s = TOAST_STYLE[t.type] ?? TOAST_STYLE.info;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`anim-pop pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-lg border bg-surface px-3.5 py-2.5 text-start shadow-2 ${s.cls}`}
            role="alert"
          >
            <Icon name={s.icon} size={16} strokeWidth={2.4} />
            <span className="text-[0.82rem] font-bold text-ink">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
