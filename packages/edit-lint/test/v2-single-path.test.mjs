import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

test('legacy edit.json is rejected by the v2-only reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-legacy-'));
  await writeFile(join(root, 'edit.json'), '{"version":1,"sources":[],"cuts":[],"overlays":[]}\n');
  const errors = [];
  const code = await runCli([root, '--json'], { log() {}, error(value) { errors.push(value); } });
  assert.equal(code, 2);
  assert.match(errors.join('\n'), /akari migrate/);
});
