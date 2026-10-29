import { useMemo } from 'react';
import { generateBarcode } from '@/utils/barcode';
import { Button } from '@/components/ui';
import { useT } from '@/hooks/useT';

/**
 * Deterministic Code128-like bar pattern derived from the code characters.
 * Returns only the black bars (offset + width); the gaps stay white so the
 * renderers can paint with `currentColor` on a white background — safe for
 * both screen and print (.print-area / .label-cell contexts).
 */
function barPattern(value: string): { bars: { x: number; w: number }[]; width: number } {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of value) {
    const n = Number(ch) || 0;
    const bw = 2 + (n % 3);
    const gw = 1 + ((n * 7) % 3);
    bars.push({ x, w: bw });
    x += bw + gw;
  }
  bars.push({ x, w: 2 });
  x += 2;
  return { bars, width: x };
}

export function BarcodeSVG({ value, height = 48 }: { value: string; height?: number }) {
  const { bars, width } = useMemo(() => barPattern(value), [value]);
  return (
    <div className="flex max-w-full flex-col items-center gap-1 rounded-md bg-white px-3 py-2 text-black">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={Math.min(width * 3, 320)}
        height={height}
        role="img"
        aria-label={value}
        className="block max-w-full"
      >
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="currentColor" />
        ))}
      </svg>
      <span className="mono text-[0.7rem] font-bold tracking-widest" dir="ltr">
        {value}
      </span>
    </div>
  );
}

/* Compact barcode for the 3×2 cm label cell — no text, colour inherits from .label-cell */
export function MiniBarcode({ value }: { value: string }) {
  const { bars, width } = useMemo(() => barPattern(value), [value]);
  const h = 14;
  return (
    <svg viewBox={`0 0 ${width} ${h}`} style={{ width: '2.6cm', height: '0.55cm' }} aria-hidden="true" className="block">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

export function BarcodeGenerateButton({ onGenerated }: { onGenerated: (code: string) => void }) {
  const { t } = useT();
  return (
    <Button
      type="button"
      variant="secondary"
      icon="barcode"
      title={t('generateBarcode')}
      onClick={() => onGenerated(generateBarcode())}
    >
      {t('generateBarcode')}
    </Button>
  );
}
