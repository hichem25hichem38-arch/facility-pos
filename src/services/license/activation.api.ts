/**
 * Narrow transport for the hosted activation service.
 *
 * The service lives on a Qoder Site and is reached at
 * `<origin>/functions/v1/app?action=…`. Two constraints shape this file:
 *
 * 1. The gateway applies a same-origin rule to writes. A packaged desktop app
 *    loads `file://` and an Android WebView loads `https://localhost`, so a
 *    plain `fetch` cannot present the site origin. Both fall back to native
 *    transports that can set the `Origin` header themselves.
 * 2. Activation must fail closed. Every request is bounded by a timeout, and
 *    a network failure is reported as `offline` instead of being retried:
 *    `activate` mutates state and must never be replayed automatically.
 */

export const ACTIVATION_ORIGIN =
  (import.meta.env.VITE_ACTIVATION_ORIGIN as string | undefined)?.replace(/\/+$/, '') ||
  'https://pos-license-center-p9p7wkgirfb.qoder.website';

const API_URL = `${ACTIVATION_ORIGIN}/functions/v1/app`;
const TIMEOUT_MS = 20_000;

export type ActivationErrorCode =
  | 'offline'
  | 'timeout'
  | 'invalid_code'
  | 'code_expired'
  | 'code_locked'
  | 'device_mismatch'
  | 'license_revoked'
  | 'license_expired'
  | 'invalid_device_id'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'invalid_duration'
  | 'unknown_device'
  | 'server_unavailable'
  | 'unknown';

export class ActivationError extends Error {
  code: ActivationErrorCode;
  status: number;
  retryAfterMs?: number;

