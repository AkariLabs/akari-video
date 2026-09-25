// Copied from main-ops/apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs @ ef00f0fc; original is read-only.
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const cdpTimeoutMs = process.env.AKARI_CDP_TIMEOUT_MS === undefined ? 10_000 : Number(process.env.AKARI_CDP_TIMEOUT_MS);
if (!Number.isFinite(cdpTimeoutMs) || cdpTimeoutMs <= 0) throw new Error('AKARI_CDP_TIMEOUT_MS must be a positive number');

export class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('CDP WebSocket connect timed out after 10000ms')), 10_000); this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }); this.ws.addEventListener('error', event => { clearTimeout(timer); reject(event); }); });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject, timer } = this.pending.get(msg.id); clearTimeout(timer); this.pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
      else if (msg.method) for (const handler of this.listeners.get(msg.method) || []) handler(msg.params);
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out after ${cdpTimeoutMs}ms`)); }, cdpTimeoutMs); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, handler) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(handler); }
  close() { this.ws?.close(); }
}

export async function listTargets(port) { const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }); return response.json(); }
export async function evalOn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true }; if (contextId !== undefined) params.contextId = contextId;
  const result = await cdp.send('Runtime.evaluate', params); if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`); return result.result.value;
}
export async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1, modifiers = opts.modifiers || 0;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
  for (let count = 1; count <= clicks; count++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers }); await sleep(30); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers }); if (count < clicks) await sleep(60); }
}
export async function realDrag(cdp, path, opts = {}) {
  const steps = opts.steps ?? 8, stepDelayMs = opts.stepDelayMs ?? 16, start = path[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' }); await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
  for (let i = 1; i < path.length; i++) for (let s = 1; s <= steps; s++) { const from = path[i - 1], to = path[i]; await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps, button: 'left', buttons: 1 }); await sleep(stepDelayMs); }
  const end = path.at(-1); await sleep(30); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left' });
}
export async function wheel(cdp, x, y, deltaX, deltaY, opts = {}) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: opts.ctrlKey ? 2 : 0 }); }
export async function screenshot(cdp, filePath) { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(filePath, Buffer.from(data, 'base64')); return filePath; }
export async function keyPress(cdp, opts) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...opts }); await sleep(20); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...opts }); }

// --- caption-plate-drag-clamp レーンの追記（元ファイルは読み取り専用のまま） ---
export { sleep };
/** Poll until fn() returns a truthy value; throws with the label on timeout. */
export async function waitFor(label, fn, timeoutMs = 30_000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached${last ? `: ${last.message || last}` : ''}`);
}
/** realDrag with modifier support (Alt=1, Ctrl=2, Meta=4, Shift=8). */
export async function realDragMod(cdp, path, opts = {}) {
  const steps = opts.steps ?? 10, stepDelayMs = opts.stepDelayMs ?? 24, modifiers = opts.modifiers ?? 0;
  const start = path[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', modifiers }); await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, modifiers }); await sleep(60);
  for (let i = 1; i < path.length; i++) {
    for (let s = 1; s <= steps; s++) {
      const from = path[i - 1], to = path[i];
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps,
        button: 'left', buttons: 1, modifiers
      });
      await sleep(stepDelayMs);
    }
  }
  const end = path.at(-1); await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, modifiers });
}
