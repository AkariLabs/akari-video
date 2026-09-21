import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { sha256File } from '../src/hash.mjs';
import { placeholderPng } from '../src/import-artifacts.mjs';
import { extractThreeSceneAssetReferences } from '../../overlay-runtime/runtimes.mjs';
import { applyAdd, planAdd, createImportMeta, proposedAssetId, validateImport, MAX_IMPORT_FILES } from '../src/add.mjs';
import { composeState } from '../src/state.mjs';

const noWaveform = () => ({ ok: false, reason: 'ffmpeg unavailable (test)' });
const noProbe = () => null;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const validator = fileURLToPath(new URL('../../schemas/bin/validate-asset.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'asset-add-test-'));
  const env = { ...process.env, HOME: root, AKARI_HOME: path.join(root, 'home'), AKARI_LIBRARY_ROOT: path.join(root, 'library'),
    AKARI_CREATOR_ROOT: path.join(root, 'creator'), AKARI_ASSETS_CATALOG: path.join(root, 'missing-catalog.json') };
  const input = path.join(root, 'input');
  mkdirSync(input);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, data = name) => {
    const dest = path.join(input, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    return dest;
  };
  return { root, env, input, file };
}
function plan(f, paths = [f.input], probe = noProbe) { return planAdd(paths, { env: f.env, probe }); }
function apply(f, p, options = {}) { return applyAdd(p, { env: f.env, waveform: noWaveform, ...options }); }
function metaOf(row) { return JSON.parse(readFileSync(path.join(row.libraryDir, 'meta.json'), 'utf8')); }
function assertNoTemps(root) { assert.ok(readdirSync(root).every(name => !name.startsWith('.')), 'no staging or lock remains'); }

for (const [seconds, kind, ambiguous] of [[9.9, 'sfx', false], [10, 'sfx', true], [29.9, 'sfx', true], [30, 'bgm', false]]) {
  test(`injected ffprobe boundary ${seconds}s`, async t => {
    const f = fixture(t);
    const source = f.file('track.wav');
    const p = await plan(f, [source], () => seconds);
    assert.equal(p.items.length, 1);
    assert.deepEqual([p.items[0].kind, p.items[0].ambiguous, p.items[0].durationSec, p.items[0].durationSource], [kind, ambiguous, seconds, 'ffprobe']);
    assert.equal(existsSync(f.env.AKARI_LIBRARY_ROOT), false);
  });
}
for (const [bytes, kind, ambiguous] of [[1_199_999, 'sfx', false], [1_200_000, 'sfx', true], [4_000_000, 'sfx', true], [4_000_001, 'bgm', false]]) {
  test(`missing ffprobe size boundary ${bytes} bytes`, async t => {
    const f = fixture(t);
    const p = await plan(f, [f.file('track.mp3', Buffer.alloc(bytes))]);
    assert.deepEqual([p.items[0].kind, p.items[0].ambiguous, p.items[0].durationSec, p.items[0].durationSource], [kind, ambiguous, null, 'size']);
  });
}

test('all supported extensions classify; unsupported, cube and empty files are rejected', async t => {
  const f = fixture(t);
  const groups = { audio: 'mp3 wav m4a aac flac ogg aif aiff', still: 'png jpg jpeg webp gif svg', broll: 'mp4 mov webm m4v', font: 'ttf otf woff woff2', scene3d: 'glb gltf' };
  for (const exts of Object.values(groups)) for (const ext of exts.split(' ')) f.file(`test.${ext.toUpperCase()}`);
  f.file('unsupported.docx'); f.file('grade.cube'); f.file('empty.wav', '');
  const p = await plan(f);
  for (const [category, exts] of Object.entries(groups)) assert.equal(p.items.filter(item => item.category === category).length, exts.split(' ').length);
  assert.equal(p.rejected.length, 3);
  assert.match(p.rejected.find(row => row.name === 'grade.cube').reason, /presets/);
  assert.match(p.rejected.find(row => row.name === 'empty.wav').reason, /0 バイト/);
  assert.ok(p.items.every(row => row.folder === 'input'));
  assert.equal(existsSync(f.env.AKARI_HOME), false);
  assert.equal(existsSync(f.env.AKARI_LIBRARY_ROOT), false);
});

test('ffprobe errors are rejected instead of falling back to size', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('bad.wav')], () => { throw new Error('ffprobe: invalid data'); });
  assert.equal(p.items.length, 0);
  assert.match(p.rejected[0].reason, /ffprobe/);
});

