import { useMemo } from 'react';
import { generateBarcode } from '@/utils/barcode';
import { Button } from '@/components/ui';
import { useT } from '@/hooks/useT';

/* ------------------------------------------------------------------ */
/* EAN-13 / EAN-8 / UPC-A drawing                                      */
/* ------------------------------------------------------------------ */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Check(d12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function ean8Check(d7: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(d7[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

function ean13Bits(d: string): string {
  const parity = PARITY[Number(d[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) {
    const n = Number(d[i + 1]);
    bits += parity[i] === 'L' ? L[n] : G[n];
  }
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += R[Number(d[i])];
  return `${bits}101`;
}

function ean8Bits(d: string): string {
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += L[Number(d[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += R[Number(d[i])];
  return `${bits}101`;
}

/** Returns the module string of a real, scannable retail symbology, or null. */
function encodeRetail(value: string): string | null {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return null;
  if (v.length === 13 && Number(v[12]) === ean13Check(v.slice(0, 12))) return ean13Bits(v);
  /* UPC-A is an EAN-13 with a leading zero */
  if (v.length === 12 && Number(v[11]) === ean13Check(`0${v.slice(0, 11)}`)) return ean13Bits(`0${v}`);
  if (v.length === 8 && Number(v[7]) === ean8Check(v.slice(0, 7))) return ean8Bits(v);
  return null;
}

function barsFromBits(bits: string, quiet = 10): { bars: { x: number; w: number }[]; width: number } {
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== '1') { i++; continue; }
    const start = i;
    while (i < bits.length && bits[i] === '1') i++;
    bars.push({ x: quiet + start, w: i - start });
  }
  return { bars, width: bits.length + quiet * 2 };
}

/**
 * Fallback pattern for codes that are not a valid retail symbology (custom SKUs,
 * alphanumeric supplier codes). Not decodable — only a visual placeholder.
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

function renderBarcode(value: string): { bars: { x: number; w: number }[]; width: number } {
  const bits = encodeRetail(value);
  return bits ? barsFromBits(bits) : barPattern(value);
}

export function BarcodeSVG({ value, height = 48 }: { value: string; height?: number }) {
  const { bars, width } = useMemo(() => renderBarcode(value), [value]);
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
  const { bars, width } = useMemo(() => renderBarcode(value), [value]);
  const h = 14;
  return (
    <svg viewBox={`0 0 ${width} ${h}`} style={{ width: '2.7cm', height: '0.55cm' }} aria-hidden="true" className="block">
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
