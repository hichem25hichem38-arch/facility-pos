import { BackupService, type BackupPayload } from '@/services/backup/backup.service';
import { getDb } from '@/database/db';
import { withSuppressedLocalWrites } from './sync-state';
import type { SyncTombstone } from '@/types';

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

/** A row nobody ever touched again is not worth remembering forever. */
const TOMBSTONE_RETENTION_MS = 180 * 86_400_000;

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
    await this.importSnapshot(this.backup.parseBackupFile(json));
  }

  async importSnapshot(payload: BackupPayload): Promise<void> {
    // Rows written by a peer are not local edits: they must not re-trigger a push.
    await withSuppressedLocalWrites(async () => {
      const db = getDb();
      await db.transaction('rw', db.tables, async () => {
        for (const [tableName, rows] of Object.entries(payload.tables)) {
          if (BLOCKED_TABLES.has(tableName) || tableName === 'syncTombstones') continue;
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
        await this.applyTombstones(payload.tables['syncTombstones'] as SyncTombstone[] | undefined);
        await db.syncTombstones
          .where('deletedAt')
          .below(Date.now() - TOMBSTONE_RETENTION_MS)
          .delete();
      });
    });
  }

  /**
   * Replays the peer's hard deletes. Runs after the row upserts because a relay
   * snapshot still carries rows that another device deleted since; the
   * tombstone wins over them.
   */
  private async applyTombstones(tombstones?: SyncTombstone[]): Promise<void> {
    if (!Array.isArray(tombstones) || tombstones.length === 0) return;
    const db = getDb();
    for (const stone of tombstones) {
      if (!stone || typeof stone.tableName !== 'string' || typeof stone.rowId !== 'string') continue;
      if (BLOCKED_TABLES.has(stone.tableName)) continue;
      if (stone.tableName === 'settings' && BLOCKED_SETTING_KEYS.has(stone.rowId)) continue;
      const target = db.table(stone.tableName);
      if (!target) continue;
      const local = await db.syncTombstones.get(`${stone.tableName}:${stone.rowId}`);
      if (local && local.deletedAt >= stone.deletedAt) continue;
      await db.syncTombstones.put(stone);
      await target.delete(stone.rowId);
    }
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
