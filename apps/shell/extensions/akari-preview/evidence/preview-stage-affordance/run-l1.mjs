import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  connectMain,
  connectPreview,
  evalOn,
} from '../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../preview-writeback-v2/scripts/cdp-lib.mjs';

const [, , portArg, projectDir, evidenceDir] = process.argv;
const port = Number(portArg);
const fail = message => { throw new Error(message); };

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
await evalOn(main, `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  const commands = window.theia.container.get(commandClass);
  void commands.executeCommand('akari.preview.seekOutput', { editUri: ${JSON.stringify(editUri)}, time: 1.5 });
  return true;
})()`);
await sleep(3000);

const { cdp, contextId } = await connectPreview(port, 40);
const ev = expression => evalOn(cdp, expression, contextId);
const ready = await ev(`(async () => {
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    const video = document.getElementById('preview-video');
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      return { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
})()`);
if (!ready) fail('preview video did not become ready');

const setTheme = async (themeId, expectedClass, fileName) => {
  const switched = await evalOn(main, `(() => {
    const bindings = window.theia.container._bindingDictionary;
    const themeClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.setCurrentTheme === 'function'
      && typeof key.prototype?.getThemes === 'function');
    if (!themeClass) return null;
    const themes = window.theia.container.get(themeClass);
    themes.setCurrentTheme(${JSON.stringify(themeId)}, false);
    return themes.getCurrentTheme()?.id || null;
  })()`);
  if (switched !== themeId) fail(`theme switch failed: ${themeId}`);
  const observed = await ev(`(async () => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      if (document.body.classList.contains(${JSON.stringify(expectedClass)})) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const pane = document.querySelector('.preview-pane');
    const wrapper = document.getElementById('preview-wrapper');
    return {
      bodyClass: document.body.className,
      pasteboard: getComputedStyle(pane).backgroundColor,
      canvas: getComputedStyle(wrapper).backgroundColor,
      edge: getComputedStyle(wrapper).boxShadow,
    };
  })()`);
  if (!observed.bodyClass.split(/\s+/).includes(expectedClass)) {
    fail(`webview theme class missing: ${expectedClass}`);
  }
  if (observed.canvas !== 'rgb(0, 0, 0)' || observed.edge === 'none') {
    fail(`canvas boundary style missing for ${themeId}`);
  }
  await screenshot(cdp, path.join(evidenceDir, fileName));
  return observed;
};

const dark = await setTheme('dark', 'vscode-dark', 'dark.png');
const light = await setTheme('light', 'vscode-light', 'light.png');
await setTheme('dark', 'vscode-dark', 'dark-final.png');

