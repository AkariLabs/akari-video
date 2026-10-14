import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setupFixtureEnv } from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = path.join(repo, 'packages/asset-resolver/bin/akari-assets.mjs');
const valid = path.join(repo, 'packages/schemas/test/fixtures/asset/valid-library/overlay/lower-third-clean');

function fixture(t) {
  const f = setupFixtureEnv();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const dir = path.join(f.env.AKARI_CATALOG_ROOT, 'font', 'sample-font');
  mkdirSync(dir, { recursive: true });
  const sites = path.join(f.env.AKARI_CATALOG_ROOT, 'sites');
  mkdirSync(sites);
  writeFileSync(path.join(sites, 'example.json'), JSON.stringify({ id: 'example', name: 'Example', tab: 'font',
    entry_url: 'https://example.test/', direct_fetch_allowed: false }));
  const meta = { id: 'sample-font', category: 'font', title: 'Sample Font', tier: 'free', tags: ['typography'],
    license: { spdx: 'OFL-1.1', attribution_required: false },
    source: { url: 'https://example.test/font', acquisition: 'direct', license_at_source: 'OFL', attribution_required: false } };
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  return { ...f, dir, meta };
}
function run(args, env) {
  return spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('list separates external references, filters them, and keeps JSON metadata', t => {
  const f = fixture(t);
  const text = run(['list', '--source', 'site'], f.env);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^使える素材 0 件（ライブラリ: /);
  assert.match(text.stdout, /外部サイトの参照 1 件/);
  assert.match(text.stdout, /取得先の索引です。「同梱済み」と付いた行は実体がアプリに入っています。それ以外はまだ手元にありません。/);
  assert.match(text.stdout, /↗  font\/sample-font\tsite\t\[font\]/);
  const rows = JSON.parse(run(['list', '--category', 'font', '--json'], f.env).stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'reference');
  assert.equal(rows[0].sourceKind, 'site');
  assert.deepEqual(rows[0].source, f.meta.source);
  assert.equal(rows[0].catalogDir, f.dir);
  assert.equal(rows[0].metaPath, path.join(f.dir, 'meta.json'));
  assert.equal(Object.hasOwn(rows[0], 'bundledAssetDir'), true);
  assert.equal(rows[0].bundledAssetDir, null);
  assert.match(run(['list', '--query', 'sample'], f.env).stdout, /font\/sample-font/);
  assert.doesNotMatch(run(['list', '--query', 'absent'], f.env).stdout, /font\/sample-font/);
  const libraryDir = path.join(f.root, 'library', 'font', 'sample-font');
  mkdirSync(libraryDir, { recursive: true });
  writeFileSync(path.join(libraryDir, 'meta.json'), JSON.stringify({ ...f.meta, remote: false }));
  f.env.AKARI_LIBRARY_ROOT = path.join(f.root, 'library');
  assert.doesNotMatch(run(['list', '--source', 'site'], f.env).stdout, /外部サイトの参照/);
  const shown = JSON.parse(run(['show', 'font/sample-font', '--json'], f.env).stdout);
  assert.equal(shown.state, 'cached');
  assert.equal(shown.libraryDir, libraryDir);
  assert.equal(shown.bundledAssetDir, null);
});

test('list and show identify assets packaged beside the catalog without changing reference state', t => {
  const f = fixture(t);
  const bundledAssetDir = path.join(f.root, 'assets', 'font', 'sample-font');
  mkdirSync(bundledAssetDir, { recursive: true });
  writeFileSync(path.join(bundledAssetDir, 'font.ttf'), 'font');
  const listed = run(['list', '--category', 'font'], f.env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /font\/sample-font[^\n]*\t同梱済み/);
  const rows = JSON.parse(run(['list', '--category', 'font', '--json'], f.env).stdout);
  assert.equal(Object.hasOwn(rows[0], 'bundledAssetDir'), true);
  assert.equal(rows[0].bundledAssetDir, bundledAssetDir);
  assert.equal(rows[0].state, 'reference');
  const shown = run(['show', 'font/sample-font'], f.env);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /外部サイトの参照（実体はアプリに同梱済み: /);
  const shownJson = JSON.parse(run(['show', '--json', 'font/sample-font'], f.env).stdout);
  assert.equal(shownJson.bundledAssetDir, bundledAssetDir);
  assert.equal(shownJson.state, 'reference');
});

