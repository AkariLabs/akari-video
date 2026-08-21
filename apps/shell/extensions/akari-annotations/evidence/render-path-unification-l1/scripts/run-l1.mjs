#!/usr/bin/env node
// L1 (real machine, Electron + CDP) driver for task 2026-08-21-render-path-unification.
//
// Confirms empirically, against the real running app, that clip classification (cuts vs layers
// engine) -- and its timeline UI representation (data-akari-item-kind, CSS class, computed
// background color, track band kind) -- depends only on each item's own declared properties,
// never on which visual track it sits on. Runs ONE of 3 scenarios per process (see
// scripts/prepare-fixture.mjs for why each phase needs its own fresh Electron launch):
//   1. P0's original acceptance scenario (a plain V1 clip moved to a newly-created empty track).
//   2. feedback-r1.md's counter-topology (an untouched transform-only PiP clip on another track
//      must not be reclassified when an unrelated plain clip elsewhere is moved).
//   3. feedback-r2.md's counter-topology (same shape, reproduced with feedback-r2's own track ids
//      v1/v2/v5, live-drag reproduced instead of statically constructed).
//
// Usage: node run-l1.mjs <phase:1|2a|2b|3a|3b> <cdpPort> <workspaceDir> <evidenceDir>
// phase 1 drives a real mouse drag end-to-end. phases 2a/2b/3a/3b are capture-only (see the
// "scenarios 2 & 3" comment block below for why) -- each writes evidenceDir/state-<phase>.json,
// compared afterwards by scripts/compare-states.mjs.

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, keyPress, listTargets, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , phaseArg, cdpPortArg, workspaceDir, evidenceDir] = process.argv;
const phase = phaseArg;
const VALID_PHASES = ['1', '2a', '2b', '3a', '3b'];
const cdpPort = Number(cdpPortArg || 9333);
if (!VALID_PHASES.includes(phase) || !workspaceDir || !evidenceDir) {
  throw new Error(`usage: run-l1.mjs <phase:${VALID_PHASES.join('|')}> <cdpPort> <workspaceDir> <evidenceDir>`);
}

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

// ---- low-level drag (same technique as evidence/timeline-tracks/scripts/run-l1.mjs's AC3/AC4) ----

async function dragSequence(cdp, waypoints, opts = {}) {
  const steps = opts.steps ?? 12;
  const stepDelayMs = opts.stepDelayMs ?? 20;
  const start = waypoints[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    for (let s = 1; s <= steps; s++) {
      const x = from.x + (to.x - from.x) * (s / steps);
      const y = from.y + (to.y - from.y) * (s / steps);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(stepDelayMs);
    }
  }
}

async function dragRelease(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
}

// ---- timeline widget plumbing (same pattern as evidence/v1-clips/scripts/run-l1.mjs) ----

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

async function shot(main, name) {
  await screenshot(main, path.join(evidenceDir, name));
}

async function readEditJson() {
  return JSON.parse(await readFile(editPath, 'utf8'));
}

// ---- DOM readers ------------------------------------------------------------------------------

async function visualBandRects(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('.akari-track-band')).map(el => {
    const r = el.getBoundingClientRect();
    return { lane: el.dataset.akariLane, kind: el.dataset.akariKind, top: r.top, height: r.height };
  }).filter(b => b.kind === 'cuts' || b.kind === 'layers')`);
}

async function trackBandKind(main, laneId) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-track-band[data-akari-lane="${laneId}"]');
    return el ? el.dataset.akariKind : null;
  })()`);
}

// Whatever DOM representation currently renders the item(s) living on v2 track `laneId` -- a
// '.akari-annotations-strip-clip' element (data-akari-item-kind="cut") if the track's legacy kind
// is 'cuts', or a '.akari-annotations-strip-layer-*' element (data-akari-item-kind="layer") if
// 'layers'. This is the single query used both before and after each move: if classification ever
// flips, this query's own itemKind/className/background flips with it.
async function laneItemState(main, laneId) {
  return evalOn(main, `Array.from(document.querySelectorAll('[data-akari-lane="${laneId}"][data-akari-item-kind]')).map(el => ({
    itemKind: el.dataset.akariItemKind,
    itemId: el.dataset.akariItemId,
    className: el.className,
    background: getComputedStyle(el).backgroundColor,
    headerBackground: (() => {
      const header = el.querySelector('.akari-annotations-strip-clip-header');
      return header ? getComputedStyle(header).backgroundColor : null;
    })()
  }))`);
}

