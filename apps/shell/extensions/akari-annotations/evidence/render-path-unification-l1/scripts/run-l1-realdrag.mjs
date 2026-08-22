#!/usr/bin/env node
// Real-drag re-verification of scenarios 2/3, run AFTER the legacy.index root-cause fix in
// packages/edit-store/src/internal-model.ts (buildV2Item's legacy.index used to reset to 0 for
// every track's own item loop; a shared global counter now makes it unique across the whole
// edit). Before this fix, README.md's "実測メモ — ドラッグ UI のバグ" section recorded that a
// REAL mouse drag of move-1 / moved-1 (global cut segment index 1, i.e. not the timeline's first
// cut clip) reproducibly threw "クリップ N の id を特定できません" from
// akari-annotations-widget.ts's cutItemId() inside updateDragPreview, on every mousemove, and the
// drag never committed. This script drives that exact same gesture again to confirm the fix
// resolves it -- reusing the same 2a/3a on-disk fixtures scripts/prepare-fixture.mjs already
// writes (unmodified), and the same CDP/drag technique run-l1.mjs's scenario1 already uses for a
// real drag-and-drop.
//
// Usage: node run-l1-realdrag.mjs <phase:2r|3r> <cdpPort> <workspaceDir> <evidenceDir>
// phase 2r reuses the '2a' fixture (v-empty / v-pip / v-move) and drags move-1 from v-move onto
// v-empty. phase 3r reuses the '3a' fixture (v1 / v2 / v5, feedback-r2.md's own naming) and drags
// moved-1 from v1 onto v5.

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, keyPress, listTargets, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , phaseArg, cdpPortArg, workspaceDir, evidenceDir] = process.argv;
const phase = phaseArg;
const VALID_PHASES = ['2r', '3r'];
const cdpPort = Number(cdpPortArg || 9333);
if (!VALID_PHASES.includes(phase) || !workspaceDir || !evidenceDir) {
  throw new Error(`usage: run-l1-realdrag.mjs <phase:${VALID_PHASES.join('|')}> <cdpPort> <workspaceDir> <evidenceDir>`);
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

// The "このフォルダを AKARI Video プロジェクトとして使いますか？" onboarding toast
// (apps/shell/extensions/akari-project/src/browser/akari-project-contribution.ts) can appear over
// the timeline panel on a fresh isolated workspace and intercepts pointer events aimed at
// whatever it overlaps -- observed to silently swallow a drag's mouseup when it overlaps the drop
// target track's row (no exception, no edit.json change, the drag just lands on the toast
// instead). Dismiss it with "開くだけ" (open only) before driving any drag.
async function dismissProjectConsentIfPresent(main) {
  const dismissed = await evalOn(main, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(b => b.textContent && b.textContent.trim() === '開くだけ');
    if (target) { target.click(); return true; }
    return false;
  })()`);
  if (dismissed) {
    record('project-consent-dismissed', {});
    await sleep(300);
  }
}

async function readEditJson() {
  return JSON.parse(await readFile(editPath, 'utf8'));
}

async function trackBandKind(main, laneId) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-track-band[data-akari-lane="${laneId}"]');
    return el ? el.dataset.akariKind : null;
  })()`);
}

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

