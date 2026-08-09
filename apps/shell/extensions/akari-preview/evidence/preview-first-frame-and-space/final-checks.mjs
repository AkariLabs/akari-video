import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const port = Number(process.argv[2] || 9459);
const evidenceDir = process.argv[3];
const scenario = process.argv[4] || 'both';

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
async function targets() { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()); }
async function evaluate(cdp, expression, contextId) {
  const r = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function connectActiveFrame(iframeTarget) {
  const outer = new CDP(iframeTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', p => contexts.push(p.context));
  await outer.send('Page.enable'); await outer.send('Runtime.enable'); await sleep(800);
  const tree = await outer.send('Page.getFrameTree');
  const topFrame = tree.frameTree.frame.id;
  for (let i = 0; i < 20; i += 1) {
    const active = contexts.find(c => c.auxData?.frameId !== topFrame && c.auxData?.isDefault === true);
    if (active) return { outer, contextId: active.id };
    await sleep(300);
  }
  throw new Error('no active frame context');
}
async function click(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function space(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
}

const results = {};

async function runRawChecks(page, rawTarget) {
  const { outer: outer1, contextId: c1 } = await connectActiveFrame(rawTarget);
  const ev1 = expr => evaluate(outer1, expr, c1);
  const wrapperRect1 = await ev1(`(() => { const r = document.getElementById('preview-wrapper').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height*0.15 }; })()`);
  await click(outer1, wrapperRect1.x, wrapperRect1.y);
  await sleep(200);
  const pausedBeforeSpace = await ev1(`document.getElementById('preview-video').paused`);
  await space(outer1);
  await sleep(500);
  const pausedAfterSpace = await ev1(`document.getElementById('preview-video').paused`);
  results.rawSpaceToggle = { pausedBeforeSpace, pausedAfterSpace };
  await page.screenshot({ path: `${evidenceDir}/03-raw-preview-after-space-play.png` });

  const pausedBeforeTypingProbe = await ev1(`document.getElementById('preview-video').paused`);
  await ev1(`(() => { const p = document.createElement('textarea'); p.id='akari-test-probe'; document.body.appendChild(p); p.focus(); })()`);
  await space(outer1);
  await sleep(400);
  const pausedAfterTypingProbe = await ev1(`document.getElementById('preview-video').paused`);
  await ev1(`document.getElementById('akari-test-probe')?.remove()`);
  results.rawSpaceWhileTyping = { pausedBeforeTypingProbe, pausedAfterTypingProbe, guardHeld: pausedBeforeTypingProbe === pausedAfterTypingProbe };

  if (!(await ev1(`document.getElementById('preview-video').paused`))) { await space(outer1); await sleep(300); }
  outer1.close();
}

async function runOutputChecks(page, outputTarget) {
  const { outer: outer2, contextId: c2 } = await connectActiveFrame(outputTarget);
  const ev2 = expr => evaluate(outer2, expr, c2);
  const srcBefore = await ev2(`document.getElementById('preview-video').getAttribute('src')`);
  const wrapperRect2 = await ev2(`(() => { const r = document.getElementById('preview-wrapper').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height*0.15 }; })()`);
  await click(outer2, wrapperRect2.x, wrapperRect2.y);
  await sleep(150);
  const playRect2 = await ev2(`(() => { const r = document.getElementById('play-toggle').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
  await click(outer2, playRect2.x, playRect2.y);
  let srcAfter = srcBefore;
  for (let i = 0; i < 40; i += 1) {
    await sleep(200);
    srcAfter = await ev2(`document.getElementById('preview-video').getAttribute('src')`);
    if (srcAfter !== srcBefore) break;
  }
  results.outputCutSwitch = { srcBefore, srcAfter, switched: srcAfter !== srcBefore };
  await page.screenshot({ path: `${evidenceDir}/04-output-preview-cut-switched.png` });
  await click(outer2, playRect2.x, playRect2.y);

  await click(outer2, wrapperRect2.x, wrapperRect2.y);
  await sleep(150);
  const outPausedBefore = await ev2(`document.getElementById('preview-video').paused`);
  await space(outer2);
  await sleep(500);
  const outPausedAfter = await ev2(`document.getElementById('preview-video').paused`);
  results.outputSpaceToggle = { outPausedBefore, outPausedAfter };
  if (!(await ev2(`document.getElementById('preview-video').paused`))) { await space(outer2); await sleep(300); }
  outer2.close();
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const page = (await browser.pages())[0];

  const list = await targets();
  const rawTarget = list.find(t => t.type === 'iframe' && /id=akari-preview-/.test(t.url));
  const outputTarget = list.find(t => t.type === 'iframe' && /id=akari-output-preview-/.test(t.url));
  if (scenario !== 'output' && !rawTarget) throw new Error('raw preview target not found -- open clip-a.mp4 first');
  if (scenario !== 'raw' && !outputTarget) throw new Error('output preview target not found -- open edit.json first');

  if (scenario === 'output') {
    await runOutputChecks(page, outputTarget);
    console.log(JSON.stringify(results, null, 2));
    await browser.disconnect();
    return;
  }
  if (scenario === 'raw') {
    await runRawChecks(page, rawTarget);
    console.log(JSON.stringify(results, null, 2));
    await browser.disconnect();
    return;
  }

  await runRawChecks(page, rawTarget);
  await runOutputChecks(page, outputTarget);
  console.log(JSON.stringify(results, null, 2));
  await browser.disconnect();
}

main().catch(e => { console.error(e); console.log(JSON.stringify(results, null, 2)); process.exit(1); });