test('same size and bytes are duplicate; same size with different bytes imports', async t => {
  const f = fixture(t);
  const source = f.file('first.wav', 'AAAA');
  const first = await apply(f, await plan(f, [source]));
  assert.equal(first.added.length, 1);
  const p = await plan(f, [f.file('copy.wav', 'AAAA'), f.file('different.wav', 'BBBB')]);
  assert.equal(p.duplicates.length, 1);
  assert.equal(p.duplicates[0].id, first.added[0].id);
  assert.equal(p.duplicates[0].category, 'audio');
  assert.equal(p.items.length, 1);
});

test('id collisions, including empty directories, and non-ASCII names are safe', async t => {
  const f = fixture(t);
  mkdirSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'track'), { recursive: true });
  const p = await plan(f, [f.file('track.wav'), f.file('nested/track.wav'), f.file('日本語.wav')]);
  assert.deepEqual(p.items.slice(0, 2).map(row => row.proposedId), ['track-2', 'track-3']);
  assert.match(p.items[2].proposedId, /^asset-[a-f0-9]{8}$/);
  assert.equal(proposedAssetId('日本語.wav'), proposedAssetId('日本語.mp3'));
  mkdirSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'track-2'));
  const r = await apply(f, p);
  assert.equal(r.added.length, 3);
  assert.equal(r.added[0].id, 'track-2-2');
});

test('apply preserves originals, edited ambiguous kind, folder, credit and pack, then lists and deduplicates', async t => {
  const f = fixture(t);
  const source = f.file('track.wav', 'sound');
  f.file('font.otf', 'font');
  const p = await plan(f, [f.input], () => 14);
  p.items.find(row => row.category === 'audio').kind = 'bgm';
  p.credit = 'Composer\nSomebody';
  p.pack = { id: 'my-set', title: 'My set' };
  const r = await apply(f, p);
  assert.equal(r.failures.length, 0, JSON.stringify(r));
  assert.equal(r.added.length, 2);
  for (const row of r.added) {
    const meta = metaOf(row);
    assert.ok(meta.tags.includes('origin:own'));
    assert.ok(meta.tags.includes('folder:input'));
    assert.ok(meta.tags.includes('pack:my-set'));
    assert.ok(!meta.tags.includes('sfx'));
    assert.equal(meta.license.attribution_required, true);
    assert.equal(readFileSync(path.join(row.libraryDir, 'CREDIT.txt'), 'utf8'), 'Composer Somebody\n');
  }
  assert.equal(readFileSync(source, 'utf8'), 'sound');
  const packs = JSON.parse(readFileSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'packs.json'), 'utf8'));
  assert.equal(packs.schema, 'akari-catalog-packs/v0');
  assert.equal(packs.packs.length, 1);
  const state = await composeState({ env: f.env });
  assert.equal(state.items.length, 2);
  assert.ok(state.items.every(item => item.sourceKind === 'own'));
  const again = await plan(f);
  assert.equal(again.duplicates.length, 2);
  assert.equal(again.items.length, 0);
  assertNoTemps(f.env.AKARI_LIBRARY_ROOT);
});

