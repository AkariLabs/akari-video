#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , workspaceDir] = process.argv;
const mode = process.env.AKARI_L1_MODE === 'legacy' ? 'legacy' : 'v2';
const fieldtestDir = mode === 'legacy'
  ? process.env.AKARI_FIELDTEST_V1_DIR
  : process.env.AKARI_FIELDTEST_DIR;
if (!workspaceDir || !fieldtestDir) {
  throw new Error(mode === 'legacy'
    ? 'usage: AKARI_L1_MODE=legacy AKARI_FIELDTEST_V1_DIR=<v1-project> node prepare-fixture.mjs <workspaceDir>'
    : 'usage: AKARI_FIELDTEST_DIR=<v2-project> node prepare-fixture.mjs <workspaceDir>');
}

const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const projectDir = path.join(workspaceDir, 'project');
const overlaySource = path.join(repositoryDir, 'assets', 'overlay', 'lower-third-clean');
const overlayTarget = path.join(projectDir, 'overlays', 'lower-third-clean');

await rm(projectDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await cp(fieldtestDir, projectDir, { recursive: true, force: true });

const editPath = path.join(projectDir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
if (mode === 'v2') {
  await rm(overlayTarget, { recursive: true, force: true });
  await cp(overlaySource, overlayTarget, { recursive: true, force: true });

  let lowerThird;
  let cutA;
  let telopChapter;
  for (const track of edit.tracks ?? []) {
    if (!Array.isArray(track.items)) continue;
    lowerThird ??= track.items.find(candidate => candidate?.id === 'lower-third');
    cutA ??= track.items.find(candidate => candidate?.id === 'cut-a');
    telopChapter ??= track.items.find(candidate => candidate?.id === 'telop-chapter');
  }
  if (!lowerThird || !lowerThird.source || lowerThird.source.kind !== 'html') {
    throw new Error("v2 fixture does not contain the expected html item id='lower-third'");
  }
  if (!cutA || cutA.source?.kind !== 'media') {
    throw new Error("v2 fixture does not contain the expected media item id='cut-a'");
  }
  if (!telopChapter || telopChapter.source?.kind !== 'telop') {
    throw new Error("v2 fixture does not contain the expected telop item id='telop-chapter'");
  }
  lowerThird.source.path = 'overlays/lower-third-clean/fragment.html';
  lowerThird.source.vars = {
    ...(lowerThird.source.vars ?? {}),
    '--primary-color': '#101820',
    '--font-size': '40'
  };
  cutA.source.chroma_key = { color: '#00ff00', similarity: 0.1, blend: 0 };
} else {
  const legacyLayer = Array.isArray(edit.layers)
    ? edit.layers.find(candidate => candidate?.id) : undefined;
  if (!legacyLayer) {
    throw new Error('v1 fixture does not contain a layer with an id');
  }
  legacyLayer.transform = legacyLayer.transform && typeof legacyLayer.transform === 'object'
    ? legacyLayer.transform : {};
  delete legacyLayer.transform.scale;
}

await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
console.log(`prepared inspector L1 ${mode} fixture at ${editPath}`);
