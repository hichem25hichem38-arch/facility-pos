import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';

type NativeDetector = {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
};

type DecodeFrame = (canvas: HTMLCanvasElement) => string | null;

/* Chromium ships BarcodeDetector only on Android, ChromeOS and macOS. Electron
   on Windows and the Android WebView fall back to the bundled ZXing decoder. */
function createNativeDetector(): NativeDetector | null {
  const Ctor = (window as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => NativeDetector;
  }).BarcodeDetector;
  if (!Ctor) return null;
  for (const formats of [
    ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
    ['ean_13', 'code_128', 'qr_code'],
  ]) {
    try {
      return new Ctor({ formats });
    } catch {
      /* this engine rejects part of the format list — try the shorter one */
    }
  }
  return null;
}

async function createZxingDecoder(): Promise<DecodeFrame | null> {
  try {
    const zx = await import('@zxing/library');
    const hints = new Map();
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
      zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8,
      zx.BarcodeFormat.UPC_A, zx.BarcodeFormat.UPC_E,
      zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39,
      zx.BarcodeFormat.ITF, zx.BarcodeFormat.QR_CODE,
    ]);
    const reader = new zx.BrowserMultiFormatReader(hints);
    return (canvas) => {
      try {
        const luminance = new zx.HTMLCanvasElementLuminanceSource(canvas);
        const result = reader.decodeBitmap(new zx.BinaryBitmap(new zx.HybridBinarizer(luminance)));
        return result.getText().trim() || null;
      } catch {
        /* no code in this frame */
        return null;
      }
    };
  } catch {
    return null;
  }
}

export function CameraScanner({ onDetected, onClose, continuous }: { onDetected: (value: string) => void; onClose: () => void; continuous?: boolean }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(onDetected);
  const continuousRef = useRef(!!continuous);
  detectedRef.current = onDetected;
  continuousRef.current = !!continuous;

  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [noDecoder, setNoDecoder] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let finished = false;
    let last = { code: '', at: 0 };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const native = createNativeDetector();
    let decodeFrame: DecodeFrame | null = null;
    const decoderReady = native ? Promise.resolve(null) : createZxingDecoder();

    const emit = (raw: string) => {
      const now = Date.now();
      if (last.code === raw && now - last.at < 1500) return;
      last.code = raw;
      last.at = now;
      try { navigator.vibrate?.(80); } catch { /* not available */ }
      detectedRef.current(raw);
    };

    const tick = async () => {
      if (stopped || finished) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        timer = setTimeout(tick, 120);
        return;
      }
      let raw: string | null = null;
      try {
        if (native) {
          const results = await native.detect(video);
          raw = results[0]?.rawValue?.trim() || null;
        } else if (decodeFrame && ctx) {
          const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          raw = decodeFrame(canvas);
        }
      } catch {
        /* frame without a readable code */
      }
      if (stopped) return;
      if (raw) {
        emit(raw);
        if (!continuousRef.current) { finished = true; return; }
      }
      if (native || decodeFrame) timer = setTimeout(tick, native ? 110 : 190);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setUnsupported(true);
        setError('unsupported');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) setError('denied');
        else if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) setError('unavailable');
        else if (e instanceof DOMException && e.name === 'NotReadableError') setError('unavailable');
        else setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try { await video.play(); } catch { /* the loop retries once data is ready */ }

      decodeFrame = await decoderReady;
      if (!native && !decodeFrame) setNoDecoder(true);
      if (!stopped) timer = setTimeout(tick, 250);
    };

    start().catch(() => setError('unsupported'));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  const errorText =
    error === 'denied' ? t('cameraDenied')
      : error === 'unavailable' ? t('cameraUnavailable')
        : error === 'unsupported' ? t('cameraUnsupported')
          : error;

  if (unsupported) {
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

      {noDecoder && (
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
