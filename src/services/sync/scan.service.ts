import { io, type Socket } from 'socket.io-client';
import { registerSyncPusher, withSuppressedLocalWrites } from './sync-state';

let socket: Socket | null = null;
let lastWsUrl: string | null = null;
let connectingUrl: string | null = null;
let desktopUrl: string | null = null;
let deviceIdCache = '';

/* ------------- snapshot sync over the same long-lived socket ------------- */
type Listener = () => void;
type SyncApplier = (payload: unknown) => Promise<void>;

let syncApplier: SyncApplier | null = null;
let applyQueue: Promise<void> = Promise.resolve();
let lastAppliedAt = -1;
let pushAfterNextApply = false;
const appliedListeners = new Set<Listener>();
const ackListeners = new Set<Listener>();

const STORAGE_KEY = 'pos:desktopWsUrl';

function isDesktop(): boolean {
  try {
    return !!window.desktop?.isDesktop;
  } catch {
    return false;
  }
}

/** Device id used in scan metadata — same value the database and license use. */
async function resolveDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  try {
    const { getDeviceId } = await import('@/database/db');
    deviceIdCache = await getDeviceId();
  } catch {
    deviceIdCache = '';
  }
  return deviceIdCache;
}

export function getStoredWsUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredWsUrl(url: string | null) {
  try {
    if (!url) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* storage unavailable */
  }
  try {
    socket?.disconnect();
  } catch {
    /* ignore */
  }
  socket = null;
  lastWsUrl = null;
  // A different relay keeps its own clock: forget what was applied from the old one.
  lastAppliedAt = -1;
}

export async function getWsUrl(): Promise<string | null> {
  if (isDesktop()) {
    if (desktopUrl) return desktopUrl;
    try {
      const info = await window.desktop?.getSyncWsUrl?.();
      if (info?.localWsUrl) {
        desktopUrl = info.localWsUrl;
        return desktopUrl;
      }
    } catch {
      /* bridge not ready */
    }
    return null;
  }
  const stored = getStoredWsUrl();
  if (stored) return stored;
  if (import.meta.env.VITE_SYNC_WS_URL) return import.meta.env.VITE_SYNC_WS_URL;
  try {
    const h = location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') return `ws://${h}:8080`;
  } catch {
    /* no location */
  }
  return null;
}

export function getWsUrlSync(): string | null {
  if (isDesktop()) return desktopUrl;
  return getStoredWsUrl();
}

/**
 * Resolves the relay address (desktop: from the Electron bridge, phone: the
 * paired URL) and opens the socket. Call once at startup.
 */
export async function initScanSync(): Promise<void> {
  await resolveDeviceId();
  await getWsUrl();
  registerSyncPusher(() => pushLocalSnapshot());
  ensureSocketSync();
}

/** Writes a peer snapshot into the local database (registered by the app bootstrap). */
export function registerSyncApplier(applier: SyncApplier): void {
  syncApplier = applier;
}

/** Notified after an incoming snapshot has been stored. */
export function onSyncApplied(cb: Listener): () => void {
  appliedListeners.add(cb);
  return () => { appliedListeners.delete(cb); };
}

/** Notified when the relay confirms it merged our snapshot. */
export function onSyncPushed(cb: Listener): () => void {
  ackListeners.add(cb);
  return () => { ackListeners.delete(cb); };
}

/**
 * Pull the relay snapshot; our own data is pushed right after it lands, so the
 * merge order is always peer-first, local-second.
 */
export function requestFullSync(): boolean {
  const s = ensureSocketSync();
  if (!s) return false;
  pushAfterNextApply = true;
  if (s.connected) s.emit('pull');
  else s.connect();
  return true;
}

async function pushLocalSnapshot(): Promise<void> {
  const s = ensureSocketSync();
  if (!s?.connected) return;
  try {
    const { BackupService } = await import('@/services/backup/backup.service');
    const payload = await new BackupService().createSyncPayload();
    s.emit('push', payload);
  } catch {
    /* snapshot unavailable: retry on the next local write */
  }
}

