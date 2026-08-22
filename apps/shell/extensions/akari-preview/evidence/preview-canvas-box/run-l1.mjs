import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  connectMain,
  connectPreview,
  evalOn,
} from '../preview-writeback-v2/scripts/lib.mjs';
import { realClick, realDrag, screenshot } from '../preview-writeback-v2/scripts/cdp-lib.mjs';

const [, , phase, portArg, projectDir, evidenceDir] = process.argv;
const port = Number(portArg);
const fail = message => { throw new Error(message); };
const expectedRatio = 16 / 9;

if (!['before', 'after'].includes(phase)) fail('phase must be before or after');
await mkdir(evidenceDir, { recursive: true });

const main = await connectMain(port);
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evalOn(main, '!!(window.theia && window.theia.container)')) break;
  await sleep(500);
}

const editPath = path.join(projectDir, 'edit.json');
const editUri = `file://${editPath}`;
await evalOn(main, `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  const commands = window.theia.container.get(commandClass);
  void commands.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} });
  return true;
})()`);
await sleep(5500);

const { cdp, contextId } = await connectPreview(port, 40);
const ev = expression => evalOn(cdp, expression, contextId);
const ready = await ev(`(async () => {
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    const video = document.getElementById('preview-video');
    if (video && video.readyState >= 2 && video.videoWidth === 1920 && video.videoHeight === 1080) {
      return { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
})()`);
if (!ready) fail('1920x1080 preview video did not become ready');

const { windowId } = await main.send('Browser.getWindowForTarget');
const cases = [
  { name: 'wide', width: 1600, height: 720 },
  { name: 'tall', width: 900, height: 1100 },
  { name: 'balanced', width: 1280, height: 880 },
];
const measurements = [];

for (const testCase of cases) {
  await main.send('Browser.setWindowBounds', {
    windowId,
    bounds: { width: testCase.width, height: testCase.height },
  });
  await sleep(1400);
  await ev(`document.querySelector('.zoom-preset[data-zoom="1"]').click()`);
  await sleep(250);
  const measured = await ev(`(() => {
    const plain = rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      right: rect.right, bottom: rect.bottom });
    const pane = document.querySelector('.preview-pane');
    const wrapper = document.getElementById('preview-wrapper');
    const video = document.getElementById('preview-video');
    const zoomLayer = document.getElementById('zoom-layer');
    const wrapperRect = wrapper.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const frameRect = window.akari.computeOutputFrameRect();
    return {
      pane: plain(pane.getBoundingClientRect()),
      wrapper: plain(wrapperRect),
      video: plain(videoRect),
      frame: frameRect,
      wrapperRatio: wrapperRect.width / wrapperRect.height,
      ratioError: Math.abs(wrapperRect.width / wrapperRect.height - ${expectedRatio}),
      frameInset: Math.max(Math.abs(frameRect.x), Math.abs(frameRect.y),
        Math.abs(frameRect.width - wrapperRect.width), Math.abs(frameRect.height - wrapperRect.height)),
      videoInset: Math.max(Math.abs(videoRect.left - wrapperRect.left), Math.abs(videoRect.top - wrapperRect.top),
        Math.abs(videoRect.right - wrapperRect.right), Math.abs(videoRect.bottom - wrapperRect.bottom)),
      canvas: getComputedStyle(wrapper).backgroundColor,
      edge: getComputedStyle(wrapper).boxShadow,
      pasteboard: getComputedStyle(pane).backgroundColor,
      overflow: getComputedStyle(zoomLayer).overflow,
      zoomTransform: zoomLayer.style.transform,
    };
  })()`);
  measurements.push({ case: testCase, ...measured });
  await screenshot(cdp, path.join(evidenceDir, `${phase}-${testCase.name}.png`));
}

if (phase === 'before') {
  const wide = measurements.find(item => item.case.name === 'wide');
  if (!(wide.ratioError > 0.05) || !(wide.frameInset > 1)) {
    fail('wide-window fake margin was not reproduced');
  }
} else {
  for (const item of measurements) {
    if (item.ratioError > 0.002) fail(`canvas box ratio mismatch: ${item.case.name}`);
    if (item.frameInset > 0.1) fail(`frameRect is not the canvas box: ${item.case.name}`);
    if (item.videoInset > 0.5) fail(`100% video has a visible inset: ${item.case.name}`);
    if (item.canvas !== 'rgb(0, 0, 0)' || item.edge !== 'none') {
      fail(`canvas boundary style mismatch: ${item.case.name}`);
    }
    if (item.overflow !== 'hidden') fail(`canvas clipping mismatch: ${item.case.name}`);
  }
}

