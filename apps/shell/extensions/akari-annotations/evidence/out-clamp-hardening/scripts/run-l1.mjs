#!/usr/bin/env node
// out-clamp-hardening の L1 実測ドライバ。production ビルドの Electron を隔離
// user-data-dir + --remote-debugging-port で起動し、生 CDP（cdp-lib.mjs）で
// タイムラインウィジェットの Out トリムドラッグを実際にディスパッチして検証する。
//
// Usage: node run-l1.mjs <mode> <cdpPort> <workspaceDir> <evidenceDir>
//   mode: 'fresh-open' | 'no-sidecar' | 'unresolvable'

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, realClick } from './cdp-lib.mjs';

const [, , mode, cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9501);
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
async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function clipRect(main) {
  return evalOn(main, `(() => {
    const clip = document.querySelector('.akari-annotations-strip-clip');
    if (!clip) return null;
    const r = clip.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })()`);
}

async function ghostState(main) {
  return evalOn(main, `(() => {
    const ghost = document.querySelector('.akari-annotations-strip-clip[style*="dashed"]');
    if (!ghost) return { found: false };
    return {
      found: true,
      rejected: ghost.classList.contains('akari-annotations-ghost-rejected'),
      snapped: ghost.classList.contains('akari-annotations-ghost-snapped'),
      durationWarning: ghost.classList.contains('akari-annotations-ghost-duration-warning')
    };
  })()`);
}

async function footerText(main) {
  return evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    return w ? w.children[4].textContent : null;
  })()`);
}

// node.append order: toolbar, timelineViewport, hScrollbarTrack, notice, footer.
// timelineViewport.append: trackHeaderColumn, timelineBody. timelineBody.append: rulerBar,
// stripScroll, timelineOverlay. timelineOverlay.append: playhead, snapGuide, dragFeedback,
// trackInsertIndicator, selectionMarquee.
async function dragFeedbackText(main) {
  return evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    if (!w) return null;
    const timelineBody = w.children[1].children[1];
    const timelineOverlay = timelineBody.children[2];
    const dragFeedback = timelineOverlay.children[2];
    return dragFeedback.textContent;
  })()`);
}

async function pointerDrag(main, path_, opts = {}) {
  const steps = opts.steps ?? 1;
  const stepDelayMs = opts.stepDelayMs ?? 0;
  const start = path_[0];
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(opts.pressDelayMs ?? 30);
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  if (opts.postPressDelayMs !== undefined) await sleep(opts.postPressDelayMs);
  for (let i = 1; i < path_.length; i++) {
    const from = path_[i - 1];
    const to = path_[i];
    for (let s = 1; s <= steps; s++) {
      const x = from.x + (to.x - from.x) * (s / steps);
      const y = from.y + (to.y - from.y) * (s / steps);
      await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      if (stepDelayMs > 0) await sleep(stepDelayMs);
    }
  }
}
async function pointerUp(main, x, y) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
}

