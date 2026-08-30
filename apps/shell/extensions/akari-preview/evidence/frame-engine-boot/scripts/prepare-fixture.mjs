#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const [, , workspaceDir, repoDir, fixtureDir] = process.argv;
if (!workspaceDir || !repoDir || !fixtureDir) {
  throw new Error('usage: prepare-fixture.mjs <workspaceDir> <repoDir> <fixtureDir>');
}

const projectDir = path.join(workspaceDir, 'project');
await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(path.join(repoDir, 'templates/project-default'), projectDir, { recursive: true, force: true });
await cp(fixtureDir, projectDir, { recursive: true, force: true });
await rm(path.join(projectDir, 'README.md'), { force: true });
console.log(`prepared fixture at ${projectDir}`);
