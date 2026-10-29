import { getDb } from '@/database/db';
import { BackupService, type BackupPayload } from './backup.service';

const LAST_KEY = 'lastAutoBackupDate'; // YYYY-MM-DD (local)
const ENABLE_KEY = 'autoBackupEnabled';
const ARCHIVE_KEY = 'autoBackup-latest';
const LEGACY_PREFIX = 'autoBackup-';

function localDateKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Daily safety copy.
 * Only ONE archive is kept in the database (`autoBackup-latest`) so the
 * settings table cannot grow without bound, and nothing is downloaded
 * silently — the user pulls the file from Settings when needed.
 */
export class AutoBackupService {
  static isEnabled(): boolean {
    try {
      const v = localStorage.getItem(ENABLE_KEY);
      if (v === null) return true;
      return v === '1' || v === 'true';
    } catch {
      return true;
    }
  }

  static setEnabled(enabled: boolean) {
    try {
      localStorage.setItem(ENABLE_KEY, enabled ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  static getLastDate(): string | null {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  }

  static setLastDate(dateStr: string) {
    try {
      localStorage.setItem(LAST_KEY, dateStr);
    } catch {
      /* storage unavailable */
    }
  }

  /** Runs only once per local calendar day. */
  static async maybeRun(): Promise<{ did: boolean; reason: string }> {
    if (!this.isEnabled()) return { did: false, reason: 'disabled' };
    const today = localDateKey();
    if (this.getLastDate() === today) return { did: false, reason: 'already-ran' };
    return this.runNow(today);
  }

  static async runNow(dateStr?: string): Promise<{ did: boolean; reason: string }> {
    const today = dateStr ?? localDateKey();
    try {
      const payload = await new BackupService().createBackup();
      const json = JSON.stringify(payload);
      const sizeKB = (json.length / 1024).toFixed(1);
      const db = getDb();

      await db.transaction('rw', db.settings, async () => {
        await db.settings.put({ key: ARCHIVE_KEY, value: payload });
        await db.settings.put({ key: 'lastAutoBackupAt', value: Date.now() });
        await db.settings.put({ key: 'lastAutoBackupSizeKB', value: sizeKB });
        // Purge per-day archives written by older builds.
        const legacy = await db.settings
          .filter((r) => r.key.startsWith(LEGACY_PREFIX) && r.key !== ARCHIVE_KEY)
          .primaryKeys();
        if (legacy.length > 0) await db.settings.bulkDelete(legacy);
      });

      const cap = (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform()) {
        try {
          const { Filesystem, Directory } = await import('@capacitor/filesystem');
          await Filesystem.writeFile({
            path: `auto-backup-${today}.json`,
            data: json,
            directory: Directory.Documents,
          });
        } catch {
          /* keep the in-app archive only */
        }
      }

      this.setLastDate(today);
      return { did: true, reason: `${sizeKB} KB` };
    } catch (e) {
      return { did: false, reason: (e as Error).message };
    }
  }

  /** Manually downloads the latest archive (user gesture — never automatic). */
  static async downloadLast(): Promise<{ fileName: string; uri?: string }> {
    const db = getDb();
    const row = await db.settings.get(ARCHIVE_KEY);
    const stored = row?.value as BackupPayload | undefined;
    const payload = stored && stored.tables ? stored : await new BackupService().createBackup();
    return new BackupService().downloadBackup(payload);
  }
}
