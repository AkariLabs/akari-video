import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { bundleProjectReferences } from '../src/bundle.mjs';
import { resolveProAssetUrl } from '../src/env.mjs';
import { recordProjectReference } from '../src/project-references.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function paidMetaBuffer(id, category) {
  return Buffer.from(`${JSON.stringify({
    id, category, title: `フィクスチャ有料素材 ${id}`,
    description: 'asset-resolver 有料経路のテスト用フィクスチャ', when_to_use: 'テストのみ',
    tags: ['fixture', 'paid'], knobs: [], ai_usage: 'テスト用途のみ', requires: [],
    provenance: { origin: 'asset-resolver test fixture', generator: null }, author: 'test',
    license: { spdx: 'LicenseRef-fixture', scope: 'paid-license-required', attribution_required: false, ai_training_allowed: false },
    tier: 'pro', price: null, version: 1,
  }, null, 2)}\n`);
}

function payload(id, category = 'overlay') {
  return {
    'meta.json': paidMetaBuffer(id, category),
    'fragment.html': Buffer.from(`<div class="${id}-stub"><span data-mirror="text">fixture</span></div>\n`),
    'preview.png': PNG,
  };
}

function descriptor(origin, id, category, files, version = 1) {
  return {
    schema: 'akari-pro-asset/v1', category, id, version,
    files: Object.entries(files).map(([name, bytes]) => ({
      name, sha256: hash(bytes), bytes: bytes.length,
      url: `${origin}/api/store/v1/assets/${category}/${id}/v${version}/${name}`,
    })),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function assertClean(home, category, id) {
  assert.equal(existsSync(path.join(home, 'assets', category, id)), false);
  assert.deepEqual(existsSync(path.join(home, 'assets'))
    ? readdirSync(path.join(home, 'assets')).filter(name => name.startsWith('.tmp-resolve-')) : [], []);
}

async function fixture(t, handle, { id = 'pro-item', category = 'overlay', productId } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    handle(req, res, { origin: `http://127.0.0.1:${server.address().port}`, requests, id, category });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { env, home, catalog, catalogPath, root } = setupFixtureEnv({
    AKARI_STORE_API: origin, AKARI_PRO_ASSET_API: origin,
  });
  catalog.items.push({
    id, category, title: `フィクスチャ有料素材 ${id}`, tags: ['fixture', 'paid'],
    license: { spdx: 'LicenseRef-fixture' }, tier: 'pro', price: null,
    ...(productId ? { product_id: productId } : {}), version: 1, preview: '', provenance: {},
  });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(path.join(home, 'store-credentials.json'), `${JSON.stringify({ url: `${origin}/api/store`, token: 'akst_test' })}\n`);
  return { env, home, root, origin, requests, id, category, productId };
}

function route(req, res, ctx, { id = ctx.id, category = ctx.category, files = payload(id, category),
  entitled = true, descriptorResponse, fileResponse, zip } = {}) {
  if (req.url === '/api/store/v1/entitlements') {
    return json(res, 200, { pass: entitled ? { tier: 1, seat_no: 1 } : null, entitlements: [] });
  }
  const descriptorPath = `/api/store/v1/assets/${category}/${id}`;
  if (req.url === descriptorPath) {
    if (descriptorResponse?.(req, res, ctx) === true) return;
    return json(res, 200, descriptor(ctx.origin, id, category, files));
  }
  if (req.url.startsWith(`${descriptorPath}/v`)) {
    if (fileResponse?.(req, res, ctx) === true) return;
    const name = req.url.split('/').at(-1);
    if (Object.hasOwn(files, name)) return res.end(files[name]);
    return json(res, 404, { error: 'file_not_found', message: 'ファイルはありません' });
  }
  if (req.url.startsWith('/api/store/v1/download/') && zip) {
    res.writeHead(200, { 'content-type': 'application/zip' });
    return res.end(zip);
  }
  return json(res, 404, { error: 'unexpected', message: req.url });
}

// ZIP の stored entry を純 JS で作る。展開は製品側の extractZip をそのまま使う。
function storedZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.from(content);
    const crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(bytes.length, 18);
    head.writeUInt32LE(bytes.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, bytes);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(bytes.length, 20);
    dir.writeUInt32LE(bytes.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += head.length + nameBytes.length + bytes.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

test('記述子 URL は専用上書きを最優先し category/id をエンコードする', () => {
  const credentials = { url: 'https://connected.example/api/store/' };
  const suffix = '/api/store/v1/assets/overlay%20item/asset%2Fid';
  assert.equal(resolveProAssetUrl({ AKARI_PRO_ASSET_API: 'https://pro.example/' , AKARI_STORE_API: 'https://store.example' },
    credentials, 'overlay item', 'asset/id'), `https://pro.example${suffix}`);
  assert.equal(resolveProAssetUrl({ AKARI_STORE_API: 'https://store.example/' }, credentials, 'overlay item', 'asset/id'),
    `https://store.example${suffix}`);
  assert.equal(resolveProAssetUrl({}, credentials, 'overlay item', 'asset/id'),
    'https://connected.example/api/store/v1/assets/overlay%20item/asset%2Fid');
});

test('Pro 記述子の 3 ファイルを Bearer で取得し、検証後に配置する', async t => {
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx));
  const result = await resolveAsset(`${item.category}/${item.id}`, { env: item.env });
  assert.equal(result.cached, false);
  assert.equal(result.dir, path.join(item.home, 'assets', item.category, item.id));
  assert.deepEqual(readdirSync(result.dir).sort(), ['fragment.html', 'meta.json', 'preview.png']);
  assert.deepEqual(readdirSync(path.join(item.home, 'assets')).filter(name => name.startsWith('.tmp-resolve-')), []);
  assert.equal(item.requests.filter(r => r.url.includes('/v1/assets/')).length, 4);
  assert.ok(item.requests.every(r => r.authorization === 'Bearer akst_test'));
});

test('403 pro_required は locked でファイルを要求しない', async t => {
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
    descriptorResponse: (_req, response) => { json(response, 403, { error: 'pro_required', message: 'Lifetime パスが必要です' }); return true; },
  }));
  await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error =>
    error.code === 'locked' && /all-access-pass/.test(error.message));
  assert.equal(item.requests.filter(r => /\/assets\/[^/]+\/[^/]+\/v\d+\//.test(r.url)).length, 0);
  assertClean(item.home, item.category, item.id);
});

