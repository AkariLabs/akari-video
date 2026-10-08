import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { hasProjectAkariDirectory } from '../src/project-root.mjs';

const packagesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('a symlink to AKARI_HOME is not a project marker', async (t) => {
  const root = await mkdtemp(join(process.env.TMPDIR, 'project-marker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const appHome = join(home, '.akari');
  const alias = join(root, 'alias');
  const project = join(root, 'project');
  await mkdir(appHome, { recursive: true });
  await symlink(home, alias, 'dir');
  await mkdir(project);
  assert.equal(hasProjectAkariDirectory(alias, { AKARI_HOME: appHome }), false);
  assert.equal(hasProjectAkariDirectory(home, { AKARI_HOME: join(alias, '.akari') }), false);
  const caseVariant = join(root, 'HOME', '.akari');
  if (existsSync(caseVariant)) {
    assert.equal(hasProjectAkariDirectory(home, { AKARI_HOME: caseVariant }), false);
  }
  await mkdir(join(project, '.akari'));
  assert.equal(hasProjectAkariDirectory(project, { AKARI_HOME: appHome }), true);
  assert.equal(existsSync(join(project, '.akari')), true);
});

async function modules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name === 'evidence') continue;
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await modules(candidate));
    else if (entry.isFile() && /\.(?:mjs|js|cjs)$/u.test(entry.name)) found.push(candidate);
  }
  return found;
}

// A bounded neighborhood keeps unrelated checks in the same module separate while
// covering a marker assigned to a variable before a dirname loop probes it.
function directAkariAncestorSearch(source) {
  const lines = source.split('\n');
  const marker = /\b(?:path\.)?(?:join|resolve)\s*\([^;{}]{0,300}?,\s*(['"`])\.akari\1\s*\)/gu;
  for (const match of source.matchAll(marker)) {
    const line = source.slice(0, match.index).split('\n').length - 1;
    const neighborhood = lines.slice(Math.max(0, line - 50), line + 51).join('\n');
    if (/\b(?:existsSync|statSync|lstatSync)\s*\(/u.test(neighborhood)
      && /\b(?:for|while)\s*\(/u.test(neighborhood)
      && /\b(?:path\.)?dirname\s*\(/u.test(neighborhood)) return true;
  }
  return false;
}

test('source detector catches ancestor loops regardless of cursor name', () => {
  assert.equal(directAkariAncestorSearch(`
    function find(dir) {
      while (true) {
        if (existsSync(join(dir, '.akari'))) return dir;
        dir = dirname(dir);
      }
    }`), true);
  assert.equal(directAkariAncestorSearch(`
    function find(start) {
      for (let cursor = start; ; cursor = dirname(cursor)) {
        const marker = resolve(cursor, '.akari');
        if (lstatSync(marker).isDirectory()) return cursor;
      }
    }`), true);
  assert.equal(directAkariAncestorSearch(`
    function isProject(cwd) { return existsSync(join(cwd, '.akari')); }`), false);
});

test('project-root callers use the shared marker predicate', async () => {
  const callers = [
    'edit-lint/src/edit-lint.mjs',
    'akari-tools/src/media/common.mjs',
    'akari-tools/src/capture/arguments.mjs',
    'akari-tools/bin/capture.mjs',
    'media-bin/bin/audio-measure.mjs',
  ];
  for (const relative of callers) {
    const source = await readFile(join(packagesRoot, relative), 'utf8');
    assert.match(source, /import\s*\{\s*hasProjectAkariDirectory\s*\}.*project-root\.mjs/u, relative);
    assert.match(source, /\bhasProjectAkariDirectory\s*\(/u, relative);
  }
  const packages = await readdir(packagesRoot, { withFileTypes: true });
  const files = (await Promise.all(packages.filter(entry => entry.isDirectory()).map(async entry => [
    ...await modules(join(packagesRoot, entry.name, 'src')).catch(() => []),
    ...await modules(join(packagesRoot, entry.name, 'bin')).catch(() => []),
  ]))).flat();
  const nonProjectChecks = new Map([
    ['akari-ear/src/dictionary.mjs', 'application-wide voice dictionary paths; the nearby dirname is unrelated'],
    ['akari-launcher/src/skills-command.mjs', 'installed skill source path; the dirname loop checks symlinks'],
    ['word-book/src/index.mjs', 'application-home pointer follows a separate creator-root manifest search'],
  ]);
  const directSearches = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (directAkariAncestorSearch(source)) directSearches.push(file.slice(packagesRoot.length + 1));
  }
  assert.deepEqual(directSearches.sort(), [...nonProjectChecks.keys()].sort(),
    `unexpected direct .akari ancestor search: ${directSearches.filter(file => !nonProjectChecks.has(file)).join(', ')}`);
});
