import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { computeCutTrackSegments, readInternalEdit } from '../lib/index.js';

const cases = JSON.parse(readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8')).hold;
const root = new URL('../../../', import.meta.url);

function extract(path, start, end, prelude, typescript = false) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, path);
  const body = source.slice(first, end === '\n  }\n' ? last + end.length : last);
  const code = typescript ? transformSync(body, { loader: 'ts', format: 'esm' }).code : body;
  return vm.runInNewContext(`${prelude}\n${code}\nnormalizedCuts`, {});
}

const gpu = extract('packages/gpu-export/src/page-runtime.js', '  function normalizedCuts(', '\n  }\n',
  'const resolvedItemAdjust = item => item;');
const osr = extract('packages/osr-export/src/page-runtime.js', '  function normalizedCuts(', '\n  }\n',
  'const resolvedItemAdjust = item => item;');
const server = extract('packages/preview-server/src/frame-engine-client.ts', 'function normalizedCuts(',
  'function resolvedEngineLayers(', 'const resolvedItemAdjust = item => item;', true);
const bootstrapSource = readFileSync(new URL('apps/shell/extensions/akari-preview/src/browser/preview-script-frame-engine-bootstrap.ts', root), 'utf8');
const bootstrapStart = bootstrapSource.indexOf('const normalizeSummaryCuts = value => {');
const bootstrapEnd = bootstrapSource.indexOf('const audioComparableCuts =', bootstrapStart);
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart);
const shell = vm.runInNewContext(`const resolveSummaryItemAdjust = item => item;\n${bootstrapSource.slice(bootstrapStart, bootstrapEnd)}\nnormalizeSummaryCuts`);

const implementations = [
  ['gpu', cuts => gpu({ cuts })],
  ['osr', cuts => osr({ cuts })],
  ['server', cuts => server({ cuts })],
  ['shell v2', cuts => shell({ editVersion: 2, cuts: cuts.map(cut => ({ ...cut, renderTrack: 0 })) })],
  ['shell v1', cuts => shell({ editVersion: 1, cuts: cuts.map(cut => ({ ...cut, renderTrack: 0 })) })],
];
const near = (actual, expected, label, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} != ${expected}`);

function projectedCuts(entry, fill) {
  const frames = seconds => Math.round(seconds * entry.fps);
  const document = {
    version: 2, output: { width: 320, height: 180, fps: entry.fps },
    sources: [...new Set(entry.cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => ({
      id: `c${index + 1}`, at: frames(cut.at),
      duration: frames((cut.out - cut.in) / (cut.speed ?? 1) + (cut.freeze?.duration_sec ?? 0)),
      source: { kind: 'media', src: cut.src, in: cut.in, out: cut.out,
        ...(cut.speed ? { speed: cut.speed } : {}),
        ...(cut.freeze ? { freeze: cut.freeze } : {}),
        ...(cut.transitionOut ? { transition_out: fill ? cut.transitionOut
          : { ...cut.transitionOut, fill: undefined } } : {}) }
    })) }]
  };
  return readInternalEdit(document).tracks[0].items.map(item => item.declaration);
}

function projected(entry) {
  return entry.expected.projected.map((expected, index) => ({
    id: `c${index}`, src: entry.cuts[index].src, track: 0, at: expected.at,
    in: expected.in, out: expected.out,
    ...(entry.cuts[index].speed ? { speed: entry.cuts[index].speed } : {}),
    ...(entry.cuts[index].freeze ? { freeze: entry.cuts[index].freeze } : {}),
    ...(expected.transitionSeconds ? { transition_out: { type: 'dissolve', duration: expected.transitionSeconds } } : {}),
    ...(expected.hold ? { transitionHold: { headSeconds: expected.hold } } : {}),
  }));
}

for (const [name, normalize] of implementations) {
  test(`${name} keeps raw positions and duration when fill is toggled`, () => {
    for (const entry of cases) {
      for (const fill of [true, false]) {
        const cuts = projectedCuts(entry, fill);
        const segments = computeCutTrackSegments(normalize(cuts).map(cut => ({
          ...cut, transitionOut: cut.transition_out,
        })));
        near(segments[1].at, fill ? entry.expected.projected[1].at : cuts[1].at,
          `${entry.name} ${fill} incoming at`);
        for (let index = 1; index < cuts.length; index += 1) {
          const raw = entry.cuts[index];
          // Without fill, the projected extension of this cut's own filled boundary may differ.
          if (!fill && raw.transitionOut?.fill) continue;
          const freeze = raw.freeze?.duration_sec ?? 0;
          const rawEnd = raw.at + (raw.out - raw.in) / (raw.speed ?? 1) + freeze;
          const extension = raw.transitionOut
            ? (entry.expected.projected[index].out - raw.out) / (raw.speed ?? 1) : 0;
          const expectedEnd = rawEnd + extension;
          // This segment API excludes an existing freeze from end; the displayed end includes it.
          near(segments[index].end + freeze, expectedEnd, `${entry.name} ${fill} end ${index}`);
          if (freeze === 0) near(segments[index].end, expectedEnd, `${entry.name} ${fill} segment end ${index}`);
        }
        const last = cuts.length - 1;
        near(segments[last].end + (entry.cuts[last].freeze?.duration_sec ?? 0),
          entry.expected.totalSeconds, `${entry.name} ${fill} total`);
      }
    }
  });

  test(`${name} preserves projected held placements in all seven cases`, () => {
    for (const entry of cases) {
      const cuts = projected(entry);
      const actual = normalize(cuts);
      for (let index = 0; index < cuts.length; index += 1) {
        if (!cuts[index].transitionHold) continue;
        assert.equal(actual[index].at, entry.expected.projected[index].at, entry.name);
        assert.equal(actual[index].transitionHold.headSeconds, entry.expected.projected[index].hold, entry.name);
      }
    }
  });

  test(`${name} preserves a sub-microsecond held placement`, () => {
    const cuts = [
      { id: 'a', src: 'a', track: 0, at: 0, in: 0, out: 5,
        transition_out: { type: 'dissolve', duration: 1 } },
      { id: 'b', src: 'b', track: 0, at: 4 + 1e-7, in: 0, out: 5,
        transitionHold: { headSeconds: 1e-7 } },
      { id: 'c', src: 'c', track: 0, at: 9 + 1e-7, in: 0, out: 2 },
    ];
    const actual = normalize(cuts);
    assert.equal(actual[1].at, 4 + 1e-7);
    assert.equal(actual[1].transitionHold.headSeconds, 1e-7);
    const segments = computeCutTrackSegments(actual);
    for (const index of [1, 2]) {
      near(segments[index].at, cuts[index].at, `${name} at ${index}`, 1e-12);
      near(segments[index].end, cuts[index].at + cuts[index].out - cuts[index].in,
        `${name} end ${index}`, 1e-12);
    }
    const plain = normalize(cuts.map(cut => {
      const { transitionHold: _hold, ...withoutHold } = cut;
      return withoutHold;
    }));
    assert.equal(Object.prototype.hasOwnProperty.call(plain[1], 'at'), name === 'shell v2');
    assert.equal(Object.prototype.hasOwnProperty.call(plain[1], 'transitionHold'), false);
  });
}

test('server keeps a held placement on its lowest declared visual track', () => {
  const cuts = projected(cases[0]).map(cut => ({ ...cut, track: 1 }));
  const actual = server({ cuts });
  assert.equal(actual[1].at, cases[0].expected.projected[1].at);
  assert.equal(actual[1].transitionHold.headSeconds, cases[0].expected.projected[1].hold);
});
