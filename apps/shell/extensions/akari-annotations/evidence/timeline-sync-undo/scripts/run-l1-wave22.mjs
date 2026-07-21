#!/usr/bin/env node
// Wave 22 統合検証ドライバ（出力軸タイムライン / ツールモード分割 / 選択+インスペクター /
// 削除 / スナップトグル / ツールバー / プレビュー自動reveal / エラー復帰 / 回帰）。
// Dependency-free (Node 22+ built-ins only)。既存の scripts/cdp-lib.mjs を再利用する。
// プロダクトソースは一切変更しない（検証ドライバのみ）。
//
// Usage: node run-l1-wave22.mjs <cdpPort> <workspaceDir> <evidenceDir>

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
const PLAYHEAD_FOLLOW_THRESHOLD_APPROX = 0.78;

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

// ---- production totalDuration()/rebuildSegments() を JS 側で再現する（ハードコード定数を排除） ----
function computeSegments(cuts) {
  let cursor = 0;
  return cuts.map((cut, index) => {
    const duration = Math.max(0, cut.out - cut.in);
    const segment = { index, in: cut.in, out: cut.out, tlStart: cursor, tlEnd: cursor + duration };
    cursor += duration;
    return segment;
  });
}
function computeTotalDuration(edit) {
  const cuts = edit.cuts || [];
  const overlays = edit.overlays || [];
  if (cuts.length > 0) {
    const segments = computeSegments(cuts);
    const cutsDuration = segments.length > 0 ? segments[segments.length - 1].tlEnd : 0;
    const overlaysEnd = overlays.reduce((max, o) => Math.max(max, o.start + o.duration), 0);
    return Math.max(cutsDuration, overlaysEnd) * 1.02;
  }
  const candidates = [10, ...overlays.map(o => o.start + o.duration)];
  return Math.max(...candidates) * 1.02;
}
let TOTAL_DURATION = 0; // configure() 直後に readTotalDuration() で seed する
async function refreshTotalDuration() {
  const edit = await readJson(EDIT_JSON_PATH);
  TOTAL_DURATION = computeTotalDuration(edit);
  return { edit, segments: computeSegments(edit.cuts || []), total: TOTAL_DURATION };
}

