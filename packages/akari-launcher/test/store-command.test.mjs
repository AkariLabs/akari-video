import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

test('store download: unknown_product（404）は商品 id 付きの案内で exit 1', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      if (url.endsWith('/products')) return new Response(JSON.stringify({ products: [] }), { status: 200 });
      return new Response(JSON.stringify({
        error: 'unknown_product',
        message: '商品が見つかりません'
      }), { status: 404 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'missing-product'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('商品が見つかりません') && l.includes('missing-product')));
  } finally {
    ctx.cleanup();
  }
});

test('store download: artifact_missing（404）は未入稿の案内で exit 1', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      if (url.endsWith('/products')) return new Response(JSON.stringify({ products: [] }), { status: 200 });
      return new Response(JSON.stringify({
        error: 'artifact_missing',
        message: '配布物が未入稿です。サポートへご連絡ください'
      }), { status: 404 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'telop-rich-pack-01'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('配布物が未入稿です。サポートへご連絡ください')));
  } finally {
    ctx.cleanup();
  }
});

test('store download: bundle は構成商品の個別 download を案内する', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response(JSON.stringify({
        error: 'artifact_missing',
        message: '配布物が未入稿です。サポートへご連絡ください'
      }), { status: 404 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'multi-device-combo'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) =>
      l.includes('セット商品は構成商品を個別に download してください')
      && l.includes('phone-pro-titanium')
      && l.includes('laptop-slim-aluminum')
      && l.includes('app-icon-squircle')));
  } finally {
    ctx.cleanup();
  }
});

test('store download: 未購入の bundle（403）は従来の購入確認エラーを出す', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response(JSON.stringify({ error: 'not_entitled' }), { status: 403 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'multi-device-combo'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('この商品の購入が確認できません: multi-device-combo')));
    assert.ok(ctx.lines.every((l) => !l.includes('セット商品は構成商品を個別に download してください')));
  } finally {
    ctx.cleanup();
  }
});

test('store download: products 応答で判明した bundle を固定文言で案内する', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      if (url.endsWith('/products')) {
        return new Response(JSON.stringify({
          products: [{
            id: 'creator-bundle',
            price_jpy: 2400,
            kind: 'bundle',
            current_version: 1
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: 'artifact_missing',
        message: '配布物が未入稿です。サポートへご連絡ください'
      }), { status: 404 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'creator-bundle'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l === 'セット商品は構成商品を個別に download してください'));
  } finally {
    ctx.cleanup();
  }
});

test('store download: 非 JSON 応答は従来の HTTP エラーへフォールバックする', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response('not json', { status: 500 });
    }
  });
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const result = await runStoreCommand(['download', 'broken-product'], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((l) => l.includes('ダウンロードに失敗しました（500）')));
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

test('store install: 宣言パックは declarations.json を所定の場所へ導入（既存は退避）', async () => {
  const ctx = makeContext({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify(ENTITLEMENTS), { status: 200 });
      return new Response(Buffer.from('PKdummyzip'), {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="sounds-declaration-pack-v1.zip"' }
      });
    }
  });
  // unzip 依存を切って展開結果を注入（zip 実体の検証は統合テスト側でやる）
  ctx.options.extract = (zipPath, dir) => {
    const inner = path.join(dir, 'sounds-declaration-pack-v1');
    mkdirSync(inner, { recursive: true });
    writeFileSync(path.join(inner, 'declarations.json'), '{"new":true}');
    return true;
  };
  try {
    await runStoreCommand(['connect', '--token', TOKEN, '--url', 'http://localhost:9999/api/store'], ctx.options);
    const dest = path.join(ctx.home, 'assets', 'audio', 'declarations.json');
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, '{"old":true}');

    const result = await runStoreCommand(['install', 'sounds-declaration-pack'], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(readFileSync(dest, 'utf8'), '{"new":true}', 'new declarations installed');
    const backups = readFileSync(dest, 'utf8') && existsSync(path.dirname(dest))
      ? (await import('node:fs')).readdirSync(path.dirname(dest)).filter((f) => f.startsWith('declarations.json.bak-'))
      : [];
    assert.equal(backups.length, 1, 'old file backed up');
  } finally {
    ctx.cleanup();
  }
});

function localZip(ctx, name = 'pack.zip') {
  const zipPath = path.join(ctx.home, name);
  writeFileSync(zipPath, 'fixture zip');
  return zipPath;
}

