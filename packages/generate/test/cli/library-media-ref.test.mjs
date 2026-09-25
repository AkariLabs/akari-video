import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveProjectAssetPath } from '../../../asset-resolver/src/shell-reference.mjs';
import { resolveProjectAssetPathSync } from '../../../asset-resolver/src/shell-reference-sync.mjs';
import { createMediaResolver, makeReference, resolveMedia } from '../../src/cli/media-ref.mjs';
import { runVideoCommand } from '../../src/cli/video.mjs';

const declared = 'assets/still/bg-aurora-mesh/bg.png';
const libraryBytes = Buffer.from('library image bytes');
const localBytes = Buffer.from('project image bytes');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const imageBytes = dataUri => Buffer.from(dataUri.split(',')[1], 'base64');
const noNetwork = () => { throw new Error('unexpected fetch'); };

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'akari-generate-library-ref-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project');
  const library = path.join(temp, 'library');
  const home = path.join(temp, 'home');
  const image = path.join(library, 'still', 'bg-aurora-mesh', 'bg.png');
  await mkdir(path.dirname(image), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(image, libraryBytes);
  await writeFile(path.join(home, 'library-location.json'), JSON.stringify({ version: 0, state: 'done', root: library }));
  await writeFile(path.join(project, '.akari', 'asset-references.json'), JSON.stringify({
    version: 0, references: [{ category: 'still', id: 'bg-aurora-mesh' }],
  }));
  await writeFile(path.join(project, 'edit.json'), JSON.stringify({
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'still', path: declared, proxy: null }],
    tracks: [{ id: 'video', lane: 'visual', name: '映像', items: [{
      id: 'clip-01', at: 0, duration: 150,
      source: { kind: 'media', src: 'still', in: 0, out: 5 },
    }] }],
  }));
  return { project, library, home, image, env: { ...process.env, AKARI_HOME: home, AKARI_LIBRARY_ROOT: '' } };
}

function args(project, extra = []) {
  return [project, '--item', 'clip-01', '--prompt', 'Motion.', '--resolution', '768P', ...extra];
}

test('library-only source resolves for dry run and submitted body without external fetch', async t => {
  const { project, image, env } = await fixture(t);
  assert.equal(resolveProjectAssetPathSync(project, declared, env), await realpath(image));
  assert.equal(await resolveProjectAssetPath(project, declared, env), await realpath(image));
  const reference = makeReference(project, declared, { env });
  assert.equal(reference.path, declared);
  assert.equal(reference.sha256, sha256(libraryBytes));
  assert.deepEqual(imageBytes(resolveMedia(reference, { projectDir: project, env })), libraryBytes);
  assert.deepEqual(imageBytes(createMediaResolver(project, { env })(reference)), libraryBytes);

  const dryErrors = [];
  const dry = await runVideoCommand(args(project, ['--dry-run', '--json']), {
    env, fetchImpl: noNetwork, log: () => {}, errorLog: line => dryErrors.push(line),
  });
  assert.equal(dry.exitCode, 0, dryErrors.join('\n'));
  assert.match(dry.result.body.image_url, /image\/png.*bytes/u);

  let body;
  let calls = 0;
  const errors = [];
  const submitted = await runVideoCommand(args(project, ['--yes']), {
    env, resolveFalKeyImpl: () => ({ key: 'test', key_source: 'test' }),
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (init?.method === 'POST') {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({
          request_id: 'test-request', status_url: 'https://example.invalid/status', response_url: 'https://example.invalid/response',
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ status: 'FAILED', error: 'test stop after submit' }), {
        headers: { 'content-type': 'application/json' },
      });
    },
    log: () => {}, errorLog: line => errors.push(line),
  });
  assert.equal(submitted.exitCode, 1);
  assert.equal(calls, 2);
  assert.match(errors.join('\n'), /test stop after submit/u);
  assert.deepEqual(imageBytes(body.image_url), libraryBytes);
  assert.equal(JSON.stringify(body).includes(image), false);
  const meta = JSON.parse(await readFile(path.join(project, 'assets/generated/clip-01.mp4.meta.json'), 'utf8'));
  assert.deepEqual(meta.placeholder, { path: declared, sha256: sha256(libraryBytes), item_id: 'clip-01' });
  assert.equal(meta.inputs.first_frame.path, declared);
  assert.equal(meta.inputs.first_frame.sha256, sha256(libraryBytes));
  assert.equal(JSON.stringify(meta).includes(image), false);
});

test('project file wins over the referenced library file', async t => {
  const { project, env } = await fixture(t);
  const local = path.join(project, declared);
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, localBytes);
  assert.equal(resolveProjectAssetPathSync(project, declared, env), await realpath(local));
  assert.equal(await resolveProjectAssetPath(project, declared, env), await realpath(local));
  assert.equal(makeReference(project, declared, { env }).sha256, sha256(localBytes));
  assert.deepEqual(imageBytes(resolveMedia({ path: declared }, { projectDir: project, env })), localBytes);
});

