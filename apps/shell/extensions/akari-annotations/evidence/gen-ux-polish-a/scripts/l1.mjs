#!/usr/bin/env node
// 仕上げ A の L1（ラッパー所掌の検証 fixture。製品コードではない）。
//   node l1.mjs --phase=before|after [--port=9643] [--keep-tmp]
// 1) 青を含む動画（testsrc2）の上に空の枠を置いて選んだまま、カメラボタンと「今のコマ」でコマを保存する
// 2) 設定 › AI モデル: ダイアログの幅・カードの列数・比べる（3 つ）の横スクロール、他の節の幅
// 3) 設定 › 接続と API キー › fal の「既定モデル: 静止画」の選択肢
// 一時ディレクトリに HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData / プロジェクトを作って開発ビルドの Electron を起動し、CDP で操作する。
// 画像生成の CLI はスタブ（stub-bin/）。有償 API・本物の生成 CLI は呼ばない。起動した Electron は自分の PID だけを止める。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPTS);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(SCRIPTS, 'stub-bin');
const PHASE = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'before';
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9643);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-gen-ux-polish-a-')));
const PROJECT = path.join(ISO, 'project');
const STUB_LOG = path.join(ISO, 'stub-log.jsonl');
const STUB_SIZE = path.join(ISO, 'stub-size');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
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
async function waitEval(cdp, expression, name, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression).catch(() => undefined);
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
// 動画は testsrc2（青い帯を含む）。選択中の空の枠の辺（青の選択枠）がその上に重なる = G3 r1 で落ちた条件そのもの。
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#1e5bd8:s=1920x1080',
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
const allItems = doc => doc.tracks.flatMap(track => (track.items ?? []).map(item => ({ ...item, trackId: track.id })));
const frameItems = async () => allItems(await readEdit()).filter(row => String(row.id).startsWith('frame-'));
const pngSize = async file => { const b = await readFile(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
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
    for(const f of [0.5,0.25,0.75,0.15,0.85]){const x=b.left+b.width*f,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===e||e.contains(hit)))return{x,y}}return null})()`, `click target ${selector}`);
}
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, `${PHASE}-${name}.png`), bytes);
  results.screenshots.push({ name: `${PHASE}-${name}.png`, bytes: bytes.length });
  await save();
}

let electron, cdp, preview;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  await writeFile(STUB_SIZE, '1024x1024');
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), STUB_LOG, STUB_SIZE_FILE: STUB_SIZE };
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
  cdp.on('Runtime.consoleAPICalled', p => { const text = (p.args ?? []).map(a => a.value ?? a.description ?? '').join(' ');
    if (/frame capture|akari-preview\]|コマ/u.test(text)) results.observations.console.push(clean(text).slice(0, 400)); });
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
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="preview-context-bar"]'))`, 'preview context bar', 120_000);

  await stage('connect preview frame');
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
          let inner, score = -1;
          for (const c of contexts) {
            const info = await withTimeout(evalOn(sub, `(()=>{const o=document.getElementById('overlay-stage');if(o){const r=o.getBoundingClientRect();
              return{kind:'inner',visible:document.visibilityState==='visible'&&r.width>0&&r.height>0,layers:document.querySelectorAll('[data-akari-layer-id]').length}}
              return null})()`, c.id), 10000).catch(() => null);
            if (info?.kind === 'inner') { const sc = (info.visible ? 1000 : 0) + info.layers; if (sc > score) { score = sc; inner = c.id; } }
          }
          if (inner && (score >= 1000 || attempt >= 5)) candidates.push({ cdp: sub, inner, score });
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
  const pv = async expression => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await withTimeout(evalOn(preview.cdp, expression, preview.inner), 10_000); }
      catch (error) { if (attempt === 2) throw error; await reconnectPreview(); }
    }
  };
  const layerVisible = id => pv(`(()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(id)});
    const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;return !!(r&&r.width&&r.height)})()`);

  // ---- 1) 青い素材の上で枠を選んだまま撮る ----
  await stage('draw an empty frame above V1 (testsrc2)');
  let created;
  for (let attempt = 1; attempt <= 3 && !created; attempt++) {
    await exec('akari.timeline.setTool', { tool: 'frame' });
    await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
    await settle(cdp);
    await clearNotifications(cdp);
    const g = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();return{left:b.left,right:b.right,top:b.top}})()`);
    const from = { x: g.left + 8, y: g.top - 14 }, to = { x: g.right - 8, y: g.top - 14 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
      await sleep(60);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    const until = Date.now() + 30_000;
    while (Date.now() < until && !(created = (await frameItems())[0])) await sleep(200);
  }
  if (!created) throw new Error('empty frame was not written to edit.json');
  await exec('akari.timeline.setTool', { tool: 'select' });
  const FRAME = created.id;
  results.observations.frame = FRAME;
  const selectFrame = async () => {
    if (await evalOn(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`)) return;
    await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'select frame');
  };
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 30_000)
    .catch(() => selectFrame());
  { const until = Date.now() + 120_000; while (Date.now() < until && !await layerVisible(FRAME).catch(() => false)) await sleep(300); }
  // 選択枠がプレビューに出ている（= 素材の青の上に選択枠の青い辺が重なる）状態を待つ。負荷が高いと遅れるので最大 4 分。
  const selectionShown = `(()=>{const b=document.getElementById('layer-select-box');if(!b||!b.classList.contains('is-active'))return false;
    const r=b.getBoundingClientRect(),st=getComputedStyle(b);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility==='visible'})()`;
  const waitSelectionShown = async name => {
    const until = Date.now() + 240_000;
    for (let round = 1; Date.now() < until; round++) {
      if (await pv(selectionShown).catch(() => false)) return true;
      if (round % 20 === 0) await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
        `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'reselect frame').catch(() => undefined);
      if (round % 60 === 0) await reconnectPreview().catch(() => undefined);
      await sleep(500);
    }
    throw new Error(`Timed out: ${name}`);
  };
  await selectFrame();
  await waitSelectionShown('selection box visible over testsrc2');
  await sleep(1500);

  const selectionProbe = `(()=>{const q=s=>[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();const st=getComputedStyle(e);
      return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility==='visible'});
    const boxes=q('#layer-select-box, [data-akari-interaction-selected], [data-akari-handle]').map(e=>{const st=getComputedStyle(e);const r=e.getBoundingClientRect();
      return{id:e.id,border:st.borderTopWidth+' '+st.borderTopStyle+' '+st.borderTopColor,outline:st.outlineWidth+' '+st.outlineStyle+' '+st.outlineColor,
        rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]}});
    return{selectionVisible:boxes.length>0,boxes:boxes.slice(0,12)}})()`;
  const notifications = () => evalOn(cdp, `[...document.querySelectorAll('.theia-notification-list-item, .theia-notification-message')].map(e=>e.textContent.trim()).filter(Boolean)`);
  const capturesDir = path.join(PROJECT, 'assets/captures');
  const listCaptures = async () => (await readdir(capturesDir).catch(() => [])).filter(name => /\.png$/iu.test(name)).sort();

  await stage('camera button with the frame selected over blue footage');
  results.observations.selectionAtButton = await pv(selectionProbe);
  results.observations.playheadAtButton = await exec('akari.timeline.playhead').catch(() => null);
  const consoleBefore = results.observations.console.length;
  await clearNotifications(cdp);
  const buttonBefore = await listCaptures();
  await pv(`(()=>{document.getElementById('akari-gen-capture-frame').click();return true})()`);
  let buttonFile, buttonNotes = [];
  { const until = Date.now() + 40_000;
    while (Date.now() < until) {
      buttonFile = (await listCaptures()).find(n => !buttonBefore.includes(n));
      buttonNotes = await notifications();
      if (buttonFile || buttonNotes.some(t => t.includes('コマを保存できませんでした'))) break;
      await sleep(250);
    } }
  await sleep(800);
  buttonNotes = await notifications();
  const buttonSize = buttonFile ? await pngSize(path.join(capturesDir, buttonFile)).catch(() => null) : null;
  results.observations.cameraButton = { file: buttonFile ? `assets/captures/${buttonFile}` : null, size: buttonSize, notifications: buttonNotes,
    consoleDuring: results.observations.console.slice(consoleBefore) };
  await shot(cdp, '01-camera-button-selected-over-blue');
  if (buttonFile) await writeFile(path.join(ROOT, `${PHASE}-01-camera-button.png`), await readFile(path.join(capturesDir, buttonFile)));
  check('カメラボタン: 青い素材の上で枠を選んだまま → assets/captures/ に PNG が増え「コマを保存しました」',
    !!buttonFile && buttonNotes.some(t => t.includes('コマを保存しました')) && results.observations.selectionAtButton.selectionVisible,
    results.observations.cameraButton);
  await clearNotifications(cdp);

  await stage('今のコマ with the frame selected over blue footage');
  await selectFrame();
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
  results.observations.stillRoutes = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route]')].map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),
    checked:!!e.querySelector('input')?.checked,price:e.querySelector('.akari-inspector-ai-still-route-price')?.textContent?.trim()??null}))`).catch(() => null);
  { const until = Date.now() + 60_000; while (Date.now() < until && !await layerVisible(FRAME).catch(() => false)) await sleep(300); }
  await waitSelectionShown('selection box visible before current frame');
  await sleep(1000);
  results.observations.selectionAtCurrentFrame = await pv(selectionProbe);
  results.observations.playheadAtCurrentFrame = await exec('akari.timeline.playhead').catch(() => null);
  const consoleBefore2 = results.observations.console.length;
  await clearNotifications(cdp);
  const capturesBefore = await listCaptures();
  const capturePoint = await pointOf(cdp, '[data-akari-inspector-ai-reference-capture]');
  await realClick(cdp, capturePoint.x, capturePoint.y);
  const captured = `[...document.querySelectorAll('[data-akari-inspector-ai-reference]')].some(e=>e.getAttribute('data-akari-inspector-ai-reference').startsWith('assets/captures/'))`;
  const failed = `(document.querySelector('[data-akari-ui="panel:inspector"]')?.textContent??'').includes('コマを保存できませんでした')`;
  await waitEval(cdp, `(${captured})||(${failed})`, 'current frame result', 40_000).catch(() => undefined);
  await sleep(800);
  const capturesAfter = await listCaptures();
  const newCapture = capturesAfter.find(n => !capturesBefore.includes(n));
  const panelError = await evalOn(cdp, `document.querySelector('.akari-inspector-ai-still-error')?.textContent?.trim()??null`).catch(() => null);
  results.observations.currentFrame = { captured: await evalOn(cdp, captured), file: newCapture ? `assets/captures/${newCapture}` : null,
    size: newCapture ? await pngSize(path.join(capturesDir, newCapture)).catch(() => null) : null, panelError, notifications: await notifications(),
    consoleDuring: results.observations.console.slice(consoleBefore2) };
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-reference-capture]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '02-current-frame-selected-over-blue');
  if (newCapture) await writeFile(path.join(ROOT, `${PHASE}-02-current-frame.png`), await readFile(path.join(capturesDir, newCapture)));
  check('今のコマ: 青い素材の上で枠を選んだまま → assets/captures/ に PNG が増え参照として付く',
    !!newCapture && results.observations.currentFrame.captured && results.observations.selectionAtCurrentFrame.selectionVisible, results.observations.currentFrame);
  await clearNotifications(cdp);

  // ---- 2) 設定 › AI モデル ----
  await stage('settings: ai models');
  // akari.settings.open の Promise はダイアログを閉じるまで解決しないので待たない
  await evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    void c.get(C).executeCommand('akari.settings.open');return true})()`);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-dialog]'))`, 'settings dialog', 60_000);
  await sleep(1000);
  const dialogBox = `(()=>{const d=document.querySelector('[data-akari-settings-dialog]');const b=d?.querySelector('.dialogBlock')??d?.querySelector('.dialogContent')?.parentElement;
    const r=b?.getBoundingClientRect();return r?{width:Math.round(r.width),height:Math.round(r.height),left:Math.round(r.left),viewport:window.innerWidth}:null})()`;
  const nav = async id => {
    await evalOn(cdp, `(()=>{document.querySelector('[data-settings-nav="${id}"]')?.click();return true})()`);
    await sleep(900);
  };
  const cardColumns = `(()=>{const cards=[...document.querySelectorAll('[data-ai-models-view] [data-ai-model-card]')].filter(c=>c.getBoundingClientRect().width>0);
    if(!cards.length)return null;const top=Math.round(cards[0].getBoundingClientRect().top);return{columns:cards.filter(c=>Math.abs(Math.round(c.getBoundingClientRect().top)-top)<=2).length,
      cardWidth:Math.round(cards[0].getBoundingClientRect().width),count:cards.length}})()`;
  const compareProbe = `(()=>{const c=document.querySelector('[data-ai-model-compare]');const t=document.querySelector('[data-ai-model-compare-table]');
    if(!c||!t)return null;const scrollers=[];for(let n=t;n&&n!==document.body;n=n.parentElement){if(n.scrollWidth>n.clientWidth+1){const s=getComputedStyle(n);
      if(['auto','scroll'].includes(s.overflowX)||n===t)scrollers.push({tag:n.tagName,cls:String(n.className).slice(0,60),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,overflowX:s.overflowX})}}
    const cols=[...document.querySelectorAll('[data-ai-model-compare-select]')].map(s=>{const r=s.getBoundingClientRect();return{value:s.value,right:Math.round(r.right)}});
    const cr=c.getBoundingClientRect();return{columns:cols.length,values:cols.map(x=>x.value),compareRight:Math.round(cr.right),lastSelectRight:cols.at(-1)?.right??null,
      horizontalScroll:scrollers.length>0,scrollers,tableWidth:Math.round(t.getBoundingClientRect().width),compareWidth:Math.round(cr.width)}})()`;
  // ウィンドウの大きさ: 既定（開発ビルドの初期ウィンドウ）と 1440×900（ノート PC の一般的な幅）の 2 通りで測る
  const resize = async (width, height) => {
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => undefined);
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
      await sleep(1500);
      const inner = await evalOn(cdp, '({width:window.innerWidth,height:window.innerHeight})');
      if (Math.abs(inner.width - width) <= 40) return { method: 'Browser.setWindowBounds', inner };
    } catch {}
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await sleep(1500);
    return { method: 'Emulation.setDeviceMetricsOverride', inner: await evalOn(cdp, '({width:window.innerWidth,height:window.innerHeight})') };
  };
  results.observations.settings = {};
  for (const size of [null, { width: 1440, height: 900 }]) {
    const label = size ? `w${size.width}` : 'default';
    const m = results.observations.settings[label] = {};
    if (size) m.resize = await resize(size.width, size.height);
    m.viewport = await evalOn(cdp, '({width:window.innerWidth,height:window.innerHeight})');
    const widths = m.dialogWidths = {};
    for (const id of ['account', 'connections']) { await nav(id); widths[id] = await evalOn(cdp, dialogBox); }
    await nav('ai-models');
    await waitEval(cdp, `Boolean(document.querySelector('[data-ai-models-view] [data-ai-model-card]'))`, 'ai model cards', 60_000);
    await sleep(800);
    widths['ai-models'] = await evalOn(cdp, dialogBox);
    await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-kind="image"]')?.click();return true})()`);
    await sleep(800);
    m.imageCards = await evalOn(cdp, cardColumns);
    await evalOn(cdp, `(()=>{document.querySelector('[data-ai-models-view]')?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
    await shot(cdp, `03-ai-models-cards-${label}`);
    await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-kind="video"]')?.click();return true})()`);
    await sleep(800);
    m.videoCards = await evalOn(cdp, cardColumns);
    for (const id of ['fal:kling-v3-pro-i2v', 'fal:veo-3.1-flf', 'fal:seedance-2.0-i2v']) {
      if (await evalOn(cdp, `[...document.querySelectorAll('[data-ai-model-compare-select]')].some(s=>s.value===${S(id)})`)) continue;
      await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-card="${id}"] [data-ai-model-menu]')?.click();return true})()`);
      await sleep(300);
      await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-menu-items="${id}"] [data-ai-model-action="compare"]')?.click();return true})()`);
      await sleep(900);
    }
    await waitEval(cdp, `document.querySelectorAll('[data-ai-model-compare-select]').length>=3`, 'compare 3', 20_000).catch(() => undefined);
    m.compare = await evalOn(cdp, compareProbe);
    await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-compare]')?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
    await sleep(400);
    await shot(cdp, `04-ai-models-compare-3-${label}`);
    check(`AI モデル（${label}・viewport ${m.viewport.width}）: 3 つ比べても横スクロールしない`, m.compare?.columns === 3 && m.compare.horizontalScroll === false, m.compare);
    check(`AI モデル（${label}・viewport ${m.viewport.width}）: カードが 3 列以上`, (m.imageCards?.columns ?? 0) >= 3 && (m.videoCards?.columns ?? 0) >= 3,
      { image: m.imageCards, video: m.videoCards });
    for (const id of ['account', 'connections']) { await nav(id); widths[`${id}-after-ai-models`] = await evalOn(cdp, dialogBox); }
    check(`他の節（${label}）: アカウント・接続の幅は AI モデルを開く前後で同じ`, widths.account?.width === widths['account-after-ai-models']?.width
      && widths.connections?.width === widths['connections-after-ai-models']?.width, widths);
  }

  // ---- 3) 既定モデル: 静止画の選択肢 ----
  await stage('settings: default still model options');
  await nav('connections');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-generation-default="still"] button[aria-haspopup="listbox"]'))`, 'still default dropdown', 60_000);
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-generation-defaults]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(400);
  const dropdownButton = await pointOf(cdp, '[data-akari-generation-default="still"] button[aria-haspopup="listbox"]');
  await realClick(cdp, dropdownButton.x, dropdownButton.y);
  await sleep(600);
  results.observations.stillDefaultOptions = await evalOn(cdp, `(()=>{const w=document.querySelector('[data-akari-generation-default="still"]');
    const list=w?.querySelector('[role="listbox"]')??document.getElementById(w?.querySelector('button')?.getAttribute('aria-controls')??'');
    return{button:w?.querySelector('button')?.textContent?.trim()??null,options:[...(list?.querySelectorAll('[role="option"]')??[])].map(o=>({value:o.getAttribute('data-value'),text:o.textContent.trim().replace(/\\s+/g,' ')}))}})()`);
  await shot(cdp, '05-default-still-options');
  const codexOption = results.observations.stillDefaultOptions.options.find(o => o.value === 'codex:image');
  check('既定モデル: 静止画の codex:image の表示名が「ChatGPT」', !!codexOption && /^ChatGPT/u.test(codexOption.text) && !codexOption.text.includes('OpenAI GPT Image'), results.observations.stillDefaultOptions);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'error';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await shot(cdp, 'zz-failure').catch(() => undefined);
} finally {
  await save();
  try { preview?.cdp?.close(); } catch {}
  try { cdp?.close(); } catch {}
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
