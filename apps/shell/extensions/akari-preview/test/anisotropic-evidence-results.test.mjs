import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { encodeRgbaPng } from '../../../../../packages/osr-export/src/png.mjs';
import { recomputeComparisons } from '../evidence/transform-anisotropic-scale-v1/compare-results.mjs';
import { mergeReports } from '../evidence/transform-anisotropic-scale-v1/merge-results.mjs';

const run = promisify(execFile);

test('comparison gates only geometry, records legacy MAD baseline and diagnoses excess MAD', async () => {
  const out = await mkdtemp(join(tmpdir(), 'axis-comparison-'));
  try {
    const report = { frames: [0], checks: [{ name: 'fixture', pass: true }], surfaces: [] };
    for (const fixture of ['legacy', 'scale-x', 'scale-y']) for (const surface of ['web', 'gpu', 'osr']) {
      const pixels = Buffer.alloc(8 * 8 * 4);
      const offset = fixture === 'scale-y' && surface === 'gpu' ? 2 : 0;
      const red = surface === 'web' ? 36 : fixture === 'scale-x' ? 60 : 42;
      for (let y = 2; y < 5; y++) for (let x = 2 + offset; x < 5 + offset; x++) {
        pixels.set([red, 200, 138, 255], (y * 8 + x) * 4);
      }
      const path = join(out, `${fixture}-${surface}.png`);
      await writeFile(path, encodeRgbaPng(pixels, 8, 8));
      report.surfaces.push({ fixture, surface, status: 'passed', outputs: [{ frameNumber: 0, path }] });
    }
    await recomputeComparisons(report, out);
    assert.match(report.passScope, /selected captures/u);
    assert.equal(report.madBaselines.gpu.mad, 2);
    const bright = report.comparisons.find(value => value.fixture === 'scale-x' && value.surface === 'gpu');
    assert.equal(bright.mad, 8);
    assert.equal(bright.pass, true);
    assert.equal(bright.madWithinBaseline, false);
    const baseline = report.comparisons.find(value => value.fixture === 'legacy' && value.surface === 'osr');
    assert.equal(baseline.pass, true); assert.equal(baseline.madWithinBaseline, true);
    assert.equal(report.comparisons.find(value => value.fixture === 'scale-y' && value.surface === 'gpu').pass, false);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('merging is per fixture/surface and a newer blocked attempt replaces a prior success', () => {
  const documents = [
    { path: 'results.json', data: { measuredAt: '2026-01-01', checks: [{ pass: true }], surfaces: [
      { fixture: 'legacy', surface: 'web', status: 'passed' }, { fixture: 'legacy', surface: 'gpu', status: 'passed' },
    ] } },
    { path: 'results-gpu-legacy.json', data: { measuredAt: '2026-01-02', surfaces: [
      { fixture: 'legacy', surface: 'gpu', status: 'blocked' },
    ] } },
  ];
  const result = mergeReports(documents);
  assert.equal(result.surfaces.length, 2);
  assert.equal(result.surfaces.find(value => value.surface === 'gpu').status, 'blocked');
  assert.equal(result.surfaces.find(value => value.surface === 'web').status, 'passed');
  assert.deepEqual(result.comparisons, []);
  assert.deepEqual(mergeReports([{ path: 'results.json', data: result }]).surfaces.map(({ surface, status }) => ({ surface, status })),
    result.surfaces.map(({ surface, status }) => ({ surface, status })));
});

test('missing captures are blocked and missing legacy baseline stays explicitly null', async () => {
  const result = { checks: [{ pass: true }], frames: [0], surfaces: [] };
  await recomputeComparisons(result, tmpdir(), { requireComplete: true });
  assert.match(result.passScope, /all six fixtures/u);
  assert.equal(result.pass, false);
  assert.equal(result.missingSurfaces.length, 18);
  assert.ok(result.comparisons.every(value => value.pass === false && value.madWithinBaseline === null));
});

test('merge CLI writes complete results and fails closed on a newer blocked capture', async () => {
  const out = await mkdtemp(join(tmpdir(), 'axis-merge-'));
  try {
    const pixels = Buffer.alloc(8 * 8 * 4);
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) pixels.set([36, 200, 138, 255], (y * 8 + x) * 4);
    const png = join(out, 'green.png');
    await writeFile(png, encodeRgbaPng(pixels, 8, 8));
    const fixtures = ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'keyframes', 'legacy'];
    const frames = [0, 15, 30, 45, 59];
    const surfaces = fixtures.flatMap(fixture => ['web', 'gpu', 'osr'].map(surface => ({ fixture, surface,
      status: 'passed', outputs: frames.map(frameNumber => ({ frameNumber, path: png })) })));
    await writeFile(join(out, 'results.json'), JSON.stringify({ measuredAt: '2026-09-22T00:00:00Z',
      frames, checks: [{ pass: true }], surfaces }));
    const command = new URL('../evidence/transform-anisotropic-scale-v1/merge-results.mjs', import.meta.url).pathname;
    await run(process.execPath, [command, out], { timeout: 120000 });
    let merged = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
    assert.equal(merged.pass, true);
    assert.match(merged.passScope, /all six fixtures/u);
    assert.equal(merged.comparisons.length, 60);
    assert.equal(merged.madBaselines.gpu.mad, 0);
    assert.ok(merged.comparisons.every(value => value.pass && value.madWithinBaseline));

    await writeFile(join(out, 'results-gpu-scale-x.json'), JSON.stringify({ measuredAt: '2026-09-23T00:00:00Z',
      surfaces: [{ ...surfaces.find(value => value.fixture === 'scale-x' && value.surface === 'gpu'), status: 'blocked' }] }));
    await assert.rejects(run(process.execPath, [command, out], { timeout: 120000 }), { code: 1 });
    merged = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
    assert.equal(merged.pass, false);
    assert.equal(merged.surfaces.find(value => value.fixture === 'scale-x' && value.surface === 'gpu').status, 'blocked');
    assert.equal(merged.missingSurfaces.length, 0);
  } finally { await rm(out, { recursive: true, force: true }); }
});
