// Shared dependency-free (Node 22+ built-ins) raw-CDP helpers, split out so each
// verification phase can run as its own short-lived node process/connection —
// safer against a single long session accumulating a wedged renderer state.
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
  // Without this, document.hasFocus() reports false and Monaco's quick-input palette
  // (among other focus-sensitive UI) auto-dismisses unpredictably shortly after opening —
  // the root cause of most flakiness seen while automating the command palette.
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

/**
 * Toggles akari.developerMode via the "AKARI 設定" panel's own "Developer mode" checkbox
 * (opened from the bottom-left gear icon) rather than the quick-command palette.
 * The plain HTML checkbox is far more reliably clickable via CDP than Monaco's quick-input
 * list (which proved flaky under real-CDP automation — see git history of this file).
 * Clicks the shared 'codicon-files' activity icon afterward so whichever of
 * Explorer/our widget is now active actually becomes the visible/foreground tab
 * (attaching a widget does not necessarily activate it if another tab was showing).
 */
export async function toggleDeveloperModeViaSettings(cdp, sleepFn = sleep) {
  const gear = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-settings-gear')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!gear.found) throw new Error('settings gear icon not found');
  await realClick(cdp, gear.x, gear.y);
  await sleepFn(500);

  const checkbox = await evalMain(cdp, `(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (!cb) return { found: false };
    const r = cb.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, checkedBefore: cb.checked };
  })()`);
  if (!checkbox.found) throw new Error('Developer mode checkbox not found in AKARI settings panel');
  await realClick(cdp, checkbox.x, checkbox.y);
  let checkedAfter = checkbox.checkedBefore;
  for (let attempt = 0; attempt < 10 && checkedAfter === checkbox.checkedBefore; attempt++) {
    await sleepFn(300);
    checkedAfter = await evalMain(cdp, `(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : null;
    })()`);
  }
  if (checkedAfter === checkbox.checkedBefore) {
    throw new Error(`Developer mode checkbox did not toggle (still ${checkedAfter})`);
  }

  const filesIcon = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!filesIcon.found) throw new Error('files/explorer activity icon not found after toggling developer mode');
  await realClick(cdp, filesIcon.x, filesIcon.y);
  await sleepFn(500);
  return { checkedBefore: checkbox.checkedBefore, checkedAfter };
}

export async function waitForDropzone(cdp, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evalMain(cdp, `(() => {
      const el = document.querySelector('[data-akari-dropzone]');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, visible: r.width > 0 && r.height > 0, width: r.width, height: r.height };
    })()`);
    if (state.found && state.visible) return state;
    await sleep(400);
  }
  return { found: false };
}

export { sleep };
