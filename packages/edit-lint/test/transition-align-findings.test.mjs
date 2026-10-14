import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInternalEdit } from '../../edit-store/lib/index.js';
import { lintProject } from '../src/edit-lint.mjs';

import { validateCuts, computeCutTrackSegments } from '../src/lint/cuts-tracks.mjs';
import { validateTransitionAdjacency } from '../src/lint/v2-projection.mjs';

const sourceIds = new Set(['a', 'b', 'c']);
const sources = [...sourceIds].map(id => ({ id, path: `${id}.mp4` }));

test('unknown placement and fill are reported once per boundary; the shortened window includes its cause', () => {
  const cuts = [
    { src: 'a', at: 0, in: 0, out: 2, transition_out: { type: 'dissolve', duration: 1, align: 'sideways', fill: 'repeat' } },
    { src: 'b', at: 2, in: 0.1, out: 2.1, transition_out: { type: 'dissolve', duration: 1, align: 'sideways', fill: 'repeat' } },
    { src: 'c', at: 4, in: 1, out: 3 }
  ];
  const findings = [];
  validateCuts(cuts, findings, {}, sourceIds);
  validateTransitionAdjacency(cuts, computeCutTrackSegments(cuts), sources, 30, findings);
  const named = check => findings.filter(finding => finding.check === check);
  assert.deepEqual(named('cuts.transition-out.unknown-align').map(finding => finding.path),
    ['edit.json#cuts[0].transition_out.align', 'edit.json#cuts[1].transition_out.align']);
  assert.deepEqual(named('cuts.transition-out.unknown-fill').map(finding => finding.path),
    ['edit.json#cuts[0].transition_out.fill', 'edit.json#cuts[1].transition_out.fill']);
  assert.equal(named('cuts.transition-out.shortened').length, 1);
  assert.equal(named('cuts.transition-out.unknown-align')[0].severity, 'warning');
  assert.equal(named('cuts.transition-out.unknown-fill')[0].severity, 'warning');
  assert.equal(named('cuts.transition-out.shortened')[0].severity, 'info');
  assert.match(named('cuts.transition-out.unknown-align')[0].message, /sideways/u);
  assert.match(named('cuts.transition-out.unknown-fill')[0].message, /repeat/u);
  assert.match(named('cuts.transition-out.shortened')[0].message, /0\.2/u);
  assert.match(named('cuts.transition-out.shortened')[0].message, /素材の余りが足りない/u);
});

test('non-string placement and fill labels produce one warning without throwing', () => {
  for (const field of ['align', 'fill']) {
    for (const value of [{ toString: null }, 42, null, ['future'],
      { toJSON() { assert.fail('external method was called'); } }]) {
      const cuts = [{ at: 0, in: 0, out: 2, transition_out: {
        type: 'dissolve', duration: 1, [field]: value
      } }, { at: 2, in: 1, out: 3 }];
      const findings = [];
      assert.doesNotThrow(() => validateCuts(cuts, findings, {}, sourceIds));
      assert.equal(findings.filter(finding => finding.check === `cuts.transition-out.unknown-${field}`).length, 1);
    }
  }
});

test('v2 document reports unknown hints and renders the centered unfilled projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-transition-align-'));
  try {
    const edit = {
      version: 2, output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
      tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 2, out: 6,
          transition_out: { type: 'dissolve', duration: 1, align: 'sideways', fill: 'repeat' } } },
        { id: 'b', at: 120, duration: 120, source: { kind: 'media', src: 'b', in: 2, out: 6 } }
      ] }]
    };
    await writeFile(join(root, 'a.mp4'), 'fixture');
    await writeFile(join(root, 'b.mp4'), 'fixture');
    await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit)}\n`);
    const findings = (await lintProject(root, { writeReports: false })).findings;
    for (const field of ['align', 'fill']) {
      const named = findings.filter(finding => finding.check === `cuts.transition-out.unknown-${field}`);
      assert.equal(named.length, 1, JSON.stringify(findings));
      assert.equal(named[0].severity, 'warning');
      assert.equal(named[0].path, `edit.json#cuts[0].transition_out.${field}`);
    }
    assert.equal(findings.filter(finding => finding.severity === 'error').length, 0, JSON.stringify(findings));
    const [a, b] = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
    // Center: C = 4, so the one-second window is [3.5, 4.5].
    assert.deepEqual([a.out, b.at, b.in], [6.5, 3.5, 1.5]);
    assert.equal('align' in a.transition_out, false);
    assert.equal('fill' in a.transition_out, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [incomingIn, expected] of [[0, ['cuts.transition-out.zero-overlap']], [1, []]]) {
  test(`an outgoing freeze with incoming head ${incomingIn} keeps adjacency findings`, () => {
    const cuts = [
      { src: 'a', at: 0, in: 0, out: 2, freeze: { at_sec: 1, duration_sec: 1 },
        transition_out: { type: 'dissolve', duration: 1 } },
      { src: 'b', at: 3, in: incomingIn, out: incomingIn + 2 }
    ];
    const findings = [];
    validateTransitionAdjacency(cuts, computeCutTrackSegments(cuts), sources, 30, findings);
    // A ends at 2 + 1 = 3; B starts at 3, with room either 0 or 1.
    assert.deepEqual(findings.filter(finding => /zero-overlap|shortened/u.test(finding.check))
      .map(finding => finding.check), expected);
  });
}

test('unusable boundary keeps the zero-overlap warning', () => {
  const cuts = [
    { src: 'a', at: 0, in: 0, out: 2, transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'b', at: 2, in: 0, out: 2 }
  ];
  const findings = [];
  validateTransitionAdjacency(cuts, computeCutTrackSegments(cuts), sources, 30, findings);
  assert.deepEqual(findings.map(finding => [finding.check, finding.severity]),
    [['cuts.transition-out.zero-overlap', 'warning']]);
});