function applyRemote(payload: unknown): void {
  applyQueue = applyQueue
    .then(async () => {
      if (!payload || typeof payload !== 'object') return;
      const at = Number((payload as { exportedAt?: number }).exportedAt ?? 0);
      if (at && at <= lastAppliedAt) return;
      const apply = syncApplier;
      if (apply) {
        try {
          await withSuppressedLocalWrites(() => apply(payload));
        } catch {
          /* keep local data when the peer snapshot is unusable */
        }
        if (at) lastAppliedAt = at;
      }
      if (pushAfterNextApply) {
        pushAfterNextApply = false;
        await pushLocalSnapshot();
      }
      appliedListeners.forEach((cb) => cb());
    })
    .catch(() => {
      pushAfterNextApply = false;
    });
}

function createSocket(url: string): Socket {
  const s = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 8000,
  });
  s.on('connect', () => {
    connectingUrl = null;
    requestFullSync();
  });
  s.on('sync', applyRemote);
  s.on('sync:done', () => {
    ackListeners.forEach((cb) => cb());
  });
  s.on('connect_error', () => {
    /* retried automatically */
  });
  return s;
}

function ensureSocketSync(): Socket | null {
  const url = getWsUrlSync();
  if (!url) return null;
  if (socket && lastWsUrl === url) return socket;
  socket?.disconnect();
  lastWsUrl = url;
  connectingUrl = url;
  socket = createSocket(url);
  return socket;
}

export function emitScanSync(barcode: string): boolean {
  const payload = { barcode: String(barcode).trim(), at: Date.now(), deviceId: deviceIdCache };
  if (!payload.barcode) return false;
  const s = ensureSocketSync();
  if (!s) return false;
  if (!s.connected) s.connect();
  s.emit('scan', payload);
  return true;
}

export function getScanStatus(): { url: string | null; connected: boolean; connecting: boolean } {
  const url = getWsUrlSync();
  return { url, connected: !!socket?.connected, connecting: !!connectingUrl && !socket?.connected };
}

/**
 * Attaches listeners once a socket exists. On the desktop the relay URL comes
 * from the Electron bridge asynchronously, so early subscribers wait for it
 * instead of silently losing their listeners.
 */
function attachWhenReady(attach: (s: Socket) => () => void): () => void {
  let detach: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let attempts = 0;

  const tryAttach = () => {
    if (stopped || detach) return;
    const s = ensureSocketSync();
    if (s) {
      detach = attach(s);
      if (!s.connected) s.connect();
      return;
    }
    if (attempts++ < 60) timer = setTimeout(tryAttach, 500);
  };
  tryAttach();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    detach?.();
  };
}

export function onScan(cb: (barcode: string, meta?: { senderId?: string; deviceId?: string }) => void): () => void {
  let lastCode = '';
  let lastAt = 0;
  return attachWhenReady((s) => {
    const handler = (data: { barcode?: string; senderId?: string; deviceId?: string } | string) => {
      const code = typeof data === 'string' ? data : data?.barcode;
      if (!code) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < 800) return;
      // Ignore our own echo: the relay stamps the sender socket id.
      if (typeof data === 'object' && data?.senderId && data.senderId === s.id) return;
      lastCode = code;
      lastAt = now;
      cb(code, typeof data === 'object' ? data : undefined);
    };
    s.on('scan', handler);
    return () => {
      try {
        s.off('scan', handler);
      } catch {
        /* ignore */
      }
    };
  });
}

export function onClients(cb: (count: number) => void): () => void {
  return attachWhenReady((s) => {
    const h = (data: { count: number }) => cb(data.count);
    s.on('clients', h);
    return () => {
      try {
        s.off('clients', h);
      } catch {
        /* ignore */
      }
    };
  });
}
