export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(amount: number, currency = 'DA', locale = 'ar-DZ'): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(amount))} ${currency}`;
}

export function formatDate(ts: number, locale = 'fr-DZ'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ts));
}

export function formatDateTime(ts: number, locale = 'fr-DZ'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function daysBetween(fromTs: number, toTs: number): number {
  return Math.floor((startOfDay(toTs) - startOfDay(fromTs)) / (86_400_000));
}

export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
}
