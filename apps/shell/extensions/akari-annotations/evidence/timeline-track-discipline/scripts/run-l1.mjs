#!/usr/bin/env node
// timeline-track-discipline の L1 実測ドライバ。production ビルドの Electron を隔離
// user-data-dir + --remote-debugging-port で起動し、生 CDP（cdp-lib.mjs）で実マウス
// イベントをディスパッチしてタイムラインの縦ドラッグを検証する。
//
// 観測は必ず実 DOM を読む（window.__akariPreview.summary は差分更新で更新されないため
// 使わない — handoff-2026-08-20 §7-3 の既知の罠）。
//
// Usage: node run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, realClick, resizeViewport } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9611);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'edit.json');

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function assert(cond, message, data) {
  if (!cond) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}
async function shot(main, name) {
  await screenshot(main, path.join(EVIDENCE_DIR, name));
}
async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

/** edit.json の tracks[] を「id -> items[].id」の形へ落とす（配列順 = z の権威を保つ）。 */
function trackShape(edit) {
  return edit.tracks.map(t => ({
    id: t.id,
    lane: t.lane,
    kind: Array.isArray(t.items) ? 'items' : (t.content ? 'content' : 'other'),
    items: Array.isArray(t.items) ? t.items.map(i => i.id) : undefined
  }));
}

// ---- 実 DOM アクセサ（summary は使わない） ----
async function bandRects(main) {
  return evalOn(main, `(() => {
    const strip = document.getElementById('akari-annotations-widget')
      .children[1].children[1].children[1].children[0];
    return Array.from(strip.querySelectorAll('.akari-track-band')).map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.akariLane, kind: b.dataset.akariKind, track: b.dataset.akariTrack,
               top: r.top, bottom: r.bottom, height: r.height };
    });
  })()`);
}

async function stripRect(main) {
  return evalOn(main, `(() => {
    const r = document.getElementById('akari-annotations-widget')
      .children[1].children[1].children[1].getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })()`);
}

async function clipRects(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('.akari-annotations-strip-clip'))
    .filter(el => el.dataset.akariItemKind === 'cut')
    .map(el => { const r = el.getBoundingClientRect();
      return { id: el.dataset.akariItemId, label: (el.textContent||'').slice(0,4),
               left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               width: r.width, height: r.height }; })`);
}

/** 緑ライン（トラック挿入インジケータ）の実 DOM 状態。data-testid で解決する。 */
async function insertIndicator(main) {
  return evalOn(main, `(() => {
    const el = document.querySelector('[data-testid="akari-track-insert-indicator"]');
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { found: true, visible: cs.display !== 'none', top: r.top, background: cs.backgroundColor };
  })()`);
}

async function dragFeedbackText(main) {
  return evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    if (!w) return null;
    const timelineOverlay = w.children[1].children[1].children[2];
    return timelineOverlay.children[2].textContent;
  })()`);
}

async function ghostRejected(main) {
  return evalOn(main, `(() => {
    // ゴーストは掴んだ要素の複製なので、cut は .strip-clip、layer は .strip-layer、
    // overlay は .strip-overlay として現れる。どれも点線ボーダーで識別する。
    const g = document.querySelector('.akari-annotations-strip-clip[style*="dashed"],'
      + '.akari-annotations-strip-layer[style*="dashed"],.akari-annotations-strip-overlay[style*="dashed"]');
    if (!g) return { found: false };
    return { found: true, rejected: g.classList.contains('akari-annotations-ghost-rejected'),
             top: g.getBoundingClientRect().top };
  })()`);
}

// ---- 低レベル入力 ----
async function press(main, x, y) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(40);
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
}
async function moveTo(main, x, y, steps = 6) {
  for (let s = 1; s <= steps; s++) {
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(12);
  }
  await sleep(60);
}
async function release(main, x, y) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
  await sleep(400);
}

async function waitEdit(main, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let edit = await readJson(EDIT_JSON_PATH);
  while (Date.now() < deadline) {
    if (predicate(edit)) return edit;
    await sleep(150);
    edit = await readJson(EDIT_JSON_PATH);
  }
  return edit;
}

