import { writeFile } from 'node:fs/promises';

const port = Number(process.env.AKARI_CDP_PORT ?? 9542);
const output = process.argv[2];
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const receiver = pending.get(message.id);
  if (receiver) {
    pending.delete(message.id);
    message.error ? receiver.reject(new Error(JSON.stringify(message.error))) : receiver.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const targets = await send('Target.getTargets');
const mainInfo = targets.targetInfos.find(info => info.type === 'page');
const mainSession = mainInfo ? (await send('Target.attachToTarget', { targetId: mainInfo.targetId, flatten: true })).sessionId : undefined;
for (const info of targets.targetInfos ?? []) {
  if (info.type !== 'iframe' || !info.url.includes('webview')) continue;
  const attached = await send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
  const session = attached.sessionId;
  await send('Page.enable', {}, session);
  const tree = await send('Page.getFrameTree', {}, session);
  const frames = [];
  function walk(node) { frames.push(node.frame); for (const child of node.childFrames ?? []) walk(child); }
  walk(tree.frameTree);
  for (const frame of frames) {
    try {
      const world = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'photo-mask-check' }, session);
      const result = await send('Runtime.evaluate', { contextId: world.executionContextId,
        expression: 'JSON.stringify({ title: document.title, ready: document.readyState, preview: !!document.getElementById("preview-layers"), body: (document.body?.innerText || "").slice(0,500), image: !!document.querySelector("img[data-akari-layer-id]"), warnings: [...document.querySelectorAll("[title]")].map(x=>x.title).filter(x=>x.includes("mask")||x.includes("マスク")||x.includes("未対応")).slice(0,8), layer: [...document.querySelectorAll("[data-akari-layer-id]")].map(x=>({id:x.dataset.akariLayerId,src:x.getAttribute("src")})).slice(0,3), badge: document.querySelector("[title*=未対応]")?.outerHTML.slice(0,500) })',
        returnByValue: true }, session);
      const state = JSON.parse(result.result.value);
      console.log(JSON.stringify({ frame: frame.id, ...state }));
      if (state.preview && process.env.AKARI_L1_CLICK_WARNING === '1') {
        const warning = await send('Runtime.evaluate', { contextId: world.executionContextId,
          expression: 'document.getElementById("indicator-toggle")?.click(); document.body?.innerText.slice(0,1000)',
          returnByValue: true }, session);
        console.log(JSON.stringify({ warning: warning.result.value }));
      }
      if (state.preview && output) {
        const innerResult = await send('Runtime.evaluate', { contextId: world.executionContextId,
          expression: 'JSON.stringify((()=>{const r=document.getElementById("preview-layers").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})())',
          returnByValue: true }, session);
        const outerResult = await send('Runtime.evaluate', {
          expression: 'JSON.stringify((()=>{const r=document.querySelector("iframe").getBoundingClientRect();return {x:r.x,y:r.y}})())',
          returnByValue: true }, mainSession);
        const inner = JSON.parse(innerResult.result.value);
        const outer = JSON.parse(outerResult.result.value);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true,
          clip: { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height, scale: 1 } }, mainSession);
        await writeFile(output, Buffer.from(screenshot.data, 'base64'));
      }
    } catch (error) { console.log(JSON.stringify({ frame: frame.id, error: String(error) })); }
  }
}
socket.close();
