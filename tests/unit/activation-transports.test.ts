import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiActivate, apiVendorIssue, apiVendorList, apiVendorLogin } from '@/services/license/activation.api';

/*
 * The desktop transport hands the URL to the Electron main process, which only
 * checks the pathname — so an action left out of the query string reaches the
 * activation service as a bare POST and comes back 404 not_found.
 */
interface BridgeCall {
  url: string;
  body: string;
  vendorToken?: string;
}

function stubDesktopBridge(replies: Record<string, unknown>[]): BridgeCall[] {
  const calls: BridgeCall[] = [];
  const licenseRequest = vi.fn(async (args: BridgeCall) => {
    calls.push(args);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { status: 200, body: JSON.stringify(reply) };
  });
  Object.defineProperty(window, 'desktop', {
    value: { licenseRequest },
    configurable: true,
    writable: true,
  });
  return calls;
}

const REPLIES = [
  { ok: true, token: 'SES-1', expiresInMs: 900000 },
  { ok: true, license: 'LIC1.abc', deviceId: 'PC-1', expiresAt: null, permanent: true, storeName: 'محل' },
  { ok: true, code: 'ABCD-EFGH', deviceId: 'PC-1', durationDays: 30, validUntil: null, clientId: 'cl-1' },
];

describe('desktop activation transport', () => {
  afterEach(() => {
    delete (window as unknown as { desktop?: unknown }).desktop;
  });

  it('sends the action to the bridge for every request', async () => {
    const calls = stubDesktopBridge(REPLIES);

    await apiVendorLogin('VND-SAMPLE-KEY');
    expect(calls[0].url).toContain('?action=vendor%2Flogin');

    await apiActivate({ code: 'ABCD-EFGH', deviceId: 'PC-1' });
    expect(calls[1].url).toContain('?action=activate');

    await apiVendorIssue('SES-1', {
      deviceId: 'PC-1',
      name: 'عميل',
      phone: '0555123456',
      storeName: 'محل',
      durationDays: 30,
    });
    expect(calls[2].url).toContain('?action=vendor%2Fissue');
    expect(calls[2].vendorToken).toBe('SES-1');
  });

  it('keeps the pathname the bridge is allowed to post to', async () => {
    const calls = stubDesktopBridge(REPLIES);
    await apiVendorLogin('VND-SAMPLE-KEY');
    expect(new URL(calls[0].url).pathname).toBe('/functions/v1/app');
  });

  /** The console list is the durable view of what was issued, so its rows are read defensively. */
  it('lists server clients and falls back to pending on an unknown state', async () => {
    const calls = stubDesktopBridge([
      {
        ok: true,
        items: [
          {
            id: 'cl-1',
            deviceId: 'PC-1',
            name: 'عميل',
            storeName: 'محل',
            phone: '0555123456',
            durationDays: 30,
            expiresAt: '2026-12-01T00:00:00.000Z',
            lastSeenAt: null,
            platform: 'windows',
            appVersion: '1.0.12',
            computed: 'active',
          },
          { deviceId: 'POS-2', status: 'pending' },
          'not-a-row',
        ],
        stats: { total: 3 },
        total: 3,
      },
    ]);

    const clients = await apiVendorList('SES-1');
    expect(calls[0].url).toContain('?action=vendor%2Flist');
    expect(calls[0].vendorToken).toBe('SES-1');
    expect(clients[0]).toMatchObject({ deviceId: 'PC-1', state: 'active', durationDays: 30, lastSeenAt: null });
    expect(clients[1]).toMatchObject({ deviceId: 'POS-2', state: 'pending', name: '', durationDays: 0 });
    expect(clients).toHaveLength(2);
  });
});
