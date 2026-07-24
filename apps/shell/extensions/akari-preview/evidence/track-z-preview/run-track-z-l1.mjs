#!/usr/bin/env node
// r5c-track-z L1 実機 CDP 検証（ラッパー作成・検証専用スクリプト）。
// Dependency-free raw-CDP driver (Node built-in fetch/WebSocket), preview-consume-cuts の
// run-consume-cuts-e2e.mjs と同じ流儀。実 Electron を起動し、交互スタック fixture
// （exports/source.mp4 = 前半緑・後半青の単一ソース + exports/telop.mov の不透明黄テロップ）
// を開いて、#preview-video / layer video の z-index が deriveTracks 由来の順序どおりに
// 決まっていること、およびスクリーンショットで実際に前面が入れ替わっていることを確認する。
//
// Usage: node run-track-z-l1.mjs <cdpPort> <evidenceDir>
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const EVIDENCE_DIR = evidenceDirArg || path.dirname(new URL(import.meta.url).pathname);

function record(step, data) {
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
      this.ws.addEventListener('error', e => reject(e));
    });
    this.ws.addEventListener('message', event => {
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

// Multiple video tabs can be open simultaneously (each akari-preview webview is its own
// "webview/index.html" outer iframe target with its own nested active-frame). Try every
// candidate and keep the one whose inner DOM actually has our two-cuts fixture loaded, rather
// than assuming the first match is the currently-focused tab.
async function resolveActiveFrame(main) {
  let outerTargets = [];
  for (let attempt = 0; attempt < 20 && outerTargets.length === 0; attempt++) {
    const targets = await listTargets();
    outerTargets = targets.filter(t => t.type === 'iframe' && /webview\/index\.html/.test(t.url));
    if (outerTargets.length === 0) await sleep(300);
  }
  if (outerTargets.length === 0) throw new Error('outer webview CDP target not found');

  for (const outerTarget of outerTargets) {
    const outer = new CDP(outerTarget.webSocketDebuggerUrl);
    await outer.connect();
    const contexts = [];
    outer.on('Runtime.executionContextCreated', params => contexts.push(params.context));
    await outer.send('Page.enable');
    await outer.send('Runtime.enable');
    let frameTree;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      frameTree = await outer.send('Page.getFrameTree');
      if (contexts.length > 0) break;
      await sleep(300);
    }
    const topFrameId = frameTree.frameTree.frame.id;
    const candidateContexts = contexts.filter(c => c.auxData?.frameId && c.auxData.frameId !== topFrameId);
    for (const ctx of candidateContexts) {
      try {
        const cutCount = await evalIn(outer, ctx.id, `(() => {
          const summary = window.__akariPreview && window.__akariPreview.summary;
          return summary && Array.isArray(summary.cuts) ? summary.cuts.length : -1;
        })()`);
        if (cutCount === 2) return { outer, contextId: ctx.id };
      } catch {
        // not the right frame / not ready yet; try the next candidate
      }
    }
  }
  throw new Error('no webview frame with the expected two-cuts fixture was found');
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
  record('connected-main', { targetId: mainTarget.id });
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  // Requires source.mp4 to already be open as a tab before this script runs (this custom
  // "AKARI Video" shell strips the stock Theia Explorer icon per its minimal-4-icon design —
  // see README.md in this directory for how far automated file-opening got and why it was not
  // completed). Click the tab label to make sure it's focused.
  const tabState = await evalMain(mainCdp, `(() => {
    const tab = Array.from(document.querySelectorAll('.lm-TabBar-tabLabel, .p-TabBar-tabLabel'))
      .find(e => e.textContent && e.textContent.trim() === 'source.mp4');
    if (!tab) return { found: false };
    const r = tab.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!tabState.found) throw new Error('source.mp4 tab not found');
  await realClick(mainCdp, tabState.x, tabState.y);
  await sleep(1000);
  record('focused-video-tab', tabState);
  await screenshot(mainCdp, path.join(EVIDENCE_DIR, '01-preview-opened.png'));

  const { outer, contextId } = await resolveActiveFrame(mainCdp);
  record('reached-active-frame-context', { contextId });
  await sleep(1200);

  const seekAndRead = async (label, outputTime, screenshotName) => {
    const state = await evalIn(outer, contextId, `(() => {
      const video = document.getElementById('preview-video');
      video.pause();
      const seek = document.getElementById('seek');
      seek.value = String(${outputTime});
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise(resolve => {
        video.addEventListener('seeked', function handler() {
          video.removeEventListener('seeked', handler);
          setTimeout(() => {
            const layerVideos = Array.from(document.querySelectorAll('#preview-layers video'))
              .map(v => ({ id: v.dataset.akariLayerId, zIndex: v.style.zIndex, display: v.style.display }));
            resolve({
              seekValue: seek.value,
              currentTime: video.currentTime,
              videoZIndex: video.style.zIndex,
              videoVisibility: video.style.visibility,
              layerVideos
            });
          }, 250);
        }, { once: true });
      });
    })()`);
    record(`state-${label}`, state);
    await screenshot(mainCdp, path.join(EVIDENCE_DIR, screenshotName));
    return state;
  };

  const baseState = await seekAndRead('t0.2-base-only', 0.2, '02-t0.2-base-only.png');
  const overlapState = await seekAndRead('t1.2-overlap-cuts1-front', 1.2, '03-t1.2-cuts1-front.png');

  const result = { baseState, overlapState };
  await writeFile(path.join(EVIDENCE_DIR, 'l1-result.json'), JSON.stringify(result, null, 2));
  record('done', result);
}

main().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
