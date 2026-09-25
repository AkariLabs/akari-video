#!/usr/bin/env node
// Compile and run the pinned baseline's frame-engine preview test in isolation.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, '../..');
const baselineRevision = 'b76f12758e857f7f0b688c01d8bbc6799b9c799c';
const scratch = await mkdtemp('/tmp/libcanvas-c0a-frame-baseline-');
const clean = text => String(text).replaceAll(`/private${scratch}`, '<scratch>')
  .replaceAll(scratch, '<scratch>').replaceAll(repo, '<repo>')
  .replace(/\/Users\/[^\s"']+/g, '<local>');
const result = { baselineRevision };
try {
  const archive = spawnSync('git', ['archive', baselineRevision, 'apps/shell/extensions/akari-preview', 'packages'], {
    cwd: repo, maxBuffer: 256 * 1024 * 1024
  });
  if (archive.status !== 0) throw new Error('baseline archive failed');
  const unpack = spawnSync('tar', ['-x', '-C', scratch], { input: archive.stdout });
  if (unpack.status !== 0) throw new Error('baseline extraction failed');
  await symlink(join(repo, 'node_modules'), join(scratch, 'node_modules'));
  await mkdir(join(scratch, 'apps/shell'), { recursive: true });
  await symlink(join(repo, 'apps/shell/node_modules'), join(scratch, 'apps/shell/node_modules'));
  const extension = join(scratch, 'apps/shell/extensions/akari-preview');
  const compile = spawnSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-b'], {
    cwd: extension, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  });
  result.compile = { code: compile.status, signal: compile.signal,
    tail: clean((compile.stderr ?? '') + (compile.stdout ?? '')).slice(-1800) };
  if (compile.status === 0) {
    const started = Date.now();
    const test = spawnSync(process.execPath, ['--test', '--test-timeout=120000', 'test/frame-engine-preview.test.mjs'], {
      cwd: extension, encoding: 'utf8', timeout: 130000, maxBuffer: 16 * 1024 * 1024
    });
    result.test = { code: test.status, signal: test.signal, durationMs: Date.now() - started,
      tail: clean((test.stderr ?? '') + (test.stdout ?? '')).slice(-2500) };
  }
} catch (error) { result.error = clean(error?.stack ?? error); }
finally {
  await writeFile(join(evidence, 'frame-engine-preview-baseline.json'), JSON.stringify(result, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}
