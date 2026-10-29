import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 8080);
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

let latest = null;

function mergePayloads(a, b) {
  if (!a) return b;
  if (!b) return a;
  const merged = { appVersion: b.appVersion || a.appVersion, exportedAt: Date.now(), tables: {} };
  const allTables = new Set([...Object.keys(a.tables || {}), ...Object.keys(b.tables || {})]);
  for (const t of allTables) {
    const map = new Map();
    for (const r of (a.tables[t] || [])) map.set(r.id, r);
    for (const r of (b.tables[t] || [])) {
      const prev = map.get(r.id);
      if (!prev || (r.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) map.set(r.id, r);
      if (t === 'products' && r.sku) {
        for (const [k, v] of map) if (k !== r.id && v.sku === r.sku && (r.updatedAt ?? 0) >= (v.updatedAt ?? 0)) map.delete(k);
      }
    }
    merged.tables[t] = [...map.values()];
  }
  return merged;
}

io.on('connection', socket => {
  console.log('client connected', socket.id);
  socket.join('store');
  if (latest) socket.emit('sync', latest);
  socket.on('push', payload => {
    if (!payload?.tables) return;
    latest = mergePayloads(latest, payload);
    io.to('store').emit('sync', latest);
  });
  socket.on('pull', () => { if (latest) socket.emit('sync', latest); });
  socket.on('scan', data => {
    const barcode = typeof data === 'string' ? data : data?.barcode;
    console.log('scan', barcode, 'from', socket.id);
    if (barcode) io.to('store').emit('scan', { barcode });
  });
  socket.on('disconnect', () => console.log('client disconnected', socket.id));
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Socket.IO sync on ws://0.0.0.0:${PORT}`));
