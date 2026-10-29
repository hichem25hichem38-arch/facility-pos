// Local, credential-free exercise of the real activation routes.
// Run: node activation-site/dev/local-check.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../functions/app.mjs';
import { fakeDb } from './fake-db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const secrets = JSON.parse(readFileSync(join(here, '../.secrets/vendor.json'), 'utf8'));

const db = fakeDb();
const env = (name) => {
  if (name === 'VENDOR_API_KEY') return secrets.apiKey;
  if (name === 'LICENSE_PRIVATE_JWK') return JSON.stringify(secrets.privateJwk);
  if (name === 'DEBUG') return '1';
  return undefined;
};
const app = createApp({ db, env });

const base = 'https://pos.example/functions/v1/app';
async function call(action, body, { token, method = 'POST', query = '' } = {}) {
  const headers = {};
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (token) headers['x-vendor-token'] = token;
  const request = new Request(`${base}?action=${encodeURIComponent(action)}${query}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const response = await app(request);
  return { status: response.status, body: await response.json() };
}

async function verifyClientLicense(license, device) {
  const [prefix, signature, expiry] = license.split('.');
  assert.equal(prefix, 'LIC1');
  const key = await crypto.subtle.importKey(
    'jwk',
    secrets.publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const padded = signature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (signature.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    bytes,
    new TextEncoder().encode(`${device}|${Number(expiry)}|LIC1`),
  );
  assert.equal(valid, true, 'client must verify the licence');

  const forged = `${prefix}.${signature.slice(0, 10)}${signature.slice(10, 12) === 'AA' ? 'BB' : 'AA'}${signature.slice(12)}.${expiry}`;
  const forgedOk = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Uint8Array.from(atob(forged.split('.')[1].replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(`${device}|${Number(expiry)}|LIC1`),
  );
  assert.equal(forgedOk, false, 'tampered licence must be rejected');
}

const step = (label) => console.log(`  ✓ ${label}`);

// health
{
  const r = await call('health', null, { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  step('health');
}

// auth
{
  assert.equal((await call('vendor/list', {})).status, 401);
  assert.equal((await call('vendor/login', { apiKey: 'wrong-key' })).status, 401);
  const login = await call('vendor/login', { apiKey: secrets.apiKey });
  assert.equal(login.status, 200);
  assert.ok(login.body.token.length >= 20);
  var token = login.body.token;
  step('vendor login + auth wall');
}

const device = 'DESKTOP-1A2B3C4D5E6F';

// issue
let code;
{
  const r = await call('vendor/issue', {
    deviceId: device.toLowerCase(),
    name: 'محمد بن علي',
    phone: '0551234567',
    storeName: 'محل الأمانة',
    durationDays: 30,
    notes: 'عميل تجريبي',
  }, { token });
  assert.equal(r.status, 200);
  assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(r.body.deviceId, device);
  code = r.body.code;
  step('issue code');
}

// wrong device
{
  const r = await call('activate', { code, deviceId: 'DESKTOP-999999999999' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'device_mismatch');
  step('device binding rejects another machine');
}

// activate
let license;
let expiresAt;
{
  const r = await call('activate', { code, deviceId: device, appVersion: '1.0.4', platform: 'desktop' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  license = r.body.license;
  expiresAt = r.body.expiresAt;
  assert.ok(license.startsWith('LIC1.'));
  const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30.01, `expected ~30 days, got ${days}`);
  await verifyClientLicense(license, device);
  step('activate (signed, device-bound, client-verifiable)');
}

// duplicate code on same device = reactivation, same expiry
{
  const r = await call('activate', { code, deviceId: device, appVersion: '1.0.4', platform: 'desktop' });
  assert.equal(r.status, 200);
  assert.equal(r.body.expiresAt, expiresAt);
  step('reinstall reactivation keeps expiry');
}

// invalid code
{
  const r = await call('activate', { code: 'ZZZZ-ZZZZ-ZZZZ', deviceId: device });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_code');
  step('invalid code rejected');
}

// list + stats
let clientId;
{
  const r = await call('vendor/list', {}, { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.stats.total, 1);
  assert.equal(r.body.stats.active, 1);
  const item = r.body.items[0];
  assert.equal(item.name, 'محمد بن علي');
  assert.equal(item.phone, '0551234567');
  assert.equal(item.storeName, 'محل الأمانة');
  assert.equal(item.deviceId, device);
  assert.equal(item.appVersion, '1.0.4');
  assert.equal(item.platform, 'desktop');
  assert.ok(item.lastSeenAt);
  clientId = item.id;
  step('monitoring list + stats');
}

// heartbeat with valid licence, then forged licence
{
  const r = await call('heartbeat', { license, deviceId: device, appVersion: '1.0.5', platform: 'desktop' });
  assert.equal(r.status, 200);
  assert.equal(r.body.revoked, false);
  const list = await call('vendor/list', {}, { token });
  assert.equal(list.body.items[0].appVersion, '1.0.5');

  const forged = `${license.slice(0, 30)}${license[30] === 'A' ? 'B' : 'A'}${license.slice(31)}`;
  const bad = await call('heartbeat', { license: forged, deviceId: device });
  assert.equal(bad.status, 403);
  step('heartbeat + signature gate');
}

// renew: code must extend from the current expiry
{
  const before = Date.parse(expiresAt);
  const r = await call('vendor/renew', { clientId, durationDays: 90 }, { token });
  assert.equal(r.status, 200);
  const again = await call('activate', { code: r.body.code, deviceId: device, appVersion: '1.0.5', platform: 'desktop' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const after = Date.parse(again.body.expiresAt);
  const added = (after - before) / 86_400_000;
  assert.ok(added > 89.9 && added <= 90.01, `expected +90 days, got ${added}`);
  license = again.body.license;
  step('renewal code extends remaining time');
}

// revoke / restore
{
  const r = await call('vendor/revoke', { clientId }, { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'revoked');
  const beat = await call('heartbeat', { license, deviceId: device });
  assert.equal(beat.status, 200);
  assert.equal(beat.body.revoked, true);
  const list = await call('vendor/list', { status: 'revoked' }, { token });
  assert.equal(list.body.total, 1);
  const issue = await call('vendor/issue', {
    deviceId: device, name: 'محمد بن علي', phone: '0551234567', storeName: 'محل الأمانة', durationDays: 30,
  }, { token });
  const blocked = await call('activate', { code: issue.body.code, deviceId: device });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'license_revoked');
  const restore = await call('vendor/restore', { clientId }, { token });
  assert.equal(restore.body.status, 'active');
  const allowed = await call('activate', { code: issue.body.code, deviceId: device, appVersion: '1.0.5', platform: 'desktop' });
  assert.equal(allowed.status, 200);
  step('revoke blocks activation, restore re-enables');
}

// permanent licence
{
  const issue = await call('vendor/issue', {
    deviceId: 'DESKTOP-PERMANENT01', name: 'عميل دائم', phone: '+213 555 000 111', storeName: 'متجر دائم', durationDays: 0,
  }, { token });
  const r = await call('activate', { code: issue.body.code, deviceId: 'DESKTOP-PERMANENT01' });
  assert.equal(r.status, 200);
  assert.equal(r.body.permanent, true);
  assert.equal(r.body.expiresAt, null);
  assert.ok(r.body.license.endsWith('.0'));
  step('permanent licence (no expiry)');
}

// events log
{
  const r = await call('vendor/events', { clientId }, { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 3);
  assert.ok(r.body.items.some((e) => e.kind === 'revoke'));
  step('event history');
}

// rate limiter / invalid session
{
  const r = await call('vendor/list', {}, { token: 'x'.repeat(40) });
  assert.equal(r.status, 401);
  const r2 = await call('vendor/list', null, { method: 'GET', token });
  assert.equal(r2.status, 405);
  step('session + method gates');
}

console.log('\nAll activation-service checks passed.');
