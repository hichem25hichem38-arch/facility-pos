import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';

export function HwScannerInput({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [lastScan, setLastScan] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    /* Keyboard-wedge capture even when the field is not focused: scanners
       type very fast and finish with Enter, so buffer rapid keystrokes. */
    let buffer = '';
    let lastTime = 0;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const now = Date.now();
      if (now - lastTime > 400) buffer = '';
      lastTime = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 6) {
          e.preventDefault();
          setLastScan(buffer);
          onDetected(buffer);
          buffer = '';
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        buffer += e.key;
      } else if (e.key === 'Backspace') {
        buffer = buffer.slice(0, -1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDetected]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    setLastScan(v);
    onDetected(v);
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/12 px-3 py-2.5">
        <span className="mt-0.5 shrink-0 text-warn">
          <Icon name="keyboard" size={17} />
        </span>
        <div>
          <p className="text-[0.84rem] font-extrabold text-warn">{t('scannerHw')}</p>
          <p className="mt-0.5 text-[0.74rem] font-semibold leading-relaxed text-ink-2">{t('scannerHwHint')}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={t('readyToScan')}
          autoFocus
          className="mono flex-1 text-center text-[1rem] tracking-widest"
          dir="ltr"
        />
        <Button onClick={submit} icon="check" className="shrink-0">{t('enterKey')}</Button>
      </div>

      {lastScan && (
        <p className="flex items-center justify-center gap-1.5 text-[0.76rem] font-bold text-ok">
          <Icon name="check" size={13} strokeWidth={2.4} />
          {t('lastScan')}: <span className="mono font-black" dir="ltr">{lastScan}</span>
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">{t('close')}</Button>
        <Button variant="secondary" icon="scan" onClick={() => inputRef.current?.focus()} className="flex-1">
          {t('focusField')}
        </Button>
      </div>

      <p className="text-center text-[0.7rem] font-semibold leading-relaxed text-ink-muted">{t('scannerTip')}</p>
    </div>
  );
}