test('404 asset_not_found だけは product_id の束 zip に落ちる', async t => {
  const id = 'pro-item';
  const productId = 'legacy-product';
  const files = payload(id);
  const rootName = `${productId}-v1`;
  const paths = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`${rootName}/assets/overlay/${id}/${name}`, bytes]));
  paths[`${rootName}/checksums.txt`] = Buffer.from(Object.entries(paths)
    .map(([name, bytes]) => `${hash(bytes)}  ${name.slice(rootName.length + 1)}`).join('\n') + '\n');
  const zip = storedZip(paths);
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
    zip, descriptorResponse: (_req, response) => { json(response, 404, { error: 'asset_not_found', message: '記述子はありません' }); return true; },
  }), { productId });
  const result = await resolveAsset(item.id, { env: item.env });
  assert.ok(existsSync(path.join(result.dir, 'meta.json')));
  assert.ok(item.requests.some(r => r.url === `/api/store/v1/download/${productId}`));
  assert.deepEqual(readdirSync(path.join(item.home, 'assets')).filter(name => name.startsWith('.tmp-resolve-')), []);
});

test('ファイル 409 は記述子を一度取り直し、二度目の 409 は停止する', async t => {
  for (const persistent of [false, true]) {
    let conflicts = 0;
    const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
      fileResponse: (_req, response) => {
        if (_req.url.endsWith('/meta.json') && conflicts++ < (persistent ? 2 : 1)) {
          json(response, 409, { error: 'stale_version', message: '版が変わりました' });
          return true;
        }
        return false;
      },
    }), { id: persistent ? 'pro-persistent' : 'pro-retry' });
    if (persistent) {
      await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error =>
        error.status === 409 && /stale_version.*版が変わりました/.test(error.message));
      assertClean(item.home, item.category, item.id);
    } else {
      const result = await resolveAsset(item.id, { env: item.env });
      assert.ok(existsSync(path.join(result.dir, 'meta.json')));
    }
    assert.equal(item.requests.filter(r => r.url === `/api/store/v1/assets/${item.category}/${item.id}`).length, 2);
  }
});

test('記述子 409 も一度取り直す', async t => {
  let calls = 0;
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
    descriptorResponse: (_req, response) => {
      if (calls++ === 0) {
        json(response, 409, { error: 'stale_version', message: '版が変わりました' });
        return true;
      }
      return false;
    },
  }));
  const result = await resolveAsset(item.id, { env: item.env });
  assert.ok(existsSync(path.join(result.dir, 'meta.json')));
  assert.equal(item.requests.filter(r => r.url === `/api/store/v1/assets/${item.category}/${item.id}`).length, 2);
});

test('sha256 と bytes の不一致は配置しない', async t => {
  for (const field of ['sha256', 'bytes']) {
    const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
      descriptorResponse: (_req, response, context) => {
        const data = descriptor(context.origin, field, 'overlay', payload(field));
        data.files.find(file => file.name === 'preview.png')[field] = field === 'sha256' ? '0'.repeat(64) : 999;
        json(response, 200, data);
        return true;
      },
    }), { id: field });
    await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error => error.code === 'integrity');
    assertClean(item.home, item.category, item.id);
  }
});

