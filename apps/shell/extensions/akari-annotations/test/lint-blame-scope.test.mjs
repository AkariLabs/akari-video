import assert from 'node:assert/strict';
import test from 'node:test';

import { lintFindingKey, splitLintBlame } from '../lib/common/lint-blame-scope.js';

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

test('別字幕の保存では既存 error をチップ側に回し、新しい error だけを自分の編集に帰属する', () => {
  const before = JSON.stringify([{ id: 'c-0004' }, { id: 'c-0002' }]);
  const after = JSON.stringify([{ id: 'c-0004' }, { id: 'c-0002' }]);
  const existing = { severity: 'error', check: 'captions.cut-visibility', path: 'captions.json#[0]' };
  const added = { severity: 'error', check: 'captions.overlap', path: 'captions.json#[1]' };
  assert.deepEqual(splitLintBlame([existing, added], ['captions.json'],
    [lintFindingKey(existing, before)], [lintFindingKey(existing, after), lintFindingKey(added, after)]), {
    own: [added], foreign: [existing]
  });
});

test('字幕の追加・削除で添字が動いても同じ id の既存 error は foreign に残る', () => {
  const existing = { severity: 'error', check: 'captions.cut-visibility', path: 'captions.json#[1]' };
  const shifted = { ...existing, path: 'captions.json#[2]' };
  const before = JSON.stringify([{ id: 'first' }, { id: 'c-0004' }]);
  const after = JSON.stringify([{ id: 'new' }, { id: 'first' }, { id: 'c-0004' }]);
  assert.deepEqual(splitLintBlame([shifted], ['captions.json'],
    [lintFindingKey(existing, before)], [lintFindingKey(shifted, after)]), {
    own: [], foreign: [shifted]
  });
  const deleted = { ...existing, path: 'captions.json#[0]' };
  assert.equal(lintFindingKey(existing, before), lintFindingKey(deleted, JSON.stringify([{ id: 'c-0004' }])));
});

test('字幕 id が無い場合は check と path で照合する', () => {
  const finding = { severity: 'error', check: 'captions.schema', path: 'captions.json#[0]' };
  assert.equal(lintFindingKey(finding, '[]'), 'captions.schema\u0000captions.json#[0]');
  assert.deepEqual(splitLintBlame([finding], ['captions.json'], [lintFindingKey(finding, '[]')],
    [lintFindingKey(finding, '[]')]), { own: [], foreign: [finding] });
});
test('書いたファイル内でも、保存前から有った指摘は今回の保存に帰属しない', () => {
  const preexisting = { severity: 'error', check: 'captions.cut-visibility', path: 'captions.json#[4]', preexisting: true };
  const fresh = { severity: 'error', check: 'captions.overlap', path: 'captions.json#[0]' };
  assert.deepEqual(splitLintBlame([preexisting, fresh], ['captions.json']), {
    own: [fresh],
    foreign: [preexisting]
  });
});
