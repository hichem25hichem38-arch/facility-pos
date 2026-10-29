/*
 * Activation service business logic (dependency-free, unit-testable).
 * index.ts wires this to the platform database client and Deno.env.
 *
 * Routes (same-origin /functions/v1/app?action=...):
 *   GET  health
 *   POST activate      { code, deviceId, appVersion?, platform? }
 *   POST heartbeat     { license, deviceId, appVersion?, platform? }
 *   POST vendor/login  { apiKey }                    -> bearer token
 *   POST vendor/issue  { deviceId, name, phone, storeName, durationDays, notes? }
 *   POST vendor/renew  { clientId, durationDays }    -> new activation code
 *   POST vendor/revoke | vendor/restore { clientId }
 *   POST vendor/list   { query?, status? }           -> rows + stats
 *   POST vendor/events { clientId }
 *
 * The licence signature (ECDSA P-256, LIC1.<sig>.<expMs>) is produced only
 * here; the client verifies it offline with the public key baked into the app.
 */

const LICENSE_PREFIX = 'LIC1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const CODE_TTL_MS = 30 * 86_400_000;
const SESSION_TTL_MS = 12 * 3_600_000;
const BODY_LIMIT = 16_384;
const MAX_CLIENTS = 1000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-vendor-token',
  'cache-control': 'no-store',
};

class AppError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const ok = (value = {}, status = 200) => Response.json({ ok: true, ...value }, { status, headers: CORS });
const fail = (code, status = 400, extra = {}) =>
  Response.json({ ok: false, error: code, ...extra }, { status, headers: CORS });

const enc = new TextEncoder();
const text = (value) => (typeof value === 'string' ? value : '');

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return b64url(buffer);
}

function randomCode() {
  const buffer = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buffer);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[buffer[i] % CODE_ALPHABET.length];
  return out;
}

function normalizeCode(raw) {
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function formatCode(raw) {
  const clean = normalizeCode(raw);
  return clean.match(/.{1,4}/g)?.join('-') ?? clean;
}

function sameSecret(a, b) {
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function deviceId(value) {
  const id = text(value).trim().toUpperCase();
  if (!/^[A-Z0-9._-]{4,64}$/.test(id)) throw new AppError('invalid_device_id', 400);
  return id;
}

const iso = (value) => (value == null ? null : new Date(value).toISOString());

function ms(value) {
  // The platform client may hand back a Date, a number or an ISO string.
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function duration(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new AppError('invalid_duration', 400);
  return days;
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError('invalid_input', 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('invalid_input', 400);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw new AppError('payload_too_large', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch {
    throw new AppError('invalid_input', 400);
  }
}

function rows(result) {
  if (!result || result.error || !Array.isArray(result.data)) throw new AppError('database_unavailable', 503);
  return result.data;
}

/* ---------- licence signature ---------- */

function privateJwk(env) {
  const raw = env('LICENSE_PRIVATE_JWK');
  if (!raw) throw new AppError('service_not_configured', 503);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('service_not_configured', 503);
  }
  if (parsed?.kty !== 'EC' || parsed?.crv !== 'P-256' || !parsed.d || !parsed.x || !parsed.y) {
    throw new AppError('service_not_configured', 503);
  }
  return parsed;
}

async function importSigningKeys(jwk) {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
  const publicJwk = { kty: jwk.kty, x: jwk.x, y: jwk.y, crv: jwk.crv, ext: true };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['sign']);
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, algorithm, false, ['verify']);
  return { privateKey, publicKey };
}

async function signLicense(key, id, expiryMs) {
  const expiry = expiryMs && expiryMs > 0 ? Math.floor(expiryMs) : 0;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(`${id}|${expiry}|${LICENSE_PREFIX}`),
  );
  return `${LICENSE_PREFIX}.${b64url(new Uint8Array(signature))}.${expiry}`;
}

async function verifyLicense(key, license, id) {
  const parts = license.trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return null;
  const expiry = Number(parts[2]);
  if (!Number.isFinite(expiry) || expiry < 0) return null;
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[1].length % 4)) % 4);
  let signature;
  try {
    signature = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature,
    enc.encode(`${id}|${expiry}|${LICENSE_PREFIX}`),
  );
  return valid ? expiry : null;
}

/* ---------- rate limiting (fixed window, DB backed) ---------- */

