#!/usr/bin/env node
// caption-subrow-output-space の L1 実測ドライバ。
//
// 観測は **すべて実 DOM**（.akari-annotations-strip-caption の getBoundingClientRect）から取る。
// window.__akariPreview.summary は差分更新で更新されないため使わない
// （handoff-2026-08-20 §7-3 の既知の罠）。
//
// Usage: node probe-captions.mjs <cdpPort> <workspaceDir> <evidenceDir> <label>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, resizeViewport } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg, labelArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9711);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const LABEL = labelArg || 'run';

const log = [];
function record(step, data) {
  const entry = { step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
const failures = [];
function check(cond, message, data) {
  record(cond ? 'ok' : 'FAILED', { message, ...data });
  if (!cond) failures.push({ message, ...data });
  return cond;
}

/** 字幕帯の実 DOM 矩形。data-akari-item-kind="caption" だけを拾う。 */
async function captionRects(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('.akari-annotations-strip-caption'))
    .filter(el => el.dataset.akariItemKind === 'caption')
    .map(el => { const r = el.getBoundingClientRect();
      return { id: el.dataset.akariItemId, lane: el.dataset.akariLane,
               left: r.left, right: r.right, top: r.top, bottom: r.bottom,
               width: r.width, height: r.height }; })`);
}

/** 字幕トラック帯（レーンの器）の実 DOM 矩形。 */
async function captionBand(main) {
  return evalOn(main, `(() => {
    const b = Array.from(document.querySelectorAll('.akari-track-band'))
      .find(el => el.dataset.akariKind === 'captions');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { id: b.dataset.akariLane, top: r.top, bottom: r.bottom, height: r.height };
  })()`);
}

/** 出力軸の総尺（帯の左端 = 0 秒、右端 = 総尺）を実 DOM の strip 幅から逆算するための基準。 */
async function stripRect(main) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-annotations-strip');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom };
  })()`);
}

async function openTimeline(main) {
  let found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
  for (let attempt = 0; attempt < 6 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(900);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(900);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let w = 0; w < 12 && !found; w++) {
      await sleep(600);
      found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
    }
    if (!found) { await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300); }
  }
  return found;
}

