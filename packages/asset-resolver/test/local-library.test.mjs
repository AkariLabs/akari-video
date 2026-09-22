import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { composeState } from '../src/state.mjs';
import { primaryMediaFile, sourceFields } from '../src/library.mjs';
import { LEGACY_AKARI_HOST } from '../src/service-urls.mjs';
import { setupFixtureEnv } from './helpers.mjs';

function fixture(t) {
  const f = setupFixtureEnv();
  f.env.AKARI_LIBRARY_ROOT = path.join(f.root, 'library');
  f.env.AKARI_CREATOR_ROOT = path.join(f.root, 'creator');
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  return f;
}
function asset(root, id, meta = {}, category = 'audio') {
  const dir = path.join(root, category, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, category, title: id, tags: [], license: { spdx: 'test' }, ...meta }));
  writeFileSync(path.join(dir, 'sound.wav'), 'sound');
  return dir;
}

test('local items contain actual files, metadata, timestamp, thumbnail, credit and origin fields', async t => {
  const { env } = fixture(t);
  const dir = asset(env.AKARI_LIBRARY_ROOT, 'outside', { title: 'Outside', tags: ['calm', 'origin:site', 'site:music', 'folder:Tracks', 'pack:set', 'license:subscription'] });
  writeFileSync(path.join(dir, 'preview.png'), 'preview');
  writeFileSync(path.join(dir, 'CREDIT.txt'), 'Composer\nignored');
  const { items } = await composeState({ env });
  const item = items.find(item => item.id === 'outside');
  assert.equal(items.length, 3);
  assert.equal(item.title, 'Outside');
  assert.equal(item.libraryDir, dir);
  assert.equal(item.mediaFile, 'sound.wav');
  assert.equal(item.preview, 'preview.png');
  assert.ok(Number.isFinite(Date.parse(item.addedAt)));
  assert.deepEqual(item.files.find(file => file.name === 'sound.wav'), { name: 'sound.wav', bytes: 5 });
  assert.deepEqual(item.tags, ['calm']);
  assert.deepEqual(item.machineTags, ['origin:site', 'site:music', 'folder:Tracks', 'pack:set', 'license:subscription']);
  assert.equal(item.folder, 'Tracks');
  assert.equal(item.site, 'music');
  assert.equal(item.subscription, true);
  assert.equal(item.creditText, 'Composer');
  assert.equal(item.state, 'cached');
});

for (const broken of ['{', 'null', '[]', '{"title":9}']) {
  test(`broken meta is retained with warning: ${broken}`, async t => {
    const { env } = fixture(t);
    const dir = asset(env.AKARI_LIBRARY_ROOT, 'broken');
    writeFileSync(path.join(dir, 'meta.json'), broken);
    const item = (await composeState({ env })).items.find(item => item.id === 'broken');
    assert.equal(item.title, 'broken');
    assert.equal(item.sourceKind, 'own');
    assert.equal(item.mediaFile, 'sound.wav');
    assert.match(item.warnings[0], /meta.json/);
  });
}

