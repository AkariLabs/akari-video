#!/usr/bin/env node
// 仮枠の既定の大きさ・画角の図とプレビューへの即時反映・G6 の申し送り 3 点を実機で撮る（BEFORE / AFTER 共通）。
//   node l1-gen-frame-aspect.mjs --phase=before|after [--port=9636]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + すき間 + 写真 5〜7 秒）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。有償 API は呼ばない。
//   01 V1 の上（新しい V2）に仮枠ツールで描いた空の枠のプレビュー（AFTER: 幅 50%・中央）
//   02 その枠の静止画の専用パネルで 9:16 を押した後のプレビュー（BEFORE: 変わらない / AFTER: 0.5 秒以内に 9:16 の形）
//   03 映像タブを一度開いてから空の枠を選んだときのタブ（AFTER: ホーム）
//   04 専用パネルの戻るの文言（AFTER: ← ホーム）
//   05 ふつうの動画のホーム（AFTER: 「まだありません」の補正の節が無い）
//   06 (AFTER) 一番下のトラックのすき間に描いた空の枠は全画面
//   07 (AFTER) 9:16 → 1:1 → 16:9 のプレビューの枠（3 枚）と押してから形が変わるまでのミリ秒・undo 1 回で 1:1 へ戻る
//   08 (AFTER) 枠をドラッグで動かした後に画角を変えても中央の位置が保たれる
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
const PHASE = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'after';
if (!['before', 'after'].includes(PHASE)) throw new Error('--phase must be before or after');
const AFTER = PHASE === 'after';
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9636);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const KEEP = process.argv.includes('--keep'); // デバッグ用: 失敗時に Electron を残す
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-gen-frame-aspect-and-size-')));
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
  await shot(cdp, `01-${PHASE}-v2-frame-preview.png`);
  if (!AFTER) check('BEFORE: V1 の上の空の枠がキャンバス全面（再現）', close(v2Initial.layer.w, 1, 0.01) && close(v2Initial.layer.h, 1, 0.01), v2Initial);
  else {
    check('V1 の上に描いた空の枠が幅 50%・中央（edit.json の変形）', close(v2Initial.layer.w, 0.5, 0.01) && close(v2Initial.layer.h, 0.5, 0.01)
      && close(v2Initial.layer.cx, 0.5, 0.005) && close(v2Initial.layer.cy, 0.5, 0.005), { geometry: v2Initial, item: results.observations.v2Frame });
  }

  await stage('02 still panel: press 9:16');
  await openTab(cdp, 'edit');
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
  }
  await settle(cdp);
  const stillPanel = await evalOn(cdp, inspectPanel);
  results.observations.stillPanel = stillPanel;
  // 画角を押してからプレビューの枠の形が変わるまでを、押した瞬間（pointerdown）と内側の rAF の時刻で測る
  const playhead = async () => Number(JSON.parse(await exec('akari.timeline.playhead')));
  const pressAspect = async (aspect, expectAspect) => {
    const before = await itemSnapshot(v2Frame);
    const playheadBefore = await playhead();
    await evalOn(cdp, `(()=>{window.__l1Down=null;const b=document.querySelector('[data-akari-inspector-ai-aspect=${S(aspect)}]');
      b.addEventListener('pointerdown',e=>{window.__l1Down=performance.timeOrigin+e.timeStamp},{once:true,capture:true});return true})()`);
    const point = await pointOf(cdp, `[data-akari-inspector-ai-aspect="${aspect}"]`);
    const sampleExpr = `(()=>{const c=document.getElementById('overlay-stage').getBoundingClientRect();const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(v2Frame)});
      const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;
      const box=document.getElementById('layer-select-box');const b=box&&getComputedStyle(box).display!=='none'&&!box.hidden?box.getBoundingClientRect():null;
      return{a:r&&r.height?r.width/r.height:null,w:r?r.width/c.width:null,h:r?r.height/c.height:null,ba:b&&b.height?b.width/b.height:null}})()`;
    await realClick(cdp, point.x, point.y);
    // Node から連続で読む（プレビューが作り直されても測れるように）。時刻は読んだ値が返ってきた時点 = 上側に寄せた値
    const samples = [];
    const stopAt = Date.now() + 4000;
    while (Date.now() < stopAt) {
      const value = await pv(sampleExpr).catch(() => null);
      if (value) samples.push({ t: Date.now(), ...value });
    }
    const down = await evalOn(cdp, 'window.__l1Down');
    const first = samples.find(s => s.t >= down && s.a !== null && close(s.a, expectAspect, expectAspect * 0.03));
    const boxFirst = samples.find(s => s.t >= down && s.ba !== null && close(s.ba, expectAspect, expectAspect * 0.03));
    await settle(cdp);
    const geometry = await frameGeometry(v2Frame);
    const after = await itemSnapshot(v2Frame);
    // プレビューの枠の見え方の移り変わり（押してからのミリ秒・縦横比・幅・高さ。値が変わった時点だけ）
    const transitions = [];
    for (const sample of samples.filter(row => row.t >= down)) {
      const shape = sample.a === null ? 'hidden' : `${sample.a.toFixed(3)} ${sample.w.toFixed(3)}x${sample.h.toFixed(3)}`;
      if (transitions.at(-1)?.shape !== shape) transitions.push({ ms: Math.round(sample.t - down), shape });
    }
    const playheadAfter = await playhead();
    const row = { aspect, playheadBefore, playheadAfter, transitions, pointerdownEpochMs: down, layerShapeChangedMs: first ? Math.round(first.t - down) : null,
      selectBoxShapeChangedMs: boxFirst ? Math.round(boxFirst.t - down) : null, samples: samples.length, before, after, geometry,
      panelAspects: (await evalOn(cdp, inspectPanel)).aspects };
    return row;
  };
  const press916 = await pressAspect('9:16', 9 / 16);
  results.observations.press916 = press916;
  await shot(cdp, `02-${PHASE}-pressed-9x16-preview.png`);
  if (!AFTER) check('BEFORE: 9:16 を押してもプレビューの枠は変わらない（再現）', press916.layerShapeChangedMs === null
    && close(press916.geometry.layer.w, 1, 0.01) && press916.before.sourcePath === press916.after.sourcePath, press916);
  else {
    check('9:16 を押すと 0.5 秒以内にプレビューの枠が 9:16 の形になる', press916.layerShapeChangedMs !== null && press916.layerShapeChangedMs <= 500, press916);
    check('画角を押しても再生位置が変わらない', close(press916.playheadAfter, press916.playheadBefore, 0.05), { before: press916.playheadBefore, after: press916.playheadAfter });
    check('9:16 でも面積 1/4・中央を保つ', close(press916.geometry.layer.area, 0.25, 0.01) && close(press916.geometry.layer.cx, 0.5, 0.005)
      && close(press916.geometry.layer.cy, 0.5, 0.005), press916.geometry);
  }

  await stage('04 back label');
  results.observations.backLabel = { text: stillPanel.backText, title: stillPanel.backTitle, aria: stillPanel.backAria };
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back')?.scrollIntoView({block:'nearest',behavior:'instant'});return true})()`);
  await shot(cdp, `04-${PHASE}-still-panel-back-and-aspects.png`);
  if (AFTER) {
    check('専用パネルの戻るが「← ホーム」', stillPanel.backText === '← ホーム', results.observations.backLabel);
    const shapes = stillPanel.aspects.map(a => ({ aspect: a.aspect, text: a.text,
      shape: a.shapes.filter(s => s.w < a.w && s.h < a.h).sort((x, y) => y.w * y.h - x.w * x.h)[0] ?? null }));
    results.observations.aspectShapes = shapes;
    const ratio = id => { const s = shapes.find(x => x.aspect === id)?.shape; return s ? s.w / s.h : NaN; };
    check('画角のボタンが比率どおりの図 + 数字（16:9 は横長・9:16 は縦長・1:1 は正方形）',
      S(shapes.map(s => s.aspect)) === S(['16:9', '9:16', '1:1']) && shapes.every(s => s.text.includes(s.aspect))
      && close(ratio('16:9'), 16 / 9, 0.15) && close(ratio('9:16'), 9 / 16, 0.08) && close(ratio('1:1'), 1, 0.08), shapes);
  } else check('BEFORE: 戻るの文言は「← 編集」（再現）', stillPanel.backText === '← 編集', results.observations.backLabel);

  if (AFTER) {
    await stage('07 9:16 → 1:1 → 16:9, undo once');
    const press11 = await pressAspect('1:1', 1);
    await shot(cdp, `07b-${PHASE}-aspect-1x1.png`);
    const press169 = await pressAspect('16:9', 16 / 9);
    await shot(cdp, `07c-${PHASE}-aspect-16x9.png`);
    results.observations.press11 = press11;
    results.observations.press169 = press169;
    // 07a は 02 と同じ瞬間（9:16）。見比べやすいよう同じ画像を別名でも残す
    await writeFile(path.join(ROOT, `07a-${PHASE}-aspect-9x16.png`), await readFile(path.join(ROOT, `02-${PHASE}-pressed-9x16-preview.png`)));
    results.screenshots.push({ name: `07a-${PHASE}-aspect-9x16.png`, copyOf: `02-${PHASE}-pressed-9x16-preview.png` });
    for (const row of [press11, press169]) {
      check(`${row.aspect} を押すと 0.5 秒以内にプレビューの枠がその形になる`, row.layerShapeChangedMs !== null && row.layerShapeChangedMs <= 500, row);
      check(`${row.aspect} を押しても再生位置が変わらない`, close(row.playheadAfter, row.playheadBefore, 0.05), { before: row.playheadBefore, after: row.playheadAfter });
      check(`${row.aspect} でも面積 1/4・中央を保つ`, close(row.geometry.layer.area, 0.25, 0.01) && close(row.geometry.layer.cx, 0.5, 0.005)
        && close(row.geometry.layer.cy, 0.5, 0.005), row.geometry);
    }
    results.observations.shapeChangeMs = [press916, press11, press169].map(r => ({ aspect: r.aspect, layerMs: r.layerShapeChangedMs, selectBoxMs: r.selectBoxShapeChangedMs }));
    const beforeUndo = await itemSnapshot(v2Frame);
    const playheadBeforeUndo = await playhead();
    await exec('akari.timeline.undo');
    await waitPv(`(()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(v2Frame)});
      const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;return !!r&&Math.abs(r.width/r.height-1)<0.03})()`, 'undo back to 1:1', 10_000).catch(() => undefined);
    await sleep(600);
    // undo は既存のタイムラインの履歴。プレビューが作り直されて再生位置が戻った場合は、枠のある時刻へシークし直して形を見る
    const playheadAfterUndo = await playhead();
    const undoNeededReseek = !await pv(`(()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(v2Frame)});return !!el&&getComputedStyle(el).display!=='none'})()`).catch(() => false);
    if (undoNeededReseek) await seekUntilVisible(v2Frame, 1.5, 'V2 frame visible after undo');
    await sleep(600);
    const undone = await itemSnapshot(v2Frame);
    const undoneGeometry = await frameGeometry(v2Frame);
    results.observations.undo = { beforeUndo, undone, expected: press11.after, geometry: undoneGeometry, playheadBeforeUndo, playheadAfterUndo, undoNeededReseek };
    await shot(cdp, `07d-${PHASE}-one-undo.png`);
    check('undo 1 回で 1 つ前の画角（1:1）に戻る（edit.json とプレビュー）', undone.sourcePath === press11.after.sourcePath
      && S(undone.transform) === S(press11.after.transform) && close(undoneGeometry.layer.aspect, 1, 0.03), results.observations.undo);

    await stage('08 drag the frame, then change aspect');
    const offset = await previewOffset();
    const g = await frameGeometry(v2Frame);
    const canvasRect = await pv(`(()=>{const c=document.getElementById('overlay-stage').getBoundingClientRect();return{x:c.left,y:c.top,w:c.width,h:c.height}})()`);
    const start = { x: offset.x + canvasRect.x + canvasRect.w * g.layer.cx, y: offset.y + canvasRect.y + canvasRect.h * g.layer.cy };
    const end = { x: start.x - canvasRect.w * 0.2, y: start.y - canvasRect.h * 0.15 };
    results.observations.drag = { offset, canvasRect, start, end, before: await itemSnapshot(v2Frame), geometryBefore: g };
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
      if (S(moved.transform) !== S(results.observations.drag.before.transform)) break;
      await sleep(200);
    }
    await sleep(800);
    const movedGeometry = await frameGeometry(v2Frame);
    results.observations.drag.after = moved;
    results.observations.drag.geometryAfter = movedGeometry;
    check('プレビューで枠をドラッグで動かせる（edit.json の位置が変わる）', S(moved.transform) !== S(results.observations.drag.before.transform)
      && !close(movedGeometry.layer.cx, 0.5, 0.02), results.observations.drag);
    await shot(cdp, `08a-${PHASE}-moved-frame.png`);
    await openTab(cdp, 'edit');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel again');
    }
    const movedPress = await pressAspect('9:16', 9 / 16);
    results.observations.movedPress916 = movedPress;
    await shot(cdp, `08b-${PHASE}-moved-then-9x16.png`);
    check('動かした後に画角を変えても中央の位置と面積 1/4 が保たれる',
      close(movedPress.geometry.layer.cx, movedGeometry.layer.cx, 0.005) && close(movedPress.geometry.layer.cy, movedGeometry.layer.cy, 0.005)
      && close(movedPress.geometry.layer.area, 0.25, 0.01) && close(movedPress.geometry.layer.aspect, 9 / 16, 0.02), { moved: movedGeometry, after: movedPress.geometry });
    // 時間は記録するが、ここで止めずに残りの画面も撮る（不合格なら最後に exit 1）
    const movedTiming = movedPress.layerShapeChangedMs !== null && movedPress.layerShapeChangedMs <= 500;
    results.checks.push({ name: '動かした後（undo の後）に画角を押しても 0.5 秒以内に形が変わる', pass: movedTiming,
      measured: { ms: movedPress.layerShapeChangedMs, transitions: movedPress.transitions } });
    console.log(`  ${movedTiming ? 'PASS' : 'FAIL'} 動かした後（undo の後）に画角を押しても 0.5 秒以内に形が変わる (${movedPress.layerShapeChangedMs} ms)`);
  }

  await stage('draw an empty frame in the V1 gap (nothing below)');
  const v1Frame = await drawFrame('draw V1 gap frame', async () => {
    const [sa, sb] = [await timelineSelector('clip-video'), await timelineSelector('clip-photo')];
    const g = await evalOn(cdp, `(()=>{const a=document.querySelector(${S(sa)}).getBoundingClientRect();
      const b=document.querySelector(${S(sb)}).getBoundingClientRect();return{l:a.right,r:b.left,y:a.top+a.height/2}})()`);
    return { from: { x: g.l + 8, y: g.y }, to: { x: g.r - 8, y: g.y } };
  });
  results.observations.v1Frame = await itemSnapshot(v1Frame);
  if (!await evalOn(cdp, (await headerOfItem(v1Frame)))) await selectItem(cdp, v1Frame, (await headerOfItem(v1Frame)));
  const v1Mid = (results.observations.v1Frame.at + results.observations.v1Frame.duration / 2) / 30;
  await seekUntilVisible(v1Frame, v1Mid, 'V1 frame visible').catch(() => undefined);
  await sleep(800);
  const v1Geometry = await frameGeometry(v1Frame);
  results.observations.v1FrameGeometry = v1Geometry;
  await shot(cdp, `06-${PHASE}-bottom-track-frame-fullscreen.png`);
  // V1 の枠はカット（#preview-video / #preview-still の data-akari-cut-id）として描かれる
  const v1Rect = v1Geometry.layer ?? v1Geometry.cut ?? v1Geometry.cutSelectBox;
  check(`${PHASE}: 下に何も無い一番下のトラックの空の枠は全画面`, !!v1Rect && close(v1Rect.w, 1, 0.01) && close(v1Rect.h, 1, 0.01)
    && results.observations.v1Frame.transform === null, { geometry: v1Geometry, item: results.observations.v1Frame });

  await stage('03 video tab remembered, then select empty frames');
  await selectItem(cdp, 'clip-video', headerIs('clip.mp4'));
  await openTab(cdp, 'video');
  await settle(cdp);
  await selectItem(cdp, v1Frame, (await headerOfItem(v1Frame)));
  await settle(cdp);
  const v1Tab = await evalOn(cdp, inspectPanel);
  results.observations.tabForV1FrameAfterVideoTab = { activeTab: v1Tab.activeTab, header: v1Tab.header };
  await shot(cdp, `03-${PHASE}-empty-frame-tab-video-tab-saved.png`);
  await selectItem(cdp, 'clip-photo', headerIs('photo.png'));
  await settle(cdp);
  const photoTab = await evalOn(cdp, inspectPanel);
  results.observations.tabForPhotoAfterVideoTab = { activeTab: photoTab.activeTab, header: photoTab.header };
  // V2 の枠（別の種類）でも: 映像タブを開く → 別のクリップ → 選び直す
  await selectItem(cdp, v2Frame, (await headerOfItem(v2Frame)));
  await openTab(cdp, 'video');
  await selectItem(cdp, 'clip-video', headerIs('clip.mp4'));
  await selectItem(cdp, v2Frame, (await headerOfItem(v2Frame)));
  await settle(cdp);
  const v2Tab = await evalOn(cdp, inspectPanel);
  results.observations.tabForV2FrameAfterVideoTab = { activeTab: v2Tab.activeTab, header: v2Tab.header };
  if (!AFTER) check('BEFORE: 映像タブを使った後は空の枠でも映像タブで開く（再現）', v1Tab.activeTab === 'video' || v2Tab.activeTab === 'video', results.observations);
  else {
    check('映像タブを保存していても空の枠（V1・V2 とも）はホームで開く', v1Tab.activeTab === 'edit' && v2Tab.activeTab === 'edit',
      { v1: results.observations.tabForV1FrameAfterVideoTab, v2: results.observations.tabForV2FrameAfterVideoTab });
  }
  check(`${PHASE}: 映像タブを保存した後のふつうの写真は映像タブで開く（今どおり）`, photoTab.activeTab === 'video', results.observations.tabForPhotoAfterVideoTab);

  await stage('05 ordinary video: home');
  await selectItem(cdp, 'clip-video', headerIs('clip.mp4'));
  await openTab(cdp, 'edit');
  await settle(cdp);
  const videoHome = await evalOn(cdp, inspectPanel);
  results.observations.videoHome = { sections: videoHome.sections, notYet: videoHome.notYet, correctionSection: videoHome.correctionSection };
  await shot(cdp, `05-${PHASE}-video-home.png`);
  if (!AFTER) check('BEFORE: ふつうの動画のホームに「まだありません」の補正の節が出る（再現）', videoHome.correctionSection && videoHome.notYet > 0, results.observations.videoHome);
  else check('ふつうの動画のホームに「まだありません」の補正の節が出ない', !videoHome.correctionSection && videoHome.notYet === 0, results.observations.videoHome);

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
