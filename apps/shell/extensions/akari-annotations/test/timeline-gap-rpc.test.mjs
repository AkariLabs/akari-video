import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
const exec = promisify(execFile);
const vendor = fileURLToPath(new URL(`../../../../../packages/media-bin/vendor/${process.platform}-${process.arch}/ffmpeg`, import.meta.url));
const ffmpeg = process.env.AKARI_FFMPEG_BIN || (await stat(vendor).catch(() => null))?.isFile() && (process.env.AKARI_FFMPEG_BIN || vendor) || 'ffmpeg';
process.env.AKARI_FFMPEG_BIN = ffmpeg;
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'akari-gap-rpc-')), root = join(temp, 'project');
  await mkdir(join(root, 'assets'), { recursive: true });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const service = new AkariAnnotationsServiceImpl();
  const request = { projectRootUri: pathToFileURL(root).href, sourcePath: 'assets/source.mp4', atSeconds: 1, which: 'last' };
  return { root, temp, service, request };
}
test('RPC extracts source-sized PNG, reuses a file sequentially and concurrently, and preserves edit', async t => {
  const f = await fixture(t);
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30', '-t', '2', '-c:v', 'libx264', join(f.root, f.request.sourcePath)]);
  const before = '{"version":2,"tracks":[]}\n'; await writeFile(join(f.root, 'edit.json'), before);
  const first = await f.service.extractSourceFrame(f.request);
  assert.match(first.relativePath, /^assets\/captures\/frame-source-1-[a-f0-9]+\.png$/);
  const file = join(f.root, first.relativePath), png = await readFile(file), originalStat = await stat(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 160); assert.equal(png.readUInt32BE(20), 90);
  assert.equal(first.sha256, createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(await f.service.extractSourceFrame(f.request), first);
  assert.equal((await stat(file)).mtimeMs, originalStat.mtimeMs);
  await rm(file);
  const results = await Promise.all([f.service.extractSourceFrame(f.request), f.service.extractSourceFrame({ ...f.request, which: 'first' })]);
  assert.deepEqual(results, [first, first]);
  assert.deepEqual(await readdir(join(f.root, 'assets/captures')), [first.relativePath.split('/').pop()]);
  assert.equal(await readFile(join(f.root, 'edit.json'), 'utf8'), before);
});
test('image returns the original relative path and hash without creating captures', async t => {
  const f = await fixture(t); const relativePath = 'assets/still.png';
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90', '-frames:v', '1', join(f.root, relativePath)]);
  const result = await f.service.extractSourceFrame({ ...f.request, sourcePath: relativePath });
  assert.equal(result.relativePath, relativePath);
  assert.equal(result.sha256, createHash('sha256').update(await readFile(join(f.root, relativePath))).digest('hex'));
  assert.equal(await stat(join(f.root, 'assets/captures')).catch(() => null), null);
});
for (const kind of ['traversal', 'absolute', 'source-symlink', 'assets-symlink', 'captures-symlink']) {
  test(`RPC rejects project escape: ${kind}`, async t => {
    const f = await fixture(t), outside = join(f.temp, 'outside'); await mkdir(outside);
    const source = join(outside, 'outside.mp4'); await writeFile(source, 'not accessed');
    if (kind === 'traversal') f.request.sourcePath = '../outside/outside.mp4';
    if (kind === 'absolute') f.request.sourcePath = source;
    if (kind === 'source-symlink') await symlink(source, join(f.root, f.request.sourcePath));
    if (kind.endsWith('s-symlink')) {
      await writeFile(join(f.root, 'local.mp4'), 'not decoded'); f.request.sourcePath = 'local.mp4';
      const link = join(f.root, kind === 'assets-symlink' ? 'assets' : 'assets/captures');
      await rm(link, { recursive: true, force: true }); await symlink(outside, link);
    }
    await assert.rejects(f.service.extractSourceFrame(f.request), /プロジェクト/);
    assert.deepEqual(await readdir(outside), ['outside.mp4']);
  });
}
for (const change of [{ atSeconds: -1 }, { atSeconds: NaN }, { which: 'middle' }]) {
  test(`RPC rejects invalid request ${JSON.stringify(change)}`, async t => {
    const f = await fixture(t); await assert.rejects(f.service.extractSourceFrame({ ...f.request, ...change }));
  });
}