for (const mode of ['remote', 'missing-file']) {
  test(`offline list preserves all local assets (${mode})`, async t => {
    const { env, root } = fixture(t);
    env.AKARI_ASSETS_CATALOG = mode === 'remote' ? 'https://example.invalid/catalog.json' : path.join(root, 'missing.json');
    asset(env.AKARI_LIBRARY_ROOT, 'site', { source: { url: 'https://example.invalid/song' } });
    asset(env.AKARI_LIBRARY_ROOT, 'own', { tags: ['origin:own', 'sfx'] });
    const broken = asset(env.AKARI_LIBRARY_ROOT, 'broken');
    writeFileSync(path.join(broken, 'meta.json'), '{');
    const state = await composeState({ env, fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(state.items.length, 3);
    assert.equal(state.items.find(item => item.id === 'site').sourceKind, 'site');
    assert.ok(state.warnings.length);
  });
}

test('new library wins duplicate keys, while legacy-only entries remain visible', async t => {
  const { env } = fixture(t);
  asset(path.join(env.AKARI_HOME, 'assets'), 'same', { title: 'old' });
  asset(path.join(env.AKARI_HOME, 'assets'), 'legacy');
  const dir = asset(env.AKARI_LIBRARY_ROOT, 'same', { title: 'new' });
  utimesSync(dir, new Date(), new Date());
  const { items } = await composeState({ env });
  assert.equal(items.filter(item => item.id === 'same').length, 1);
  assert.equal(items.find(item => item.id === 'same').title, 'new');
  assert.ok(items.some(item => item.id === 'legacy'));
});

for (const [label, item, inCatalog, expected] of [
  ['catalog wins', { tags: ['origin:own'], source: { url: 'https://example.test' } }, true, 'lab'],
  ['site tag', { tags: ['origin:site'] }, false, 'site'],
  ['own tag wins url', { tags: ['origin:own'], source: { url: 'https://example.test' } }, false, 'own'],
  ['legacy source url', { source: { url: 'https://example.test' } }, false, 'site'],
  ['unmarked local', {}, false, 'own'],
]) test(`sourceKind: ${label}`, () => assert.equal(sourceFields(item, inCatalog).sourceKind, expected));

for (const kind of ['bgm', 'jingle', 'sfx']) {
  test(`AKARI Sounds ${kind} outside the catalog is lab`, async t => {
    const { env } = fixture(t);
    const id = `akari-sounds-${kind}`;
    asset(env.AKARI_LIBRARY_ROOT, id, {
      author: 'AKARI Sounds',
      source: { url: 'https://github.com/AkariLabs/akari-sounds/releases/tag/v0', acquisition: 'direct' },
    });
    const item = (await composeState({ env })).items.find(item => item.id === id);
    assert.equal(item.sourceKind, 'lab');
    assert.deepEqual(item.machineTags, []);
  });
}

for (const [url, expected] of [
  ['https://github.com/AkariLabs-evil/x', 'site'],
  ['https://evil.example/github.com/AkariLabs/x', 'site'],
  [`https://${LEGACY_AKARI_HOST}.evil.example/x`, 'site'],
  ['https://akari.video.evil.example/x', 'site'],
  ['https://evilakari.video/x', 'site'],
  ['https://akari.video/x', 'lab'],
  ['https://x.akari.video/x', 'lab'],
  [`https://evil${LEGACY_AKARI_HOST}/x`, 'site'],
  ['https://github.com/other/AkariLabs/x', 'site'],
  [`https://${LEGACY_AKARI_HOST}/x`, 'lab'],
  [`https://assets.${LEGACY_AKARI_HOST}/x`, 'lab'],
  [`https://cdn.assets.${LEGACY_AKARI_HOST}/x`, 'lab'],
  ['https://[broken', 'site'],
  ['not a URL', 'site'],
]) {
  test(`sourceKind URL boundary: ${url}`, () => {
    assert.equal(sourceFields({ source: { url } }).sourceKind, expected);
  });
}

for (const origin of ['site', 'own']) {
  test(`origin:${origin} takes precedence over first-party source URL`, () => {
    const item = { tags: [`origin:${origin}`], source: { url: 'https://github.com/AkariLabs/akari-sounds' } };
    assert.equal(sourceFields(item).sourceKind, origin);
    assert.equal(sourceFields(item, true).sourceKind, 'lab');
  });
}

test('media selection is unique, immediate, and excludes still preview.png', () => {
  const files = names => names.map(name => ({ name, bytes: 1 }));
  assert.equal(primaryMediaFile('audio', files(['a.wav', 'b.mp3'])), null);
  assert.equal(primaryMediaFile('audio', files(['nested/a.wav'])), null);
  assert.equal(primaryMediaFile('still', files(['preview.png', 'image.jpg'])), 'image.jpg');
  assert.equal(primaryMediaFile('still', files(['preview.png'])), null);
  assert.equal(primaryMediaFile('font', files(['font.otf'])), 'font.otf');
  assert.equal(primaryMediaFile('scene3d', files(['model.glb'])), 'model.glb');
});

test('list CLI filters --source and prints origin in human output', t => {
  const { env } = fixture(t);
  asset(env.AKARI_LIBRARY_ROOT, 'mine');
  asset(env.AKARI_LIBRARY_ROOT, 'site', { tags: ['origin:site'] });
  const run = args => spawnSync(process.execPath, ['bin/akari-assets.mjs', 'list', ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  for (const [source, count] of [['lab', 2], ['site', 1], ['own', 1]]) {
    const output = run(['--source', source, '--json']);
    assert.equal(output.status, 0, output.stderr);
    const rows = JSON.parse(output.stdout);
    assert.equal(rows.length, count);
    assert.ok(rows.every(item => item.sourceKind === source));
  }
  assert.match(run(['--source', 'own']).stdout, /mine\town\t/);
  assert.equal(run(['--source', 'invalid']).status, 1);
  assert.equal(run(['--source']).status, 2);
});

test('cached Lab items retain remote preview and file descriptors', async t => {
  const { env, catalog } = fixture(t);
  asset(env.AKARI_LIBRARY_ROOT, 'mini-still', { title: 'Local display title', tags: ['origin:own'] }, 'still');
  const item = (await composeState({ env })).items.find(row => row.id === 'mini-still');
  const remote = catalog.items.find(row => row.id === 'mini-still');
  assert.equal(item.sourceKind, 'lab');
  assert.equal(item.preview, remote.preview);
  assert.deepEqual(item.files, remote.files);
  assert.ok(item.libraryDir);
});