  constructor(code: ActivationErrorCode, status = 0, retryAfterMs?: number) {
    super(code);
    this.name = 'ActivationError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const KNOWN_CODES: ActivationErrorCode[] = [
  'invalid_code',
  'code_expired',
  'code_locked',
  'device_mismatch',
  'license_revoked',
  'license_expired',
  'invalid_device_id',
  'rate_limited',
  'invalid_credentials',
  'invalid_duration',
  'unknown_device',
];

interface Envelope {
  status: number;
  body: unknown;
}

class OfflineError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseEnvelope(raw: string, status: number): Envelope {
  if (!raw) return { status, body: null };
  try {
    return { status, body: JSON.parse(raw) };
  } catch {
    return { status, body: null };
  }
}

async function viaDesktop(action: string, payload: string, vendorToken?: string): Promise<Envelope> {
  const bridge = window.desktop?.licenseRequest;
  if (!bridge) throw new OfflineError('no bridge');
  const result = await bridge({
    url: `${API_URL}?action=${encodeURIComponent(action)}`,
    body: payload,
    origin: ACTIVATION_ORIGIN,
    timeoutMs: TIMEOUT_MS,
    vendorToken,
  });
  return parseEnvelope(result.body, result.status);
}

async function viaCapacitor(action: string, payload: string, vendorToken?: string): Promise<Envelope> {
  const { CapacitorHttp } = await import('@capacitor/core');
  const response = await CapacitorHttp.request({
    url: `${API_URL}?action=${encodeURIComponent(action)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: ACTIVATION_ORIGIN,
      ...(vendorToken ? { 'x-vendor-token': vendorToken } : {}),
    },
    data: JSON.parse(payload),
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
  });
  const data = response.data;
  return { status: response.status, body: typeof data === 'string' ? parseEnvelope(data, response.status).body : data };
}

async function viaFetch(action: string, payload: string, vendorToken?: string): Promise<Envelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(vendorToken ? { 'x-vendor-token': vendorToken } : {}),
      },
      body: payload,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const text = await response.text();
    return parseEnvelope(text, response.status);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new ActivationError('timeout');
    throw new OfflineError('network');
  } finally {
    clearTimeout(timer);
  }
}

function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

async function call(
  action: string,
  body: Record<string, unknown>,
  vendorToken?: string,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(body);
  let envelope: Envelope;
  try {
    if (window.desktop?.licenseRequest) envelope = await viaDesktop(action, payload, vendorToken);
    else if (isNative()) envelope = await viaCapacitor(action, payload, vendorToken);
    else envelope = await viaFetch(action, payload, vendorToken);
  } catch (error) {
    if (error instanceof ActivationError) throw error;
    throw new ActivationError('offline');
  }

  const record = asRecord(envelope.body);
  if (envelope.status >= 500) throw new ActivationError('server_unavailable', envelope.status);
  if (!record) throw new ActivationError('server_unavailable', envelope.status);
  if (record.ok === true) return record;

  const raw = typeof record.error === 'string' ? record.error : '';
  const code = KNOWN_CODES.includes(raw as ActivationErrorCode) ? (raw as ActivationErrorCode) : 'unknown';
  const retry = typeof record.retryAfterMs === 'number' ? record.retryAfterMs : undefined;
  throw new ActivationError(code, envelope.status, retry);
}

export interface ActivateResult {
  license: string;
  deviceId: string;
  expiresAt: string | null;
  permanent: boolean;
  storeName: string;
}

export async function apiActivate(input: {
  code: string;
  deviceId: string;
  appVersion?: string;
  platform?: string;
}): Promise<ActivateResult> {
  const data = await call('activate', input);
  if (typeof data.license !== 'string' || !data.license) throw new ActivationError('server_unavailable');
  return {
    license: data.license,
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : input.deviceId,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    permanent: data.permanent === true,
    storeName: typeof data.storeName === 'string' ? data.storeName : '',
  };
}

export async function apiHeartbeat(input: {
  license: string;
  deviceId: string;
  appVersion?: string;
  platform?: string;
}): Promise<{ revoked: boolean; expiresAt: string | null }> {
  const data = await call('heartbeat', input);
  return {
    revoked: data.revoked === true,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
  };
}

export async function apiVendorLogin(apiKey: string): Promise<{ token: string; expiresInMs: number }> {
  const data = await call('vendor/login', { apiKey });
  if (typeof data.token !== 'string' || !data.token) throw new ActivationError('server_unavailable');
  return { token: data.token, expiresInMs: Number(data.expiresInMs) || 0 };
}

export interface IssueCodeInput {
  deviceId: string;
  name: string;
  phone: string;
  storeName: string;
  durationDays: number;
  notes?: string;
}

export interface IssuedCode {
  code: string;
  deviceId: string;
  durationDays: number;
  validUntil: string | null;
  clientId: string;
}

export async function apiVendorIssue(token: string, input: IssueCodeInput): Promise<IssuedCode> {
  const data = await call('vendor/issue', { ...input }, token);
  if (typeof data.code !== 'string') throw new ActivationError('server_unavailable');
  return {
    code: data.code,
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : input.deviceId,
    durationDays: Number(data.durationDays) || input.durationDays,
    validUntil: typeof data.validUntil === 'string' ? data.validUntil : null,
    clientId: typeof data.clientId === 'string' ? data.clientId : '',
  };
}

/** One client row as the activation service reports it. */
export interface VendorClient {
  id: string;
  deviceId: string;
  name: string;
  storeName: string;
  phone: string;
  durationDays: number;
  expiresAt: string | null;
  lastSeenAt: string | null;
  platform: string;
  appVersion: string;
  state: 'active' | 'pending' | 'expired' | 'revoked';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function isoOf(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

const CLIENT_STATES: VendorClient['state'][] = ['active', 'pending', 'expired', 'revoked'];

/**
 * The console list is the only durable view of what was issued: a code itself is
 * shown once at issue time and the service stores only its hash. Rows come from
 * the network, so every field is read defensively.
 */
export async function apiVendorList(token: string): Promise<VendorClient[]> {
  const data = await call('vendor/list', {}, token);
  if (!Array.isArray(data.items)) return [];
  const clients: VendorClient[] = [];
  for (const raw of data.items) {
    const row = asRecord(raw);
    const deviceId = textOf(row?.deviceId);
    const id = textOf(row?.id);
    if (!row || (!deviceId && !id)) continue;
    const computed = textOf(row.computed) as VendorClient['state'];
    clients.push({
      id,
      deviceId,
      name: textOf(row.name),
      storeName: textOf(row.storeName),
      phone: textOf(row.phone),
      durationDays: Number(row.durationDays) || 0,
      expiresAt: isoOf(row.expiresAt),
      lastSeenAt: isoOf(row.lastSeenAt),
      platform: textOf(row.platform),
      appVersion: textOf(row.appVersion),
      state: CLIENT_STATES.includes(computed) ? computed : 'pending',
    });
  }
  return clients;
}
