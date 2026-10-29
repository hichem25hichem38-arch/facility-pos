import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDb } from '@/database/db';
import { activate, getDeviceId, hasValidLicense } from '@/services/license/license.service';

/*
 * Interop check: the real activation handler signs a licence and the client
 * verifies it with the public key baked into the app. The vendor key material
 * is read from the git-ignored .secrets file, so this suite skips when the
 * operator has not generated it on this machine.
 */
const here = dirname(fileURLToPath(import.meta.url));
const secretsPath = join(here, '../../activation-site/.secrets/vendor.json');

interface Secrets {
  privateJwk: JsonWebKey;
  apiKey: string;
}

function loadSecrets(): Secrets | null {
  try {
    return JSON.parse(readFileSync(secretsPath, 'utf8')) as Secrets;
  } catch {
    return null;
  }
}

const secrets = loadSecrets();

type Handler = (request: Request) => Promise<Response>;

async function buildHandler(): Promise<Handler> {
  // @ts-expect-error - dependency-free ESM helper without type declarations
  const { createApp } = (await import('../../activation-site/functions/app.mjs')) as {
    createApp: (deps: { db: unknown; env: (name: string) => string | undefined }) => Handler;
  };
  // @ts-expect-error - test-only in-memory adapter
  const { fakeDb } = (await import('../../activation-site/dev/fake-db.mjs')) as { fakeDb: () => unknown };
  const db = fakeDb();
  return createApp({
    db,
    env: (name) =>
      name === 'VENDOR_API_KEY'
        ? secrets!.apiKey
        : name === 'LICENSE_PRIVATE_JWK'
          ? JSON.stringify(secrets!.privateJwk)
          : undefined,
  });
}

const BASE = 'https://pos-license-center.example/functions/v1/app';

async function post(handler: Handler, action: string, body: unknown, token?: string) {
  const request = new Request(`${BASE}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-vendor-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await handler(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe.skipIf(!secrets)('activation service ↔ client interop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a licence signed by the service and unlocks the app', async () => {
    await getDb().open();
    await getDb().settings.clear();
    const handler = await buildHandler();
    const deviceId = await getDeviceId();

    const login = await post(handler, 'vendor/login', { apiKey: secrets!.apiKey });
    expect(login.status).toBe(200);
    const token = String(login.body.token);

    const issued = await post(
      handler,
      'vendor/issue',
      { deviceId, name: 'عميل تجريبي', phone: '0555 12 34 56', storeName: 'محل التجربة', durationDays: 30 },
      token,
    );
    expect(issued.status).toBe(200);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    // Redeem the code exactly as the app would, but against the real handler.
    const activation = await post(handler, 'activate', { code: issued.body.code, deviceId, platform: 'desktop' });
    expect(activation.status).toBe(200);
    const licence = String(activation.body.license);
    expect(licence.startsWith('LIC1.')).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            license: licence,
            deviceId,
            expiresAt: activation.body.expiresAt,
            permanent: activation.body.permanent,
            storeName: activation.body.storeName,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await activate(String(issued.body.code));
    expect(result.ok).toBe(true);
    expect(await hasValidLicense()).toBe(true);
    const stored = await getDb().settings.get('licenseKey');
    expect(stored?.value).toBe(licence);
  });

  it('refuses a licence issued for a different device', async () => {
    await getDb().open();
    await getDb().settings.clear();
    const handler = await buildHandler();
    const login = await post(handler, 'vendor/login', { apiKey: secrets!.apiKey });
    const token = String(login.body.token);
    const issued = await post(
      handler,
      'vendor/issue',
      { deviceId: 'PC-OTHERDEVICE01', name: 'عميل آخر', phone: '0555 99 88 77', storeName: 'محل آخر', durationDays: 30 },
      token,
    );
    const activation = await post(handler, 'activate', {
      code: issued.body.code,
      deviceId: 'PC-OTHERDEVICE01',
      platform: 'desktop',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, ...activation.body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = await activate(String(issued.body.code));
    expect(result.ok).toBe(false);
    expect(await hasValidLicense()).toBe(false);
  });
});