async function waitForClamp(main, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let edit;
  while (Date.now() < deadline) {
    edit = await readJson(EDIT_JSON_PATH);
    if (edit.cuts[0].out !== 2) return edit;
    await sleep(150);
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
  await sleep(150);
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
    if (!found) {
      await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
  }
  return found;
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
  record('connected', { mode, cdpPort: CDP_PORT, workspace: WORKSPACE_DIR });

  const opened = await openTimeline(cdp);
  assert(opened, 'timeline widget opened via command palette');
  await shot(cdp, `${mode}-00-opened.png`);

  const rect = await clipRect(cdp);
  assert(Boolean(rect), 'clip C1 found in the strip');

  const editBefore = await readJson(EDIT_JSON_PATH);
  record('edit-before', { cuts: editBefore.cuts });

  // 右端の 6px エッジゾーン内でつかみ、はるかに超過した位置（+13 秒相当）へ一気にドラッグする
  // (=「まだ無限に伸びる」というオーナー報告の再現)。visibleDuration は totalDuration()
  // （このプロジェクトでは 4 秒: 2 秒クリップ * 2）に固定されているため、px/sec で換算する。
  const pxPerSec = rect.width / 2; // clip spans [0,2] over `width` px
  const startX = rect.right - 2;
  const startY = rect.top + rect.height / 2;
  const overshootSeconds = 13; // 2 -> 15 秒（実尺 6 秒を大幅に超過）
  const endX = startX + overshootSeconds * pxPerSec;

  if (mode === 'fresh-open' || mode === 'no-sidecar') {
    // 「開いた直後の初回ドラッグ」= キャッシュが一切温まっていない状態で、pointerdown から
    // pointerup まで極力間を空けずに一気にドラッグする（実尺フェッチのレースを厳しくする）。
    await pointerDrag(cdp, [{ x: startX, y: startY }, { x: endX, y: startY }], { steps: 1, stepDelayMs: 0, postPressDelayMs: 0 });
    await pointerUp(cdp, endX, startY);
    await sleep(300);
    await shot(cdp, `${mode}-01-after-drag.png`);
    const editAfter = await waitForClamp(cdp);
    record('edit-after-first-drag', { cuts: editAfter.cuts });
    assert(editAfter.cuts[0].out < 15 && Math.abs(editAfter.cuts[0].out - 6) < 0.05,
      `${mode}: first-ever drag clamps out to the real duration (~6.0s), not the proposed 15s`, {
        out: editAfter.cuts[0].out
      });

    // 回帰: 通常範囲内のトリム（実尺内）は従来通り反映され、undo で戻る。
    const editMid = await readJson(EDIT_JSON_PATH);
    const rect2 = await clipRect(cdp);
    const startX2 = rect2.right - 2;
    const startY2 = rect2.top + rect2.height / 2;
    const pxPerSec2 = rect2.width / (editMid.cuts[0].out - editMid.cuts[0].in);
    const shrinkEndX = startX2 - 1 * pxPerSec2; // 1 秒だけ短縮（実尺内、クランプ非発火）
    await pointerDrag(cdp, [{ x: startX2, y: startY2 }, { x: shrinkEndX, y: startY2 }], { steps: 6, stepDelayMs: 20, postPressDelayMs: 30 });
    await pointerUp(cdp, shrinkEndX, startY2);
    await sleep(400);
    const editAfterShrink = await readJson(EDIT_JSON_PATH);
    record('regression-normal-trim', { before: editMid.cuts[0].out, after: editAfterShrink.cuts[0].out });
    assert(editAfterShrink.cuts[0].out < editMid.cuts[0].out,
      'regression: a normal (within-duration) Out trim still shrinks the clip as usual', {
        before: editMid.cuts[0].out, after: editAfterShrink.cuts[0].out
      });
    await shot(cdp, `${mode}-02-regression-trim.png`);

    // 回帰: undo で直前のトリムが戻る。
    await focusWidgetToolbar(cdp);
    const footerBeforeUndo = await footerText(cdp);
    await keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
    let editAfterUndo = await readJson(EDIT_JSON_PATH);
    for (let attempt = 0; attempt < 15 && editAfterUndo.cuts[0].out !== editMid.cuts[0].out; attempt++) {
      await sleep(300);
      editAfterUndo = await readJson(EDIT_JSON_PATH);
    }
    const footerAfterUndo = await footerText(cdp);
    record('regression-undo-debug', { footerBeforeUndo, footerAfterUndo });
    record('regression-undo', { restored: editAfterUndo.cuts[0].out, expected: editMid.cuts[0].out });
    assert(Math.abs(editAfterUndo.cuts[0].out - editMid.cuts[0].out) < 1e-6,
      'regression: undo restores the pre-trim out value', {
        restored: editAfterUndo.cuts[0].out, expected: editMid.cuts[0].out
      });
    await shot(cdp, `${mode}-03-regression-undo.png`);
  } else if (mode === 'unresolvable') {
    // 実尺が絶対に取得できない（存在しないパス）ケース。ドラッグ中に警告が
    // 視認できる（ghost の duration-warning クラス + feedback）ことを、
    // pointerup 前に一度キャプチャする。2 回ドラッグして「毎回」出ることを確認する。
    for (let round = 1; round <= 2; round++) {
      const rectN = await clipRect(cdp);
      const sX = rectN.right - 2;
      const sY = rectN.top + rectN.height / 2;
      const eX = sX + overshootSeconds * (rectN.width / 2);
      await pointerDrag(cdp, [{ x: sX, y: sY }, { x: eX, y: sY }], { steps: 6, stepDelayMs: 30, postPressDelayMs: 50 });
      await sleep(600); // フェッチが 'unavailable' に解決するのを待つ（ドラッグ中のまま）
      const mid = await ghostState(cdp);
      const feedback = await dragFeedbackText(cdp);
      record(`unresolvable-mid-drag-round${round}`, { mid, feedback });
      await shot(cdp, `unresolvable-0${round}-mid-drag-warning.png`);
      assert(mid.found && mid.durationWarning,
        `round ${round}: ghost shows the duration-warning class while dragging Out with no resolvable source`, { mid });
      assert(typeof feedback === 'string' && feedback.includes('実尺不明'),
        `round ${round}: drag feedback text warns about unknown duration`, { feedback });
      await pointerUp(cdp, eX, sY);
      await sleep(400);
    }
    const editAfter = await readJson(EDIT_JSON_PATH);
    record('edit-after-unresolvable-drags', { cuts: editAfter.cuts });
    assert(editAfter.cuts[0].out > 6, 'unresolvable: with no real duration to clamp to, out is not artificially capped (documented no-clamp behavior)', {
      out: editAfter.cuts[0].out
    });
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }

  await writeFile(path.join(EVIDENCE_DIR, `run-log-${mode}.json`), JSON.stringify(log, null, 2));
  cdp.close();
  console.log(`ALL ACCEPTANCE CRITERIA PASSED (${mode})`);
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(path.join(EVIDENCE_DIR, `run-log-${mode}-partial.json`), JSON.stringify(log, null, 2)).finally(() => {
    process.exit(1);
  });
});
