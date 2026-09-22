import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { summarizeCommandResult, matchesSeekObservation } from '../evidence/preview-caption-handles-v1/scripts/runner-support.mjs';

const runner = readFileSync(new URL('../evidence/preview-caption-handles-v1/scripts/run-l1.mjs', import.meta.url), 'utf8');

test('command summaries keep the seek acknowledgement and JSON primitives', () => {
  for (const value of ['seeked', true, false, 0, 1.5, null]) {
    assert.equal(summarizeCommandResult(value).result, value);
    assert.doesNotThrow(() => JSON.stringify(summarizeCommandResult(value)));
  }
});

test('command summaries never traverse widget cycles, getters or custom serialization', () => {
  const widget = {};
  widget.self = widget;
  for (const field of ['constructor', 'toJSON']) Object.defineProperty(widget, field, {
    get() { throw new Error(`must not read ${field}`); }
  });
  assert.equal(JSON.stringify(summarizeCommandResult(widget)), '{"result":null,"resultType":"object"}');
  const opaque = new Proxy({}, { get() { throw new Error('must not inspect widget'); } });
  assert.doesNotThrow(() => JSON.stringify(summarizeCommandResult(opaque)));
});

test('command summaries handle non-JSON scalar types without leaking them to CDP', () => {
  for (const value of [undefined, 1n, Symbol('test'), () => {}, NaN, Infinity]) {
    const summary = summarizeCommandResult(value);
    assert.equal(summary.result, null);
    assert.equal(summary.resultType, typeof value);
    assert.doesNotThrow(() => JSON.stringify(summary));
  }
});

const before = { ready: true, engine: 'frame-engine', fps: 30, instance: 'page-1', playback: { sequence: 10 } };
const at = (time, patch = {}) => ({ ...before, playback: { time, sequence: 11, playing: false }, ...patch });
test('seek observations require the exact output frame, not the rounded slider or a nearby frame', () => {
  assert.equal(matchesSeekObservation(at(68 / 30), before, 68 / 30), true);
  for (const time of [2.25, 2.267, 67 / 30, 69 / 30]) {
    assert.equal(matchesSeekObservation(at(time), before, 68 / 30), false);
  }
});

test('seek observations reject stale ticks, replacement contexts and active playback', () => {
  for (const patch of [
    { instance: 'page-2' }, { instance: null }, { ready: false }, { fps: 60 }, { engine: 'legacy' },
    { playback: null }, { playback: { time: 0.5, sequence: 10, playing: false } },
    { playback: { time: 0.5, sequence: 11, playing: true } }
  ]) assert.equal(Boolean(matchesSeekObservation(at(0.5, patch), before, 0.5)), false);
});

test('runner serializes only the command summary and refreshes invalid contexts for observations', () => {
  assert.match(runner, /return \(\$\{summarizeCommandResult\.toString\(\)\}\)\(result\)/u);
  assert.doesNotMatch(runner, /return \{result\};/u);
  assert.match(runner, /Runtime\.executionContextDestroyed/u);
  assert.match(runner, /Runtime\.executionContextsCleared/u);
  assert.match(runner, /if \(!previewContextValid\) await attachPreview\(\)/u);
  assert.match(runner, /matchesSeekObservation\(state, observation\.before, observation\.expectedTime\)/u);
});