test('import meta has exactly the 13 required fields and passes the unchanged validator with a waveform', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('sound.wav')]);
  const r = await apply(f, p, { waveform: (_source, dest) => { writeFileSync(dest, png); return { ok: true }; } });
  assert.equal(r.added.length, 1, JSON.stringify(r));
  const row = r.added[0];
  const schema = JSON.parse(readFileSync(new URL('../../schemas/asset-meta.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(metaOf(row)).sort(), schema.required.sort());
  assert.deepEqual(metaOf(row).license, { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: false, ai_training_allowed: false });
  assert.equal(metaOf(row).price, 0);
  const checked = spawnSync(process.execPath, [validator, row.libraryDir], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('missing waveform creates a placeholder, while metadata and broken references still fail closed', async t => {
  const f = fixture(t);
  f.file('raw.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="missing.png"/></svg>');
  f.file('audio.wav');
  const r = await apply(f, await plan(f));
  assert.equal(r.added.length, 1);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].reason, /missing.png/);
  assert.deepEqual(readFileSync(path.join(r.added[0].libraryDir, 'preview.png')), placeholderPng());
  assert.ok(r.added[0].warnings.length);
  const meta = metaOf(r.added[0]);
  delete meta.author;
  writeFileSync(path.join(r.added[0].libraryDir, 'meta.json'), JSON.stringify(meta));
  assert.throws(() => validateImport(r.added[0].libraryDir, { category: 'audio' }), /author/);
});

test('site metadata, subscription and one-line credit are validated and listed', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('site.mp3')]);
  Object.assign(p, { origin: 'site', site: 'example', sourceUrl: 'https://example.test/track', licenseAtSource: 'Subscriber license', subscription: true, credit: 'Artist' });
  const r = await apply(f, p);
  assert.equal(r.failures.length, 0, JSON.stringify(r));
  const meta = metaOf(r.added[0]);
  assert.deepEqual(meta.tags, ['origin:site', 'sfx', 'site:example', 'license:subscription']);
  assert.deepEqual(meta.source, { url: p.sourceUrl, acquisition: 'login', license_at_source: p.licenseAtSource, attribution_required: true });
  const item = (await composeState({ env: f.env })).items[0];
  assert.equal(item.sourceKind, 'site');
  assert.equal(item.subscription, true);
  const direct = createImportMeta(p.items[0], { ...p, subscription: false });
  assert.equal(direct.source.acquisition, 'direct');
});

test('invalid site URL fails validation without leaving an asset', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('site.mp3')]);
  Object.assign(p, { origin: 'site', site: 'bad', sourceUrl: 'file:///secret', licenseAtSource: 'test' });
  const r = await apply(f, p);
  assert.equal(r.failures.length, 1);
  assert.equal(r.added.length, 0);
  assert.deepEqual(readdirSync(f.env.AKARI_LIBRARY_ROOT), []);
});

test('per-asset failure cleans staging and continues with the remaining sources', async t => {
  const f = fixture(t);
  const files = [f.file('bad.wav'), f.file('good.wav')];
  let count = 0;
  const r = await apply(f, await plan(f, files), { validate: (dir, options) => {
    if (++count === 1) throw new Error('injected validation failure');
    return validateImport(dir, options);
  } });
  assert.equal(r.failures.length, 1);
  assert.equal(r.added.length, 1);
  assert.equal(existsSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'bad')), false);
  assert.ok(files.every(existsSync));
  assertNoTemps(f.env.AKARI_LIBRARY_ROOT);
});

test('failed copy leaves no payload and all original files remain', async t => {
  const f = fixture(t);
  const source = f.file('sound.wav');
  const r = await apply(f, await plan(f), { copy: (_source, dest) => { writeFileSync(dest, 'partial'); throw new Error('copy failed'); } });
  assert.equal(r.failures.length, 1);
  assert.equal(existsSync(source), true);
  assert.deepEqual(readdirSync(f.env.AKARI_LIBRARY_ROOT), []);
});

test('plan/apply rechecks source bytes and rejects symlink replacement and unsafe ids', async t => {
  const f = fixture(t);
  const source = f.file('sound.wav', 'AAAA');
  const p = await plan(f, [source]);
  writeFileSync(source, 'BBBB');
  utimesSync(source, new Date(), new Date(Date.now() + 2000));
  assert.match((await apply(f, p)).failures[0].reason, /内容が変更/);
  rmSync(source);
  symlinkSync(f.file('other.wav', 'AAAA'), source);
  assert.match((await apply(f, p)).failures[0].reason, /シンボリックリンク/);
  p.items[0].proposedId = '../../escape';
  assert.match((await apply(f, p)).failures[0].reason, /不正/);
});

test('selected=false is skipped and repeated apply deduplicates', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('first.wav'), f.file('second.wav')]);
  p.items[1].selected = false;
  const r = await apply(f, p);
  assert.equal(r.added.length, 1);
  assert.equal((await apply(f, p)).duplicates.length, 1);
  assert.equal(existsSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'packs.json')), false);
});

