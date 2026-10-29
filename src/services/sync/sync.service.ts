import { getDb, getDeviceId } from '@/database/db';

export type QueuedOperation = {
  id: string;
  entity: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  queuedAt: number;
};

/** Tables that carry syncStatus/version/deviceId. */
const SYNCABLE_TABLES = ['products', 'categories', 'customers', 'sales', 'payments', 'installmentPlans'];

/**
 * Sync engine.
 * Locally every entity records syncStatus/deviceId/version; a full snapshot is
 * exchanged with the desktop relay over WebSocket (LAN only) or by file.
 * Conflict policy: last write wins on updatedAt, conflicts logged locally.
 */
export class SyncService {
  async collectPending(): Promise<QueuedOperation[]> {
    const db = getDb();
    const deviceId = await getDeviceId();
    const pending: QueuedOperation[] = [];
    for (const table of SYNCABLE_TABLES) {
      const rows = await db
        .table(table)
        .filter((row: { syncStatus?: string }) => row.syncStatus !== 'SYNCED')
        .toArray() as { id: string; deviceId?: string }[];
      for (const row of rows) {
        pending.push({
          id: row.id,
          entity: table,
          entityId: row.id,
          operation: row.deviceId === deviceId ? 'CREATE' : 'UPDATE',
          queuedAt: Date.now(),
        });
      }
    }
    return pending;
  }

  get enabled(): boolean {
    return import.meta.env.VITE_SYNC_ENABLED === 'true';
  }

  async sync(): Promise<boolean> {
    const wsUrl = await this.resolveWsUrl();
    if (!wsUrl) return false;
    return this.syncViaWs(wsUrl);
  }

  /** Desktop uses its own bridge URL (which carries the pairing token); phones use the paired URL. */
  private async resolveWsUrl(): Promise<string | null> {
    const { getWsUrl } = await import('./scan.service');
    return getWsUrl();
  }

  private async syncViaWs(wsUrl: string): Promise<boolean> {
    const { BackupService } = await import('@/services/backup/backup.service');
    const { LanSyncService } = await import('./lan-sync.service');
    const payload = await new BackupService().createSyncPayload();
    const { io } = await import('socket.io-client');
    return new Promise((resolve) => {
      let merged = false;
      let socket: ReturnType<typeof io> | null = null;
      const timer = setTimeout(() => {
        try { socket?.disconnect(); } catch { /* ignore */ }
        resolve(merged);
      }, 7000);
      try {
        socket = io(wsUrl, { transports: ['websocket', 'polling'], reconnectionAttempts: 2, timeout: 4000 });
        socket.on('connect', () => {
          socket!.emit('pull');
          setTimeout(() => socket!.emit('push', payload), 500);
        });
        socket.on('sync', async (data: unknown) => {
          try {
            const p = data as { tables?: unknown };
            if (p?.tables) {
              await new LanSyncService().importPayload(JSON.stringify(data));
              merged = true;
            }
          } catch {
            /* keep local data when the peer snapshot is unusable */
          }
          clearTimeout(timer);
          try { socket!.disconnect(); } catch { /* ignore */ }
          resolve(true);
        });
        socket.on('connect_error', () => {
          clearTimeout(timer);
          try { socket!.disconnect(); } catch { /* ignore */ }
          resolve(false);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
}
