#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [projectDirArgument] = process.argv.slice(2);
if (!projectDirArgument) throw new Error('usage: prepare-fixture.mjs <projectDir>');

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../../../..');
const fixtureRoot = path.join(repositoryRoot, 'packages/render-cut/test/fixtures/item-keyframes');
const projectDir = path.resolve(projectDirArgument);
assert.ok(projectDir.startsWith('/private/tmp/'), `projectDir must be under /private/tmp: ${projectDir}`);

await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
await cp(fixtureRoot, projectDir, { recursive: true });
const generated = await import(pathToFileURL(path.join(projectDir, 'generate.mjs')).href);
await generated.generateItemKeyframesFixture(projectDir);
assert.equal(await realpath(projectDir), projectDir);
console.log(projectDir);
