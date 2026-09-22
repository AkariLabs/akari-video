import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_AKARI_HOST } from '../src/service-urls.cjs';
import { DEFAULT_STORE_BASE_URL, fetchStoreEntitlements, readCredentials, startDeviceConnection, pollDeviceConnection } from '../src/store-device-connect.mjs';

for (const [baseUrl, expected] of [
  [undefined, 'https://akari.video/api/store'],
  [`https://${LEGACY_AKARI_HOST}/api/store`, 'https://akari.video/api/store'],
  [`https://${LEGACY_AKARI_HOST}/api/store/`, 'https://akari.video/api/store'],
  ['https://akari.video/api/store', 'https://akari.video/api/store'],
  ['http://localhost:8788/api/store', 'http://localhost:8788/api/store'],
]) test(`store device connection and credential migration: ${baseUrl}`, async t => {
  const home = mkdtempSync(path.join(tmpdir(), 'akari-domain-device-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { AKARI_HOME: home };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('/device/start')) return new Response(JSON.stringify({ device_code: 'device', user_code: 'code', verification_url: `${expected}/verify` }));
    if (url.endsWith('/device/claim')) return new Response(JSON.stringify({ status: 'approved', token: 'akst_fixture' }));
    return new Response(JSON.stringify({ email: 'test@example.test', entitlements: [] }));
  };
  assert.equal(DEFAULT_STORE_BASE_URL, 'https://akari.video/api/store');
  const started = await startDeviceConnection({ baseUrl, fetchImpl });
  assert.equal(started.baseUrl, expected);
  assert.equal(started.status, 'started');
  const input = baseUrl ?? DEFAULT_STORE_BASE_URL;
  const file = path.join(home, 'store-credentials.json');
  writeFileSync(file, JSON.stringify({ url: input, token: 'akst_fixture' }));
  const credentials = readCredentials(env);
  assert.equal(credentials.url.replace(/\/+$/, ''), expected);
  await fetchStoreEntitlements(fetchImpl, credentials.url, credentials.token);
  assert.equal(JSON.parse(readFileSync(file)).url, input, 'reading does not rewrite credentials');
  assert.equal((await pollDeviceConnection({ baseUrl: input, deviceCode: started.deviceCode, fetchImpl, env })).status, 'approved');
  assert.deepEqual(calls, [`${expected}/device/start`, `${expected}/v1/entitlements`, `${expected}/device/claim`, `${expected}/v1/entitlements`]);
  assert.equal(readCredentials(env).url.replace(/\/+$/, ''), expected);
});
