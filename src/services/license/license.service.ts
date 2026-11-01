import { getDb } from '@/database/db';
import { DEVICE_ID_KEY } from '@/constants';
import { IS_FULL_EDITION } from '@/config/edition';
import {
  ActivationError,
  apiActivate,
  apiHeartbeat,
  type ActivationErrorCode,
} from './activation.api';

/*
 * Licence format: LIC1.<base64url(ECDSA-P256 signature)>.<expiryMs|0>
 * Signed payload: "<DEVICE_ID>|<expiry>|<LIC1>"
 *
 * The private key lives only in the hosted activation service. Every build of
 * this app ships the same public key, so a licence can be verified offline but
 * never minted locally.
 */
const PUBLIC_JWK: JsonWebKey = {
  kty: 'EC',
  x: 'AV1atFKbn8JTJT6BhCjYAGOhGEU9LLGdi5Dae6ebFJ8',
  y: 'P6YAV5wIm4AOD5U5n6xg3AES8V-GW09v_zbLJsy0Jd0',
  crv: 'P-256',
  ext: true,
};

const LICENSE_PREFIX = 'LIC1';
const encoder = new TextEncoder();

/** Tolerated clock difference before a stored timestamp is treated as tampering. */
const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let cachedDeviceId: string | null = null;

function canVerify(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function platformLabel(): string {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
    .Capacitor;
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === 'android' ? 'android' : 'mobile';
  if (window.desktop?.isDesktop) return 'desktop';
  return 'web';
}

export async function appVersion(): Promise<string> {
  try {
    const version = await window.desktop?.getVersion?.();
    if (version) return version;
  } catch {
    /* bridge unavailable */
  }
  return import.meta.env.VITE_APP_VERSION ?? 'dev';
}

/** Stable code shown to the client and bound into every licence. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  // Desktops derive this from the operating-system machine id, so clearing the
  // browser storage or reinstalling does not produce a fresh identity.
  try {
    const native = await window.desktop?.getMachineId?.();
    if (native && typeof native === 'string' && native.trim().length >= 4) {
      const clean = native.trim().toUpperCase();
      cachedDeviceId = clean;
      try {
        await getDb().settings.put({ key: DEVICE_ID_KEY, value: clean });
      } catch {
        /* db not ready */
      }
      return clean;
    }
  } catch {
    /* bridge unavailable */
  }
  const { getDeviceId: getStoredDeviceId } = await import('@/database/db');
  cachedDeviceId = await getStoredDeviceId();
  return cachedDeviceId;
}

export interface LicenseCheck {
  valid: boolean;
  expiry?: number;
  reason?: 'MALFORMED' | 'UNSUPPORTED' | 'BAD_SIGNATURE' | 'WRONG_DEVICE' | 'EXPIRED';
}

export async function verifyLicense(license: string, deviceId: string): Promise<LicenseCheck> {
  if (!license || !license.startsWith(`${LICENSE_PREFIX}.`)) return { valid: false, reason: 'MALFORMED' };
  const parts = license.trim().split('.');
  if (parts.length !== 3) return { valid: false, reason: 'MALFORMED' };
  const [, signatureB64, expiryRaw] = parts;
  const expiry = Number(expiryRaw) > 0 ? Number(expiryRaw) : 0;
  if (!Number.isFinite(expiry)) return { valid: false, reason: 'MALFORMED' };
  if (expiry > 0 && Date.now() > expiry) return { valid: false, expiry, reason: 'EXPIRED' };
  if (!canVerify()) return { valid: false, reason: 'UNSUPPORTED' };

  const signature = base64UrlToBytes(signatureB64);
  if (!signature) return { valid: false, reason: 'MALFORMED' };

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      PUBLIC_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const data = encoder.encode(`${deviceId.trim().toUpperCase()}|${expiry}|${LICENSE_PREFIX}`);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature as BufferSource,
      data,
    );
    return ok ? { valid: true, expiry: expiry || undefined } : { valid: false, reason: 'BAD_SIGNATURE' };
  } catch {
    return { valid: false, reason: 'UNSUPPORTED' };
  }
}

async function clearStoredLicense(): Promise<void> {
  const db = getDb();
  await db.settings.delete('licenseKey');
  await db.settings.delete('licensedDeviceId');
  await db.settings.delete('licenseExpiry');
  await db.settings.delete('licenseStore');
  await db.settings.delete('licenseLastSeen');
}