async function consume(db, key, max, windowMs) {
  const now = Date.now();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const found = rows(await db.from('lic_limiter').select('key,window_started_at,attempt_count').eq('key', key).limit(1));
    if (found.length === 0) {
      const inserted = rows(
        await db
          .from('lic_limiter')
          .insertIfAbsent({ key, window_started_at: new Date(now).toISOString(), attempt_count: 1 }, { onConflict: 'key' })
          .select('key'),
      );
      if (inserted.length === 1) return { allowed: true };
      continue;
    }
    const row = found[0];
    const startedAt = ms(row.window_started_at);
    const count = Number(row.attempt_count);
    if (startedAt == null || !Number.isSafeInteger(count) || count < 0) throw new AppError('limiter_unavailable', 503);
    if (now - startedAt >= windowMs) {
      const reset = rows(
        await db
          .from('lic_limiter')
          .update({ window_started_at: new Date(now).toISOString(), attempt_count: 1 })
          .eq('key', key)
          .eq('window_started_at', row.window_started_at)
          .select('key'),
      );
      if (reset.length === 1) return { allowed: true };
      continue;
    }
    if (count >= max) return { allowed: false, retryAfterMs: Math.max(0, startedAt + windowMs - now) };
    const bumped = rows(
      await db
        .from('lic_limiter')
        .update({ attempt_count: count + 1 })
        .eq('key', key)
        .eq('window_started_at', row.window_started_at)
        .eq('attempt_count', count)
        .select('key'),
    );
    if (bumped.length === 1) return { allowed: true };
  }
  throw new AppError('limiter_busy', 503);
}

/* ---------- vendor sessions ---------- */

async function createSession(db) {
  const token = randomToken();
  const digest = await sha256Hex(token);
  const inserted = rows(
    await db
      .from('lic_sessions')
      .insertIfAbsent(
        {
          token_hash: digest,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        },
        { onConflict: 'token_hash' },
      )
      .select('token_hash'),
  );
  if (inserted.length !== 1) throw new AppError('session_unavailable', 503);
  return token;
}

async function requireVendor(db, request) {
  // `authorization` is reserved by the site gateway, so the vendor session
  // travels in its own header; the legacy form still works for local runs.
  const custom = (request.headers.get('x-vendor-token') ?? '').trim();
  const legacy = custom ? '' : (request.headers.get('authorization') ?? '').trim();
  const raw = custom || legacy;
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new AppError('unauthorized', 401);
  const digest = await sha256Hex(token);
  const found = rows(await db.from('lic_sessions').select('token_hash,expires_at').eq('token_hash', digest).limit(1));
  const expiresAt = found.length === 1 ? ms(found[0].expires_at) : null;
  if (expiresAt == null || expiresAt <= Date.now()) throw new AppError('unauthorized', 401);
}

/* ---------- business helpers ---------- */

async function event(db, clientId, kind, detail = '') {
  await db.from('lic_events').insert({
    id: crypto.randomUUID(),
    client_id: clientId,
    kind,
    detail: String(detail).slice(0, 300),
    created_at: new Date().toISOString(),
  });
}

async function findClientByDevice(db, id) {
  const found = rows(await db.from('lic_clients').select('*').eq('device_id', id).limit(1));
  return found[0] ?? null;
}

async function findClientById(db, clientId) {
  const found = rows(await db.from('lic_clients').select('*').eq('id', clientId).limit(1));
  return found[0] ?? null;
}

async function upsertClient(db, values) {
  const existing = await findClientByDevice(db, String(values.device_id));
  const now = new Date().toISOString();
  if (existing) {
    const updated = rows(
      await db.from('lic_clients').update({ ...values, updated_at: now }).eq('id', existing.id).select('id'),
    );
    if (updated.length !== 1) throw new AppError('write_failed', 503);
    return String(existing.id);
  }
  const inserted = rows(
    await db
      .from('lic_clients')
      .insertIfAbsent(
        { id: crypto.randomUUID(), status: 'pending', created_at: now, updated_at: now, ...values },
        { onConflict: 'device_id' },
      )
      .select('id'),
  );
  if (inserted.length === 1) return String(inserted[0].id);
  const raced = await findClientByDevice(db, String(values.device_id));
  if (!raced) throw new AppError('write_failed', 503);
  return String(raced.id);
}

async function createCode(db, clientId, days) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const digest = await sha256Hex(code);
    const inserted = rows(
      await db
        .from('lic_codes')
        .insertIfAbsent(
          {
            code_hash: digest,
            code_prefix: formatCode(code).slice(0, 4),
            client_id: clientId,
            duration_days: days,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
            attempts: 0,
          },
          { onConflict: 'code_hash' },
        )
        .select('code_hash'),
    );
    if (inserted.length === 1) return formatCode(code);
  }
  throw new AppError('code_generation_failed', 503);
}

