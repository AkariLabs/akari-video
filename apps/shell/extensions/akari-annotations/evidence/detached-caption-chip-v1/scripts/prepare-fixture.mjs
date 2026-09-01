#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const [, , workspaceDir, sourceProjectArg] = process.argv;
const sourceProject = sourceProjectArg ?? process.env.AKARI_FIELDTEST_DIR;
if (!workspaceDir || !sourceProject) {
  throw new Error('usage: prepare-fixture.mjs <workspaceDir> <object-tree-fieldtest>');
}

const projectDir = path.join(workspaceDir, 'project');
await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(sourceProject, projectDir, { recursive: true, force: true });
console.log(`prepared detached-caption-chip L1 fixture at ${projectDir}`);
