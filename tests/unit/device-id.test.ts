import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEVICE_ID_KEY } from '@/constants';

const ANDROID_ID = 'a1b2c3d4e5f60718';

vi.mock('@capacitor/device', () => ({
  Device: { getId: () => Promise.resolve({ identifier: ANDROID_ID }) },
}));

/** A fresh module graph per case: the service caches the code it resolved. */
async function load() {
  vi.resetModules();
  const [service, database] = await Promise.all([
    import('@/services/license/license.service'),
    import('@/database/db'),
  ]);
  return { ...service, getDb: database.getDb };
}

function asAndroid() {
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
}

function expectedAndroidCode() {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(`POS:${ANDROID_ID}`))
    .then((digest) => `POS-${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8).toUpperCase()}`);
}

describe('device code', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives the phone code from the platform id so a reinstall keeps it', async () => {
    asAndroid();
    const { getDeviceId, getDb } = await load();
    await getDb().open();
    await getDb().settings.clear();

    const code = await getDeviceId();
    expect(code).toBe(await expectedAndroidCode());
    expect(await getDb().settings.get(DEVICE_ID_KEY)).toMatchObject({ value: code });
  });

  it('never replaces a code a licence was signed against', async () => {
    asAndroid();
    const { getDeviceId, getDb } = await load();
    await getDb().open();
    await getDb().settings.put({ key: DEVICE_ID_KEY, value: 'POS-LEGACY0' });

    expect(await getDeviceId()).toBe('POS-LEGACY0');
  });

  it('still generates one when no native identity exists', async () => {
    vi.stubGlobal('Capacitor', undefined);
    const { getDeviceId, getDb } = await load();
    await getDb().open();
    await getDb().settings.clear();

    const code = await getDeviceId();
    expect(code).toMatch(/^POS-/);
    expect(await getDeviceId()).toBe(code);
  });
});
