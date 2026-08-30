#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadAndBuildOsrPage } from '../../../../../../../packages/osr-export/src/page-builder.mjs';
import { readRenderEdit } from '../../../../../../../packages/render-cut/src/internal-render.mjs';
import { loadCaptions, renderProject } from '../../../../../../../packages/render-cut/src/render-cut.mjs';

const [, , projectArg] = process.argv;
if (!projectArg) throw new Error('usage: run-regression.mjs <projectDir>');
const projectRoot = path.resolve(projectArg);
const errors = [];
const result = {
  captionOverlays: null,
  osrPage: null,
  plan: null,
  captionsSha: null,
  errors,
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const attempt = async (name, operation) => {
  try { result[name] = await operation(); }
  catch (error) { errors.push({ item: name, message: error?.message ?? String(error) }); }
};

await attempt('captionOverlays', async () => {
  const editText = await readFile(path.join(projectRoot, 'edit.json'), 'utf8');
  const edit = readRenderEdit(editText, path.join(projectRoot, '.akari', 'render-tmp')).edit;
  const loaded = await loadCaptions(projectRoot, edit);
  const json = JSON.stringify(loaded.overlays);
  return { sha256: sha256(json), overlays: loaded.overlays.length, captions: loaded.captions.length };
});
await attempt('osrPage', async () => {
  const page = await loadAndBuildOsrPage({ projectRoot });
  return { sha256: sha256(page.html), bytes: Buffer.byteLength(page.html) };
});
await attempt('plan', async () => {
  const state = await renderProject(projectRoot, {
    planOnly: true,
    force: true,
    writeState: false,
    temporaryDirectory: path.join(projectRoot, '.akari', 'render-tmp'),
  }, { log() {}, error() {}, warn() {} });
  return { sha256: sha256(JSON.stringify(state.plan)) };
});
await attempt('captionsSha', async () => sha256(await readFile(path.join(projectRoot, 'captions.json'))));

process.stdout.write(`${JSON.stringify(result)}\n`);
