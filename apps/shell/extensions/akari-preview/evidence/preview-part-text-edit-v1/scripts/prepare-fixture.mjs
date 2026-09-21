#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const project = path.join(workspace, 'project');
if (await stat(project).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
})) throw new Error(`Refusing to replace existing project: ${project}`);
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await cp(path.join(repo, 'packages/render-cut/test/fixtures/object-tree-html-bag'), project,
  { recursive: true, force: true });
const editPath = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
const bag = edit.tracks.flatMap(track => track.items ?? []).find(item => item.id === 's01');
// Only the disposable copy changes: B's text box must not intersect A's box.
// At 0.5s (frame 15), B (frame 6) is visible and g1 (frame 30) is not yet active.
// Preserve every ID, HTML byte, exclusion, and scanned/explicit distinction.
bag.items.find(item => item.id === 's01.B').transform = { y: 40 };
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
// This repository belongs ONLY to the disposable project, never the product.
const git = (...args) => execFileSync('git', [
  '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
  '-c', 'user.name=AKARI L1 Fixture', '-c', 'user.email=l1-fixture@example.invalid',
  ...args
], { cwd: project, stdio: 'pipe' });
git('init', '--quiet');
git('add', '--all');
git('commit', '--quiet', '-m', 'Initial isolated part text fixture');
console.log(`prepared ${project} (sample time 0.5s; C, B, scanned A, plain)`);