test('store install --from: SKU 入れ子形 PACK.json を平坦化して installed.json へ登録する', async () => {
  const ctx = makeContext({ fetchImpl: async () => { throw new Error('network must not be used'); } });
  const zipPath = localZip(ctx);
  ctx.options.extract = (_input, dir) => {
    const packRoot = path.join(dir, 'text-pack-v1');
    const first = path.join(packRoot, 'assets', 'scene3d', 'text-one');
    const second = path.join(packRoot, 'assets', 'scene3d', 'text-two');
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    writeFileSync(path.join(first, 'meta.json'), JSON.stringify({ title: 'メタ由来タイトル' }));
    writeFileSync(path.join(first, 'fragment.html'), 'one');
    writeFileSync(path.join(second, 'fragment.html'), 'two');
    writeFileSync(path.join(packRoot, 'PACK.json'), JSON.stringify({
      pack: 'text-pack',
      version: 1,
      contents: [{
        sku: 'set',
        title: '親タイトル',
        assets: [
          { id: 'text-one', path: 'assets/scene3d/text-one', version: 1, files: [{ path: 'fragment.html', bytes: 3, sha256: 'a'.repeat(64) }] },
          { id: 'text-two', path: 'assets/scene3d/text-two', version: 1, files: [{ path: 'fragment.html', bytes: 3, sha256: 'b'.repeat(64) }] }
        ]
      }]
    }));
    return true;
  };

  try {
    const result = await runStoreCommand(['install', 'text-pack', '--from', zipPath], ctx.options);
    assert.equal(result.exitCode, 0);
    const index = JSON.parse(readFileSync(path.join(ctx.home, 'assets', 'installed.json'), 'utf8'));
    assert.equal(index.schema, 'akari-installed-assets/v0');
    assert.equal(Object.keys(index.packs).length, 1);
    assert.equal(index.packs['text-pack'].items.length, 2);
    assert.equal(index.packs['text-pack'].items[0].title, 'メタ由来タイトル');
    assert.equal(index.packs['text-pack'].items[1].title, '親タイトル');
    assert.ok(path.isAbsolute(index.packs['text-pack'].root));
    assert.ok(ctx.lines.includes('akari assets list に 2 件を登録しました'));
    assert.ok(ctx.lines.includes('次の一手: akari assets fetch text-one'));
  } finally {
    ctx.cleanup();
  }
});

test('store install --from: 再 install は同 productId を置換し、別 productId は保持する', async () => {
  const ctx = makeContext();
  const zipPath = localZip(ctx);
  ctx.options.extract = (_input, dir) => {
    const packRoot = path.join(dir, 'flat-pack');
    const assetRoot = path.join(packRoot, 'assets', 'still', 'flat-one');
    mkdirSync(assetRoot, { recursive: true });
    writeFileSync(path.join(assetRoot, 'payload.txt'), 'payload');
    writeFileSync(path.join(packRoot, 'PACK.json'), JSON.stringify({
      product: 'flat-pack',
      version: 2,
      contents: [{
        id: 'flat-one', title: 'Flat One', path: 'assets/still/flat-one', version: 2,
        files: [{ path: 'payload.txt', bytes: 7, sha256: 'c'.repeat(64) }]
      }]
    }));
    return true;
  };

  try {
    const indexPath = path.join(ctx.home, 'assets', 'installed.json');
    mkdirSync(path.dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, JSON.stringify({
      schema: 'akari-installed-assets/v0',
      packs: { existing: { version: 1, installedAt: '2026-01-01T00:00:00.000Z', root: '/fixture', items: [] } }
    }));
    await runStoreCommand(['install', 'flat-pack', '--from', zipPath], ctx.options);
    await runStoreCommand(['install', 'flat-pack', '--from', zipPath], ctx.options);
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    assert.deepEqual(Object.keys(index.packs).sort(), ['existing', 'flat-pack']);
    assert.equal(index.packs['flat-pack'].items.length, 1);
    assert.equal(index.packs['flat-pack'].items[0].version, 2);
  } finally {
    ctx.cleanup();
  }
});

test('store install --from: PACK.json が無ければ従来どおり展開だけ行い索引を作らない', async () => {
  const ctx = makeContext();
  const zipPath = localZip(ctx);
  ctx.options.extract = (_input, dir) => {
    const packRoot = path.join(dir, 'legacy-pack');
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(path.join(packRoot, 'README.md'), 'legacy instructions');
    return true;
  };

  try {
    const result = await runStoreCommand(['install', 'legacy-pack', '--from', zipPath], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(path.join(ctx.home, 'assets', 'installed.json')), false);
    assert.ok(ctx.lines.some((line) => line.startsWith('導入手順:')));
  } finally {
    ctx.cleanup();
  }
});

test('store install --from: PACK.json のパック外 path は索引へ登録しない', async () => {
  const ctx = makeContext();
  const zipPath = localZip(ctx);
  ctx.options.extract = (_input, dir) => {
    const packRoot = path.join(dir, 'broken-pack');
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(path.join(packRoot, 'PACK.json'), JSON.stringify({
      product: 'broken-pack',
      version: 1,
      contents: [{
        id: 'outside-one', title: 'Outside One', path: '../outside-one', version: 1,
        files: [{ path: 'payload.txt', bytes: 7, sha256: 'd'.repeat(64) }]
      }]
    }));
    return true;
  };

  try {
    await assert.rejects(
      () => runStoreCommand(['install', 'broken-pack', '--from', zipPath], ctx.options),
      /path がパック外を指しています/,
    );
    assert.equal(existsSync(path.join(ctx.home, 'assets', 'installed.json')), false);
  } finally {
    ctx.cleanup();
  }
});

test('store help: install に --from と installed 索引の説明を出す', async () => {
  const ctx = makeContext();
  try {
    const result = await runStoreCommand([], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.ok(ctx.lines.some((line) => line.includes('install <productId> [--from <zip>]') && line.includes('installed 索引')));
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
