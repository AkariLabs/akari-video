#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import {
  CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [portText, workspaceDir, evidenceOutDir] = process.argv.slice(2);
if (!portText || !workspaceDir || !evidenceOutDir) {
  throw new Error('usage: run-l1.mjs <cdpPort> <workspaceDir> <evidenceOutDir>');
}

const port = Number(portText);
const editPath = path.join(workspaceDir, 'project', 'edit.json');
const expectedInitial = ['0-1', '2-3', '4-5'];
const nonAdjacent = ['1-2', '3-4', '5-6'];
const fixtureDurationSeconds = 14.6;
const boundaryTimes = new Map([
  ['0-1', 2], ['1-2', 4.1], ['2-3', 6.1],
  ['3-4', 8.3], ['4-5', 10.3], ['5-6', 12.6]
]);
const warningMessage = 'このトランジションは次のクリップとの間にすき間があるため書き出されません。'
  + 'すき間を詰めるか、トランジションを削除してください。';

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(workspaceDir).join('<workspace>');
}

async function savePhase(name, data) {
  await mkdir(evidenceOutDir, { recursive: true });
  await writeFile(
    path.join(evidenceOutDir, `phase-${name}.json`),
    `${JSON.stringify({ phase: name, status: 'PASS', ...data }, null, 2)}\n`
  );
}

async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 480; attempt++) {
    try {
      targets = await listTargets(port);
    } catch {
      targets = [];
    }
    if (targets.some(target => target.type === 'page')) break;
    await sleep(250);
  }
  const target = targets.find(candidate => candidate.type === 'page');
  assert.ok(target, 'Electron page target was not created');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1680, height: 1250, deviceScaleFactor: 1, mobile: false
  });
  return cdp;
}

async function waitForApplicationShell(cdp) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 960; attempt++) {
    const ready = await evalOn(cdp, `Boolean(document.querySelector('.theia-ApplicationShell'))
      && !document.querySelector('.theia-preload')`);
    if (ready) return Date.now() - startedAt;
    await sleep(250);
  }
  throw new Error('Theia application shell did not become ready within 240 seconds');
}

async function openTimeline(cdp) {
  let opened = await evalOn(cdp, "Boolean(document.getElementById('akari-annotations-widget'))");
  for (let attempt = 1; attempt <= 8 && !opened; attempt++) {
    await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(500);
    await cdp.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 60 && !opened; wait++) {
      await sleep(250);
      opened = await evalOn(cdp, "Boolean(document.getElementById('akari-annotations-widget'))");
    }
  }
  assert.equal(opened, true, 'timeline widget did not open after 8 attempts');
}

async function boundaryMeasurements(cdp) {
  return evalOn(cdp, `(() => Array.from(document.querySelectorAll('[data-akari-transition-boundary]'))
    .map(element => {
      const value = element.dataset.akariTransitionBoundary;
      const laterIndex = Number(value.split('-')[1]);
      const later = document.querySelector('[data-akari-ui="timeline:cut:' + laterIndex + '"]');
      if (!later) return { value, laterFound: false };
      const badgeRect = element.getBoundingClientRect();
      const laterRect = later.getBoundingClientRect();
      const badgeCenterX = badgeRect.left + badgeRect.width / 2;
      return {
        value,
        laterFound: true,
        badgeCenterX,
        laterLeftX: laterRect.left,
        differencePx: badgeCenterX - laterRect.left
      };
    }))()`);
}

async function waitForBoundaries(cdp, expected, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const measurements = await boundaryMeasurements(cdp);
    const values = measurements.map(item => item.value).sort();
    if (JSON.stringify(values) === JSON.stringify([...expected].sort())) return measurements;
    await sleep(250);
  }
  throw new Error(`boundaries did not reach ${expected.join(',')}`);
}

async function boundaryMeasurement(cdp, value) {
  return evalOn(cdp, `(() => {
    const element = document.querySelector('[data-akari-transition-boundary="${value}"]');
    if (!element) return null;
    const laterIndex = Number(${JSON.stringify(value)}.split('-')[1]);
    const later = document.querySelector('[data-akari-ui="timeline:cut:' + laterIndex + '"]');
    if (!later) return { value: ${JSON.stringify(value)}, laterFound: false };
    const badgeRect = element.getBoundingClientRect();
    const laterRect = later.getBoundingClientRect();
    const badgeCenterX = badgeRect.left + badgeRect.width / 2;
    return {
      value: ${JSON.stringify(value)},
      laterFound: true,
      badgeCenterX,
      laterLeftX: laterRect.left,
      differencePx: badgeCenterX - laterRect.left
    };
  })()`);
}

async function waitForBoundaryPresence(cdp, value, present = true, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const measurement = await boundaryMeasurement(cdp, value);
    if (Boolean(measurement) === present) return measurement;
    await sleep(250);
  }
  throw new Error(`boundary ${value} did not reach presence=${present}`);
}

