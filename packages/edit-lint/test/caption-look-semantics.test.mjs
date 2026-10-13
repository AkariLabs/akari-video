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
});
