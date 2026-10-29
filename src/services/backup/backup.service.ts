import { getDb } from '@/database/db';

export interface BackupPayload {
  appVersion: string;
  exportedAt: number;
  tables: Record<string, unknown[]>;
}

/** Tables that must never leave this device (accounts and password hashes). */
const SENSITIVE_TABLES = new Set(['users', 'userCredentials', 'roles']);
/** Settings rows owned by a single device; sharing them breaks licensing. */
const LOCAL_SETTING_KEYS = new Set([
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

function isArchiveKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith('autoBackup-');
}

export class BackupService {
  /** Full local backup (used for file export/restore on this device). */
  async createBackup(): Promise<BackupPayload> {
    const db = getDb();
    const tables: Record<string, unknown[]> = {};
    for (const name of db.tables.map((t) => t.name)) {
      const rows = await db.table(name).toArray();
      // Auto-backup archives live in `settings`; embedding them would make each
      // new backup contain all previous ones (unbounded growth).
      tables[name] = name === 'settings'
        ? (rows as { key?: string }[]).filter((r) => !isArchiveKey(r.key))
        : rows;
    }
    return { appVersion: '1.0.0', exportedAt: Date.now(), tables };
  }

  /**
   * Snapshot for LAN transfer: identical to a backup minus accounts,
   * credentials, roles and device-local settings.
   */
  async createSyncPayload(): Promise<BackupPayload> {
    const full = await this.createBackup();
    const tables: Record<string, unknown[]> = {};
    for (const [name, rows] of Object.entries(full.tables)) {
      if (SENSITIVE_TABLES.has(name)) continue;
      tables[name] = name === 'settings'
        ? (rows as { key?: string }[]).filter((r) => !LOCAL_SETTING_KEYS.has(String(r.key)) && !isArchiveKey(r.key))
        : rows;
    }
    return { ...full, tables };
  }

  /** Saves the archive on disk; returns the native path when it landed in Documents. */
  async downloadBackup(payload: BackupPayload): Promise<{ fileName: string; uri?: string }> {
    const json = JSON.stringify(payload, null, 2);
    const fileName = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const res = await Filesystem.writeFile({ path: fileName, data: json, directory: Directory.Documents });
        return { fileName, uri: res.uri };
      } catch {
        /* fall through to browser download */
      }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { fileName };
  }

  /** Replaces all data with the backup content. Caller must confirm with user first. */
  async restoreBackup(payload: BackupPayload): Promise<void> {
    if (!payload?.tables || typeof payload.tables !== 'object') throw new Error('INVALID_BACKUP_FILE');
    const db = getDb();
    const known = new Set(db.tables.map((t) => t.name));
    for (const name of Object.keys(payload.tables)) {
      if (!known.has(name)) continue;
      if (!Array.isArray(payload.tables[name])) throw new Error('INVALID_BACKUP_FILE');
    }
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        const rows = payload.tables[table.name];
        if (!Array.isArray(rows)) continue;
        await table.clear();
        await table.bulkAdd(rows as Record<string, unknown>[]);
      }
    });
  }

  parseBackupFile(text: string): BackupPayload {
    // tolerate BOM and extra whitespace (some file managers add it)
    const cleaned = text.replace(/^\uFEFF/, '').trim();
    const parsed = JSON.parse(cleaned) as BackupPayload;
    if (!parsed?.tables || typeof parsed.tables !== 'object') throw new Error('INVALID_BACKUP_FILE');
    return parsed;
  }
}
