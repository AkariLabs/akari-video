import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findGenerationMetaBySha,
  readGenerationMeta,
} from '../lib/generation-meta-node.js';
import {
  bindingShaFor,
  resolveGenerationState,
  selectGenerationSidecarForSource,
  sidecarPathFor,
} from '../lib/generation-meta.js';

const NOW = new Date('2026-09-13T10:00:00.000Z');

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function meta(status, content = '素材', overrides = {}) {
  const sha256 = hash(content);
  return {
    version: 1,
    kind: 'video',
    status,
    inputs: { first_frame: { sha256 } },
    job: {
      started_at: '2026-09-13T09:50:00.000Z',
      stale_after_s: 900,
    },
    ...(status === 'done' ? { result: { sha256 } } : {}),
    ...overrides,
  };
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-meta-'));
  fs.mkdirSync(path.join(root, 'assets', 'generated'), { recursive: true });
  return root;
}

function put(root, relative, content, sidecar) {
  const source = path.join(root, relative);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, content);
  if (sidecar) fs.writeFileSync(sidecarPathFor(source), JSON.stringify(sidecar));
  return source;
}

test('sidecarPathFor は元パスの末尾へ .meta.json を足す', () => {
  assert.equal(sidecarPathFor('assets/generated/clip.mp4'), 'assets/generated/clip.mp4.meta.json');
});

test('bindingShaFor は done の result.sha256 を返す', () => {
  assert.deepEqual(bindingShaFor(meta('done')), { sha256: hash('素材'), source: 'result' });
});

test('bindingShaFor は kind still の first_frame.sha256 を返す', () => {
  assert.deepEqual(bindingShaFor(meta('generating', '素材', { kind: 'still' })), {
    sha256: hash('素材'), source: 'first_frame'
  });
});

test('bindingShaFor は planned の first_frame.sha256 を返す', () => {
  assert.deepEqual(bindingShaFor(meta('planned')), { sha256: hash('素材'), source: 'first_frame' });
});

test('bindingShaFor は生成中 video の first_frame.sha256 を返す', () => {
  assert.deepEqual(bindingShaFor(meta('generating')), {
    sha256: hash('素材'), source: 'first_frame'
  });
});

test('bindingShaFor は sha の無い meta と null を null にする', () => {
  assert.equal(bindingShaFor({ version: 1, kind: 'video', status: 'generating' }), null);
  assert.equal(bindingShaFor(null), null);
});

const lookupMeta = (status, firstFramePath, startedAt = '2026-09-13T09:50:00.000Z') => ({
  version: 1,
  kind: 'video',
  status,
  inputs: { first_frame: { path: firstFramePath, sha256: hash('still') } },
  job: { started_at: startedAt, stale_after_s: 30 },
  ...(status === 'done' ? { result: { sha256: hash('video') } } : {})
});

test('selectGenerationSidecarForSource は生成物と still の優先規則を表駆動で解決する', () => {
  const still = { sourcePath: 'assets/stills/a.png', meta: {
    version: 1, kind: 'still', status: 'planned', inputs: { first_frame: { path: 'assets/stills/a.png' } }
  } };
  const rows = [
    { name: '差し替え前 generating', status: 'generating', now: '2026-09-13T09:50:10.000Z', expected: 'video' },
    { name: '差し替え前 stale', status: 'generating', now: '2026-09-13T09:50:31.000Z', expected: 'video' },
    { name: '差し替え前 failed', status: 'failed', now: NOW, expected: 'video' },
    { name: '差し替え前 done は still へ落とす', status: 'done', now: NOW, expected: 'still' }
  ];
  for (const row of rows) {
    const video = {
      sourcePath: 'assets/generated/gen-a.mp4', meta: lookupMeta(row.status, 'assets/stills/a.png'),
      binding: { matches: true }
    };
    assert.equal(
      selectGenerationSidecarForSource('assets/stills/a.png', [still, video], row.now)?.meta?.kind,
      row.expected,
      row.name
    );
  }
});

