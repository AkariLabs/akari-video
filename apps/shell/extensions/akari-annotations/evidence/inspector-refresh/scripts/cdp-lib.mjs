import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const cdpTimeoutMs = process.env.AKARI_CDP_TIMEOUT_MS === undefined ? 10_000 : Number(process.env.AKARI_CDP_TIMEOUT_MS);
if (!Number.isFinite(cdpTimeoutMs) || cdpTimeoutMs <= 0) throw new Error('AKARI_CDP_TIMEOUT_MS must be a positive number');

export class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  failPending(error) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer); this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) for (const handler of this.listeners.get(msg.method) || []) handler(msg.params);
    });
    this.ws.addEventListener('close', () => this.failPending(new Error('CDP target closed')));
    this.ws.addEventListener('error', () => this.failPending(new Error('CDP WebSocket error')));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.close();
        reject(new Error(`CDP WebSocket connect timed out after ${cdpTimeoutMs}ms`));
      }, cdpTimeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connect failed')); }, { once: true });
      this.ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('CDP closed before connection')); }, { once: true });
    });
  }
  send(method, params = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP is not open: ${method}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${cdpTimeoutMs}ms`));
      }, cdpTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  on(method, handler) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(handler); }
  close() { this.failPending(new Error('CDP connection closed by caller')); this.ws?.close(); }
}

export async function listTargets(port) { const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(cdpTimeoutMs) }); return response.json(); }
export async function evalOn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true }; if (contextId !== undefined) params.contextId = contextId;
  const result = await cdp.send('Runtime.evaluate', params); if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`); return result.result.value;
}
export async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1, modifiers = opts.modifiers || 0;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
  for (let count = 1; count <= clicks; count++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count, modifiers }); await sleep(30); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count, modifiers }); if (count < clicks) await sleep(60); }
}
export async function screenshot(cdp, filePath, clip) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {})
  });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}
