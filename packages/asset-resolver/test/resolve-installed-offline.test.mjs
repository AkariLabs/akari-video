import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolve } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('控え無しのインストール済み id はオフラインで通信せず解決できる', async () => {
  const { env, home } = setupFixtureEnv({ AKARI_ASSETS_CATALOG: 'https://unit.invalid/catalog' });
  const id = 'installed-offline';
  const payload = 'local asset bytes';
  const root = path.join(home, 'assets', 'store', 'fixture-pack', 'fixture-pack-v1');
  const itemPath = 'custom/' + id;
  const itemRoot = path.join(root, itemPath);
  mkdirSync(itemRoot, { recursive: true });
  writeFileSync(path.join(itemRoot, 'payload.txt'), payload);
  const indexPath = path.join(home, 'assets', 'installed.json');
  writeFileSync(indexPath, JSON.stringify({
    schema: 'akari-installed-assets/v0',
    packs: { 'fixture-pack': {
      version: 1, installedAt: '2026-01-01T00:00:00.000Z', root,
      items: [{ id, title: 'Installed Offline', path: itemPath, version: 1,
        files: [{ path: 'payload.txt', bytes: Buffer.byteLength(payload),
          sha256: createHash('sha256').update(payload).digest('hex') }] }],
    } },
  }));
  assert.equal(existsSync(path.join(home, 'catalog-cache.json')), false);
  let requests = 0;
  const result = await resolve(id, { env, fetchImpl: async () => {
    requests++;
    throw new Error('offline');
  } });
  assert.equal(result.cached, false);
  assert.equal(requests, 0);
  assert.equal(readFileSync(path.join(result.dir, 'payload.txt'), 'utf8'), payload);
});