test('list JSON keeps Lab fields unchanged and show gives Lab acquisition guidance', t => {
  const f = fixture(t);
  const rows = JSON.parse(run(['list', '--json'], f.env).stdout);
  const available = rows.find(item => item.category === 'still' && item.id === 'mini-still');
  assert.equal(available?.state, 'available');
  assert.equal(Object.hasOwn(available, 'bundledAssetDir'), false);
  const locked = rows.find(item => item.category === 'still' && item.id === 'mini-paid');
  assert.equal(locked?.state, 'locked');
  assert.equal(Object.hasOwn(locked, 'bundledAssetDir'), false);
  const reference = rows.find(item => item.category === 'font' && item.id === 'sample-font');
  assert.equal(reference?.state, 'reference');
  assert.equal(Object.hasOwn(reference, 'bundledAssetDir'), true);

  const shown = run(['show', 'still/mini-still'], f.env);
  assert.equal(shown.status, 0, shown.stderr);
  assert.doesNotMatch(shown.stdout, /外部サイトの参照/);
  assert.match(shown.stdout, /まだ手元にありません（akari assets fetch still\/mini-still で取得できます）/);
  const shownLocked = run(['show', 'still/mini-paid'], f.env);
  assert.equal(shownLocked.status, 0, shownLocked.stderr);
  assert.match(shownLocked.stdout, /未購入の Pro 素材です（akari assets fetch では取得できません）/);
});

test('show accepts flags before the reference and reports ambiguous bare IDs without a stack', t => {
  const f = fixture(t);
  const flagged = run(['show', '--json', 'font/sample-font'], f.env);
  assert.equal(flagged.status, 0, flagged.stderr);
  assert.equal(JSON.parse(flagged.stdout).ref, 'font/sample-font');
  const otherDir = path.join(f.env.AKARI_CATALOG_ROOT, 'audio', 'sample-font');
  mkdirSync(otherDir, { recursive: true });
  writeFileSync(path.join(otherDir, 'meta.json'), JSON.stringify({ ...f.meta, category: 'audio' }));
  const ambiguous = run(['show', 'sample-font'], f.env);
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /font\/sample-font/);
  assert.match(ambiguous.stderr, /audio\/sample-font/);
  assert.doesNotMatch(ambiguous.stderr, /^\s+at /m);
});

test('catalog and show expose locations and report missing catalog', t => {
  const f = fixture(t);
  const result = run(['catalog', '--json'], f.env);
  assert.equal(result.status, 0, result.stderr);
  const info = JSON.parse(result.stdout);
  assert.equal(info.root, f.env.AKARI_CATALOG_ROOT);
  assert.equal(info.origin, 'env');
  assert.equal(info.env, 'AKARI_CATALOG_ROOT');
  assert.deepEqual(info.counts, { total: 1, external: 1, byCategory: { font: 1 } });
  assert.ok(info.validatorPath);
  assert.deepEqual(info.sites.map(site => [site.id, site.name, site.tab, site.entryUrl, site.directFetchAllowed]),
    [['example', 'Example', 'font', 'https://example.test/', false]]);
  const shown = JSON.parse(run(['show', 'font/sample-font', '--json'], f.env).stdout);
  assert.equal(shown.ref, 'font/sample-font');
  assert.equal(shown.state, 'reference');
  assert.deepEqual(shown.meta, f.meta);
  assert.equal(shown.libraryDir, null);
  assert.equal(shown.bundledAssetDir, null);
  assert.equal(run(['show', 'font/unknown'], f.env).status, 1);
  f.env.AKARI_CATALOG_ROOT = path.join(f.root, 'missing');
  const missing = run(['catalog', '--json'], f.env);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).root, null);
  assert.match(missing.stderr, /同梱カタログが見つかりません/);
});

test('validate returns the validator status and fetch does not retrieve site references', t => {
  const f = fixture(t);
  assert.equal(run(['validate', valid], f.env).status, 0);
  assert.equal(run(['validate', f.dir], f.env).status, 1);
  const fetched = run(['fetch', 'font/sample-font'], f.env);
  assert.equal(fetched.status, 1);
  assert.match(fetched.stderr, /akari assets show font\/sample-font/);
  for (const args of [['show'], ['validate', 'one', 'two'], ['catalog', '--typo']]) {
    assert.equal(run(args, f.env).status, 2, args.join(' '));
  }
});
