#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  connectMain,
  connectPreview,
  evalOn,
} from '../../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../../preview-writeback-v2/scripts/cdp-lib.mjs';

const [portText, projectDir, evidenceDir, type] = process.argv.slice(2);
if (!portText || !projectDir || !evidenceDir || !type) {
  throw new Error('usage: run-l1.mjs <port> <project-dir> <evidence-dir> <transition-type>');
}
const port = Number(portText);
const editUri = `file://${path.join(projectDir, 'edit.json')}`;
const observations = [];
const record = (step, value) => {
  observations.push({ step, ...value });
  console.log(`[${step}] ${JSON.stringify(value)}`);
};
const closeEnough = (actual, expected, tolerance = 0.08) =>
  Math.abs(Number(actual) - expected) <= tolerance;
const fadePlateOpacity = progress => Math.max(
  0,
  Math.min(1, Math.min(progress / 0.18, (1 - progress) / 0.7))
);
const matrixTranslateY = value => {
  const serialized = String(value);
  const numbers = serialized.slice(serialized.indexOf('(') + 1, -1)
    .split(',').map(part => Number(part.trim()));
  return serialized.startsWith('matrix3d(') ? numbers[13] : numbers[5];
};

await mkdir(evidenceDir, { recursive: true });
const main = await connectMain(port);
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

let previewConnection;
for (let attempt = 1; attempt <= 15 && !previewConnection; attempt += 1) {
  const opened = await command(`void commands.executeCommand('akari.preview.ensureVisible', {
    editUri: ${JSON.stringify(editUri)}
  });`);
  let contextFound = false;
  if (opened.ok) {
    try {
      previewConnection = await connectPreview(port, 4);
      contextFound = true;
    } catch {
      // 起動直後の空振りは次の ensureVisible で回復させる。
    }
  }
  record('ensure-visible-attempt', { attempt, commandAccepted: opened.ok, contextFound });
  if (!previewConnection) await sleep(1000);
}
assert.ok(previewConnection, 'preview content context was not created after ensureVisible retries');
const { cdp, contextId } = previewConnection;
const ev = expression => evalOn(cdp, expression, contextId);

async function seekTo(time) {
  const result = await command(`void commands.executeCommand('akari.preview.seekOutput', {
    editUri: ${JSON.stringify(editUri)}, time: ${time}
  });`);
  assert.equal(result.ok, true);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await readDom();
    const timelineReady = Math.abs(state.timelineTime - time) <= 0.035;
    const transitionReady = time >= 1 && time < 2
      ? state.incoming.readyState >= 1 && state.incoming.display === 'block'
        && state.incoming.type === type
      : true;
    if (timelineReady && transitionReady) return state;
    await sleep(150);
  }
  throw new Error(`preview did not seek to ${time}`);
}

async function readDom(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await ev(`(() => {
      const outgoing = document.getElementById('preview-video');
      const incoming = document.getElementById('transition-video');
      const plate = document.getElementById('transition-plate');
      const stage = document.getElementById('preview-stage');
      const seek = document.getElementById('seek');
      if (!outgoing || !incoming || !plate || !stage || !seek) return null;
      const outgoingStyle = getComputedStyle(outgoing);
      const incomingStyle = getComputedStyle(incoming);
      const plateStyle = getComputedStyle(plate);
      const stageRect = stage.getBoundingClientRect();
      const paintOrderAt = (fx, fy) => document.elementsFromPoint(
        stageRect.left + stageRect.width * fx,
        stageRect.top + stageRect.height * fy
      ).map(element => element.id).filter(id => id === 'preview-video' || id === 'transition-video');
      return {
        timelineTime: Number(seek.value),
        videoCount: document.querySelectorAll('#preview-layers > video').length,
        outgoing: {
          display: outgoingStyle.display,
          visibility: outgoingStyle.visibility,
          opacity: Number(outgoingStyle.opacity),
          filter: outgoing.style.filter,
          transform: outgoingStyle.transform,
          height: outgoing.offsetHeight,
          zIndex: outgoingStyle.zIndex,
          currentTime: outgoing.currentTime,
          volume: outgoing.volume,
          type: outgoing.dataset.akariTransitionType || '',
          progress: outgoing.dataset.akariTransitionProgress || ''
        },
        incoming: {
          display: incomingStyle.display,
          opacity: Number(incomingStyle.opacity),
          filter: incoming.style.filter,
          zIndex: incomingStyle.zIndex,
          clipPath: incomingStyle.clipPath,
          currentTime: incoming.currentTime,
          volume: incoming.volume,
          readyState: incoming.readyState,
          preloadedWindow: incoming.dataset.akariPreloadedWindow || '',
          type: incoming.dataset.akariTransitionType || '',
          progress: incoming.dataset.akariTransitionProgress || ''
        },
        plate: { opacity: Number(plateStyle.opacity), background: plateStyle.backgroundColor },
        paint: {
          top: paintOrderAt(0.5, 0.25),
          center: paintOrderAt(0.5, 0.5),
          bottom: paintOrderAt(0.5, 0.75)
        }
      };
    })()`);
    if (state) return state;
    await sleep(100);
  }
  throw new Error('preview DOM did not stabilize: required transition elements are missing');
}

