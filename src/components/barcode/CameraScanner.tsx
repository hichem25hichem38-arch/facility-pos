import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';

export function CameraScanner({ onDetected, onClose, continuous }: { onDetected: (value: string) => void; onClose: () => void; continuous?: boolean }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);
  const [noDetector, setNoDetector] = useState(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let detector: unknown = null;
    let stopped = false;

    const start = async () => {
      try {
        const BD = (window as unknown as { BarcodeDetector?: new (opts: unknown) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (BD) {
          try { detector = new BD({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'] }); } catch { detector = new BD({ formats: ['ean_13', 'code_128', 'qr_code'] }); }
        } else {
          setNoDetector(true);
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const loop = async () => {
          if (stopped) return;
          if (!videoRef.current || videoRef.current.readyState < 2) { raf = requestAnimationFrame(loop); return; }
          try {
            if (detector) {
              const res = await (detector as { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> }).detect(videoRef.current);
              const raw = res[0]?.rawValue?.trim();
              if (raw) {
                const now = Date.now();
                if (!(lastRef.current && lastRef.current.code === raw && now - lastRef.current.at < 1200)) {
                  lastRef.current = { code: raw, at: now };
                  try { navigator.vibrate?.(80); } catch {}
                  onDetected(raw);
                  if (!continuous) return;
                }
              }
            }
          } catch { /* ignore */ }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('NotAllowed') || msg.includes('Permission')) setError('denied');
        else if (!navigator.mediaDevices) { setSupported(false); setError('unsupported'); }
        else setError(msg);
      }
    };
    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDetected, continuous]);

  const errorText =
    error === 'denied' ? t('cameraDenied') : error === 'unsupported' ? t('cameraUnsupported') : error;

  if (!supported) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/12 px-3 py-2.5">
        <span className="mt-0.5 shrink-0 text-danger"><Icon name="alert" size={16} /></span>
        <p className="text-[0.8rem] font-bold text-danger">{errorText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-64 max-w-[80%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgb(var(--overlay-rgb)_/_45%)]" />
          <span className="absolute top-2 end-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[0.68rem] font-bold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
            {t('cameraActive')}
          </span>
        </div>
      </div>

      {noDetector && (
        <p className="flex items-start gap-1.5 rounded-lg border border-warn/25 bg-warn/12 px-3 py-2 text-[0.74rem] font-bold text-warn">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          {t('cameraNoDetector')}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/12 px-3 py-2 text-[0.74rem] font-bold text-danger">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          {errorText}
        </p>
      )}

      <Button variant="secondary" onClick={onClose} className="w-full" icon="x">
        {continuous ? t('stopCamera') : t('close')}
      </Button>
      <p className="text-center text-[0.7rem] font-semibold text-ink-muted">{t('cameraHint')}</p>
    </div>
  );
}
