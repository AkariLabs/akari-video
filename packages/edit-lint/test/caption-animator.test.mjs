import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';

const animator = (id = 'a', basis = 'chars') => ({ id, basis, shape: 'ramp', start: 0, end: 1, offset: 0, amount: { y: 24 } });
const item = (extra = {}) => ({ id: 'cue', at: 0, duration: 30, source: { kind: 'caption', path: 'captions.json', id: 'c1' }, ...extra });
const itemPath = 'edit.json#tracks[0].items[0]';
async function findingsFor(items, bags = {}) {
  const root = await mkdtemp(join(tmpdir(), 'akari-animator-lint-'));
  try {
    await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2,
      output: { width: 640, height: 360, fps: 30 }, sources: [{ id: 's', path: 'assets/source.mp4' }],
      tracks: [{ id: 'v', lane: 'visual', items }],
    }));
    await writeFile(join(root, 'captions.json'), JSON.stringify([{ id: 'c1', start: 0, end: 1, text: 'caption' }]));
    await mkdir(join(root, 'motion'));
    for (const [name, bag] of Object.entries(bags)) await writeFile(join(root, 'motion', name), JSON.stringify(bag));
    const result = await lintProject(root, { writeReports: false });
    return result.findings.filter(finding => finding.check.startsWith('animator.'))
      .map(({ check, severity, path }) => ({ check, severity, path }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('media and filter animator declarations warn at their item path', async () => {
  for (const source of [{ kind: 'media', src: 's', in: 0, out: 30 }, { kind: 'filter', filter: { type: 'invert' } }]) {
    assert.deepEqual(await findingsFor([item({ source, animator: [animator()] })]), [
      { check: 'animator.non-text-target', severity: 'warning', path: `${itemPath}.animator` },
    ]);
  }
});
test('unknown animator references are errors even without declarations', async () => {
  assert.deepEqual(await findingsFor([item({ keyframes: [{ t: 0, animator: { missing: { offset: 0 } } }, { t: 30 }] })]), [
    { check: 'animator.unknown-ref', severity: 'error', path: `${itemPath}.keyframes[0].animator["missing"]` },
  ]);
});
test('duplicate ids are errors at each later declaration', async () => {
  assert.deepEqual(await findingsFor([item({ animator: [animator(), animator(), animator()] })]), [
    { check: 'animator.duplicate-id', severity: 'error', path: `${itemPath}.animator[1].id` },
    { check: 'animator.duplicate-id', severity: 'error', path: `${itemPath}.animator[2].id` },
  ]);
});
test('segments fallback warns on nested item basis', async () => {
  assert.deepEqual(await findingsFor([item({ source: { kind: 'group' }, items: [item({ id: 'child', animator: [animator('a', 'segments')] })] })]), [
    { check: 'animator.segments-fallback', severity: 'warning', path: `${itemPath}.items[0].animator[0].basis` },
  ]);
});
test('declared caption and group references pass with ids scoped to each item', async () => {
  const keyframes = [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } }];
  assert.deepEqual(await findingsFor([item({ animator: [animator()], keyframes, source: { kind: 'group' },
    items: [item({ id: 'child', animator: [animator()], keyframes })] })]), []);
});
test('parent animator ids cannot satisfy child references', async () => {
  assert.deepEqual(await findingsFor([item({ source: { kind: 'group' }, animator: [animator()],
    items: [item({ id: 'child', keyframes: [{ t: 0, animator: { a: { start: 0 } } }, { t: 15 }] })] })]), [
    { check: 'animator.unknown-ref', severity: 'error', path: `${itemPath}.items[0].keyframes[0].animator["a"]` },
  ]);
});
test('motion bag animator refs are checked against the owning item', async () => {
  const bag = { version: 0, group: 'cue', items: { cue: [{ t: 0, animator: { missing: { offset: 0 } } }, { t: 15 }] } };
  assert.deepEqual(await findingsFor([item({ animator: [animator()], keyframes: { path: 'motion/cue.json', count: 2 } })], { 'cue.json': bag }), [
    { check: 'animator.unknown-ref', severity: 'error', path: `${itemPath}.keyframes[0].animator["missing"]` },
  ]);
  bag.items.cue[0].animator = { a: { offset: 0 } };
  assert.deepEqual(await findingsFor([item({ animator: [animator()], keyframes: { path: 'motion/cue.json', count: 2 } })], { 'cue.json': bag }), []);
});
test('no animator or an empty array emits no animator findings', async () => {
  assert.deepEqual(await findingsFor([item()]), []);
  assert.deepEqual(await findingsFor([item({ animator: [] })]), []);
});
