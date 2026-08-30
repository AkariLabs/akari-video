import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  lintProjectCandidates,
  lintProjectCandidatesOnDisk,
  assertNoCamelCaseTransitionOut,
  scheduleProjectLint,
  writeProjectFilesGuarded,
  writeAtomic,
  findEditLintBinPath
} from '../lib/write-gate.js';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function makeProject(edit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-store-test-'));
  fs.writeFileSync(path.join(root, 'edit.json'), JSON.stringify(edit, null, 2), 'utf8');
  return root;
}

test('findEditLintBinPath はリポ内の edit-lint bin を解決する', () => {
  const bin = findEditLintBinPath();
  assert.ok(bin.endsWith(path.join('edit-lint', 'bin', 'edit-lint.mjs')));
  assert.ok(fs.existsSync(bin));
});

test('lintProjectCandidates は不正な候補を pass:false で返す（findings 付き）', async () => {
  const root = makeProject({ version: 0 });
  try {
    const result = await lintProjectCandidates(root, {
      'edit.json': JSON.stringify({ version: 0, cuts: [{ in: 5, out: 1 }] })
    });
    assert.equal(result.pass, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.findings.some(finding => finding.severity === 'error'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeProjectFilesGuarded は lint を待たず候補全文を atomic 保存する', async () => {
  const before = { version: 0 };
  const root = makeProject(before);
  try {
    const candidate = JSON.stringify({ version: 0, cuts: [{ in: 5, out: 1 }] });
    await writeProjectFilesGuarded(root, { 'edit.json': candidate }, { debounceMs: 10 });
    const after = JSON.parse(fs.readFileSync(path.join(root, 'edit.json'), 'utf8'));
    assert.deepEqual(after, JSON.parse(candidate));
  } finally {
    await new Promise(resolve => setTimeout(resolve, 30));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('write-gate は legacy / v2 の camelCase transitionOut を保存前に拒否する', async () => {
  const root = makeProject({ version: 0 });
  try {
    for (const candidate of [
      { version: 1, cuts: [{ in: 0, out: 1, transitionOut: { type: 'dissolve', duration: 0.5 } }] },
      { version: 2, tracks: [{ items: [{ source: { kind: 'media', transitionOut: {} } }] }] }
    ]) {
      await assert.rejects(
        writeProjectFilesGuarded(root, { 'edit.json': JSON.stringify(candidate) }),
        /Web UI 旧版.*transition_out.*開き直して保存/
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'edit.json'), 'utf8')), { version: 0 });
    }
    assert.doesNotThrow(() => assertNoCamelCaseTransitionOut(JSON.stringify({
      cuts: [{ transition_out: { type: 'reveal-up', duration: 0.5 } }]
    })));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeProjectFilesGuarded は rename 完了直後に onDidWrite を全文つきで呼ぶ', async () => {
  const root = makeProject({ version: 0 });
  try {
    const candidate = JSON.stringify({ version: 0, cuts: [{ in: 5, out: 1 }] });
    const captions = JSON.stringify({ captions: [] });
    const seen = [];
    await writeProjectFilesGuarded(
      root,
      { 'edit.json': candidate, 'captions.json': captions, 'absent.json': null },
      {
        debounceMs: 10,
        // 通知が飛んだ時点で実ファイルが既に新内容へ差し替わっていること（= rename 後）も見る。
        onDidWrite: (filePath, content) => seen.push({
          filePath,
          content,
          onDisk: fs.readFileSync(filePath, 'utf8')
        })
      }
    );
    assert.deepEqual(seen.map(entry => path.basename(entry.filePath)), ['edit.json', 'captions.json']);
    assert.equal(seen[0].content, candidate);
    assert.equal(seen[0].onDisk, candidate);
    assert.equal(seen[1].content, captions);
    assert.equal(seen[1].onDisk, captions);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 30));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('onDidWrite が投げても保存は完了したままになる（fail-open）', async () => {
  const root = makeProject({ version: 0 });
  try {
    const candidate = JSON.stringify({ version: 0, cuts: [{ in: 5, out: 1 }] });
    await writeProjectFilesGuarded(root, { 'edit.json': candidate }, {
      debounceMs: 10,
      onDidWrite: () => { throw new Error('購読側の失敗'); }
    });
    assert.equal(fs.readFileSync(path.join(root, 'edit.json'), 'utf8'), candidate);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 30));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lintProjectCandidates は候補を実ファイルへ書かずメモリ上書きで検証する', async () => {
  const before = { version: 0 };
  const root = makeProject(before);
  try {
    await lintProjectCandidates(root, {
      'edit.json': JSON.stringify({ version: 0, cuts: [{ in: 5, out: 1 }] })
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'edit.json'), 'utf8')), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lintProjectCandidatesOnDisk は入れ子候補と symlink 越しの assets / overlays / captions を検証する', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-store-shadow-lint-'));
  const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'unused', path: 'assets/unused.bin' }],
    tracks: [{ id: 'v1', lane: 'visual', items: [{
      id: 'bag', at: 0, duration: 30,
      source: { kind: 'html', path: 'overlays/bag.html', exclude: ['title'] },
      items: [{
        id: 'title', at: 0, duration: 30,
        keyframes: { path: 'motion/bag.json', count: 2 },
        source: { kind: 'html', path: 'overlays/bag.html', part: 'title' }
      }]
    }, {
      id: 'captions', at: 30, duration: 30,
      source: { kind: 'captions', path: 'captions.json', exclude: ['c-0001'] }, items: []
    }] }, { id: 'v2', lane: 'visual', items: [{
      id: 'duration-base', at: 0, duration: 60, source: { kind: 'filter', filter: { type: 'invert' } }
    }] }]
  };
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.mkdirSync(path.join(root, 'overlays'));
    fs.writeFileSync(path.join(root, 'assets/unused.bin'), 'asset');
    fs.writeFileSync(path.join(root, 'overlays/bag.html'), '<div data-akari-part="title"></div>');
    fs.writeFileSync(path.join(root, 'captions.json'), JSON.stringify([{ id: 'c-0001', start: 0, end: 1, text: 'x', speaker: null, sourceRef: null, edited: false }]));
    fs.writeFileSync(path.join(root, 'edit.json'), JSON.stringify({ ...edit, tracks: [] }));
    const motion = JSON.stringify({ version: 0, group: 'bag', items: { title: [{ t: 0 }, { t: 29 }] } });
    const result = await lintProjectCandidatesOnDisk(root, {
      'edit.json': JSON.stringify(edit),
      'motion/bag.json': motion,
    });
    assert.equal(result.pass, true, JSON.stringify(result.findings, null, 2));
    assert.equal(fs.existsSync(path.join(root, 'motion/bag.json')), false);
    assert.notEqual(fs.readFileSync(path.join(root, 'edit.json'), 'utf8'), JSON.stringify(edit));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeAtomic は tmp + rename で全文を書く', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-store-test-'));
  try {
    const target = path.join(root, 'nested', 'edit.json');
    await writeAtomic(target, '{"version":0}');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"version":0}');
    assert.deepEqual(
      fs.readdirSync(path.dirname(target)).filter(name => name.endsWith('.tmp')), []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('保存後 lint は同一プロジェクトで直列化され、古い fail が新しい pass を上書きしない', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-store-lint-race-'));
  let calls = 0;
  let releaseFirst;
  let notifyFirstStarted;
  const firstStarted = new Promise(resolve => { notifyFirstStarted = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const completions = [];
  const notifications = [];
  const lintRunner = async () => {
    const call = ++calls;
    if (call === 1) {
      notifyFirstStarted();
      await firstGate;
    }
    completions.push(call);
    const result = { pass: call === 2, errors: call === 1 ? ['old fail'] : [], findings: [] };
    fs.mkdirSync(path.join(root, '.akari'), { recursive: true });
    fs.writeFileSync(path.join(root, '.akari', 'lint.json'), JSON.stringify({
      verdict: result.pass ? 'pass' : 'fail', call
    }));
    return result;
  };
  try {
    scheduleProjectLint(root, { debounceMs: 0, lintRunner, onLintResult: result => notifications.push(result) });
    await Promise.race([
      firstStarted,
      wait(100).then(() => { throw new Error('injected first lint did not start'); })
    ]);
    scheduleProjectLint(root, { debounceMs: 0, lintRunner, onLintResult: result => notifications.push(result) });
    await wait(30);
    assert.equal(calls, 1, 'the newer lint must wait for the running older lint');
    releaseFirst();
    for (let attempt = 0; attempt < 50 && notifications.length === 0; attempt++) await wait(10);
    assert.deepEqual(completions, [1, 2]);
    assert.deepEqual(notifications.map(result => result.pass), [true]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, '.akari', 'lint.json'), 'utf8')),
      { verdict: 'pass', call: 2 }
    );
  } finally {
    releaseFirst?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