/**
 * True only when a valid, unexpired licence is stored for this machine.
 * The full edition is the vendor's own copy and is always unlocked; the trial
 * edition has no free window and stays locked until a supplier code is entered.
 */
export async function hasValidLicense(): Promise<boolean> {
  if (IS_FULL_EDITION) return true;
  try {
    const db = getDb();
    const lic = await db.settings.get('licenseKey');
    const dev = await db.settings.get('licensedDeviceId');
    if (!lic?.value || dev?.value !== (await getDeviceId())) {
      if (lic?.value || dev?.value) await clearStoredLicense();
      return false;
    }

    // Moving the system clock backwards must not extend a timed licence.
    const seen = await db.settings.get('licenseLastSeen');
    const lastSeen = Number(seen?.value) || 0;
    const now = Date.now();
    if (lastSeen > 0 && now + CLOCK_TOLERANCE_MS < lastSeen) {
      await clearStoredLicense();
      return false;
    }

    const check = await verifyLicense(String(lic.value), String(dev.value));
    if (!check.valid || (check.expiry !== undefined && check.expiry < now)) {
      // Forged, migrated or expired licences must not unlock the app.
      await clearStoredLicense();
      return false;
    }
    if (now > lastSeen) await db.settings.put({ key: 'licenseLastSeen', value: now });
    return true;
  } catch {
    return false;
  }
}

export interface ActivateOutcome {
  ok: true;
  expiresAt: number | null;
  storeName: string;
}

export type ActivateFailure = { ok: false; code: ActivationErrorCode };

/**
 * Redeems a supplier code against the hosted service. The returned licence is
 * verified locally before it is stored, so a compromised network response
 * cannot unlock the app.
 */
export async function activate(code: string): Promise<ActivateOutcome | ActivateFailure> {
  const deviceId = await getDeviceId();
  try {
    const result = await apiActivate({
      code,
      deviceId,
      appVersion: await appVersion(),
      platform: platformLabel(),
    });
    if (result.deviceId !== deviceId) return { ok: false, code: 'device_mismatch' };

    const normalized = result.license.trim();
    const check = await verifyLicense(normalized, deviceId);
    if (!check.valid) return { ok: false, code: 'unknown' };

    const db = getDb();
    const expiry = check.expiry ?? (result.expiresAt ? Date.parse(result.expiresAt) : null);
    await db.settings.put({ key: 'licenseKey', value: normalized });
    await db.settings.put({ key: 'licensedDeviceId', value: deviceId });
    if (expiry) await db.settings.put({ key: 'licenseExpiry', value: expiry });
    else await db.settings.delete('licenseExpiry');
    await db.settings.put({ key: 'licenseStore', value: result.storeName });
    await db.settings.put({ key: 'licenseLastSeen', value: Date.now() });
    return { ok: true, expiresAt: expiry ?? null, storeName: result.storeName };
  } catch (error) {
    if (error instanceof ActivationError) return { ok: false, code: error.code };
    return { ok: false, code: 'unknown' };
  }
}

/**
 * Confirms with the service that the licence is still trusted. A revoked or
 * expired licence is removed locally, which locks the app on the next check.
 */
export async function syncHeartbeat(): Promise<{ revoked: boolean; reached: boolean }> {
  const db = getDb();
  const lic = await db.settings.get('licenseKey');
  if (!lic?.value) return { revoked: false, reached: false };
  const deviceId = await getDeviceId();
  try {
    const result = await apiHeartbeat({
      license: String(lic.value),
      deviceId,
      appVersion: await appVersion(),
      platform: platformLabel(),
    });
    if (result.revoked) {
      await clearStoredLicense();
      return { revoked: true, reached: true };
    }
    await db.settings.put({ key: 'licenseLastSeen', value: Date.now() });
    return { revoked: false, reached: true };
  } catch {
    // No internet is expected: a licence already verified offline stays valid.
    return { revoked: false, reached: false };
  }
}

export async function getLicenseInfo() {
  const db = getDb();
  const deviceId = await getDeviceId();
  const licensed = await hasValidLicense();
  const [lic, exp, store] = await Promise.all([
    db.settings.get('licenseKey'),
    db.settings.get('licenseExpiry'),
    db.settings.get('licenseStore'),
  ]);
  return {
    deviceId,
    licensed,
    licenseKey: lic?.value as string | undefined,
    expiry: exp?.value as number | undefined,
    storeName: (store?.value as string | undefined) || '',
  };
}

export async function deactivate(): Promise<void> {
  await clearStoredLicense();
}
