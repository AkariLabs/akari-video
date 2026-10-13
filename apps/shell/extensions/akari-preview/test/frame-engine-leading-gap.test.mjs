import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const start = source.indexOf('            const normalizeSummaryCuts =');
const end = source.indexOf('            let normalizedCuts =', start);
assert.ok(start >= 0 && end > start);
const normalizeSummaryCuts = vm.runInNewContext(`(() => {
  ${source.slice(start, end)}
  return normalizeSummaryCuts;
})()`, { resolveSummaryItemAdjust: item => item });

test('v2 title card leaves the first base visual cut at two seconds', () => {
  const summary = {
    editVersion: 2,
    cuts: [{ id: 'main', src: 'video', in: 0, out: 4, at: 2, renderTrack: 1 }],
    overlays: [{ id: 'title', kind: 'html', at: 0, duration: 2, renderTrack: 2 }],
  };
  const cuts = normalizeSummaryCuts(summary);
  console.log(`v2-title-card: base-at=${String(cuts[0].at)}s track=${String(cuts[0].track)}`);
  assert.equal(cuts[0].at, 2);
  assert.equal(cuts[0].track, 1);
});

test('frozen base cuts keep leading and middle gaps', () => {
  const cuts = normalizeSummaryCuts({ editVersion: 2, cuts: [
    { id: 'leading', src: 'video', in: 0, out: 2, at: 2, renderTrack: 1,
      freeze: { at_sec: 1, duration_sec: 1 } },
    { id: 'adjacent', src: 'video', in: 2, out: 4, at: 5, renderTrack: 1 },
    { id: 'middle', src: 'video', in: 4, out: 5, at: 8, renderTrack: 1,
      freeze: { at_sec: 0.5, duration_sec: 0.5 } },
    { id: 'continuous', src: 'video', in: 5, out: 6, at: 9.5, renderTrack: 1,
      freeze: { at_sec: 0.5, duration_sec: 0.5 } },
  ] });
  console.log(`v2-freeze-gaps: leading=${String(cuts[0].at)}/${String(cuts[0].track)} middle=${String(cuts[2].at)}/${String(cuts[2].track)} continuous=${String(cuts[3].at)}/${String(cuts[3].track)}`);
  assert.equal(cuts[0].at, 2);
  assert.equal(cuts[0].track, 1);
  assert.equal(cuts[1].at, 5);
  assert.equal(cuts[1].track, 1);
  assert.equal(cuts[2].at, 8);
  assert.equal(cuts[2].track, 1);
  assert.equal('at' in cuts[3], false);
  assert.equal('track' in cuts[3], false);
});

test('freeze-free v2 base cuts stay absolute while legacy base cuts stay sequential', () => {
  const cuts = [
    { id: 'first', src: 'video', in: 0, out: 2, at: 0, renderTrack: 1 },
    { id: 'next', src: 'video', in: 2, out: 4, at: 2, renderTrack: 1 },
  ];
  const v2 = normalizeSummaryCuts({ editVersion: 2, cuts });
  const legacy = normalizeSummaryCuts({ editVersion: 1, cuts });
  console.log(`base-placement: v2=${String(v2[0].at)}/${String(v2[0].track)},${String(v2[1].at)}/${String(v2[1].track)} legacy=${String(legacy[0].at)}/${String(legacy[0].track)},${String(legacy[1].at)}/${String(legacy[1].track)}`);
  assert.deepEqual(Array.from(v2, cut => [cut.at, cut.track]), [[0, 1], [2, 1]]);
  for (const cut of legacy) {
    assert.equal('at' in cut, false);
    assert.equal('track' in cut, false);
  }
});
