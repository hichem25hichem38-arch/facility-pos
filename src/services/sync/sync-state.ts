type Pusher = () => void | Promise<unknown>;

let pusher: Pusher | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let suppressedDepth = 0;

/** Called once at startup with the socket push implementation. */
export function registerSyncPusher(fn: Pusher): void {
  pusher = fn;
}

/** True while a peer snapshot or a backup restore is being written locally. */
export function isLocalWriteSuppressed(): boolean {
  return suppressedDepth > 0;
}

/**
 * Bulk writes that came from another device must not look like local edits:
 * they would schedule a push of the snapshot we just received (endless ping-pong).
 */
export async function withSuppressedLocalWrites<T>(fn: () => Promise<T>): Promise<T> {
  suppressedDepth++;
  try {
    return await fn();
  } finally {
    suppressedDepth--;
  }
}

/**
 * A user action usually writes several rows (sale + items + stock + plan).
 * Debounce so one action costs one snapshot push.
 */
export function markLocalWrite(delayMs = 6000): void {
  if (suppressedDepth || !pusher) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pusher?.();
  }, delayMs);
}