test('recursive folder import ignores hidden files, Thumbs.db and symlinks', async t => {
  const f = fixture(t);
  f.file('nested/visible.png'); f.file('.hidden.wav'); f.file('.DS_Store'); f.file('Thumbs.db'); f.file('.hidden/track.wav');
  symlinkSync(f.input, path.join(f.input, 'loop'), 'dir');
  symlinkSync(path.join(f.input, 'nested/visible.png'), path.join(f.input, 'link.png'));
  const p = await plan(f);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].folder, 'input');
  assert.equal(p.rejected.length, 0);
});

test('file traversal stops at 5000 and reports truncation', async t => {
  const f = fixture(t);
  for (let i = 0; i <= MAX_IMPORT_FILES; i++) f.file(`file-${i}.txt`, 'x');
  const p = await plan(f);
  assert.equal(p.rejected.length, MAX_IMPORT_FILES);
  assert.equal(p.truncated, true);
  assert.match(p.warnings[0], /5000/);
  assert.equal(existsSync(f.env.AKARI_LIBRARY_ROOT), false);
});

test('CLI plan/apply JSON round trip, without external media binaries', t => {
  const f = fixture(t);
  f.file('font.otf');
  const run = args => spawnSync(process.execPath, ['bin/akari-assets.mjs', 'add', ...args], { env: f.env, encoding: 'utf8' });
  const planned = run([f.input, '--plan', '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  const p = JSON.parse(planned.stdout);
  const planPath = path.join(f.root, 'plan.json');
  writeFileSync(planPath, JSON.stringify(p));
  const added = run(['--apply', planPath, '--json']);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(JSON.parse(added.stdout).added.length, 1);
  assert.equal(run(['--plan', '--apply', planPath]).status, 2);
  assert.equal(run(['--apply']).status, 2);
});

test('duplicate lookup reads legacy root but prefers new root for the same key', async t => {
  const f = fixture(t);
  const source = f.file('old.wav', 'AAAA');
  const legacyEnv = { ...f.env, AKARI_LIBRARY_ROOT: path.join(f.env.AKARI_HOME, 'assets') };
  const p = await planAdd([source], { env: legacyEnv, probe: noProbe });
  const r = await applyAdd(p, { env: legacyEnv, waveform: noWaveform });
  assert.equal(r.added.length, 1);
  assert.equal((await plan(f, [f.file('copy.wav', 'AAAA')])).duplicates[0].id, 'old');
  const newer = path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'old');
  mkdirSync(newer, { recursive: true });
  writeFileSync(path.join(newer, 'old.wav'), 'BBBB');
  assert.equal((await plan(f, [source])).duplicates.length, 0);
});

test('identical inputs within a batch are deduplicated at apply', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('one.wav', 'AAAA'), f.file('two.wav', 'AAAA')]);
  assert.equal(p.items.length, 2);
  const r = await apply(f, p);
  assert.equal(r.added.length, 1);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].id, r.added[0].id);
});

test('raw still, scene3d and reserved preview name keep their real payload', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('preview.png', png), f.file('model.gltf', '{"asset":{"version":"2.0"}}')]);
  const r = await apply(f, p);
  assert.equal(r.added.length, 2, JSON.stringify(r));
  assert.equal(r.failures.length, 0);
  const items = (await composeState({ env: f.env })).items;
  assert.equal(items.find(item => item.category === 'still').mediaFile, 'media.png');
  assert.equal(items.find(item => item.category === 'scene3d').mediaFile, 'model.gltf');
  assert.deepEqual(readFileSync(path.join(r.added[0].libraryDir, 'media.png')), png);
});

test('pack failure rolls back the placed asset and preserves prior pack index', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('first.wav')]);
  p.pack = { id: 'set', title: 'Set' };
  // Turn the destination into a directory after the index is read, so final rename fails.
  const r = await apply(f, p, { validate: (dir, options) => {
    mkdirSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'packs.json'));
    return validateImport(dir, options);
  } });
  assert.equal(r.added.length, 0);
  assert.equal(r.failures.length, 1);
  assert.equal(existsSync(path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'first')), false);
  assertNoTemps(f.env.AKARI_LIBRARY_ROOT);
});

