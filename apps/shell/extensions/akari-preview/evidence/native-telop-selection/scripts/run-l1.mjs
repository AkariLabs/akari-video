import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  CDP,
  connectMain,
  connectPreview,
  evalOn,
} from '../../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../../preview-writeback-v2/scripts/cdp-lib.mjs';

const [, , portArg, projectDir, outDir, phase = 'probe'] = process.argv;
const port = Number(portArg);
const editPath = path.join(projectDir, 'edit.json');
const records = [];
const record = (name, value) => {
  records.push({ name, value });
  console.log(`[${name}] ${JSON.stringify(value)}`);
};

await mkdir(outDir, { recursive: true });
const main = await connectMain(port);
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evalOn(main, '!!(window.theia && window.theia.container)')) break;
  await sleep(500);
}

const editUri = `file://${editPath}`;
const openResult = await evalOn(main, `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  if (!commandClass) return { ok: false, reason: 'command registry not found' };
  const commands = window.theia.container.get(commandClass);
  void commands.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} });
  return { ok: true };
})()`);
record('open', openResult);
await sleep(5000);
await evalOn(main, `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  const commands = window.theia.container.get(commandClass);
  void commands.executeCommand('akari.preview.seekOutput', { editUri: ${JSON.stringify(editUri)}, time: 1.5 });
  return true;
})()`);
await sleep(3500);

const { cdp, contextId } = await connectPreview(port);
const ev = expression => evalOn(cdp, expression, contextId);
const readEdit = () => JSON.parse(readFileSync(editPath, 'utf8'));
const item = id => readEdit().tracks.flatMap(track => track.items ?? []).find(candidate => candidate.id === id);

const initial = {
  cut: structuredClone(item('cut-a').transform),
  overlay: structuredClone(item('lower-third').transform),
  telop: structuredClone(item('telop-chapter').transform),
};
record('initial-file', initial);

const ready = await ev(`(async () => {
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    const telop = document.querySelector('[data-akari-layer-id="telop-chapter"]');
    const lower = document.querySelector('[data-overlay-id="lower-third"]');
    if (telop && lower && telop.videoWidth > 0 && getComputedStyle(lower).visibility !== 'hidden') {
      return { telopReady: telop.readyState, telopSize: [telop.videoWidth, telop.videoHeight] };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { telopReady: 0, telopSize: [0, 0] };
})()`);
record('ready', ready);

const a = await ev(`(async () => {
  const telop = document.querySelector('[data-akari-layer-id="telop-chapter"]');
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  const selectAt = { x: innerWidth / 2, y: innerHeight / 2 };
  telop.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 7101, buttons: 1, clientX: selectAt.x, clientY: selectAt.y }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 7101, buttons: 0, clientX: selectAt.x, clientY: selectAt.y }));
  await new Promise(resolve => setTimeout(resolve, 250));
  const box = document.getElementById('layer-select-box');
  const handle = box.querySelector('[data-akari-handle="se"]');
  const before = box.getBoundingClientRect();
  const hr = handle.getBoundingClientRect();
  const start = { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 };
  handle.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 7102, buttons: 1, clientX: start.x, clientY: start.y }));
  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    window.dispatchEvent(new PointerEvent('pointermove', {
      ...common, pointerId: 7102, buttons: 1,
      clientX: start.x + 90 * ratio, clientY: start.y + 55 * ratio,
    }));
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 7102, buttons: 0, clientX: start.x + 90, clientY: start.y + 55 }));
  await new Promise(resolve => setTimeout(resolve, 700));
  const after = box.getBoundingClientRect();
  return {
    before: { left: before.left, top: before.top, right: before.right, bottom: before.bottom },
    after: { left: after.left, top: after.top, right: after.right, bottom: after.bottom },
    anchorDrift: Math.hypot(after.left - before.left, after.top - before.top),
    transform: {
      x: Number(telop.dataset.akariTransformX), y: Number(telop.dataset.akariTransformY),
      scale: Number(telop.dataset.akariTransformScale), rotate: Number(telop.dataset.akariTransformRotate),
    },
  };
})()`);
record('A-native-telop-resize', a);
record('A-file', item('telop-chapter').transform);

