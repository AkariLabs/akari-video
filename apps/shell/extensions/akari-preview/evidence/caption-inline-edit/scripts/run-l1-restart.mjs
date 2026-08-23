#!/usr/bin/env node
// L1 driver (instance 2): after an app restart the edited text persists and the
// blank-deleted cue stays gone. Usage: node run-l1-restart.mjs <cdp-port> <workspace-dir> <evidence-dir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
const port = Number(portArg);
const workspace = workspaceArg;
const evidenceDirectory = evidenceArg;
const NEW_TEXT = '編集後の字幕テスト';

const log = [];
const record = (step, detail = {}) => {
  log.push({ at: new Date().toISOString(), step, ...detail });
  console.log(`[${step}]`, JSON.stringify(detail));
};
const check = (condition, message, detail = {}) => {
  if (!condition) {
    record('ASSERTION-FAILED', { message, ...detail });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(detail)}`);
  }
  record('assert-ok', { message, ...detail });
};

class CDP {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() { this.socket.close(); }
}
const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
async function evaluate(cdp, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(cdp, x, y, count = 1) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let index = 1; index <= count; index++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: index });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: index });
  }
}
const PLATE_TEXT = `(() => {
  const plate = document.getElementById('caption-plate');
  const clone = plate.cloneNode(true);
  for (const style of clone.querySelectorAll('style')) style.remove();
  return clone.textContent.trim();
})`;
const seekAndRead = time => `(() => {
  const video = document.getElementById('preview-video');
  video.pause();
  video.currentTime = ${time};
  return new Promise(resolve => {
    const finish = () => {
      window.akari.runtime.tick(video.currentTime, false);
      requestAnimationFrame(() => {
        resolve({ currentTime: video.currentTime, plateText: ${PLATE_TEXT}() });
      });
    };
    if (Math.abs(video.currentTime - ${time}) < 0.001) finish();
    else video.addEventListener('seeked', finish, { once: true });
  });
})()`;
const seekUntilText = async (cdp, contextId, time, expected, timeoutMs = 20000) => {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, seekAndRead(time), contextId);
    if (last.plateText === expected) return last;
    await sleep(500);
  }
  return last;
};

await mkdir(evidenceDirectory, { recursive: true });
let main;
let outer;
try {
  let mainTarget;
  for (let attempt = 0; attempt < 60 && !mainTarget; attempt++) {
    mainTarget = (await targets().catch(() => [])).find(target => target.type === 'page');
    if (!mainTarget) await sleep(300);
  }
  if (!mainTarget) throw new Error('main page target not found');
  main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('Page.bringToFront');
  await (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180000) {
      const ready = await evaluate(main, `Boolean(Array.from(document.querySelectorAll('.codicon-settings-gear')).find(item => item.getBoundingClientRect().width > 0))`);
      if (ready) return;
      await sleep(500);
    }
    throw new Error('workbench did not become ready');
  })();

  const dismissed = await evaluate(main, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find(item =>
      item.textContent.trim() === '開くだけ' && item.getBoundingClientRect().width > 0);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  record('project-prompt', { dismissed });
  await sleep(500);

  // developer mode persists in THEIA_CONFIG_DIR; skip when the tree is already exposed
  const treeAlreadyVisible = await evaluate(main, `(() => {
    const row = document.querySelector('.theia-TreeNode');
    return Boolean(row && row.getBoundingClientRect().width > 0);
  })()`);
  if (!treeAlreadyVisible) {
  const gear = await evaluate(main, `(() => {
    const element = Array.from(document.querySelectorAll('.codicon-settings-gear')).find(item => item.getBoundingClientRect().width > 0);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!gear) throw new Error('settings gear icon not found');
  await click(main, gear.x, gear.y);
  await sleep(600);
  const checkbox = await evaluate(main, `(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const developer = boxes.find(box => {
        if (box.getBoundingClientRect().width === 0) return false;
        const scope = box.closest('label, div, li, section') || box.parentElement;
        return Boolean(scope && /developer/i.test(scope.textContent || ''));
      });
      if (!developer) return null;
      const rect = developer.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, checked: developer.checked };
    })()`);
  if (!checkbox) throw new Error('developer mode checkbox not found');
  if (!checkbox.checked) {
    await click(main, checkbox.x, checkbox.y);
    await sleep(600);
  }
  const checkedNow = await evaluate(main, `(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const developer = boxes.find(box => {
        const scope = box.closest('label, div, li, section') || box.parentElement;
        return Boolean(scope && /developer/i.test(scope.textContent || ''));
      });
      return developer ? developer.checked : null;
    })()`);
  record('developer-mode', { checkedBefore: checkbox.checked, checkedNow });
  check(checkedNow === true, 'developer mode is on after restart', { checkedNow });
  } else {
    record('developer-mode', { skipped: 'tree already visible' });
  }

  let explorerOpen = false;
  for (let attempt = 0; attempt < 15 && !explorerOpen; attempt++) {
    const state = await evaluate(main, `(() => {
      const row = document.querySelector('.theia-TreeNode');
      const alreadyOpen = Boolean(row && row.getBoundingClientRect().width > 0);
      const icon = Array.from(document.querySelectorAll('.codicon-files')).find(item => item.getBoundingClientRect().width > 0);
      const rect = icon ? icon.getBoundingClientRect() : null;
      return { alreadyOpen, x: rect ? rect.left + rect.width / 2 : 0, y: rect ? rect.top + rect.height / 2 : 0 };
    })()`);
    explorerOpen = state.alreadyOpen;
    if (!explorerOpen && state.x) { await click(main, state.x, state.y); await sleep(1000); }
  }
  check(explorerOpen, 'file explorer tree became visible');
  const row = label => evaluate(main, `(() => {
    const item = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]')).find(node => node.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return { collapsed: Boolean(item.querySelector('.theia-mod-collapsed')), x: rect.left + 20, y: rect.top + rect.height / 2 };
  })()`);
  let editRow = await row('edit.json');
  for (let attempt = 0; attempt < 6 && !editRow; attempt++) {
    const projectRow = await row('project');
    if (projectRow) { await click(main, projectRow.x, projectRow.y); await sleep(800); }
    editRow = await row('edit.json');
  }
  if (!editRow) throw new Error('edit.json tree row not found');
  await click(main, editRow.x, editRow.y, 2);
  await sleep(2000);

  const connectWebview = async target => {
    const cdp = new CDP(target.webSocketDebuggerUrl);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await sleep(700);
    const frameTree = await cdp.send('Page.getFrameTree');
    const topFrame = frameTree.frameTree.frame.id;
    const context = contexts.find(candidate => candidate.auxData?.frameId !== topFrame);
    if (!context) { cdp.close(); return null; }
    const captionCount = await evaluate(cdp, `window.__akariPreview?.captions?.length ?? -1`, context.id).catch(() => -1);
    return { cdp, context, captionCount };
  };
  const webviewTargets = async () => (await targets()).filter(target => target.type === 'iframe' && /webview\/index\.html/.test(target.url));

  let context = null;
  for (let attempt = 0; attempt < 40 && !context; attempt++) {
    for (const candidate of await webviewTargets()) {
      const connection = await connectWebview(candidate).catch(() => null);
      if (connection && connection.captionCount > 0) {
        outer = connection.cdp;
        context = connection.context;
        record('connected-webview', { captionCount: connection.captionCount });
        break;
      }
      connection?.cdp.close();
    }
    if (!context) await sleep(400);
  }
  if (!context) throw new Error('output preview webview (with captions) not found');
  await (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const ready = await evaluate(outer, `(() => {
        const video = document.getElementById('preview-video');
        return Boolean(video && video.readyState >= 2 && window.akari && window.akari.runtime);
      })()`, context.id).catch(() => false);
      if (ready) return;
      await sleep(500);
    }
    throw new Error('preview runtime not ready');
  })();

  const edited = await seekUntilText(outer, context.id, 1.0, NEW_TEXT);
  check(edited.plateText === NEW_TEXT, 'restart: edited text persists at t=1.0', edited);
  const deleted = await seekUntilText(outer, context.id, 2.8, '');
  check(deleted.plateText === '', 'restart: blank-deleted cue stays gone at t=2.8', deleted);
  const fileNow = JSON.parse(await readFile(path.join(workspace, 'project', 'captions.json'), 'utf8'));
  check(Array.isArray(fileNow) && fileNow.length === 1 && fileNow[0].id === 'c-0001' && fileNow[0].text === NEW_TEXT,
    'restart: captions.json still holds the single edited cue', { cues: fileNow.length });
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidenceDirectory, '06-after-restart.png'), Buffer.from(data, 'base64'));
  record('instance-2-complete');
} finally {
  outer?.close();
  main?.close();
  const sanitized = JSON.parse(JSON.stringify(log).split(workspace).join('<workspace>'));
  await writeFile(path.join(evidenceDirectory, 'run-log-restart.json'), `${JSON.stringify({ phase: 'instance-2', log: sanitized }, null, 2)}\n`);
}
