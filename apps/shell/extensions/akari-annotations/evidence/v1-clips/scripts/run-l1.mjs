#!/usr/bin/env node
// Dependency-free raw-CDP acceptance driver for edit.json v1 clip media.
// Usage: node run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CDP, evalOn, keyPress, listTargets, realClick, screenshot
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , cdpPortArg, workspaceDir, evidenceDir] = process.argv;
const cdpPort = Number(cdpPortArg || 9333);
if (!workspaceDir || !evidenceDir) {
  throw new Error('usage: run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureProject = path.resolve(scriptDir, '../fixture/project');
const projectDir = path.join(workspaceDir, 'project');
const editPath = path.join(projectDir, 'edit.json');
const log = [];

function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data = {}) {
  if (!condition) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}

async function openTimeline(main) {
  let found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(500);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 20 && !found; wait++) {
      await sleep(250);
      found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    }
  }
  assert(found, 'timeline widget opened');
}

async function clipState(main) {
  return evalOn(main, `(async () => {
    const elements = Array.from(document.querySelectorAll('.akari-annotations-strip-clip'));
    const sample = async element => {
      const backgroundImage = getComputedStyle(element).backgroundImage;
      const match = /^url\\(["']?(.*?)["']?\\)$/.exec(backgroundImage);
      let pixel = null;
      if (match) {
        pixel = await new Promise(resolve => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            resolve(Array.from(context.getImageData(
              Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1
            ).data.slice(0, 3)));
          };
          image.onerror = () => resolve(null);
          image.src = match[1];
        });
      }
      const badge = element.querySelector('.akari-annotations-strip-clip-source');
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.akariItemId,
        sourceId: badge?.dataset.akariSourceId ?? null,
        sourcePath: badge?.title ?? null,
        backgroundImage,
        pixel,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    };
    return Promise.all(elements.map(sample));
  })()`);
}

async function waitForClips(main, count, requireMedia = true) {
  const deadline = Date.now() + 15000;
  let state = [];
  while (Date.now() < deadline) {
    state = await clipState(main);
    if (state.length === count && (!requireMedia || state.every(clip => clip.pixel))) {
      return state;
    }
    await sleep(250);
  }
  throw new Error(`clips did not settle: ${JSON.stringify(state)}`);
}

async function reloadTimeline(main) {
  await main.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  await openTimeline(main);
}

async function installFixtureFiles() {
  await mkdir(projectDir, { recursive: true });
  await mkdir(path.join(workspaceDir, '.akari/sidecars/source-red.mp4.analysis'), { recursive: true });
  for (const name of ['source-red.mp4', 'source-blue.mp4', 'edit.json']) {
    await copyFile(path.join(fixtureProject, name), path.join(projectDir, name));
  }
  await copyFile(
    path.resolve(fixtureProject, '../.akari/sidecars/source-red.mp4.analysis/analysis.json'),
    path.join(workspaceDir, '.akari/sidecars/source-red.mp4.analysis/analysis.json')
  );
}

async function selectFirstClipAndInspect(main, firstClip) {
  await realClick(main, firstClip.centerX, firstClip.centerY);
  const deadline = Date.now() + 8000;
  let fields = {};
  while (Date.now() < deadline) {
    fields = await evalOn(main, `Object.fromEntries(Array.from(
      document.querySelectorAll('.akari-inspector-widget .akari-inspector-row')
    ).map(row => [
      row.querySelector('.akari-inspector-row-label')?.textContent,
      row.querySelector('.akari-inspector-row-value')?.textContent
    ]))`);
    if (fields.src === 's1') {
      break;
    }
    await sleep(250);
  }
  assert(fields.src === 's1' && fields['source path'] === 'source-red.mp4',
    'v1 inspector exposes src and source path', { fields });
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  await installFixtureFiles();
  const targets = await listTargets(cdpPort);
  const page = targets.find(target => target.type === 'page');
  if (!page) {
    throw new Error('main page target not found');
  }
  const main = new CDP(page.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await openTimeline(main);

  const v1 = await waitForClips(main, 3);
  assert(v1.map(clip => clip.sourceId).join(',') === 's1,s2,s1',
    'v1 clips expose source badges in cut order', { clips: v1 });
  assert(v1[0].pixel[0] > 200 && v1[0].pixel[2] < 40
      && v1[1].pixel[2] > 200 && v1[1].pixel[0] < 40
      && v1[2].pixel[0] > 200 && v1[2].pixel[2] < 40,
  'each v1 clip thumbnail comes from its referenced source', { pixels: v1.map(clip => clip.pixel) });
  assert(v1[0].backgroundImage !== v1[1].backgroundImage,
    'same in/out clips with different src do not share a thumbnail cache entry', {
      firstPixel: v1[0].pixel, secondPixel: v1[1].pixel
    });
  await selectFirstClipAndInspect(main, v1[0]);
  await screenshot(main, path.join(evidenceDir, '01-v1-source-thumbnails.png'));

  await copyFile(path.join(fixtureProject, 'edit-invalid-src.json'), editPath);
  await reloadTimeline(main);
  const degraded = await waitForClips(main, 2);
  const notice = await evalOn(main, `document.querySelector(
    '#akari-annotations-widget .akari-annotations-notice'
  )?.textContent ?? document.getElementById('akari-annotations-widget')?.children[3]?.textContent ?? ''`);
  assert(degraded.map(clip => clip.sourceId).join(',') === 's1,s2',
    'one unresolved src cut is skipped while valid siblings render', {
      sourceIds: degraded.map(clip => clip.sourceId), notice
    });
  assert(notice.includes('src'),
    'unresolved src cut emits a warning', { notice });
  await screenshot(main, path.join(evidenceDir, '02-invalid-src-degrades.png'));

  await copyFile(path.join(fixtureProject, 'edit-v0.json'), editPath);
  await reloadTimeline(main);
  const v0 = await waitForClips(main, 2);
  assert(v0.every(clip => clip.sourceId === null && clip.sourcePath === null),
    'v0 clips keep the legacy appearance without source badges', { clips: v0 });
  assert(v0.every(clip => clip.pixel[0] > 200 && clip.pixel[2] < 40),
    'v0 thumbnails still use the legacy analysis videoUri', { pixels: v0.map(clip => clip.pixel) });
  await screenshot(main, path.join(evidenceDir, '03-v0-nonregression.png'));

  await writeFile(path.join(evidenceDir, 'run-log-final.json'), JSON.stringify(log, null, 2));
  main.close();
  console.log('ALL ACCEPTANCE CRITERIA PASSED');
}

main().catch(async error => {
  console.error('FAILED', error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log-partial.json'), JSON.stringify(log, null, 2));
  process.exit(1);
});
