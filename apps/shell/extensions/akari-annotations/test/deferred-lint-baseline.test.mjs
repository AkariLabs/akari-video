import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DeferredLintBaseline } from '../lib/node/deferred-lint-baseline.js';
import { splitLintBlame } from '../lib/common/lint-blame-scope.js';

test('最初の保存でも書く前の結果を使い、連続保存は最初の基準と書いた全ファイルを保つ', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-before-'));
  try {
    const old = { severity: 'error', check: 'captions.cut-visibility', path: 'captions.json#[1]' };
    const added = { severity: 'error', check: 'captions.overlap', path: 'captions.json#[2]' };
    const oldCaptions = JSON.stringify([{ id: 'first' }, { id: 'c-0004' }]);
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), oldCaptions);
    const calls = [];
    const baseline = new DeferredLintBaseline(async (_dir, overrides, writeReports) => {
      calls.push({ overrides, writeReports });
      return { pass: false, errors: [], findings: [old] };
    });
    await baseline.begin(dir, ['captions.json']);
    assert.equal(calls.length, 0);
    await writeFile(join(dir, 'captions.json'), JSON.stringify([
      { id: 'new' }, { id: 'first' }, { id: 'c-0004' }
    ]));
    await baseline.begin(dir, ['edit.json']);
    const shifted = { ...old, path: 'captions.json#[2]' };
    const findings = [shifted, added];
    const blame = await baseline.finish(dir, { pass: false, errors: [], findings });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].overrides['captions.json'], oldCaptions);
    assert.equal(calls[0].writeReports, false);
    assert.deepEqual(blame.writtenFiles, ['captions.json', 'edit.json']);
    assert.deepEqual(splitLintBlame(findings, blame.writtenFiles,
      blame.existingFindingKeys, blame.findingKeys), { own: [added], foreign: [shifted] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('保存は基準 lint の完了を待たない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-async-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), '[]');
    let release;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const baseline = new DeferredLintBaseline(() => new Promise(resolve => {
      release = resolve;
      markStarted();
    }));
    await baseline.begin(dir, ['captions.json']);
    assert.equal(release, undefined);
    await writeFile(join(dir, 'captions.json'), '[{"id":"new"}]');
    const finding = { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' };
    const finishing = baseline.finish(dir, { pass: false, errors: [], findings: [finding] });
    let timeout;
    await Promise.race([started, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('基準 lint が開始されませんでした。')), 10000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal(typeof release, 'function');
    release({ pass: true, errors: [], findings: [] });
    await finishing;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('保存後結果の処理中に次の保存が来ても最初の保存前を基準に残す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-revision-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), '[]');
    const calls = [];
    let releaseFirst;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const baseline = new DeferredLintBaseline(async (_dir, overrides) => {
      calls.push(overrides);
      if (calls.length === 1) { markStarted(); await firstGate; }
      return { pass: true, errors: [], findings: [] };
    });
    await baseline.begin(dir, ['captions.json']);
    await writeFile(join(dir, 'captions.json'), '[{"id":"first"}]');
    const firstError = { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' };
    const old = baseline.finish(dir, { pass: false, errors: [], findings: [firstError] });
    let timeout;
    await Promise.race([started, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('基準 lint が開始されませんでした。')), 10000);
    })]).finally(() => clearTimeout(timeout));
    await baseline.begin(dir, ['edit.json']);
    await writeFile(join(dir, 'edit.json'), '{"second":true}');
    releaseFirst();
    assert.equal(await old, undefined);
    const latest = await baseline.finish(dir, { pass: false, errors: [], findings: [firstError] });
    assert.deepEqual(latest.writtenFiles, ['captions.json', 'edit.json']);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(overrides => overrides['captions.json'] === '[]' && overrides['edit.json'] === '{}'));
    assert.deepEqual(splitLintBlame([firstError], latest.writtenFiles,
      latest.existingFindingKeys, latest.findingKeys), { own: [firstError], foreign: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pass と foreign-only は基準 lint を使わず、続けて保存した結果をキャッシュから照合する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-cache-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), JSON.stringify([{ id: 'old' }]));
    let calls = 0;
    const baseline = new DeferredLintBaseline(async () => {
      calls++;
      return { pass: true, errors: [], findings: [] };
    });
    await baseline.begin(dir, ['captions.json']);
    await baseline.finish(dir, { pass: true, errors: [], findings: [] });
    assert.equal(calls, 0);
    await baseline.begin(dir, ['edit.json']);
    await baseline.finish(dir, { pass: false, errors: [], findings: [
      { severity: 'error', check: 'intake.example', path: '.akari/intake.json#target' }
    ] });
    assert.equal(calls, 0);
    await baseline.begin(dir, ['captions.json']);
    await writeFile(join(dir, 'captions.json'), JSON.stringify([{ id: 'old' }, { id: 'new' }]));
    const finding = { severity: 'error', check: 'captions.example', path: 'captions.json#[1]' };
    const first = await baseline.finish(dir, { pass: false, errors: [], findings: [finding] });
    assert.deepEqual(first.existingFindingKeys, ['intake.example\u0000.akari/intake.json#target']);
    assert.equal(calls, 0);
    await baseline.begin(dir, ['captions.json']);
    await writeFile(join(dir, 'captions.json'), JSON.stringify([{ id: 'old' }, { id: 'new', text: '変更' }]));
    const second = await baseline.finish(dir, { pass: false, errors: [], findings: [finding] });
    assert.deepEqual(splitLintBlame([finding], second.writtenFiles,
      second.existingFindingKeys, second.findingKeys), { own: [], foreign: [finding] });
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('保存前の内容が外部で変わったら基準 lint を一回だけ実行する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-external-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), '[]');
    const calls = [];
    const baseline = new DeferredLintBaseline(async (_dir, overrides, writeReports) => {
      calls.push({ overrides, writeReports });
      return { pass: true, errors: [], findings: [] };
    });
    await baseline.begin(dir, ['captions.json']);
    await baseline.finish(dir, { pass: true, errors: [], findings: [] });
    const external = JSON.stringify([{ id: 'external' }]);
    await writeFile(join(dir, 'captions.json'), external);
    await baseline.begin(dir, ['captions.json']);
    await writeFile(join(dir, 'captions.json'), JSON.stringify([{ id: 'external', text: '変更' }]));
    await baseline.finish(dir, { pass: false, errors: [], findings: [
      { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' }
    ] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].overrides['captions.json'], external);
    assert.equal(calls[0].writeReports, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('保存前 snapshot の読取り失敗は保存を止めず、ファイル単位の帰属へ戻す', async t => {
  t.mock.method(console, 'warn', () => undefined);
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-read-fail-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), '[]');
    let failed = false;
    const baseline = new DeferredLintBaseline(async () => { throw new Error('呼ばれない'); }, async path => {
      if (!failed) { failed = true; throw Object.assign(new Error('read failed'), { code: 'EACCES' }); }
      return readFile(path, 'utf8');
    });
    await baseline.begin(dir, ['captions.json']);
    const finding = { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' };
    const blame = await baseline.finish(dir, { pass: false, errors: [], findings: [finding] });
    assert.deepEqual(blame, { writtenFiles: ['captions.json'] });
    assert.deepEqual(splitLintBlame([finding], blame.writtenFiles), { own: [finding], foreign: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('保存後 snapshot の読取り失敗でもファイル単位の結果を返す', async t => {
  t.mock.method(console, 'warn', () => undefined);
  const dir = await mkdtemp(join(tmpdir(), 'akari-lint-finish-fail-'));
  try {
    await writeFile(join(dir, 'edit.json'), '{}');
    await writeFile(join(dir, 'captions.json'), '[]');
    let reads = 0;
    const baseline = new DeferredLintBaseline(async () => { throw new Error('呼ばれない'); }, async path => {
      if (++reads > 2) throw Object.assign(new Error('read failed'), { code: 'EACCES' });
      return readFile(path, 'utf8');
    });
    await baseline.begin(dir, ['captions.json']);
    const blame = await baseline.finish(dir, { pass: false, errors: [], findings: [
      { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' }
    ] });
    assert.deepEqual(blame, { writtenFiles: ['captions.json'] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('比較器が例外を出しても保存後 lint の通知は送る', async t => {
  t.mock.method(console, 'warn', () => undefined);
  const { AkariAnnotationsServiceImpl } = await import('../lib/node/akari-annotations-service.js');
  const service = new AkariAnnotationsServiceImpl();
  const notifications = [];
  service.setClient({ onLintResult: notification => notifications.push(notification) });
  service.deferredLintBaseline = {
    writtenFiles: () => ['captions.json'],
    finish: async () => { throw new Error('compare failed'); }
  };
  const result = { pass: false, errors: ['error'], findings: [
    { severity: 'error', check: 'captions.example', path: 'captions.json#[0]' }
  ] };
  await service.notifyDeferredLint('/project', result);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].writtenFiles, ['captions.json']);
  assert.deepEqual(notifications[0].findings, result.findings);
});