test('media references retain project-relative paths after compatible lexical normalization', async t => {
  const { project, env } = await fixture(t);
  for (const candidate of [
    `./${declared}`,
    'assets/still/temporary/../bg-aurora-mesh/bg.png',
    path.join(project, declared),
  ]) {
    const reference = makeReference(project, candidate, { env });
    assert.equal(reference.path, declared);
    assert.equal(reference.sha256, sha256(libraryBytes));
    assert.deepEqual(imageBytes(resolveMedia({ path: candidate }, { projectDir: project, env })), libraryBytes);
  }
  const dry = await runVideoCommand(args(project, [
    '--first-frame', path.join(project, declared), '--dry-run', '--json',
  ]), { env, fetchImpl: noNetwork, log: () => {}, errorLog: () => {} });
  assert.equal(dry.exitCode, 0);

  const local = path.join(project, 'assets', 'local.png');
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, localBytes);
  const reference = makeReference(project, local, { env });
  assert.equal(reference.path, 'assets/local.png');
  assert.equal(reference.sha256, sha256(localBytes));
  assert.deepEqual(imageBytes(resolveMedia({ path: local }, { projectDir: project, env })), localBytes);
});

test('outside paths, unlisted ids, and escaping symlinks are rejected', async t => {
  const { project, library, env } = await fixture(t);
  const outside = path.join(library, 'still', 'other', 'outside.png');
  await mkdir(path.dirname(outside), { recursive: true });
  await writeFile(outside, localBytes);
  for (const invalid of ['../outside.png', '/tmp/outside.png', 'assets/still/other/outside.png']) {
    assert.throws(() => makeReference(project, invalid, { env }));
    assert.throws(() => resolveMedia({ path: invalid }, { projectDir: project, env }));
  }
  assert.equal(resolveProjectAssetPathSync(project, 'assets/still/other/outside.png', env), null);
  assert.equal(await resolveProjectAssetPath(project, 'assets/still/other/outside.png', env), null);

  await rm(path.join(library, 'still', 'bg-aurora-mesh', 'bg.png'));
  await symlink(outside, path.join(library, 'still', 'bg-aurora-mesh', 'bg.png'));
  assert.equal(resolveProjectAssetPathSync(project, declared, env), null);
  assert.throws(() => makeReference(project, declared, { env }));

  await rm(path.join(library, 'still', 'bg-aurora-mesh', 'bg.png'));
  await writeFile(path.join(library, 'still', 'bg-aurora-mesh', 'bg.png'), libraryBytes);
  const local = path.join(project, declared);
  await mkdir(path.dirname(local), { recursive: true });
  await symlink(outside, local);
  assert.throws(() => resolveProjectAssetPathSync(project, declared, env));
  assert.throws(() => makeReference(project, declared, { env }));
  await rm(local);
  await symlink(path.join(project, 'missing.png'), local);
  assert.throws(() => resolveProjectAssetPathSync(project, declared, env));
  assert.throws(() => makeReference(project, declared, { env }));
});

test('sync and async project reference resolution agree except at the stricter id boundary', async t => {
  const { project, library, image, env } = await fixture(t);
  const local = path.join(project, declared);
  const other = path.join(library, 'still', 'other', 'outside.png');
  await mkdir(path.dirname(other), { recursive: true });
  await writeFile(other, localBytes);

  const captureSync = candidate => {
    try { return { kind: 'value', value: resolveProjectAssetPathSync(project, candidate, env) }; }
    catch (error) { return { kind: 'error', code: error.code ?? null }; }
  };
  const captureAsync = async candidate => {
    try { return { kind: 'value', value: await resolveProjectAssetPath(project, candidate, env) }; }
    catch (error) { return { kind: 'error', code: error.code ?? null }; }
  };
  const cases = [
    { name: 'library only', candidate: declared, expected: { kind: 'value', value: await realpath(image) } },
    { name: 'project wins', candidate: declared, setup: async () => {
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, localBytes);
    }, expected: { kind: 'value', value: path.join(await realpath(project), declared) } },
    { name: 'unlisted id', candidate: 'assets/still/other/outside.png', expected: { kind: 'value', value: null } },
    { name: 'parent traversal', candidate: '../outside.png', expected: { kind: 'error', code: null } },
    { name: 'absolute path', candidate: path.join(project, declared), expected: { kind: 'error', code: null } },
    { name: 'broken local symlink', candidate: declared, setup: async () => {
      await rm(local);
      await symlink(path.join(project, 'missing.png'), local);
    }, expected: { kind: 'error', code: 'ENOENT' } },
  ];
  for (const row of cases) {
    await row.setup?.();
    assert.deepEqual(captureSync(row.candidate), row.expected, `${row.name}: sync`);
    assert.deepEqual(await captureAsync(row.candidate), row.expected, `${row.name}: async`);
  }

  await rm(local);
  await rm(image);
  await symlink(other, image);
  assert.deepEqual(captureSync(declared), { kind: 'value', value: null });
  assert.deepEqual(await captureAsync(declared), { kind: 'value', value: await realpath(other) });
});

test('--from-image accepts a referenced library still and uses the injected env', async t => {
  const { project, library, env } = await fixture(t);
  const override = { ...env, AKARI_LIBRARY_ROOT: library, AKARI_HOME: path.join(project, 'unused-home') };
  const errors = [];
  const result = await runVideoCommand([project, '--from-image', declared, '--prompt', 'Motion.', '--dry-run', '--json'], {
    env: override, fetchImpl: noNetwork, log: () => {}, errorLog: line => errors.push(line),
  });
  assert.equal(result.exitCode, 0, errors.join('\n'));
  assert.match(result.result.body.image_url, /image\/png.*bytes/u);
  for (const invalid of ['../outside.png', '/tmp/outside.png', 'assets/still/other/outside.png']) {
    const rejected = await runVideoCommand([project, '--from-image', invalid, '--dry-run'], {
      env: override, fetchImpl: noNetwork, log: () => {}, errorLog: () => {},
    });
    assert.notEqual(rejected.exitCode, 0, invalid);
  }
});
