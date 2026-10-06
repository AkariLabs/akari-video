import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function serveMeta({ id = 'mini-still', tier, catalogTier = 'free', omitCatalogTier = false } = {}) {
  const fixture = setupFixtureEnv();
  const item = fixture.catalog.items.find(entry => entry.id === id);
  const file = item.files.find(entry => entry.name === 'meta.json');
  const servedMeta = JSON.parse(readFileSync(path.join(fixture.baseDir, file.key), 'utf8'));
  delete servedMeta.tier;
  if (tier !== undefined) servedMeta.tier = tier;
  const bytes = Buffer.from(`${JSON.stringify(servedMeta, null, 2)}\n`);
  writeFileSync(path.join(fixture.baseDir, file.key), bytes);
  file.sha256 = sha256(bytes);
  file.bytes = bytes.length;
  if (omitCatalogTier) delete item.tier;
  else item.tier = catalogTier;
  writeFileSync(fixture.catalogPath, `${JSON.stringify(fixture.catalog, null, 2)}\n`);
  return { ...fixture, bytes };
}

test('resolve: sha256 検証済みの旧 free meta.json に catalog tier を補完する', async () => {
  const { env, home } = serveMeta({ catalogTier: 'free' });
  const result = await resolveAsset('mini-still', { env });

  assert.equal(result.cached, false);
  assert.equal(JSON.parse(readFileSync(path.join(result.dir, 'meta.json'), 'utf8')).tier, 'free');
  assert.deepEqual(readdirSync(home).filter(name => name.startsWith('.tmp-resolve-')), []);
});

test('resolve: catalog に tier がなく price: 0 の旧 meta.json は free として解決する', async () => {
  const { env } = serveMeta({ omitCatalogTier: true });
  const result = await resolveAsset('mini-still', { env });
  assert.equal(result.cached, false);
  assert.equal(JSON.parse(readFileSync(path.join(result.dir, 'meta.json'), 'utf8')).tier, 'free');
});

test('resolve: meta.json に tier がある場合は配信バイト列を保持する', async () => {
  const { env, bytes } = serveMeta({ tier: 'free', catalogTier: 'free' });
  const result = await resolveAsset('mini-still', { env });
  assert.equal(result.cached, false);
  assert.equal(readFileSync(path.join(result.dir, 'meta.json'), 'utf8'), bytes.toString('utf8'));
  assert.equal(existsSync(path.join(result.dir, 'meta.json')), true);
});
