#!/usr/bin/env node

// Only a disposable copy is modified; root siblings, nested siblings and a bag.
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
const bag = edit.tracks[0].items[0];
const leaf = id => ({ id, at: 0, duration: 120,
  source: { kind: 'html', path: 'overlays/' + id + '.html' }, transform: { x: 0, y: 0 } });
for (const [id, x, y] of [['a', 40, 10], ['b', 100, 10], ['c', 380, 10],
  ['nested', 230, 240], ['nested2', 370, 240]]) {
  await writeFile(path.join(project, 'overlays', id + '.html'),
    `<div style="position:absolute;left:${x}px;top:${y}px;width:110px;height:45px;background:#48658a;color:white;font:22px sans-serif">${id}</div>`);
}
// Simultaneous root siblings need separate tracks: items in one track cannot overlap.
edit.tracks = [bag, leaf('a'), leaf('b'), leaf('c'), {
  id: 'g', at: 0, duration: 120, source: { kind: 'group' }, transform: { x: 0, y: 0 },
  items: [leaf('nested'), leaf('nested2')]
}].map(item => ({ id: 'visual-' + item.id, lane: 'visual', items: [item] }));
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared ${project} (three root siblings, two nested siblings and a bag; 1.5s)`);