async function focusWidgetToolbar(main) {
  const point = await evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    const r = w.children[0].getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 5 };
  })()`);
  await realClick(main, point.x, point.y);
  await sleep(200);
}

async function undoTo(main, predicate) {
  await focusWidgetToolbar(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  return waitEdit(main, predicate);
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

function bandById(bands, id) { return bands.find(b => b.id === id); }

/** c3（V3 の唯一のクリップ）の DOM 矩形を V3 バンドの範囲で特定する。 */
function clipInBand(clips, band) {
  return clips.find(c => c.top >= band.top - 2 && c.bottom <= band.bottom + 4);
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const targets0 = await listTargets(CDP_PORT);
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const cdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  record('viewport', await resizeViewport(cdp, 1440, 1250));
  await sleep(1200);
  record('connected', { cdpPort: CDP_PORT, workspace: WORKSPACE_DIR });

  assert(await openTimeline(cdp), 'timeline widget opened via command palette');
  await sleep(800);
  await shot(cdp, '00-opened.png');

  const edit0 = await readJson(EDIT_JSON_PATH);
  const bands0 = await bandRects(cdp);
  const strip0 = await stripRect(cdp);
  const clips0 = await clipRects(cdp);
  record('baseline', { tracks: trackShape(edit0), bands: bands0, strip: strip0, clips: clips0 });

  // --- 前提: 帯の縦順が tracks[] の逆順（配列順 = z の権威）であること ---
  const declaredTopDown = [...edit0.tracks].reverse().map(t => t.id);
  const domTopDown = [...bands0].sort((a, b) => a.top - b.top).map(b => b.id);
  assert(JSON.stringify(declaredTopDown) === JSON.stringify(domTopDown),
    'baseline: 帯の縦順が tracks[] の逆順と完全一致（z の権威 = 配列順）',
    { declaredTopDown, domTopDown });

  const bV3 = bandById(bands0, 'v3');
  const bV2 = bandById(bands0, 'v2');
  const bCaptions = bandById(bands0, 'captions');
  const bAudio = bandById(bands0, 'a-bgm');
  assert(bV3 && bV2 && bCaptions && bAudio, 'baseline: v3/v2/captions/a-bgm の帯が全て存在',
    { bV3, bV2, bCaptions, bAudio });

  const c3 = clipInBand(clips0, bV3);
  assert(Boolean(c3), 'baseline: V3 の帯の中に c3 のクリップ要素がある', { c3, bV3 });
  const grabX = c3.left + c3.width / 2;
  const grabY = c3.top + c3.height / 2;

  // =====================================================================
  // 症状 3: V3 のクリップを V2 本体へ。V2 に入る手前で緑線が出ないこと。
  // 緑線が出ている位置とドロップ結果が一致すること。
  // =====================================================================
  const probes = [
    { name: 'v2-top-edge+1', y: bV2.top + 1 },
    { name: 'v2-top-edge+3', y: bV2.top + 3 },
    { name: 'v2-top-edge+8', y: bV2.top + 8 },
    { name: 'v2-center', y: bV2.top + bV2.height / 2 },
    { name: 'v2-bottom-edge-3', y: bV2.bottom - 3 }
  ];
  await press(cdp, grabX, grabY);
  const probeResults = [];
  for (const probe of probes) {
    await moveTo(cdp, grabX, probe.y);
    const [ind, fb, gh] = [await insertIndicator(cdp), await dragFeedbackText(cdp), await ghostRejected(cdp)];
    probeResults.push({ ...probe, indicatorVisible: ind.visible, indicatorTop: ind.top, feedback: fb, ghostRejected: gh.rejected });
    record('s3-probe', { probe: probe.name, y: probe.y, indicatorVisible: ind.visible, feedback: fb, ghostRejected: gh.rejected });
  }
  await shot(cdp, '01-s3-drag-over-v2.png');
  const last = probes[probes.length - 1];
  await release(cdp, grabX, last.y);
  await shot(cdp, '02-s3-after-drop.png');

  for (const r of probeResults) {
    assert(r.indicatorVisible === false,
      `症状3: V2 帯の内側 (${r.name}) では緑ラインが出ない`, { y: r.y, indicatorTop: r.indicatorTop });
    assert(r.ghostRejected === false && !String(r.feedback).includes('レーンが異なる'),
      `症状3: V2 帯の内側 (${r.name}) で拒否されない`, { feedback: r.feedback });
  }

  const editS3 = await waitEdit(cdp, e => e.tracks.every(t => t.id !== 'v3'));
  record('s3-after', { tracks: trackShape(editS3) });
  const v2After = editS3.tracks.find(t => t.id === 'v2');
  assert(Boolean(v2After) && v2After.items.map(i => i.id).includes('c3'),
    '症状3: c3 が V2 の items[] へ入った', { v2: v2After });
  // === 症状 1: 空になった V3 が tracks[] から消える。字幕・音は巻き添えにならない ===
  assert(editS3.tracks.every(t => t.id !== 'v3'),
    '症状1: 空になった V3 が tracks[] から消えた', { ids: editS3.tracks.map(t => t.id) });
  assert(editS3.tracks.some(t => t.id === 'captions') && editS3.tracks.some(t => t.id === 'a-bgm'),
    '症状1: 字幕トラック(content型)と音トラックは巻き添えで消えない', { ids: editS3.tracks.map(t => t.id) });
  assert(editS3.tracks.some(t => t.id === 'v-empty'),
    '症状1: 「トラックを追加」相当の明示的な空トラック(v-empty)は sweep されない（裁定）',
    { ids: editS3.tracks.map(t => t.id) });
  const zAfterS3 = editS3.tracks.map(t => t.id);
  const zExpected = edit0.tracks.map(t => t.id).filter(id => id !== 'v3');
  assert(JSON.stringify(zAfterS3) === JSON.stringify(zExpected),
    '症状1: 畳んだ結果として残るトラックの相対順（z）が不変', { zAfterS3, zExpected });

  const bandsS3 = await bandRects(cdp);
  const domS3 = [...bandsS3].sort((a, b) => a.top - b.top).map(b => b.id);
  assert(JSON.stringify(domS3) === JSON.stringify([...editS3.tracks].reverse().map(t => t.id)),
    '症状1: DOM の帯の縦順も tracks[] 逆順のまま（非回帰）', { domS3 });

  // --- undo で V3 とクリップの両方が戻る ---
  const editUndo1 = await undoTo(cdp, e => e.tracks.some(t => t.id === 'v3'));
  record('s3-undo', { tracks: trackShape(editUndo1) });
  assert(JSON.stringify(trackShape(editUndo1)) === JSON.stringify(trackShape(edit0)),
    'undo: トラックの消滅とクリップの移動が 1 操作でまとめて元へ戻る',
    { before: trackShape(edit0), after: trackShape(editUndo1) });
  await shot(cdp, '03-s3-after-undo.png');
  await sleep(400);

  // =====================================================================
  // 症状 2: 最上段（字幕帯）よりさらに上へドロップ → 新しい最上段が作られる
  // =====================================================================
  const bands2 = await bandRects(cdp);
  const clips2 = await clipRects(cdp);
  const bV3b = bandById(bands2, 'v3');
  const c3b = clipInBand(clips2, bV3b);
  assert(Boolean(c3b), 'undo 後に c3 が V3 の帯へ戻っている', { c3b, bV3b });
  const topBand = [...bands2].sort((a, b) => a.top - b.top)[0];
  const strip2 = await stripRect(cdp);
  const grabX2 = c3b.left + c3b.width / 2;
  const grabY2 = c3b.top + c3b.height / 2;

  const farAboveY = Math.max(8, topBand.top - 120);
  record('s2-geometry', { topBandId: topBand.id, topBandTop: topBand.top, stripTop: strip2.top, farAboveY,
    distanceAboveTopBandPx: topBand.top - farAboveY });

  await press(cdp, grabX2, grabY2);
  await moveTo(cdp, grabX2, topBand.top - 4);
  const nearAbove = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('s2-near-above', nearAbove);
  await moveTo(cdp, grabX2, farAboveY);
  const farAbove = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('s2-far-above', farAbove);
  await shot(cdp, '04-s2-far-above-indicator.png');
  await release(cdp, grabX2, farAboveY);
  await shot(cdp, '05-s2-after-drop.png');

  assert(farAbove.ghost.rejected === false, '症状2: 最上段よりはるか上でも拒否されない', farAbove);
  assert(!String(farAbove.feedback).includes('レーンが異なる'),
    '症状2: 「⚠ レーンが異なるため移動できません」が出ない', { feedback: farAbove.feedback });
  assert(farAbove.indicator.visible === true, '症状2: 緑ラインが表示される', farAbove.indicator);
  assert(Math.abs(farAbove.indicator.top - topBand.top) <= 4,
    '症状2: 緑ラインは最上段の上端に出る（= 実際の挿入位置）',
    { indicatorTop: farAbove.indicator.top, topBandTop: topBand.top });

  const editS2 = await waitEdit(cdp, e => e.tracks.every(t => t.id !== 'v3'));
  record('s2-after', { tracks: trackShape(editS2) });
  const created = editS2.tracks[editS2.tracks.length - 1];
  assert(Array.isArray(created.items) && created.items.map(i => i.id).includes('c3'),
    '症状2: tracks[] の末尾（= 画面最上段）に新しいトラックが作られ c3 が入った', { created });
  assert(created.id !== 'v3' && created.lane === 'visual', '症状2: 作られたのは新規 visual トラック', { created });
  assert(editS2.tracks.every(t => t.id !== 'v3'), '症状2: 空になった V3 は同時に畳まれる', { ids: editS2.tracks.map(t => t.id) });

  const bandsS2 = await bandRects(cdp);
  const domS2 = [...bandsS2].sort((a, b) => a.top - b.top).map(b => b.id);
  assert(JSON.stringify(domS2) === JSON.stringify([...editS2.tracks].reverse().map(t => t.id)),
    '症状2: 新規トラックが画面上でも最上段（DOM 縦順 = tracks[] 逆順）',
    { domS2, declared: [...editS2.tracks].reverse().map(t => t.id) });
  assert(domS2[0] === created.id, '症状2: 新規トラックが実際に最上段に描画される', { domS2, createdId: created.id });

  const editUndo2 = await undoTo(cdp, e => e.tracks.some(t => t.id === 'v3'));
  assert(JSON.stringify(trackShape(editUndo2)) === JSON.stringify(trackShape(edit0)),
    'undo: 最上段への新規トラック作成も 1 操作で元へ戻る',
    { after: trackShape(editUndo2) });
  await shot(cdp, '06-s2-after-undo.png');
  await sleep(400);

  // =====================================================================
  // 症状 2b: layer 系クリップ（オーナー報告の「⚠ レーンが異なるため移動できません」
  // を出す分岐）でも最上段より上へ落とせる。緑ラインは insertTrack のときだけ出る。
  // =====================================================================
  const bandsL = await bandRects(cdp);
  const layerEls = await evalOn(cdp, `Array.from(document.querySelectorAll('.akari-annotations-strip-layer'))
    .map(el => { const r = el.getBoundingClientRect();
      return { id: el.dataset.akariItemId, lane: el.dataset.akariLane,
               left: r.left, top: r.top, width: r.width, height: r.height }; })`);
  record('layer-elements', { layerEls });
  assert(layerEls.length >= 1, '前提: layers 経路のクリップが描画されている', { layerEls });
  const L1 = layerEls.find(e => e.id === 'L1') ?? layerEls[0];
  const topBandL = [...bandsL].sort((a, b) => a.top - b.top)[0];
  const bV2L = bandById(bandsL, 'v2');
  const farAboveL = Math.max(8, topBandL.top - 120);
  await press(cdp, L1.left + L1.width / 2, L1.top + L1.height / 2);
  await moveTo(cdp, L1.left + L1.width / 2, bV2L.top + 3);
  const layerOnV2 = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('s2b-layer-over-v2-top-edge', layerOnV2);
  await moveTo(cdp, L1.left + L1.width / 2, farAboveL);
  const layerFarAbove = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('s2b-layer-far-above', { y: farAboveL, ...layerFarAbove });
  await shot(cdp, '08-s2b-layer-far-above.png');
  await release(cdp, L1.left + L1.width / 2, farAboveL);
  await shot(cdp, '09-s2b-after-drop.png');

  assert(layerOnV2.indicator.visible === false && layerOnV2.ghost.rejected === false,
    '症状3(layer経路): V2 帯の上端 +3px でも緑線が出ず、そのまま V2 へ入れる', layerOnV2);
  assert(!String(layerFarAbove.feedback).includes('レーンが異なるため移動できません'),
    '症状2(layer経路): 「⚠ レーンが異なるため移動できません」が出ない', { feedback: layerFarAbove.feedback });
  assert(layerFarAbove.ghost.rejected === false && layerFarAbove.indicator.visible === true,
    '症状2(layer経路): 最上段よりはるか上でも拒否されず緑線が出る', layerFarAbove);
  assert(Math.abs(layerFarAbove.indicator.top - topBandL.top) <= 4,
    '症状2(layer経路): 緑ラインは最上段の上端 = 実際の挿入位置', { indicatorTop: layerFarAbove.indicator.top, topBandTop: topBandL.top });

  const editS2b = await waitEdit(cdp, e => (e.tracks.find(t => t.id === 'v-lay')?.items ?? []).length === 1);
  record('s2b-after', { tracks: trackShape(editS2b) });
  const createdL = editS2b.tracks[editS2b.tracks.length - 1];
  assert(Array.isArray(createdL.items) && createdL.items.map(i => i.id).includes('L1'),
    '症状2(layer経路): tracks[] 末尾に新しい最上段トラックが作られ L1 が入った', { createdL });
  assert(editS2b.tracks.some(t => t.id === 'v-lay'),
    '症状1: まだ L2 が残っている v-lay は畳まれない（空になった段だけを畳む）', { ids: editS2b.tracks.map(t => t.id) });
  const editUndo3 = await undoTo(cdp, e => (e.tracks.find(t => t.id === 'v-lay')?.items ?? []).length === 2);
  assert(JSON.stringify(trackShape(editUndo3)) === JSON.stringify(trackShape(edit0)),
    'undo: layer 経路の新規トラック作成も 1 操作で元へ戻る', { after: trackShape(editUndo3) });
  await sleep(400);

  // =====================================================================
  // 字幕帯・音帯へのドロップは従来どおり拒否される（レーン規律の非回帰）
  // =====================================================================
  const bands3 = await bandRects(cdp);
  const clips3 = await clipRects(cdp);
  const bV3c = bandById(bands3, 'v3');
  const c3c = clipInBand(clips3, bV3c);
  const bAudio3 = bandById(bands3, 'a-bgm');
  const bCaptions3 = bandById(bands3, 'captions');
  await press(cdp, c3c.left + c3c.width / 2, c3c.top + c3c.height / 2);
  await moveTo(cdp, c3c.left + c3c.width / 2, bCaptions3.top + bCaptions3.height / 2);
  const onCaptions = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('lane-discipline-on-captions', onCaptions);
  await moveTo(cdp, c3c.left + c3c.width / 2, bAudio3.top + bAudio3.height / 2);
  const onAudio = { indicator: await insertIndicator(cdp), feedback: await dragFeedbackText(cdp), ghost: await ghostRejected(cdp) };
  record('lane-discipline-on-audio', onAudio);
  await shot(cdp, '07-lane-discipline.png');
  // 元の帯へ戻して no-op で終える（edit.json を汚さない）
  await moveTo(cdp, c3c.left + c3c.width / 2, bV3c.top + bV3c.height / 2);
  await release(cdp, c3c.left + c3c.width / 2, bV3c.top + bV3c.height / 2);

  assert(onCaptions.ghost.rejected === true && onCaptions.indicator.visible === false,
    '非回帰: 字幕帯(content型)の本体そのものへは落とせない（緑線も出ない）', onCaptions);
  assert(onAudio.ghost.rejected === true && onAudio.indicator.visible === false,
    '非回帰: 音トラック本体へ映像クリップは落とせない（緑線も出ない）', onAudio);

  // =====================================================================
  // 非回帰: 段の入れ替え（トラックヘッダーのドラッグ）で z 関係が変わる既存挙動。
  // 字幕トラックを映像トラック(v3)より下（= tracks[] のより手前）へ動かせること。
  // z の権威は tracks[] の配列順ただ一つなので、配列順と DOM の帯順の両方で観測する。
  // =====================================================================
  const headerRects = await evalOn(cdp, `Array.from(document.querySelectorAll('[data-akari-timeline-track-id]'))
    .map(el => { const r = el.getBoundingClientRect();
      return { id: el.dataset.akariTimelineTrackId, kind: el.dataset.akariKind,
               x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; })`);
  record('track-header-rows', { headerRects });
  const hCaptions = headerRects.find(h => h.id === 'captions');
  const hV3 = headerRects.find(h => h.id === 'v3');
  assert(Boolean(hCaptions && hV3), '非回帰: 字幕と V3 のトラックヘッダー行が取得できる', { hCaptions, hV3 });
  await press(cdp, hCaptions.x, hCaptions.y);
  await moveTo(cdp, hCaptions.x, hV3.y);
  await shot(cdp, '10-reorder-drag.png');
  await release(cdp, hCaptions.x, hV3.y);
  const editReorder = await waitEdit(cdp, e => e.tracks.findIndex(t => t.id === 'captions') < e.tracks.findIndex(t => t.id === 'v3'));
  record('reorder-after', { order: editReorder.tracks.map(t => t.id) });
  const iCap = editReorder.tracks.findIndex(t => t.id === 'captions');
  const iV3 = editReorder.tracks.findIndex(t => t.id === 'v3');
  assert(iCap >= 0 && iV3 >= 0 && iCap < iV3,
    '非回帰: 字幕トラックが tracks[] 上で V3 より手前 = 映像の下（z が入れ替わる）', { order: editReorder.tracks.map(t => t.id) });
  const bandsR = await bandRects(cdp);
  const domR = [...bandsR].sort((a, b) => a.top - b.top).map(b => b.id);
  assert(JSON.stringify(domR) === JSON.stringify([...editReorder.tracks].reverse().map(t => t.id)),
    '非回帰: 入れ替え後も DOM の帯順 = tracks[] 逆順（z の権威は配列順ただ一つ）', { domR });
  assert(domR.indexOf('captions') > domR.indexOf('v3'),
    '非回帰: 画面上でも字幕帯が V3 より下へ移動した', { domR });
  await shot(cdp, '11-reorder-after.png');
  const editReorderUndo = await undoTo(cdp, e => e.tracks.findIndex(t => t.id === 'captions') > e.tracks.findIndex(t => t.id === 'v3'));
  assert(JSON.stringify(trackShape(editReorderUndo)) === JSON.stringify(trackShape(edit0)),
    '非回帰: 並べ替えも undo で元へ戻る', { after: trackShape(editReorderUndo) });
  await sleep(400);

  const editFinal = await readJson(EDIT_JSON_PATH);
  record('final', { tracks: trackShape(editFinal) });
  assert(JSON.stringify(trackShape(editFinal)) === JSON.stringify(trackShape(edit0)),
    '最終状態: 拒否ドロップと undo を経て edit.json が初期状態と一致', { final: trackShape(editFinal) });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-final.json'), JSON.stringify(log, null, 2));
  cdp.close();
  console.log('ALL ACCEPTANCE CRITERIA PASSED');
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(path.join(EVIDENCE_DIR, 'run-log-partial.json'), JSON.stringify(log, null, 2)).finally(() => process.exit(1));
});
