// Local preview: serves web/ and mounts the real activation handler with an in-memory DB.
// Usage: node activation-site/dev/server.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../functions/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../web');
const port = Number(process.argv[2] || 4321);
const secrets = JSON.parse(readFileSync(join(here, '../.secrets/vendor.json'), 'utf8'));

// Same in-memory semantics as dev/local-check.mjs.
function fakeDb() {
  const tables = new Map();
  const list = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const pick = (row, columns) =>
    !columns || columns === '*'
      ? { ...row }
      : Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]]));

  function builder(table, mode, values) {
    const filters = [];
    let columns = '*';
    let orderBy = null;
    let ascending = true;
    let maxRows = Infinity;
    const run = () => {
      const data = list(table);
      const match = (row) => filters.every(([key, value]) => row[key] === value);
      if (mode === 'read') {
        const selected = data.filter(match);
        if (orderBy) selected.sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])) * (ascending ? 1 : -1));
        return { data: selected.slice(0, maxRows).map((row) => pick(row, columns)), error: null };
      }
      if (mode === 'insert') {
        const unique = String(values.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        if (unique.length && data.some((row) => unique.every((key) => row[key] === values.row[key]))) return { data: [], error: null };
        data.push({ ...values.row });
        return { data: [pick(values.row, columns)], error: null };
      }
      const matched = data.filter(match);
      for (const row of matched) Object.assign(row, values.row);
      return { data: matched.map((row) => pick(row, columns)), error: null };
    };
    const chain = {
      eq(key, value) { filters.push([key, value]); return chain; },
      limit(count) { maxRows = count; return chain; },
      order(name, options) { orderBy = String(name); ascending = options?.ascending !== false; return chain; },
      select(names) { if (typeof names === 'string') columns = names; return chain; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return chain;
  }
  return {
    from(table) {
      return {
        select: (columns) => builder(table, 'read', null).select(columns),
        insertIfAbsent: (row, options) => builder(table, 'insert', { row, onConflict: options?.onConflict }),
        insert: (row) => builder(table, 'insert', { row }),
        update: (row) => builder(table, 'update', { row }),
      };
    },
  };
}

const app = createApp({
  db: fakeDb(),
  env: (name) => {
    // Throwaway local-only credential; never the deployed vendor key.
    if (name === 'VENDOR_API_KEY') return 'VND-LOCAL-DEV-ONLY-KEY';
    if (name === 'LICENSE_PRIVATE_JWK') return JSON.stringify(secrets.privateJwk);
    return undefined;
  },
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/functions/v1/app')) {
      const body = await readBody(req);
      const request = new Request(url.toString(), {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')),
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
      });
      const response = await app(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
    const file = join(webRoot, relative);
    if (!file.startsWith(webRoot)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Server error');
    console.error(error);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Activation preview on http://127.0.0.1:${port}`);
});
