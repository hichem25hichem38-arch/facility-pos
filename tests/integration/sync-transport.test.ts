import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Handler = (payload?: unknown) => void;

const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  const emitted: { event: string; payload?: unknown }[] = [];
  const socket = {
    id: 'fake-socket',
    connected: true,
    on: (event: string, cb: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
    },
    off: (event: string, cb: Handler) => {
      handlers.get(event)?.delete(cb);
    },
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    connect: () => {},
    disconnect: () => {},
  };
  return {
    socket,
    emitted,
    fire(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((cb) => cb(payload));
    },
    count(event: string) {
      return emitted.filter((entry) => entry.event === event).length;
    },
  };
});

vi.mock('socket.io-client', () => ({ io: () => fake.socket }));
vi.mock('@/services/backup/backup.service', () => ({
  BackupService: class {
    async createSyncPayload() {
      return { appVersion: 'test', exportedAt: 0, tables: {} };
    }
  },
}));

/** The apply queue and the snapshot import are promise-chained across macrotasks. */
const settle = () => new Promise((r) => setTimeout(r, 20));

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  });
}

async function loadTransport() {
  vi.resetModules();
  const mod = await import('@/services/sync/scan.service');
  mod.setStoredWsUrl('ws://relay.test?key=token');
  expect(mod.requestFullSync()).toBe(true);
  return mod;
}

describe('LAN sync transport handshake', () => {
  beforeEach(() => {
    stubStorage();
    fake.emitted.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes its own data after a pull answer', async () => {
    const mod = await loadTransport();
    mod.registerSyncApplier(async () => {});
    let acked = 0;
    mod.onSyncPushed(() => {
      acked += 1;
    });

    fake.fire('sync', { exportedAt: 100, tables: {} });
    await settle();

    expect(fake.count('pull')).toBe(1);
    expect(fake.count('push')).toBe(1);

    fake.fire('sync:done', { ok: true });
    expect(acked).toBe(1);
  });

  it('still pushes when the relay has nothing newer — the click must not hang', async () => {
    const mod = await loadTransport();
    let applied = 0;
    mod.registerSyncApplier(async () => {
      applied += 1;
    });

    fake.fire('sync', { exportedAt: 100, tables: {} });
    await settle();
    expect(fake.count('push')).toBe(1);

    // A peer broadcast already left us holding the relay's current snapshot.
    fake.fire('sync', { exportedAt: 100, tables: {} });
    await settle();
    expect(applied).toBe(1);

    mod.requestFullSync();
    fake.fire('sync', { exportedAt: 100, tables: {} });
    await settle();

    expect(applied).toBe(1);
    expect(fake.count('push')).toBe(2);
  });
});