function publicClient(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    phone: row.phone,
    storeName: row.store_name,
    status: row.status,
    durationDays: row.duration_days,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    appVersion: row.app_version,
    platform: row.platform,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function clientStatus(row) {
  if (row.status === 'revoked') return 'revoked';
  if (row.status !== 'active') return 'pending';
  const expiry = ms(row.expires_at);
  if (expiry != null && expiry <= Date.now()) return 'expired';
  return 'active';
}

/* ---------- handler ---------- */

export function createApp(deps) {
  const { db, env } = deps;
  const debug = env('DEBUG') === '1';

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) return fail('not_found', 404);
    const action = (url.searchParams.get('action') ?? match[1]?.replace(/^\//, '') ?? '').trim();

    try {
      if (action === 'health' && request.method === 'GET') {
        return ok({ service: 'pos-activation', time: new Date().toISOString() });
      }
      if (request.method !== 'POST') return fail('method_not_allowed', 405);
      if (!action) return fail('not_found', 404);

      // ---- public: activate ----
      if (action === 'activate') {
        const allowed = await consume(db, 'activate', 300, 15 * 60 * 1000);
        if (!allowed.allowed) return fail('rate_limited', 429, { retryAfterMs: allowed.retryAfterMs });
        const body = await readJson(request);
        const id = deviceId(body.deviceId);
        const rawCode = text(body.code).trim();
        if (rawCode.length < 8) return fail('invalid_code', 400);
        const digest = await sha256Hex(normalizeCode(rawCode));
        const codes = rows(await db.from('lic_codes').select('*').eq('code_hash', digest).limit(1));
        if (codes.length !== 1) return fail('invalid_code', 400);
        const code = codes[0];
        if (Number(code.attempts) > 40) return fail('code_locked', 429);
        await db
          .from('lic_codes')
          .update({ attempts: Number(code.attempts) + 1 })
          .eq('code_hash', digest)
          .select('code_hash');

        const client = await findClientById(db, String(code.client_id));
        if (!client) return fail('invalid_code', 400);
        if (String(client.device_id) !== id) return fail('device_mismatch', 403);
        const codeExpiry = ms(code.expires_at);
        if (codeExpiry != null && codeExpiry <= Date.now()) return fail('code_expired', 410);
        if (client.status === 'revoked') return fail('license_revoked', 403);

        const key = await importSigningKeys(privateJwk(env));
        const now = Date.now();
        let expiry = ms(client.expires_at);

        if (!code.used_at) {
          // First use of this code: its duration stacks on any remaining time.
          const days = Number(code.duration_days);
          const base = expiry != null && expiry > now ? expiry : now;
          expiry = days === 0 ? null : base + days * 86_400_000;
          const updated = rows(
            await db
              .from('lic_clients')
              .update({
                status: 'active',
                duration_days: days,
                activated_at: client.activated_at ?? new Date(now).toISOString(),
                expires_at: iso(expiry),
                last_seen_at: new Date(now).toISOString(),
                app_version: text(body.appVersion).slice(0, 40) || null,
                platform: text(body.platform).slice(0, 30) || null,
                updated_at: new Date(now).toISOString(),
              })
              .eq('id', String(client.id))
              .select('id'),
          );
          if (updated.length !== 1) return fail('write_failed', 503);
          await db
            .from('lic_codes')
            .update({ used_at: new Date(now).toISOString() })
            .eq('code_hash', digest)
            .select('code_hash');
          await event(db, String(client.id), 'activate', `+${days}d`);
        } else {
          // Re-activation on the same machine (reinstall): keep the same expiry.
          if (expiry != null && expiry <= now) return fail('license_expired', 410);
          await db
            .from('lic_clients')
            .update({
              last_seen_at: new Date(now).toISOString(),
              app_version: text(body.appVersion).slice(0, 40) || null,
              platform: text(body.platform).slice(0, 30) || null,
              updated_at: new Date(now).toISOString(),
            })
            .eq('id', String(client.id))
            .select('id');
          await event(db, String(client.id), 'reactivate');
        }

        const license = await signLicense(key.privateKey, id, expiry);
        return ok({
          license,
          deviceId: id,
          expiresAt: iso(expiry),
          permanent: expiry == null,
          storeName: client.store_name ?? '',
        });
      }

      // ---- public: heartbeat ----
      if (action === 'heartbeat') {
        const body = await readJson(request);
        const id = deviceId(body.deviceId);
        const license = text(body.license);
        if (license.length < 20) return fail('invalid_license', 400);
        const key = await importSigningKeys(privateJwk(env));
        const expiry = await verifyLicense(key.publicKey, license, id);
        if (expiry == null) return fail('invalid_license', 403);
        const client = await findClientByDevice(db, id);
        if (!client) return fail('unknown_device', 404);
        const now = Date.now();
        if (expiry > 0 && expiry < now) return fail('license_expired', 410);
        const revoked = client.status === 'revoked';
        await db
          .from('lic_clients')
          .update({
            last_seen_at: new Date(now).toISOString(),
            app_version: text(body.appVersion).slice(0, 40) || null,
            platform: text(body.platform).slice(0, 30) || null,
          })
          .eq('id', String(client.id))
          .select('id');
        return ok({ revoked, expiresAt: iso(expiry > 0 ? expiry : null) });
      }

      // ---- vendor login ----
      if (action === 'vendor/login') {
        const allowed = await consume(db, 'vendor-login', 12, 15 * 60 * 1000);
        if (!allowed.allowed) return fail('rate_limited', 429, { retryAfterMs: allowed.retryAfterMs });
        const body = await readJson(request);
        const expected = env('VENDOR_API_KEY');
        if (!expected) return fail('service_not_configured', 503);
        if (!sameSecret(text(body.apiKey).trim(), expected)) return fail('invalid_credentials', 401);
        const token = await createSession(db);
        return ok({ token, expiresInMs: SESSION_TTL_MS });
      }

      // ---- vendor endpoints ----
      if (action.startsWith('vendor/')) {
        await requireVendor(db, request);
        const body = await readJson(request);

        if (action === 'vendor/issue' || action === 'vendor/renew') {
          let id;
          let days;
          let name;
          let phone;
          let storeName;
          let notes = '';
          let targetId = null;

          if (action === 'vendor/renew') {
            const client = await findClientById(db, text(body.clientId));
            if (!client) return fail('not_found', 404);
            id = String(client.device_id);
            name = String(client.name ?? '');
            phone = String(client.phone ?? '');
            storeName = String(client.store_name ?? '');
            notes = String(client.notes ?? '');
            days = duration(body.durationDays);
            targetId = String(client.id);
          } else {
            id = deviceId(body.deviceId);
            days = duration(body.durationDays);
            name = text(body.name).trim().slice(0, 120);
            phone = text(body.phone).trim().slice(0, 40);
            storeName = text(body.storeName).trim().slice(0, 120);
            notes = text(body.notes).trim().slice(0, 300);
            if (name.length < 2 || storeName.length < 2) return fail('invalid_input', 400);
            if (!/^[0-9+()\-\s.]{6,40}$/.test(phone)) return fail('invalid_phone', 400);
          }

          const clientId =
            targetId ??
            (await upsertClient(db, {
              device_id: id,
              name,
              phone,
              store_name: storeName,
              notes,
              duration_days: days,
            }));

          // A revoked client stays blocked until the vendor restores it explicitly.
          const code = await createCode(db, clientId, days);
          await event(db, clientId, action === 'vendor/renew' ? 'renew_code' : 'issue_code', `${days}d`);
          return ok({ code, deviceId: id, durationDays: days, validUntil: iso(Date.now() + CODE_TTL_MS), clientId });
        }

        if (action === 'vendor/revoke' || action === 'vendor/restore') {
          const client = await findClientById(db, text(body.clientId));
          if (!client) return fail('not_found', 404);
          const expiresAt = ms(client.expires_at);
          const status =
            action === 'vendor/revoke' ? 'revoked' : expiresAt != null && expiresAt <= Date.now() ? 'pending' : 'active';
          await db
            .from('lic_clients')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', String(client.id))
            .select('id');
          await event(db, String(client.id), action === 'vendor/revoke' ? 'revoke' : 'restore');
          return ok({ status });
        }

        if (action === 'vendor/events') {
          const list = rows(
            await db
              .from('lic_events')
              .select('kind,detail,created_at')
              .eq('client_id', text(body.clientId))
              .order('created_at', { ascending: false })
              .limit(20),
          );
          return ok({ items: list });
        }

        if (action === 'vendor/list') {
          const list = rows(
            await db.from('lic_clients').select('*').order('created_at', { ascending: false }).limit(MAX_CLIENTS),
          );
          const query = text(body.query).trim().toLowerCase();
          const statusFilter = text(body.status).trim();
          const now = Date.now();
          let items = list.map((row) => ({ ...publicClient(row), computed: clientStatus(row) }));
          const stats = {
            total: items.length,
            active: items.filter((c) => c.computed === 'active').length,
            pending: items.filter((c) => c.computed === 'pending').length,
            expired: items.filter((c) => c.computed === 'expired').length,
            revoked: items.filter((c) => c.computed === 'revoked').length,
            expiringSoon: items.filter((c) => {
              const expiry = ms(c.expiresAt);
              return c.computed === 'active' && expiry != null && expiry - now <= 7 * 86_400_000;
            }).length,
          };
          if (query) {
            items = items.filter((c) =>
              [c.name, c.phone, c.storeName, c.deviceId].some((v) => String(v ?? '').toLowerCase().includes(query)),
            );
          }
          if (statusFilter) items = items.filter((c) => c.computed === statusFilter);
          return ok({ items, stats, total: items.length });
        }

        return fail('not_found', 404);
      }

      return fail('not_found', 404);
    } catch (error) {
      if (error instanceof AppError) return fail(error.code, error.status);
      if (debug) console.error(error);
      return fail('internal_error', 500);
    }
  };
}