const snap = await ev(`(async () => {
  const waitPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const video = document.getElementById('preview-video');
  const wrapper = document.getElementById('preview-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();
  const selectPoint = { x: wrapperRect.left + wrapperRect.width / 2,
    y: wrapperRect.top + wrapperRect.height / 2 };
  const selectCommon = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse',
    isPrimary: true, button: 0, shiftKey: false };
  video.dispatchEvent(new PointerEvent('pointerdown', {
    ...selectCommon, pointerId: 8400, buttons: 1, clientX: selectPoint.x, clientY: selectPoint.y,
  }));
  window.dispatchEvent(new PointerEvent('pointerup', {
    ...selectCommon, pointerId: 8400, buttons: 0, clientX: selectPoint.x, clientY: selectPoint.y,
  }));
  await waitPaint();

  const box = document.getElementById('cut-select-box');
  if (!box.classList.contains('is-active')) return { error: 'cut selection did not activate' };
  const output = window.akari.interaction.outputSize();
  const definitions = {
    nw: { dx: 5, dy: 5, targetX: 0, targetY: 0 },
    ne: { dx: -5, dy: 5, targetX: output.width, targetY: 0 },
    se: { dx: -5, dy: -5, targetX: output.width, targetY: output.height },
    sw: { dx: 5, dy: -5, targetX: 0, targetY: output.height },
  };
  const cutCornerFromDataset = corner => {
    const transform = {
      x: Number(video.dataset.akariTransformX),
      y: Number(video.dataset.akariTransformY),
      scale: Number(video.dataset.akariTransformScale),
    };
    const anchor = {
      x: output.width / 2 + transform.x,
      y: output.height / 2 + transform.y,
    };
    return {
      x: anchor.x + (corner.includes('w') ? -1 : 1) * output.width * transform.scale / 2,
      y: anchor.y + (corner.includes('n') ? -1 : 1) * output.height * transform.scale / 2,
      scale: transform.scale,
    };
  };
  const results = [];
  let pointerId = 8500;
  for (const [corner, definition] of Object.entries(definitions)) {
    const handle = box.querySelector('[data-akari-handle="' + corner + '"]');
    const handleRect = handle.getBoundingClientRect();
    const start = { x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 };
    const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse',
      isPrimary: true, button: 0, shiftKey: false, pointerId: pointerId++ };
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      ...common, buttons: 1, clientX: start.x, clientY: start.y,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      ...common, buttons: 1, clientX: start.x + definition.dx, clientY: start.y + definition.dy,
    }));
    await waitPaint();
    const cornerStage = cutCornerFromDataset(corner);
    const guides = [...document.querySelectorAll('.akari-interaction-snap-guide')]
      .filter(guide => !guide.hidden)
      .map(guide => ({ kind: guide.getAttribute('data-akari-interaction'), left: guide.style.left, top: guide.style.top }));
    results.push({
      corner,
      x: cornerStage.x,
      y: cornerStage.y,
      targetX: definition.targetX,
      targetY: definition.targetY,
      errorX: Math.abs(cornerStage.x - definition.targetX),
      errorY: Math.abs(cornerStage.y - definition.targetY),
      scale: cornerStage.scale,
      guides,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitPaint();
  }

  const shiftHandle = box.querySelector('[data-akari-handle="se"]');
  const shiftRect = shiftHandle.getBoundingClientRect();
  const shiftStart = { x: shiftRect.left + shiftRect.width / 2, y: shiftRect.top + shiftRect.height / 2 };
  const shiftCommon = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse',
    isPrimary: true, button: 0, shiftKey: true, pointerId: 8600 };
  shiftHandle.dispatchEvent(new PointerEvent('pointerdown', {
    ...shiftCommon, buttons: 1, clientX: shiftStart.x, clientY: shiftStart.y,
  }));
  window.dispatchEvent(new PointerEvent('pointermove', {
    ...shiftCommon, buttons: 1, clientX: shiftStart.x - 5, clientY: shiftStart.y - 5,
  }));
  await waitPaint();
  const shiftCornerStage = cutCornerFromDataset('se');
  const shift = {
    x: shiftCornerStage.x,
    y: shiftCornerStage.y,
    errorX: Math.abs(shiftCornerStage.x - output.width),
    errorY: Math.abs(shiftCornerStage.y - output.height),
    scale: shiftCornerStage.scale,
    guidesVisible: [...document.querySelectorAll('.akari-interaction-snap-guide')].some(guide => !guide.hidden),
  };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitPaint();
  return { output, results, shift };
})()`);

if (snap.error) fail(snap.error);
for (const result of snap.results) {
  if (result.errorX > 0.1 || result.errorY > 0.1) fail(`corner did not snap: ${result.corner}`);
  if (result.guides.length !== 1) fail(`snap guide missing: ${result.corner}`);
}
if (snap.shift.guidesVisible || (snap.shift.errorX < 0.5 && snap.shift.errorY < 0.5)) {
  fail('Shift did not disable snapping');
}

const measurements = { ready, dark, light, snap };
await writeFile(path.join(evidenceDir, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
console.log(JSON.stringify(measurements, null, 2));
cdp.close();
main.close();
