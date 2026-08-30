#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

const [, , workspaceDir] = process.argv;
if (!workspaceDir) throw new Error('usage: prepare-fixture.mjs <workspaceDir>');

const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const projectDir = path.join(workspaceDir, 'project');
const fixtureDir = path.join(repositoryDir, 'packages/render-cut/test/fixtures/object-tree-html-bag');
await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(path.join(repositoryDir, 'templates/project-default'), projectDir, { recursive: true, force: true });
await cp(fixtureDir, projectDir, { recursive: true, force: true });
const editPath = path.join(projectDir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(projectDir, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared timeline-tree L1 fixture at ${projectDir}`);
