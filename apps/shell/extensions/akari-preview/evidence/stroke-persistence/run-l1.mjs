import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { connectMain, connectPreview, evalOn } from '../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../preview-writeback-v2/scripts/cdp-lib.mjs';

const [, , portArg, projectDir, evidenceDir] = process.argv;
const port = Number(portArg);
const fail = message => { throw new Error(message); };
await mkdir(evidenceDir, { recursive: true });

const main = await connectMain(port);
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evalOn(main, '!!(window.theia && window.theia.container)')) break;
  await sleep(500);
}
const editUri = `file://${path.join(projectDir, 'edit.json')}`;
const projectRootUri = `file://${projectDir}`;
const command = id => `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  return window.theia.container.get(commandClass).executeCommand(${JSON.stringify(id)},
    { editUri: ${JSON.stringify(editUri)} });
})()`;
await evalOn(main, command('akari.preview.ensureVisible'));
await sleep(4500);
await evalOn(main, command('akari.review.open'));
await sleep(1200);
await evalOn(main, `window.dispatchEvent(new CustomEvent('akari.review.session.refresh', { detail: {
  projectRootUri: ${JSON.stringify(projectRootUri)}, editUri: ${JSON.stringify(editUri)}
} })); true`);

const controls = await evalOn(main, `(async () => {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const toggle = document.querySelector('[data-review-stroke-visibility] input');
    const replay = document.querySelector('[data-review-session-strokes="s-0001"]');
    if (toggle && replay) return { checked: toggle.checked, replayTitle: replay.title };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
})()`);
if (!controls?.checked) fail('annotation-panel stroke toggle was not installed default-on');

const { cdp, contextId } = await connectPreview(port, 40);
const ev = expression => evalOn(cdp, expression, contextId);
const ready = await ev(`(async () => {
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    const video = document.getElementById('preview-video');
    const layer = document.getElementById('pen-layer');
    if (video?.readyState >= 2 && layer?.clientWidth > 100) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
})()`);
if (!ready) fail('preview did not become ready');

await ev(`(() => {
  window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'akari-preview-set-review-recording', active: true, mode: 'pen'
  } }));
  const layer = document.getElementById('pen-layer');
  layer.setPointerCapture = () => {};
  layer.releasePointerCapture = () => {};
  layer.hasPointerCapture = () => false;
  const rect = layer.getBoundingClientRect();
  const point = (type, pointerId, nx, ny, buttons) => layer.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons, clientX: rect.left + rect.width * nx, clientY: rect.top + rect.height * ny
  }));
  point('pointerdown', 7001, 0.2, 0.25, 1);
  point('pointermove', 7001, 0.4, 0.6, 1);
  point('pointermove', 7001, 0.75, 0.35, 1);
  point('pointerup', 7001, 0.75, 0.35, 0);
  return true;
})()`);
await sleep(150);

const alphaCount = () => ev(`(() => {
  const canvas = document.getElementById('pen-layer');
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
  return { count, width: canvas.width, height: canvas.height,
    persistentVisible: canvas.dataset.akariPersistentVisible ?? 'unset' };
})()`);

const immediate = await alphaCount();
if (!(immediate.count > 0)) fail('stroke was not visible immediately');
await screenshot(main, path.join(evidenceDir, '01-immediate.png'));
await sleep(5200);
const afterFiveSeconds = await alphaCount();
if (!(afterFiveSeconds.count > 0)) fail('stroke disappeared after five seconds');
await screenshot(main, path.join(evidenceDir, '02-after-5s.png'));

await evalOn(main, `(() => {
  const input = document.querySelector('[data-review-stroke-visibility] input');
  input.checked = false;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.checked;
})()`);
await sleep(250);
const toggleOff = await alphaCount();
if (toggleOff.count !== 0) fail('toggle off did not hide strokes');
await screenshot(main, path.join(evidenceDir, '03-toggle-off.png'));

await evalOn(main, `(() => {
  const input = document.querySelector('[data-review-stroke-visibility] input');
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.checked;
})()`);
await sleep(250);
const toggleOn = await alphaCount();
if (!(toggleOn.count > 0)) fail('toggle on did not restore strokes');
await screenshot(main, path.join(evidenceDir, '04-toggle-on.png'));

await evalOn(main, `document.querySelector('[data-review-session-strokes="s-0001"]').click(); true`);
await sleep(1200);
const replay = await ev(`(() => {
  const canvas = document.getElementById('pen-layer');
  return { sessionId: canvas.dataset.akariStrokeSession,
    targetTab: canvas.dataset.akariStrokeTargetTab,
    targetRecT: Number(canvas.dataset.akariStrokeTargetRecT) };
})()`);
if (replay.sessionId !== 's-0001' || replay.targetTab !== editUri || replay.targetRecT !== 2.5) {
  fail(`session replay target mismatch: ${JSON.stringify(replay)}`);
}
const replayPixels = await alphaCount();
if (!(replayPixels.count > 0)) fail('session replay produced no visible pixels');
await screenshot(main, path.join(evidenceDir, '05-session-replay.png'));

const result = { controls, immediate, afterFiveSeconds, toggleOff, toggleOn, replay, replayPixels };
await writeFile(path.join(evidenceDir, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
cdp.close();
main.close();
