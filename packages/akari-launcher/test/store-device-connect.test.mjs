import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  pollDeviceConnection,
  resolveCredentialsPath,
  startDeviceConnection
} from '../src/store-device-connect.mjs';

const BASE_URL = 'http://localhost:9999/api/store';
const TOKEN = 'akst_gui-test_0123456789';

function makeHome() {
  const home = mkdtempSync(path.join(tmpdir(), 'akari-device-connect-test-'));
  return {
    env: { AKARI_HOME: home },
    cleanup: () => rmSync(home, { recursive: true, force: true })
  };
}

test('device connection: start → browser → approved saves 0600 credentials', async () => {
  const home = makeHome();
  const opened = [];
  const fetchImpl = async url => {
    if (url.endsWith('/device/start')) {
      return new Response(JSON.stringify({
        device_code: 'gui-device-1',
        user_code: 'GUI1-2345',
        verification_url: 'http://localhost:9999/store/connect?code=GUI1-2345',
        interval: 1,
        expires_in: 60
      }), { status: 200 });
    }
    if (url.endsWith('/device/claim')) {
      return new Response(JSON.stringify({ status: 'approved', token: TOKEN }), { status: 200 });
    }
    return new Response(JSON.stringify({ email: 'gui@example.com', entitlements: [] }), { status: 200 });
  };
  try {
    const start = await startDeviceConnection({
      fetchImpl,
      baseUrl: BASE_URL,
      openBrowser: url => opened.push(url)
    });
    assert.equal(start.status, 'started');
    assert.deepEqual(opened, ['http://localhost:9999/store/connect?code=GUI1-2345']);

    const claim = await pollDeviceConnection({
      fetchImpl,
      env: home.env,
      baseUrl: start.baseUrl,
      deviceCode: start.deviceCode
    });
    assert.equal(claim.status, 'approved');
    const credentialsPath = resolveCredentialsPath(home.env);
    assert.equal(statSync(credentialsPath).mode & 0o777, 0o600);
    const saved = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    assert.equal(saved.email, 'gui@example.com');
    assert.equal(saved.token, TOKEN);
  } finally {
    home.cleanup();
  }
});

test('device connection: caller cancellation stops before polling without creating credentials', async () => {
  const home = makeHome();
  try {
    const start = await startDeviceConnection({
      fetchImpl: async () => new Response(JSON.stringify({
        device_code: 'gui-device-cancel',
        user_code: 'STOP-1234',
        verification_url: 'http://localhost:9999/store/connect',
        interval: 1,
        expires_in: 60
      }), { status: 200 }),
      baseUrl: BASE_URL
    });
    assert.equal(start.status, 'started');
    assert.equal(existsSync(resolveCredentialsPath(home.env)), false);
  } finally {
    home.cleanup();
  }
});

test('device connection: expired claim returns expired without saving', async () => {
  const home = makeHome();
  try {
    const outcome = await pollDeviceConnection({
      fetchImpl: async () => new Response(JSON.stringify({ status: 'expired' }), { status: 410 }),
      env: home.env,
      baseUrl: BASE_URL,
      deviceCode: 'expired-device'
    });
    assert.deepEqual(outcome, { status: 'expired' });
    assert.equal(existsSync(resolveCredentialsPath(home.env)), false);
  } finally {
    home.cleanup();
  }
});

test('device connection: network failure returns network-error without saving', async () => {
  const home = makeHome();
  try {
    const outcome = await pollDeviceConnection({
      fetchImpl: async () => { throw new Error('offline'); },
      env: home.env,
      baseUrl: BASE_URL,
      deviceCode: 'offline-device'
    });
    assert.equal(outcome.status, 'network-error');
    assert.match(outcome.error, /offline/);
    assert.equal(existsSync(resolveCredentialsPath(home.env)), false);
  } finally {
    home.cleanup();
  }
});