test('selectGenerationSidecarForSource は差し替え後の video 直接一致を返す', () => {
  const video = { sourcePath: 'assets/generated/gen-a.mp4', meta: lookupMeta('done', 'assets/stills/a.png') };
  assert.equal(selectGenerationSidecarForSource(video.sourcePath, [video], NOW), video);
});

test('selectGenerationSidecarForSource は最新候補、path 正規化、orphan 除外を決定的に扱う', () => {
  const old = { sourcePath: 'old.mp4', meta: lookupMeta('generating', '././assets\\stills\\a.png', '2026-09-13T09:40:00Z'), binding: { matches: true } };
  const orphan = { sourcePath: 'orphan.mp4', meta: lookupMeta('failed', 'assets/stills/a.png', '2026-09-13T10:00:00Z'), binding: { matches: false } };
  const latest = { sourcePath: 'latest.mp4', meta: lookupMeta('failed', 'assets/stills/a.png', '2026-09-13T09:55:00Z') };
  assert.equal(selectGenerationSidecarForSource(' ./assets/stills/a.png ', [old, orphan, latest], NOW), latest);
  const firstInvalid = { sourcePath: 'first.mp4', meta: lookupMeta('failed', 'assets/stills/a.png', 'invalid') };
  const secondInvalid = { sourcePath: 'second.mp4', meta: lookupMeta('failed', 'assets/stills/a.png', 'also-invalid') };
  assert.equal(selectGenerationSidecarForSource('assets/stills/a.png', [firstInvalid, secondInvalid], NOW), firstInvalid);
});

test('selectGenerationSidecarForSource は entries 空なら undefined', () => {
  assert.equal(selectGenerationSidecarForSource('assets/stills/a.png', [], NOW), undefined);
});

for (const row of [
  { name: 'none', expected: 'none', sidecar: null },
  { name: 'planned', expected: 'planned', sidecar: meta('planned') },
  { name: 'generating', expected: 'generating', sidecar: meta('generating') },
  { name: 'stale', expected: 'stale', sidecar: meta('generating', '素材', { job: { started_at: '2026-09-13T09:44:59.000Z', stale_after_s: 900 } }) },
  { name: 'done', expected: 'done', sidecar: meta('done') },
  { name: 'failed', expected: 'failed', sidecar: meta('failed') },
]) {
  test(`6 状態: ${row.name}`, t => {
    const root = project();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    put(root, 'assets/generated/clip.mp4', '素材', row.sidecar);
    const result = readGenerationMeta({ projectRoot: root, sourcePath: 'assets/generated/clip.mp4', now: NOW });
    assert.equal(result.state, row.expected);
    assert.equal(result.meta === null, row.sidecar === null);
  });
}

for (const row of [
  { name: '改名', target: 'assets/generated/renamed.mp4' },
  { name: '移動', target: 'assets/generated/nested/moved.mp4' },
]) {
  test(`${row.name}: path が変わっても sha256 から元の meta を復旧できる`, t => {
    const root = project();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const content = `${row.name}対象`;
    const originalMeta = meta('done', content, { marker: row.name });
    const original = put(root, 'assets/generated/original.mp4', content, originalMeta);
    const target = path.join(root, row.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(original, target);
    const found = findGenerationMetaBySha({ projectRoot: root, sha256: hash(content) });
    assert.deepEqual(found, originalMeta);
  });
}

test('複製: 同じ sha256 の 2 ファイルは同じ meta と結線する', t => {
  const root = project();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = '複製対象';
  const sharedMeta = meta('done', content);
  put(root, 'assets/generated/a.mp4', content, sharedMeta);
  put(root, 'assets/generated/b.mp4', content, sharedMeta);
  const a = readGenerationMeta({ projectRoot: root, sourcePath: 'assets/generated/a.mp4', now: NOW });
  const b = readGenerationMeta({ projectRoot: root, sourcePath: 'assets/generated/b.mp4', now: NOW });
  assert.equal(a.state, 'done');
  assert.equal(b.state, 'done');
  assert.deepEqual(a.meta, b.meta);
  assert.equal(a.binding.matches, true);
  assert.equal(b.binding.matches, true);
});

test('中身が変わって sha256 が不一致なら orphan を優先する', t => {
  const root = project();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = put(root, 'assets/generated/clip.mp4', '元の内容', meta('done', '元の内容'));
  fs.writeFileSync(source, '変更後');
  const result = readGenerationMeta({ projectRoot: root, sourcePath: source, now: NOW });
  assert.equal(result.state, 'orphan');
  assert.equal(result.binding.matches, false);
  assert.equal(result.binding.actualSha256, hash('変更後'));
});

test('kind still は inputs.first_frame.sha256 の不一致を orphan と判定する', t => {
  const root = project();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, 'assets/generated/still.png', '実ファイル', meta('planned', '参照元', { kind: 'still' }));
  const result = readGenerationMeta({
    projectRoot: root,
    sourcePath: 'assets/generated/still.png',
    now: NOW,
  });
  assert.equal(result.state, 'orphan');
  assert.equal(result.binding.source, 'first_frame');
  assert.equal(result.binding.matches, false);
});

