import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { computeCutTrackSegments } from '../src/lint/cuts-tracks.mjs';
import { validateTransitionAdjacency } from '../src/lint/v2-projection.mjs';

const cases = JSON.parse(readFileSync(new URL('../../edit-store/test/transition-plan-cases.json', import.meta.url), 'utf8')).hold;

function findingsFor(cuts, fps) {
  const findings = [];
  const sources = [...new Set(cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` }));
  validateTransitionAdjacency(cuts, computeCutTrackSegments(cuts), sources, fps, findings);
  return findings;
}

for (const entry of cases) {
  test(`filled boundary reports only a new incoming held head: ${entry.name}`, () => {
    const cuts = entry.cuts.map(cut => ({ ...cut, transition_out: cut.transitionOut }));
    const freeze = findingsFor(cuts, entry.fps)
      .filter(finding => finding.check === 'cuts.transition-out.freeze');
    const expected = entry.expected.freezeIn.filter(seconds => seconds > 0);
    assert.equal(freeze.length, expected.length);
    if (entry === cases[0]) {
      assert.equal(findingsFor(cuts, entry.fps).filter(finding =>
        finding.check === 'cuts.transition-out.shortened'
          || finding.check === 'cuts.transition-out.zero-overlap').length, 0);
    }
    freeze.forEach((finding, index) => {
      assert.equal(finding.severity, 'info');
      assert.match(finding.message, new RegExp(String(expected[index]).replace('.', '\\.')));
      assert.match(finding.path, /^edit\.json#cuts\[\d+\]\.transition_out$/u);
      assert.ok(finding.range.end > finding.range.start);
    });
    const plain = cuts.map(cut => ({ ...cut,
      ...(cut.transition_out ? { transition_out: { ...cut.transition_out, fill: undefined } } : {}) }));
    assert.equal(findingsFor(plain, entry.fps)
      .filter(finding => finding.check === 'cuts.transition-out.freeze').length, 0);
  });
}

test('the held seconds are reported without floating point noise', () => {
  // 0.25 s of the window falls before the cut and the head has 0.2 s: 0.25 - 0.2 is 0.04999999999999999.
  const cuts = [
    { at: 0, in: 8.2, out: 9.7, src: 'a', transition_out: { type: 'dissolve', duration: 0.5, fill: 'freeze' } },
    { at: 1.5, in: 0.2, out: 1.7, src: 'b' },
  ];
  const [finding] = findingsFor(cuts, 30).filter(entry => entry.check === 'cuts.transition-out.freeze');
  assert.ok(finding);
  assert.match(finding.message, /0\.05/u);
  assert.doesNotMatch(finding.message, /0\.049/u);
});
