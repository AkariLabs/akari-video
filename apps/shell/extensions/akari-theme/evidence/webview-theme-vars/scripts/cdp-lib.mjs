import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

export class CDP {
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
    // 元（akari-annotations/evidence/timeline-tracks）からの差分:
    // OOPIF ターゲットが消えると send() の Promise が永久に未解決のままになり、
    // 呼び出し側が固まる（実測: Codex ビューを左パネルへ移した瞬間に webview が破棄されて発生）。
    // close / error で pending を必ず reject する。
    const failPending = reason => {
      for (const { reject } of this.pending.values()) reject(new Error('cdp connection closed: ' + reason));
      this.pending.clear();
    };
    this.ws.addEventListener('close', () => failPending('close'));
    this.ws.addEventListener('error', () => failPending('error'));
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

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

export async function evalOn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const r = await cdp.send('Runtime.evaluate', params);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

export async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1;
  const modifiers = opts.modifiers || 0;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
  for (let count = 1; count <= clicks; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers });
    if (count < clicks) await sleep(60);
  }
}

export async function realDrag(cdp, path, opts = {}) {
  // path: [{x,y}, {x,y}, ...] first = pointerdown location, rest = pointermove waypoints, last stays for pointerup
  const steps = opts.steps ?? 8;
  const stepDelayMs = opts.stepDelayMs ?? 16;
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
  const end = path[path.length - 1];
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left' });
}

export async function wheel(cdp, x, y, deltaX, deltaY, opts = {}) {
  const modifiers = opts.ctrlKey ? 2 : 0;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY, modifiers
  });
}

export async function screenshot(cdp, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

export async function keyPress(cdp, opts) {
  // opts: {key, code, windowsVirtualKeyCode, modifiers, text}
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...opts });
  await sleep(20);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...opts });
}
