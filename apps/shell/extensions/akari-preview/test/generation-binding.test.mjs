import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { describeOverlay, resolveGenerationState } from '../lib/common/generation-overlay-model.js';
import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, { source = '素材', expected = sha256(source), writeSource = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'akari-preview-generation-binding-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = join(base, 'project');
  const relative = 'assets/clip.mp4';
  const absolute = join(project, relative);
  await mkdir(join(project, 'assets'), { recursive: true });
  await writeFile(join(project, 'edit.json'), JSON.stringify({
    version: 2, sources: [{ id: 'clip', path: relative }], tracks: []
  }));
  if (writeSource) await writeFile(absolute, source);
  await writeFile(`${absolute}.meta.json`, JSON.stringify({
    version: 1, kind: 'video', status: 'done', result: { sha256: expected }
  }));
  const rootUri = pathToFileURL(project).toString();
  const service = new AkariPreviewServiceImpl();
  service.workspaceServer = {
    getMostRecentlyUsedWorkspace: async () => rootUri,
    getRecentWorkspaces: async () => [rootUri]
  };
  return { project, relative, rootUri, service };
}

async function read(data) {
  const result = await data.service.readGenerationSidecars({
    editUri: pathToFileURL(join(data.project, 'edit.json')).toString(),
    workspaceRoots: [data.rootUri]
  });
  return result.entries[0];
}

test('node reader は一致する素材の sha binding を返す', async t => {
  const entry = await read(await fixture(t));
  assert.equal(entry.binding.matches, true);
  assert.equal(entry.binding.actual, entry.binding.expected);
});

test('node reader は不一致の素材を matches false にする', async t => {
  const entry = await read(await fixture(t, { expected: sha256('別物') }));
  assert.equal(entry.binding.matches, false);
  assert.notEqual(entry.binding.actual, entry.binding.expected);
});

test('node reader は素材なしを actual null にする', async t => {
  const entry = await read(await fixture(t, { writeSource: false }));
  assert.equal(entry.binding.actual, null);
  assert.equal(entry.binding.matches, false);
});

test('生成中 mp4 が未存在でも first_frame の素材を hash して binding する', async t => {
  const data = await fixture(t);
  const stillRelative = 'assets/first.png';
  const still = 'first-frame';
  await writeFile(join(data.project, stillRelative), still);
  await mkdir(join(data.project, 'assets', 'generated'), { recursive: true });
  await writeFile(join(data.project, 'assets/generated/in-flight.mp4.meta.json'), JSON.stringify({
    version: 1, kind: 'video', status: 'generating',
    inputs: { first_frame: { path: stillRelative, sha256: sha256(still) } },
    job: { started_at: new Date().toISOString(), stale_after_s: 30 }
  }));
  const result = await data.service.readGenerationSidecars({
    editUri: pathToFileURL(join(data.project, 'edit.json')).toString(),
    workspaceRoots: [data.rootUri]
  });
  const entry = result.entries.find(candidate => candidate.sourcePath === 'assets/generated/in-flight.mp4');
  assert.equal(entry.binding.source, 'first_frame');
  assert.equal(entry.binding.actual, sha256(still));
  assert.equal(entry.binding.matches, true);
});

test('binding 不一致は orphan 状態になる', () => {
  assert.equal(resolveGenerationState({ status: 'done' }, Date.now(), { matches: false }), 'orphan');
});

test('orphan overlay は孤児タグだけを返す', () => {
  assert.deepEqual(describeOverlay('orphan', { status: 'done' }, 'ビート 1'), {
    tag: '孤児 · ビート 1', band: null, shimmer: false, maskRect: null
  });
});
