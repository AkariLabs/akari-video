#!/usr/bin/env node

// One project: outer > g1 > {g1.first, g1.second}. Only the copy is changed.
// One rotated leaf and overlapping child intervals make two visible, disjoint
// text fragments available at 1.5s for real pointer input and union measurements.
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
const track = edit.tracks.find(value => value.items.some(item => item.id === 'g1'));
const index = track.items.findIndex(item => item.id === 'g1');
const group = track.items[index];
group.transform = { x: 270, y: -110, scale: 1, rotate: 0 };
group.items[0].transform = { x: 10, y: 5, scale: 1, rotate: 0 };
group.items[1].at = 0;
group.items[1].transform = { x: 110, y: -45, scale: 1, rotate: 30 };
track.items[index] = {
  id: 'outer', at: 0, duration: 120, source: { kind: 'group' },
  transform: { x: 0, y: 0 }, items: [group]
};
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared ${project} (outer > g1; sample time 1.5s)`);
