#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

const [, , workspaceDir] = process.argv;
if (!workspaceDir) throw new Error('usage: prepare-fixture.mjs <workspaceDir>');
const run = promisify(execFile);
const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const projectDir = path.join(workspaceDir, 'project');
const fixtureDir = path.join(repositoryDir, 'packages/render-cut/test/fixtures/object-tree-html-bag');
await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(path.join(repositoryDir, 'templates/project-default'), projectDir, { recursive: true, force: true });
await cp(fixtureDir, projectDir, { recursive: true, force: true });
await mkdir(path.join(projectDir, 'assets'), { recursive: true });
await run('ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=1',
  '-pix_fmt', 'yuv420p', path.join(projectDir, 'assets/sample.mp4')
]);
const editPath = path.join(projectDir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
edit.sources.push({ id: 'sample', path: 'assets/sample.mp4' });
edit.tracks.push({ id: 'v5', lane: 'visual', items: [{
  id: 'video', at: 120, duration: 30,
  source: { kind: 'media', src: 'sample', in: 0, out: 1 }
}] });
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(projectDir, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared focus-mode L1 fixture at ${projectDir}`);
