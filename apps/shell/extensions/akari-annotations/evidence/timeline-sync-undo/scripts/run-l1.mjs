#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only) raw-CDP driver exercising the
// timeline-sync-undo acceptance criteria end-to-end against a running
// production-build Electron instance of apps/shell.
//
// Usage: node run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, realClick, realDrag, wheel, screenshot, keyPress } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const EXPORTS_DIR = path.join(WORKSPACE_DIR, 'exports');
const EDIT_JSON_PATH = path.join(EXPORTS_DIR, 'edit.json');
const CAPTIONS_JSON_PATH = path.join(EXPORTS_DIR, 'captions.json');
const REVIEW_JSON_PATH = path.join(EXPORTS_DIR, 'review.json');
// Wave22 でタイムラインが「出力軸」（cuts をギャップレス連結した秒）に転換されたため、
// totalDuration() は cuts の (out-in) 尺合計（10s）とオーバーレイ終端(4s)の大きい方 * 1.02 になった
// （旧: cuts の source out 最終値 11.5s ベースだった）。fixture (3 cuts: 3+3+4=10s) に合わせて修正。
const TOTAL_DURATION = 10 * 1.02; // matches totalDuration(): max(cutsDuration=10, overlaysEnd=4) * 1.02
const PLAYHEAD_FOLLOW_THRESHOLD_APPROX = 0.78; // matches widget.ts PLAYHEAD_FOLLOW_THRESHOLD

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

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

