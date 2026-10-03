import assert from 'node:assert/strict';
import test from 'node:test';
import { visionCandidates, preparePhotoClick, ensurePhotoModels, candidateCachePath } from '../lib/node/photo-segmentation.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/node/photo-segmentation.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('photo-segmentation.ts', source, ts.ScriptTarget.Latest, true);
const adoptNode = ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'adoptPhotoCandidates');
assert.ok(adoptNode);
const adoptCode = ts.transpileModule(adoptNode.getText(ast).replace(/^export\s+/u, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const adoptWithPlatform = platform => new Function('process', `${adoptCode}\nreturn adoptPhotoCandidates;`)(
  { platform });

test('missing helper leaves inference unavailable without writing', async () => {
  assert.deepEqual(await visionCandidates('/unused', '/unused', undefined, 'foreground'),
    { ok: false, message: '背景透過は Mac でだけ使えます' });
  assert.deepEqual(await preparePhotoClick('/unused', undefined),
    { ok: false, message: '背景透過は Mac でだけ使えます' });
});

test('missing model and failed retrieval are contained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-photo-model-test-'));
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { await assert.rejects(ensurePhotoModels(undefined, root), /offline|背景透過は Mac でだけ使えます/); }
  finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('candidate adoption distinguishes unavailable helper from invalid input', async () => {
  const darwin = adoptWithPlatform('darwin');
  const windows = adoptWithPlatform('win32');
  const hash = 'a'.repeat(64);
  assert.deepEqual(await windows('/unused', '/unused', ['candidate'], hash, 'apple-vision', 'helper'),
    { ok: false, message: '背景透過は Mac でだけ使えます' });
  assert.deepEqual(await darwin('/unused', '/unused', ['candidate'], hash, 'apple-vision', undefined),
    { ok: false, message: '背景透過は Mac でだけ使えます' });
  for (const [candidates, sha] of [[[], hash], [Array(33).fill('candidate'), hash], [['candidate'], 'bad']]) {
    assert.deepEqual(await darwin('/unused', '/unused', candidates, sha, 'apple-vision', 'helper'),
      { ok: false, message: '背景透過を実行できませんでした' });
  }
});

test('Vision and SAM candidate ids resolve to separate cache files', () => {
  const root = join('project', 'cache');
  assert.deepEqual(candidateCachePath(root, 'vision-people--person-1'), [join(root, 'vision-people', 'person-1.png')]);
  assert.deepEqual(candidateCachePath(root, 'vision-foreground--all'), [join(root, 'vision-foreground', 'all.png')]);
  assert.deepEqual(candidateCachePath(root, 'sam-12345678-1234-1234-1234-123456789abc--candidate-2'),
    [join(root, 'sam-12345678-1234-1234-1234-123456789abc', 'candidate-2.png')]);
  assert.deepEqual(candidateCachePath(root, '../escape--all'), []);
});