async function waitForIncomingPreload() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await readDom();
    if (state.incoming.readyState >= 1
      && state.incoming.preloadedWindow
      && closeEnough(state.incoming.currentTime, 2, 0.12)) return state;
    await sleep(150);
  }
  throw new Error('incoming transition video was not preloaded before the window');
}

try {
  const preloaded = await waitForIncomingPreload();
  assert.equal(preloaded.incoming.display, 'none');
  record('incoming-preloaded', { incoming: preloaded.incoming });
  const points = [];
  for (const time of [1.1, 1.5, 1.9]) {
    const state = await seekTo(time);
    assert.equal(state.videoCount, 2);
    assert.equal(state.outgoing.display, 'block');
    assert.equal(state.outgoing.visibility, 'visible');
    assert.equal(state.incoming.display, 'block');
    assert.equal(state.outgoing.type, type);
    assert.equal(state.incoming.type, type);
    assert.ok(state.incoming.readyState >= 1, JSON.stringify(state));
    assert.ok(closeEnough(state.incoming.currentTime, 2 + (time - 1), 0.12), JSON.stringify(state));
    points.push(state);
    if (time === 1.5) await screenshot(main, path.join(evidenceDir, `${type}.png`));
  }
  if (type === 'dissolve') {
    for (const point of points) {
      assert.ok(closeEnough(point.outgoing.opacity, 1));
      assert.ok(closeEnough(point.incoming.opacity, 1));
      assert.equal(point.outgoing.filter, '');
      assert.match(point.incoming.filter, /url\(["']?#akari-transition-dissolve["']?\)/u);
    }
  } else if (type === 'fade-black' || type === 'fade-white') {
    for (const [index, progress] of [0.1, 0.5, 0.9].entries()) {
      assert.ok(closeEnough(
        points[index].plate.opacity,
        fadePlateOpacity(progress),
        0.005
      ), JSON.stringify({ progress, state: points[index] }));
    }
    assert.equal(points[1].plate.background, type === 'fade-white' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
  } else if (type === 'reveal-down') {
    assert.notEqual(points[1].outgoing.transform, 'none');
    assert.ok(closeEnough(
      matrixTranslateY(points[1].outgoing.transform),
      points[1].outgoing.height * 0.5,
      Math.max(2, points[1].outgoing.height * 0.03)
    ), JSON.stringify(points[1]));
    assert.deepEqual(points[1].paint.bottom.slice(0, 2), ['preview-video', 'transition-video']);
    assert.equal(points[1].incoming.clipPath, 'none');
  } else if (type === 'reveal-up') {
    assert.notEqual(points[1].outgoing.transform, 'none');
    assert.ok(closeEnough(
      matrixTranslateY(points[1].outgoing.transform),
      -points[1].outgoing.height * 0.5,
      Math.max(2, points[1].outgoing.height * 0.03)
    ), JSON.stringify(points[1]));
    assert.deepEqual(points[1].paint.top.slice(0, 2), ['preview-video', 'transition-video']);
    assert.equal(points[1].incoming.clipPath, 'none');
  }
  record('window-points', { type, points });

  const after = await seekTo(2.1);
  assert.equal(after.incoming.display, 'none');
  assert.ok(closeEnough(after.outgoing.currentTime, 3.1, 0.12), JSON.stringify(after));
  record('after-window', { type, state: after, expectedSourceTime: 3.1 });
  await writeFile(
    path.join(evidenceDir, `${type}.json`),
    `${JSON.stringify({ status: 'PASS', type, observations }, null, 2)}\n`
  );
  console.log(`${type} PASS`);
} catch (error) {
  await writeFile(
    path.join(evidenceDir, `${type}.json`),
    `${JSON.stringify({
      status: 'FAIL', type, observations,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`
  );
  throw error;
} finally {
  try { await main.send('Browser.close', {}, 5000); } catch { /* process cleanup fallback */ }
  cdp.close();
  main.close();
}
