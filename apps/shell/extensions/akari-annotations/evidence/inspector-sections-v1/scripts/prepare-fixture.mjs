#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , workspaceDir] = process.argv;
const fieldtestDir = process.env.AKARI_FIELDTEST_DIR;
if (!workspaceDir || !fieldtestDir) {
  throw new Error('usage: AKARI_FIELDTEST_DIR=<v2-project> node prepare-fixture.mjs <workspaceDir>');
}

const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const projectDir = path.join(workspaceDir, 'project');
const overlaySource = path.join(repositoryDir, 'assets', 'overlay', 'lower-third-clean');
const overlayTarget = path.join(projectDir, 'overlays', 'lower-third-clean');

await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(fieldtestDir, projectDir, { recursive: true, force: true });
await rm(overlayTarget, { recursive: true, force: true });
await cp(overlaySource, overlayTarget, { recursive: true, force: true });

const editPath = path.join(projectDir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
let lowerThird;
for (const track of edit.tracks ?? []) {
  if (!Array.isArray(track.items)) continue;
  const item = track.items.find(candidate => candidate?.id === 'lower-third');
  if (item) {
    lowerThird = item;
    break;
  }
}
if (!lowerThird || !lowerThird.source || lowerThird.source.kind !== 'html') {
  throw new Error("v2 fixture does not contain the expected html item id='lower-third'");
}
lowerThird.source.path = 'overlays/lower-third-clean/fragment.html';
lowerThird.source.vars = {
  ...(lowerThird.source.vars ?? {}),
  '--primary-color': '#101820',
  '--font-size': '40'
};

await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
console.log(`prepared inspector L1 fixture at ${editPath}`);
