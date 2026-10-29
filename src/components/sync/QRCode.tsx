import { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/useT';
import { Icon } from '@/components/icons';

/**
 * Renders `text` as a QR code on a white tile using the `qrcode` package.
 * The tile stays white (and modules near-black) in every theme so the code
 * scans reliably; the canvas pixel colours are functional, not theme colours.
 */
export function QRCode({ text, size = 180 }: { text: string; size?: number }) {
  const { t } = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!text || !canvasRef.current) return;
    let cancelled = false;
    import('qrcode')
      .then(({ toCanvas }) => {
        if (cancelled || !canvasRef.current) return;
        toCanvas(
          canvasRef.current,
          text,
          {
            width: size,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
          },
          (e) => {
            if (cancelled) return;
            setErr(e ? e.message : '');
          },
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  if (!text) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl border border-line bg-white p-2 shadow-1">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="block rounded-md"
          style={{ width: size, height: size }}
        />
      </div>
      {err ? (
        <p className="flex items-center gap-1 text-[0.72rem] font-bold text-danger">
          <Icon name="alert" size={12} /> {t('qrError')}
        </p>
      ) : (
        <p
          className="mono max-w-[240px] select-all break-all text-center text-[0.7rem] font-semibold text-ink-muted"
          dir="ltr"
        >
          {text}
        </p>
      )}
    </div>
  );
}