function intersects(a, b) {
  const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return { xOverlap, yOverlap, overlapping: xOverlap > 0 && yOverlap > 0 };
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const targets = await listTargets(CDP_PORT);
  const mainTarget = targets.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const cdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  record('viewport', await resizeViewport(cdp, 1440, 1250));
  await sleep(1200);
  record('connected', { cdpPort: CDP_PORT, workspace: WORKSPACE_DIR, label: LABEL });

  check(await openTimeline(cdp), 'タイムラインウィジェットが開いた');
  await sleep(1500);

  const editJson = JSON.parse(await readFile(path.join(WORKSPACE_DIR, 'edit.json'), 'utf8'));
  const captionsJson = JSON.parse(await readFile(path.join(WORKSPACE_DIR, 'captions.json'), 'utf8'));
  record('fixture', {
    cuts: editJson.tracks.find(t => t.id === 'v1').items.map(i => ({
      id: i.id, atFrames: i.at, durationFrames: i.duration,
      outSeconds: [i.at / editJson.output.fps, (i.at + i.duration) / editJson.output.fps],
      sourceSeconds: [i.source.in, i.source.out]
    })),
    captions: captionsJson.map(c => ({ id: c.id, source: [c.start, c.end] }))
  });

  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-timeline.png`));

  const band = await captionBand(cdp);
  const strip = await stripRect(cdp);
  const rects = await captionRects(cdp);
  record('caption-band', { band, strip, drawnCount: rects.length });
  record('caption-rects', { rects });

  // --- 段（row）の実測: 字幕レーン帯の top を原点に SUBROW_STRIDE(=36px) 単位で段番号を復元する。
  //     レーン全体の絶対 top は段数によって中央寄せ量が変わり動くので、必ずレーン相対で測る。 ---
  const SUBROW_STRIDE = 36;
  const rowOf = r => Math.round((r.top - band.top) / SUBROW_STRIDE);
  const rowAssignment = rects.map(r => ({ id: r.id, top: r.top, laneRelativeTop: r.top - band.top, row: rowOf(r) }));
  record('rows', {
    subrowStride: SUBROW_STRIDE,
    bandTop: band.top,
    distinctTops: [...new Set(rects.map(r => Math.round(r.top * 100) / 100))].sort((a, b) => a - b),
    assignment: rowAssignment,
    rowById: Object.fromEntries(rowAssignment.map(r => [r.id, r.row]))
  });

  // --- 受け入れ条件 1: 字幕帯の矩形どうしが 1px も重ならない ---
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const hit = intersects(rects[i], rects[j]);
      pairs.push({ a: rects[i].id, b: rects[j].id, ...hit });
    }
  }
  const overlapping = pairs.filter(p => p.overlapping);
  record('overlap-pairs', { total: pairs.length, overlapping });
  check(overlapping.length === 0,
    '字幕帯の矩形どうしが 1px も重ならない（全ペアの getBoundingClientRect 交差なし）',
    { overlappingCount: overlapping.length, overlapping });

  // --- 受け入れ条件 1b: 同じ top の帯が x 方向で交差しない（契約の明示表現） ---
  const sameTopCrossing = pairs.filter(p => {
    const a = rects.find(r => r.id === p.a);
    const b = rects.find(r => r.id === p.b);
    return Math.abs(a.top - b.top) < 0.5 && p.xOverlap > 0;
  });
  check(sameTopCrossing.length === 0,
    '同じ top の帯が x 方向で交差しない', { sameTopCrossing });

  // --- 受け入れ条件 2: 極短い字幕が連続しても重ならない ---
  const tiny = rects.filter(r => r.id.startsWith('cap-tiny-'));
  check(tiny.length === 3, '極短い字幕 3 本がすべて描かれている', { tiny });
  const tinyPairs = pairs.filter(p => p.a.startsWith('cap-tiny-') && p.b.startsWith('cap-tiny-'));
  check(tinyPairs.every(p => !p.overlapping),
    '極短い字幕（MINIMUM_ITEM_DURATION 未満）が連続しても重ならない', { tinyPairs });

  // --- 受け入れ条件 3: 削除区間へ完全に落ちた字幕は描かれない ---
  const droppedIds = captionsJson.filter(c => c.id.startsWith('cap-dropped-')).map(c => c.id);
  const drawnIds = rects.map(r => r.id);
  check(droppedIds.every(id => !drawnIds.includes(id)),
    '削除区間へ完全に落ちた字幕は帯として描かれない', { droppedIds, drawnIds });
  const expectedDrawn = captionsJson.filter(c => !c.id.startsWith('cap-dropped-')).map(c => c.id);
  check(expectedDrawn.every(id => drawnIds.includes(id)),
    '削除区間に落ちていない字幕はすべて描かれている', { expectedDrawn, drawnIds });

  // --- 契約の症状: source では重ならないのに output では重なる 2 本（cap-span / cap-late） ---
  const span = rects.find(r => r.id === 'cap-span');
  const late = rects.find(r => r.id === 'cap-late');
  if (span && late) {
    record('headline-symptom', {
      sourceRanges: { 'cap-span': [1.0, 3.0], 'cap-late': [5.0, 10.6] },
      sourceOverlap: false,
      rects: { span, late },
      intersect: intersects(span, late)
    });
    check(!intersects(span, late).overlapping,
      'source で重ならない cap-span / cap-late が output でも重なって描かれない',
      { span, late });
  }

  await writeFile(path.join(EVIDENCE_DIR, `probe-${LABEL}.json`),
    JSON.stringify({ label: LABEL, failures, log }, null, 2));

  console.log(failures.length === 0
    ? `ALL CAPTION ASSERTIONS PASSED (${LABEL})`
    : `FAILURES (${LABEL}): ${failures.length}`);
  cdp.close();
  process.exit(0);
}

main().catch(async err => {
  console.error(err);
  await writeFile(path.join(EVIDENCE_DIR, `probe-${LABEL}.json`),
    JSON.stringify({ label: LABEL, error: String(err), failures, log }, null, 2));
  process.exit(1);
});