test('acceptance folder: 3 audio durations, font, video and two rejected files', async t => {
  const f = fixture(t);
  f.file('short.wav'); f.file('middle.wav'); f.file('long.wav'); f.file('font.otf');
  f.file('movie.mp4'); f.file('grade.cube'); f.file('notes.docx');
  const p = await plan(f, [f.input], file => ({ 'short.wav': 0.8, 'middle.wav': 14, 'long.wav': 42 })[path.basename(file)]);
  assert.equal(p.items.filter(row => row.kind === 'sfx' && !row.ambiguous).length, 1);
  assert.equal(p.items.filter(row => row.kind === 'bgm').length, 1);
  assert.equal(p.items.filter(row => row.ambiguous).length, 1);
  assert.equal(p.rejected.length, 2);
  p.items.find(row => row.ambiguous).kind = 'bgm';
  const r = await apply(f, p);
  assert.equal(r.added.length, 5, JSON.stringify(r));
  assert.equal(r.failures.length, 0);
  assert.equal((await plan(f)).duplicates.length, 5);
  assert.equal((await composeState({ env: f.env })).items.filter(row => row.sourceKind === 'own').length, 5);
});

for (const [label, name, bytes, kind] of [
  ['audio sfx', 'short.wav', 'short audio', 'sfx'],
  ['audio bgm', 'mid.wav', 'long audio', 'bgm'],
  ['still png', 'picture.png', png],
  ['still jpg', 'picture.jpg', 'jpeg fixture'],
  ['broll', 'clip.mp4', 'video fixture'],
  ['font', 'font.otf', 'font fixture'],
  ['scene3d glb', 'model.glb', 'glb fixture'],
  ['scene3d gltf', 'model.gltf', '{"asset":{"version":"2.0"}}'],
]) {
  test(`apply CLI passes unchanged validate-asset without ffmpeg: ${label}`, async t => {
    const f = fixture(t);
    const source = f.file(name, bytes);
    const p = await plan(f, [source]);
    if (kind) p.items[0].kind = kind;
    const planPath = path.join(f.root, 'plan.json');
    writeFileSync(planPath, JSON.stringify(p));
    const env = { ...f.env, PATH: '/usr/bin:/bin',
      // Explicit absence also excludes bundled ffmpeg on developer machines.
      AKARI_FFMPEG_BIN: path.join(f.root, 'no-ffmpeg') };
    const result = spawnSync(process.execPath, ['bin/akari-assets.mjs', 'add', '--apply', planPath, '--json'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const added = JSON.parse(result.stdout);
    assert.equal(added.failures.length, 0);
    assert.equal(added.added.length, 1);
    const row = added.added[0];
    const checked = spawnSync(process.execPath, [validator, row.libraryDir], { env, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(metaOf(row).title, path.basename(name, path.extname(name)));
    assert.equal(metaOf(row).tags.includes('sfx'), kind === 'sfx');
    assert.deepEqual(readFileSync(source), Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    const preview = readFileSync(path.join(row.libraryDir, 'preview.png'));
    assert.deepEqual(preview, name.endsWith('.png') ? png : placeholderPng());
    if (row.category === 'still') {
      assert.match(readFileSync(path.join(row.libraryDir, 'fragment.html'), 'utf8'), /<img src="\.\/picture\.(png|jpg)"/);
    }
    if (row.category === 'scene3d') {
      const html = readFileSync(path.join(row.libraryDir, 'fragment.html'), 'utf8');
      assert.match(html, /<canvas/);
      assert.deepEqual(extractThreeSceneAssetReferences(html), [{ role: 'model', path: `./${name}` }]);
    }
  });
}

test('plan never hashes payloads with no same-size existing file', async t => {
  const f = fixture(t);
  const initial = await apply(f, await plan(f, [f.file('existing.wav', 'AAAA')]));
  assert.equal(initial.added.length, 1);
  const calls = [];
  const p = await planAdd([f.file('different-size.wav', 'BBBBB')], {
    env: f.env, probe: noProbe, hashFile: file => { calls.push(file); throw new Error('must not hash'); },
  });
  assert.deepEqual(calls, []);
  assert.equal(p.items.length, 1, JSON.stringify(p));
  assert.equal(p.rejected.length, 0);
  assert.equal(p.items[0].sha256, undefined);
  assert.ok(Number.isFinite(p.items[0].mtimeMs));
});

test('plan hashes only the incoming file and existing candidates of the same size', async t => {
  const f = fixture(t);
  await apply(f, await plan(f, [f.file('match.wav', 'AAAA'), f.file('larger.wav', 'BBBBB')]));
  const incoming = f.file('copy.wav', 'AAAA');
  const calls = [];
  const p = await planAdd([incoming], {
    env: f.env, probe: noProbe, hashFile: async file => { calls.push(file); return sha256File(file); },
  });
  assert.deepEqual(calls, [incoming, path.join(f.env.AKARI_LIBRARY_ROOT, 'audio', 'match', 'match.wav')]);
  assert.equal(p.duplicates.length, 1);
});

test('placeholder PNG is deterministic, CRC-valid and decompresses to complete RGB scanlines', () => {
  const data = placeholderPng();
  assert.deepEqual(data, placeholderPng());
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  const compressed = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const content = data.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const byte of data.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal(data.readUInt32BE(offset + 8 + length), (crc ^ 0xffffffff) >>> 0);
    if (type === 'IDAT') compressed.push(content);
    offset += length + 12;
  }
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  const pixels = inflateSync(Buffer.concat(compressed));
  assert.equal(pixels.length, (width * 3 + 1) * height);
  for (let y = 0; y < height; y++) assert.equal(pixels[y * (width * 3 + 1)], 0);
});

for (const category of ['audio', 'broll']) {
  test(`${category} preview generation exceptions fall back to a valid placeholder`, async t => {
    const f = fixture(t);
    const p = await plan(f, [f.file(category === 'audio' ? 'sound.wav' : 'clip.mp4')]);
    const fail = (_source, dest) => { writeFileSync(dest, 'partial'); throw new Error('ffmpeg failed'); };
    const r = await apply(f, p, { waveform: fail, thumbnail: fail });
    assert.equal(r.failures.length, 0, JSON.stringify(r));
    assert.equal(r.added.length, 1);
    assert.deepEqual(readFileSync(path.join(r.added[0].libraryDir, 'preview.png')), placeholderPng());
    assert.match(r.added[0].warnings[0], /ffmpeg failed/);
    assert.equal(spawnSync(process.execPath, [validator, r.added[0].libraryDir]).status, 0);
  });
}

test('a successful video thumbnail is kept instead of replaced by a placeholder', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('clip.mp4')]);
  const r = await apply(f, p, { thumbnail: (_source, dest) => { writeFileSync(dest, png); return { ok: true }; } });
  assert.equal(r.failures.length, 0);
  assert.deepEqual(readFileSync(path.join(r.added[0].libraryDir, 'preview.png')), png);
});

test('missing preview or fragment is always a validation failure and leaves no asset', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('font.otf'), f.file('picture.jpg')]);
  const r = await apply(f, p, { validate: (dir, options) => {
    rmSync(path.join(dir, options.category === 'still' ? 'fragment.html' : 'preview.png'));
    return validateImport(dir);
  } });
  assert.equal(r.added.length, 0);
  assert.equal(r.failures.length, 2);
  assert.match(r.failures[0].reason, /preview.png/);
  assert.match(r.failures[1].reason, /fragment.html/);
  assert.deepEqual(readdirSync(f.env.AKARI_LIBRARY_ROOT), []);
});

test('still fragment safely references filenames containing HTML and URL punctuation', async t => {
  const f = fixture(t);
  const p = await plan(f, [f.file('image & "quote" #100%.jpg')]);
  const r = await apply(f, p);
  assert.equal(r.failures.length, 0, JSON.stringify(r));
  const html = readFileSync(path.join(r.added[0].libraryDir, 'fragment.html'), 'utf8');
  assert.match(html, /%26/);
  assert.match(html, /%22/);
  assert.match(html, /%23/);
  assert.equal(spawnSync(process.execPath, [validator, r.added[0].libraryDir]).status, 0);
});
