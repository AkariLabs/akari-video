import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runStoreCommand, resolveCredentialsPath } from '../src/store-command.mjs';

const TOKEN = 'akst_test-token_0123456789';
const ENTITLEMENTS = {
  email: 'buyer@example.com',
  entitlements: [
    { product_id: 'sounds-declaration-pack', current_version: 1, download: '/api/store/v1/download/sounds-declaration-pack' }
  ]
};

function makeContext({ fetchImpl } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'akari-store-test-'));
  const env = { AKARI_HOME: home };
  const lines = [];
  const options = {
    env,
    log: (line) => lines.push(line),
    fetch: fetchImpl ?? (async () => new Response(JSON.stringify(ENTITLEMENTS), { status: 200 }))
  };
  return { home, env, lines, options, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('store connect: トークン検証 → 資格情報を 0600 で保存し購入一覧を出す', async () => {
  const ctx = makeContext();
  try {
    const result = await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    assert.equal(result.exitCode, 0);
    const file = resolveCredentialsPath(ctx.env);
    assert.ok(existsSync(file), 'credentials file exists');
    assert.equal(statSync(file).mode & 0o777, 0o600, 'file mode 0600');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.token, TOKEN);
    assert.equal(saved.url, 'http://localhost:9999/api/store');
    assert.equal(saved.email, 'buyer@example.com');
    assert.ok(ctx.lines.some((l) => l.includes('sounds-declaration-pack')), 'entitlement listed');
  } finally {
    ctx.cleanup();
  }
});

test('store connect: 無効トークン（401）は保存しない', async () => {
  const ctx = makeContext({ fetchImpl: async () => new Response('{}', { status: 401 }) });
  try {
    const result = await runStoreCommand(['connect', '--token', TOKEN], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(!existsSync(resolveCredentialsPath(ctx.env)), 'no credentials saved');
    assert.ok(ctx.lines.some((l) => l.includes('無効')), 'error message shown');
  } finally {
    ctx.cleanup();
  }
});

test('store connect: 形式不正トークンは API を呼ばず拒否', async () => {
  let called = false;
  const ctx = makeContext({ fetchImpl: async () => { called = true; return new Response('{}'); } });
  try {
    const result = await runStoreCommand(['connect', '--token', 'not-a-token'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.equal(called, false, 'fetch not called');
  } finally {
    ctx.cleanup();
  }
});

test('store status: 未接続は案内して exit 1', async () => {
  const ctx = makeContext();
  try {
    const result = await runStoreCommand(['status'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('akari store connect')));
  } finally {
    ctx.cleanup();
  }
});

test('store download: 購入済みは zip を保存・content-disposition のファイル名を使う', async () => {
  const zipBytes = Buffer.from('PKdummy');
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response(zipBytes, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="sounds-declaration-pack-v1.zip"' }
      });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const dest = path.join(ctx.home, 'dl');
    const result = await runStoreCommand(['download', 'sounds-declaration-pack', '--dest', dest], ctx.options);
    assert.equal(result.exitCode, 0);
    const saved = path.join(dest, 'sounds-declaration-pack-v1.zip');
    assert.ok(existsSync(saved), 'zip saved');
    assert.deepEqual(readFileSync(saved), zipBytes, 'zip bytes intact');
  } finally {
    ctx.cleanup();
  }
});

test('store download: 未購入（403）は exit 1', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response('{}', { status: 403 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'phone-pro-titanium'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('購入が確認できません')));
  } finally {
    ctx.cleanup();
  }
});

test('store connect（既定 = デバイスフロー）: start → ブラウザ → 承認待ち → 保存', async () => {
  let claimCount = 0;
  const opened = [];
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/device/start')) {
        return new Response(JSON.stringify({
          device_code: 'dev-code-1', user_code: 'ABCD-2345',
          verification_url: 'http://localhost:9999/store/connect?code=ABCD-2345',
          interval: 0, expires_in: 60
        }), { status: 200 });
      }
      if (url.endsWith('/device/claim')) {
        claimCount++;
        return claimCount < 3
          ? new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
          : new Response(JSON.stringify({ status: 'approved', token: TOKEN }), { status: 200 });
      }
      return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
    }
  });
  ctx.options.openBrowser = (url) => { opened.push(url); return true; };
  ctx.options.sleep = async () => {};
  try {
    const result = await runStoreCommand(['connect', '--url', 'http://localhost:9999/api/store'], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(opened.length, 1, 'browser opened once');
    assert.ok(opened[0].includes('/store/connect?code='), 'verification url opened');
    assert.ok(ctx.lines.some((l) => l.includes('ABCD-2345')), 'user code shown');
    const saved = JSON.parse(readFileSync(resolveCredentialsPath(ctx.env), 'utf8'));
    assert.equal(saved.token, TOKEN, 'token persisted');
    assert.ok(claimCount >= 3, 'polled until approved');
  } finally {
    ctx.cleanup();
  }
});

test('store connect（デバイスフロー）: 期限切れ（410）は exit 1・保存しない', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/device/start')) {
        return new Response(JSON.stringify({
          device_code: 'dev-code-2', user_code: 'EFGH-6789',
          verification_url: 'http://localhost:9999/store/connect', interval: 0, expires_in: 60
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'expired' }), { status: 410 });
    }
  });
  ctx.options.openBrowser = () => true;
  ctx.options.sleep = async () => {};
  try {
    const result = await runStoreCommand(['connect', '--no-open', '--url', 'http://localhost:9999/api/store'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(!existsSync(resolveCredentialsPath(ctx.env)), 'no credentials saved');
  } finally {
    ctx.cleanup();
  }
});

test('store disconnect: 資格情報を削除する', async () => {
  const ctx = makeContext();
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    assert.ok(existsSync(resolveCredentialsPath(ctx.env)));
    const result = await runStoreCommand(['disconnect'], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.ok(!existsSync(resolveCredentialsPath(ctx.env)));
  } finally {
    ctx.cleanup();
  }
});

test('store: 未知のサブコマンドは使い方を出して exit 1', async () => {
  const ctx = makeContext();
  try {
    const result = await runStoreCommand(['frobnicate'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('使い方')));
  } finally {
    ctx.cleanup();
  }
});
