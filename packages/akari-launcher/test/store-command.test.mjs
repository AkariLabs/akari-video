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