const b = await ev(`(async () => {
  const lower = document.querySelector('[data-overlay-id="lower-third"]');
  const fragment = [...lower.children].find(child => !child.hasAttribute('data-akari-interaction'));
  const rect = fragment.getBoundingClientRect();
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const target = document.elementFromPoint(start.x, start.y);
  const targetDescription = {
    tag: target?.tagName ?? null,
    overlayId: target?.closest?.('[data-overlay-id]')?.getAttribute('data-overlay-id') ?? null,
    layerId: target?.closest?.('[data-akari-layer-id]')?.getAttribute('data-akari-layer-id') ?? null,
    id: target?.id ?? null,
  };
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 7201, buttons: 1, clientX: start.x, clientY: start.y }));
  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    window.dispatchEvent(new PointerEvent('pointermove', {
      ...common, pointerId: 7201, buttons: 1,
      clientX: start.x + 60 * ratio, clientY: start.y + 24 * ratio,
    }));
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 7201, buttons: 0, clientX: start.x + 60, clientY: start.y + 24 }));
  await new Promise(resolve => setTimeout(resolve, 1000));
  const selectedBeforeBlank = lower.getAttribute('data-akari-interaction-selected');
  const blank = { x: innerWidth - 30, y: 30 };
  const blankTarget = document.elementFromPoint(blank.x, blank.y);
  blankTarget.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 7202, buttons: 1, clientX: blank.x, clientY: blank.y }));
  blankTarget.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 7202, buttons: 0, clientX: blank.x, clientY: blank.y }));
  blankTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: blank.x, clientY: blank.y }));
  await new Promise(resolve => setTimeout(resolve, 300));
  return {
    targetDescription,
    fragmentPointerEvents: getComputedStyle(fragment).pointerEvents,
    selectedBeforeBlank,
    selectedAfterBlank: lower.getAttribute('data-akari-interaction-selected'),
    cutDom: {
      x: Number(document.getElementById('preview-video').dataset.akariTransformX),
      y: Number(document.getElementById('preview-video').dataset.akariTransformY),
    },
    overlayDom: {
      x: getComputedStyle(lower).getPropertyValue('--x').trim(),
      y: getComputedStyle(lower).getPropertyValue('--y').trim(),
    },
  };
})()`);
record('B-overlay-isolation', b);
record('B-file', { cut: item('cut-a').transform, overlay: item('lower-third').transform });

const c = await ev(`(() => {
  const z = element => ({ inline: element.style.zIndex, computed: getComputedStyle(element).zIndex });
  return {
    caption: z(document.getElementById('caption-plate')),
    cut: z(document.getElementById('preview-video')),
    lowerThird: z(document.querySelector('[data-overlay-id="lower-third"]')),
    telop: z(document.querySelector('[data-akari-layer-id="telop-chapter"]')),
    captionText: document.getElementById('caption-plate').textContent.trim(),
  };
})()`);
record('C-caption-z', c);

const d = await ev(`(async () => {
  window.akari.interaction?.clearSelection?.();
  const video = document.getElementById('preview-video');
  const point = { x: innerWidth / 2, y: innerHeight / 2 };
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  video.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 7301, buttons: 1, clientX: point.x, clientY: point.y }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 7301, buttons: 0, clientX: point.x, clientY: point.y }));
  await new Promise(resolve => setTimeout(resolve, 500));
  return { cutId: video.dataset.akariCutId, selected: document.getElementById('cut-select-box').classList.contains('is-active') };
})()`);
record('D-cut-selected-inner', d);
await sleep(1200);
const inspector = await evalOn(main, `(() => {
  const widget = document.querySelector('.akari-inspector-widget');
  return widget ? { present: true, text: widget.textContent.trim().replace(/\\s+/g, ' ').slice(0, 500) } : { present: false };
})()`);
record('D-inspector', inspector);

record('final-file', {
  cut: item('cut-a').transform,
  overlay: item('lower-third').transform,
  telop: item('telop-chapter').transform,
  cutChanged: JSON.stringify(item('cut-a').transform) !== JSON.stringify(initial.cut),
});
await screenshot(main, path.join(outDir, `${phase}.png`));
writeFileSync(path.join(outDir, `${phase}.json`), `${JSON.stringify(records, null, 2)}\n`);

cdp.close();
main.close();
process.exit(0);