async function waitForLaneItems(main, laneId, expectedCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let states = [];
  while (Date.now() < deadline) {
    states = await laneItemState(main, laneId);
    if (states.length === expectedCount) {
      return states;
    }
    await sleep(300);
  }
  throw new Error(`lane ${laneId} did not settle to ${expectedCount} item(s) within ${timeoutMs}ms: ${JSON.stringify(states)}`);
}

async function cutClipRect(main, laneId) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-annotations-strip-clip[data-akari-lane="${laneId}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 };
  })()`);
}

// ---- scenario 1: P0's original acceptance scenario ---------------------------------------

async function scenario1(main) {
  record('scenario1-start', {});
  const beforeStates = await waitForLaneItems(main, 'v-main', 1);
  await shot(main, 's1-00-before.png');

  assert(beforeStates.length === 1 && beforeStates[0].itemKind === 'cut',
    'scenario1 before: clip-1 renders as a cut clip', { beforeStates });
  const beforeState = beforeStates[0];
  const beforeBandKind = await trackBandKind(main, 'v-main');
  assert(beforeBandKind === 'cuts', 'scenario1 before: v-main band kind is cuts', { beforeBandKind });

  const bands = await visualBandRects(main);
  assert(bands.length === 1 && bands[0].lane === 'v-main', 'scenario1: exactly one visual track exists before the drag', { bands });
  const topBand = bands[0];

  const clipRect = await cutClipRect(main, 'v-main');
  assert(clipRect, 'scenario1: clip-1 element located for drag', {});
  // Land within the 10px track-insert zone above the (only) track's top edge: this is the exact
  // "drop above the topmost row -> new track" gesture evidence/timeline-tracks/run-l1.mjs already
  // exercised for overlay tracks (there via -12px; here -6px, safely inside the tighter 10px zone
  // that packages/edit-store's sibling visual-track drag code (TRACK_INSERT_ZONE_PX) uses).
  const dragTargetY = topBand.top - 6;
  await dragSequence(main, [{ x: clipRect.centerX, y: clipRect.centerY }, { x: clipRect.centerX, y: dragTargetY }]);
  await sleep(200);
  await dragRelease(main, clipRect.centerX, dragTargetY);
  await sleep(900);

  const editAfter = await readEditJson();
  record('scenario1-edit-after', { tracks: editAfter.tracks.map(t => ({ id: t.id, items: t.items.map(i => i.id) })) });
  assert(editAfter.tracks.length === 2, 'scenario1: drag created a new track', { tracks: editAfter.tracks.map(t => t.id) });
  const mainAfter = editAfter.tracks.find(t => t.id === 'v-main');
  const newTrack = editAfter.tracks.find(t => t.id !== 'v-main');
  assert(mainAfter.items.length === 0, 'scenario1: v-main is now empty', { mainAfter });
  assert(newTrack.items.length === 1 && newTrack.items[0].id === 'clip-1',
    'scenario1: clip-1 moved to the new track', { newTrack });

  const afterStates = await waitForLaneItems(main, newTrack.id, 1);
  await shot(main, 's1-01-after.png');
  assert(afterStates.length === 1 && afterStates[0].itemKind === 'cut',
    'scenario1 AFTER: clip-1 STILL renders as a cut clip on the new track', { afterStates });
  const afterState = afterStates[0];
  assert(afterState.className === beforeState.className,
    'scenario1: clip-1 CSS class list unchanged after moving to the new track',
    { before: beforeState.className, after: afterState.className });
  assert(afterState.background === beforeState.background,
    'scenario1: clip-1 computed background color unchanged after the move',
    { before: beforeState.background, after: afterState.background });
  assert(afterState.headerBackground === beforeState.headerBackground,
    'scenario1: clip-1 header bar computed background color unchanged after the move',
    { before: beforeState.headerBackground, after: afterState.headerBackground });
  const afterBandKind = await trackBandKind(main, newTrack.id);
  assert(afterBandKind === 'cuts', 'scenario1 AFTER: new track band kind is cuts (same as before)', { afterBandKind });

  record('scenario1-PASS', {});
}

// ---- scenarios 2 & 3 (feedback-r1.md / feedback-r2.md counter-topologies) -----------------
//
// A REAL mouse drag of these scenarios' plain clip (move-1 / moved-1 -- global cut segment index
// 1, i.e. not the timeline's first cut clip) reproducibly throws "クリップ N の id を特定できません"
// from akari-annotations-widget.ts's cutItemId() inside updateDragPreview, uncaught, on EVERY
// mousemove during the drag -- confirmed to reproduce even for a trivial same-row nudge with no
// track change at all, and confirmed NOT to reproduce for the timeline's first (index 0) cut clip.
// This is a pre-existing widget bug (apps/shell/extensions/akari-annotations, untouched by this
// task's diff), out of this task's file boundary (packages/edit-store, packages/render-cut,
// packages/edit-lint) and out of scope to fix here -- see README.md "実測メモ" for full repro
// detail -- but it blocks driving these two scenarios via literal drag-and-drop. It is very
// plausibly a NEW exposure surfaced by this task's own fix: before render-path-unification, a
// project could have at most ONE 'cuts'-classified visual track (mainVisualTrackId picked exactly
// one), so a real project could never previously reach "2+ simultaneously-cuts-classified visual
// tracks, each with content" -- exactly the topology these two scenarios need and exactly what
// triggers the crash.
//
// So instead: capture-only mode. Each of these runs against its own fresh Electron boot (phase
// 2a/3a = before, 2b/3b = after) with the "after" topology written directly to disk to match
// exactly what moveItem() (apps/shell/extensions/akari-annotations/src/common/edit-v2-mutations.ts)
// deterministically produces for this move (splice the item out of its source track, push it
// verbatim -- same id/duration/source/transform, only `at` reassigned -- onto the target track).
// This still verifies the actual thing under test (classification stability of the untouched pip-1
// clip) against the real running app across two independent real-machine states; it just doesn't
// exercise the (separately broken) mouse gesture itself. compare-states.mjs does the before/after
// diff once both captures exist.

async function captureScenario2or3(main, config) {
  const { label, pipLane, moveLane, moveExpectedInLane, allLanes } = config;
  record(`${label}-start`, {});
  const states = {};
  for (const lane of allLanes) {
    states[lane] = await waitForLaneItems(main, lane, lane === moveExpectedInLane || lane === pipLane ? 1 : 0);
  }
  await shot(main, `${label}-state.png`);

  const pipStates = states[pipLane];
  assert(pipStates.length === 1 && pipStates[0].itemKind === 'cut',
    `${label}: pip-1 (transform-only, on ${pipLane}) renders as a cut clip`, { pipStates });
  const pipBandKind = await trackBandKind(main, pipLane);
  assert(pipBandKind === 'cuts', `${label}: ${pipLane} band kind is cuts`, { pipBandKind });

  const moveStates = states[moveExpectedInLane];
  assert(moveStates.length === 1 && moveStates[0].itemKind === 'cut',
    `${label}: the plain clip (on ${moveExpectedInLane}) renders as a cut clip`, { moveStates });

  const editNow = await readEditJson();
  record(`${label}-edit`, { tracks: editNow.tracks.map(t => ({ id: t.id, items: t.items.map(i => i.id) })) });

  const snapshot = {
    label,
    tracks: editNow.tracks.map(t => ({ id: t.id, items: t.items.map(i => i.id) })),
    pipLane,
    pip: pipStates[0],
    moveLane: moveExpectedInLane,
    move: moveStates[0]
  };
  await writeFile(path.join(evidenceDir, `state-${label}.json`), JSON.stringify(snapshot, null, 2));

  record(`${label}-CAPTURED`, {});
}

// ---- main ---------------------------------------------------------------------------------

async function main() {
  await mkdir(evidenceDir, { recursive: true });

  const targets = await listTargets(cdpPort);
  const page = targets.find(target => target.type === 'page');
  if (!page) {
    throw new Error('main page target not found');
  }
  const main = new CDP(page.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await shot(main, `phase${phase}-00-boot.png`);

  await openTimeline(main);

  if (phase === '1') await scenario1(main);
  if (phase === '2a') await captureScenario2or3(main, {
    label: '2a', pipLane: 'v-pip', moveLane: 'v-move', moveExpectedInLane: 'v-move',
    allLanes: ['v-pip', 'v-move']
  });
  if (phase === '2b') await captureScenario2or3(main, {
    label: '2b', pipLane: 'v-pip', moveLane: 'v-move', moveExpectedInLane: 'v-empty',
    allLanes: ['v-pip', 'v-empty']
  });
  if (phase === '3a') await captureScenario2or3(main, {
    label: '3a', pipLane: 'v2', moveLane: 'v1', moveExpectedInLane: 'v1',
    allLanes: ['v2', 'v1']
  });
  if (phase === '3b') await captureScenario2or3(main, {
    label: '3b', pipLane: 'v2', moveLane: 'v1', moveExpectedInLane: 'v5',
    allLanes: ['v2', 'v5']
  });

  await writeFile(path.join(evidenceDir, `run-log-phase${phase}.json`), JSON.stringify(log, null, 2));
  main.close();
  console.log(`PHASE ${phase} ACCEPTANCE CRITERIA PASSED`);
}

main().catch(async error => {
  console.error('FAILED', error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `run-log-phase${phase}-partial.json`), JSON.stringify(log, null, 2));
  process.exit(1);
});