async function panTimelineTo(cdp, time) {
  const dispatched = await evalOn(cdp, `(() => {
    const track = document.querySelector('[data-testid="akari-timeline-hscrollbar-track"]');
    if (!track || getComputedStyle(track).display === 'none') return false;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, ${time} / ${fixtureDurationSeconds}));
    track.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rect.left + rect.width * ratio,
      clientY: rect.top + rect.height / 2
    }));
    return true;
  })()`);
  assert.equal(dispatched, true, 'timeline scrollbar was not available after zoom');
  await sleep(100);
}

async function cutRect(cdp, cutIndex) {
  return evalOn(cdp, `(() => {
    const element = document.querySelector('[data-akari-ui="timeline:cut:${cutIndex}"]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height,
      x: rect.left + rect.width / 2, y: rect.top + rect.height / 2
    };
  })()`);
}

async function zoomUntilFirstCutIsWide(cdp, minimumWidth = 120) {
  for (const sliderValue of [200, 300, 400, 500, 600]) {
    const dispatched = await evalOn(cdp, `(() => {
      const slider = document.querySelector('[data-testid="akari-timeline-zoom-slider"]');
      if (!slider) return false;
      slider.value = ${sliderValue};
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert.equal(dispatched, true, 'timeline zoom slider was not found');
    await panTimelineTo(cdp, 1);
    for (let attempt = 0; attempt < 40; attempt++) {
      const rect = await cutRect(cdp, 0);
      if (rect?.width >= minimumWidth) {
        return { sliderValue, cutWidth: rect.width };
      }
      await sleep(100);
    }
  }
  throw new Error(`first cut did not reach ${minimumWidth}px after timeline zoom`);
}

async function collectBoundariesAcrossTimeline(cdp, values) {
  const measurements = [];
  for (const value of values) {
    const time = boundaryTimes.get(value);
    assert.notEqual(time, undefined, `boundary time is missing for ${value}`);
    await panTimelineTo(cdp, time);
    measurements.push(await waitForBoundaryPresence(cdp, value));
  }
  return measurements;
}

async function assertBoundariesAbsentAcrossTimeline(cdp, values) {
  for (const value of values) {
    const time = boundaryTimes.get(value);
    assert.notEqual(time, undefined, `boundary time is missing for ${value}`);
    await panTimelineTo(cdp, time);
    await waitForBoundaryPresence(cdp, value, false);
  }
}

async function warningState(cdp) {
  return evalOn(cdp, `(() => {
    const element = document.querySelector('[data-akari-unsupported-transition="5"]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { title: element.title, text: element.textContent ?? '', width: rect.width, height: rect.height };
  })()`);
}

async function waitForEdit(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    if (predicate(edit)) return edit;
    await sleep(250);
  }
  throw new Error('edit.json did not reach the expected state');
}

async function assertClipDragTarget(cdp, cutIndex, x, y) {
  const hit = await evalOn(cdp, `(() => {
    const clip = document.querySelector('[data-akari-ui="timeline:cut:${cutIndex}"]');
    const target = document.elementFromPoint(${x}, ${y});
    return {
      belongsToClip: Boolean(clip && target && (target === clip || clip.contains(target))),
      tagName: target?.tagName ?? null,
      dataset: target ? { ...target.dataset } : null
    };
  })()`);
  assert.equal(
    hit.belongsToClip,
    true,
    `cut ${cutIndex} drag start hit another element: tagName=${hit.tagName}, dataset=${JSON.stringify(hit.dataset)}`
  );
}

async function trimFirstCut(cdp) {
  await panTimelineTo(cdp, 1);
  const rect = await cutRect(cdp, 0);
  assert.ok(rect?.width >= 120, 'first cut has no usable trim area after zoom');
  const dragDistance = Math.min(rect.width * 0.3, rect.width - 24);
  const startX = rect.right - 2;
  const startY = rect.top + 5;
  await assertClipDragTarget(cdp, 0, startX, startY);
  await realDrag(cdp, [
    { x: startX, y: startY },
    { x: rect.right - dragDistance, y: startY }
  ]);
}

async function moveSixthCut(cdp) {
  await panTimelineTo(cdp, 11.3);
  const rect = await cutRect(cdp, 5);
  assert.ok(rect?.width >= 120, 'sixth cut has no usable move area after zoom');
  const dragDistance = rect.width * 0.12;
  const startX = rect.x;
  const startY = rect.bottom - 5;
  await assertClipDragTarget(cdp, 5, startX, startY);
  await realDrag(cdp, [
    { x: startX, y: startY },
    { x: startX + dragDistance, y: startY }
  ]);
}

async function clickUndo(cdp) {
  const undo = await evalOn(cdp, `(() => {
    const element = document.querySelector('#akari-annotations-widget [aria-label="元に戻す"]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(undo, 'undo button was not found');
  await realClick(cdp, undo.x, undo.y);
}

function assertMeasurements(measurements, expected) {
  const values = measurements.map(item => item.value).sort();
  assert.deepEqual(values, [...expected].sort());
  assert.ok(measurements.every(item => item.laterFound), JSON.stringify(measurements));
  assert.ok(measurements.every(item => Math.abs(item.differencePx) <= 3), JSON.stringify(measurements));
}

let cdp;
try {
  await mkdir(evidenceOutDir, { recursive: true });
  await rm(path.join(evidenceOutDir, 'phase-failure.json'), { force: true });
  cdp = await connect();
  const shellReadyMs = await waitForApplicationShell(cdp);
  await openTimeline(cdp);

  const initial = await waitForBoundaries(cdp, expectedInitial);
  assertMeasurements(initial, expectedInitial);
  for (const value of nonAdjacent) {
    assert.ok(!initial.some(item => item.value === value), value);
  }
  const warning = await warningState(cdp);
  assert.ok(warning, 'non-adjacent declared transition warning was not rendered');
  assert.equal(warning.title, warningMessage);
  await savePhase('initial', {
    shellReadyMs,
    boundaryCount: initial.length,
    boundaries: initial,
    nonAdjacentBoundaryValues: nonAdjacent,
    unsupportedTransition: warning
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-initial.png'));

  const zoom = await zoomUntilFirstCutIsWide(cdp);
  const afterZoom = await collectBoundariesAcrossTimeline(cdp, expectedInitial);
  assertMeasurements(afterZoom, expectedInitial);
  await assertBoundariesAbsentAcrossTimeline(cdp, nonAdjacent);
  await panTimelineTo(cdp, 2);
  await savePhase('after-zoom', {
    zoom,
    boundaryCount: afterZoom.length,
    boundaries: afterZoom,
    nonAdjacentBoundaryValues: nonAdjacent
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-after-zoom.png'));

  const beforeEdit = JSON.parse(await readFile(editPath, 'utf8'));
  await trimFirstCut(cdp);
  await waitForEdit(edit => edit.tracks[0].items[0].duration < beforeEdit.tracks[0].items[0].duration);
  await panTimelineTo(cdp, 2);
  await waitForBoundaryPresence(cdp, '0-1', false);
  const afterTrim = await collectBoundariesAcrossTimeline(cdp, ['2-3', '4-5']);
  assertMeasurements(afterTrim, ['2-3', '4-5']);
  await panTimelineTo(cdp, 2);
  await savePhase('after-trim', {
    beforeBoundaryValues: expectedInitial,
    afterBoundaryCount: afterTrim.length,
    afterBoundaries: afterTrim,
    removedBoundaryValue: '0-1'
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-after-trim.png'));

  await clickUndo(cdp);
  await waitForEdit(edit => edit.tracks[0].items[0].duration === beforeEdit.tracks[0].items[0].duration);
  const afterTrimUndo = await collectBoundariesAcrossTimeline(cdp, expectedInitial);
  assertMeasurements(afterTrimUndo, expectedInitial);
  await panTimelineTo(cdp, 2);
  await savePhase('after-trim-undo', {
    beforeBoundaryValues: ['2-3', '4-5'],
    afterBoundaryCount: afterTrimUndo.length,
    afterBoundaries: afterTrimUndo,
    restoredBoundaryValue: '0-1'
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-after-trim-undo.png'));

  const beforeMove = JSON.parse(await readFile(editPath, 'utf8'));
  const originalAt = beforeMove.tracks[0].items[5].at;
  await moveSixthCut(cdp);
  const movedEdit = await waitForEdit(edit => edit.tracks[0].items[5].at > originalAt);
  await panTimelineTo(cdp, movedEdit.tracks[0].items[5].at / 10);
  await waitForBoundaryPresence(cdp, '4-5', false);
  const afterMove = await collectBoundariesAcrossTimeline(cdp, ['0-1', '2-3']);
  assertMeasurements(afterMove, ['0-1', '2-3']);
  await panTimelineTo(cdp, movedEdit.tracks[0].items[5].at / 10);
  const movedCutBoundaries = await boundaryMeasurements(cdp);
  await savePhase('after-move', {
    movedCutIndex: 5,
    originalAt,
    movedAt: movedEdit.tracks[0].items[5].at,
    removedBoundaryValue: '4-5',
    remainingBoundaries: afterMove,
    visibleBoundariesNearMovedCut: movedCutBoundaries
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-after-move.png'));

  await clickUndo(cdp);
  await waitForEdit(edit => edit.tracks[0].items[5].at === originalAt);
  const afterMoveUndo = await collectBoundariesAcrossTimeline(cdp, expectedInitial);
  assertMeasurements(afterMoveUndo, expectedInitial);
  await panTimelineTo(cdp, 10.3);
  await savePhase('after-move-undo', {
    afterBoundaryCount: afterMoveUndo.length,
    afterBoundaries: afterMoveUndo,
    restoredBoundaryValue: '4-5'
  });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-after-move-undo.png'));
  console.log('TRANSITION ADJACENCY L1 PASS');
} catch (error) {
  await mkdir(evidenceOutDir, { recursive: true });
  await writeFile(
    path.join(evidenceOutDir, 'phase-failure.json'),
    `${JSON.stringify({ phase: 'failure', status: 'FAIL', error: cleanError(error) }, null, 2)}\n`
  );
  throw error;
} finally {
  cdp?.close();
}
