import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { markPreexistingLintFindings, writeProjectFilesGuarded } from '../lib/write-gate.js';

// 既存字幕のカット切れ（文字を置く前から有った指摘）。字幕の挿入で配列の番号が [3] → [4] にずれる。
const cutVisibility = (index) => ({
  id: 'F007', severity: 'error', check: 'captions.cut-visibility',
  message: 'less than 50% of the caption remains after cuts',
  path: `captions.json#[${index}]`, range: { start: 5.1, end: 6.36 }
});

test('保存前から有った指摘は、字幕の挿入で番号がずれても preexisting になる', () => {
  const fresh = { severity: 'error', check: 'captions.overlap', message: 'caption overlaps c-0001', path: 'captions.json#[0]', range: { start: 1, end: 2 } };
  const result = markPreexistingLintFindings(
    { pass: false, errors: [], findings: [cutVisibility(4), fresh] },
    [cutVisibility(3)]
  );
  assert.equal(result.findings[0].preexisting, true);
  assert.equal(result.findings[1].preexisting, undefined);
});

test('同じ指摘が増えたときは、増えたぶんだけ今回の保存の指摘として残す', () => {
  const result = markPreexistingLintFindings(
    { pass: false, errors: [], findings: [cutVisibility(3), cutVisibility(3)] },
    [cutVisibility(3)]
  );
  assert.deepEqual(result.findings.map(finding => finding.preexisting === true), [true, false]);
});

test('基準が無いときは従来どおり全部を今回の保存の指摘として返す', () => {
  const input = { pass: false, errors: [], findings: [cutVisibility(3)] };
  assert.equal(markPreexistingLintFindings(input, undefined), input);
});

test('初回の保存は .akari/lint.json を基準にし、以降は直前の保存後 lint を基準にする', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-lint-preexisting-'));
  try {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'lint.json'), JSON.stringify({ verdict: 'fail', findings: [cutVisibility(3)] }));
    const lintRuns = [
      { pass: false, errors: [], findings: [cutVisibility(4)] },
      { pass: false, errors: [], findings: [cutVisibility(4), { severity: 'error', check: 'captions.overlap', message: 'x', path: 'captions.json#[1]' }] }
    ];
    const results = [];
    for (const run of lintRuns) {
      await new Promise(resolve => {
        void writeProjectFilesGuarded(root, { 'captions.json': '{"captions":[]}' }, {
          debounceMs: 1,
          lintRunner: async () => run,
          onLintResult: result => { results.push(result); resolve(); }
        });
      });
    }
    assert.equal(results[0].findings[0].preexisting, true);
    assert.equal(results[1].findings[0].preexisting, true);
    assert.equal(results[1].findings[1].preexisting, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
