import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadCatalog } from '../src/catalog.mjs';
import { composeState } from '../src/state.mjs';

const catalog = { schema: 'akari-assets-catalog/v0', version: '1', base: 'https://example.test/assets',
  items: [{ id: 'paid', category: 'music', price: 100, files: [] }] };

test('automatic catalog and purchase checks obey persisted autoCheck; user browse remains online', async () => {
  const home = await mkdtemp(join(tmpdir(), 'akari-auto-network-'));
  const env = { AKARI_HOME: home, AKARI_ASSETS_CATALOG: 'https://example.test/catalog.json',
    AKARI_STORE_API: 'https://example.test' };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => String(url).includes('catalog') ? catalog : { entitlements: [] } };
  };
  try {
    await writeFile(join(home, 'catalog-cache.json'), JSON.stringify(catalog));
    await writeFile(join(home, 'store-credentials.json'), JSON.stringify({ token: 'token' }));
    await writeFile(join(home, 'update-preferences.json'), JSON.stringify({ autoCheck: false }));
    const offline = await composeState({ env, fetchImpl, intent: 'automatic' });
    assert.equal(calls.length, 0);
    assert.equal(offline.items.length, 1);
    await loadCatalog({ env, fetchImpl, intent: 'automatic' });
    assert.equal(calls.length, 0);
    await composeState({ env, fetchImpl, intent: 'user' });
    assert.ok(calls.some(url => String(url).includes('catalog.json')));
    assert.ok(calls.some(url => String(url).includes('entitlements')));
    calls.length = 0;
    await writeFile(join(home, 'update-preferences.json'), JSON.stringify({ autoCheck: true }));
    await composeState({ env, fetchImpl, intent: 'automatic' });
    assert.ok(calls.some(url => String(url).includes('catalog.json')));
    assert.ok(calls.some(url => String(url).includes('entitlements')));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('automatic catalog with no cache still returns an empty view without fetching', async () => {
  const home = await mkdtemp(join(tmpdir(), 'akari-auto-empty-'));
  const env = { AKARI_HOME: home, AKARI_ASSETS_CATALOG: 'https://example.test/catalog.json' };
  let calls = 0;
  try {
    await writeFile(join(home, 'update-preferences.json'), JSON.stringify({ autoCheck: false }));
    const view = await composeState({ env, intent: 'automatic', fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
    assert.equal(calls, 0);
    assert.deepEqual(view.items, []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