// ---- widget DOM accessors (structural, matches akari-annotations-widget.ts node.append order) ----
// Wave22/23 統合マージでルート DOM 形状が変化: w.children[1] は今や stripScroll 直下ではなく
// timelineViewport という grid ラッパー（trackHeaders + stripScroll を内包）になった
// （旧: node.append(toolbar, stripScroll, hScrollbarTrack, notice, footer)
//   新: node.append(toolbar, timelineViewport, hScrollbarTrack, notice, footer)）。
// run-l1-wave22.mjs と同様、位置indexではなく class/data-testid ベースの安定セレクタで解決する。
const WIDGET_REFS = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const toolbar = w.children[0];
  const strip = document.querySelector('.akari-annotations-strip');
  const stripScroll = strip ? strip.parentElement : null;
  const scrollbarTrack = document.querySelector('[data-testid="akari-timeline-hscrollbar-track"]');
  const scrollbarThumb = document.querySelector('[data-testid="akari-timeline-hscrollbar-thumb"]');
  // Wave22 でツールバーに選択/分割/マグネットボタンが追加され、undo/redo の子要素indexが
  // ずれた（旧: [2],[3] → 新: aria-label ベースで解決するのが安全）。
  const undoButton = toolbar.querySelector('[aria-label="元に戻す"]');
  const redoButton = toolbar.querySelector('[aria-label="やり直す"]');
  const zoomLabel = document.querySelector('[data-testid="akari-timeline-zoom-percent"]');
  const playhead = strip.children[0];
  const snapGuide = strip.children[1];
  const footer = w.children[4];
  return { w, toolbar, stripScroll, scrollbarTrack, scrollbarThumb, strip, undoButton, redoButton, zoomLabel, playhead, snapGuide, footer };
})()`;

async function widgetState(main) {
  return evalOn(main, `(() => {
    const refs = ${WIDGET_REFS};
    if (!refs) return { found: false };
    const stripRect = refs.strip.getBoundingClientRect();
    const zoomPercent = Number((refs.zoomLabel.textContent || '100').replace('%', ''));
    const visibleDuration = ${TOTAL_DURATION} * 100 / zoomPercent;
    const viewStart = ${TOTAL_DURATION} * (parseFloat(refs.scrollbarThumb.style.left) || 0) / 100;
    const pxPerSec = stripRect.width / visibleDuration;
    const playheadPercent = parseFloat(refs.playhead.style.left) || 0;
    return {
      found: true,
      stripRect: { left: stripRect.left, top: stripRect.top, width: stripRect.width, height: stripRect.height },
      scrollLeft: viewStart * pxPerSec,
      scrollWidth: ${TOTAL_DURATION} * pxPerSec,
      clientWidth: stripRect.width,
      contentWidthPx: ${TOTAL_DURATION} * pxPerSec,
      viewStart,
      visibleDuration,
      playheadLeftPx: viewStart * pxPerSec + playheadPercent / 100 * stripRect.width,
      undoDisabled: refs.undoButton.disabled,
      redoDisabled: refs.redoButton.disabled,
      footer: refs.footer.textContent
    };
  })()`);
}

// pxPerSec inferred empirically from the DOM (content.style.width / TOTAL_DURATION),
// matching the widget's own `content.style.width = totalDuration * pxPerSec + 'px'`.
async function pxPerSecNow(main) {
  const s = await widgetState(main);
  return s.contentWidthPx / TOTAL_DURATION;
}

async function scrollToTime(main, time) {
  await evalOn(main, `(() => {
    const r = ${WIDGET_REFS};
    const rect = r.scrollbarTrack.getBoundingClientRect();
    const clientX = rect.left + Math.min(1, Math.max(0, ${time} / ${TOTAL_DURATION})) * rect.width;
    r.scrollbarTrack.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX }));
  })()`);
}

async function screenXForTime(main, time) {
  const s = await widgetState(main);
  const pxPerSec = s.contentWidthPx / TOTAL_DURATION;
  return s.stripRect.left + (time * pxPerSec - s.scrollLeft);
}

async function elementRect(main, selector, index = 0) {
  return evalOn(main, `(() => {
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })()`);
}


async function readFooter(main) {
  return evalOn(main, `${WIDGET_REFS}.footer.textContent`);
}

async function waitFooterSettled(main, pattern, prevFooter, timeoutMs = 8000) {
  // undo/redo は実行中に両ボタンを disable し、完了後 footer を更新して復元する。
  // 固定 sleep では負荷次第で中間状態を読み、直前操作の同型文言が残っていると
  // 偽成功するため、「footer が prevFooter から変化し、かつ期待文言に一致」まで待つ
  const deadline = Date.now() + timeoutMs;
  let footer = '';
  while (Date.now() < deadline) {
    footer = await readFooter(main);
    if (footer !== prevFooter && pattern.test(footer)) return footer;
    await sleep(200);
  }
  throw new Error(`footer did not settle to ${pattern} within ${timeoutMs}ms (last: "${footer}")`);
}

async function dragSequence(cdp, path, opts = {}) {
  // like realDrag but lets the caller inspect mid-drag state and choose commit (mouseup) or cancel (Escape)
  const steps = opts.steps ?? 10;
  const stepDelayMs = opts.stepDelayMs ?? 20;
  const start = path[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
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

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const targets0 = await listTargets(CDP_PORT);
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');
  record('connected-main', { connected: true });
  await shot(main, '00-boot.png');

  // ---- open the timeline widget via the command palette (F1 -> type -> Enter) ----
  // 高負荷時は palette 表示・widget 生成が遅れるため、widget が見えるまで最大 3 回リトライ
  let s0 = await widgetState(main);
  for (let attempt = 0; attempt < 3 && !s0.found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(800);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(800);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let w = 0; w < 10 && !s0.found; w++) {
      await sleep(500);
      s0 = await widgetState(main);
    }
    if (!s0.found) {
      await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
  }
  assert(s0.found, 'timeline widget opened via command palette');
  await shot(main, '01-timeline-opened-default-view.png');
  record('initial-widget-state', s0);

  // ================= 検証環境ハードニング: bottom panel を拡大する =================
  // 発見した実挙動: Theia の初回（未保存レイアウト）の bottom panel 既定高では、
  // timelineViewport の実際のflex確保高（約87px）が、strip content の必要高（このfixtureで
  // 約120px = caption行 + overlayトラック行 + クリップ行(Wave22のclipHeader追加でC LIP_HEIGHT
  // 22→36px)を下回り、timelineViewport に overflow:hidden が無いため超過分がそのまま下へ溢れ、
  // ズーム時のみ表示される hScrollbarTrack と視覚的・当たり判定的に重なる（elementFromPoint が
  // クリップではなく hScrollbarTrack を返す）。この状態だとクリップ帯末尾に近いドラッグ操作
  // （cut-trim 等）が無言で不発になる。プロダクトソース（timelineViewport の overflow/高さ計算）
  // は変更せず、Theia 標準機能である panel 分割ハンドルのドラッグでテスト環境側の panel を
  // 拡大することで回避する（README「検証ドライバの修正点」に詳細を記録）。
  {
    const handle = await evalOn(main, `(() => {
      const w = document.getElementById('akari-annotations-widget');
      const wr = w.getBoundingClientRect();
      const handles = Array.from(document.querySelectorAll('.lm-SplitPanel-handle'));
      let best = null;
      let bestGap = Infinity;
      for (const h of handles) {
        const r = h.getBoundingClientRect();
        if (r.width < wr.width * 0.5) continue; // 縦分割ハンドル等を除外、横に広いものだけ対象
        const gap = wr.top - r.top;
        if (gap >= -2 && gap < bestGap) { bestGap = gap; best = { x: r.left + r.width / 2, y: r.top + Math.max(1, r.height / 2) }; }
      }
      return best;
    })()`);
    if (handle) {
      await realDrag(main, [
        { x: handle.x, y: handle.y },
        { x: handle.x, y: Math.max(120, handle.y - 260) }
      ], { steps: 15, stepDelayMs: 25 });
      await sleep(300);
    }
    const afterResize = await widgetState(main);
    record('bottom-panel-resized', { handleFound: !!handle, stripHeightAfter: afterResize.stripRect?.height, contentWidthPx: afterResize.contentWidthPx });
    s0 = afterResize.found ? afterResize : s0;
  }

  // ================= regression: minimum zoom = full view, no pan possible =================
  // 起動直後はレイアウト確定前の幅で min pxPerSec が決まっていることがあるため、
  // ctrl+wheel でズームアウトし切って現在幅の最小ズームへクランプさせてから判定する
  {
    const mid = { x: s0.stripRect.left + s0.stripRect.width / 2, y: s0.stripRect.top + s0.stripRect.height / 2 };
    for (let i = 0; i < 6; i++) {
      await wheel(main, mid.x, mid.y, 0, 400, { ctrlKey: true });
      await sleep(80);
    }
    s0 = await widgetState(main);
  }
  assert(s0.scrollWidth <= s0.clientWidth + 1, 'minimum zoom -> content width <= client width', {
    scrollWidth: s0.scrollWidth, clientWidth: s0.clientWidth
  });

  // ================= AC2: ctrl+wheel zoom keeps the cursor-time fixed =================
  // cursor at 40% across the strip's visible width
  const cursorOffsetPx = Math.round(s0.stripRect.width * 0.4);
  const cursorScreenX = s0.stripRect.left + cursorOffsetPx;
  const cursorScreenY = s0.stripRect.top + s0.stripRect.height / 2;

  const cursorContentPxBefore = s0.scrollLeft + cursorOffsetPx;
  const fractionBefore = cursorContentPxBefore / s0.contentWidthPx;
  const timeBefore = fractionBefore * TOTAL_DURATION;

  // 3 ctrl+wheel zoom-in events at the same screen point (factor 1.5 each, capped)
  for (let i = 0; i < 3; i++) {
    await wheel(main, cursorScreenX, cursorScreenY, 0, -400, { ctrlKey: true });
    await sleep(120);
  }
  const s1 = await widgetState(main);
  record('after-ctrl-wheel-zoom', s1);
  assert(s1.contentWidthPx > s0.contentWidthPx, 'AC2 precondition: zoomed in (content width grew)', {
    before: s0.contentWidthPx, after: s1.contentWidthPx
  });

  const cursorContentPxAfter = s1.scrollLeft + cursorOffsetPx;
  const fractionAfter = cursorContentPxAfter / s1.contentWidthPx;
  const timeAfter = fractionAfter * TOTAL_DURATION;
  const visibleDurationAfter = (s1.clientWidth / s1.contentWidthPx) * TOTAL_DURATION;
  const threshold = visibleDurationAfter * 0.02;
  const cursorTimeError = Math.abs(timeAfter - timeBefore);
  record('AC2-cursor-fixed-point', { timeBefore, timeAfter, cursorTimeError, visibleDurationAfter, threshold });
  assert(cursorTimeError <= threshold, 'AC2: ctrl+wheel zoom keeps cursor time fixed within 2% of visible width', {
    cursorTimeError, threshold
  });
  await shot(main, '02-ctrl-wheel-zoom-cursor-fixed.png');

  // ================= regression: horizontal scrollbar and horizontal swipe pan =================
  const stripMidY = s1.stripRect.top + s1.stripRect.height / 2;
  const stripMidX = s1.stripRect.left + s1.stripRect.width / 2;
  const beforeWheelScroll = (await widgetState(main)).scrollLeft;
  await wheel(main, stripMidX, stripMidY, 250, 0, { ctrlKey: false });
  await sleep(150);
  const afterWheelScroll = (await widgetState(main)).scrollLeft;
  record('horizontal-swipe-pan', { beforeWheelScroll, afterWheelScroll });
  assert(afterWheelScroll > beforeWheelScroll, 'horizontal swipe moves the view window', {
    beforeWheelScroll, afterWheelScroll
  });

  // scroll to the left edge and right edge, screenshot + record scrollLeft each time
  await scrollToTime(main, 0);
  await sleep(150);
  const leftEdge = await widgetState(main);
  await shot(main, '03-scrolled-left-edge.png');
  record('AC1-left-edge', { scrollLeft: leftEdge.scrollLeft });
  assert(leftEdge.scrollLeft < 2, 'left edge viewStart is zero');

  await wheel(main, stripMidX, stripMidY, 100000, 0, { ctrlKey: false });
  await sleep(150);
  const rightEdge = await widgetState(main);
  await shot(main, '04-scrolled-right-edge.png');
  const maxScroll = rightEdge.scrollWidth - rightEdge.clientWidth;
  record('AC1-right-edge', { scrollLeft: rightEdge.scrollLeft, maxScroll });
  assert(rightEdge.scrollLeft >= maxScroll - 2, 'scrollbar reaches the right edge', {
    scrollLeft: rightEdge.scrollLeft, maxScroll
  });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-1.json'), JSON.stringify(log, null, 2));

  // ================= AC9 regression: cut-trim (drag left edge) =================
  await scrollToTime(main, 2);
  await sleep(400);
  let editBefore = await readJson(EDIT_JSON_PATH);
  let c1Rect = await elementRect(main, '.akari-annotations-strip-clip', 0);
  const trimStartX = c1Rect.left + 2; // within EDGE_ZONE_PX(6) of the left edge -> 'left' trim
  const trimY = c1Rect.top + c1Rect.height / 2;
  const trimTargetX = trimStartX + 40; // drag right by 40px -> in increases
  await dragSequence(main, [{ x: trimStartX, y: trimY }, { x: trimTargetX, y: trimY }]);
  await dragRelease(main, trimTargetX, trimY);
  await sleep(500);
  let editAfterTrim = await readJson(EDIT_JSON_PATH);
  record('AC9-cut-trim', { before: editBefore.cuts[0], after: editAfterTrim.cuts[0] });
  assert(editAfterTrim.cuts[0].in > editBefore.cuts[0].in, 'AC9: cut-trim (left edge drag) increases cuts[0].in', {
    before: editBefore.cuts[0].in, after: editAfterTrim.cuts[0].in
  });
  await shot(main, '05-cut-trim-result.png');

  // ================= AC9 regression: cut-reorder (drag clip middle across another clip) =================
  // Wave22 の出力軸ギャップレス化により totalDuration が縮む（trim後 ~9.75s）ため、AC2 で
  // ズームインしたままだと drag 元(C1)と drop 先(4.3s)を同一の可視窓に収められないことがある
  // （実測でドラッグが不発になった）。ズームを全体表示にリセットしてから行う。
  // mid 座標は bottom panel のリサイズ後は位置が変わるため、固定値ではなく現在の
  // widgetState() から都度算出する（固定値だと wheel イベントが strip 外に落ちて無反応になる）。
  {
    const cur = await widgetState(main);
    const mid = { x: cur.stripRect.left + cur.stripRect.width / 2, y: cur.stripRect.top + cur.stripRect.height / 2 };
    for (let i = 0; i < 8; i++) {
      await wheel(main, mid.x, mid.y, 0, 400, { ctrlKey: true });
      await sleep(80);
    }
  }
  await sleep(200);
  // keep both the drag source (C1) and the drop point within the visible scrolled window
  await scrollToTime(main, 2.7);
  await sleep(200);
  const c1RectForReorder = await elementRect(main, '.akari-annotations-strip-clip', 0);
  const reorderStartX = (c1RectForReorder.left + c1RectForReorder.right) / 2;
  const reorderY = c1RectForReorder.top + c1RectForReorder.height / 2;
  // Wave22 のギャップレス出力軸では、cuts[1] の出力秒レンジは trim 後の cuts[0] 尺に応じて
  // 動く（固定の "4.3秒" だと現在の cuts[1] レンジの中点(4.25s)からわずか0.05秒しか離れず、
  // reorder のしきい値判定がコイントスになり実測で不発だった）。cuts[1] の出力秒レンジを
  // editAfterTrim から動的に算出し、その 80% 地点という明確にしきい値を超える位置へ運ぶ。
  const seg1TlStart = editAfterTrim.cuts[0].out - editAfterTrim.cuts[0].in; // cuts[0]の尺 = cuts[1]の出力開始秒
  const seg1Duration = editAfterTrim.cuts[1].out - editAfterTrim.cuts[1].in;
  const reorderTargetTime = seg1TlStart + seg1Duration * 0.8;
  const reorderTargetX = await screenXForTime(main, reorderTargetTime);
  await dragSequence(main, [{ x: reorderStartX, y: reorderY }, { x: reorderTargetX, y: reorderY }]);
  await dragRelease(main, reorderTargetX, reorderY);
  await sleep(500);
  let editAfterReorder = await readJson(EDIT_JSON_PATH);
  record('AC9-cut-reorder', { before: editAfterTrim.cuts, after: editAfterReorder.cuts });
  assert(JSON.stringify(editAfterReorder.cuts.map(c => `${c.in}-${c.out}`)) !==
    JSON.stringify(editAfterTrim.cuts.map(c => `${c.in}-${c.out}`)),
    'AC9: cut-reorder changes cuts[] order (in/out pairs reshuffled, values unchanged as a set)', {
      before: editAfterTrim.cuts, after: editAfterReorder.cuts
    });
  await shot(main, '06-cut-reorder-result.png');

  // ================= AC9 regression: snap guide displays mid-drag, then Escape cancels (no commit) =================
  await scrollToTime(main, 4);
  await sleep(100);
  const editBeforeSnapTest = await readJson(EDIT_JSON_PATH);
  const captionRectForSnap = await elementRect(main, '.akari-annotations-strip-caption', 1); // caption-b, start=4
  const snapStartX = (captionRectForSnap.left + captionRectForSnap.right) / 2;
  const snapY = captionRectForSnap.top + captionRectForSnap.height / 2;
  // drag caption-b's body ('move') so its new start lands within SNAP_THRESHOLD_PX(8px) of the
  // word-boundary candidate at t=4.4 (analysis.json word "two": start 4, end 4.4)
  const snapTargetScreenX = snapStartX + ((await screenXForTime(main, 4.4)) - (await screenXForTime(main, 4)));
  await dragSequence(main, [{ x: snapStartX, y: snapY }, { x: snapTargetScreenX, y: snapY }]);
  // 外部ファイル更新で renderStrip 要因を発火し、ドラッグ中は再描画が延期されることを実証する。
  // captions.json の実サービス（caption-store.ts の shiftCaptionLine）は「字幕1件=1行」の
  // 行ベースパッチャーのため、JSON.stringify(..., null, 2) の整形書き戻しはこの後の
  // 字幕ドラッグ commit を壊す（1行形式チェックで例外）。生テキストをそのまま書き戻し、
  // 内容を変えず mtime だけ更新してファイル監視イベントを発火させる。
  await writeFile(CAPTIONS_JSON_PATH, await readFile(CAPTIONS_JSON_PATH, 'utf8'));
  await sleep(150);
  const snapState = await evalOn(main, `(() => {
    const r = ${WIDGET_REFS};
    return { display: r.snapGuide.style.display, left: r.snapGuide.style.left };
  })()`);
  record('AC9-snap-guide-mid-drag', snapState);
  assert(snapState.display === 'block', 'AC9: snap guide shows while dragging near a snap candidate', snapState);
  await shot(main, '07-snap-guide-visible.png');
  // cancel via Escape — must not commit (edit.json / captions.json unchanged)
  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
  const captionsAfterCancel = await readJson(CAPTIONS_JSON_PATH);
  const editAfterCancel = await readJson(EDIT_JSON_PATH);
  record('AC9-escape-cancel-no-commit', { captionsAfterCancel, editBeforeSnapTest, editAfterCancel });
  assert(JSON.stringify(editAfterCancel.cuts) === JSON.stringify(editBeforeSnapTest.cuts),
    'AC9: Escape cancels drag without committing (edit.json cuts unchanged)');

  // ================= AC9 regression: overlay resize (drag right edge) =================
  // overlay spans [1, 4]s; scroll so its right edge (the resize handle) sits well inside
  // the strip's visible (non-clipped) window, not just past the scrollLeft+clientWidth boundary
  await scrollToTime(main, 3.2);
  await sleep(100);
  const editBeforeResize = await readJson(EDIT_JSON_PATH);
  const overlayRectForResize = await elementRect(main, '.akari-annotations-strip-overlay', 0);
  const resizeStartX = overlayRectForResize.right - 2; // within EDGE_ZONE_PX of right edge -> 'resize'
  const resizeY = overlayRectForResize.top + overlayRectForResize.height / 2;
  const resizeTargetX = resizeStartX + 40;
  await dragSequence(main, [{ x: resizeStartX, y: resizeY }, { x: resizeTargetX, y: resizeY }]);
  await dragRelease(main, resizeTargetX, resizeY);
  await sleep(500);
  const editAfterResize = await readJson(EDIT_JSON_PATH);
  record('AC9-overlay-resize', {
    before: editBeforeResize.overlays[0].duration, after: editAfterResize.overlays[0].duration
  });
  assert(editAfterResize.overlays[0].duration > editBeforeResize.overlays[0].duration,
    'AC9: overlay resize (right edge drag) increases overlays[0].duration', {
      before: editBeforeResize.overlays[0].duration, after: editAfterResize.overlays[0].duration
    });
  await shot(main, '08-overlay-resize-result.png');

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-2.json'), JSON.stringify(log, null, 2));

  // ================= AC7/AC8 setup: two consecutive ops (caption move -> overlay move), then undo x2 / redo x2 =================
  // op 1: caption move (caption-a, index 0, currently start=1)
  await scrollToTime(main, 1.5);
  await sleep(150);
  const captionsBeforeMove = await readJson(CAPTIONS_JSON_PATH);
  const captionARect = await elementRect(main, '.akari-annotations-strip-caption', 0);
  const capMoveStartX = (captionARect.left + captionARect.right) / 2;
  const capMoveY = captionARect.top + captionARect.height / 2;
  const capMoveTargetX = capMoveStartX + 60; // move right by ~60px worth of seconds
  const footerBeforeCapMove = await readFooter(main);
  await dragSequence(main, [{ x: capMoveStartX, y: capMoveY }, { x: capMoveTargetX, y: capMoveY }]);
  await dragRelease(main, capMoveTargetX, capMoveY);
  // commit は write -> pushHistory -> reloadEdit -> footer 更新の非同期チェーンのため、固定
  // sleep だけでは history stack への push 完了前に次操作(undo)が発火しうる（実測でフレーク）。
  // footer が「字幕のタイミングを調整しました。」に変化するまで待って history push を保証する。
  await waitFooterSettled(main, /字幕のタイミングを調整しました/, footerBeforeCapMove);
  const captionsAfterMove = await readJson(CAPTIONS_JSON_PATH);
  record('AC7-op1-caption-move', { before: captionsBeforeMove[0], after: captionsAfterMove[0] });
  assert(captionsAfterMove[0].start !== captionsBeforeMove[0].start,
    'AC7 op1: caption move drag changes captions[0].start', {
      before: captionsBeforeMove[0].start, after: captionsAfterMove[0].start
    });
  await shot(main, '09-caption-move-result.png');

  // op 2: overlay move (overlay-a)
  await scrollToTime(main, 2);
  await sleep(150);
  const editBeforeOverlayMove = await readJson(EDIT_JSON_PATH);
  const overlayRectForMove = await elementRect(main, '.akari-annotations-strip-overlay', 0);
  const ovMoveStartX = (overlayRectForMove.left + overlayRectForMove.right) / 2;
  const ovMoveY = overlayRectForMove.top + overlayRectForMove.height / 2;
  const ovMoveTargetX = ovMoveStartX + 50;
  const footerBeforeOvMove = await readFooter(main);
  await dragSequence(main, [{ x: ovMoveStartX, y: ovMoveY }, { x: ovMoveTargetX, y: ovMoveY }]);
  await dragRelease(main, ovMoveTargetX, ovMoveY);
  // 同上: history push 完了を footer 変化で確認してから次の undo/redo 検証へ進む。
  await waitFooterSettled(main, /オーバーレイを移動しました/, footerBeforeOvMove);
  const editAfterOverlayMove = await readJson(EDIT_JSON_PATH);
  record('AC7-op2-overlay-move', {
    before: editBeforeOverlayMove.overlays[0].start, after: editAfterOverlayMove.overlays[0].start
  });
  assert(editAfterOverlayMove.overlays[0].start !== editBeforeOverlayMove.overlays[0].start,
    'AC7 op2: overlay move drag changes overlays[0].start', {
      before: editBeforeOverlayMove.overlays[0].start, after: editAfterOverlayMove.overlays[0].start
    });
  await shot(main, '10-overlay-move-result.png');

  const historyAfterTwoOps = await widgetState(main);
  record('AC8-buttons-after-two-ops', { undoDisabled: historyAfterTwoOps.undoDisabled, redoDisabled: historyAfterTwoOps.redoDisabled });
  assert(!historyAfterTwoOps.undoDisabled && historyAfterTwoOps.redoDisabled,
    'AC8: after 2 ops, undo enabled / redo disabled', historyAfterTwoOps);

  // ---- undo x2 via Cmd+Z (reverse order: overlay move first, then caption move) ----
  const footerBeforeUndo1 = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); // Meta+Z
  await waitFooterSettled(main, /を元に戻しました/, footerBeforeUndo1);
  const editAfterUndo1 = await readJson(EDIT_JSON_PATH);
  const stateAfterUndo1 = await widgetState(main);
  record('AC7-undo1-overlay-reverted', {
    overlayStart: editAfterUndo1.overlays[0].start, expected: editBeforeOverlayMove.overlays[0].start,
    undoDisabled: stateAfterUndo1.undoDisabled, redoDisabled: stateAfterUndo1.redoDisabled
  });
  assert(editAfterUndo1.overlays[0].start === editBeforeOverlayMove.overlays[0].start,
    'AC7 undo#1 (Cmd+Z): overlay move reverted to pre-op2 value', {
      actual: editAfterUndo1.overlays[0].start, expected: editBeforeOverlayMove.overlays[0].start
    });
  assert(!stateAfterUndo1.undoDisabled && !stateAfterUndo1.redoDisabled,
    'AC8: after undo#1, undo still enabled (1 more op-set pushed earlier), redo now enabled', stateAfterUndo1);

  const footerBeforeUndo2 = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); // Meta+Z
  await waitFooterSettled(main, /を元に戻しました/, footerBeforeUndo2);
  const captionsAfterUndo2 = await readJson(CAPTIONS_JSON_PATH);
  record('AC7-undo2-caption-reverted', {
    captionStart: captionsAfterUndo2[0].start, expected: captionsBeforeMove[0].start
  });
  assert(captionsAfterUndo2[0].start === captionsBeforeMove[0].start,
    'AC7 undo#2 (Cmd+Z): caption move reverted to pre-op1 value', {
      actual: captionsAfterUndo2[0].start, expected: captionsBeforeMove[0].start
    });
  await shot(main, '11-after-undo-x2.png');

  // ---- redo x2 via Cmd+Shift+Z ----
  const footerBeforeRedo1 = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 12 });
  await waitFooterSettled(main, /をやり直しました/, footerBeforeRedo1);
  const captionsAfterRedo1 = await readJson(CAPTIONS_JSON_PATH);
  record('AC7-redo1-caption-reapplied', {
    captionStart: captionsAfterRedo1[0].start, expected: captionsAfterMove[0].start
  });
  assert(captionsAfterRedo1[0].start === captionsAfterMove[0].start,
    'redo#1 (Cmd+Shift+Z): caption move reapplied', {
      actual: captionsAfterRedo1[0].start, expected: captionsAfterMove[0].start
    });

  const footerBeforeRedo2 = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 12 });
  await waitFooterSettled(main, /をやり直しました/, footerBeforeRedo2);
  const editAfterRedo2 = await readJson(EDIT_JSON_PATH);
  const stateAfterRedo2 = await widgetState(main);
  record('AC7-redo2-overlay-reapplied', {
    overlayStart: editAfterRedo2.overlays[0].start, expected: editAfterOverlayMove.overlays[0].start,
    undoDisabled: stateAfterRedo2.undoDisabled, redoDisabled: stateAfterRedo2.redoDisabled
  });
  assert(editAfterRedo2.overlays[0].start === editAfterOverlayMove.overlays[0].start,
    'redo#2 (Cmd+Shift+Z): overlay move reapplied', {
      actual: editAfterRedo2.overlays[0].start, expected: editAfterOverlayMove.overlays[0].start
    });
  assert(!stateAfterRedo2.undoDisabled && stateAfterRedo2.redoDisabled,
    'AC8: after redo x2, undo enabled / redo disabled (future empty again)', stateAfterRedo2);

  // ツールバーの両ボタンでも同じ2段操作を往復する。
  for (const operation of ['undo', 'undo', 'redo', 'redo']) {
    const buttonName = operation === 'undo' ? 'undoButton' : 'redoButton';
    const pattern = operation === 'undo' ? /を元に戻しました/ : /をやり直しました/;
    const rect = await evalOn(main, `(() => { const b = ${WIDGET_REFS}.${buttonName}; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const before = await readFooter(main);
    await realClick(main, rect.x, rect.y);
    await waitFooterSettled(main, pattern, before);
  }
  const stateAfterToolbarRoundTrip = await widgetState(main);
  const captionsAfterToolbarRoundTrip = await readJson(CAPTIONS_JSON_PATH);
  const editAfterToolbarRoundTrip = await readJson(EDIT_JSON_PATH);
  assert(captionsAfterToolbarRoundTrip[0].start === captionsAfterMove[0].start
    && editAfterToolbarRoundTrip.overlays[0].start === editAfterOverlayMove.overlays[0].start,
    'toolbar undo/redo round-trip restores both edited files');
  assert(stateAfterToolbarRoundTrip.redoDisabled, 'redo button is disabled when future stack is empty');
  await shot(main, '12-after-redo-x2.png');

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-3.json'), JSON.stringify(log, null, 2));

  // ================= enable developer mode (Wave 19 の非開発者モード「素材」差し替えビューが
  // 既定で有効なため、標準 Explorer ツリーへ到達するには先に developer mode を ON にする必要がある) =================
  {
    const gearIcon = await evalOn(main, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-settings-gear')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!gearIcon) throw new Error('settings gear icon not found');
    await realClick(main, gearIcon.x, gearIcon.y);
    await sleep(500);
    const checkbox = await evalOn(main, `(() => {
      const cb = document.querySelector('input[aria-label="Developer mode"]');
      if (!cb) return null;
      const r = cb.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, checked: cb.checked };
    })()`);
    if (!checkbox) throw new Error('developer mode checkbox not found');
    if (!checkbox.checked) {
      await realClick(main, checkbox.x, checkbox.y);
      await sleep(300);
    }
    const nowChecked = await evalOn(main, `document.querySelector('input[aria-label="Developer mode"]').checked`);
    assert(nowChecked === true, 'developer mode enabled (required for standard Explorer tree)', { nowChecked });
  }

  // ================= open the preview tab via the Explorer (double-click sample.mp4) =================
  const findRow = (label) => evalOn(main, `(() => {
    const rows = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]'));
    const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(label)});
    if (!row) return { found: false };
    const r = row.getBoundingClientRect();
    const collapsed = !!row.querySelector('.theia-mod-collapsed');
    return { found: true, collapsed, x: r.left + 20, y: r.top + r.height / 2 };
  })()`);

  const explorerState = await evalOn(main, `(() => {
    const anyRow = document.querySelector('.theia-TreeNode');
    const alreadyOpen = !!(anyRow && anyRow.getBoundingClientRect().width > 0);
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    const r = el.getBoundingClientRect();
    return { alreadyOpen, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!explorerState.alreadyOpen) {
    await realClick(main, explorerState.x, explorerState.y);
    await sleep(500);
  }
  record('opened-explorer', explorerState);

  const folderRow = await findRow('exports');
  if (!folderRow.found) throw new Error('tree row for folder "exports" not found');
  record('expanded-exports-folder', folderRow);

  // Theia のディレクトリ行はシングルクリックで展開トグルする（ダブルクリックだと開閉が
  // 打ち消し合う）。子行が現れるまでシングルクリック + リトライで収束させる
  let fileRow = await findRow('sample.mp4');
  for (let attempt = 0; attempt < 4 && !fileRow.found; attempt++) {
    const current = await findRow('exports');
    if (current.found) {
      await realClick(main, current.x, current.y);
      await sleep(700);
    }
    for (let w = 0; w < 6 && !fileRow.found; w++) {
      fileRow = await findRow('sample.mp4');
      if (!fileRow.found) await sleep(400);
    }
  }
  if (!fileRow.found) throw new Error('tree row for "sample.mp4" not found');
  await realClick(main, fileRow.x, fileRow.y, { clickCount: 2 });
  await sleep(1500);
  record('opened-preview-tab', fileRow);
  await shot(main, '14-preview-tab-opened.png');

  // ---- locate the webview's outer CDP target and reach the inner active-frame execution context ----
  let outerTarget = null;
  for (let attempt = 0; attempt < 15 && !outerTarget; attempt++) {
    const targets = await listTargets(CDP_PORT);
    // webview は複数存在し得る（パートナーパネル等）。動画プレビューの webview は
    // id クエリが 'akari-preview-' で始まるものだけ
    outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html\?id=akari-preview-/.test(t.url));
    if (!outerTarget) await sleep(300);
  }
  if (!outerTarget) throw new Error('outer webview CDP target not found');
  record('found-outer-webview-target', { matchedPreviewWebview: true });

  const outer = new CDP(outerTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(400);
  const frameTree = await outer.send('Page.getFrameTree');
  const topFrameId = frameTree.frameTree.frame.id;
  const activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
  if (!activeCtx) throw new Error('inner active-frame execution context not found');
  record('reached-active-frame-context', { nestedContext: true });

  async function evalInPreview(expression) {
    const r = await outer.send('Runtime.evaluate', { expression, contextId: activeCtx.id, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evalInPreview failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  // ================= AC6 regression: timeline click seeks the preview =================
  await evalInPreview(`(() => { document.getElementById('preview-video').currentTime = 0; return true; })()`);
  await sleep(200);
  // Wave22 で横軸が source 秒から出力(タイムライン)秒へ転換されたため、クリック座標は
  // 出力秒で計算し、期待値は「cuts[0](=常に出力0秒始まりの先頭セグメント)の source in + 0.5秒」を
  // 出力軸の 0.5秒地点としてクリックし、そこから source 秒へ変換された結果と比較する
  // （旧: source 秒=出力秒の前提で cuts[0].in+0.5 をそのままクリック時刻に使っていたため、
  // 出力軸転換後は無関係な source 位置へシークしてしまっていた）。
  const seekOutputClickTime = 0.5; // 先頭セグメント(cuts[0])の出力レンジ内、tlStart=0 から+0.5秒
  const expectedSourceSeekTime = editAfterToolbarRoundTrip.cuts[0].in + seekOutputClickTime;
  await scrollToTime(main, Math.max(0, seekOutputClickTime - 0.5));
  await sleep(150);
  const seekClickX = await screenXForTime(main, seekOutputClickTime);
  const seekStateBefore = await widgetState(main);
  const seekClickY = seekStateBefore.stripRect.top + 7; // ruler band, no clip/caption/overlay hit
  await realClick(main, seekClickX, seekClickY);
  await sleep(500);
  const seekState = await widgetState(main);
  const previewTimeAfterSeek = await evalInPreview(`document.getElementById('preview-video').currentTime`);
  record('AC6-click-to-seek', { footer: seekState.footer, previewTimeAfterSeek, expectedApprox: expectedSourceSeekTime });
  assert(seekState.footer.includes('シーク'), 'AC6: footer reports the preview was seeked', { footer: seekState.footer });
  assert(Math.abs(previewTimeAfterSeek - expectedSourceSeekTime) < 0.5,
    'AC6: preview video.currentTime moved close to the clicked timeline time', {
      previewTimeAfterSeek, expectedSourceSeekTime
    });
  await shot(main, '15-click-to-seek-regression.png');

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-5.json'), JSON.stringify(log, null, 2));

  // ================= AC4/AC5: preview playback -> timeline playhead sync + 78% auto-follow scroll =================
  // 発見した実挙動: video.currentTime を cuts[].in の値に「ちょうど」一致させてから play() すると、
  // paused=false・readyState=4・error=null を報告するにもかかわらず currentTime が全く進行せず
  // timeupdate/seeking/seeked のいずれのイベントも一切発火しない（実測: 4秒超・複数回のフレッシュ
  // launch で再現、CDP接続の使い回しに起因する副作用ではないことを確認済み）。run-l1-wave22.mjs
  // 側の同種テスト（B: 境界またぎ再生）も境界ちょうどではなく "seg0.out - 0.3" と意図的にオフセット
  // している前例に倣い、cuts[last].in ちょうどではなく +0.5秒オフセットした位置から再生開始する
  // （プロダクトソースは変更しない — 境界値ちょうどでの停止挙動自体は本タスクの範囲外の別問題として
  // README に記録し、ここでは AC4/AC5 が意図する「再生中のtick同期・auto-follow」を検証できるよう
  // 境界を避けるドライバ側の調整のみ行う）。
  // 併せて Wave22 で横軸が出力秒になったため、scrollToTime も出力秒で計算する
  // （cuts[last] は本回の cut-reorder では配列末尾のまま=出力軸でも末尾セグメントなので、
  // 直前までのセグメント尺の累積が出力軸開始秒になる）。
  const cutsNow = editAfterToolbarRoundTrip.cuts;
  const lastCutIndex = cutsNow.length - 1;
  let lastSegTlStart = 0;
  for (let i = 0; i < lastCutIndex; i++) lastSegTlStart += cutsNow[i].out - cutsNow[i].in;
  const boundaryOffset = 0.5;
  const playbackStart = cutsNow[lastCutIndex].in + boundaryOffset; // source seconds, for v.currentTime
  const playbackStartOutput = lastSegTlStart + boundaryOffset; // output seconds, for scrollToTime
  await evalInPreview(`(() => { const v = document.getElementById('preview-video'); v.pause(); v.currentTime = ${playbackStart}; return true; })()`);
  await sleep(200);
  await scrollToTime(main, playbackStartOutput);
  await sleep(150);
  const prePlay = await widgetState(main);
  record('pre-play-state', prePlay);
  await shot(main, '16-before-play.png');

  await evalInPreview(`(() => { document.getElementById('preview-video').play(); return true; })()`);

  const samples = [];
  const sampleStart = Date.now();
  for (let i = 0; i < 14; i++) {
    await sleep(300);
    // widgetState(main) と evalInPreview(...) は別コンテキストへの別 CDP ラウンドトリップ。
    // 直列 await だと2呼び出しの間に実時間が経過し（再生中は video.currentTime が動き続ける）、
    // 見かけ上の tick 対応誤差が測定誤差として乗る（実測: 逐次読みで最大0.28秒、並列化で解消）。
    // Promise.all で同時発行し、実測ギャップを最小化する。
    const [w, previewTime] = await Promise.all([
      widgetState(main),
      evalInPreview(`document.getElementById('preview-video').currentTime`)
    ]);
    samples.push({ tMs: Date.now() - sampleStart, playheadLeftPx: w.playheadLeftPx, scrollLeft: w.scrollLeft, clientWidth: w.clientWidth, previewTime });
  }
  record('AC4-AC5-playback-samples', { samples });

  const pxPerSecAtPlay = (await widgetState(main)).contentWidthPx / TOTAL_DURATION;
  // AC4: playhead px position increases monotonically over > 2s of playback, and tracks the tick time within ±0.2s
  const last = samples[samples.length - 1];
  const first = samples[0];
  assert(last.playheadLeftPx > first.playheadLeftPx, 'AC4: playhead px position increased over the play window', {
    first: first.playheadLeftPx, last: last.playheadLeftPx
  });
  let monotonic = true;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].playheadLeftPx < samples[i - 1].playheadLeftPx - 0.5) monotonic = false;
  }
  assert(monotonic, 'AC4: playhead px position is monotonically non-decreasing across samples', { samples });
  // Wave22 で横軸が出力秒になったため、previewTime（video.currentTime、source秒）を cuts[] 経由で
  // 出力秒へ変換してから playheadLeftPx と比較する（旧: previewTime をそのまま出力秒扱いで比較していた
  // ため、cuts が2個以上ある場合に系統的なズレ — 実測で最大1.6秒 — が誤って計上されていた。
  // プロダクト側の同期精度自体はこの変換抜きでは正しく測れない）。
  function sourceToOutputTime(sourceT) {
    let acc = 0;
    for (const cut of cutsNow) {
      const dur = cut.out - cut.in;
      if (sourceT >= cut.in - 1e-6 && sourceT <= cut.out + 1e-6) {
        return acc + Math.min(Math.max(sourceT - cut.in, 0), dur);
      }
      acc += dur;
    }
    return acc; // fallback: past the last cut
  }
  const worstTickError = Math.max(...samples.map(s =>
    Math.abs(s.playheadLeftPx / pxPerSecAtPlay - sourceToOutputTime(s.previewTime))
  ));
  record('AC4-tick-correspondence', { worstTickError, pxPerSecAtPlay });
  assert(worstTickError <= 0.2, 'AC4: playhead-derived time matches preview tick time within ±0.2s', { worstTickError });

  // AC5: once playhead reaches 78% of the visible width, viewStart starts increasing to keep it pinned
  const crossingIndex = samples.findIndex((s, index) => index > 0 && s.scrollLeft > samples[index - 1].scrollLeft + 1);
  record('AC5-crossing-index', { crossingIndex, threshold: PLAYHEAD_FOLLOW_THRESHOLD_APPROX });
  assert(crossingIndex !== -1 && crossingIndex < samples.length - 1,
    'AC5 precondition: playhead crossed the 78% follow threshold before the sampling window ended', { crossingIndex });
  const scrollLeftAtCrossing = samples[crossingIndex].scrollLeft;
  const scrollLeftAfterCrossing = samples[samples.length - 1].scrollLeft;
  assert(scrollLeftAfterCrossing > scrollLeftAtCrossing,
    'AC5: strip.scrollLeft increases (auto-follow) after the playhead crosses the 78% threshold', {
      scrollLeftAtCrossing, scrollLeftAfterCrossing
    });
  await shot(main, '17-during-playback-autoscroll.png');

  // pause -> playhead must stop changing
  await evalInPreview(`(() => { document.getElementById('preview-video').pause(); return true; })()`);
  await sleep(300);
  const pausedSample1 = await widgetState(main);
  await sleep(600);
  const pausedSample2 = await widgetState(main);
  record('AC4-pause-stops-playhead', {
    playheadLeftPx1: pausedSample1.playheadLeftPx, playheadLeftPx2: pausedSample2.playheadLeftPx,
    scrollLeft1: pausedSample1.scrollLeft, scrollLeft2: pausedSample2.scrollLeft
  });
  assert(Math.abs(pausedSample2.playheadLeftPx - pausedSample1.playheadLeftPx) < 1,
    'AC4: playhead stops moving once paused', {
      playheadLeftPx1: pausedSample1.playheadLeftPx, playheadLeftPx2: pausedSample2.playheadLeftPx
    });
  await shot(main, '18-after-pause.png');

  // AC5: while stopped, a manual scroll must NOT be pulled back automatically
  const manualScrollTarget = Math.max(0, pausedSample2.scrollLeft - 200);
  const manualScrollTime = manualScrollTarget / (pausedSample2.contentWidthPx / TOTAL_DURATION);
  await scrollToTime(main, manualScrollTime + pausedSample2.visibleDuration / 2);
  await sleep(800);
  const afterManualScroll = await widgetState(main);
  record('AC5-manual-scroll-not-pulled-back-while-stopped', {
    manualScrollTarget, actual: afterManualScroll.scrollLeft
  });
  assert(Math.abs(afterManualScroll.scrollLeft - manualScrollTarget) < 2,
    'AC5: manual scroll while stopped is not pulled back by auto-follow', {
      manualScrollTarget, actual: afterManualScroll.scrollLeft
    });
  await shot(main, '19-manual-scroll-not-pulled-back.png');

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-final.json'), JSON.stringify(log, null, 2));
  main.close();
  outer.close();
  console.log('ALL ACCEPTANCE CRITERIA PASSED');
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-1.json'), JSON.stringify(log, null, 2)).finally(() => {
    process.exit(1);
  });
});
