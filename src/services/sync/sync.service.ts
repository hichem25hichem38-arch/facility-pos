import { getDb } from '@/database/db';
import { isLocalWriteSuppressed, markLocalWrite } from './sync-state';
import { onSyncPushed, requestFullSync } from './scan.service';

export type SyncFailure = 'unpaired' | 'unreachable' | 'timeout';
export type SyncOutcome = { ok: true } | { ok: false; reason: SyncFailure };

/** Settings keys owned by one device: their deletion must not travel. */
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

/** Never synced, so no tombstone and no push for their writes. */
const LOCAL_TABLES = new Set(['users', 'userCredentials', 'roles', 'syncTombstones', 'issuedCodes']);

/** How long a local edit waits before its snapshot is pushed. */
const PUSH_DEBOUNCE_MS = 6000;

/**
 * Sync engine.
 * The long-lived LAN socket owns the transport: a device pulls the relay
 * snapshot, applies it, then pushes its own. Every table travels except the
 * accounts on this device, and every local write schedules one debounced push,
 * so carts, sales, payments, stock moves and settings all reach the peer — not
 * only products.
 */
export class SyncService {
  async sync(): Promise<SyncOutcome> {
    const { getWsUrl } = await import('./scan.service');
    if (!(await getWsUrl())) return { ok: false, reason: 'unpaired' };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: SyncOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(outcome);
      };
      const off = onSyncPushed(() => finish({ ok: true }));
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 25000);
      if (!requestFullSync()) finish({ ok: false, reason: 'unreachable' });
    });
  }
}

/**
 * Watches every table so a local write pushes the whole snapshot and a hard
 * delete leaves a tombstone the peers can replay. Registered once at startup.
 */
export function registerSyncWatch(db = getDb()): void {
  for (const table of db.tables) {
    const name = table.name;
    if (LOCAL_TABLES.has(name)) continue;
    const isSettings = name === 'settings';

    const skipped = (key: unknown) => {
      if (isLocalWriteSuppressed()) return true;
      if (!isSettings || typeof key !== 'string') return false;
      // Device-local licence state and the daily backup archives never travel,
      // so they must not schedule a push either.
      return LOCAL_SETTING_KEYS.has(key) || key.startsWith('autoBackup-');
    };

    /**
     * IndexedDB cannot reach another store from inside the row's own
     * transaction, so the tombstone lands on the next macrotask — after the
     * delete or rewrite committed. Best effort: a lost tombstone only delays
     * the cleanup on the peers, it never corrupts data.
     */
    const recordTombstone = (key: unknown, deleted: boolean) => {
      setTimeout(() => {
        if (isLocalWriteSuppressed()) return;
        const id = `${name}:${key}`;
        void (async () => {
          try {
            if (deleted) await db.syncTombstones.put({ id, tableName: name, rowId: String(key), deletedAt: Date.now() });
            else await db.syncTombstones.delete(id);
          } catch {
            /* storage unavailable */
          }
        })();
      }, 0);
    };

    table.hook('creating', (primKey) => {
      if (skipped(primKey)) return;
      recordTombstone(primKey, false);
      markLocalWrite(PUSH_DEBOUNCE_MS);
    });
    table.hook('updating', (_changes, _obj, primKey) => {
      if (skipped(primKey)) return;
      recordTombstone(primKey, false);
      markLocalWrite(PUSH_DEBOUNCE_MS);
    });
    table.hook('deleting', (primKey) => {
      if (skipped(primKey)) return;
      recordTombstone(primKey, true);
      markLocalWrite(PUSH_DEBOUNCE_MS);
    });
  }
}
