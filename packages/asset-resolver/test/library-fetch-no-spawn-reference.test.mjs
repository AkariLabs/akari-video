import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { listProjectReferenceAssets, projectReferenceMediaUris } from '../src/shell-reference.mjs';

const names = ['realpathSync', 'lstatSync', 'statSync', 'readFileSync', 'readdirSync', 'existsSync'];

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'reference-async-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const library = path.join(root, 'library');
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(path.join(library, 'still', 'sample'), { recursive: true });
  await writeFile(path.join(project, '.akari', 'asset-references.json'),
    JSON.stringify({ version: 0, references: [{ category: 'still', id: 'sample' }] }));
  const env = { ...process.env, AKARI_HOME: path.join(root, 'home'),
    AKARI_CREATOR_ROOT: path.join(root, 'creator'), AKARI_LIBRARY_ROOT: library };
  return { project, library, env };
}

test('参照 URI と列挙は素材数に応じた同期 I/O を行わない', async t => {
  const f = await fixture(t);
  const originals = Object.fromEntries(names.map(name => [name, fs[name]]));
  let direct = 0;
  let total = 0;
  for (const name of names) {
    fs[name] = (...args) => {
      total++;
      const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
      if (/asset-resolver[/\\]src[/\\](shell-reference|project-references)\.mjs/.test(caller)) direct++;
      return originals[name](...args);
    };
  }
  syncBuiltinESMExports();
  t.after(() => {
    for (const name of names) fs[name] = originals[name];
    syncBuiltinESMExports();
  });
  const counts = [];
  for (const size of [3, 30]) {
    const dir = path.join(f.library, 'still', 'sample');
    for (let n = 0; n < size; n++) await writeFile(path.join(dir, `frame-${n}.png`), 'image');
    const before = total;
    const entries = await listProjectReferenceAssets(f.project, f.env);
    const uris = await projectReferenceMediaUris(f.project, f.env);
    counts.push(total - before);
    assert.equal(entries[0].files.length, size);
    assert.deepEqual(new Set(Object.keys(uris)), new Set(Array.from({ length: size }, (_, n) =>
      `assets/still/sample/frame-${n}.png`)));
    assert.equal(uris['assets/still/sample/frame-0.png'],
      pathToFileURL(path.join(dir, 'frame-0.png')).href);
  }
  assert.equal(direct, 0);
  assert.equal(counts[1], counts[0]);
});
