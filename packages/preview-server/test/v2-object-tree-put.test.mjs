import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { serializeCaptions } from '../../edit-store/lib/canonical.js';
import { openProject } from '../../edit-store/lib/project.js';
import { applyPreviewProjection, projectPreviewEdit } from '../src/preview-edit.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(packageRoot, 'fixtures', 'v2-object-tree-put');
const sourceMedia = path.resolve(packageRoot, '..', '..', 'test-project', 'source.mp4');

test('射影差分の純粋な適用は Project API 保存後も v2 専用フィールドを保持する', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'akari-preview-v2-apply-'));
  try {
    await cp(fixtureRoot, projectRoot, { recursive: true });
    await mkdir(path.join(projectRoot, 'assets'), { recursive: true });
    await copyFile(sourceMedia, path.join(projectRoot, 'assets', 'source.mp4'));
    const before = JSON.parse(await readFile(path.join(projectRoot, 'edit.json'), 'utf8'));
    const project = await openProject(projectRoot);
    const baseline = projectPreviewEdit(
      JSON.stringify(project.edit), path.join(projectRoot, '.akari', 'preview-projection'), projectRoot,
    );
    const incoming = structuredClone(baseline);
    incoming.cuts.find(item => item.id === 'cut-edit').out = 2.5;
    incoming.layers.find(item => item.id === 'layer-edit').transform.x = 44;
    incoming.overlays.find(item => item.id === 'overlay-edit').vars.label = 'after';
    applyPreviewProjection(project, incoming, baseline);
    await project.save();
    const after = JSON.parse(await readFile(path.join(projectRoot, 'edit.json'), 'utf8'));
    assert.equal(findItem(after, 'cut-edit').duration, 75);
    assert.equal(findItem(after, 'layer-edit').transform.x, 44);
    assert.equal(findItem(after, 'overlay-edit').source.vars.label, 'after');
    assert.deepEqual(findItem(after, 'layer-edit').keyframes, { path: 'motion/layer-edit.json', count: 2 });
    assert.equal(findItem(after, 'bag.C').hidden, true);
    assert.deepEqual(findItem(after, 'bag.B').source, findItem(before, 'bag.B').source);
    findItem(after, 'cut-edit').source.out = findItem(before, 'cut-edit').source.out;
    findItem(after, 'cut-edit').duration = findItem(before, 'cut-edit').duration;
    findItem(after, 'layer-edit').transform.x = findItem(before, 'layer-edit').transform.x;
    findItem(after, 'overlay-edit').source.vars.label = findItem(before, 'overlay-edit').source.vars.label;
    assert.deepEqual(after, before);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('projection PUT は v2 木を保持し、cut/layer/overlay と captions だけを canonical 保存する', { timeout: 60_000 }, async t => {
  const port = await freePort().catch(error => {
    if (error?.code === 'EPERM') return null;
    throw error;
  });
  if (port === null) return t.skip('local TCP listener is unavailable in this sandbox');
  const project = await mkdtemp(path.join(tmpdir(), 'akari-preview-v2-put-'));
  let child;
  try {
    await cp(fixtureRoot, project, { recursive: true });
    await mkdir(path.join(project, 'assets'), { recursive: true });
    await copyFile(sourceMedia, path.join(project, 'assets', 'source.mp4'));
    const beforeText = await readFile(path.join(project, 'edit.json'), 'utf8');
    const before = JSON.parse(beforeText);
    child = spawn(process.execPath, [path.join(packageRoot, 'src', 'server.mjs'), project, '--port', String(port), '--no-lint'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/summary`);

    const summary = await fetch(`${base}/api/summary`).then(response => response.json());
    summary.cuts.find(item => item.id === 'cut-edit').out = 2.5;
    summary.layers.find(item => item.id === 'layer-edit').transform.x = 44;
    summary.overlays.find(item => item.id === 'overlay-edit').vars.label = 'after';
    const put = await fetch(`${base}/api/edit.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-akari-preview-projection': '1' },
      body: JSON.stringify(summary),
    });
    assert.equal(put.status, 200, await put.text());

    const after = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    assert.equal(findItem(after, 'cut-edit').source.out, 2.5);
    assert.equal(findItem(after, 'cut-edit').duration, 75);
    assert.equal(findItem(after, 'layer-edit').transform.x, 44);
    assert.equal(findItem(after, 'overlay-edit').source.vars.label, 'after');
    assert.deepEqual(findItem(after, 'layer-edit').keyframes, { path: 'motion/layer-edit.json', count: 2 });
    assert.equal(findItem(after, 'layer-edit').locked, true);
    assert.equal(findItem(after, 'bag.C').hidden, true);
    assert.deepEqual(findItem(after, 'bag').source.exclude, ['C']);
    assert.deepEqual(findItem(after, 'bag.B').source, findItem(before, 'bag.B').source);

    // 観測した 3 変更を戻せば、射影に無い袋・分離部品・参照 keyframes・hidden を含め完全一致。
    findItem(after, 'cut-edit').source.out = findItem(before, 'cut-edit').source.out;
    findItem(after, 'cut-edit').duration = findItem(before, 'cut-edit').duration;
    findItem(after, 'layer-edit').transform.x = findItem(before, 'layer-edit').transform.x;
    findItem(after, 'overlay-edit').source.vars.label = findItem(before, 'overlay-edit').source.vars.label;
    assert.deepEqual(after, before);

    const captions = { captions: [
      { id: 'c-0001', start: 0, end: 1, text: '変更後', speaker: null, sourceRef: null, edited: false },
    ] };
    const captionsPut = await fetch(`${base}/api/captions.json`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(captions),
    });
    assert.equal(captionsPut.status, 200, await captionsPut.text());
    assert.equal(await readFile(path.join(project, 'captions.json'), 'utf8'), serializeCaptions(captions));
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(project, { recursive: true, force: true });
  }
});

function findItem(edit, id) {
  const visit = items => {
    for (const item of items ?? []) {
      if (item.id === id) return item;
      const nested = visit(item.items);
      if (nested) return nested;
    }
    return undefined;
  };
  for (const track of edit.tracks ?? []) {
    const found = visit(track.items);
    if (found) return found;
  }
  throw new Error(`item not found: ${id}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview-server did not start');
}
