import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  lintProjectCandidates,
  writeProjectFilesGuarded,
  writeAtomic,
  findEditLintBinPath
} from '../lib/write-gate.js';

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
