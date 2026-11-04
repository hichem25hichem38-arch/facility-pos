import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '@/database/db';
import { BackupService, type BackupPayload } from '@/services/backup/backup.service';
import { LanSyncService } from '@/services/sync/lan-sync.service';
import { registerSyncWatch } from '@/services/sync/sync.service';
import type { IssuedCodeRecord } from '@/types';

/*
 * The activation service stores only a hash and a 4-character prefix, so the
 * code text survives exclusively in this local table. It must therefore never
 * travel — not in a backup file, not through the LAN relay.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const code = (over: Partial<IssuedCodeRecord> = {}): IssuedCodeRecord => ({
  code: `KEY-${uid().slice(0, 8).toUpperCase()}`,
  deviceId: `POS-${uid().slice(0, 8)}`,
  name: 'Karim',
  storeName: 'محل النصر',
  phone: '0555123456',
  durationDays: 30,
  createdAt: Date.now(),
  ...over,
});

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeAll(async () => {
  await db.open();
  registerSyncWatch(db);
});

describe('local vendor codes', () => {
  it('keeps the full text on this device', async () => {
    const row = code();
    await db.issuedCodes.put(row);
    await expect(db.issuedCodes.get(row.code)).resolves.toMatchObject({
      code: row.code,
      deviceId: row.deviceId,
      durationDays: 30,
    });
    await db.issuedCodes.delete(row.code);
  });

  it('leaves no trace in a backup or a sync snapshot', async () => {
    const row = code();
    await db.issuedCodes.put(row);
    const backup = await new BackupService().createBackup();
    const sync = await new BackupService().createSyncPayload();
    expect(backup.tables).not.toHaveProperty('issuedCodes');
    expect(sync.tables).not.toHaveProperty('issuedCodes');
    expect(JSON.stringify(backup)).not.toContain(row.code);
    expect(JSON.stringify(sync)).not.toContain(row.code);
    await db.issuedCodes.delete(row.code);
  });

  it('rejects codes a peer tries to hand over', async () => {
    const stolen = `PEER-${uid().slice(0, 8)}`;
    const foreign: BackupPayload = {
      appVersion: 'test',
      exportedAt: Date.now(),
      tables: { issuedCodes: [code({ code: stolen })] },
    };
    await new LanSyncService().importSnapshot(foreign);
    await expect(db.issuedCodes.get(stolen)).resolves.toBeUndefined();
  });

  it('writes no tombstone because the table never syncs', async () => {
    const row = code();
    await db.issuedCodes.put(row);
    await db.issuedCodes.delete(row.code);
    await settle();
    await expect(db.syncTombstones.get(`issuedCodes:${row.code}`)).resolves.toBeUndefined();
  });
});
