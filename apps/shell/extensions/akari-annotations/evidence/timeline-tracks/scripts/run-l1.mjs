#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only) raw-CDP driver exercising the
// timeline-tracks acceptance criteria (Wave 23: track model, lane reversal,
// vertical drag = track change, preview/render-cut z-order, track headers)
// plus a light regression pass, against a running production-build Electron
// instance of apps/shell. Adapted from evidence/timeline-selection-cp and
// evidence/timeline-sync-undo (same repo, prior waves).
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
const TOTAL_DURATION = 11.5 * 1.02; // matches totalDuration(): max(10, captions ends, cuts outs=11.5, overlay end, ann+1) * 1.02

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

// ---- widget DOM accessors ----
// node.append order (akari-annotations-widget.ts): toolbar, timelineViewport, hScrollbarTrack, notice, footer.
// timelineViewport.append order: trackHeaders, stripScroll. stripScroll.appendChild: strip.
const WIDGET_REFS = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const toolbar = w.children[0];
  const timelineViewport = w.children[1];
  const trackHeaders = timelineViewport.children[0];
  const stripScroll = timelineViewport.children[1];
  const scrollbarTrack = w.children[2];
  const scrollbarThumb = scrollbarTrack.children[0];
  const strip = stripScroll.children[0];
  const undoButton = toolbar.children[2];
  const redoButton = toolbar.children[3];
  const playhead = strip.children[0];
  const snapGuide = strip.children[1];
  const footer = w.children[4];
  return {
    w, toolbar, timelineViewport, trackHeaders, stripScroll, scrollbarTrack, scrollbarThumb,
    strip, undoButton, redoButton, playhead, snapGuide, footer
  };
})()`;

async function widgetState(main) {
  return evalOn(main, `(() => {
    const refs = ${WIDGET_REFS};
    if (!refs) return { found: false };
    const stripRect = refs.strip.getBoundingClientRect();
    const zoomPercent = Number((refs.toolbar.children[1].children[1].textContent || '100').replace('%', ''));
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

async function laneBandRects(main) {
  return evalOn(main, `(() => {
    const strip = ${WIDGET_REFS}.strip;
    return Array.from(strip.querySelectorAll('.akari-track-band')).map(b => {
      const r = b.getBoundingClientRect();
      return { lane: b.dataset.akariLane, hidden: b.classList.contains('akari-track-band-hidden'), top: r.top, height: r.height };
    });
  })()`);
}

async function overlayItemState(main, overlayId) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-annotations-strip-overlay[data-akari-item-id="${overlayId}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { track: el.dataset.akariTrack, opacity: el.style.opacity, top: r.top, left: r.left, height: r.height };
  })()`);
}

async function trackHeaderButtonRect(main, lane) {
  return evalOn(main, `(() => {
    const el = document.querySelector('.akari-track-header-button[data-akari-lane="${lane}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, ariaPressed: el.getAttribute('aria-pressed') };
  })()`);
}

async function selectedTimelineItems(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('.akari-annotations-selected')).map(element => ({
    kind: element.dataset.akariItemKind,
    id: element.dataset.akariItemId,
    className: element.className
  }))`);
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

async function dragSequence(cdp, path_, opts = {}) {
  const steps = opts.steps ?? 10;
  const stepDelayMs = opts.stepDelayMs ?? 20;
  const start = path_[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  for (let i = 1; i < path_.length; i++) {
    const from = path_[i - 1];
    const to = path_[i];
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

// 一度でもプレビュー webview を開閉・操作すると CDP の Input.dispatchKeyEvent がメインウィンドウ
// でなく webview 側に配送され続ける現象を実測（timeline-selection-cp 由来の既知回避策）。
async function focusWidgetToolbar(main) {
  const point = await evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    const r = w.children[0].getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 5 };
  })()`);
  await realClick(main, point.x, point.y);
  await sleep(150);
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

  // ================= AC-1: lane vertical order (ruler -> captions -> tracks N..0 -> clips) =================
  const bands = await laneBandRects(main);
  record('AC1-lane-band-rects', { bands });
  const captionsBand = bands.find(b => b.lane === 'captions');
  const clipsBand = bands.find(b => b.lane === 'clips');
  const track2Band = bands.find(b => b.lane === 'track-2');
  const track1Band = bands.find(b => b.lane === 'track-1');
  const track0Band = bands.find(b => b.lane === 'track-0');
  assert(Boolean(captionsBand && clipsBand && track2Band && track1Band && track0Band),
    'AC1: captions/track-2/track-1/track-0/clips bands all present', { bands });
  assert(captionsBand.top < track2Band.top && track2Band.top < track1Band.top
    && track1Band.top < track0Band.top && track0Band.top < clipsBand.top,
  'AC1: vertical order is captions < track-2 < track-1 < track-0 < clips (top-down)', {
    captionsTop: captionsBand.top, track2Top: track2Band.top, track1Top: track1Band.top,
    track0Top: track0Band.top, clipsTop: clipsBand.top
  });
  await shot(main, '02-lane-order.png');

  // ================= AC-2: track-missing overlay (ov-d) degrades to track 0 =================
  const ovDBefore = await overlayItemState(main, 'ov-d');
  record('AC2-ov-d-missing-track', { ovDBefore });
  assert(ovDBefore && ovDBefore.track === '0', 'AC2: overlay with no track field renders in track-0 row', { ovDBefore });

  // ================= AC-3/AC-4/AC-5 setup: enable developer mode + open preview =================
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
    await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
  }

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

  const folderRow = await findRow('exports');
  if (!folderRow.found) throw new Error('tree row for folder "exports" not found');

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

  let outer;
  let activeCtx;
  async function connectPreview() {
    let outerTarget = null;
    for (let attempt = 0; attempt < 15 && !outerTarget; attempt++) {
      const targets = await listTargets(CDP_PORT);
      outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html\?id=akari-preview-/.test(t.url));
      if (!outerTarget) await sleep(300);
    }
    if (!outerTarget) throw new Error('outer webview CDP target not found');
    if (outer) outer.close();
    outer = new CDP(outerTarget.webSocketDebuggerUrl);
    await outer.connect();
    const contexts = [];
    outer.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
    await outer.send('Page.enable');
    await outer.send('Runtime.enable');
    await sleep(400);
    const frameTree = await outer.send('Page.getFrameTree');
    const topFrameId = frameTree.frameTree.frame.id;
    activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
    if (!activeCtx) throw new Error('inner active-frame execution context not found');
  }
  await connectPreview();

  async function evalInPreview(expression) {
    const r = await outer.send('Runtime.evaluate', { expression, contextId: activeCtx.id, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evalInPreview failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  async function previewOverlayZIndex(overlayId) {
    return evalInPreview(`(() => {
      const el = document.querySelector('[data-overlay-id="${overlayId}"]');
      if (!el) return null;
      return { zIndex: getComputedStyle(el).zIndex, track: el.getAttribute('data-akari-track'), display: getComputedStyle(el).display };
    })()`);
  }

  // ================= z-order BEFORE drag: ov-b(track1) in front of ov-a(track0) =================
  await scrollToTime(main, 2.5);
  await sleep(200);
  const zBefore = { a: await previewOverlayZIndex('ov-a'), b: await previewOverlayZIndex('ov-b') };
  record('z-order-before-drag', zBefore);
  assert(Number(zBefore.b.zIndex) > Number(zBefore.a.zIndex),
    'z-order precondition: ov-b (track1) starts in front of ov-a (track0)', zBefore);
  await shot(main, '03-overlap-before-drag.png');

  // ================= AC-3/AC-4/AC-5: drag ov-a from track0 up past the topmost row (track2) =================
  // overlayTrackAtClientY(): localY < topmost layout.top -> returns topmost.track + 1 (new track).
  const editBeforeDrag = await readJson(EDIT_JSON_PATH);
  const ovARect = await elementRect(main, '.akari-annotations-strip-overlay[data-akari-item-id="ov-a"]');
  const bandsBeforeDrag = await laneBandRects(main);
  const topBand = bandsBeforeDrag.reduce((min, b) => b.top < min.top ? b : min, bandsBeforeDrag[0]);
  const dragStartX = (ovARect.left + ovARect.right) / 2;
  const dragStartY = ovARect.top + ovARect.height / 2;
  const dragTargetY = topBand.top - 12; // above the current topmost row
  await dragSequence(main, [{ x: dragStartX, y: dragStartY }, { x: dragStartX, y: dragTargetY }]);
  await sleep(200);
  await dragRelease(main, dragStartX, dragTargetY);
  const footerBeforeTrackMove = await readFooter(main);
  await sleep(700);
  const editAfterDrag = await readJson(EDIT_JSON_PATH);
  const editAfterDragRaw = await readFile(EDIT_JSON_PATH, 'utf8');
  const ovAAfter = editAfterDrag.overlays.find(o => o.id === 'ov-a');
  const ovBAfter = editAfterDrag.overlays.find(o => o.id === 'ov-b');
  const ovCAfter = editAfterDrag.overlays.find(o => o.id === 'ov-c');
  record('AC3-AC4-drag-result', {
    before: editBeforeDrag.overlays.map(o => ({ id: o.id, track: o.track })),
    after: editAfterDrag.overlays.map(o => ({ id: o.id, track: o.track }))
  });
  assert(ovAAfter.track > editBeforeDrag.overlays.find(o => o.id === 'ov-a').track,
    'AC3: vertical drag increases ov-a track number (moved to a higher/frontmost row)', {
      before: editBeforeDrag.overlays.find(o => o.id === 'ov-a').track, after: ovAAfter.track
    });
  const maxTrackBefore = Math.max(...editBeforeDrag.overlays.map(o => o.track ?? 0));
  assert(ovAAfter.track === maxTrackBefore + 1,
    'AC4: dropping above the topmost row creates a new track = previous max + 1', {
      maxTrackBefore, newTrack: ovAAfter.track
    });
  // formatting/byte preservation outside the moved overlay's own "track"/"start" fields:
  // other overlays keep their ids and other fields verbatim.
  assert(ovBAfter.track === editBeforeDrag.overlays.find(o => o.id === 'ov-b').track
    && ovCAfter.track === editBeforeDrag.overlays.find(o => o.id === 'ov-c').track,
  'AC3: unrelated overlays (ov-b, ov-c) keep their track values across the write-back', {
    ovBAfter: ovBAfter.track, ovCAfter: ovCAfter.track
  });
  assert(editAfterDragRaw.includes('"id": "ov-a"') && editAfterDragRaw.includes('"id": "ov-b"'),
    'AC3: existing overlay ids remain textually present after the patch (string-patch discipline)');
  await shot(main, '04-after-track-drag.png');

  // ================= AC-5: z-order flips in the preview after the track change =================
  await connectPreview();
  await scrollToTime(main, 2.5);
  await sleep(300);
  const zAfter = { a: await previewOverlayZIndex('ov-a'), b: await previewOverlayZIndex('ov-b') };
  record('z-order-after-drag', zAfter);
  assert(Number(zAfter.a.zIndex) > Number(zAfter.b.zIndex),
    'AC5: after the track change, ov-a (now higher track) renders in front of ov-b in the preview', zAfter);
  await shot(main, '05-overlap-after-drag-flipped.png');

  // ================= AC-3 undo: restores edit.json to the pre-drag track assignment =================
  await focusWidgetToolbar(main);
  const footerBeforeUndo = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await waitFooterSettled(main, /元に戻しました/, footerBeforeUndo);
  const editAfterUndo = await readJson(EDIT_JSON_PATH);
  const ovAAfterUndo = editAfterUndo.overlays.find(o => o.id === 'ov-a');
  record('AC3-undo-restores-track', {
    expected: editBeforeDrag.overlays.find(o => o.id === 'ov-a').track, actual: ovAAfterUndo.track
  });
  assert(ovAAfterUndo.track === editBeforeDrag.overlays.find(o => o.id === 'ov-a').track,
    'AC3: undo restores ov-a to its pre-drag track', {
      expected: editBeforeDrag.overlays.find(o => o.id === 'ov-a').track, actual: ovAAfterUndo.track
    });
  await shot(main, '06-after-undo.png');

  // redo to leave the workspace in the moved state for the remaining track-header checks
  const footerBeforeRedo = await readFooter(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 12 });
  await waitFooterSettled(main, /やり直しました/, footerBeforeRedo);
  const editAfterRedo = await readJson(EDIT_JSON_PATH);
  assert(editAfterRedo.overlays.find(o => o.id === 'ov-a').track === ovAAfter.track,
    'AC3: redo re-applies the track change');

  // ================= AC-7: track eye toggle hides that track's overlays (timeline + preview) =================
  await connectPreview();
  const newTrackLane = `track-${ovAAfter.track}`;
  const trackButtonBefore = await trackHeaderButtonRect(main, newTrackLane);
  assert(Boolean(trackButtonBefore), 'track header eye button exists for the newly created track', { newTrackLane });
  await realClick(main, trackButtonBefore.x, trackButtonBefore.y);
  await sleep(300);
  const ovAItemStateHidden = await overlayItemState(main, 'ov-a');
  const bandsAfterHide = await laneBandRects(main);
  const hiddenBand = bandsAfterHide.find(b => b.lane === newTrackLane);
  record('AC7-track-eye-off-timeline', { ovAItemStateHidden, hiddenBand });
  assert(hiddenBand.hidden === true && Number(ovAItemStateHidden.opacity) === 0.28,
    'AC7: track eye OFF dims the timeline row and its overlay item', { hiddenBand, ovAItemStateHidden });
  const previewOvAHidden = await previewOverlayZIndex('ov-a');
  record('AC7-track-eye-off-preview', { previewOvAHidden });
  assert(previewOvAHidden.display === 'none', 'AC7: track eye OFF hides that track\'s overlay container in the preview', {
    previewOvAHidden
  });
  await shot(main, '07-track-hidden.png');
  // toggle back ON
  const trackButtonAfter = await trackHeaderButtonRect(main, newTrackLane);
  await realClick(main, trackButtonAfter.x, trackButtonAfter.y);
  await sleep(300);
  const previewOvAVisible = await previewOverlayZIndex('ov-a');
  assert(previewOvAVisible.display !== 'none', 'AC7: track eye back ON restores overlay visibility in the preview', {
    previewOvAVisible
  });

  // ================= AC-7: caption band eye toggle hides #caption-plate =================
  const captionsButton = await trackHeaderButtonRect(main, 'captions');
  await realClick(main, captionsButton.x, captionsButton.y);
  await sleep(300);
  const captionPlateHidden = await evalInPreview(`getComputedStyle(document.getElementById('caption-plate')).visibility`);
  record('AC7-captions-eye-off', { captionPlateHidden });
  assert(captionPlateHidden === 'hidden', 'AC7: captions eye OFF hides #caption-plate in the preview', { captionPlateHidden });
  await shot(main, '08-captions-hidden.png');
  const captionsButtonBack = await trackHeaderButtonRect(main, 'captions');
  await realClick(main, captionsButtonBack.x, captionsButtonBack.y);
  await sleep(300);
  const captionPlateVisible = await evalInPreview(`getComputedStyle(document.getElementById('caption-plate')).visibility`);
  assert(captionPlateVisible === 'visible', 'AC7: captions eye back ON restores #caption-plate visibility', {
    captionPlateVisible
  });

  // ================= AC-6: speaker mute toggle sets/unsets preview video.muted =================
  const speakerButton = await trackHeaderButtonRect(main, 'clips');
  await realClick(main, speakerButton.x, speakerButton.y);
  await sleep(300);
  const mutedTrue = await evalInPreview(`document.getElementById('preview-video').muted`);
  record('AC6-speaker-off', { mutedTrue });
  assert(mutedTrue === true, 'AC6: speaker OFF sets preview video.muted = true', { mutedTrue });
  await shot(main, '09-speaker-muted.png');
  const speakerButtonBack = await trackHeaderButtonRect(main, 'clips');
  await realClick(main, speakerButtonBack.x, speakerButtonBack.y);
  await sleep(300);
  const mutedFalse = await evalInPreview(`document.getElementById('preview-video').muted`);
  assert(mutedFalse === false, 'AC6: speaker back ON sets preview video.muted = false', { mutedFalse });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial-1.json'), JSON.stringify(log, null, 2));

  // ================= regression: timeline -> preview overlay selection =================
  // overlay-runtime (untouched) only marks a container selectable while it is within its
  // active [start, start+duration) timeline window (visibility:hidden otherwise, see
  // packages/overlay-runtime/src/overlay-runtime.js tick()). Seek the preview into ov-b's
  // window (timeline [2,4] -> source 3.0 under cut1 [0.5,3.5] mapped to timeline [0,3]) as
  // the LAST action before selecting it, so no later scroll/seek call can clobber it.
  await evalInPreview(`(() => { const v = document.getElementById('preview-video'); v.pause(); v.currentTime = 3.0; return true; })()`);
  await sleep(600);
  let previewSelection = null;
  let selectedItems = [];
  for (let attempt = 0; attempt < 3 && previewSelection !== 'ov-b'; attempt++) {
    const ovBRectForSelection = await elementRect(main, '.akari-annotations-strip-overlay[data-akari-item-id="ov-b"]');
    await realClick(main, (ovBRectForSelection.left + ovBRectForSelection.right) / 2,
      ovBRectForSelection.top + ovBRectForSelection.height / 2);
    await sleep(700);
    previewSelection = await evalInPreview(`(() => {
      const selected = document.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
      return selected ? selected.getAttribute('data-overlay-id') : null;
    })()`);
    selectedItems = await selectedTimelineItems(main);
  }
  record('regression-selection-sync', { previewSelection, selectedItems });
  assert(previewSelection === 'ov-b' && selectedItems.length === 1 && selectedItems[0].id === 'ov-b',
    'regression: timeline overlay selection reflects into the preview webview', { previewSelection, selectedItems });
  await shot(main, '10-selection-sync.png');
  await focusWidgetToolbar(main);
  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);

  // ================= regression: caption copy/paste (one round trip) =================
  const captionRect = await elementRect(main, '.akari-annotations-strip-caption', 0);
  await realClick(main, (captionRect.left + captionRect.right) / 2, captionRect.top + captionRect.height / 2);
  await sleep(200);
  await focusWidgetToolbar(main);
  await keyPress(main, { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 4 });
  await sleep(100);
  const captionPasteX = await screenXForTime(main, 9.5);
  const stateForCaptionPaste = await widgetState(main);
  await realClick(main, captionPasteX, stateForCaptionPaste.stripRect.top + 7);
  await sleep(150);
  const footerBeforeCaptionPaste = await readFooter(main);
  await focusWidgetToolbar(main);
  await keyPress(main, { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 4 });
  await waitFooterSettled(main, /字幕をペーストしました/, footerBeforeCaptionPaste);
  const captionsAfterPaste = await readJson(CAPTIONS_JSON_PATH);
  const pastedCaption = captionsAfterPaste.find(c => c.id !== 'caption-a' && c.id !== 'caption-b');
  record('regression-caption-paste', { pastedCaption });
  assert(Boolean(pastedCaption), 'regression: caption paste inserts a new caption', { pastedCaption });
  const footerBeforeCaptionUndo = await readFooter(main);
  await focusWidgetToolbar(main);
  await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await waitFooterSettled(main, /元に戻しました/, footerBeforeCaptionUndo);
  const captionsAfterUndo = await readJson(CAPTIONS_JSON_PATH);
  assert(!captionsAfterUndo.some(c => c.id === pastedCaption.id),
    'regression: caption paste undo removes the inserted caption (one round trip complete)');
  await shot(main, '11-caption-paste-undo.png');

  // ================= regression: caption horizontal drag =================
  const captionsBeforeDrag = await readJson(CAPTIONS_JSON_PATH);
  const captionRectForDrag = await elementRect(main, '.akari-annotations-strip-caption', 0);
  const capDragStartX = (captionRectForDrag.left + captionRectForDrag.right) / 2;
  const capDragY = captionRectForDrag.top + captionRectForDrag.height / 2;
  const footerBeforeCapDrag = await readFooter(main);
  await dragSequence(main, [{ x: capDragStartX, y: capDragY }, { x: capDragStartX + 45, y: capDragY }]);
  await dragRelease(main, capDragStartX + 45, capDragY);
  await waitFooterSettled(main, /字幕のタイミングを調整しました/, footerBeforeCapDrag);
  const captionsAfterDrag = await readJson(CAPTIONS_JSON_PATH);
  record('regression-caption-horizontal-drag', {
    before: captionsBeforeDrag[0].start, after: captionsAfterDrag[0].start
  });
  assert(captionsAfterDrag[0].start !== captionsBeforeDrag[0].start,
    'regression: caption horizontal drag changes captions[0].start', {
      before: captionsBeforeDrag[0].start, after: captionsAfterDrag[0].start
    });
  await shot(main, '12-caption-drag.png');

  // ================= regression: zoom HUD (ctrl+wheel keeps cursor time fixed) =================
  const sZoom0 = await widgetState(main);
  const cursorOffsetPx = Math.round(sZoom0.stripRect.width * 0.4);
  const cursorScreenX = sZoom0.stripRect.left + cursorOffsetPx;
  const cursorScreenY = sZoom0.stripRect.top + sZoom0.stripRect.height / 2;
  const cursorContentPxBefore = sZoom0.scrollLeft + cursorOffsetPx;
  const timeBefore = (cursorContentPxBefore / sZoom0.contentWidthPx) * TOTAL_DURATION;
  for (let i = 0; i < 3; i++) {
    await wheel(main, cursorScreenX, cursorScreenY, 0, -400, { ctrlKey: true });
    await sleep(120);
  }
  const sZoom1 = await widgetState(main);
  const cursorContentPxAfter = sZoom1.scrollLeft + cursorOffsetPx;
  const timeAfter = (cursorContentPxAfter / sZoom1.contentWidthPx) * TOTAL_DURATION;
  const visibleDurationAfter = (sZoom1.clientWidth / sZoom1.contentWidthPx) * TOTAL_DURATION;
  const threshold = visibleDurationAfter * 0.02;
  const cursorTimeError = Math.abs(timeAfter - timeBefore);
  record('regression-zoom-hud', { cursorTimeError, threshold, contentBefore: sZoom0.contentWidthPx, contentAfter: sZoom1.contentWidthPx });
  assert(sZoom1.contentWidthPx > sZoom0.contentWidthPx, 'regression: ctrl+wheel zoomed in (content width grew)');
  assert(cursorTimeError <= threshold, 'regression: ctrl+wheel zoom keeps cursor time fixed within 2% of visible width', {
    cursorTimeError, threshold
  });
  await shot(main, '13-zoom-hud.png');

  // ================= regression: preview playback -> timeline playhead sync (one measurement) =================
  await connectPreview();
  const playbackStart = editAfterRedo.cuts[editAfterRedo.cuts.length - 1].in;
  // このサンドボックス実行環境には音声出力デバイスが無く、音声トラック有りのまま play() すると
  // Chromium のメディアクロックが進行せず currentTime が静止することを timeline-sync-undo で実測済み。
  // tick()/playheadT 同期ロジックは video.currentTime/paused のみを参照し muted を見ないため、
  // 検証ドライバ側でのみ mute して環境要因を回避する（製品コード無変更）。
  await evalInPreview(`(() => { const v = document.getElementById('preview-video'); v.pause(); v.muted = true; v.currentTime = ${playbackStart}; return true; })()`);
  await sleep(200);
  await scrollToTime(main, playbackStart);
  await sleep(150);
  await evalInPreview(`(() => { document.getElementById('preview-video').play(); return true; })()`);
  const before = await widgetState(main);
  await sleep(1200);
  const [after, previewTime] = await Promise.all([
    widgetState(main),
    evalInPreview(`document.getElementById('preview-video').currentTime`)
  ]);
  await evalInPreview(`(() => { document.getElementById('preview-video').pause(); return true; })()`);
  record('regression-playback-sync', {
    beforePlayheadPx: before.playheadLeftPx, afterPlayheadPx: after.playheadLeftPx, previewTime
  });
  assert(after.playheadLeftPx > before.playheadLeftPx,
    'regression: timeline playhead advances during preview playback', {
      before: before.playheadLeftPx, after: after.playheadLeftPx
    });
  await shot(main, '14-playback-sync.png');

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
