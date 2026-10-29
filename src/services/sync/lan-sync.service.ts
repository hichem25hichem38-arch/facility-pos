import { BackupService } from '@/services/backup/backup.service';
import { getDb } from '@/database/db';

/** Never accepted from a peer: it could replace the admin account. */
const BLOCKED_TABLES = new Set(['users', 'userCredentials', 'roles']);
/** Device-owned settings that must not be overwritten by another device. */
const BLOCKED_SETTING_KEYS = new Set([
  'deviceId',
  'licenseKey',
  'licensedDeviceId',
  'licenseExpiry',
  'licenseStore',
  'licenseLastSeen',
  'seeded-users',
  'lastAutoBackupAt',
  'lastAutoBackupSizeKB',
]);

const UNIQUE_FIELDS: Record<string, string[]> = {
  products: ['sku', 'barcode'],
  categories: ['name'],
  customers: ['customerNumber'],
  sales: ['invoiceNumber'],
  installmentPlans: ['saleId'],
};

/**
 * LAN sync: same WiFi, no internet required.
 * Transfer is a JSON snapshot exchanged manually (file / clipboard) or through
 * the desktop WebSocket relay. Conflicts resolve by "last write wins" on
 * updatedAt. Accounts and credentials never travel.
 */
export class LanSyncService {
  private backup = new BackupService();

  async exportPayload(): Promise<string> {
    const payload = await this.backup.createSyncPayload();
    return JSON.stringify(payload);
  }

  async importPayload(json: string): Promise<void> {
    const payload = this.backup.parseBackupFile(json);
    const db = getDb();
    await db.transaction('rw', db.tables, async () => {
      for (const [tableName, rows] of Object.entries(payload.tables)) {
        if (BLOCKED_TABLES.has(tableName)) continue;
        const table = db.table(tableName);
        for (const row of rows as unknown as (Record<string, unknown> & { id?: string; key?: string; updatedAt?: number })[]) {
          if (tableName === 'settings') {
            if (typeof row.key !== 'string' || BLOCKED_SETTING_KEYS.has(row.key) || row.key.startsWith('autoBackup-')) continue;
            try { await table.put(row); } catch { /* skip malformed row */ }
            continue;
          }
          if (!row.id) continue;
          const existing = await table.get(row.id as string);
          if (!existing) {
            // A row with the same unique field (sku, invoice number, …) may exist
            // under another id: keep the newer version and drop the duplicate.
            const conflict = await this.findUniqueConflict(tableName, row);
            if (conflict) continue;
            try { await table.add(row); } catch { /* skip unique conflict */ }
            continue;
          }
          if ((row.updatedAt ?? 0) >= ((existing as { updatedAt?: number }).updatedAt ?? 0)) {
            try { await table.put(row); } catch { /* skip unique conflict */ }
          }
        }
      }
    });
  }

  private async findUniqueConflict(
    tableName: string,
    row: Record<string, unknown>,
  ): Promise<boolean> {
    const fields = UNIQUE_FIELDS[tableName];
    if (!fields) return false;
    const db = getDb();
    const table = db.table(tableName);
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== 'string' || !value) continue;
      const found = await table.where(field).equals(value).first() as { updatedAt?: number } | undefined;
      if (found) return true;
    }
    return false;
  }
}
