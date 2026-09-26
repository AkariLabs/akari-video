#!/usr/bin/env node
// 差し戻し r1 の再計測: 画角を押してからプレビューの枠が目標の形になるまでと、途中に出る縦横比の全記録。
//   node l1-r1-aspect-timing.mjs [--port=9636]
// l1-gen-frame-aspect.mjs と同じ一時プロジェクト・隔離した起動で、プレビューの内側に rAF ごとの記録係を置いて
// 押してから 3 秒間の枠の縦横比を取れるだけ取る（results-r1.json）。有償 API は呼ばない。
//   (a1) 16:9 → undo（1:1 に戻る）→ 9:16 / (a2) 1:1 → undo → 9:16: 500 ms 以内・押す前の形 → 目標の形 以外が出ない
//   (b)  9:16 → 1:1 → 16:9 を 300 ms 以内に続けて押す: 最後に 16:9・途中は 3 つの比率だけ
//   (c)  (ii) 9:16 (vi) 1:1 / 16:9 (vii) ドラッグの後に 9:16: 500 ms 以内・面積 1/4・中央を保つ
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const localElectron = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ELECTRON = await stat(localElectron).then(s => s.isFile()).catch(() => false)
  ? localElectron : path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/ai-still-routes-bin');
const PHASE = 'r1';
const AFTER = true;
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9636);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const KEEP = process.argv.includes('--keep'); // デバッグ用: 失敗時に Electron を残す
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-gen-frame-aspect-and-size-r1-')));
const PROJECT = path.join(ISO, 'project');
const STATE = path.join(ISO, 'image-state');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, clicks: [], screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, `results-${PHASE}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(temp, target);
}
async function stage(name) { results.step = name; console.log(`[${PHASE}] ${name}`); await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: !!pass, measured });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(`${name}: ${JSON.stringify(measured)}`);
}
async function waitEval(cdp, expression, name, timeout = 30_000, contextId) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression, contextId).catch(() => undefined);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out: ${name}`);
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-800)}`)));
});
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-photo', path: 'assets/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'clip-video', at: 0, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } },
      { id: 'clip-photo', at: 150, duration: 60, source: { kind: 'media', src: 'src-photo', in: 0, out: 2 } }
    ] }],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
}
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const allItems = doc => doc.tracks.flatMap(track => (track.items ?? []).map(item => ({ ...item, trackId: track.id })));
const frameItems = async () => allItems(await readEdit()).filter(row => String(row.id).startsWith('frame-'));
const itemSnapshot = async id => {
  const doc = await readEdit();
  const item = allItems(doc).find(row => row.id === id);
  if (!item) return null;
  const source = doc.sources.find(row => row.id === item.source?.src);
  return { id, trackId: item.trackId, trackIndex: doc.tracks.findIndex(t => t.id === item.trackId), at: item.at, duration: item.duration,
    transform: item.transform ?? null, sourcePath: source?.path ?? null };
};
async function clearNotifications(cdp) {
  await evalOn(cdp, `(async()=>{try{const c=window.theia?.container;const d=c?._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand('notifications.commands.clearAll');}catch{}return true})()`).catch(() => undefined);
}
async function settle(cdp) {
  await evalOn(cdp, `(()=>new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(x=>document.querySelector(x)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const o=new MutationObserver(reset);o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return o});
    function finish(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,500)}limit=setTimeout(finish,30000);reset()}) )()`);
}
async function pointOf(cdp, selector) {
  return waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
    // 再生ヘッドの線などが真ん中に重なることがあるので、横に何点か試す
    for(const f of [0.5,0.25,0.75,0.15,0.85]){const x=b.left+b.width*f,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===e||e.contains(hit)))return{x,y}}return null})()`, `click target ${selector}`);
}
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await clearNotifications(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      results.clicks.push({ name, attempt, passed: true });
      return;
    } catch (error) {
      results.clicks.push({ name, attempt, passed: false, reason: clean(error?.message ?? error) });
      if (attempt === 3) throw error;
    }
  }
}
async function shot(cdp, name) {
  await clearNotifications(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  results.screenshots.push({ name, bytes: bytes.length });
  await save();
}
async function waitForExit(child, ms = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => { const t = setTimeout(() => resolve(false), ms); child.once('exit', () => { clearTimeout(t); resolve(true); }); });
}
const inspectPanel = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const tabs=[...(root?.querySelectorAll('[data-akari-ui^="tab:inspector-"]')??[])].map(e=>({id:e.getAttribute('data-akari-ui').slice(14),
    label:e.textContent.trim(),active:e.classList.contains('is-active')||e.getAttribute('aria-selected')==='true'}));
  const back=root?.querySelector('.akari-inspector-ai-back');
  const aspects=[...(root?.querySelectorAll('[data-akari-inspector-ai-aspect]')??[])].map(e=>{const r=e.getBoundingClientRect();
    const shapes=[...e.querySelectorAll('svg,[class*="shape"],[class*="icon"],[class*="figure"],span,i,div')].map(s=>{const b=s.getBoundingClientRect();
      return{tag:s.tagName.toLowerCase(),cls:String(s.getAttribute('class')??''),w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10}}).filter(s=>s.w>0&&s.h>0);
    return{aspect:e.getAttribute('data-akari-inspector-ai-aspect'),text:e.textContent.trim(),pressed:e.getAttribute('aria-pressed'),
      label:e.getAttribute('aria-label'),w:Math.round(r.width),h:Math.round(r.height),shapes}});
  return{tabs,activeTab:tabs.find(t=>t.active)?.id??null,
    header:root?.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()??null,
    sections:[...(root?.querySelectorAll('[data-akari-ui^="section:inspector-"]')??[])].map(e=>e.getAttribute('data-akari-ui').slice(18)),
    stillPanel:!!root?.querySelector('[data-akari-inspector-ai-create="true"]'),
    backText:back?back.textContent.trim():null,backTitle:back?.getAttribute('title')??null,backAria:back?.getAttribute('aria-label')??null,
    notYet:(root?.textContent.match(/この要素で使える補正はまだありません/g)??[]).length,
    correctionSection:!!root?.querySelector('[data-akari-ui="section:inspector-edit-correction"]'),
    aspects}})()`;
const tabActive = id => `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-${id}"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
async function openTab(cdp, id) {
  if (!await evalOn(cdp, tabActive(id))) await clickUntil(cdp, `[data-akari-ui="tab:inspector-${id}"]`, tabActive(id), `open ${id} tab`);
}
const headerIs = text => `document.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()===${S(text)}`;
const headerHas = text => `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes(${S(text)})`;
// 編集パネルの見出しは素材のファイル名
const headerOfItem = async id => headerIs(path.basename((await itemSnapshot(id)).sourcePath));
// 一番下のトラック（V1）の要素はカット（timeline:cut:<items の並び順>）、それより上はレイヤー（data-akari-item-id=<id>）
async function timelineSelector(id) {
  const doc = await readEdit();
  const base = doc.tracks[0];
  const order = (base.items ?? []).map(item => item.id); // カットの番号は edit.json の並び順
  const index = order.indexOf(id);
  return index >= 0 ? `[data-akari-ui="timeline:cut:${index}"]` : `[data-akari-ui="panel:timeline"] [data-akari-item-id="${id}"]`;
}
async function selectItem(cdp, id, expectation) {
  const selector = await timelineSelector(id);
  await clickUntil(cdp, selector, expectation, `select ${id}`);
}
function close(a, b, eps) { return Math.abs(a - b) <= eps; }

