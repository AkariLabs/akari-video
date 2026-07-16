#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only: fetch, WebSocket) raw-CDP driver that
// exercises the AKARI Video preview-tab inspector write-back path end-to-end,
// piercing the Theia WebviewWidget double iframe (outer `webview/index.html`
// target -> inner `active-frame`) with genuine hit-tested mouse/keyboard input.
//
// Usage:
//   node run-inspector-writeback-e2e.mjs <cdpPort> <workspaceDir> <videoRelPath> <evidenceDir>
//
// Requires: an already-running Electron instance of apps/shell with
// --remote-debugging-port=<cdpPort>, opened on <workspaceDir>. See ../README.md
// for the full setup (fixture creation, electron launch command, prerequisites).
//
// Assumes a fixture edit.json next to the video with exactly one overlay whose
// id is "cap-a" and which declares a "--color" var (see ../README.md to generate
// one). Adjust OVERLAY_ID / OVERLAY_VAR below to point at a different fixture.

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , cdpPortArg, workspaceDirArg, videoRelPathArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const WORKSPACE_DIR = workspaceDirArg || '/tmp/akari-s12-e2e-scratch/workspace';
const VIDEO_REL_PATH = videoRelPathArg || 'exports/sample.mp4';
const EVIDENCE_DIR = evidenceDirArg || '/tmp/akari-s12-e2e-scratch/evidence';
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, path.dirname(VIDEO_REL_PATH), 'edit.json');
const OVERLAY_ID = 'cap-a';
const OVERLAY_VAR = '--color';

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
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
  // Chromium's double-click detection needs two full press/release cycles in
  // quick succession (clickCount 1 then 2) - a single pair carrying clickCount:2
  // does NOT register as a dblclick and will not expand/open tree rows.
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

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });

  // ---- 0. connect to the main Theia frontend page target ----
  const targets0 = await listTargets();
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');
  record('connected-main', { targetId: mainTarget.id });

  await screenshot(main, path.join(EVIDENCE_DIR, '00-boot.png'));

  // ---- 1. open the Explorer (file icon in the activity bar) via a real click ----
  // NOTE: the activity bar icon TOGGLES the panel - clicking it while the
  // Explorer is already open will close it. Only click if it is not visible yet.
  const explorerState = await evalMain(main, `(() => {
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

  // ---- 2. expand the folder containing the video, via a real double-click on the tree row ----
  // (idempotent: a tree row is a toggle, so only double-click while collapsed)
  const videoDir = path.dirname(VIDEO_REL_PATH).split('/')[0];
  const videoBase = path.basename(VIDEO_REL_PATH);
  const findRow = (label) => evalMain(main, `(() => {
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
    await realClick(main, folderRow.x, folderRow.y, { clickCount: 2 });
    await sleep(500);
  }
  record('expanded-folder', { videoDir, ...folderRow });

  // ---- 3. double-click the video file row to open it in the akari-preview tab ----
  const fileRow = await findRow(videoBase);
  if (!fileRow.found) throw new Error(`tree row for file "${videoBase}" not found`);
  await realClick(main, fileRow.x, fileRow.y, { clickCount: 2 });
  await sleep(1500);
  record('opened-video-tab', { videoBase, ...fileRow });
  await screenshot(main, path.join(EVIDENCE_DIR, '01-preview-opened.png'));

  // ---- 4. locate the webview's outer CDP target (its own attachable "iframe" target) ----
  let outerTarget = null;
  for (let attempt = 0; attempt < 10 && !outerTarget; attempt++) {
    const targets = await listTargets();
    outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html/.test(t.url));
    if (!outerTarget) await sleep(300);
  }
  if (!outerTarget) throw new Error('outer webview CDP target not found (double-iframe not created?)');
  record('found-outer-webview-target', { id: outerTarget.id, url: outerTarget.url });

  const outer = new CDP(outerTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(400);

  const frameTree = await outer.send('Page.getFrameTree');
  const topFrameId = frameTree.frameTree.frame.id;
  const childFrames = (frameTree.frameTree.childFrames || []).map(c => c.frame);
  const activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
  if (!activeCtx) throw new Error('inner active-frame execution context not found');
  record('reached-active-frame-context', {
    outerFrameId: topFrameId,
    childFrames: childFrames.map(f => ({ id: f.id, name: f.name })),
    activeContextId: activeCtx.id,
  });

  // ---- 5. seek into the overlay's active time window and confirm it renders ----
  const seekResult = await evalIn(outer, activeCtx.id, `(() => {
    const video = document.getElementById('preview-video');
    video.pause();
    video.currentTime = 2;
    return new Promise(resolve => {
      video.addEventListener('seeked', function handler() {
        video.removeEventListener('seeked', handler);
        window.akari.runtime.tick(video.currentTime, false);
        const container = document.querySelector('[data-overlay-id="${OVERLAY_ID}"]');
        resolve({ currentTime: video.currentTime, visibility: container ? getComputedStyle(container).visibility : 'no-container' });
      }, { once: true });
    });
  })()`);
  record('seeked-into-overlay-window', seekResult);
  await screenshot(main, path.join(EVIDENCE_DIR, '02-overlay-visible.png'));

  // ---- 6. real, hit-tested mouse click on the visible overlay fragment (not the full-stage container) ----
  const fragmentRect = await evalIn(outer, activeCtx.id, `(() => {
    const container = document.querySelector('[data-overlay-id="${OVERLAY_ID}"]');
    const fragment = container.firstElementChild;
    const r = fragment.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  })()`);
  const clickX = (fragmentRect.left + fragmentRect.right) / 2;
  const clickY = (fragmentRect.top + fragmentRect.bottom) / 2;
  await realClick(outer, clickX, clickY);
  await sleep(300);
  const selection = await evalIn(outer, activeCtx.id, `(() => {
    const container = document.querySelector('[data-overlay-id="${OVERLAY_ID}"]');
    const inspector = document.getElementById('inspector');
    return {
      selected: container.getAttribute('data-akari-interaction-selected'),
      inspectorHidden: inspector.hidden,
      inspectorFieldsText: document.getElementById('inspector-fields').textContent,
    };
  })()`);
  record('real-click-selected-overlay', { fragmentRect, clickX, clickY, selection });
  if (selection.selected !== 'true') {
    throw new Error('overlay was not selected after a real, hit-tested click through the double iframe');
  }
  // Snapshot edit.json now: the write-back fires on a 200ms debounce timer
  // after typing (see interaction.js persist()), not only on blur - so this
  // must be read before typing, not right before the blur click.
  const editJsonBefore = await readFile(EDIT_JSON_PATH, 'utf8');
  await screenshot(main, path.join(EVIDENCE_DIR, '03-overlay-selected-inspector-open.png'));

  // ---- 7. real focus + keyboard selection + real text insertion into the --color field ----
  const inputRect = await evalIn(outer, activeCtx.id, `(() => {
    const input = document.querySelector('#inspector-fields input[aria-label="${OVERLAY_VAR}"]');
    const r = input.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, valueBefore: input.value };
  })()`);
  const inputX = (inputRect.left + inputRect.right) / 2;
  const inputY = (inputRect.top + inputRect.bottom) / 2;
  await realClick(outer, inputX, inputY);
  await sleep(150);

  await outer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  await outer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  await outer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 8 });
  await outer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 8 });
  await sleep(100);

  const NEW_VALUE = '#00c853';
  await outer.send('Input.insertText', { text: NEW_VALUE });
  await sleep(350);
  const afterType = await evalIn(outer, activeCtx.id, `(() => {
    const input = document.querySelector('#inspector-fields input[aria-label="${OVERLAY_VAR}"]');
    const container = document.querySelector('[data-overlay-id="${OVERLAY_ID}"]');
    return { value: input.value, liveCssVar: container.style.getPropertyValue('${OVERLAY_VAR}') };
  })()`);
  record('real-keyboard-edit', { inputRect, inputX, inputY, newValue: NEW_VALUE, afterType });
  await screenshot(main, path.join(EVIDENCE_DIR, '04-value-typed.png'));

  // ---- 8. blur via a real click elsewhere -> native 'change' event -> persist() again (idempotent) ----
  const videoRect = await evalIn(outer, activeCtx.id, `(() => {
    const v = document.getElementById('preview-video');
    const r = v.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + 10 };
  })()`);
  await realClick(outer, videoRect.x, videoRect.y);
  await sleep(500);
  await screenshot(main, path.join(EVIDENCE_DIR, '05-after-blur-writeback.png'));

  const editJsonAfter = await readFile(EDIT_JSON_PATH, 'utf8');
  const beforeVars = JSON.parse(editJsonBefore).overlays.find(o => o.id === OVERLAY_ID).vars;
  const afterVars = JSON.parse(editJsonAfter).overlays.find(o => o.id === OVERLAY_ID).vars;
  record('edit-json-diff', { path: EDIT_JSON_PATH, beforeVars, afterVars });

  await writeFile(path.join(EVIDENCE_DIR, 'edit-before.json'), editJsonBefore);
  await writeFile(path.join(EVIDENCE_DIR, 'edit-after.json'), editJsonAfter);

  const ok = afterVars[OVERLAY_VAR] === NEW_VALUE && beforeVars[OVERLAY_VAR] !== afterVars[OVERLAY_VAR];
  record('result', { ok, expected: NEW_VALUE, actual: afterVars[OVERLAY_VAR] });

  outer.close();
  main.close();

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  if (!ok) {
    console.error('FAILED: edit.json did not reflect the new value written through the double-iframe UI chain.');
    process.exit(1);
  }
  console.log('SUCCESS: full UI-driven chain (double-click open -> seek -> click-select -> keyboard-edit -> blur) reached edit.json.');
}

main().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});
