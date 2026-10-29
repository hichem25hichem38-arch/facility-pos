const { createServer } = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');

let httpServer = null;
let io = null;
let latest = null;
let scanCount = 0;
let pairingToken = '';

/**
 * Tables that must never travel over the LAN: a peer on the Wi-Fi could
 * otherwise replace the admin account or its password hash.
 */
const SENSITIVE_TABLES = new Set(['users', 'userCredentials', 'roles']);
/** Settings keys owned by this device and therefore non-transferable. */
const LOCAL_SETTING_KEYS = new Set([
  'deviceId',
  'licenseKey',
  'licensedDeviceId',
  'licenseExpiry',
  'licenseStore',
  'licenseLastSeen',
  'seeded-users',
  'lastAutoBackupAt',
  'lastAutoBackupSizeKB',
  'autoBackup-latest',
]);
/** Hard cap on a pushed snapshot so a peer cannot exhaust the host's memory. */
const MAX_PUSH_BYTES = 8 * 1024 * 1024;

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.')) {
        ips.push({ iface: name, address: net.address });
      }
    }
  }
  return ips;
}

function sanitizeRow(tableName, row) {
  if (!row || typeof row !== 'object') return null;
  if (SENSITIVE_TABLES.has(tableName)) return null;
  if (tableName === 'settings') {
    if (typeof row.key !== 'string') return null;
    if (LOCAL_SETTING_KEYS.has(row.key)) return null;
    if (row.key.startsWith('autoBackup-')) return null;
  } else if (typeof row.id !== 'string') {
    return null;
  }
  return row;
}

/** Drops credentials, device-local settings and malformed rows from a snapshot. */
function sanitizeTables(tables) {
  const out = {};
  if (!tables || typeof tables !== 'object') return out;
  for (const [name, rows] of Object.entries(tables)) {
    if (SENSITIVE_TABLES.has(name) || !Array.isArray(rows)) continue;
    const clean = [];
    for (const row of rows) {
      const kept = sanitizeRow(name, row);
      if (kept) clean.push(kept);
    }
    out[name] = clean;
  }
  return out;
}

function mergePayloads(a, b) {
  if (!a) return b;
  if (!b) return a;
  const merged = { appVersion: b.appVersion || a.appVersion, exportedAt: Date.now(), tables: {} };
  const allTables = new Set([...Object.keys(a.tables || {}), ...Object.keys(b.tables || {})]);
  for (const t of allTables) {
    const idOf = t === 'settings' ? (r) => r.key : (r) => r.id;
    const map = new Map();
    for (const r of a.tables[t] || []) map.set(idOf(r), r);
    for (const r of b.tables[t] || []) {
      const key = idOf(r);
      const prev = map.get(key);
      if (!prev || (r.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) map.set(key, r);
    }
    merged.tables[t] = [...map.values()];
  }
  return merged;
}

function startSyncServer(port = 8080, token = '') {
  if (httpServer) return { httpServer, io, port };
  pairingToken = token || crypto.randomBytes(16).toString('hex');
  httpServer = createServer();
  let Server;
  try { ({ Server } = require('socket.io')); } catch (e) {
    console.error('[sync-server] socket.io not installed, sync disabled', e.message);
    return { httpServer: null, io: null, port };
  }
  io = new Server(httpServer, {
    maxHttpBufferSize: MAX_PUSH_BYTES,
    cors: { origin: '*' },
    pingInterval: 15000,
    pingTimeout: 10000,
  });

  io.use((socket, next) => {
    const supplied = socket.handshake.auth?.token || socket.handshake.query?.key;
    const expected = Buffer.from(pairingToken);
    const given = Buffer.from(String(supplied || ''));
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) {
      console.warn('[sync-server] rejected unauthenticated client', socket.handshake.address);
      next(new Error('UNAUTHORIZED'));
      return;
    }
    next();
  });

  io.on('connection', socket => {
    console.log('[sync-server] client connected', socket.id, socket.handshake.address);
    socket.join('store');
    if (latest) socket.emit('sync', latest);
    broadcastClientCount();

    socket.on('push', payload => {
      if (!payload || typeof payload !== 'object' || !payload.tables) return;
      try {
        latest = mergePayloads(latest, {
          appVersion: payload.appVersion,
          exportedAt: Date.now(),
          tables: sanitizeTables(payload.tables),
        });
        io.to('store').emit('sync', latest);
      } catch (e) {
        console.error('[sync-server] failed to merge push', e.message);
      }
    });
    socket.on('pull', () => { if (latest) socket.emit('sync', latest); });
    socket.on('scan', data => {
      const barcode = typeof data === 'string' ? data : data?.barcode;
      const deviceId = typeof data === 'object' ? data?.deviceId : undefined;
      if (typeof barcode !== 'string' || !barcode.trim() || barcode.length > 128) return;
      scanCount++;
      io.to('store').emit('scan', { barcode: barcode.trim(), at: Date.now(), senderId: socket.id, deviceId });
    });
    socket.on('disconnect', () => {
      broadcastClientCount();
    });
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[sync-server] port ${port} in use, trying ${port + 1}`);
      httpServer = null;
      io = null;
      return startSyncServer(port + 1, pairingToken);
    }
    console.error('[sync-server] http error', err);
  });

  httpServer.listen(port, '0.0.0.0', () => {
    const ips = getLanIps();
    console.log(`[sync-server] Socket.IO listening on 0.0.0.0:${port}`);
    ips.forEach(({ address, iface }) => console.log(`  -> ws://${address}:${port} (${iface})`));
    if (ips.length === 0) console.log(`  -> ws://localhost:${port} (no LAN IP found)`);
  });

  return { httpServer, io, port };
}

function broadcastClientCount() {
  if (!io) return;
  const room = io.sockets.adapter.rooms.get('store');
  const count = room ? room.size : 0;
  io.to('store').emit('clients', { count });
}

function getSyncServerInfo() {
  const ips = getLanIps();
  const port = httpServer ? httpServer.address()?.port || 8080 : 8080;
  const withKey = (host) => `ws://${host}:${port}?key=${pairingToken}`;
  return {
    running: !!httpServer,
    port,
    ips: ips.map(i => i.address),
    interfaces: ips,
    // Pairing URLs carry the token so scanning the QR is enough to join.
    wsUrls: ips.map(i => withKey(i.address)),
    primaryWsUrl: ips[0] ? withKey(ips[0].address) : `ws://localhost:${port}?key=${pairingToken}`,
    localWsUrl: `ws://localhost:${port}?key=${pairingToken}`,
    token: pairingToken,
    scanCount,
    latestAt: latest?.exportedAt || null,
  };
}

function stopSyncServer() {
  if (io) try { io.close(); } catch {}
  if (httpServer) try { httpServer.close(); } catch {}
  io = null;
  httpServer = null;
}

module.exports = { startSyncServer, getSyncServerInfo, stopSyncServer, getLanIps, sanitizeTables };
