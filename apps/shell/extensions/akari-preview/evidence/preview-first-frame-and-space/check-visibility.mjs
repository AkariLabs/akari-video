import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const port = Number(process.argv[2] || 9458);
const label = process.argv[3] || 'clip-a.mp4';
const shotPath = process.argv[4];

class CDP {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) { const p = this.pending.get(message.id); this.pending.delete(message.id); if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result); return; }
      for (const l of this.listeners.get(message.method) || []) l(message.params);
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  on(method, listener) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(listener); }
  close() { this.socket.close(); }
}
async function targets(port) { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()); }
async function evaluate(cdp, expression, contextId) { const r = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function connectActiveFrame(iframeTarget) {
  const outer = new CDP(iframeTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', p => contexts.push(p.context));
  await outer.send('Page.enable'); await outer.send('Runtime.enable'); await sleep(800);
  const tree = await outer.send('Page.getFrameTree');
  const topFrame = tree.frameTree.frame.id;
  for (let i = 0; i < 20; i++) {
    const active = contexts.find(c => c.auxData?.frameId !== topFrame && c.auxData?.isDefault === true);
    if (active) return { outer, contextId: active.id };
    await sleep(300);
  }
  throw new Error('no active frame context');
}

async function focusOutsideAnyIframe(page) {
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.lm-TabBar-tab')).map(tab => {
    const rect = tab.getBoundingClientRect();
    const lbl = tab.querySelector('.lm-TabBar-tabLabel');
    return { text: lbl ? lbl.textContent : '', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }));
  const target = tabs.find(t => t.w > 0 && t.h > 0 && t.text === 'ホーム') || tabs.find(t => t.w > 0 && t.h > 0);
  if (target) { await page.mouse.click(target.x, target.y); await sleep(300); }
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const page = (await browser.pages())[0];
  await page.bringToFront();
  await focusOutsideAnyIframe(page);

  let hasWidget = false;
  for (let attempt = 0; attempt < 10 && !hasWidget; attempt += 1) {
    await page.keyboard.down('Meta'); await page.keyboard.press('KeyP'); await page.keyboard.up('Meta');
    await sleep(800);
    hasWidget = await page.evaluate(() => Boolean(document.querySelector('.quick-input-widget')));
    if (!hasWidget) { await page.keyboard.press('Escape'); await sleep(400); await focusOutsideAnyIframe(page); }
  }
  if (!hasWidget) throw new Error('quick-open never appeared');
  // Clear any stale text first (select-all + type) to avoid leftover characters from a slow prior keypress.
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
  await sleep(150);
  await page.keyboard.type(label, { delay: 40 });
  await sleep(1200);
  // Verify the top quick-open result actually matches before hitting Enter.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const topLabel = await page.evaluate(() => {
      const el = document.querySelector('.quick-input-list .monaco-list-row .label-name, .quick-input-list .monaco-list-row');
      return el ? el.textContent : null;
    });
    if (topLabel && topLabel.includes(label.replace(/\.[a-z0-9]+$/i, ''))) break;
    await sleep(300);
  }
  await page.keyboard.press('Enter');

  let target;
  const urlPattern = label === 'edit.json' ? /id=akari-output-preview-/ : /id=akari-preview-/;
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    const list = await targets(port);
    target = list.find(t => t.type === 'iframe' && urlPattern.test(t.url));
    if (target) break;
  }
  if (!target) throw new Error(`preview target for ${label} not found`);
  console.log('target', target.url);

  const { outer, contextId } = await connectActiveFrame(target);
  // Wait for the video to actually finish loading before judging visibility -- this is the
  // "opened, before play" moment the task asks to measure.
  await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const ready = await evaluate(outer, `document.getElementById('preview-video').readyState`, contextId);
      if (ready >= 2) return;
      await sleep(300);
    }
  })();
  await sleep(500); // let the fix's enterSegment()/applyCutsMuteState() settle
  const state = await evaluate(outer, `(() => {
    const v = document.getElementById('preview-video');
    const s = getComputedStyle(v);
    return { readyState: v.readyState, paused: v.paused, currentTime: v.currentTime, opacity: s.opacity, visibility: s.visibility, zIndex: s.zIndex, display: s.display, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
  })()`, contextId);
  console.log('state', state);
  if (shotPath) await page.screenshot({ path: shotPath });
  outer.close();
  await browser.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
