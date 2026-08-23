#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  connectMain,
  connectPreview,
  evalOn,
} from '../../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../../preview-writeback-v2/scripts/cdp-lib.mjs';

const [portText, projectDir, evidenceDir] = process.argv.slice(2);
if (!portText || !projectDir || !evidenceDir) {
  throw new Error('usage: run-l1.mjs <port> <project-dir> <evidence-dir>');
}

const port = Number(portText);
const activeEditPath = path.join(projectDir, 'edit.json');
const layerFixturePath = path.join(projectDir, 'edit-layer.json');
const editUri = `file://${activeEditPath}`;
const observations = [];
const record = (step, value) => {
  observations.push({ step, ...value });
  console.log(`[${step}] ${JSON.stringify(value)}`);
};

await mkdir(evidenceDir, { recursive: true });
let main;
let previewConnection;

const closePreview = () => {
  if (!previewConnection) return;
  try { previewConnection.cdp.close(); } catch { /* already closed */ }
  previewConnection = undefined;
};

try {
  main = await connectMain(port);
  let shellReady = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await evalOn(main, '!!(window.theia && window.theia.container)')) {
      shellReady = true;
      break;
    }
    await sleep(500);
  }
  assert.equal(shellReady, true, 'Theia shell did not become ready');

  const command = expression => evalOn(main, `(() => {
    const bindings = window.theia.container._bindingDictionary;
    const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function'
      && typeof key.prototype?.registerCommand === 'function');
    if (!commandClass) return { ok: false, reason: 'command registry not found' };
    const commands = window.theia.container.get(commandClass);
    ${expression}
    return { ok: true };
  })()`);

  const openPreview = async expectedSelector => {
    closePreview();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const opened = await command(`void commands.executeCommand('akari.preview.ensureVisible', {
        editUri: ${JSON.stringify(editUri)}
      });`);
      if (opened.ok) {
        try {
          const candidate = await connectPreview(port, 3);
          const present = await evalOn(
            candidate.cdp,
            `Boolean(document.querySelector(${JSON.stringify(expectedSelector)}))`,
            candidate.contextId
          );
          if (present) {
            previewConnection = candidate;
            record('ensure-visible-attempt', { attempt, expectedSelector, contextFound: true });
            return;
          }
          candidate.cdp.close();
        } catch { /* reload race; retry */ }
      }
      record('ensure-visible-attempt', { attempt, expectedSelector, contextFound: false });
      await sleep(500);
    }
    throw new Error(`preview context did not expose ${expectedSelector}`);
  };

  const ev = expression => {
    assert.ok(previewConnection, 'preview connection is not open');
    return evalOn(previewConnection.cdp, expression, previewConnection.contextId);
  };

  const readVisual = async selector => ev(`(() => {
    const media = document.querySelector(${JSON.stringify(selector)});
    const seek = document.getElementById('seek');
    if (!media || !seek) return null;
    return {
      timelineTime: Number(seek.value),
      readyState: media.readyState,
      natural: { width: media.videoWidth, height: media.videoHeight },
      transform: {
        x: media.dataset.akariTransformX,
        y: media.dataset.akariTransformY,
        scale: media.dataset.akariTransformScale,
        rotate: media.dataset.akariTransformRotate
      },
      crop: {
        x: media.dataset.akariCropX,
        y: media.dataset.akariCropY,
        w: media.dataset.akariCropW,
        h: media.dataset.akariCropH
      },
      perspective: media.dataset.akariPerspectiveCorners || '',
      style: {
        width: media.style.width,
        height: media.style.height,
        left: media.style.left,
        top: media.style.top,
        transformOrigin: media.style.transformOrigin,
        objectFit: media.style.objectFit,
        clipPath: media.style.clipPath,
        transform: media.style.transform,
        opacity: media.style.opacity
      }
    };
  })()`);

  const seekTo = async (time, selector, ready) => {
    const result = await command(`void commands.executeCommand('akari.preview.seekOutput', {
      editUri: ${JSON.stringify(editUri)}, time: ${time}
    });`);
    assert.equal(result.ok, true);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const state = await readVisual(selector);
      if (state && state.readyState >= 1 && Math.abs(state.timelineTime - time) <= 0.035
        && ready(state)) return state;
      await sleep(100);
    }
    throw new Error(`preview did not stabilize at ${time} for ${selector}`);
  };

  const sampleTimes = [0.25, 0.75, 2.25];
  await openPreview('#preview-video');
  const cutSamples = [];
  for (const time of sampleTimes) {
    const state = await seekTo(time, '#preview-video', value =>
      value.transform.scale !== undefined && value.crop.w !== undefined
    );
    cutSamples.push({ time, visual: { ...state, timelineTime: undefined, readyState: undefined } });
    record('cut-sample', { time, state });
  }
  await screenshot(main, path.join(evidenceDir, 'cut-classification.png'));

  const plain = await seekTo(3.25, '#preview-video', state =>
    state.style.width === '640px' && state.style.objectFit === 'contain'
  );
  assert.equal(plain.style.width, '640px');
  assert.equal(plain.style.height, '360px');
  assert.equal(plain.style.clipPath, '');
  assert.equal(plain.style.objectFit, 'contain');
  record('plain-cut-reset', { time: 3.25, state: plain });

  closePreview();
  await writeFile(activeEditPath, await readFile(layerFixturePath, 'utf8'));
  await openPreview('[data-akari-layer-id="target"]');
  const layerSamples = [];
  for (const time of sampleTimes) {
    const state = await seekTo(time, '[data-akari-layer-id="target"]', value =>
      value.transform.scale !== undefined && value.crop.w !== undefined
    );
    layerSamples.push({ time, visual: { ...state, timelineTime: undefined, readyState: undefined } });
    record('layer-sample', { time, state });
  }
  await screenshot(main, path.join(evidenceDir, 'layer-classification.png'));

  assert.deepEqual(layerSamples, cutSamples, 'cut 分類と layer 分類の実 DOM visual style が一致しない');
  record('classification-parity', { sampleTimes, cutSamples, layerSamples });

  await writeFile(
    path.join(evidenceDir, 'observations.json'),
    `${JSON.stringify({ status: 'PASS', observations }, null, 2)}\n`
  );
  console.log('CUT VISUAL FIELDS L1 PASS');
} catch (error) {
  await writeFile(
    path.join(evidenceDir, 'observations.json'),
    `${JSON.stringify({
      status: 'FAIL', observations,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`
  );
  throw error;
} finally {
  closePreview();
  if (main) {
    try { await main.send('Browser.close', {}, 5000); } catch { /* process cleanup fallback */ }
    try { main.close(); } catch { /* already closed */ }
  }
}
