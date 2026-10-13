import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptions } from '../src/lint/captions.mjs';

test('v2 の tracks だけを持つ入力では字幕の時刻写像を推測しない', () => {
  const findings = [];
  const caption = { id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫',
    speaker: null, sourceRef: null, edited: false, runs: [{ id: 'r-0001',
      from: 0, to: 1, fire: 'spoken', anchor: { src: 's1', start: 0, end: 1, domain: 'source' } }] };
  validateCaptions([caption], { version: 2, tracks: [{ id: 'v1', lane: 'video', items: [] }],
    sources: [{ id: 's1' }] }, null, findings,
  { projectRoot: process.cwd(), captionsPath: 'captions.json' }, 2, new Set());
  assert.equal(findings.some(item => item.check === 'captions.run.anchor-cut'), false);
});

test('edit-lint は共有の字幕意味検証から範囲外と spoken の error を受け取る', () => {
  const findings = [];
  const caption = { id: 'c-0001', start: 0, end: 2, text: '猫', speaker: null,
    sourceRef: null, edited: false, runs: [{ id: 'r-0001', from: 0, to: 2, fire: 'spoken' }] };
  validateCaptions([caption], { cuts: [], sources: [] }, null, findings,
    { projectRoot: process.cwd(), captionsPath: 'captions.json' }, 0, new Set());
  assert.ok(findings.some(item => item.check === 'captions.run.range' && item.severity === 'error'));
  assert.ok(findings.some(item => item.check === 'captions.run.anchor' && item.severity === 'error'));
  assert.equal(findings.filter(item => item.check === 'captions.run-range').length, 0);
});

test('旧 runs v0 の空・範囲外は従来の warning だけにする', () => {
  const findings = [];
  const caption = { id: 'c-0001', start: 0, end: 2, text: '猫', speaker: null,
    sourceRef: null, edited: false, runs: [{ from: 0, to: 0, style: { color: '#f00' } },
      { from: 0, to: 2, animation: { in: { id: 'pop' } } }] };
  validateCaptions([caption], { cuts: [], sources: [] }, null, findings,
    { projectRoot: process.cwd(), captionsPath: 'captions.json' }, 0, new Set());
  assert.equal(findings.filter(item => item.check === 'captions.run-range' && item.severity === 'warning').length, 2);
  assert.equal(findings.filter(item => item.check === 'captions.run.range').length, 0);
});

test('壊れた null ルートと null 行・run は構造の診断になり例外を出さない', () => {
  const paths = { projectRoot: process.cwd(), captionsPath: 'captions.json' };
  for (const input of [null, { captions: null }, [null], [{ id: 'c-0001',
    start: 0, end: 2, text: '猫', speaker: null, sourceRef: null, edited: false, runs: [null] }]]) {
    const findings = [];
    assert.doesNotThrow(() => validateCaptions(input, { cuts: [], sources: [] }, null,
      findings, paths, 0, new Set()));
    assert.ok(findings.some(item => item.check === 'captions.schema'));
  }
});