const theme = async (themeId, expectedClass) => {
  const switched = await evalOn(main, `(() => {
    const bindings = window.theia.container._bindingDictionary;
    const themeClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.setCurrentTheme === 'function'
      && typeof key.prototype?.getThemes === 'function');
    const themes = window.theia.container.get(themeClass);
    themes.setCurrentTheme(${JSON.stringify(themeId)}, false);
    return themes.getCurrentTheme()?.id || null;
  })()`);
  if (switched !== themeId) fail(`theme switch failed: ${themeId}`);
  return ev(`(async () => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline && !document.body.classList.contains(${JSON.stringify(expectedClass)})) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const pane = document.querySelector('.preview-pane');
    const wrapper = document.getElementById('preview-wrapper');
    return { bodyClass: document.body.className, pasteboard: getComputedStyle(pane).backgroundColor,
      canvas: getComputedStyle(wrapper).backgroundColor, edge: getComputedStyle(wrapper).boxShadow };
  })()`);
};

const dark = await theme('dark', 'vscode-dark');
const light = await theme('light', 'vscode-light');
await theme('dark', 'vscode-dark');

let zoom = null;
let snap = null;
let fullscreen = null;
if (phase === 'after') {
  if (dark.pasteboard !== 'rgb(43, 45, 48)' || light.pasteboard !== 'rgb(213, 215, 218)'
      || dark.canvas !== 'rgb(0, 0, 0)' || light.canvas !== 'rgb(0, 0, 0)'
      || dark.edge !== 'none' || light.edge !== 'none') {
    fail('light/dark canvas or pasteboard style mismatch');
  }

  zoom = await ev(`(async () => {
    const wrapper = document.getElementById('preview-wrapper');
    const before = wrapper.getBoundingClientRect();
    document.querySelector('.zoom-preset[data-zoom="2"]').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = wrapper.getBoundingClientRect();
    const zoomLayer = document.getElementById('zoom-layer');
    const result = { before: { width: before.width, height: before.height },
      after: { width: after.width, height: after.height }, transform: zoomLayer.style.transform,
      overflow: getComputedStyle(zoomLayer).overflow };
    document.querySelector('.zoom-preset[data-zoom="1"]').click();
    return result;
  })()`);
  if (!/scale\(2\)/.test(zoom.transform) || zoom.overflow !== 'hidden'
      || Math.abs(zoom.before.width - zoom.after.width) > 0.1
      || Math.abs(zoom.before.height - zoom.after.height) > 0.1) {
    fail('zoom changed or escaped the canvas box');
  }

  const panStart = await ev(`(() => {
    document.querySelector('.zoom-preset[data-zoom="2"]').click();
    const rect = document.getElementById('preview-wrapper').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await realDrag(cdp, [panStart, { x: panStart.x + 50, y: panStart.y + 30 }]);
  await sleep(250);
  zoom.panTransform = await ev(`document.getElementById('zoom-layer').style.transform`);
  await ev(`document.querySelector('.zoom-preset[data-zoom="1"]').click()`);
  if (/translate\(0\.000%, 0\.000%\)/.test(zoom.panTransform)) fail('pan did not move the zoom layer');

  const fullscreenPoint = await ev(`(() => {
    const rect = document.getElementById('fullscreen-toggle').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await realClick(cdp, fullscreenPoint.x, fullscreenPoint.y);
  await sleep(750);
  fullscreen = await ev(`(() => {
    const rect = document.getElementById('preview-wrapper').getBoundingClientRect();
    return { active: Boolean(document.fullscreenElement), width: rect.width, height: rect.height,
      ratio: rect.width / rect.height };
  })()`);
  await screenshot(cdp, path.join(evidenceDir, 'after-fullscreen.png'));
  if (!fullscreen.active || Math.abs(fullscreen.ratio - ${expectedRatio}) > 0.002) {
    fail('fullscreen canvas box ratio mismatch');
  }
  await ev(`document.exitFullscreen()`);
  await sleep(500);

  snap = await ev(`(() => {
    const output = window.akari.interaction.outputSize();
    const left = window.akari.interaction.computeSnapCorrection({
      left: 3, centerX: 500, right: 700, top: 3, centerY: 400, bottom: 600,
    }, null);
    const right = window.akari.interaction.computeSnapCorrection({
      left: 1000, centerX: 1400, right: output.width - 3,
      top: 700, centerY: 800, bottom: output.height - 3,
    }, null);
    return { output, left, right };
  })()`);
  if (snap.output.width !== 1920 || snap.output.height !== 1080
      || snap.left.x?.target !== 0 || snap.left.y?.target !== 0
      || snap.right.x?.target !== 1920 || snap.right.y?.target !== 1080) {
    fail('canvas edge snapping is not based on output coordinates');
  }
}

const result = { phase, ready, measurements, themes: { dark, light }, zoom, fullscreen, snap };
await writeFile(path.join(evidenceDir, `${phase}-measurements.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
cdp.close();
main.close();