for (const row of [
  { fixture: 'planned', expected: 'planned' },
  { fixture: 'generating', expected: 'generating' },
  { fixture: 'stale', expected: 'stale' },
  { fixture: 'done', expected: 'done' },
  { fixture: 'failed', expected: 'failed' },
  { fixture: 'still', expected: 'done' },
]) {
  test(`schema fixture ${row.fixture}.json の状態を ${row.expected} と解決する`, () => {
    const fixtureUrl = new URL(
      `../../schemas/fixtures/generation-meta/${row.fixture}.json`,
      import.meta.url,
    );
    const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
    assert.equal(
      resolveGenerationState(fixture, new Date('2026-09-13T09:35:00.000Z')),
      row.expected,
    );
  });
}

for (const row of [
  { seconds: 899, expected: 'generating' },
  { seconds: 900, expected: 'generating' },
  { seconds: 901, expected: 'stale' },
]) {
  test(`stale 境界: stale_after_s との差 ${row.seconds - 900} 秒`, () => {
    const value = meta('generating', '素材', { job: { started_at: '2026-09-13T09:45:00.000Z', stale_after_s: 900 } });
    const now = new Date(Date.parse(value.job.started_at) + row.seconds * 1000);
    assert.equal(resolveGenerationState(value, now), row.expected);
  });
}

for (const row of [
  { seconds: 899, expected: 'generating' },
  { seconds: 900, expected: 'generating' },
  { seconds: 901, expected: 'stale' },
]) {
  test(`stale_after_s 未指定では既定 900 秒を使う: ${row.seconds} 秒`, () => {
    const value = {
      version: 1,
      kind: 'video',
      status: 'generating',
      job: { started_at: '2026-09-13T09:45:00.000Z' },
    };
    const now = new Date(Date.parse(value.job.started_at) + row.seconds * 1000);
    assert.equal(resolveGenerationState(value, now), row.expected);
  });
}

for (const row of [
  { name: '負数', staleAfterS: -1 },
  { name: 'NaN', staleAfterS: Number.NaN },
  { name: '文字列', staleAfterS: '30' },
]) {
  test(`不正な stale_after_s（${row.name}）では既定 900 秒を使う`, () => {
    const startedAt = '2026-09-13T09:45:00.000Z';
    const value = {
      version: 1,
      kind: 'video',
      status: 'generating',
      job: { started_at: startedAt, stale_after_s: row.staleAfterS },
    };
    assert.equal(resolveGenerationState(value, Date.parse(startedAt) + 899000), 'generating');
    assert.equal(resolveGenerationState(value, Date.parse(startedAt) + 901000), 'stale');
  });
}

for (const sourcePath of ['../outside.mp4', path.join(os.tmpdir(), 'outside.mp4')]) {
  test(`projectRoot 外の sourcePath を拒否する: ${sourcePath}`, t => {
    const root = project();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.throws(
      () => readGenerationMeta({ projectRoot: root, sourcePath, now: NOW }),
      /projectRoot 外/,
    );
  });
}
