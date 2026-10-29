import * as XLSX from 'xlsx';
import { translate } from '@/i18n';
import { useAppStore } from '@/app/store/app.store';

function label(key: string): string {
  return translate(useAppStore.getState().locale, key);
}

export function exportToXlsx(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = 'Sheet1',
) {
  if (rows.length === 0) {
    const ws = XLSX.utils.json_to_sheet([{ [label('notes')]: label('noData') }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const cols = Object.keys(rows[0]);
  ws['!cols'] = cols.map((k) => {
    const maxLen = Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

