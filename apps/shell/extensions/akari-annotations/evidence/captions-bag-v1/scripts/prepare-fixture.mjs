#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , workspaceDir, sourceProject] = process.argv;
if (!workspaceDir) throw new Error('usage: prepare-fixture.mjs <workspaceDir> [sourceProject]');

const repository = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const fixture = fileURLToPath(new URL('../fixture/', import.meta.url));
const project = path.join(workspaceDir, 'project');
await rm(project, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
if (sourceProject) {
  await cp(sourceProject, project, { recursive: true, force: true });
} else {
  await cp(path.join(repository, 'templates/project-default'), project, { recursive: true, force: true });
}
await cp(fixture, project, { recursive: true, force: true });
console.log(`prepared captions-bag L1 fixture at ${project}`);
