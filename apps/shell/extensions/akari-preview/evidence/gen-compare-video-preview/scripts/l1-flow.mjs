// 票 V3 の BEFORE / AFTER で共有する流れ: 3 案を作る・候補を押す・出力プレビュー（入れ子の webview）の観測。
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { PORT, S } from './l1-common.mjs';

export const PANEL = '[data-akari-inspector-video-panel]';
export const FRAME = 'clip-frame';
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

export const candidateRows = `(()=>[...document.querySelectorAll('${PANEL} [data-akari-inspector-video-candidate]')].map(c=>({path:c.getAttribute('data-akari-inspector-video-candidate'),
  selected:c.getAttribute('data-akari-inspector-video-candidate-selected'),text:c.textContent.replace(/\\s+/g,' ').trim()})))()`;

export async function clickDialogButton(h, cdp, label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`![...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`, 'dialog closed', 10_000);
}

export async function setChecked(h, cdp, modelId, checked) {
  const sel = `${PANEL} [data-akari-inspector-video-model-check="${modelId}"]`;
  if (await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});return e?e.checked:null})()`) === null)
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return true})()`);
  if (await evalOn(cdp, `document.querySelector(${S(sel)})?.checked`) === checked) return;
  await h.clickUntil(sel, `document.querySelector(${S(sel)})?.checked===${checked}`, `check ${modelId} ${checked}`);
}

/** 3 モデルにチェック → 合計の費用承認 → 候補 3 つが並ぶまで待つ。 */
export async function makeThreeCandidates(h, cdp, models) {
  await h.waitEval(`Boolean(document.querySelector(${S(PANEL)}))`, 'video panel', 60_000);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  for (const model of models) await setChecked(h, cdp, model, true);
  await h.waitEval(`/^3 案を作る/.test(document.querySelector('[data-akari-inspector-video-create]')?.textContent.trim()??'')`, '3 案', 10_000);
  await evalOn(cdp, `(()=>{document.querySelector('${PANEL} [data-akari-inspector-video-create]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await clickDialogButton(h, cdp, '費用承認する');
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});if(!p||p.querySelector('[data-akari-inspector-video-cancel]'))return false;
    return p.querySelectorAll('[data-akari-inspector-video-candidate]').length>=3})()`, 'three candidates', 900_000);
  await h.settle();
  return evalOn(cdp, candidateRows);
}

/** 出力プレビューを開き、入れ子の webview の内側（overlay-stage のある文脈）へつなぐ。 */
export async function openPreview(h, cdp, project) {
  const editUri = pathToFileURL(path.join(project, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await h.exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  const state = { editUri, cdp: null, inner: null };
  const connect = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const targets = (await listTargets(PORT)).filter(t => t.type === 'iframe' || t.type === 'webview');
      const found = [];
      for (const t of targets) {
        let sub;
        try {
          sub = new CDP(t.webSocketDebuggerUrl);
          await withTimeout(sub.connect(), 15000);
          const contexts = [];
          sub.on('Runtime.executionContextCreated', p => contexts.push(p.context));
          await withTimeout(sub.send('Page.enable'), 15000); await withTimeout(sub.send('Runtime.enable'), 15000);
          await sleep(1500);
          let inner, score = -1;
          for (const c of contexts) {
            const info = await withTimeout(evalOn(sub, `(()=>{const o=document.getElementById('overlay-stage');if(o){const r=o.getBoundingClientRect();
              return{visible:document.visibilityState==='visible'&&r.width>0&&r.height>0,layers:document.querySelectorAll('[data-akari-cut-id],[data-akari-layer-id]').length}}return null})()`, c.id), 10000).catch(() => null);
            if (info) { const sc = (info.visible ? 1000 : 0) + info.layers; if (sc > score) { score = sc; inner = c.id; } }
          }
          if (inner && (score >= 1000 || attempt >= 5)) found.push({ cdp: sub, inner, score });
          else sub.close();
        } catch { try { sub?.close(); } catch {} }
      }
      if (found.length) {
        found.sort((a, b) => b.score - a.score);
        for (const extra of found.slice(1)) { try { extra.cdp.close(); } catch {} }
        state.cdp = found[0].cdp; state.inner = found[0].inner;
        return;
      }
      await sleep(1000);
    }
    throw new Error('preview content context not found');
  };
  await connect();
  state.pv = async expression => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await withTimeout(evalOn(state.cdp, expression, state.inner), 15_000); }
      catch (error) { if (attempt === 2) throw error; try { state.cdp.close(); } catch {} await connect(); }
    }
  };
  state.close = () => { try { state.cdp?.close(); } catch {} };
  state.seek = time => h.exec('akari.preview.seekOutput', { editUri, time, waitForReady: true });
  state.play = () => h.exec('akari.preview.play', { editUri });
  state.pause = () => h.exec('akari.preview.pause', { editUri });
  return state;
}

