import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '@/database/db';
import { activate, hasValidLicense, getDeviceId, verifyLicense } from '@/services/license/license.service';

const LICENCE_URL = '/functions/v1/app?action=activate';

function mockActivateResponse(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })),
  );
}

describe('licence activation', () => {
  beforeEach(async () => {
    await getDb().open();
    await getDb().settings.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts locked without a licence', async () => {
    expect(await hasValidLicense()).toBe(false);
  });

  it('rejects a licence whose signature does not match the embedded public key', async () => {
    const deviceId = await getDeviceId();
    const forged = `LIC1.${'A'.repeat(86)}.0`;
    const check = await verifyLicense(forged, deviceId);
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('BAD_SIGNATURE');
  });

  it('reports a malformed licence instead of trusting it', async () => {
    const deviceId = await getDeviceId();
    expect((await verifyLicense('', deviceId)).reason).toBe('MALFORMED');
    expect((await verifyLicense('LIC1.only-two', deviceId)).reason).toBe('MALFORMED');
    expect((await verifyLicense(`LIC2.abc.0`, deviceId)).reason).toBe('MALFORMED');
  });

  it('does not store a licence the service returns unsigned', async () => {
    mockActivateResponse({ ok: true, license: `LIC1.${'B'.repeat(86)}.0`, deviceId: await getDeviceId(), permanent: true, storeName: 'X' });
    const result = await activate('AAAA-BBBB-CCCC');
    expect(result.ok).toBe(false);
    expect(await hasValidLicense()).toBe(false);
    expect(await getDb().settings.get('licenseKey')).toBeUndefined();
  });

  it('maps service error codes without unlocking the app', async () => {
    mockActivateResponse({ ok: false, error: 'device_mismatch' }, 403);
    const result = await activate('AAAA-BBBB-CCCC');
    expect(result).toEqual({ ok: false, code: 'device_mismatch' });
    expect(await hasValidLicense()).toBe(false);
  });

  it('reports offline when the request cannot be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const result = await activate('AAAA-BBBB-CCCC');
    expect(result).toEqual({ ok: false, code: 'offline' });
  });

  it('sends the code, device id and platform to the activation endpoint', async () => {
    const deviceId = await getDeviceId();
    mockActivateResponse({ ok: false, error: 'invalid_code' }, 400);
    await activate('ABCD-EFGH-JKLM');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith(LICENCE_URL)).toBe(true);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.code).toBe('ABCD-EFGH-JKLM');
    expect(body.deviceId).toBe(deviceId);
    expect(typeof body.platform).toBe('string');
  });
});
