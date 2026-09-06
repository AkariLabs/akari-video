import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { projectLegacyAudioView } from '../lib/legacy-audio-view.js';
import { serializeEdit } from '../lib/canonical.js';
import { compatibilityFixtures, compatibilityBytes, repositoryRoot } from './helpers/cut-audio-compatibility.mjs';

const fixture = async (suffix = 'split-valid') => JSON.parse(await readFile(join(
  repositoryRoot, `packages/schemas/examples/edit-v2-cut-audio-${suffix}/edit.json`,
), 'utf8'));
const unsupported = '未対応: 本編音声の分離（audio:false / link / mute / role:speech）は次の便で有効化されます。この edit.json は現在のエンジンでは再生・書き出しできません。';

test('cut audio vocabulary passes structural reads; link integrity belongs to lint', async () => {
  for (const suffix of ['split-valid', 'link-missing-invalid', 'link-not-media-invalid', 'link-duplicate-invalid']) {
    const doc = await fixture(suffix);
    assert.doesNotThrow(() => readEditV2(doc));
  }
  const invalid = await fixture('true-invalid');
  assert.throws(() => readEditV2(invalid), /\.audio.*false/u);
});

test('runtime rejects each new field independently, including mute:false; opt-in accepts it', async () => {
  for (const [track, field, value] of [[0, 'audio', false], [1, 'link', 'cut'], [1, 'mute', false], [1, 'mute', true], [1, 'role', 'speech']]) {
    const doc = await fixture();
    delete doc.tracks[0].items[0].audio;
    for (const key of ['role', 'link', 'mute']) delete doc.tracks[1].items[0][key];
    doc.tracks[track].items[0][field] = value;
    const before = JSON.stringify(doc);
    for (const input of [doc, before]) {
      for (const options of [undefined, {}, { allowCutAudioSplit: false }]) {
        assert.throws(() => readInternalEdit(input, options), { message: unsupported });
      }
      assert.doesNotThrow(() => readInternalEdit(input, { allowCutAudioSplit: true }));
    }
    assert.equal(JSON.stringify(doc), before);
  }
});

test('runtime detects nested split media even on hidden, locked, muted tracks', async () => {
  const doc = await fixture();
  doc.tracks.pop();
  const child = doc.tracks[0].items[0];
  doc.tracks[0].muted = true;
  doc.tracks[0].items = [{ id: 'group', at: 0, duration: 90, hidden: true, locked: true,
    source: { kind: 'group' }, items: [child] }];
  assert.doesNotThrow(() => readEditV2(doc));
  assert.throws(() => readInternalEdit(doc), { message: unsupported });
  assert.doesNotThrow(() => readInternalEdit(doc, { allowCutAudioSplit: true }));
});

test('speech remains explicit and is never projected as legacy sfx', async () => {
  const doc = await fixture();
  const internal = readInternalEdit(doc, { allowCutAudioSplit: true });
  const speech = internal.tracks[1].items[0];
  assert.equal(speech.declaration.role, 'speech');
  assert.notEqual(speech.legacy.collection, 'sfx');
  assert.deepEqual(projectLegacyAudioView(internal), { sfx: [], narration: [] });
  // The view must also defend against a legacy-shaped speech declaration.
  speech.legacy = { collection: 'sfx', index: 0, value: { id: 'voice' } };
  assert.deepEqual(projectLegacyAudioView(internal), { sfx: [], narration: [] });
});

test('structural reader enforces exact field types and visual-media-only audio', async () => {
  for (const [track, field, values] of [
    [0, 'audio', [true, null, 0, 'false', {}]],
    [1, 'link', ['', ' \t\n', null, 0, false, {}]],
    [1, 'mute', [null, 0, 'false', {}]],
    [0, 'link', ['cut']], [0, 'mute', [false]], [0, 'role', ['speech']], [1, 'audio', [false]],
  ]) {
    for (const value of values) {
      const doc = await fixture();
      doc.tracks[track].items[0][field] = value;
      assert.throws(() => readEditV2(doc), new RegExp(field));
    }
  }
  for (const source of [{ kind: 'html', path: 'overlay.html' }, { kind: 'group' },
    { kind: 'shape', shape: 'rect' }, { kind: 'telop', preset: 'title' },
    { kind: 'filter', filter: { type: 'invert' } }, { kind: 'captions', path: 'captions.json' },
    { kind: 'caption', path: 'captions.json', id: 'c-0001' }]) {
    const doc = await fixture();
    doc.tracks[0].items[0].source = source;
    assert.throws(() => readEditV2(doc), /\.audio.*media item/u);
  }
});

test('canonical split keys follow source and role and round-trip without filling defaults', async () => {
  const doc = await fixture();
  for (const track of doc.tracks) track.items[0] = Object.fromEntries(Object.entries(track.items[0]).reverse());
  const text = serializeEdit(doc);
  assert.match(text, /"source": \{[^\n]+\}, "audio": false/u);
  assert.match(text, /"role": "speech", "link": "cut", "mute": false/u);
  assert.equal(serializeEdit(JSON.parse(text)), text);
  assert.deepEqual(JSON.parse(text), doc);
});

test('cut audio generated keys match a fresh gen-types run byte for byte', async () => {
  const generated = new URL('../src/generated/edit-v2-keys.ts', import.meta.url);
  const before = await readFile(generated);
  // Execute the generator in-process so this check also works where child spawning is restricted.
  await import('../scripts/gen-types.mjs');
  assert.deepEqual(await readFile(generated), before);
});

test('all pre-split fixtures retain exact canonical, migration and normalization bytes', async t => {
  // Captured from the unmodified serializer before introducing cut audio vocabulary.
  const expected = JSON.parse(await readFile(new URL('./cut-audio-compatibility.snapshot.json', import.meta.url), 'utf8'));
  assert.deepEqual(await compatibilityFixtures(), Object.keys(expected));
  for (const [path, outputs] of Object.entries(expected)) {
    const original = await readFile(join(repositoryRoot, path));
    const actual = await compatibilityBytes(path);
    assert.deepEqual(Object.keys(actual), Object.keys(outputs), path);
    for (const [operation, bytes] of Object.entries(outputs)) {
      if (bytes === null) assert.equal(actual[operation], null, `${path}: ${operation}`);
      else assert.deepEqual(Buffer.from(actual[operation], 'utf8'), Buffer.from(bytes, 'utf8'), `${path}: ${operation}`);
    }
    assert.deepEqual(await readFile(join(repositoryRoot, path)), original, `${path}: source bytes`);
  }
  t.diagnostic(`pre-split byte compatibility: ${Object.keys(expected).length} fixtures`);
});
