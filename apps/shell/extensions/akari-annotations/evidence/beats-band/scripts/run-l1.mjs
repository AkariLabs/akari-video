#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only) raw-CDP acceptance driver for the
// read-only beats band. Run against a production-build Electron instance.
// Usage: node run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CDP, listTargets, evalOn, realClick, realDrag, screenshot, keyPress
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
if (!WORKSPACE_DIR || !EVIDENCE_DIR) {
  throw new Error('usage: run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>');
}
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(SCRIPT_DIR, '../fixture');
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'exports', 'edit.json');
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

const WIDGET_REFS = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const timelineViewport = w.children[1];
  const stripScroll = timelineViewport.children[1];
  return { w, strip: stripScroll.children[0] };
})()`;

async function shot(main, name) {
  await screenshot(main, path.join(EVIDENCE_DIR, name));
}

async function writeFixture(name) {
  const raw = await readFile(path.join(FIXTURE_DIR, name, 'edit.json'), 'utf8');
  await writeFile(EDIT_JSON_PATH, raw);
  return raw;
}

async function beatState(main) {
  return evalOn(main, `(() => {
    const refs = ${WIDGET_REFS};
    if (!refs) return { found: false };
    const bands = Array.from(refs.strip.querySelectorAll('.akari-track-band')).map(element => {
      const rect = element.getBoundingClientRect();
      return {
        lane: element.dataset.akariLane,
        top: rect.top,
        height: rect.height,
        styleTop: element.style.top,
        text: element.textContent
      };
    });
    const markers = Array.from(refs.strip.querySelectorAll('.akari-beat-marker')).map(element => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.akariBeatId,
        kind: element.dataset.akariBeatKind,
        strength: Number(element.dataset.akariBeatStrength),
        occurrence: Number(element.dataset.akariBeatOccurrence),
        title: element.title,
        leftPercent: parseFloat(element.style.left),
        opacity: Number(element.style.opacity),
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        color: getComputedStyle(element).backgroundColor
      };
    });
    return {
      found: true,
      bands,
      markers,
      playheadLeft: refs.strip.children[0].style.left
    };
  })()`);
}

async function waitForMarkers(main, count, ids, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await beatState(main);
    const actualIds = state.markers?.map(marker => marker.id).sort() ?? [];
    if (state.found && state.markers.length === count
      && JSON.stringify(actualIds) === JSON.stringify([...ids].sort())) {
      return state;
    }
    await sleep(200);
  }
  throw new Error(`markers did not settle: ${JSON.stringify(state)}`);
}

function timelinePositions(state, totalDuration, id) {
  return state.markers
    .filter(marker => marker.id === id)
    .map(marker => marker.leftPercent * totalDuration / 100)
    .sort((a, b) => a - b);
}

function assertPositions(actual, expected, label) {
  const tolerance = 0.002;
  assert(actual.length === expected.length
    && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance),
  label, { actual, expected, tolerance });
}

async function waitForTimelinePositions(main, totalDuration, id, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  let actual = [];
  while (Date.now() < deadline) {
    state = await beatState(main);
    actual = timelinePositions(state, totalDuration, id);
    if (actual.length === expected.length
      && actual.every((value, index) => Math.abs(value - expected[index]) <= 0.002)) {
      return state;
    }
    await sleep(200);
  }
  throw new Error(`positions did not settle: ${JSON.stringify({ id, actual, expected, state })}`);
}

async function openTimeline(main) {
  let state = await beatState(main);
  for (let attempt = 0; attempt < 3 && !state.found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(700);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(700);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 12 && !state.found; wait++) {
      await sleep(400);
      state = await beatState(main);
    }
    if (!state.found) {
      await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
  }
  assert(state.found, 'timeline widget opened via command palette');
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const targets = await listTargets(CDP_PORT);
  const mainTarget = targets.find(target => target.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');

  await openTimeline(main);

  // Regression baseline: no beats means no band and the legacy captions top remains exactly 14px.
  await writeFile(EDIT_JSON_PATH, JSON.stringify({
    version: 0,
    source: { path: 'sample.mp4' },
    output: { width: 640, height: 360, fps: 30 },
    cuts: [{ in: 0, out: 8 }]
  }, null, 2));
  const noBeats = await waitForMarkers(main, 0, []);
  const noBeatsCaption = noBeats.bands.find(band => band.lane === 'captions');
  assert(!noBeats.bands.some(band => band.lane === 'beats'),
    'no beats field: beats band is absent', { bands: noBeats.bands });
  assert(noBeatsCaption?.styleTop === '14px',
    'no beats field: captions keeps legacy top=14px', { noBeatsCaption });

  // Fixture (a): three v0 beats, positions 1/4/8 timeline seconds, distinct kind colors and strength sizes.
  const fixtureARaw = await writeFixture('a-v0');
  const a = await waitForMarkers(main, 3, ['b-0001', 'b-0002', 'b-0003']);
  const beatsBand = a.bands.find(band => band.lane === 'beats');
  const captionsBand = a.bands.find(band => band.lane === 'captions');
  assert(Boolean(beatsBand && captionsBand && beatsBand.top < captionsBand.top),
    'fixture (a): 見せ場 band is the topmost content lane', { beatsBand, captionsBand });
  assert(beatsBand?.text?.includes('見せ場'), 'fixture (a): band label is 見せ場', { beatsBand });
  assertPositions(a.markers.map(marker => marker.leftPercent * 10.2 / 100).sort((x, y) => x - y),
    [1, 4, 8], 'fixture (a): source seconds project to expected timeline positions');
  assert(new Set(a.markers.map(marker => marker.color)).size === 3,
    'fixture (a): mixed kinds use distinct colors', { colors: a.markers.map(marker => marker.color) });
  const byStrength = [...a.markers].sort((left, right) => left.strength - right.strength);
  assert(byStrength[0].width < byStrength[1].width && byStrength[1].width < byStrength[2].width
    && byStrength[0].opacity < byStrength[1].opacity && byStrength[1].opacity < byStrength[2].opacity,
  'fixture (a): strength maps linearly to size and opacity', { byStrength });
  assert(a.markers.find(marker => marker.id === 'b-0001').title.includes('basis: 冒頭の問い')
    && !a.markers.find(marker => marker.id === 'b-0002').title.includes('basis:'),
  'fixture (a): tooltip shows basis only when present', { titles: a.markers.map(marker => marker.title) });
  await shot(main, '01-v0-three-beats.png');

  // Read-only interaction: marker click leaves playhead and file unchanged; drag leaves the file unchanged.
  const marker = a.markers.find(candidate => candidate.id === 'b-0002');
  const playheadBefore = a.playheadLeft;
  await realClick(main, marker.centerX, marker.centerY);
  await sleep(300);
  const afterClick = await beatState(main);
  assert(afterClick.playheadLeft === playheadBefore,
    'marker click is inert (playhead unchanged)', { playheadBefore, playheadAfter: afterClick.playheadLeft });
  await realDrag(main, [
    { x: marker.centerX, y: marker.centerY },
    { x: marker.centerX + 90, y: marker.centerY }
  ]);
  await sleep(500);
  const afterInteractionRaw = await readFile(EDIT_JSON_PATH, 'utf8');
  assert(afterInteractionRaw === fixtureARaw,
    'marker click/drag causes zero edit.json writes', { byteLength: afterInteractionRaw.length });

  // Fixture (b): src filtering + true one-to-many projection.
  const fixtureBRaw = await writeFixture('b-v1');
  const b = await waitForMarkers(main, 3, ['b-0101', 'b-0101', 'b-0102']);
  assertPositions(timelinePositions(b, 10.2, 'b-0101'), [2, 9],
    'fixture (b): one s1 beat appears once per matching keep-range and not in overlapping s2 cut');
  assertPositions(timelinePositions(b, 10.2, 'b-0102'), [6],
    'fixture (b): s2 beat projects only through s2 cut');
  await shot(main, '02-v1-one-to-many.png');

  const reordered = JSON.parse(fixtureBRaw);
  reordered.cuts = [reordered.cuts[2], reordered.cuts[1], reordered.cuts[0]];
  await writeFile(EDIT_JSON_PATH, `${JSON.stringify(reordered, null, 2)}\n`);
  const reorderedState = await waitForTimelinePositions(main, 10.2, 'b-0101', [1, 8]);
  assertPositions(timelinePositions(reorderedState, 10.2, 'b-0101'), [1, 8],
    'fixture (b): cut reorder triggers fresh projection and moves both occurrences');
  await shot(main, '03-v1-after-cut-reorder.png');

  // Fixture (c): one malformed entry is ignored without suppressing valid siblings.
  await writeFixture('c-invalid');
  const c = await waitForMarkers(main, 2, ['b-0201', 'b-0203']);
  assertPositions(c.markers.map(item => item.leftPercent * 8.16 / 100).sort((x, y) => x - y),
    [1, 5], 'fixture (c): invalid item is skipped and valid siblings retain expected positions');
  assert(!c.markers.some(item => item.id === 'invalid-id'),
    'fixture (c): invalid id/strength entry is not rendered', { markers: c.markers });
  await shot(main, '04-invalid-item-degrades.png');

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-final.json'), JSON.stringify(log, null, 2));
  main.close();
  console.log('ALL ACCEPTANCE CRITERIA PASSED');
}

main().catch(error => {
  console.error('FAILED', error);
  writeFile(path.join(EVIDENCE_DIR, 'run-log-partial.json'), JSON.stringify(log, null, 2)).finally(() => {
    process.exit(1);
  });
});
