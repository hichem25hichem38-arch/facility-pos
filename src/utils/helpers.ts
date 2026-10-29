import { getDeviceId } from '@/database/db';
import { ROLE_PERMISSIONS } from '@/constants';

export function now(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function syncMeta() {
  const deviceId = await getDeviceId();
  return { syncStatus: 'LOCAL' as const, version: 1, deviceId };
}

export { ROLE_PERMISSIONS };
