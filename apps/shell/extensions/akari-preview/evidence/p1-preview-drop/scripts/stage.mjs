// 出力プレビューの「出力の枠」を本体ページの CSS px で求める（Theia の webview = 本体の iframe.webview → 外側の文書 → 内側の content iframe → #preview-stage）。
// 内側の文書で #preview-stage の矩形と出力 px を、外側の文書で content iframe の位置を、本体で iframe.webview の位置を取り、足し合わせる。
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { PORT } from './common.mjs';

export async function webviewContexts() {
  const target = (await listTargets(PORT)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
  if (!target) return null;
  const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  const contexts = []; cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
  await cdp.send('Runtime.enable');
  await new Promise(r => setTimeout(r, 300));
  let inner, outer;
  for (const c of contexts) {
    try {
      const v = await evalOn(cdp, `({stage:Boolean(document.getElementById('preview-stage')),iframe:Boolean(document.querySelector('iframe'))})`, c.id);
      if (v.stage) inner = c.id; else if (v.iframe && outer === undefined) outer = c.id;
    } catch {}
  }
  return { cdp, inner, outer };
}

export async function stageGeometry(hostCdp, outputSize) {
  const wv = await webviewContexts();
  if (!wv || wv.inner === undefined) return null;
  const hostFrame = await evalOn(hostCdp, `(()=>{const f=[...document.querySelectorAll('iframe.webview, iframe')].find(f=>{const r=f.getBoundingClientRect();return r.width>100&&r.height>100&&/webview/.test(f.src||'')});if(!f)return null;const r=f.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}})()`);
  const outerFrame = wv.outer === undefined ? { x: 0, y: 0 } : await evalOn(wv.cdp, `(()=>{const f=document.querySelector('iframe#active-frame')||document.querySelector('iframe');const r=f.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}})()`, wv.outer);
  const inner = await evalOn(wv.cdp, `(()=>{const s=document.getElementById('preview-stage');const r=s.getBoundingClientRect();const cs=getComputedStyle(s);return{x:r.left,y:r.top,w:r.width,h:r.height,offsetW:s.offsetWidth,offsetH:s.offsetHeight,transform:cs.transform}})()`, wv.inner);
  wv.cdp.close();
  // 出力 px は edit.json の output（#preview-stage は表示の大きさで組まれる）。
  const output = outputSize;
  return {
    hostFrame, outerFrame, inner, output,
    host: { x: hostFrame.x + outerFrame.x + inner.x, y: hostFrame.y + outerFrame.y + inner.y, w: inner.w, h: inner.h }
  };
}
