import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { serializeCaptions, serializeEdit, serializeMotion } from '../lib/canonical.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const fixtureRoot = join(packageRoot, 'test/fixtures');

test('契約 §5.1 の JSON 例は canonical bytes と完全一致する', async () => {
  const text = await readFile(join(fixtureRoot, 'canonical-contract-example.json'), 'utf8');
  assert.equal(serializeEdit(JSON.parse(text)), text);
});

test('canonical serializer は固定キー順・未知キー順・元の captions 外形を保つ', () => {
  const edit = {
    future_top: 'keep', tracks: [{ lane: 'visual', future_track: 1, id: 'v1', items: [{
      source: { path: 'x.html', future_source: 2, kind: 'html' }, future_a: 3,
      duration: 30, id: 'title', at: 0, future_b: 4,
    }] }], output: { fps: 30, width: 640, height: 360 }, version: 2, sources: [],
  };
  const serialized = serializeEdit(edit);
  assert.ok(serialized.indexOf('"version"') < serialized.indexOf('"output"'));
  assert.ok(serialized.indexOf('"future_a"') < serialized.indexOf('"future_b"'));
  assert.match(serialized, /"source": \{ "kind": "html", "path": "x\.html", "future_source": 2 \}/u);
  assert.equal(serializeEdit(JSON.parse(serialized)), serialized);

  const array = [{ id: 'c1', start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null, edited: false, future: 1 }];
  const object = { version: 0, default_text_style: { color: '#fff' }, captions: array, future: 2 };
  assert.ok(serializeCaptions(array).startsWith('[\n'));
  assert.ok(serializeCaptions(object).startsWith('{\n'));
  assert.equal(serializeCaptions(JSON.parse(serializeCaptions(object))), serializeCaptions(object));
});

test('トップレベルの配列と空でない配列を含む audio オブジェクトは再帰的に縦へ開く', () => {
  const doc = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'music', path: 'assets/music.wav' }],
    audio: {
      bgm: [{ id: 'bgm-1', src: 'music' }],
      mix: { buses: [{ id: 'master', gain_db: -3 }], limiter: true },
    },
    tracks: [],
  };
  const text = serializeEdit(doc);
  assert.match(text, /"output": \{ "width": 640, "height": 360, "fps": 30 \}/u);
  assert.match(text, /"audio": \{\n    "bgm": \[\n      \{ "id": "bgm-1", "src": "music" \}\n    \],\n    "mix": \{\n      "buses": \[/u);
  assert.equal(serializeEdit(JSON.parse(text)), text);
});

test('motion は 1 キーフレーム 1 行・t 昇順で冪等', () => {
  const doc = {
    version: 0, group: 'g1', future: true, items: {
      title: [{ t: 12, opacity: 1 }, { future: 1, opacity: 0, t: 0 }],
    },
  };
  const serialized = serializeMotion(doc);
  assert.ok(serialized.indexOf('"t": 0') < serialized.indexOf('"t": 12'));
  assert.equal(serialized.split('\n').filter(line => line.includes('"t":')).length, 2);
  assert.equal(serializeMotion(JSON.parse(serialized)), serialized);
});

test('対象 v2 fixtures 全件で serialize(parse(serialize(x))) が冪等', async t => {
  const paths = [];
  for (const name of (await readdir(join(repositoryRoot, 'packages/schemas/test/fixtures'))).sort()) {
    if (name.startsWith('object-tree-') && name.endsWith('.json')) {
      paths.push(join(repositoryRoot, 'packages/schemas/test/fixtures', name));
    }
  }
  for (const name of (await readdir(fixtureRoot)).sort()) {
    if (name.endsWith('.json')) paths.push(join(fixtureRoot, name));
  }
  const lintFixtures = join(repositoryRoot, 'packages/edit-lint/fixtures');
  for (const name of (await readdir(lintFixtures)).sort()) {
    const path = join(lintFixtures, name, 'edit.json');
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (value?.version === 2) paths.push(path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const path of paths) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const first = serializeEdit(value);
    assert.equal(serializeEdit(JSON.parse(first)), first, path);
  }
  t.diagnostic(`canonical idempotence fixtures: ${paths.length}`);
});