// ---- widget DOM accessors（データ属性・aria-label による堅牢なセレクタ。toolbar 子要素の固定indexには依存しない） ----
const WIDGET_REFS = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const toolbar = w.children[0];
  const stripScroll = w.children[1];
  const scrollbarTrack = document.querySelector('[data-testid="akari-timeline-hscrollbar-track"]');
  const scrollbarThumb = document.querySelector('[data-testid="akari-timeline-hscrollbar-thumb"]');
  const strip = document.querySelector('.akari-annotations-strip');
  const selectToolButton = toolbar.querySelector('[aria-label="選択ツール"]');
  const razorToolButton = toolbar.querySelector('[aria-label="分割ツール"]');
  const snapToggleButton = toolbar.querySelector('[aria-label="マグネット"]');
  const undoButton = toolbar.querySelector('[aria-label="元に戻す"]');
  const redoButton = toolbar.querySelector('[aria-label="やり直す"]');
  const zoomLabel = document.querySelector('[data-testid="akari-timeline-zoom-percent"]');
  const playhead = strip.children[0];
  const snapGuide = strip.children[1];
  const footer = w.children[4];
  return {
    w, toolbar, stripScroll, scrollbarTrack, scrollbarThumb, strip,
    selectToolButton, razorToolButton, snapToggleButton, undoButton, redoButton, zoomLabel,
    playhead, snapGuide, footer
  };
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
      selectPressed: refs.selectToolButton.getAttribute('aria-pressed'),
      razorPressed: refs.razorToolButton.getAttribute('aria-pressed'),
      snapPressed: refs.snapToggleButton.getAttribute('aria-pressed'),
      footer: refs.footer.textContent
    };
  })()`);
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

async function elementCount(main, selector) {
  return evalOn(main, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

async function readFooter(main) {
  return evalOn(main, `${WIDGET_REFS}.footer.textContent`);
}

async function waitFooterSettled(main, pattern, prevFooter, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let footer = '';
  while (Date.now() < deadline) {
    footer = await readFooter(main);
    if (footer !== prevFooter && pattern.test(footer)) return footer;
    await sleep(200);
  }
  throw new Error(`footer did not settle to ${pattern} within ${timeoutMs}ms (last: "${footer}")`);
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
  await shot(main, 'wave22-00-boot.png');

  // ================= open the timeline widget via the command palette =================
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
  await refreshTotalDuration();
  record('total-duration-seeded', { TOTAL_DURATION });
  await shot(main, 'wave22-01-timeline-opened.png');

  // ================= H: toolbar heading absence + icon buttons =================
  {
    const toolbarCheck = await evalOn(main, `(() => {
      const refs = ${WIDGET_REFS};
      const bodyHeadingMatch = Array.from(refs.w.querySelectorAll('div,h1,h2,h3,span'))
        .some(el => el.children.length === 0 && el.textContent.trim() === 'タイムライン');
      const undoIsIcon = refs.undoButton.querySelector('span.codicon') !== null && refs.undoButton.textContent.trim() === '';
      const redoIsIcon = refs.redoButton.querySelector('span.codicon') !== null && refs.redoButton.textContent.trim() === '';
      const tabLabel = document.querySelector('.lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel, .p-TabBar-tab.p-mod-current .p-TabBar-tabLabel');
      return { bodyHeadingMatch, undoIsIcon, redoIsIcon, tabLabel: tabLabel ? tabLabel.textContent : null };
    })()`);
    record('H-toolbar-check', toolbarCheck);
    assert(!toolbarCheck.bodyHeadingMatch, 'H: no in-body "タイムライン" heading text node (only the tab label carries it)', toolbarCheck);
    assert(toolbarCheck.undoIsIcon && toolbarCheck.redoIsIcon, 'H: undo/redo are icon buttons (codicon span, no text)', toolbarCheck);
  }
  await shot(main, 'wave22-02-toolbar.png');

  // ================= A: output axis — cuts laid out gapless in output seconds =================
  {
    const { edit, segments } = await refreshTotalDuration();
    assert(edit.cuts.length === 3, 'A precondition: fixture has 3 cuts', { cuts: edit.cuts });
    const rects = [];
    for (let i = 0; i < 3; i++) {
      rects.push(await elementRect(main, '.akari-annotations-strip-clip', i));
    }
    record('A-clip-rects', { rects, segments });
    for (let i = 0; i < 2; i++) {
      const gap = rects[i + 1].left - rects[i].right;
      assert(Math.abs(gap) <= 3, `A: clip C${i + 1} and C${i + 2} are adjacent with no gap (output axis, gapless)`, {
        gap, rightOfPrev: rects[i].right, leftOfNext: rects[i + 1].left
      });
    }
    // ルーラーは出力秒（cuts 尺合計 10s * 1.02 = 10.2s）を表示する。ソース秒の最終out(11.5s)ではない
    const s = await widgetState(main);
    record('A-total-duration-vs-source', { visibleDuration: s.visibleDuration, TOTAL_DURATION, sourceLastOut: edit.cuts[edit.cuts.length - 1].out });
    assert(Math.abs(s.visibleDuration - TOTAL_DURATION) < 0.05, 'A: default view shows the full gapless output duration (no zoom needed)', {
      visibleDuration: s.visibleDuration, TOTAL_DURATION
    });
    assert(s.visibleDuration < edit.cuts[edit.cuts.length - 1].out - 0.5,
      'A: output duration (10.2s) is meaningfully shorter than the source last-cut-out (11.5s) — proves the axis is output-based, not source-based', {
        visibleDuration: s.visibleDuration, sourceLastOut: edit.cuts[edit.cuts.length - 1].out
      });
  }
  await shot(main, 'wave22-03-output-axis-gapless.png');

  // ================= enable developer mode (Wave19 既定「素材」ビューから標準Explorerへ) =================
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
    return { found: true, x: r.left + 20, y: r.top + r.height / 2 };
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

  let folderRow = await findRow('exports');
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
  await shot(main, 'wave22-04-preview-tab-opened.png');

  // ---- locate the webview's outer CDP target and reach the inner active-frame execution context ----
  // タブの hide/reveal を挟むと、同じ target に対する既存の CDP WebSocket セッションが
  // 応答しなくなることが実測で確認された（target 自体は /json/list に残り続け、新規接続なら
  // 即座に応答する）。無応答のまま無限に await し続けることを避けるため、
  // 呼び出しごとにタイムアウトを掛け、タイムアウト時は再接続して1回だけ再試行する。
  let outer;
  let activeCtx;
  async function connectToPreviewWebviewOnce() {
    let outerTarget = null;
    for (let attempt = 0; attempt < 15 && !outerTarget; attempt++) {
      const targets = await listTargets(CDP_PORT);
      outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html\?id=akari-preview-/.test(t.url));
      if (!outerTarget) await sleep(300);
    }
    if (!outerTarget) throw new Error('outer webview CDP target not found');
    const nextOuter = new CDP(outerTarget.webSocketDebuggerUrl);
    await nextOuter.connect();
    const contexts = [];
    nextOuter.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
    await nextOuter.send('Page.enable');
    await nextOuter.send('Runtime.enable');
    await sleep(400);
    const frameTree = await nextOuter.send('Page.getFrameTree');
    const topFrameId = frameTree.frameTree.frame.id;
    const nextActiveCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
    if (!nextActiveCtx) {
      try { nextOuter.close(); } catch { /* best-effort */ }
      throw new Error('inner active-frame execution context not found');
    }
    return { nextOuter, nextActiveCtx };
  }
  // タブの reveal 直後は webview 内側フレームの再構築中で、即座に接続しても内側 execution
  // context がまだ無いことがある（実測）。数回リトライしてから諦める。
  async function connectToPreviewWebview() {
    let lastError;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const { nextOuter, nextActiveCtx } = await connectToPreviewWebviewOnce();
        try { outer?.close(); } catch { /* previous session may already be dead */ }
        outer = nextOuter;
        activeCtx = nextActiveCtx;
        return;
      } catch (error) {
        lastError = error;
        await sleep(500);
      }
    }
    throw lastError;
  }
  await connectToPreviewWebview();
  record('reached-active-frame-context', { nestedContext: true });

  function withTimeout(promise, label, timeoutMs = 6000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT(${timeoutMs}ms): ${label}`)), timeoutMs))
    ]);
  }

  async function evalInPreview(expression) {
    let r;
    try {
      r = await withTimeout(
        outer.send('Runtime.evaluate', { expression, contextId: activeCtx.id, returnByValue: true, awaitPromise: true }),
        'evalInPreview'
      );
    } catch (timeoutError) {
      record('evalInPreview-stale-connection-reconnecting', { error: String(timeoutError) });
      await connectToPreviewWebview();
      r = await outer.send('Runtime.evaluate', { expression, contextId: activeCtx.id, returnByValue: true, awaitPromise: true });
    }
    if (r.exceptionDetails) throw new Error('evalInPreview failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  // 12秒の実素材が metadata を読み込むまで待つ（未ロード状態での video.currentTime 代入は
  // 反映されない/読み戻しが不定になるため、以降のシーク系検証はこれを待ってから行う）。
  {
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      ready = await evalInPreview(`(() => { const v = document.getElementById('preview-video'); return v.readyState >= 1 && Number.isFinite(v.duration); })()`);
      if (!ready) await sleep(300);
    }
    record('preview-metadata-ready', { ready });
    assert(ready, 'preview video reached readyState>=HAVE_METADATA before running seek-dependent checks', { ready });
  }

  // ================= C: timeline click seeks the preview (output time -> source time) =================
  {
    await evalInPreview(`(() => { document.getElementById('preview-video').currentTime = 0; return true; })()`);
    await sleep(200);
    // click at output t=4s (inside segment[1], tl [3,6]) -> expected source = cuts[1].in + (4-3) = 5s
    const { segments } = await refreshTotalDuration();
    const clickOutputT = 4;
    const seekClickX = await screenXForTime(main, clickOutputT);
    const before = await widgetState(main);
    const seekClickY = before.stripRect.top + 7; // ruler band, avoids hitting a clip
    await realClick(main, seekClickX, seekClickY);
    await sleep(500);
    const seekState = await widgetState(main);
    const previewTimeAfterSeek = await evalInPreview(`document.getElementById('preview-video').currentTime`);
    const expectedSource = segments[1].in + (clickOutputT - segments[1].tlStart);
    record('C-click-to-seek', { footer: seekState.footer, previewTimeAfterSeek, expectedSource });
    assert(seekState.footer.includes('シーク'), 'C: footer reports the preview was seeked', { footer: seekState.footer });
    assert(Math.abs(previewTimeAfterSeek - expectedSource) < 0.5,
      'C: clicking output t=4s seeks the preview to the mapped source time (~5s), not the raw output time', {
        previewTimeAfterSeek, expectedSource
      });
  }
  await shot(main, 'wave22-05-click-to-seek.png');

  // ================= I: timeline interaction reveals the hidden preview tab =================
  {
    // open captions.json as a second main-area tab to push the preview tab behind it
    let capRow = await findRow('captions.json');
    for (let attempt = 0; attempt < 4 && !capRow.found; attempt++) {
      await sleep(400);
      capRow = await findRow('captions.json');
    }
    if (!capRow.found) throw new Error('tree row for captions.json not found');
    await realClick(main, capRow.x, capRow.y, { clickCount: 2 });
    await sleep(1000);
    const beforeReveal = await evalOn(main, `(() => {
      const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab'));
      const previewTab = tabs.find(t => t.textContent.includes('sample.mp4'));
      const captionsTab = tabs.find(t => t.textContent.includes('captions.json'));
      return {
        previewCurrent: previewTab ? previewTab.classList.contains('lm-mod-current') : null,
        captionsCurrent: captionsTab ? captionsTab.classList.contains('lm-mod-current') : null,
        found: !!previewTab && !!captionsTab
      };
    })()`);
    record('I-before-reveal', beforeReveal);
    assert(beforeReveal.found, 'I precondition: both preview and captions.json tabs exist', beforeReveal);
    assert(beforeReveal.captionsCurrent === true && beforeReveal.previewCurrent === false,
      'I precondition: captions.json tab is in front, preview tab is hidden behind it', beforeReveal);
    await shot(main, 'wave22-06-preview-hidden-behind-captions.png');

    // click the timeline background (ruler band, not a clip) -> should reveal the preview tab
    const s = await widgetState(main);
    await realClick(main, s.stripRect.left + 30, s.stripRect.top + 7);
    await sleep(700);
    const afterReveal = await evalOn(main, `(() => {
      const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab'));
      const previewTab = tabs.find(t => t.textContent.includes('sample.mp4'));
      return { previewCurrent: previewTab ? previewTab.classList.contains('lm-mod-current') : null };
    })()`);
    record('I-after-reveal', afterReveal);
    assert(afterReveal.previewCurrent === true,
      'I: clicking the timeline brings the (hidden) preview tab to the front (auto-reveal)', afterReveal);
    await shot(main, 'wave22-07-preview-revealed.png');
  }

  // タブの hide/reveal 直後は既存の webview CDP セッションが応答しなくなることがある
  // （target 自体は存続、新規接続なら即応答。実測で確認済み）ため、ここで明示的に張り直す。
  await connectToPreviewWebview();
  record('reconnected-preview-webview-after-reveal-dance', {});

  // ================= B: playback across a cut boundary — output time is continuous (no jump) =================
  {
    const { segments } = await refreshTotalDuration();
    const seg0 = segments[0]; // source [0.5,3.5] -> tl [0,3]
    const seg1 = segments[1]; // source [4,7] -> tl [3,6]
    const startSource = seg0.out - 0.3; // 3.2s source, tl ~2.7s — just before the boundary
    // v.currentTime への代入は、直前の reveal でフレームが再構築中だと反映されないことがある
    // （実測）ため、読み戻して確認し、ずれていれば数回リトライする。
    let seekedOk = false;
    let seekedActual = null;
    for (let attempt = 0; attempt < 5 && !seekedOk; attempt++) {
      await evalInPreview(`(() => { const v = document.getElementById('preview-video'); v.pause(); v.currentTime = ${startSource}; return true; })()`);
      await sleep(250);
      seekedActual = await evalInPreview(`document.getElementById('preview-video').currentTime`);
      seekedOk = Math.abs(seekedActual - startSource) < 0.3;
    }
    record('B-preseek-to-boundary', { startSource, seekedActual, seekedOk });
    assert(seekedOk, 'B setup: preview seeks to just-before-boundary source time before sampling playback', { startSource, seekedActual });
    await scrollToTime(main, Math.max(0, seg0.tlEnd - 1));
    await sleep(150);
    await evalInPreview(`(() => { document.getElementById('preview-video').play(); return true; })()`);

    const samples = [];
    const sampleStart = Date.now();
    for (let i = 0; i < 12; i++) {
      await sleep(150);
      const [w, previewTime] = await Promise.all([
        widgetState(main),
        evalInPreview(`document.getElementById('preview-video').currentTime`)
      ]);
      samples.push({ tMs: Date.now() - sampleStart, playheadLeftPx: w.playheadLeftPx, previewTime });
    }
    record('B-boundary-samples', { samples, seg0TlEnd: seg0.tlEnd, seg1In: seg1.in });
    await evalInPreview(`(() => { document.getElementById('preview-video').pause(); return true; })()`);

    const pxPerSecAtPlay = (await widgetState(main)).contentWidthPx / TOTAL_DURATION;
    let monotonic = true;
    let maxStepTl = 0;
    for (let i = 1; i < samples.length; i++) {
      const dTl = (samples[i].playheadLeftPx - samples[i - 1].playheadLeftPx) / pxPerSecAtPlay;
      if (dTl < -0.05) monotonic = false;
      maxStepTl = Math.max(maxStepTl, dTl);
    }
    record('B-monotonic-check', { monotonic, maxStepTl });
    assert(monotonic, 'B: output-axis playhead position does not jump backward across the cut boundary', { samples });
    // 0.15s間隔サンプリングで、境界をまたいでも1ステップの前進量が異常に大きくない（=出力軸ジャンプが無い）ことを確認。
    // ソース側は 3.5s -> 4s へ瞬間ジャンプするが、出力側は連続増加するはず。
    assert(maxStepTl < 0.5, 'B: no single sample-to-sample step is abnormally large (output axis stays continuous across the boundary)', { maxStepTl });

    // ソース側は実際に境界でジャンプしていることも確認する（cuts の隙間がソース側にはある証拠）
    const sourceJump = samples.some((s, idx) => idx > 0 && (s.previewTime - samples[idx - 1].previewTime) > 0.3);
    record('B-source-side-jump-exists', { sourceJump });
    assert(sourceJump, 'B precondition: the source video time does jump at the cut boundary (proves cuts have a real source gap)', { samples });

    const last = samples[samples.length - 1];
    const first = samples[0];
    assert(last.playheadLeftPx > first.playheadLeftPx, 'B: playhead net-advanced over the sampling window', {
      first: first.playheadLeftPx, last: last.playheadLeftPx
    });
  }
  await shot(main, 'wave22-08-boundary-playback.png');

  await writeFile(path.join(EVIDENCE_DIR, 'wave22-run-log-partial-1.json'), JSON.stringify(log, null, 2));

  // ================= D: tool mode (select/razor) + split + undo =================
  {
    // 'b' -> razor mode
    await keyPress(main, { key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 });
    await sleep(200);
    let s = await widgetState(main);
    record('D-razor-mode-on', { selectPressed: s.selectPressed, razorPressed: s.razorPressed });
    assert(s.razorPressed === 'true' && s.selectPressed === 'false', 'D: pressing B switches to razor (split) tool mode', s);
    await shot(main, 'wave22-09-razor-mode.png');

    const { edit: editBeforeSplit, segments } = await refreshTotalDuration();
    const seg1 = segments[1]; // tl [3,6], source cut {in:4,out:7}
    const splitOutputT = seg1.tlStart + 1.5; // tl=4.5 -> source = 4 + 1.5 = 5.5
    const clipRect = await elementRect(main, '.akari-annotations-strip-clip', 1);
    const clickX = await screenXForTime(main, splitOutputT);
    const clickY = clipRect.top + clipRect.height / 2;
    const footerBeforeSplit = await readFooter(main);
    await realClick(main, clickX, clickY);
    await waitFooterSettled(main, /クリップを分割しました/, footerBeforeSplit);
    const editAfterSplit = await readJson(EDIT_JSON_PATH);
    record('D-split-result', { before: editBeforeSplit.cuts, after: editAfterSplit.cuts });
    assert(editAfterSplit.cuts.length === editBeforeSplit.cuts.length + 1,
      'D: splitting a clip in razor mode increases cuts[] length by 1 (3 -> 4)', {
        before: editBeforeSplit.cuts.length, after: editAfterSplit.cuts.length
      });
    // クリック→秒変換はピクセル丸めの影響を受けるため、分割位置そのものの厳密一致は求めない。
    // 実際に検証すべきは: (1) 前半が元の in から始まり、クリック近辺(±0.2s)で終わる、
    // (2) 後半が前半の終端と完全に連続する(out===in、cuts間に隙間ができない)、
    // (3) 後半が元の out で終わる。
    assert(editAfterSplit.cuts[1].in === editBeforeSplit.cuts[1].in,
      'D: split first half starts at the original clip\'s in', { firstHalf: editAfterSplit.cuts[1] });
    assert(Math.abs(editAfterSplit.cuts[1].out - splitOutputT + seg1.tlStart - seg1.in) < 0.2,
      'D: split point lands near the clicked time (within 0.2s pixel-rounding tolerance)', {
        actualOut: editAfterSplit.cuts[1].out, clickedSourceApprox: splitOutputT - seg1.tlStart + seg1.in
      });
    assert(editAfterSplit.cuts[1].out === editAfterSplit.cuts[2].in,
      'D: split halves are perfectly contiguous (first half out === second half in, no gap)', {
        firstOut: editAfterSplit.cuts[1].out, secondIn: editAfterSplit.cuts[2].in
      });
    assert(editAfterSplit.cuts[2].out === editBeforeSplit.cuts[1].out,
      'D: split second half ends at the original clip\'s out', { secondHalf: editAfterSplit.cuts[2] });
    await shot(main, 'wave22-10-after-split.png');

    // undo the split
    const footerBeforeUndo = await readFooter(main);
    await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
    await waitFooterSettled(main, /を元に戻しました/, footerBeforeUndo);
    const editAfterUndo = await readJson(EDIT_JSON_PATH);
    record('D-undo-split', { cutsAfterUndo: editAfterUndo.cuts, expectedCuts: editBeforeSplit.cuts });
    assert(editAfterUndo.cuts.length === editBeforeSplit.cuts.length, 'D: undo restores cuts[] length to 3', {
      after: editAfterUndo.cuts.length
    });
    assert(JSON.stringify(editAfterUndo.cuts) === JSON.stringify(editBeforeSplit.cuts),
      'D: undo restores cuts[] values exactly (structural compare)', {
        before: editBeforeSplit.cuts, after: editAfterUndo.cuts
      });
    await shot(main, 'wave22-11-after-split-undo.png');

    // 'a' -> back to select mode
    await keyPress(main, { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await sleep(200);
    s = await widgetState(main);
    record('D-select-mode-restored', { selectPressed: s.selectPressed, razorPressed: s.razorPressed });
    assert(s.selectPressed === 'true' && s.razorPressed === 'false', 'D: pressing A switches back to select tool mode', s);
  }

  await refreshTotalDuration();
  await writeFile(path.join(EVIDENCE_DIR, 'wave22-run-log-partial-2.json'), JSON.stringify(log, null, 2));

  // ================= E: clip selection (orange outline) + auto-opened inspector, switches on reselect =================
  {
    const c1Rect = await elementRect(main, '.akari-annotations-strip-clip', 0);
    await realClick(main, (c1Rect.left + c1Rect.right) / 2, (c1Rect.top + c1Rect.bottom) / 2);
    await sleep(600);
    const c1Check = await evalOn(main, `(() => {
      const el = document.querySelectorAll('.akari-annotations-strip-clip')[0];
      const selected = el.classList.contains('akari-annotations-selected');
      const style = getComputedStyle(el);
      return { selected, outlineColor: style.outlineColor, outlineWidth: style.outlineWidth };
    })()`);
    record('E-c1-selected', c1Check);
    assert(c1Check.selected, 'E: clicking C1 in select mode adds the selected class (orange outline)', c1Check);
    // #f97316 == rgb(249, 115, 22)
    assert(/249,\s*115,\s*22/.test(c1Check.outlineColor), 'E: selected clip outline color is the orange #f97316', c1Check);

    const readInspector = () => evalOn(main, `(() => {
      const w = document.getElementById('akari-inspector-widget');
      if (!w) return { found: false };
      const heading = w.querySelector('.akari-inspector-heading');
      const rows = Array.from(w.querySelectorAll('.akari-inspector-row')).map(r => ({
        label: r.querySelector('.akari-inspector-row-label').textContent,
        value: r.querySelector('.akari-inspector-row-value').textContent
      }));
      return { found: true, heading: heading ? heading.textContent : null, rows };
    })()`);
    // applySelection -> executeCommand(OPEN_AKARI_INSPECTOR_ID) -> getOrCreateWidget/addWidget/revealWidget
    // は非同期チェーンのため、固定 sleep だけでは間に合わないことがある。ポーリングで待つ。
    let inspector1 = await readInspector();
    for (let attempt = 0; attempt < 10 && !inspector1.found; attempt++) {
      await sleep(300);
      inspector1 = await readInspector();
    }
    record('E-inspector-for-c1', inspector1);
    assert(inspector1.found, 'E: selecting a clip auto-opens the inspector panel (akari-inspector-widget exists)', inspector1);
    assert(inspector1.heading === 'クリップ', 'E: inspector heading shows "クリップ" for a cut selection', inspector1);
    const rowMap1 = Object.fromEntries(inspector1.rows.map(r => [r.label, r.value]));
    assert(rowMap1['素材'] && rowMap1['素材'].includes('sample.mp4'), 'E: inspector shows the source material name', rowMap1);
    assert(rowMap1['クリップ'] === 'C1', 'E: inspector shows the clip label C1', rowMap1);
    assert(rowMap1['素材 in'] !== undefined && rowMap1['素材 out'] !== undefined, 'E: inspector shows source in/out', rowMap1);
    assert(rowMap1['出力位置'] !== undefined && rowMap1['尺'] !== undefined, 'E: inspector shows output position and duration', rowMap1);
    await shot(main, 'wave22-12-c1-selected-inspector.png');

    // select a different clip (C3) -> inspector content must switch
    const c3Rect = await elementRect(main, '.akari-annotations-strip-clip', 2);
    record('E-c3-rect', c3Rect);
    await realClick(main, (c3Rect.left + c3Rect.right) / 2, (c3Rect.top + c3Rect.bottom) / 2);
    const readInspectorRows = () => evalOn(main, `(() => {
      const w = document.getElementById('akari-inspector-widget');
      const rows = Array.from(w.querySelectorAll('.akari-inspector-row')).map(r => ({
        label: r.querySelector('.akari-inspector-row-label').textContent,
        value: r.querySelector('.akari-inspector-row-value').textContent
      }));
      return { rows };
    })()`);
    let inspector2 = await readInspectorRows();
    let rowMap2 = Object.fromEntries(inspector2.rows.map(r => [r.label, r.value]));
    for (let attempt = 0; attempt < 10 && rowMap2['クリップ'] !== 'C3'; attempt++) {
      await sleep(300);
      inspector2 = await readInspectorRows();
      rowMap2 = Object.fromEntries(inspector2.rows.map(r => [r.label, r.value]));
    }
    record('E-inspector-for-c3', rowMap2);
    assert(rowMap2['クリップ'] === 'C3', 'E: selecting a different clip (C3) updates the inspector label', rowMap2);
    assert(rowMap2['出力位置'] !== rowMap1['出力位置'], 'E: inspector output position changes between C1 and C3 selections', {
      c1: rowMap1['出力位置'], c3: rowMap2['出力位置']
    });
    await shot(main, 'wave22-13-c3-selected-inspector.png');
  }

  // ================= F: delete selected clip + undo restores the exact file bytes =================
  {
    // C3 is currently selected from the previous phase
    const editBeforeDelete = await readFile(EDIT_JSON_PATH, 'utf8');
    const footerBeforeDelete = await readFooter(main);
    await keyPress(main, { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await waitFooterSettled(main, /クリップを削除しました/, footerBeforeDelete);
    const editAfterDelete = await readJson(EDIT_JSON_PATH);
    record('F-delete-result', { cutsAfterDelete: editAfterDelete.cuts });
    assert(editAfterDelete.cuts.length === 2, 'F: deleting the selected clip removes it from cuts[] (3 -> 2)', {
      cuts: editAfterDelete.cuts
    });
    await shot(main, 'wave22-14-after-delete.png');

    const footerBeforeUndoDelete = await readFooter(main);
    await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
    await waitFooterSettled(main, /を元に戻しました/, footerBeforeUndoDelete);
    const editAfterUndoDelete = await readFile(EDIT_JSON_PATH, 'utf8');
    const bytesMatch = editAfterUndoDelete === editBeforeDelete;
    record('F-undo-delete-byte-compare', { bytesMatch, lengthBefore: editBeforeDelete.length, lengthAfter: editAfterUndoDelete.length });
    assert(bytesMatch, 'F: undo restores edit.json to byte-identical content after a clip delete', {
      lengthBefore: editBeforeDelete.length, lengthAfter: editAfterUndoDelete.length
    });
    await shot(main, 'wave22-15-after-delete-undo.png');
  }

  await refreshTotalDuration();
  await writeFile(path.join(EVIDENCE_DIR, 'wave22-run-log-partial-3.json'), JSON.stringify(log, null, 2));

  // ================= G: snap toggle (N key + magnet button), aria-pressed flips =================
  {
    const before = await widgetState(main);
    record('G-snap-before', { snapPressed: before.snapPressed });
    assert(before.snapPressed === 'true', 'G precondition: snap is enabled by default', before);

    await keyPress(main, { key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 });
    await sleep(200);
    const afterKey = await widgetState(main);
    record('G-snap-after-n-key', { snapPressed: afterKey.snapPressed });
    assert(afterKey.snapPressed === 'false', 'G: pressing N toggles snap off (aria-pressed -> false)', afterKey);
    await shot(main, 'wave22-16-snap-off.png');

    const magnetRect = await evalOn(main, `(() => { const r = ${WIDGET_REFS}.snapToggleButton.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await realClick(main, magnetRect.x, magnetRect.y);
    await sleep(200);
    const afterButton = await widgetState(main);
    record('G-snap-after-button-click', { snapPressed: afterButton.snapPressed });
    assert(afterButton.snapPressed === 'true', 'G: clicking the magnet button toggles snap back on (aria-pressed -> true)', afterButton);
    await shot(main, 'wave22-17-snap-on.png');
  }

  // ================= J: preview error recovery (disabled controls -> reload restores) =================
  {
    const originalSrc = await evalInPreview(`document.getElementById('preview-video').currentSrc || document.getElementById('preview-video').src`);
    record('J-original-src-captured', { hasSrc: !!originalSrc });

    const beforeError = await evalInPreview(`(() => {
      const playToggle = document.getElementById('play-toggle') || document.querySelector('[data-testid="akari-preview-play-toggle"]');
      return { playToggleFound: !!playToggle, disabled: playToggle ? playToggle.disabled : null };
    })()`);
    record('J-before-error-controls', beforeError);

    await evalInPreview(`(() => {
      const v = document.getElementById('preview-video');
      v.pause();
      v.src = 'file:///akari-l1-wave22-nonexistent-video-xyz.mp4';
      v.load();
      return true;
    })()`);
    // wait for the 'error' event -> showPlaybackError() to disable controls
    let errored = false;
    for (let i = 0; i < 20 && !errored; i++) {
      await sleep(300);
      errored = await evalInPreview(`(() => {
        const msg = document.getElementById('preview-message');
        return msg && !msg.hidden;
      })()`);
    }
    const afterError = await evalInPreview(`(() => {
      const reload = document.getElementById('preview-message-reload');
      const controlsIds = ['play-toggle', 'frame-back', 'frame-forward', 'skip-back', 'skip-forward', 'seek'];
      const disabledStates = controlsIds.map(id => {
        const el = document.getElementById(id);
        return el ? el.disabled : null;
      });
      return {
        reloadVisible: reload ? !reload.hidden : null, disabledStates
      };
    })()`);
    record('J-after-error', { errored, ...afterError });
    assert(errored, 'J: an invalid video src fires the error event and shows the playback-error message card', { errored });
    assert(afterError.reloadVisible === true, 'J: the reload button becomes visible on playback error', afterError);
    assert(afterError.disabledStates.every(d => d === true || d === null),
      'J: transport controls are disabled while in the error state', afterError);
    await shot(main, 'wave22-18-preview-error.png');

    // restore: put the valid src back, then click the reload button
    await evalInPreview(`(() => { document.getElementById('preview-video').src = ${JSON.stringify(String(originalSrc))}; return true; })()`);
    await sleep(200);
    const reloadRect = await evalInPreview(`(() => {
      const btn = document.getElementById('preview-message-reload');
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    // reload ボタンは webview 内蔵の座標系。outer 経由でクリックするため main の CDP で
    // webview のスクリーン座標へオフセットする必要がある簡易策として、直接 evalInPreview で click() する。
    await evalInPreview(`(() => { document.getElementById('preview-message-reload').click(); return true; })()`);
    let restored = false;
    for (let i = 0; i < 20 && !restored; i++) {
      await sleep(300);
      restored = await evalInPreview(`(() => {
        const msg = document.getElementById('preview-message');
        return msg && msg.hidden;
      })()`);
    }
    const afterRestore = await evalInPreview(`(() => {
      const playToggle = document.getElementById('play-toggle');
      return { playToggleDisabled: playToggle ? playToggle.disabled : null };
    })()`);
    record('J-after-restore', { restored, ...afterRestore });
    assert(restored, 'J: after restoring a valid src and clicking reload, the error message clears', { restored });
    assert(afterRestore.playToggleDisabled === false, 'J: transport controls are re-enabled after recovery', afterRestore);
    await shot(main, 'wave22-19-preview-recovered.png');

    // sanity: normal playback afterward doesn't leave controls disabled
    await evalInPreview(`(() => { const v = document.getElementById('preview-video'); v.currentTime = 0; v.play(); return true; })()`);
    await sleep(500);
    const duringNormalPlayback = await evalInPreview(`(() => {
      const playToggle = document.getElementById('play-toggle');
      return { disabled: playToggle ? playToggle.disabled : null };
    })()`);
    await evalInPreview(`(() => { document.getElementById('preview-video').pause(); return true; })()`);
    record('J-normal-playback-controls', duringNormalPlayback);
    assert(duringNormalPlayback.disabled === false, 'J: normal playback never disables the transport controls', duringNormalPlayback);
  }

  await writeFile(path.join(EVIDENCE_DIR, 'wave22-run-log-partial-4.json'), JSON.stringify(log, null, 2));

  console.log('ALL WAVE22 ACCEPTANCE CRITERIA PASSED (A,B,C,D,E,F,G,H,I,J)');
  main.close();
  outer.close();
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(path.join(process.argv[4] || '.', 'wave22-run-log-partial-FAILED.json'), JSON.stringify(log, null, 2)).finally(() => {
    process.exit(1);
  });
});
