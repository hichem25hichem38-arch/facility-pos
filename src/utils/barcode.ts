export function generateEAN13(prefix = '61'): string {
  const base = prefix + Array.from({ length: 12 - prefix.length }, () => Math.floor(Math.random() * 10)).join('');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + String(check);
}

export function generateBarcode(): string {
  return generateEAN13();
}
