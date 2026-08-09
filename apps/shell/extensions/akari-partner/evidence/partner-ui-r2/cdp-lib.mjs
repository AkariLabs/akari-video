// Shared dependency-free (Node 22+ built-ins) raw-CDP helpers. Copied verbatim from
// evidence/partner-catalog-regroup/cdp-lib.mjs (established repo convention — style
// followed, contents unmodified), which itself is copied verbatim from
// akari-project/evidence/catalog-account-first-ux/cdp-lib.mjs.
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const DEFAULT_TIMEOUT_MS = 15000;

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
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
      }
    });
  }
  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    return Promise.race([
      promise,
      sleep(timeoutMs).then(() => { throw new Error(`CDP ${method} timed out after ${timeoutMs}ms`); })
    ]);
  }
  close() { this.ws.close(); }
}

export async function listTargets(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  return res.json();
}

export async function connectMain(cdpPort) {
  let mainTarget;
  for (let attempt = 0; attempt < 40 && !mainTarget; attempt++) {
    const targets = await listTargets(cdpPort);
    mainTarget = targets.find(t => t.type === 'page');
    if (!mainTarget) await sleep(300);
  }
  if (!mainTarget) throw new Error('main page target not found');
  const cdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.bringToFront');
  return cdp;
}

export async function evalMain(cdp, expression, timeoutMs) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error('evalMain failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

export async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clicks; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    if (count < clicks) await sleep(60);
  }
}

export async function screenshot(cdp, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 20000);
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

export { sleep };
