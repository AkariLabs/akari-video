import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBundledCatalog, resolveBundledCatalogFrom, audioSetupDefaults, readBundledCatalog, externalReferences,
  mergeBundledReferences, findBundledEntry } from '../src/bundled-catalog.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'bundled-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function entry(root, category, id, meta = {}) {
  const dir = path.join(root, category, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, category, title: id, tier: 'free',
    source: { url: 'https://example.test/item' }, tags: [], ...meta }));
}

test('override is authoritative; otherwise the module-relative catalog is found', t => {
  const root = fixture(t);
  assert.deepEqual(resolveBundledCatalog({ AKARI_CATALOG_ROOT: root }), { root, origin: 'env', candidates: [root] });
  const missing = path.join(root, 'missing');
  assert.deepEqual(resolveBundledCatalog({ AKARI_CATALOG_ROOT: missing }), { root: null, origin: 'env', candidates: [missing] });
  const bundled = resolveBundledCatalog({ AKARI_HOME: path.join(root, 'home') });
  assert.equal(bundled.origin, 'bundled');
  assert.ok(bundled.root?.endsWith('catalog'));
  const home = path.join(root, 'home');
  const app = path.join(home, 'app', 'catalog');
  mkdirSync(app, { recursive: true });
  assert.deepEqual(resolveBundledCatalogFrom({ AKARI_HOME: home }, missing),
    { root: app, origin: 'app', candidates: [missing, app] });
});

test('audio defaults keep checkout references beside catalog and installed references under AKARI_HOME', t => {
  const base = fixture(t);
  const root = path.join(base, 'catalog');
  const home = path.join(base, 'home');
  mkdirSync(root);
  const env = { AKARI_CATALOG_ROOT: root, AKARI_HOME: home };
  const installed = audioSetupDefaults(env);
  assert.deepEqual(installed, { root, origin: 'env', candidates: [root],
    candidatesPath: path.join(root, 'audio', 'candidates.json'),
    catalogDir: path.join(home, 'catalog', 'audio'),
    candidatesHtmlPath: path.join(home, 'audio-candidates', 'candidates.html') });
  writeFileSync(path.join(base, '.git'), 'worktree');
  assert.equal(audioSetupDefaults(env).catalogDir, path.join(root, 'audio'));
  rmSync(path.join(base, '.git'));
  mkdirSync(path.join(base, '.git'));
  assert.equal(audioSetupDefaults(env).catalogDir, path.join(root, 'audio'));
  const missing = path.join(base, 'missing');
  assert.deepEqual(audioSetupDefaults({ ...env, AKARI_CATALOG_ROOT: missing }),
    { root: null, origin: 'env', candidates: [missing], candidatesPath: null, catalogDir: null, candidatesHtmlPath: null });
});

test('reader marks packaged asset directories only when they contain a file', t => {
  const base = fixture(t);
  const root = path.join(base, 'catalog');
  mkdirSync(root);
  entry(root, 'font', 'included');
  entry(root, 'font', 'empty');
  entry(root, 'font', 'missing');
  const included = path.join(base, 'assets', 'font', 'included');
  mkdirSync(included, { recursive: true });
  writeFileSync(path.join(included, 'font.ttf'), 'font');
  mkdirSync(path.join(base, 'assets', 'font', 'empty'), { recursive: true });
  const { entries } = readBundledCatalog(root);
  assert.equal(findBundledEntry(entries, 'font/included').bundledAssetDir, included);
  assert.equal(findBundledEntry(entries, 'font/included').state, 'reference');
  assert.equal(findBundledEntry(entries, 'font/empty').bundledAssetDir, null);
  assert.equal(findBundledEntry(entries, 'font/missing').bundledAssetDir, null);
});

test('reader orders entries, skips invalid metadata and non-asset folders', t => {
  const root = fixture(t);
  entry(root, 'font', 'zeta');
  entry(root, 'audio', 'alpha', { source: { url: 'https://github.com/AkariLabs/example' } });
  entry(root, 'font', 'beta', { id: 'wrong' });
  entry(root, 'font', 'gamma', { category: 'audio' });
  entry(root, 'sites', 'not-an-asset');
  entry(root, 'avatars', 'not-an-asset');
  const broken = path.join(root, 'font', 'broken');
  mkdirSync(broken);
  writeFileSync(path.join(broken, 'meta.json'), '{');
  const { entries, warnings } = readBundledCatalog(root);
  assert.deepEqual(entries.map(item => `${item.category}/${item.id}`), ['audio/alpha', 'font/zeta']);
  assert.equal(warnings.length, 3);
  assert.deepEqual(externalReferences(entries).map(item => item.id), ['zeta']);
  assert.ok(entries[1].machineTags.includes('tier:free'));
  assert.equal(findBundledEntry(entries, 'font/zeta'), entries[1]);
  assert.equal(findBundledEntry(entries, 'zeta'), entries[1]);
});

test('merge preserves existing rows verbatim and does not duplicate keys', () => {
  const existing = { category: 'font', id: 'one', state: 'cached' };
  const references = [{ category: 'font', id: 'one', state: 'reference' }, { category: 'font', id: 'two', state: 'reference' }];
  const merged = mergeBundledReferences([existing], references);
  assert.equal(merged[0], existing);
  assert.deepEqual(merged.map(item => item.id), ['one', 'two']);
  assert.throws(() => findBundledEntry([{ category: 'font', id: 'same' }, { category: 'audio', id: 'same' }], 'same'), /候補/);
});
