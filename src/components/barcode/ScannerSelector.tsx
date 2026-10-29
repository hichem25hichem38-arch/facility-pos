import { useState } from 'react';
import { Button, Tabs } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { CameraScanner } from './CameraScanner';
import { HwScannerInput } from './HwScannerInput';

type Mode = 'camera' | 'hw' | 'phone';

export function ScannerSelector({ onDetected, onClose, isDesktop }: { onDetected: (value: string) => void; onClose: () => void; isDesktop?: boolean }) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>(isDesktop ? 'hw' : 'camera');

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        tabs={[
          { value: 'hw', label: t('scannerHw'), icon: 'keyboard' },
          { value: 'camera', label: t('scannerCamera'), icon: 'camera' },
          { value: 'phone', label: t('scannerPhone'), icon: 'smartphone' },
        ]}
      />

      {mode === 'hw' && <HwScannerInput onDetected={(v) => { onDetected(v); }} onClose={onClose} />}

      {mode === 'camera' && (
        <CameraScanner onDetected={(v) => { onDetected(v); onClose(); }} onClose={onClose} />
      )}

      {mode === 'phone' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-info/25 bg-info/12 px-3.5 py-3">
            <p className="flex items-center gap-2 text-[0.86rem] font-extrabold text-info">
              <Icon name="smartphone" size={16} />
              {t('phoneScanTitle')}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-[0.78rem] font-semibold leading-relaxed text-ink-2">
              <li>{t('phoneScanStep1')}</li>
              <li>{t('phoneScanStep2')}</li>
              <li>{t('phoneScanStep3')}</li>
            </ol>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">{t('close')}</Button>
            <a
              href="#/scanner"
              onClick={onClose}
              className="inline-flex h-9.5 flex-1 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[0.85rem] font-bold text-brand-contrast shadow-brand transition-all hover:bg-brand-hover"
            >
              <Icon name="scan" size={16} />
              {t('openPhoneScanner')}
            </a>
          </div>
          <p className="text-center text-[0.7rem] font-semibold text-ink-muted">{t('phoneScanNote')}</p>
        </div>
      )}
    </div>
  );
}
