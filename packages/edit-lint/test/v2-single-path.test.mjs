import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { lintProject, runCli } from '../src/edit-lint.mjs';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-v2-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'main.mp4'), 'fixture');
  await writeFile(join(root, 'assets', 'pip.mp4'), 'fixture');
  await writeFile(join(root, 'overlay.html'), '<div>overlay</div>');
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: 'main', path: 'assets/main.mp4', proxy: null },
      { id: 'pip', path: 'assets/pip.mp4', proxy: null },
    ],
    tracks: [
      { id: 'base', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
      { id: 'pip-track', lane: 'visual', items: [
        { id: 'l1', at: 15, duration: 30, source: { kind: 'media', src: 'pip', in: 0, out: 1 } },
      ] },
      { id: 'html', lane: 'visual', items: [
        { id: 'o1', at: 0, duration: 30, source: { kind: 'html', path: 'overlay.html' } },
      ] },
      { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
    ],
  };
  await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  return root;
}

test('v2 is projected to the single compatibility view and passes existing checks', async () => {
  const root = await project();
  const result = await lintProject(root, { writeReports: false });
  assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
});

test('v2 track muted adds no findings for visual, audio, and content tracks', async () => {
  const root = await project();
  const editPath = join(root, 'edit.json');
  const edit = JSON.parse(await readFile(editPath, 'utf8'));
  edit.tracks.push({ id: 'audio', lane: 'audio', items: [{
    id: 'hit', at: 0, duration: 30,
    source: { kind: 'media', src: 'main', in: 0, out: 1 },
  }] });
  await writeFile(editPath, JSON.stringify(edit));
  const baseline = await lintProject(root, { writeReports: false });
  for (const muted of [true, false]) {
    for (const track of edit.tracks) track.muted = muted;
    await writeFile(editPath, JSON.stringify(edit));
    const result = await lintProject(root, { writeReports: false });
    assert.equal(result.verdict, baseline.verdict);
    assert.deepEqual(result.findings, baseline.findings);
  }
});

test('v2 mask must reference an existing video source', async () => {
  const root = await project();
  const editPath = join(root, 'edit.json');
  const edit = JSON.parse(await readFile(editPath, 'utf8'));
  edit.tracks[1].items[0].mask = 'missing';
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  let result = await lintProject(root, { writeReports: false });
  assert.ok(result.findings.some(finding => finding.check === 'v2.mask-reference'));

  await writeFile(join(root, 'assets', 'mask.png'), 'fixture');
  edit.sources.push({ id: 'mask-image', path: 'assets/mask.png', proxy: null });
  edit.tracks[1].items[0].mask = 'mask-image';
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  result = await lintProject(root, { writeReports: false });
  assert.ok(result.findings.some(finding => finding.check === 'v2.mask-video'));
});

test('legacy edit.json is rejected by the v2-only reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-legacy-'));
  await writeFile(join(root, 'edit.json'), '{"version":1,"sources":[],"cuts":[],"overlays":[]}\n');
  const errors = [];
  const code = await runCli([root, '--json'], { log() {}, error(value) { errors.push(value); } });
  assert.equal(code, 2);
  assert.match(errors.join('\n'), /akari migrate/);
});
