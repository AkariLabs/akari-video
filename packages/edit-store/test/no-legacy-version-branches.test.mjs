import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function sourceFiles(directory, { exclude = new Set() } = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path, { exclude }));
    else if (['.ts', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

test('production edit paths contain no v0/v1 version dispatch', async () => {
  const editStore = await sourceFiles(join(repositoryRoot, 'packages/edit-store/src'), {
    exclude: new Set(['migrate']),
  });
  const renderCut = await sourceFiles(join(repositoryRoot, 'packages/render-cut/src'));
  const editLint = join(repositoryRoot, 'packages/edit-lint/src/edit-lint.mjs');
  const failures = [];
  for (const path of [...editStore, ...renderCut]) {
    const source = await readFile(path, 'utf8');
    if (/\bversion\s*(?:===|==|!==|!=)\s*[01]\b/u.test(source)
      || /\b(?:sourceVersion|buildCutCommand|buildGapAwareCutCommand|usesDefaultTrackOrder)\b/u.test(source)) {
      failures.push(path);
    }
  }
  const lintSource = await readFile(editLint, 'utf8');
  if (/\bedit\??\.version\s*(?:===|==|!==|!=)\s*[01]\b/u.test(lintSource)
    || /\b(?:sourceVersion|usesDefaultTrackOrder)\b/u.test(lintSource)) failures.push(editLint);
  assert.deepEqual(failures, []);
});
