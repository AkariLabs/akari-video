#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins: fetch, WebSocket) raw-CDP driver verifying
// keep-range gapless playback (2026-07-20-preview-consume-cuts).
//
// Usage: node verify.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9345);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'exports', 'edit.json');
const VIDEO_REL_PATH = 'exports/sample.mp4';

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function fail(message, data) {
  record('FAIL:' + message, data || {});
  throw new Error(message);
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.listeners.get(msg.method) || []) h(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
  close() { this.ws.close(); }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

async function evalMain(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evalMain failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function evalIn(cdp, contextId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evalIn failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clicks; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    if (count < clicks) await sleep(60);
  }
}

async function screenshot(cdp, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

// --- resolve the inner active-frame execution context for the akari-preview webview ---
async function resolveActiveFrame(main, priorContextId) {
  let outerTarget = null;
  for (let attempt = 0; attempt < 20 && !outerTarget; attempt++) {
    const targets = await listTargets();
    outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html/.test(t.url));
    if (!outerTarget) await sleep(300);
  }
  if (!outerTarget) throw new Error('outer webview CDP target not found');

  const outer = new CDP(outerTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');

  let activeCtx;
  for (let attempt = 0; attempt < 30; attempt++) {
    const frameTree = await outer.send('Page.getFrameTree');
    const topFrameId = frameTree.frameTree.frame.id;
    activeCtx = contexts.find(c => c.auxData?.frameId && c.auxData.frameId !== topFrameId
      && (!priorContextId || c.id !== priorContextId));
    if (activeCtx) break;
    await sleep(300);
  }
  if (!activeCtx) throw new Error('inner active-frame execution context not found');
  return { outer, contextId: activeCtx.id, outerTarget };
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const targets0 = await listTargets();
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const mainCdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await mainCdp.connect();
  await mainCdp.send('Page.enable');
  await mainCdp.send('Runtime.enable');
  await mainCdp.send('DOM.enable');
  record('connected-main', { targetId: mainTarget.id });
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  // ---- open Explorer ----
  const explorerState = await evalMain(mainCdp, `(() => {
    const anyRow = document.querySelector('.theia-TreeNode');
    const alreadyOpen = !!(anyRow && anyRow.getBoundingClientRect().width > 0);
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    const r = el.getBoundingClientRect();
    return { alreadyOpen, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!explorerState.alreadyOpen) {
    await realClick(mainCdp, explorerState.x, explorerState.y);
    await sleep(500);
  }
  record('opened-explorer', explorerState);

  const videoDir = path.dirname(VIDEO_REL_PATH).split('/')[0];
  const videoBase = path.basename(VIDEO_REL_PATH);
  const findRow = (label) => evalMain(mainCdp, `(() => {
    const rows = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]'));
    const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(label)});
    if (!row) return { found: false };
    const r = row.getBoundingClientRect();
    const collapsed = !!row.querySelector('.theia-mod-collapsed');
    return { found: true, collapsed, x: r.left + 20, y: r.top + r.height / 2 };
  })()`);

  const folderRow = await findRow(videoDir);
  if (!folderRow.found) throw new Error(`tree row for folder "${videoDir}" not found`);
  if (folderRow.collapsed) {
    await realClick(mainCdp, folderRow.x, folderRow.y, { clickCount: 2 });
    await sleep(500);
  }
  record('expanded-folder', { videoDir, ...folderRow });

  const fileRow = await findRow(videoBase);
  if (!fileRow.found) throw new Error(`tree row for file "${videoBase}" not found`);
  await realClick(mainCdp, fileRow.x, fileRow.y, { clickCount: 2 });
  await sleep(1800);
  record('opened-video-tab', { videoBase, ...fileRow });
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '01-preview-opened.png'));

  let { outer, contextId } = await resolveActiveFrame(mainCdp);
  record('reached-active-frame-context-initial', { contextId });

  // wait for metadata + our mount-time snap-to-first-keep-range to settle
  await sleep(1200);

  // ============================================================
  // PHASE A: initial fixture (cuts=[[2,6],[12,15],[20,24]], overlay start=1 dur=2 timeline)
  // ============================================================
  const phaseAInit = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    const seek = document.getElementById('seek');
    return {
      readyState: video.readyState,
      currentTime: video.currentTime,
      duration: video.duration,
      seekMax: seek.max,
      cuts: (window.__akariPreview && window.__akariPreview.summary && window.__akariPreview.summary.cuts) || null
    };
  })()`);
  record('phaseA-initial-state', phaseAInit);
  if (Math.abs(phaseAInit.currentTime - 2.0) > 0.05) {
    fail('initial currentTime did not snap to first keep-range in (expected ~2.0)', phaseAInit);
  }
  if (Math.abs(Number(phaseAInit.seekMax) - 11) > 0.05) {
    fail('seek.max did not reflect total timeline duration (expected ~11)', phaseAInit);
  }

  // ---- sample currentTime while playing through the whole timeline at high rate ----
  const sampleResult = await evalIn(outer, contextId, `(() => {
    return new Promise((resolve) => {
      const video = document.getElementById('preview-video');
      const samples = [];
      video.playbackRate = 4;
      video.play();
      const started = performance.now();
      const tick = () => {
        samples.push(Number(video.currentTime.toFixed(3)));
        if (video.paused || performance.now() - started > 12000) {
          resolve({ samples, endedPaused: video.paused, finalTime: video.currentTime });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  })()`);
  record('phaseA-playback-samples', {
    count: sampleResult.samples.length,
    finalTime: sampleResult.finalTime,
    endedPaused: sampleResult.endedPaused,
    firstTen: sampleResult.samples.slice(0, 10),
    lastTen: sampleResult.samples.slice(-10)
  });
  await writeFile(path.join(EVIDENCE_DIR, 'phaseA-samples.json'), JSON.stringify(sampleResult.samples, null, 2));

  const KEEP_RANGES_A = [[2, 6], [12, 15], [20, 24]];
  const outOfRange = sampleResult.samples.filter(t => !KEEP_RANGES_A.some(([a, b]) => t >= a - 0.15 && t < b + 0.15));
  record('phaseA-out-of-range-check', { outOfRangeCount: outOfRange.length, outOfRangeSample: outOfRange.slice(0, 20) });
  if (outOfRange.length > 0) {
    fail('samples found outside every keep-range (a cut-out region was played)', { outOfRange: outOfRange.slice(0, 20) });
  }
  if (!sampleResult.endedPaused) {
    fail('playback did not stop after the last keep-range out boundary', sampleResult);
  }
  if (Math.abs(sampleResult.finalTime - 24.0) > 0.2) {
    fail('final paused time is not at the last cut out boundary (expected ~24.0)', sampleResult);
  }
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '02-after-full-playthrough.png'));

  // ---- overlay + caption timeline-domain correctness (re-seek into windows) ----
  const overlayCheck = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    video.pause();
    return new Promise(resolve => {
      const results = {};
      const check = (label, sourceTime, cb) => new Promise(res => {
        video.currentTime = sourceTime;
        video.addEventListener('seeked', function handler() {
          video.removeEventListener('seeked', handler);
          // The page's own internal 'seeked' listener (registered earlier, inside
          // previewBootstrapScript) already ran synchronously before this one and
          // performed the timeline-domain tick()/overlay/caption update. We only
          // need to wait a tick and read the resulting DOM state.
          setTimeout(() => {
            const container = document.querySelector('[data-overlay-id="ov-a"]');
            const caption = document.getElementById('caption-plate');
            res({ label, sourceTime: video.currentTime, overlayVisible: container ? getComputedStyle(container).visibility : 'no-container', captionText: caption ? caption.textContent : null });
          }, 60);
        }, { once: true });
      });
      (async () => {
        results.beforeOverlayWindow = await check('source=2.5 (timeline=0.5, before overlay window [1,3))', 2.5);
        results.insideOverlayWindow = await check('source=3.5 (timeline=1.5, inside overlay window [1,3) and caption [3,4))', 3.5);
        results.afterOverlayWindow = await check('source=5.5 (timeline=3.5, after overlay window)', 5.5);
        results.insideCaption2 = await check('source=13.5 (inside cap-in-cut2 [13,14))', 13.5);
        resolve(results);
      })();
    });
  })()`);
  record('phaseA-overlay-caption-timeline-domain', overlayCheck);
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '03-overlay-caption-window.png'));

  if (overlayCheck.beforeOverlayWindow.overlayVisible !== 'hidden') {
    fail('overlay visible before its timeline window (source=2.5, timeline=0.5 < start=1)', overlayCheck.beforeOverlayWindow);
  }
  if (overlayCheck.insideOverlayWindow.overlayVisible !== 'visible') {
    fail('overlay not visible inside its timeline window (source=3.5, timeline=1.5 in [1,3))', overlayCheck.insideOverlayWindow);
  }
  if (overlayCheck.afterOverlayWindow.overlayVisible !== 'hidden') {
    fail('overlay still visible after its timeline window (source=5.5, timeline=3.5 >= 3)', overlayCheck.afterOverlayWindow);
  }
  if (overlayCheck.insideOverlayWindow.captionText !== 'cap-in-cut1') {
    fail('caption text incorrect at source=3.5 (expected cap-in-cut1, source-anchored)', overlayCheck.insideOverlayWindow);
  }
  if (overlayCheck.insideCaption2.captionText !== 'cap-in-cut2') {
    fail('caption text incorrect at source=13.5 (expected cap-in-cut2)', overlayCheck.insideCaption2);
  }

  // ---- seek bar: timeline-domain seeking maps to correct source position ----
  const seekBarCheck = await evalIn(outer, contextId, `(() => {
    return new Promise(resolve => {
      const video = document.getElementById('preview-video');
      const seek = document.getElementById('seek');
      video.pause();
      // timeline 5.5 -> segment1 [4,7) offset within seg = 1.5 -> source = 12 + 1.5 = 13.5
      seek.value = '5.5';
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      video.addEventListener('seeked', function handler() {
        video.removeEventListener('seeked', handler);
        resolve({ seekValue: seek.value, currentTime: video.currentTime });
      }, { once: true });
    });
  })()`);
  record('phaseA-seekbar-timeline-to-source', seekBarCheck);
  if (Math.abs(seekBarCheck.currentTime - 13.5) > 0.1) {
    fail('seek bar timeline->source mapping incorrect (expected currentTime ~13.5)', seekBarCheck);
  }

  // ---- external seek contract (source seconds unchanged) ----
  const externalSeekCheck = await evalIn(outer, contextId, `(() => {
    return new Promise(resolve => {
      const video = document.getElementById('preview-video');
      video.pause();
      video.addEventListener('seeked', function handler() {
        video.removeEventListener('seeked', handler);
        resolve({ currentTime: video.currentTime });
      }, { once: true });
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'akari-preview-seek', time: 13.0 } }));
    });
  })()`);
  record('phaseA-external-seek-source-domain', externalSeekCheck);
  if (Math.abs(externalSeekCheck.currentTime - 13.0) > 0.05) {
    fail('external akari-preview-seek must set currentTime directly to the given source seconds (contract unchanged)', externalSeekCheck);
  }

  // ---- space-bar play/pause non-regression ----
  const spaceCheck = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    const wasPaused = video.paused;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    return new Promise(resolve => setTimeout(() => resolve({ wasPaused, isPausedAfter: video.paused }), 250));
  })()`);
  record('phaseA-space-toggle', spaceCheck);
  if (spaceCheck.wasPaused === spaceCheck.isPausedAfter) {
    fail('space bar did not toggle playback state', spaceCheck);
  }
  // ensure paused before next phase (avoid interference across reload)
  await evalIn(outer, contextId, `(() => { document.getElementById('preview-video').pause(); return true; })()`);

  // ============================================================
  // PHASE B: trim cut1.out 6.0 -> 4.0 (new boundary should be honored)
  // ============================================================
  const editBefore = await readFile(EDIT_JSON_PATH, 'utf8');
  const editB = JSON.parse(editBefore);
  editB.cuts[0].out = 4.0;
  await writeFile(EDIT_JSON_PATH, JSON.stringify(editB, null, 2) + '\n');
  record('phaseB-wrote-trim', { newCut0: editB.cuts[0] });

  ({ outer, contextId } = await resolveActiveFrame(mainCdp, contextId));
  record('phaseB-reached-active-frame-context', { contextId });
  await sleep(800);

  const phaseBState = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    const seek = document.getElementById('seek');
    return { currentTime: video.currentTime, seekMax: seek.max, cuts: window.__akariPreview.summary.cuts };
  })()`);
  record('phaseB-post-reload-state', phaseBState);
  if (Math.abs(Number(phaseBState.seekMax) - 9) > 0.1) {
    fail('after trim, seek.max should reflect new total (2+3+4=9)', phaseBState);
  }

  const phaseBPlay = await evalIn(outer, contextId, `(() => {
    return new Promise((resolve) => {
      const video = document.getElementById('preview-video');
      const samples = [];
      video.playbackRate = 4;
      video.currentTime = 3.5; // inside the now-shrunk segment0 [2,4)
      video.addEventListener('seeked', function onSeek() {
        video.removeEventListener('seeked', onSeek);
        video.play();
        const started = performance.now();
        const tick = () => {
          samples.push(Number(video.currentTime.toFixed(3)));
          if (video.paused || performance.now() - started > 4000) {
            resolve({ samples });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { once: true });
    });
  })()`);
  record('phaseB-boundary-jump-samples', { samples: phaseBPlay.samples });
  const jumpedPastOldBoundary = phaseBPlay.samples.some(t => t > 4.3 && t < 11.7);
  if (jumpedPastOldBoundary) {
    fail('playback entered the old [4,6) region that should now be cut out after trim', phaseBPlay);
  }
  const reachedSegment2 = phaseBPlay.samples.some(t => t >= 11.85 && t < 15.15);
  if (!reachedSegment2) {
    fail('playback did not skip forward from the new (trimmed) boundary at source=4.0 to segment2 [12,15)', phaseBPlay);
  }
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '04-after-trim-boundary.png'));
  await evalIn(outer, contextId, `(() => { document.getElementById('preview-video').pause(); return true; })()`);

  // ============================================================
  // PHASE C: reorder cuts array (move segment0 [2,4) to the end)
  // ============================================================
  const editC = JSON.parse(await readFile(EDIT_JSON_PATH, 'utf8'));
  const reordered = [editC.cuts[1], editC.cuts[2], editC.cuts[0]];
  editC.cuts = reordered;
  await writeFile(EDIT_JSON_PATH, JSON.stringify(editC, null, 2) + '\n');
  record('phaseC-wrote-reorder', { newCutsOrder: reordered });

  ({ outer, contextId } = await resolveActiveFrame(mainCdp, contextId));
  record('phaseC-reached-active-frame-context', { contextId });
  await sleep(800);

  const phaseCInit = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    return { currentTime: video.currentTime, cuts: window.__akariPreview.summary.cuts };
  })()`);
  record('phaseC-post-reload-state', phaseCInit);
  if (Math.abs(phaseCInit.currentTime - 12.0) > 0.05) {
    fail('after reorder, initial position should snap to the NEW first segment in (expected 12.0, the old segment1)', phaseCInit);
  }

  const phaseCPlay = await evalIn(outer, contextId, `(() => {
    return new Promise((resolve) => {
      const video = document.getElementById('preview-video');
      const samples = [];
      video.playbackRate = 4;
      video.play();
      const started = performance.now();
      const tick = () => {
        samples.push(Number(video.currentTime.toFixed(3)));
        if (video.paused || performance.now() - started > 9000) {
          resolve({ samples, endedPaused: video.paused, finalTime: video.currentTime });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  })()`);
  await writeFile(path.join(EVIDENCE_DIR, 'phaseC-samples.json'), JSON.stringify(phaseCPlay.samples, null, 2));
  record('phaseC-reordered-playback-summary', {
    count: phaseCPlay.samples.length,
    finalTime: phaseCPlay.finalTime,
    endedPaused: phaseCPlay.endedPaused,
    first: phaseCPlay.samples[0],
    last: phaseCPlay.samples[phaseCPlay.samples.length - 1]
  });
  const KEEP_RANGES_C = [[12, 15], [20, 24], [2, 4]];
  const outOfRangeC = phaseCPlay.samples.filter(t => !KEEP_RANGES_C.some(([a, b]) => t >= a - 0.15 && t < b + 0.15));
  if (outOfRangeC.length > 0) {
    fail('reordered playback left the (reordered) keep-ranges', { sample: outOfRangeC.slice(0, 20) });
  }
  // find the first sample that's in the [2,4) range (was the LAST played originally, now plays third/last)
  const firstIndexInLastSeg = phaseCPlay.samples.findIndex(t => t >= 1.85 && t < 4.15);
  const firstIndexInSecondSeg = phaseCPlay.samples.findIndex(t => t >= 19.85 && t < 24.15);
  if (firstIndexInLastSeg === -1 || firstIndexInSecondSeg === -1 || firstIndexInLastSeg < firstIndexInSecondSeg) {
    fail('reordered segment [2,4) (moved to end of array) did not play AFTER [20,24) as the new array order requires', {
      firstIndexInLastSeg, firstIndexInSecondSeg
    });
  }
  if (Math.abs(phaseCPlay.finalTime - 4.0) > 0.2) {
    fail('reordered playback did not end at the new last segment out boundary (expected ~4.0)', phaseCPlay);
  }
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '05-after-reorder.png'));
  await evalIn(outer, contextId, `(() => { document.getElementById('preview-video').pause(); return true; })()`);

  // ============================================================
  // PHASE D: cuts = [] (backward-compat: full playback, no skipping)
  // ============================================================
  const editD = JSON.parse(await readFile(EDIT_JSON_PATH, 'utf8'));
  editD.cuts = [];
  await writeFile(EDIT_JSON_PATH, JSON.stringify(editD, null, 2) + '\n');
  record('phaseD-wrote-empty-cuts', {});

  ({ outer, contextId } = await resolveActiveFrame(mainCdp, contextId));
  record('phaseD-reached-active-frame-context', { contextId });
  await sleep(1200); // loadedmetadata needs to fire to know duration for the fallback range

  const phaseDState = await evalIn(outer, contextId, `(() => {
    const video = document.getElementById('preview-video');
    const seek = document.getElementById('seek');
    return { currentTime: video.currentTime, seekMax: seek.max, duration: video.duration };
  })()`);
  record('phaseD-post-reload-state', phaseDState);
  if (Math.abs(Number(phaseDState.seekMax) - 30) > 0.5) {
    fail('with cuts=[], seek.max should reflect full source duration (~30s)', phaseDState);
  }

  const phaseDPlay = await evalIn(outer, contextId, `(() => {
    return new Promise((resolve) => {
      const video = document.getElementById('preview-video');
      video.currentTime = 8.0; // this WAS a cut-out gap in phase A - now must play fine (no skip)
      video.addEventListener('seeked', function onSeek() {
        video.removeEventListener('seeked', onSeek);
        video.playbackRate = 4;
        video.play();
        const samples = [];
        const started = performance.now();
        const tick = () => {
          samples.push(Number(video.currentTime.toFixed(3)));
          if (performance.now() - started > 3000) {
            video.pause();
            resolve({ samples });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { once: true });
    });
  })()`);
  record('phaseD-full-playback-samples', { first: phaseDPlay.samples[0], last: phaseDPlay.samples[phaseDPlay.samples.length - 1] });
  const monotonicNoSkip = phaseDPlay.samples.every((t, i) => i === 0 || t >= phaseDPlay.samples[i - 1] - 0.01);
  const staysNear8to20 = phaseDPlay.samples[phaseDPlay.samples.length - 1] > 9 && phaseDPlay.samples[phaseDPlay.samples.length - 1] < 22;
  if (!monotonicNoSkip || !staysNear8to20) {
    fail('with cuts=[], playback around former gap (source=8) should progress continuously without any skip', phaseDPlay);
  }
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '06-empty-cuts-full-playback.png'));

  record('ALL-PASS', { ok: true });
  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: all keep-range consume-cuts checks passed.');
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
