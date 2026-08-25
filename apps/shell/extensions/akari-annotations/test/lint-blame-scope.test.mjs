import assert from 'node:assert/strict';
import test from 'node:test';

import { splitLintBlame } from '../lib/common/lint-blame-scope.js';

test('edit.json の anchor は edit.json の保存に帰属する', () => {
  const finding = { severity: 'error', check: 'cuts.example', path: 'edit.json#cuts' };
  assert.deepEqual(splitLintBlame([finding], ['edit.json']), {
    own: [finding],
    foreign: []
  });
});

test('intake.json の anchor は edit.json の保存に帰属しない', () => {
  const finding = {
    severity: 'error',
    check: 'intake.target-exclusive',
    path: '.akari/intake.json#target'
  };
  assert.deepEqual(splitLintBlame([finding], ['edit.json']), {
    own: [],
    foreign: [finding]
  });
});

test('複数ファイル保存では captions.json の anchor も帰属する', () => {
  const finding = { severity: 'error', check: 'captions.example', path: 'captions.json#0' };
  assert.deepEqual(splitLintBlame([finding], ['edit.json', 'captions.json']), {
    own: [finding],
    foreign: []
  });
});

test('severity と # の有無はファイル帰属に影響しない', () => {
  const finding = { severity: 'warning', check: 'cuts.example', path: 'edit.json' };
  assert.deepEqual(splitLintBlame([finding], ['edit.json']), {
    own: [finding],
    foreign: []
  });
});

test('path が無い finding は安全側で保存に帰属する', () => {
  const finding = { severity: 'error', check: 'edit-lint' };
  assert.deepEqual(splitLintBlame([finding], ['edit.json']), {
    own: [finding],
    foreign: []
  });
});

test('writtenFiles が空なら path ありは全て foreign、path なしは own になる', () => {
  const editFinding = { severity: 'warning', path: 'edit.json#cuts' };
  const captionsFinding = { severity: 'error', path: 'captions.json#0' };
  const pathlessFinding = { severity: 'error' };
  assert.deepEqual(splitLintBlame([editFinding, captionsFinding, pathlessFinding], []), {
    own: [pathlessFinding],
    foreign: [editFinding, captionsFinding]
  });
});

test('既存 intake 指摘だけの実機再現ケースは own 0 件、foreign 2 件になる', () => {
  const findings = [
    {
      severity: 'error',
      check: 'intake.target-exclusive',
      message: 'target.duration_s and target.keep_length: true must not both be set',
      path: '.akari/intake.json#target'
    },
    {
      severity: 'error',
      check: 'intake.tasks',
      message: 'unknown task id',
      path: '.akari/intake.json#tasks'
    }
  ];
  const result = splitLintBlame(findings, ['edit.json']);
  assert.equal(result.own.length, 0);
  assert.deepEqual(result.foreign, findings);
});
