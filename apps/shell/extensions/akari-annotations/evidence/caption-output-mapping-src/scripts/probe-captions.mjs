#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import {
  CDP,
  evalOn,
  keyPress,
  listTargets,
  resizeViewport,
  screenshot,
} from '../../caption-subrow-output-space/scripts/cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg, labelArg] = process.argv;
const cdpPort = Number(cdpPortArg || 9711);
const workspaceDir = path.resolve(workspaceDirArg);
const evidenceDir = path.resolve(evidenceDirArg);
const label = labelArg || 'run';
const log = [];
const failures = [];

function record(step, data) {
  log.push({ step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
}

function check(condition, message, data = {}) {
  record(condition ? 'ok' : 'FAILED', { message, ...data });
  if (!condition) failures.push({ message, ...data });
}

async function openTimeline(main) {
  let found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
  for (let attempt = 0; attempt < 6 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(900);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(900);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 12 && !found; wait++) {
      await sleep(600);
      found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
    }
    if (!found) {
      await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
  }
  return found;
}

async function timelineRects(main) {
  return evalOn(main, `(() => {
    const rect = element => {
      const bounds = element.getBoundingClientRect();
      return {
        id: element.dataset.akariItemId,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height
      };
    };
    return {
      captions: Array.from(document.querySelectorAll('.akari-annotations-strip-caption'))
        .filter(element => element.dataset.akariItemKind === 'caption').map(rect),
      cuts: Array.from(document.querySelectorAll('.akari-annotations-strip-clip'))
        .filter(element => element.dataset.akariItemKind === 'cut').map(rect)
    };
  })()`);
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const targets = await listTargets(cdpPort);
  const target = targets.find(candidate => candidate.type === 'page');
  if (!target) throw new Error('main page target not found');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  record('viewport', await resizeViewport(cdp, 1440, 1250));
  await sleep(1200);
  check(await openTimeline(cdp), 'タイムラインウィジェットが開いた');
  await sleep(1500);

  const edit = JSON.parse(await readFile(path.join(workspaceDir, 'edit.json'), 'utf8'));
  const captions = JSON.parse(await readFile(path.join(workspaceDir, 'captions.json'), 'utf8'));
  const sourceByCutId = new Map(edit.tracks.find(track => track.id === 'v1').items
    .map((item, index) => [String(index), item.source.src]));
  const sourceByCaptionId = new Map(captions.map(caption => [caption.id, caption.src]));
  const rects = await timelineRects(cdp);
  await screenshot(cdp, path.join(evidenceDir, `${label}-timeline.png`));

  const correspondence = rects.captions.map(captionRect => {
    const captionSrc = sourceByCaptionId.get(captionRect.id);
    const overlaps = rects.cuts.map(cutRect => ({
      cutId: cutRect.id,
      cutSrc: sourceByCutId.get(cutRect.id),
      overlapPx: horizontalOverlap(captionRect, cutRect),
    }));
    return { captionId: captionRect.id, captionSrc, rect: captionRect, overlaps };
  });
  record('dom-rects', { ...rects, correspondence });

  check(rects.captions.length === 2, '字幕帯が 2 本描かれている', { count: rects.captions.length });
  check(rects.cuts.length === 2, '異なる source のクリップ帯が 2 本描かれている', {
    count: rects.cuts.length,
    sources: rects.cuts.map(rect => sourceByCutId.get(rect.id)),
  });
  for (const entry of correspondence) {
    const own = entry.overlaps.filter(overlap => overlap.cutSrc === entry.captionSrc);
    const unrelated = entry.overlaps.filter(overlap => overlap.cutSrc !== entry.captionSrc);
    check(own.some(overlap => overlap.overlapPx > 0),
      `${entry.captionId} は自分の source のクリップ区間に描かれる`, { own });
    check(unrelated.every(overlap => overlap.overlapPx === 0),
      `${entry.captionId} は無関係な source のクリップ区間に描かれない`, { unrelated });
  }

  await writeFile(path.join(evidenceDir, `probe-${label}.json`), JSON.stringify({
    label,
    failures,
    log,
  }, null, 2));
  console.log(failures.length === 0
    ? `ALL SOURCE MAPPING ASSERTIONS PASSED (${label})`
    : `FAILURES (${label}): ${failures.length}`);
  cdp.close();
}

main().catch(async error => {
  console.error(error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `probe-${label}.json`), JSON.stringify({
    label,
    error: String(error),
    failures,
    log,
  }, null, 2));
  process.exit(1);
});
