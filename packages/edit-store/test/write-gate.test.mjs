import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  lintProjectCandidates,
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