/** webview の中の video / audio 要素と、枠（clip-frame）の要素・生成のオーバーレイの状態。 */
export const probeExpression = `(()=>{const tail=s=>String(s||'').replace(/^.*\\//,'').slice(-72);
  const vis=e=>{const cs=getComputedStyle(e),r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&r.width>0&&r.height>0};
  const frame=[...document.querySelectorAll('[data-akari-cut-id],[data-akari-layer-id]')].filter(e=>(e.dataset.akariCutId||e.dataset.akariLayerId)===${S(FRAME)})
    .map(e=>({tag:e.tagName,visible:vis(e),src:tail(e.currentSrc||e.src),currentTime:e.currentTime??null,paused:e.paused??null,muted:e.muted??null}));
  const videos=[...document.querySelectorAll('video')].map(v=>({id:v.dataset.akariCutId||v.dataset.akariLayerId||v.id||null,src:tail(v.currentSrc||v.src),
    currentTime:Number(v.currentTime.toFixed(3)),paused:v.paused,muted:v.muted,volume:v.volume,readyState:v.readyState,visible:vis(v),w:v.videoWidth,h:v.videoHeight}));
  const audios=[...document.querySelectorAll('audio')].map(a=>({id:a.id||a.dataset.akariAudioId||null,src:tail(a.currentSrc||a.src),currentTime:Number(a.currentTime.toFixed(3)),
    paused:a.paused,muted:a.muted,volume:a.volume,readyState:a.readyState}));
  const overlayText=[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&/動画予定|生成中|静止画/.test(e.textContent||'')&&vis(e)).map(e=>e.textContent.trim()).slice(0,6);
  const aurora=[...document.querySelectorAll('[class*="generation"],[data-akari-generation-overlay],[class*="aurora"]')].filter(vis).map(e=>e.className||e.tagName).slice(0,6);
  return{frame,videos,audios,overlayText,aurora}})()`;

/** プレビューに実際に描かれている色: 出力プレビューの舞台の中央 48×48 px を撮り、ffmpeg で 1 画素へ平均する。 */
export async function previewColor(cdp, preview, tmpDir) {
  const stageFrac = await preview.pv(`(()=>{const r=document.getElementById('overlay-stage').getBoundingClientRect();
    return{cx:(r.left+r.width/2)/innerWidth,cy:(r.top+r.height/2)/innerHeight}})()`);
  const frame = await evalOn(cdp, `(()=>{const f=[...document.querySelectorAll('iframe')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0)
    .sort((a,b)=>b.width*b.height-a.width*a.height)[0];return f?{x:f.left,y:f.top,w:f.width,h:f.height}:null})()`);
  const x = frame.x + frame.w * stageFrac.cx - 24, y = frame.y + frame.h * stageFrac.cy - 24;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 48, height: 48, scale: 1 } });
  const file = path.join(tmpDir, `pv-${Date.now()}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', c => chunks.push(c)); child.once('error', reject); child.once('close', () => resolve(Buffer.concat(chunks)));
  });
  await rm(file, { force: true });
  return [...out.subarray(0, 3)];
}
export const hue = ([r, g, b]) => r > 150 && g < 90 && b < 90 ? 'red' : g > 90 && r < 90 && b < 90 ? 'green' : b > 150 && r < 90 && g < 90 ? 'blue' : 'other';
export const readText = file => readFile(file, 'utf8');