async function visualBandRect(main, laneId) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-track-band[data-akari-lane="${laneId}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height, centerY: r.top + r.height / 2 };
  })()`);
}

// Listens for uncaught page-side exceptions (e.g. cutItemId()'s uncaught throw from inside a
// mousemove handler) via Runtime.exceptionThrown -- the original bug did not crash the CDP
// session, so a page-level try/catch harness alone would not have detected it; this is how the
// exception was actually confirmed on the buggy build.
function watchForUncaughtExceptions(cdp) {
  const seen = [];
  cdp.on('Runtime.exceptionThrown', event => {
    seen.push(event.exceptionDetails);
  });
  return seen;
}

async function realDragScenario(main, cdp, config) {
  const { label, pipLane, sourceLane, targetLane, movedItemId } = config;
  record(`${label}-start`, {});
  const uncaughtExceptions = watchForUncaughtExceptions(cdp);

  const beforePip = await waitForLaneItems(main, pipLane, 1);
  const beforeMoved = await waitForLaneItems(main, sourceLane, 1);
  assert(beforePip[0].itemKind === 'cut', `${label} before: pip-1 renders as a cut clip`, { beforePip });
  assert(beforeMoved[0].itemKind === 'cut', `${label} before: ${movedItemId} renders as a cut clip`, { beforeMoved });
  await shot(main, `${label}-00-before.png`);

  // Scroll the source clip and the target track's band into view before measuring anything --
  // getBoundingClientRect() returns numbers even for elements the window resize above still
  // doesn't fully fit, and a drag computed from an off-viewport rect silently lands nowhere.
  await evalOn(main, `(() => {
    const el = document.querySelector('.akari-annotations-strip-clip[data-akari-lane="${sourceLane}"]');
    if (el) el.scrollIntoView({ block: 'center' });
    return Boolean(el);
  })()`);
  await sleep(150);
  const clipRect = await cutClipRect(main, sourceLane);
  assert(clipRect, `${label}: ${movedItemId} element located for drag`, {});
  await evalOn(main, `(() => {
    const el = document.querySelector('.akari-track-band[data-akari-lane="${targetLane}"]');
    if (el) el.scrollIntoView({ block: 'center' });
    return Boolean(el);
  })()`);
  await sleep(150);
  const targetBand = await visualBandRect(main, targetLane);
  assert(targetBand, `${label}: target track ${targetLane} band located`, {});
  // Re-measure the source clip: scrolling to reveal the target band may have moved the source
  // clip's screen position too (both live in the same scroll container).
  const clipRectAfterTargetScroll = await cutClipRect(main, sourceLane);
  assert(clipRectAfterTargetScroll, `${label}: ${movedItemId} still located after scrolling to the target`, {});

  // Real drag: press on the source clip, move across to the target track's row, release there.
  await dragSequence(main, [
    { x: clipRectAfterTargetScroll.centerX, y: clipRectAfterTargetScroll.centerY },
    { x: clipRectAfterTargetScroll.centerX, y: targetBand.centerY },
  ], { steps: 20, stepDelayMs: 25 });
  await sleep(200);
  await dragRelease(main, clipRectAfterTargetScroll.centerX, targetBand.centerY);
  await sleep(900);

  record(`${label}-uncaught-exceptions-during-drag`, { count: uncaughtExceptions.length, exceptions: uncaughtExceptions });
  assert(uncaughtExceptions.length === 0,
    `${label}: no uncaught exception during the real drag (the original bug: cutItemId() threw from updateDragPreview on every mousemove)`,
    { exceptions: uncaughtExceptions });

  const editAfter = await readEditJson();
  record(`${label}-edit-after`, { tracks: editAfter.tracks.map(t => ({ id: t.id, items: t.items.map(i => i.id) })) });
  const sourceAfter = editAfter.tracks.find(t => t.id === sourceLane);
  const targetAfter = editAfter.tracks.find(t => t.id === targetLane);
  assert(sourceAfter.items.length === 0, `${label}: ${sourceLane} is now empty (drag committed)`, { sourceAfter });
  assert(targetAfter.items.length === 1 && targetAfter.items[0].id === movedItemId,
    `${label}: ${movedItemId} actually moved to ${targetLane} (drag committed, not just visually previewed)`, { targetAfter });

  const afterMoved = await waitForLaneItems(main, targetLane, 1);
  const afterPip = await waitForLaneItems(main, pipLane, 1);
  await shot(main, `${label}-01-after.png`);
  assert(afterMoved[0].itemKind === 'cut', `${label} after: ${movedItemId} still renders as a cut clip on ${targetLane}`, { afterMoved });
  assert(afterPip[0].itemKind === 'cut', `${label} after: untouched pip-1 still renders as a cut clip`, { afterPip });
  assert(afterPip[0].className === beforePip[0].className,
    `${label}: untouched pip-1's CSS class unchanged by the unrelated drag`,
    { before: beforePip[0].className, after: afterPip[0].className });
  assert(afterPip[0].background === beforePip[0].background,
    `${label}: untouched pip-1's computed background unchanged by the unrelated drag`,
    { before: beforePip[0].background, after: afterPip[0].background });
  const targetBandKind = await trackBandKind(main, targetLane);
  assert(targetBandKind === 'cuts', `${label} after: ${targetLane} band kind is cuts`, { targetBandKind });

  record(`${label}-PASS`, {});
}

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
  // Same technique as evidence/t3-filmstrip-lazy-realdata and evidence/t4-track-height-resize's
  // own run-l1.mjs: the default window is too small to show all 3 visual tracks of the 2a/3a
  // fixtures at once, so a rect computed for an off-screen (but still DOM-present, so
  // getBoundingClientRect() happily returns numbers for it) track/clip silently misses -- no
  // exception, the drag just lands nowhere meaningful. Resize before touching any geometry.
  await evalOn(main, `(() => { window.resizeTo(1800, 2000); return true; })()`);
  await sleep(300);
  await openTimeline(main);
  await dismissProjectConsentIfPresent(main);

  if (phase === '2r') {
    await realDragScenario(main, main, {
      label: '2r', pipLane: 'v-pip', sourceLane: 'v-move', targetLane: 'v-empty', movedItemId: 'move-1',
    });
  }
  if (phase === '3r') {
    await realDragScenario(main, main, {
      label: '3r', pipLane: 'v2', sourceLane: 'v1', targetLane: 'v5', movedItemId: 'moved-1',
    });
  }

  await writeFile(path.join(evidenceDir, `run-log-phase${phase}.json`), JSON.stringify(log, null, 2));
  main.close();
  console.log(`PHASE ${phase} REAL-DRAG ACCEPTANCE CRITERIA PASSED`);
}

main().catch(async error => {
  console.error('FAILED', error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `run-log-phase${phase}-partial.json`), JSON.stringify(log, null, 2));
  process.exit(1);
});
