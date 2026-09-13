import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const timeoutMs = process.env.AKARI_CDP_TIMEOUT_MS === undefined ? 10_000 : Number(process.env.AKARI_CDP_TIMEOUT_MS);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AKARI_CDP_TIMEOUT_MS must be positive');

export class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), timeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      this.ws.addEventListener('error', event => { clearTimeout(timer); reject(event); });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      clearTimeout(pending.timer); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { this.ws?.close(); }
}

export async function listTargets(port) { return fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(response => response.json()); }
export async function evalOn(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
export async function screenshot(cdp, path) { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(data, 'base64')); }
export async function drag(cdp, from, to) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' }); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 }); for (let i = 1; i <= 10; i += 1) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10, button: 'left', buttons: 1 }); await sleep(35); } await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 }); }
