#!/usr/bin/env node
// 手順 0（BEFORE）/ 手順 3（AFTER）: V1 の上に描いた枠（V2 のレイヤー）のプレビューの生成の表示を実機で撮る。
//   node l1.mjs --phase=before|after [--port=9645] [--repo=<ビルド済みのリポ>] [--keep-tmp]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + すき間 + 写真 5〜7 秒）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。
// 画像生成の CLI は scripts/stub-bin/ のスタブ（手段ごとの寸法・待ち時間で PNG を書くだけ）。有償 API は呼ばない。
//  (i)   V2 のレイヤーの空の枠 → プレビューの枠の位置と大きさに淡いオーロラ
//  (ii)  3 手段の同時生成中 → 生成中の光 + 帯
//  (iii) 候補あり → 札
//  (v1)  V1 の すき間に描いた空の枠（V1 の cut）の表示が回帰しない
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PHASE = arg('phase') ?? 'after';
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPTS);
const WORKTREE = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const REPO = path.resolve(arg('repo') ?? WORKTREE);
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(SCRIPTS, 'stub-bin');
const PORT = Number(arg('port') ?? 9645);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join('/tmp', `preview-layer-gen-overlay-l1-${PHASE}-`)));
const PROJECT = path.join(ISO, 'project');
const STUB_LOG = path.join(ISO, 'stub-log.jsonl');
const STUB_PLAN = path.join(ISO, 'stub-plan.json');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, screenshots: [], notes: [] };
const clean = value => String(value).replaceAll(REPO, '<REPO>').replaceAll(WORKTREE, '<REPO>').replaceAll(ISO, '<TMP>')
  .replaceAll(os.homedir(), '<HOME>').replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s'"`)]*/gu, '<TMP>').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, `results-${PHASE}.json`);
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[${PHASE}] ${name}`); await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: !!pass, measured });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
  return !!pass;
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
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { out += chunk; });
  child.once('error', reject);
  child.once('close', code => resolve({ code, out }));
});
const mustRun = async (command, args) => { const r = await run(command, args); if (r.code !== 0) throw new Error(`${command} failed: ${r.out.slice(-800)}`); };
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex:image', video: 'fal:h3-i2v' } },
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
const allItems = doc => doc.tracks.flatMap((track, trackIndex) => (track.items ?? []).map(item => ({ ...item, trackId: track.id, lane: track.lane, trackIndex })));
const frameItems = async () => allItems(await readEdit()).filter(row => String(row.id).startsWith('frame-'));
const stubLog = async () => (await readFile(STUB_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
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
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,500)}limit=setTimeout(finish,8000);reset()}) )()`);
}
async function pointOf(cdp, selector) {
  return waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
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
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}
const PREVIEW_WIDGET = '[id^="plugin-webview:akari-output-preview-"]';
async function shot(cdp, name, { clear = true, clips = [] } = {}) {
  if (clear) await clearNotifications(cdp);
  const file = `${PHASE}-${name}.png`;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
  results.screenshots.push(file);
  for (const [suffix, selector] of clips) {
    const box = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(selector)})?.getBoundingClientRect();return r&&r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`);
    if (!box) continue;
    const clipped = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
    const clipFile = `${PHASE}-${name}-${suffix}.png`;
    await writeFile(path.join(ROOT, clipFile), Buffer.from(clipped.data, 'base64'));
    results.screenshots.push(clipFile);
  }
  await save();
}
const layerChip = id => `(()=>{const e=[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-item-id=${S(id)}]')].find(x=>x.getBoundingClientRect().width>0);
  return e?{kind:e.dataset.akariItemKind??null,state:e.dataset.akariGenerationState??null,
    badge:e.querySelector('.akari-generation-badge-label')?.textContent?.trim()??e.querySelector('[data-akari-generation-badge]')?.textContent?.trim()??null}:null})()`;

// ---- プレビューの webview ----
let previewCdp, previewContext;
async function ensurePreviewWebview(force = false) {
  if (previewCdp && !force) return;
  if (previewCdp) try { previewCdp.close(); } catch {}
  previewCdp = undefined; previewContext = undefined;
  const until = Date.now() + 120_000;
  let target;
  while (Date.now() < until && !target) {
    target = await listTargets(PORT).then(rows => rows.filter(row => row.type === 'iframe'
      && /webview\/index\.html/u.test(row.url)).at(-1)).catch(() => undefined);
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('preview webview target missing');
  previewCdp = new CDP(target.webSocketDebuggerUrl);
  await previewCdp.connect();
  const contexts = [];
  previewCdp.on('Runtime.executionContextCreated', event => contexts.push(event.context.id));
  await previewCdp.send('Page.enable'); await previewCdp.send('Runtime.enable');
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    for (const id of [undefined, ...contexts]) {
      if (await evalOn(previewCdp, `Boolean(document.getElementById('akari-gen-overlay'))`, id).catch(() => false)) {
        previewContext = id;
        return;
      }
    }
    await sleep(250);
  }
  throw new Error('preview stage did not render');
}
const previewEval = async expression => {
  try { await ensurePreviewWebview(); return await evalOn(previewCdp, expression, previewContext); }
  catch { await ensurePreviewWebview(true); return evalOn(previewCdp, expression, previewContext); }
};
// 生成の表示の今の状態と、枠の位置・大きさ（#preview-layers に対する比）
const overlayState = `(()=>{const o=document.getElementById('akari-gen-overlay');const s=document.getElementById('preview-layers');
  if(!o||!s)return null;const sb=s.getBoundingClientRect();const rel=r=>r&&r.width?{x:+((r.left-sb.left)/sb.width).toFixed(4),y:+((r.top-sb.top)/sb.height).toFixed(4),
    w:+(r.width/sb.width).toFixed(4),h:+(r.height/sb.height).toFixed(4)}:null;
  const sel=document.getElementById('layer-select-box');const shown=e=>!!e&&!e.hidden;
  const tag=document.getElementById('akari-gen-tag'),band=document.getElementById('akari-gen-band');
  return{visible:!o.hidden,aurora:o.dataset.akariGenAurora??null,media:o.dataset.akariGenMedia??null,
    tag:shown(tag)?tag.textContent:null,severity:tag?.dataset.akariGenSeverity??null,
    band:shown(band)?document.getElementById('akari-gen-band-text')?.textContent??null:null,
    shimmer:shown(document.getElementById('akari-gen-shimmer')),icon:shown(document.getElementById('akari-gen-icon')),
    box:o.hidden?null:rel(o.getBoundingClientRect()),
    selectBox:sel?.classList.contains('is-active')?rel(sel.getBoundingClientRect()):null,
    stage:{w:Math.round(sb.width),h:Math.round(sb.height)},
    seek:document.getElementById('seek')?.value??null}})()`;

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  // codex は 3 秒、grok は 12 秒、Antigravity は 20 秒（生成中を撮る時間をとる）
  await writeFile(STUB_PLAN, S({ codex: { size: '1254x1254', delayMs: 3000 }, grok: { size: '720x1280', delayMs: 12000 }, agy: { size: '1254x1254', delayMs: 20000 } }));
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), STUB_LOG, STUB_PLAN_FILE: STUB_PLAN };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
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
  results.observations.console = [];
  cdp.on('Runtime.consoleAPICalled', e => { if (['error', 'warning'].includes(e.type) && results.observations.console.length < 80)
    results.observations.console.push(clean(`${e.type}: ${(e.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)); });
  cdp.on('Runtime.exceptionThrown', e => { if (results.observations.console.length < 80) results.observations.console.push(clean(`exception: ${e.exceptionDetails?.exception?.description?.slice(0, 300) ?? e.exceptionDetails?.text}`)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  const command = (id, a) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    const r=await c.get(C).executeCommand(${S(id)}${a === undefined ? '' : `,${S(a)}`});try{return JSON.stringify(r??null)}catch{return String(r)}})()`;
  const exec = (id, a) => evalOn(cdp, command(id, a));
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await exec('akari.annotations.open');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900_000);
  await exec('akari.inspector.open').catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000)
    .catch(async error => { results.notes.push('preload did not clear within 480s'); await shot(cdp, 'zz-preload'); throw error; });
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(PREVIEW_WIDGET)});const r=e?.getBoundingClientRect();return !!r&&r.width>300&&r.height>200})()`, 'visible preview', 120_000);
  await ensurePreviewWebview(true);

  const seekTo = async time => {
    await exec('akari.preview.seekOutput', { editUri, time, seek: true }).catch(() => undefined);
    await previewEval(`(()=>{const e=document.getElementById('seek');if(!e)return false;e.value=${S(String(time))};
      e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`).catch(() => undefined);
    await sleep(1500);
  };
  const drawFrame = async (fromX, toX, y) => {
    const before = new Set((await frameItems()).map(item => item.id));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await exec('akari.timeline.setTool', { tool: 'frame' });
      await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
      await settle(cdp);
      await clearNotifications(cdp);
      const g = await evalOn(cdp, `(()=>{const a=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();const b=document.querySelector('[data-akari-ui="timeline:cut:1"]').getBoundingClientRect();
        return{a:{left:a.left,right:a.right,top:a.top,height:a.height},b:{left:b.left,right:b.right}}})()`);
      const from = { x: fromX(g), y: y(g) }, to = { x: toX(g), y: y(g) };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
        await sleep(60);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        const created = (await frameItems()).find(item => !before.has(item.id));
        if (created) { await exec('akari.timeline.setTool', { tool: 'select' }); return created; }
        await sleep(200);
      }
    }
    throw new Error('empty frame was not written to edit.json');
  };

  // ---- V1 の上（V2 のレイヤー）に 0〜3 秒の枠を描く ----
  await stage('draw an empty frame above V1 (V2 layer)');
  const layer = await drawFrame(g => g.a.left + 8, g => g.a.right - 8, g => g.a.top - 14);
  const LAYER = layer.id;
  check('枠は V1 とは別のトラック（V2 のレイヤー）に書かれる', layer.trackId !== 'visual-main', { id: LAYER, track: layer.trackId, lane: layer.lane });
  // ---- V1 のすき間（3〜5 秒）に枠を描く（V1 の cut の回帰確認用） ----
  await stage('draw an empty frame in the V1 gap (V1 cut)');
  const v1 = await drawFrame(g => g.a.right + 10, g => g.b.left - 10, g => g.a.top + g.a.height / 2);
  const V1FRAME = v1.id;
  const doc = await readEdit();
  const layerItem = allItems(doc).find(item => item.id === LAYER);
  results.observations.frames = {
    layer: { id: LAYER, track: layerItem?.trackId, at: layerItem?.at, duration: layerItem?.duration, transform: layerItem?.transform ?? null, crop: layerItem?.crop ?? null, src: layerItem?.source?.src },
    v1: { id: V1FRAME, track: v1.trackId, at: v1.at, duration: v1.duration },
    tracks: doc.tracks.map(t => ({ id: t.id, lane: t.lane, items: (t.items ?? []).map(i => i.id) }))
  };
  check('すき間の枠は V1（visual-main）の cut として書かれる', v1.trackId === 'visual-main', results.observations.frames.v1);
  const layerMid = ((layerItem?.at ?? 0) + (layerItem?.duration ?? 90) / 2) / 30;
  const v1Mid = ((v1.at ?? 120) + (v1.duration ?? 30) / 2) / 30;
  // 枠を選んでプレビューの選択枠（レイヤーの実際の描画範囲）を出しておく
  const selectLayer = async () => {
    await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${LAYER}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select layer frame');
  };
  await selectLayer();
  await settle(cdp);

  const fits = o => !!o?.box && !!o?.selectBox && ['x', 'y', 'w', 'h'].every(k => Math.abs(o.box[k] - o.selectBox[k]) <= 0.02);
  const clipsFor = [['preview', PREVIEW_WIDGET], ['timeline', '[data-akari-ui="panel:timeline"]']];

  // ---- (i) 空の枠 ----
  await stage('(i) empty layer frame');
  await seekTo(layerMid);
  let o = await previewEval(overlayState);
  results.observations.emptyLayer = { overlay: o, chip: await evalOn(cdp, layerChip(LAYER)) };
  check('(i) V2 のレイヤーの空の枠: プレビューに淡いオーロラ（planned）', o?.visible && o.aurora === 'planned', o);
  check('(i) 表示がレイヤーの枠の位置と大きさに収まる（選択枠との差 2% 以内）', fits(o), { box: o?.box, selectBox: o?.selectBox });
  await shot(cdp, 'i-layer-empty', { clips: clipsFor });

  // ---- (v1) V1 の cut の空の枠（回帰） ----
  await stage('(v1) V1 cut empty frame');
  await seekTo(v1Mid);
  o = await previewEval(overlayState);
  results.observations.v1Empty = { overlay: o, chip: await evalOn(cdp, layerChip(V1FRAME)) };
  check('(v1) V1 の cut の空の枠: プレビューに淡いオーロラ（planned）が出る', o?.visible && o.aurora === 'planned' && !!o.box && o.box.w > 0.95 && o.box.h > 0.95, o);
  await shot(cdp, 'v1-cut-empty', { clips: clipsFor });

  // ---- 静止画の専用パネルを開いて 3 手段で作る ----
  await stage('open the still panel');
  await selectLayer();
  const openStillPanel = async () => {
    const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) return;
    if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
    }
    await settle(cdp);
  };
  await openStillPanel();
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60_000).catch(() => undefined);
  const setRoute = async (id, on) => {
    const now = await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked??null`);
    if (now === null || now === on) return;
    await clickUntil(cdp, `[data-akari-inspector-ai-route="${id}"] input`, `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked===${on}`, `route ${id} ${on}`);
  };
  await setRoute('fal', false);
  for (const id of ['codex', 'grok', 'antigravity']) await setRoute(id, true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const p = await pointOf(cdp, '[data-akari-inspector-ai-prompt="true"]');
    await realClick(cdp, p.x, p.y);
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-ai-prompt="true"]');t.select();return true})()`);
    await cdp.send('Input.insertText', { text: '夕焼けの海辺に立つ猫' });
    await settle(cdp);
    if (await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-prompt="true"]')?.value==='夕焼けの海辺に立つ猫'`)) break;
  }

  // ---- (ii) 3 手段の同時生成中 ----
  await stage('(ii) three routes running');
  await waitEval(cdp, `document.querySelector('[data-akari-inspector-ai-create="true"]')?.disabled===false`, 'create enabled', 60_000);
  const createPoint = await pointOf(cdp, '[data-akari-inspector-ai-create="true"]');
  await realClick(cdp, createPoint.x, createPoint.y);
  const waitBadge = async (re, timeout) => {
    const until = Date.now() + timeout; let last = '';
    while (Date.now() < until) { last = (await evalOn(cdp, layerChip(LAYER)).catch(() => null))?.badge ?? ''; if (re.test(last)) return last; await sleep(150); }
    return null;
  };
  results.observations.runningBadge = await waitBadge(/3 案作成中 · 1\/3/u, 12_000);
  await seekTo(layerMid);
  o = await previewEval(overlayState);
  results.observations.runningLayer = { overlay: o, chip: await evalOn(cdp, layerChip(LAYER)) };
  check('(ii) 生成中: プレビューのレイヤーの枠に生成中の光（generating + シマー + ✦）', o?.visible && o.aurora === 'generating' && o.shimmer && o.icon, o);
  check('(ii) 生成中: 帯（生成中 · N 秒）', /生成中/u.test(o?.band ?? ''), { band: o?.band, tag: o?.tag });
  check('(ii) 生成中の表示がレイヤーの枠の位置と大きさに収まる', fits(o), { box: o?.box, selectBox: o?.selectBox });
  await shot(cdp, 'ii-layer-generating', { clips: clipsFor });
  await sleep(2200);
  const o2 = await previewEval(overlayState);
  results.observations.runningLayerLater = o2;
  check('(ii) 帯の秒が進む', o2?.band !== o?.band && /生成中 · \d+ 秒/u.test(o2?.band ?? ''), { first: o?.band, later: o2?.band });

  // ---- (iii) 候補あり ----
  await stage('(iii) candidates');
  results.observations.candidatesBadge = await waitBadge(/候補 3/u, 60_000);
  await settle(cdp);
  await seekTo(layerMid);
  o = await previewEval(overlayState);
  results.observations.candidatesLayer = { overlay: o, chip: await evalOn(cdp, layerChip(LAYER)),
    stub: (await stubLog()).filter(r => r.wrote).map(r => ({ route: r.route, wrote: { width: r.wrote.width, height: r.wrote.height } })) };
  check('(iii) 候補あり: プレビューのレイヤーの枠に札（候補）', o?.visible && /候補/u.test(o.tag ?? ''), o);
  check('(iii) 候補ありの表示がレイヤーの枠の位置と大きさに収まる', fits(o), { box: o?.box, selectBox: o?.selectBox });
  await shot(cdp, 'iii-layer-candidates', { clips: clipsFor });

  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
  if (results.status !== 'pass') process.exitCode = 1;
} catch (error) {
  results.status = 'error';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 2;
  if (cdp) await shot(cdp, 'zz-failure').catch(() => undefined);
} finally {
  await save();
  try { previewCdp?.close(); } catch {}
  try { cdp?.close(); } catch {}
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
