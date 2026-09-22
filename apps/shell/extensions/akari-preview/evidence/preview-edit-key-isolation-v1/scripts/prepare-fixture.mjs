#!/usr/bin/env node

// Only a disposable copy is modified; a named part and an ordinary HTML leaf.
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
const leaf = (id, part) => ({ id, at: 0, duration: 120,
  source: { kind: 'html', path: 'overlays/' + id + '.html', ...(part ? { part: 'title', text: 'あいう' } : {}) },
  transform: { x: 0, y: 0 } });
for (const [id, x, part] of [['part', 40, true], ['plain', 300, false]]) {
  await writeFile(path.join(project, 'overlays', id + '.html'),
    `<div ${part ? 'data-akari-part="title"' : ''} style="position:absolute;left:${x}px;top:70px;color:white;font:32px sans-serif">あいう</div>`);
}
edit.tracks = [leaf('part', true), leaf('plain', false)]
  .map(item => ({ id: 'visual-' + item.id, lane: 'visual', items: [item] }));
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared ${project} (disposable part and plain text leaves; 1.5s)`);
