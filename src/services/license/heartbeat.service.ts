import { IS_FULL_EDITION } from '@/config/edition';
import { HEARTBEAT_INTERVAL_MS, hasValidLicense, syncHeartbeat } from './license.service';

/**
 * Keeps the vendor console's "last seen" column meaningful and lets a revoked
 * licence lock the app without waiting for a restart. Failures are silent: an
 * offline shop keeps working on its locally verified licence.
 */
export function startLicenseHeartbeat(): () => void {
  // The full edition holds no licence row, so there is nothing to keep alive.
  if (IS_FULL_EDITION) return () => {};
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (!(await hasValidLicense())) return;
    const result = await syncHeartbeat();
    if (result.revoked && !stopped) window.dispatchEvent(new Event('license:revoked'));
  };

  void tick();
  const timer = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
