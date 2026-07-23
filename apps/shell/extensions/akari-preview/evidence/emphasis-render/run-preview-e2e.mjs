#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
const port = Number(portArg || 9347);
const workspace = workspaceArg;
const evidenceDirectory = evidenceArg;
const sampleTimes = [0.7, 1, 1.3];
const log = [];

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
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

async function targets() {
  return fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
}

async function evaluate(cdp, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    contextId,
    returnByValue: true,
    awaitPromise: true,
  });
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

await mkdir(evidenceDirectory, { recursive: true });
let main;
let outer;
try {
  let mainTarget;
  for (let attempt = 0; attempt < 40 && !mainTarget; attempt++) {
    mainTarget = (await targets()).find(target => target.type === 'page');
    if (!mainTarget) await sleep(250);
  }
  if (!mainTarget) throw new Error('main page target not found');
  main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');

  const explorer = await evaluate(main, `(() => {
    const row = document.querySelector('.theia-TreeNode');
    const icon = Array.from(document.querySelectorAll('.codicon-files')).find(item => item.getBoundingClientRect().width > 0);
    const rect = icon.getBoundingClientRect();
    return { open: Boolean(row && row.getBoundingClientRect().width > 0), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!explorer.open) {
    await click(main, explorer.x, explorer.y);
    await sleep(500);
  }
  const row = label => evaluate(main, `(() => {
    const item = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]')).find(node => node.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return { collapsed: Boolean(item.querySelector('.theia-mod-collapsed')), x: rect.left + 20, y: rect.top + rect.height / 2 };
  })()`);
  const projectRow = await row('project');
  if (!projectRow) throw new Error('project tree row not found');
  if (projectRow.collapsed) {
    await click(main, projectRow.x, projectRow.y, 2);
    await sleep(500);
  }
  const videoRow = await row('source.mp4');
  if (!videoRow) throw new Error('source.mp4 tree row not found');
  await click(main, videoRow.x, videoRow.y, 2);
  await sleep(1500);

  let outerTarget;
  for (let attempt = 0; attempt < 20 && !outerTarget; attempt++) {
    outerTarget = (await targets()).find(target => target.type === 'iframe' && /webview\/index\.html/.test(target.url));
    if (!outerTarget) await sleep(300);
  }
  if (!outerTarget) throw new Error('preview webview target not found');
  outer = new CDP(outerTarget.webSocketDebuggerUrl);
  const contexts = [];
  outer.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await outer.connect();
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(500);
  const frameTree = await outer.send('Page.getFrameTree');
  const topFrame = frameTree.frameTree.frame.id;
  const activeContext = contexts.find(context => context.auxData?.frameId !== topFrame);
  if (!activeContext) throw new Error('active preview frame context not found');

  for (const time of sampleTimes) {
    const state = await evaluate(outer, `(() => {
      const video = document.getElementById('preview-video');
      video.pause();
      video.currentTime = ${time};
      return new Promise(resolve => {
        const finish = () => {
          window.akari.runtime.tick(video.currentTime, false);
          requestAnimationFrame(() => {
            const chars = Array.from(document.querySelectorAll('.akari-caption__emphasis-char'));
            resolve({
              currentTime: video.currentTime,
              captionText: document.getElementById('caption-plate').textContent,
              characterCount: chars.length,
              characters: chars.map(character => ({
                text: character.textContent,
                opacity: getComputedStyle(character).opacity,
                transform: getComputedStyle(character).transform,
              })),
              animationTimes: document.getElementById('caption-plate').getAnimations({ subtree: true }).map(animation => animation.currentTime),
            });
          });
        };
        if (Math.abs(video.currentTime - ${time}) < 0.001) finish();
        else video.addEventListener('seeked', finish, { once: true });
      });
    })()`, activeContext.id);
    log.push({ time, state });
    const { data } = await outer.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidenceDirectory, `preview-t${time.toFixed(1)}.png`), Buffer.from(data, 'base64'));
  }
  if (log.some(entry => entry.state.characterCount !== 3)) throw new Error('one-char-bang spans were not rendered');
  await writeFile(
    path.join(evidenceDirectory, 'preview-run-log.json'),
    `${JSON.stringify({ workspace, sampleTimes, observations: log }, null, 2)}\n`,
  );
} finally {
  outer?.close();
  main?.close();
}