let electron, cdp, preview;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  await writeFile(STATE, 'ready');
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), FAKE_IMAGE_STATE_FILE: STATE };
  for (const name of ['FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1000', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  results.observations.electronPid = electron.pid;
  console.log(`[${PHASE}] electron pid ${electron.pid}`);
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  const command = (id, arg) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    const r=await c.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});try{return JSON.stringify(r??null)}catch{return String(r)}})()`;
  const exec = (id, arg) => evalOn(cdp, command(id, arg));
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await exec('akari.annotations.open');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900_000);
  await exec('akari.inspector.open').catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await stage('waiting for preload to clear');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    results.observations.previewOpen = opened;
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="preview-context-bar"]'))`, 'preview context bar', 120_000);

  // 出力プレビュー（入れ子の webview の内側）へつなぐ
  await stage('connect preview frame');
  // 見えている出力プレビューの内側の文脈を選ぶ（隠れた古い webview や作り直し途中の文書を避ける）
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const connectPreview = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const targets = (await listTargets(PORT)).filter(t => t.type === 'iframe' || t.type === 'webview');
      const candidates = [];
      for (const t of targets) {
        let sub;
        try {
          sub = new CDP(t.webSocketDebuggerUrl);
          await withTimeout(sub.connect(), 15000);
          const contexts = [];
          sub.on('Runtime.executionContextCreated', p => contexts.push(p.context));
          await withTimeout(sub.send('Page.enable'), 15000); await withTimeout(sub.send('Runtime.enable'), 15000);
          await sleep(1500);
          let inner, outer, score = -1;
          for (const c of contexts) {
            const info = await withTimeout(evalOn(sub, `(()=>{const o=document.getElementById('overlay-stage');if(o){const r=o.getBoundingClientRect();
              return{kind:'inner',visible:document.visibilityState==='visible'&&r.width>0&&r.height>0,layers:document.querySelectorAll('[data-akari-layer-id]').length}}
              return document.getElementById('active-frame')?{kind:'outer'}:null})()`, c.id), 10000).catch(() => null);
            if (info?.kind === 'outer') outer = c.id;
            if (info?.kind === 'inner') { const sc = (info.visible ? 1000 : 0) + info.layers; if (sc > score) { score = sc; inner = c.id; } }
          }
          if (inner && (score >= 1000 || attempt >= 5)) candidates.push({ cdp: sub, inner, outer, score });
          else sub.close();
        } catch { try { sub?.close(); } catch {} }
      }
      if (candidates.length) {
        candidates.sort((a, b) => b.score - a.score);
        for (const extra of candidates.slice(1)) { try { extra.cdp.close(); } catch {} }
        return candidates[0];
      }
      await sleep(1000);
    }
    throw new Error('preview content context not found');
  };
  const reconnectPreview = async () => {
    results.observations.previewReconnects = (results.observations.previewReconnects ?? 0) + 1;
    try { preview.cdp.close(); } catch {}
    preview = await connectPreview();
  };
  preview = await connectPreview();
  // プレビューは edit.json の構造が変わると作り直されることがあるので、文脈が消えたらつなぎ直す
  const pv = async expression => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await withTimeout(evalOn(preview.cdp, expression, preview.inner), 10_000); }
      catch (error) {
        if (attempt === 2) throw error;
        await reconnectPreview();
      }
    }
  };
  const waitPv = async (expression, name, timeout = 30_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const value = await pv(expression).catch(() => undefined);
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`Timed out: ${name}`);
  };
  // 枠の形: レイヤー要素と選択枠の矩形を、キャンバス（#overlay-stage）に対する比で読む
  const frameGeometry = id => pv(`(()=>{const c=document.getElementById('overlay-stage').getBoundingClientRect();
    const rel=r=>r&&r.width&&r.height?{x:(r.left-c.left)/c.width,y:(r.top-c.top)/c.height,w:r.width/c.width,h:r.height/c.height,
      cx:(r.left+r.width/2-c.left)/c.width,cy:(r.top+r.height/2-c.top)/c.height,aspect:r.width/r.height,area:(r.width*r.height)/(c.width*c.height)}:null;
    const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(id)});
    const vis=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;
    const box=document.getElementById('layer-select-box');const bs=box&&getComputedStyle(box).display!=='none'&&!box.hidden?box.getBoundingClientRect():null;
    const cutEl=[...document.querySelectorAll('[data-akari-cut-id]')].find(e=>e.dataset.akariCutId===${S(id)}&&getComputedStyle(e).display!=='none');
    const cb=document.getElementById('cut-select-box');const cbs=cb&&getComputedStyle(cb).display!=='none'?cb.getBoundingClientRect():null;
    return{canvas:{w:c.width,h:c.height},layer:rel(vis),selectBox:rel(bs),cut:rel(cutEl?.getBoundingClientRect()),cutSelectBox:rel(cbs),src:el?.currentSrc||el?.src||null,
      data:el?{x:el.dataset.akariTransformX,y:el.dataset.akariTransformY,scale:el.dataset.akariTransformScale,scaleX:el.dataset.akariTransformScaleX??null,scaleY:el.dataset.akariTransformScaleY??null}:null}})()`);
  // 入れ子の webview の位置（ページ座標 = 外側 iframe + #active-frame + 内側の座標）
  const previewOffset = async () => {
    const outer = preview.outer ? await evalOn(preview.cdp, `(()=>{const a=document.getElementById('active-frame').getBoundingClientRect();return{w:innerWidth,h:innerHeight,ax:a.left,ay:a.top}})()`, preview.outer) : { w: 0, h: 0, ax: 0, ay: 0 };
    const frames = await evalOn(cdp, `[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}}).filter(r=>r.w>0&&r.h>0)`);
    const host = frames.find(f => close(f.w, outer.w, 2) && close(f.h, outer.h, 2)) ?? frames.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return { x: host.x + outer.ax, y: host.y + outer.ay, outer, host };
  };

  // プレビューが作り直されると時刻が 0 へ戻るので、枠が見えるまでシークし直す
  const seekUntilVisible = async (id, seconds, name) => {
    const visible = `(()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(id)})
      ??[...document.querySelectorAll('[data-akari-cut-id]')].find(e=>e.dataset.akariCutId===${S(id)}&&getComputedStyle(e).display!=='none');
      return !!el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0})()`;
    const until = Date.now() + 240_000;
    for (let round = 1; Date.now() < until; round++) {
      await exec('akari.timeline.seek', { seconds });
      const end = Date.now() + 5000;
      while (Date.now() < end) { if (await pv(visible).catch(() => false)) return true; await sleep(200); }
      if (round % 4 === 0) await reconnectPreview();
    }
    throw new Error(`Timed out: ${name}`);
  };
  await stage('01 draw an empty frame above V1 (new V2)');
  const drawFrame = async (name, fromTo) => {
    const before = new Set((await frameItems()).map(row => row.id));
    let created;
    for (let attempt = 1; attempt <= 3 && !created; attempt++) {
      await exec('akari.timeline.setTool', { tool: 'frame' });
      await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
      await settle(cdp);
      await clearNotifications(cdp);
      const { from, to } = await fromTo();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
        await sleep(60);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
      const until = Date.now() + 30_000;
      while (Date.now() < until && !(created = (await frameItems()).find(row => !before.has(row.id)))) await sleep(200);
      results.clicks.push({ name, attempt, passed: !!created });
    }
    if (!created) throw new Error(`${name}: empty frame was not written to edit.json`);
    await exec('akari.timeline.setTool', { tool: 'select' });
    return created.id;
  };
  const v2Frame = await drawFrame('draw V2 frame', async () => {
    const g = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();return{left:b.left,right:b.right,top:b.top}})()`);
    return { from: { x: g.left + 8, y: g.top - 14 }, to: { x: g.right - 8, y: g.top - 14 } };
  });
  results.observations.v2Frame = await itemSnapshot(v2Frame);
  await waitEval(cdp, headerHas('frame-'), 'V2 frame selected', 30_000).catch(() => undefined);
  if (!await evalOn(cdp, (await headerOfItem(v2Frame)))) await selectItem(cdp, v2Frame, (await headerOfItem(v2Frame)));
  await seekUntilVisible(v2Frame, 1.5, 'V2 frame visible in preview').catch(async error => {
    results.observations.previewDump = await pv(`(()=>({engine:document.getElementById('preview-stage')?.dataset?.frameEngineActive??null,
      layers:[...document.querySelectorAll('[data-akari-layer-id]')].map(e=>({tag:e.tagName,id:e.dataset.akariLayerId,display:getComputedStyle(e).display,r:(b=>[b.left,b.top,b.width,b.height].map(Math.round))(e.getBoundingClientRect())}))}))()`).catch(e => String(e));
    await save();
    throw error;
  });
  await sleep(800);
  const v2Initial = await frameGeometry(v2Frame);
  results.observations.v2FrameInitial = v2Initial;
  await shot(cdp, `${PHASE}-01-v2-frame-preview.png`);
  if (!AFTER) check('BEFORE: V1 の上の空の枠がキャンバス全面（再現）', close(v2Initial.layer.w, 1, 0.01) && close(v2Initial.layer.h, 1, 0.01), v2Initial);
  else {
    check('V1 の上に描いた空の枠が幅 50%・中央（edit.json の変形）', close(v2Initial.layer.w, 0.5, 0.01) && close(v2Initial.layer.h, 0.5, 0.01)
      && close(v2Initial.layer.cx, 0.5, 0.005) && close(v2Initial.layer.cy, 0.5, 0.005), { geometry: v2Initial, item: results.observations.v2Frame });
  }

  // r1 の判定は止めずに全部記録する（不合格があれば最後に exit 1）
  const soft = (name, pass, measured) => { results.checks.push({ name, pass: !!pass, measured }); console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`); };
  await stage('open the still panel');
  const ensureStillPanel = async () => {
    const headerOfItemExpr = await headerOfItem(v2Frame);
    if (!await evalOn(cdp, headerOfItemExpr)) await selectItem(cdp, v2Frame, headerOfItemExpr);
    await openTab(cdp, 'edit');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
    }
    await settle(cdp);
  };
  await ensureStillPanel();
  const playhead = async () => Number(JSON.parse(await exec('akari.timeline.playhead')));
  // プレビューの内側に rAF ごとの記録係を置き（時刻は読んだ瞬間の performance.now。rAF の引数はフレームの開始時刻で読みより早いので使わない）、Node からの読み取りのたびに溜まった分を回収する。
  // プレビューが作り直されて記録係が消えても、次の読み取りで置き直す。Node 側の読み取り結果も 1 件として残す
  const sampleExpr = `(()=>{const id=${S(v2Frame)};const read=t=>{const cv=document.getElementById('overlay-stage');if(!cv)return{t,a:null,w:null,h:null};
      const c=cv.getBoundingClientRect();const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===id);
      const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;
      return{t,a:r&&r.height?r.width/r.height:null,w:r?r.width/c.width:null,h:r?r.height/c.height:null,cx:r?(r.left+r.width/2-c.left)/c.width:null,cy:r?(r.top+r.height/2-c.top)/c.height:null}};
    if(!window.__l1Rec){const rec=window.__l1Rec={buf:[]};const tick=()=>{rec.buf.push({via:'raf',...read(performance.timeOrigin+performance.now())});if(rec.buf.length>4000)rec.buf.splice(0,rec.buf.length-4000);requestAnimationFrame(tick)};requestAnimationFrame(tick)}
    const out=window.__l1Rec.buf.splice(0);out.push({via:'poll',...read(performance.timeOrigin+performance.now())});return out})()`;
  const aspectPoint = async aspect => pointOf(cdp, `[data-akari-inspector-ai-aspect="${aspect}"]`);
  const ratioOf = aspect => { const [a, b] = aspect.split(':').map(Number); return a / b; };
  const isAspect = (value, aspect) => value !== null && close(value, ratioOf(aspect), ratioOf(aspect) * 0.03);
  const nameOf = value => value === null ? 'hidden' : (['16:9', '9:16', '1:1'].find(aspect => isAspect(value, aspect)) ?? `other ${value.toFixed(3)}`);
  // 画角を順に押し、最後に押してから windowMs の間プレビューの枠を取れるだけ取り続ける
  const pressSequence = async (sequence, { gapMs = 0, windowMs = 3000 } = {}) => {
    await ensureStillPanel();
    const before = await itemSnapshot(v2Frame);
    const playheadBefore = await playhead();
    const points = [];
    for (const aspect of sequence) points.push(await aspectPoint(aspect));
    await evalOn(cdp, `(()=>{window.__l1Downs=[];for(const b of document.querySelectorAll('[data-akari-inspector-ai-aspect]'))
      if(!b.__l1Hooked){b.__l1Hooked=true;b.addEventListener('pointerdown',e=>{window.__l1Downs.push({aspect:e.currentTarget.getAttribute('data-akari-inspector-ai-aspect'),t:performance.timeOrigin+e.timeStamp})},{capture:true})}
      document.addEventListener('pointerdown',e=>{const b=e.target.closest?.('[data-akari-inspector-ai-aspect]');if(b&&!b.__l1Hooked)window.__l1Downs.push({aspect:b.getAttribute('data-akari-inspector-ai-aspect'),t:performance.timeOrigin+e.timeStamp,late:true})},{capture:true,once:false});return true})()`);
    const initial = await pv(sampleExpr).catch(() => []);
    const priorShape = nameOf(initial.at(-1)?.a ?? null);
    const samples = [];
    let stopAt = Infinity;
    let gaps = 0;
    const sampler = (async () => {
      while (Date.now() < stopAt) {
        const rows = await pv(sampleExpr).catch(() => { gaps++; return null; });
        if (rows) samples.push(...rows);
      }
    })();
    for (let index = 0; index < points.length; index++) {
      if (index && gapMs) await sleep(gapMs);
      await realClick(cdp, points[index].x, points[index].y);
    }
    stopAt = Date.now() + windowMs;
    await sampler;
    const downs = (await evalOn(cdp, 'window.__l1Downs')).filter((row, i, all) => all.findIndex(o => Math.abs(o.t - row.t) < 1) === i);
    const firstDown = downs[0]?.t ?? NaN;
    const lastDown = downs.at(-1)?.t ?? NaN;
    const target = sequence.at(-1);
    const ordered = samples.filter(row => row.t >= firstDown).sort((x, y) => x.t - y.t);
    const withShape = ordered.map(row => ({ ms: Math.round((row.t - firstDown) * 10) / 10, via: row.via, shape: nameOf(row.a),
      a: row.a === null ? null : Math.round(row.a * 1000) / 1000, w: row.w === null ? null : Math.round(row.w * 1000) / 1000,
      h: row.h === null ? null : Math.round(row.h * 1000) / 1000, cx: row.cx === null ? null : Math.round(row.cx * 1000) / 1000,
      cy: row.cy === null ? null : Math.round(row.cy * 1000) / 1000 }));
    const transitions = [];
    for (const row of withShape) if (transitions.at(-1)?.shape !== row.shape) transitions.push({ ms: row.ms, shape: row.shape, a: row.a, w: row.w, h: row.h });
    const firstTarget = withShape.find(row => row.shape === target && row.ms >= Math.round((lastDown - firstDown) * 10) / 10);
    const firstTargetAny = withShape.find(row => row.shape === target);
    await settle(cdp);
    await sleep(300);
    const geometry = await frameGeometry(v2Frame);
    const after = await itemSnapshot(v2Frame);
    const playheadAfter = await playhead();
    return { sequence, gapMs, priorShape, downs: downs.map(row => ({ aspect: row.aspect, msFromFirst: Math.round(row.t - firstDown) })),
      pressSpreadMs: Math.round(lastDown - firstDown), target, targetMsFromLastPress: firstTarget ? Math.round(firstTarget.ms - (lastDown - firstDown)) : null,
      targetMsFromFirstPress: firstTargetAny ? Math.round(firstTargetAny.ms) : null, sampleCount: withShape.length,
      rafSamples: withShape.filter(row => row.via === 'raf').length, pollSamples: withShape.filter(row => row.via === 'poll').length, pollGaps: gaps,
      shapesSeen: [...new Set(withShape.map(row => row.shape))], transitions, playheadBefore, playheadAfter, before, after, geometry, samples: withShape };
  };
  // 押してから目標の形になるまで、目標以外の縦横比が 1 度も出ないか（押す前の形 → 目標、の 2 つだけ）
  const onlyPriorThenTarget = row => {
    let reached = false;
    for (const sample of row.samples) {
      if (sample.shape === 'hidden') continue;
      if (sample.shape === row.target) { reached = true; continue; }
      if (reached || sample.shape !== row.priorShape) return false;
    }
    return reached;
  };
  const foreign = (row, allowed) => row.samples.filter(sample => sample.shape !== 'hidden' && !allowed.includes(sample.shape));
  const geometryHolds = (row, cx = 0.5, cy = 0.5) => close(row.geometry.layer.area, 0.25, 0.01) && close(row.geometry.layer.cx, cx, 0.005)
    && close(row.geometry.layer.cy, cy, 0.005) && close(row.geometry.layer.aspect, ratioOf(row.target), ratioOf(row.target) * 0.02);
  const undoAndShow = async (label, expectAspect) => {
    const beforeUndo = await itemSnapshot(v2Frame);
    await exec('akari.timeline.undo');
    const until = Date.now() + 15_000;
    let undone = beforeUndo;
    while (Date.now() < until && undone.sourcePath === beforeUndo.sourcePath) { await sleep(100); undone = await itemSnapshot(v2Frame); }
    const shapeIs = `(()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(v2Frame)});
      const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;return !!r&&Math.abs(r.width/r.height-${ratioOf(expectAspect)})<${ratioOf(expectAspect) * 0.03}})()`;
    const shown = await waitPv(shapeIs, `${label}: undo shows ${expectAspect}`, 6000).then(() => true).catch(() => false);
    if (!shown) await seekUntilVisible(v2Frame, 1.5, `${label}: frame visible after undo`);
    await waitPv(shapeIs, `${label}: undo shows ${expectAspect}`, 20_000);
    return { beforeUndo, undone, reseeked: !shown };
  };
  const record = (key, row) => { results.observations[key] = row; return row; };

  await stage('(c)(ii) press 9:16');
  const r916 = record('ii_press916', await pressSequence(['9:16']));
  await shot(cdp, 'r1-c-ii-9x16.png');
  await stage('(c)(vi) press 1:1, 16:9');
  const r11 = record('vi_press11', await pressSequence(['1:1']));
  await shot(cdp, 'r1-c-vi-1x1.png');
  const r169 = record('vi_press169', await pressSequence(['16:9']));
  await shot(cdp, 'r1-c-vi-16x9.png');
  for (const row of [r916, r11, r169]) {
    soft(`(c) ${row.target} を押すと 0.5 秒以内に形が変わる（${row.targetMsFromLastPress} ms）`, row.targetMsFromLastPress !== null && row.targetMsFromLastPress <= 500,
      { ms: row.targetMsFromLastPress, transitions: row.transitions });
    soft(`(c) ${row.target}: 途中で目標以外の比率が出ない`, onlyPriorThenTarget(row), { prior: row.priorShape, transitions: row.transitions });
    soft(`(c) ${row.target}: 面積 1/4・中央を保つ`, geometryHolds(row), row.geometry);
    soft(`(c) ${row.target}: 再生位置が変わらない`, close(row.playheadAfter, row.playheadBefore, 0.05), { before: row.playheadBefore, after: row.playheadAfter });
  }

  await stage('(a1) 16:9 → undo（1:1 に戻る）→ 9:16');
  const undo1 = record('a1_undo', await undoAndShow('a1', '1:1'));
  soft('(a1) undo 1 回で 1:1 の source に戻る', undo1.undone.sourcePath === r11.after.sourcePath, undo1);
  const a1 = record('a1_press916', await pressSequence(['9:16']));
  await shot(cdp, 'r1-a1-undo-then-9x16.png');
  soft(`(a1) 1:1 → undo → 9:16: 500 ms 以内に 9:16（${a1.targetMsFromLastPress} ms）`, a1.targetMsFromLastPress !== null && a1.targetMsFromLastPress <= 500,
    { ms: a1.targetMsFromLastPress, transitions: a1.transitions });
  soft('(a1) 途中で目標以外の縦横比が 1 度も出ない（押す前の 1:1 → 9:16 のみ）', onlyPriorThenTarget(a1), { prior: a1.priorShape, transitions: a1.transitions });
  soft('(a1) 面積 1/4・中央', geometryHolds(a1), a1.geometry);

  await stage('(a2) 16:9 にしてから 1:1 → undo（16:9 に戻る）→ 9:16');
  record('a2_setup169', await pressSequence(['16:9'], { windowMs: 1500 }));
  const a2press11 = record('a2_press11', await pressSequence(['1:1'], { windowMs: 1500 }));
  const undo2 = record('a2_undo', await undoAndShow('a2', '16:9'));
  soft('(a2) undo 1 回で 16:9 の source に戻る', undo2.undone.sourcePath !== a2press11.after.sourcePath, undo2);
  const a2 = record('a2_press916', await pressSequence(['9:16']));
  await shot(cdp, 'r1-a2-1x1-undo-then-9x16.png');
  soft(`(a2) 1:1 → undo → 9:16: 500 ms 以内に 9:16（${a2.targetMsFromLastPress} ms）`, a2.targetMsFromLastPress !== null && a2.targetMsFromLastPress <= 500,
    { ms: a2.targetMsFromLastPress, transitions: a2.transitions });
  soft('(a2) 途中で目標以外の縦横比が 1 度も出ない（押す前の 16:9 → 9:16 のみ）', onlyPriorThenTarget(a2), { prior: a2.priorShape, transitions: a2.transitions });
  soft('(a2) 面積 1/4・中央', geometryHolds(a2), a2.geometry);

  await stage('(b) 9:16 → 1:1 → 16:9 を 300 ms 以内に続けて押す');
  record('b_setup169', await pressSequence(['16:9'], { windowMs: 1500 }));
  const b = record('b_rapid', await pressSequence(['9:16', '1:1', '16:9'], { gapMs: 60 }));
  await shot(cdp, 'r1-b-rapid-final-16x9.png');
  soft(`(b) 3 回の押下が 300 ms 以内（${b.pressSpreadMs} ms）`, b.downs.length === 3 && b.pressSpreadMs <= 300 && S(b.downs.map(d => d.aspect)) === S(['9:16', '1:1', '16:9']), b.downs);
  soft('(b) 最後に 16:9 の形になる', geometryHolds(b) && b.samples.at(-1)?.shape === '16:9', { geometry: b.geometry, last: b.samples.at(-1) });
  soft('(b) 途中に出る比率が 9:16 / 1:1 / 16:9 のどれかだけ', foreign(b, ['9:16', '1:1', '16:9']).length === 0, { foreign: foreign(b, ['9:16', '1:1', '16:9']).slice(0, 20), transitions: b.transitions });
  soft('(b) edit.json も最後の 16:9 の source', b.after.sourcePath !== b.before.sourcePath && !String(b.after.sourcePath).includes('9x16'), { before: b.before, after: b.after });
  results.observations.b_lastPressThenOnlyTarget = (() => { const last = b.downs.at(-1)?.msFromFirst ?? 0; const reached = b.samples.findIndex(s => s.ms >= last && s.shape === '16:9');
    return reached < 0 ? null : b.samples.slice(reached).filter(s => s.shape !== 'hidden' && s.shape !== '16:9').length === 0; })();

  await stage('(c)(vii) 1:1 → undo → drag → 9:16');
  record('vii_press11', await pressSequence(['1:1'], { windowMs: 1500 }));
  record('vii_undo', await undoAndShow('vii', '16:9'));
  const offset = await previewOffset();
  const g = await frameGeometry(v2Frame);
  const canvasRect = await pv(`(()=>{const c=document.getElementById('overlay-stage').getBoundingClientRect();return{x:c.left,y:c.top,w:c.width,h:c.height}})()`);
  const start = { x: offset.x + canvasRect.x + canvasRect.w * g.layer.cx, y: offset.y + canvasRect.y + canvasRect.h * g.layer.cy };
  const end = { x: start.x - canvasRect.w * 0.2, y: start.y - canvasRect.h * 0.15 };
  const drag = record('vii_drag', { before: await itemSnapshot(v2Frame), geometryBefore: g });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  for (let step = 1; step <= 16; step++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 16, y: start.y + (end.y - start.y) * step / 16, button: 'left', buttons: 1 });
    await sleep(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
  const movedUntil = Date.now() + 15_000;
  let moved;
  while (Date.now() < movedUntil) {
    moved = await itemSnapshot(v2Frame);
    if (S(moved.transform) !== S(drag.before.transform)) break;
    await sleep(200);
  }
  await sleep(800);
  const movedGeometry = await frameGeometry(v2Frame);
  drag.after = moved; drag.geometryAfter = movedGeometry;
  soft('(vii) プレビューで枠をドラッグで動かせる', S(moved.transform) !== S(drag.before.transform) && !close(movedGeometry.layer.cx, 0.5, 0.02), drag);
  await shot(cdp, 'r1-c-vii-moved.png');
  const vii = record('vii_press916', await pressSequence(['9:16']));
  await shot(cdp, 'r1-c-vii-moved-then-9x16.png');
  soft(`(vii) 動かした後（undo の後）に 9:16: 500 ms 以内（${vii.targetMsFromLastPress} ms）`, vii.targetMsFromLastPress !== null && vii.targetMsFromLastPress <= 500,
    { ms: vii.targetMsFromLastPress, transitions: vii.transitions });
  soft('(vii) 途中で目標以外の縦横比が出ない', onlyPriorThenTarget(vii), { prior: vii.priorShape, transitions: vii.transitions });
  soft('(vii) 中央の位置と面積 1/4 を保つ', geometryHolds(vii, movedGeometry.layer.cx, movedGeometry.layer.cy), { moved: movedGeometry, after: vii.geometry });
  results.observations.summary = [['ii 9:16', r916], ['vi 1:1', r11], ['vi 16:9', r169], ['a1 1:1→undo→9:16', a1], ['a2 1:1→undo→9:16', a2],
    ['b 9:16→1:1→16:9', b], ['vii drag→9:16', vii]].map(([name, row]) => ({ name, ms: row.targetMsFromLastPress, pressSpreadMs: row.pressSpreadMs,
    shapesSeen: row.shapesSeen, samples: row.sampleCount, raf: row.rafSamples, poll: row.pollSamples, area: row.geometry.layer.area, cx: row.geometry.layer.cx, cy: row.geometry.layer.cy }));

  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
  console.error(results.error);
  if (cdp) { try { await shot(cdp, `error-${PHASE}.png`); } catch {} }
} finally {
  results.step = 'cleanup';
  if (KEEP && results.status !== 'PASS') { console.log(`KEEP: electron pid ${electron?.pid} port ${PORT} iso ${ISO}`); await save(); process.exit(1); }
  try { preview?.cdp?.close(); } catch {}
  try { cdp?.close(); } catch {}
  if (electron?.pid) {
    try {
      if (electron.exitCode === null && electron.signalCode === null) process.kill(electron.pid, 'SIGTERM');
      if (!await waitForExit(electron)) { process.kill(electron.pid, 'SIGKILL'); await waitForExit(electron); }
    } catch (error) { results.cleanupError = clean(error?.message ?? error); }
  }
  await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => { results.cleanupError = clean(error); });
  await save();
}
if (results.status !== 'PASS' || results.checks.some(row => !row.pass)) process.exitCode = 1;
