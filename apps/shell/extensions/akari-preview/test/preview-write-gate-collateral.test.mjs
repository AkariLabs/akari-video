import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

const shape = { id: 'shape-1', at: 0, duration: 30,
  source: { kind: 'shape', shape: 'rect' }, transform: { x: 0, y: 0 } };
const source = id => ({ id, path: `assets/still/${id}/bg.png` });
const document = sources => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
  sources, tracks: [{ id: 'v1', lane: 'visual', items: [shape] }] });

async function project(t, original, cachedFindings) {
  const root = await mkdtemp(join(tmpdir(), 'preview-write-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const editPath = join(root, 'edit.json');
  const text = `${JSON.stringify(original, null, 2)}\n`;
  await writeFile(editPath, text);
  await mkdir(join(root, '.akari'));
  if (cachedFindings !== undefined) {
    await writeFile(join(root, '.akari', 'lint.json'), JSON.stringify({
      inputs: { edit_json_sha256: createHash('sha256').update(text).digest('hex') },
      findings: cachedFindings
    }));
  }
  const service = new AkariPreviewServiceImpl();
  const lint = candidate => service.lintEditCandidate({
    editUri: pathToFileURL(editPath).toString(), candidateText: JSON.stringify(candidate)
  });
  return { lint, root };
}

test('existing missing unused source does not block a transform, but a new source does', async t => {
  const original = document([source('old')]);
  const { lint } = await project(t, original);
  const moved = structuredClone(original);
  moved.tracks[0].items[0].transform.x = 42;
  assert.deepEqual(await lint(moved), { pass: true, errors: [] });

  const added = structuredClone(moved);
  added.sources.push(source('new'));
  const result = await lint(added);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.errors.length, 1, JSON.stringify(result));
  assert.match(result.errors[0], /sources\[1\]\.path/);
});

test('a new missing source is rejected when the original is clean', async t => {
  const original = document([]);
  const { lint } = await project(t, original);
  const added = structuredClone(original);
  added.sources.push(source('new'));
  const result = await lint(added);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.errors.length, 1, JSON.stringify(result));
  assert.match(result.errors[0], /sources\[0\]\.path/);
});

test('matching lint cache supplies old errors; a stale hash is ignored', async t => {
  const original = document([source('old')]);
  const oldFinding = { severity: 'error', check: 'references.files',
    message: 'sources[0].path does not resolve to a regular file' };
  const { lint, root } = await project(t, original, [oldFinding]);
  const moved = structuredClone(original);
  moved.tracks[0].items[0].transform.x = 42;
  assert.deepEqual(await lint(moved), { pass: true, errors: [] });

  await writeFile(join(root, '.akari', 'lint.json'), JSON.stringify({
    inputs: { edit_json_sha256: 'stale' }, findings: []
  }));
  assert.deepEqual(await lint(moved), { pass: true, errors: [] });
  const added = structuredClone(moved);
  added.sources.push(source('new'));
  const result = await lint(added);
  assert.equal(result.pass, false);
  assert.equal(result.errors.length, 1, JSON.stringify(result));
  assert.match(result.errors[0], /sources\[1\]\.path/);
});
