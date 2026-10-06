import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const transcriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const extensionsRoot = resolve(transcriptRoot, '../..');
const projectRoot = join(extensionsRoot, 'akari-project/src');
const projectService = readFileSync(join(projectRoot, 'node/akari-project-service.ts'), 'utf8');

function sources(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [[path, readFileSync(path, 'utf8')]] : [];
  });
}

test('autoCuts generates transcribe-cuts only; no source path applies cuts.json on to edit.json', () => {
  assert.match(projectService, /request\.autoCuts\s*&&\s*completed\.length\)\s*await generate\('cutting',\s*\['transcribe-cuts',\s*target\.relativePath\]\)/);
  const extensionSources = readdirSync(extensionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => join(extensionsRoot, entry.name, 'src'))
    .filter(existsSync).flatMap(sources);
  for (const [path, source] of extensionSources) {
    assert.doesNotMatch(source, /\b(?:applyCutsToEdit|writeCutsSelection)\b/, path);
    assert.doesNotMatch(source, /\b(?:cuts|cut|candidate)\.on\b/, path);
  }
});