test('不正な name と別オリジンの URL は要求前に拒否する', async t => {
  for (const [index, bad] of ['../escape', '/absolute', 'bad\\name', 'other-origin'].entries()) {
    const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
      descriptorResponse: (_req, response, context) => {
        const data = descriptor(context.origin, `bad-${index}`, 'overlay', payload(`bad-${index}`));
        const target = data.files.find(file => file.name === 'preview.png');
        if (bad === 'other-origin') target.url = 'https://example.invalid/file';
        else target.name = bad;
        json(response, 200, data);
        return true;
      },
    }), { id: `bad-${index}` });
    await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error => error.code === 'integrity');
    assert.equal(item.requests.filter(r => /\/assets\/[^/]+\/[^/]+\/v\d+\//.test(r.url)).length, 0);
    assertClean(item.home, item.category, item.id);
  }
});

test('取得済み Pro は資格情報とネットワークなしで cached を返す', async t => {
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx));
  const installed = await resolveAsset(item.id, { env: item.env });
  const catalogPath = item.env.AKARI_ASSETS_CATALOG;
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const otherId = 'pro-unfetched';
  const proRow = catalog.items.find(row => row.category === item.category && row.id === item.id);
  catalog.items.push({ ...proRow, id: otherId, title: '未取得の Pro 素材' });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const { unlinkSync } = await import('node:fs');
  unlinkSync(path.join(item.home, 'store-credentials.json'));
  let fetchCalls = 0;
  const offlineFetch = () => { fetchCalls++; throw new Error('offline'); };

  await assert.rejects(() => resolveAsset(`${item.category}/${otherId}`, { env: item.env, fetchImpl: offlineFetch }),
    error => error.code === 'locked');
  const cached = await resolveAsset(item.id, { env: item.env, fetchImpl: offlineFetch });
  assert.equal(cached.cached, true);
  assert.equal(cached.dir, installed.dir);
  assert.equal(cached.dir, path.join(item.home, 'assets', item.category, item.id));
  assert.equal(fetchCalls, 0);

  await assert.rejects(() => resolveAsset(item.id, { env: item.env, fetchImpl: offlineFetch, force: true }),
    error => error.code === 'locked');
  assert.ok(existsSync(path.join(installed.dir, 'meta.json')));
  assert.equal(fetchCalls, 0);
});

test('資格なしなら記述子を要求しない', async t => {
  const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, { entitled: false }));
  await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error => error.code === 'locked');
  assert.equal(item.requests.some(r => r.url.includes('/v1/assets/')), false);
});

test('404 file_not_found と 500 は zip へ落ちず店の誤りを示す', async t => {
  for (const status of [404, 500]) {
    const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
      descriptorResponse: (_req, response) => { json(response, status, { error: 'file_not_found', message: '店側で見つかりません' }); return true; },
    }), { id: `error-${status}` });
    await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error =>
      error.code === 'download_failed' && error.message.includes(`HTTP ${status}`)
      && error.message.includes('file_not_found') && error.message.includes('店側で見つかりません'));
    assert.equal(item.requests.some(r => r.url.includes('/v1/download/')), false);
  }
});

test('401 は接続やり直しを案内し、JSON でない 404 は zip に落ちない', async t => {
  for (const kind of ['revoked', 'plain-404']) {
    const item = await fixture(t, (req, res, ctx) => route(req, res, ctx, {
      descriptorResponse: (_req, response) => {
        if (kind === 'revoked') json(response, 401, { error: 'token_revoked', message: 'トークンが失効しました' });
        else { response.writeHead(404); response.end('not json'); }
        return true;
      },
    }), { id: kind });
    await assert.rejects(() => resolveAsset(item.id, { env: item.env }), error => kind === 'revoked'
      ? error.code === 'locked' && /HTTP 401.*token_revoked.*トークンが失効/.test(error.message)
        && error.message.includes('akari store connect')
      : error.code === 'download_failed' && error.message.includes('HTTP 404'));
    assert.equal(item.requests.some(r => r.url.includes('/v1/download/')), false);
  }
});

test('bundle は category/id を使い同じ id の別カテゴリを取り違えない', async () => {
  const { env, root, baseDir, catalog, catalogPath } = setupFixtureEnv();
  const id = 'same-id';
  for (const category of ['textstyle', 'overlay']) {
    const location = path.join(baseDir, category, id, 'v1', 'data.txt');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(location), { recursive: true });
    writeFileSync(location, category);
    catalog.items.push({ id, category, title: category, price: 0,
      files: [{ name: 'data.txt', key: `${category}/${id}/v1/data.txt` }] });
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const project = path.join(root, 'project');
  await recordProjectReference(project, { id, category: 'overlay' });
  const bundled = await bundleProjectReferences({ project, env });
  assert.deepEqual(bundled.failures, []);
  assert.equal(bundled.materialized.length, 1);
  assert.equal(readFileSync(path.join(project, 'assets', 'overlay', id, 'data.txt'), 'utf8'), 'overlay');
});
