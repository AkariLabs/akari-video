#!/usr/bin/env node
// 手順 3（AFTER）: 参照画像の 3 つの付け方・手段の可否・画角 8 種・切りそろえ・スタブへ渡った入力を実機で撮る。
//   node l1-after.mjs [--port=9637]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + すき間 + 写真 5〜7 秒、参照用の画像 2 枚）を作り、開発ビルドの
// Electron を隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。
// 画像生成の CLI は scripts/stub-bin/ のスタブ（受け取った入力を記録し、指定寸法の PNG を書くだけ）。有償 API は呼ばない。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const VALIDATOR = path.join(REPO, 'packages/schemas/bin/validate-generation-meta.mjs');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9637);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-still-reference-attach-after-')));
const PROJECT = path.join(ISO, 'project');
const STUB_LOG = path.join(ISO, 'stub-log.jsonl');
const STUB_SIZE = path.join(ISO, 'stub-size');
const S = JSON.stringify;
const results = { phase: 'after', status: 'running', step: '', checks: [], observations: {}, screenshots: [], notes: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, 'results-after.json');
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[after] ${name}`); await save(); }
function check(name, pass, measured, { soft = false } = {}) {
  results.checks.push({ name, pass: !!pass, measured });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass && !soft) throw new Error(`${name}: ${JSON.stringify(measured)}`);
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
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  // 参照用の画像 2 枚（見分けやすい絵柄）
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'mandelbrot=s=800x800',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'ref-a.png')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptebars=s=960x540',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'ref-b.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-photo', path: 'assets/photo.png' },
      { id: 'src-ref-a', path: 'assets/ref-a.png' }, { id: 'src-ref-b', path: 'assets/ref-b.png' }],
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
const itemSource = async id => { const doc = await readEdit(); const item = allItems(doc).find(row => row.id === id);
  return { item, path: doc.sources.find(row => row.id === item?.source?.src)?.path ?? null }; };
const stubLog = async () => (await readFile(STUB_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
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
    await clearNotifications(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}
async function shot(cdp, name) {
  await clearNotifications(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  results.screenshots.push({ name, bytes: bytes.length });
  await save();
}
const scrollInspectorTo = (cdp, selector) => evalOn(cdp, `(()=>{document.querySelector(${S(selector)})?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
// 静止画の専用パネルの今の状態
const inspectStill = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const q=s=>root?.querySelector(s);const qa=s=>[...(root?.querySelectorAll(s)??[])];
  return{stillPanel:!!q('[data-akari-inspector-ai-create="true"]'),
    createDisabled:q('[data-akari-inspector-ai-create="true"]')?.disabled??null,
    references:qa('[data-akari-inspector-ai-reference]').map(e=>({path:e.getAttribute('data-akari-inspector-ai-reference'),
      text:e.textContent.trim(),thumb:!!e.querySelector('img')?.src?.startsWith('data:image/'),remove:!!e.querySelector('[data-akari-inspector-ai-reference-remove]')})),
    pickDisabled:q('[data-akari-inspector-ai-reference-pick]')?.disabled??null,
    captureDisabled:q('[data-akari-inspector-ai-reference-capture]')?.disabled??null,
    options:qa('[data-akari-inspector-ai-reference-option]').map(e=>e.getAttribute('data-akari-inspector-ai-reference-option')),
    aspects:qa('[data-akari-inspector-ai-aspect]').map(e=>{const p=e.querySelector('.akari-inspector-ai-still-aspect-picture')?.getBoundingClientRect();
      return{aspect:e.getAttribute('data-akari-inspector-ai-aspect'),pressed:e.getAttribute('aria-pressed'),w:p?.width??null,h:p?.height??null,
        row:Math.round(e.getBoundingClientRect().top)}}),
    routes:qa('[data-akari-inspector-ai-route]').map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),
      grey:e.getAttribute('data-akari-inspector-ai-route-disabled'),radioDisabled:!!e.querySelector('input')?.disabled,checked:!!e.querySelector('input')?.checked,
      state:e.querySelector('[data-akari-inspector-ai-route-state]')?.getAttribute('data-akari-inspector-ai-route-state')??null,
      reason:e.querySelector('[data-akari-inspector-ai-route-reason]')?.textContent?.trim()??null,
      note:e.querySelector('[data-akari-inspector-ai-route-note]')?.textContent?.trim()??null})),
    crop:q('[data-akari-inspector-ai-crop]')?.checked??null,
    cropped:q('[data-akari-inspector-ai-cropped]')?.textContent?.trim()??null,
    mismatch:q('.akari-inspector-ai-still-mismatch')?.textContent?.trim()??null,
    error:q('.akari-inspector-ai-still-error')?.textContent?.trim()??null,
    notice:q('.akari-inspector-ai-still-notice')?.textContent?.trim()??null}})()`;
const route = (panel, id) => panel.routes.find(r => r.id === id);
function close(a, b, eps) { return Math.abs(a - b) <= eps; }

let electron, cdp, preview;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  await writeFile(STUB_SIZE, '1254x1254');
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), STUB_LOG, STUB_SIZE_FILE: STUB_SIZE };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1000', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  results.observations.electronPid = electron.pid;
  console.log(`[after] electron pid ${electron.pid}`);
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
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="preview-context-bar"]'))`, 'preview context bar', 120_000);

  // 出力プレビュー（入れ子の webview の内側）へつなぐ
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
  const layerShape = id => pv(`(()=>{const c=document.getElementById('overlay-stage').getBoundingClientRect();
    const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(id)});
    const r=el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;
    return r&&r.width&&r.height?{aspect:r.width/r.height,w:r.width/c.width,h:r.height/c.height,cx:(r.left+r.width/2-c.left)/c.width,
      cy:(r.top+r.height/2-c.top)/c.height,src:el.currentSrc||el.src||null}:null})()`);
  const seekUntilVisible = async (id, seconds, name) => {
    const until = Date.now() + 240_000;
    for (let round = 1; Date.now() < until; round++) {
      await exec('akari.timeline.seek', { seconds });
      const end = Date.now() + 5000;
      while (Date.now() < end) { if (await layerShape(id).catch(() => null)) return true; await sleep(200); }
      if (round % 4 === 0) await reconnectPreview();
    }
    throw new Error(`Timed out: ${name}`);
  };
  const waitShape = async (id, aspect, name, timeout = 30_000) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      last = await layerShape(id).catch(() => null);
      if (last && close(last.aspect, aspect, aspect * 0.03)) return last;
      if (!last) await exec('akari.timeline.seek', { seconds: 1.5 }).catch(() => undefined);
      await sleep(200);
    }
    throw new Error(`Timed out: ${name} (last ${JSON.stringify(last)})`);
  };

  await stage('draw an empty frame above V1');
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
    if (await evalOn(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes(${S(path.basename((await itemSource(FRAME)).path))})`)) return;
    await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select frame');
  };
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 30_000)
    .catch(() => selectFrame());
  await seekUntilVisible(FRAME, 1.5, 'frame visible in preview');

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
  await stage('open the still panel');
  await openStillPanel();
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60_000).catch(() => undefined);

  // (iii) 画角 8 種の図と、空の枠の形が 8 種で変わること
  await stage('(iii) 8 aspects');
  let panel = await evalOn(cdp, inspectStill);
  results.observations.aspectFigures = panel.aspects;
  const ids = panel.aspects.map(a => a.aspect);
  check('画角のボタンが 8 種（16:9・9:16・1:1・4:3・3:4・4:5・3:2・21:9）', S(ids) === S(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '3:2', '21:9']), ids);
  const ratioOf = a => { const [w, h] = a.split(':').map(Number); return w / h; };
  check('画角の図が比率どおり（図の幅 / 高さが ±8%）', panel.aspects.every(a => a.w && a.h && close(a.w / a.h, ratioOf(a.aspect), ratioOf(a.aspect) * 0.08)),
    panel.aspects.map(a => ({ aspect: a.aspect, w: a.w, h: a.h, ratio: a.w && a.h ? Math.round(a.w / a.h * 1000) / 1000 : null })));
  const rows = [...new Set(panel.aspects.map(a => a.row))];
  check('画角の図が 2 段に並ぶ', rows.length === 2, rows);
  await scrollInspectorTo(cdp, '[data-akari-inspector-ai-aspect="16:9"]');
  await shot(cdp, '03-aspects-8.png');
  const frameShapes = [];
  for (const aspect of ['4:3', '3:4', '4:5', '3:2', '21:9', '1:1', '16:9', '9:16']) {
    await settle(cdp);
    const point = await pointOf(cdp, `[data-akari-inspector-ai-aspect="${aspect}"]`);
    await realClick(cdp, point.x, point.y);
    const shape = await waitShape(FRAME, ratioOf(aspect), `frame shape ${aspect}`);
    await settle(cdp);
    const src = await itemSource(FRAME);
    const card = await pngSize(path.join(PROJECT, src.path)).catch(() => null);
    frameShapes.push({ aspect, previewAspect: Math.round(shape.aspect * 1000) / 1000, target: Math.round(ratioOf(aspect) * 1000) / 1000,
      area: Math.round(shape.w * shape.h * 1000) / 1000, center: [Math.round(shape.cx * 1000) / 1000, Math.round(shape.cy * 1000) / 1000], card, source: src.path });
    if (aspect === '21:9') await shot(cdp, '03b-frame-21x9.png');
    if (aspect === '4:5') await shot(cdp, '03c-frame-4x5.png');
  }
  results.observations.frameShapes = frameShapes;
  check('空の枠の形が 8 種で変わる（プレビューの枠の縦横比が選んだ比率 ±3%・文字カードの寸法も同じ比率）',
    frameShapes.length === 8 && frameShapes.every(r => close(r.previewAspect, r.target, r.target * 0.03) && r.card && close(r.card.width / r.card.height, r.target, r.target * 0.01)), frameShapes);

  // (i) 「素材から選ぶ」で 1 枚 → Antigravity がグレー + 理由・Grok に注記
  await stage('(i) reference from materials');
  await clickUntil(cdp, '[data-akari-inspector-ai-reference-pick]', `Boolean(document.querySelector('[data-akari-inspector-ai-reference-option="assets/ref-a.png"]'))`, 'open material list');
  results.observations.pickOptions = (await evalOn(cdp, inspectStill)).options;
  await clickUntil(cdp, '[data-akari-inspector-ai-reference-option="assets/ref-a.png"]', `Boolean(document.querySelector('[data-akari-inspector-ai-reference="assets/ref-a.png"]'))`, 'pick ref-a');
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  results.observations.afterPick = panel;
  await scrollInspectorTo(cdp, '[data-akari-inspector-ai-references]');
  await shot(cdp, '01-reference-from-materials.png');
  check('「素材から選ぶ」で付けた参照がサムネイル + 名前 + × で並ぶ', panel.references.length === 1 && panel.references[0].thumb && panel.references[0].remove
    && panel.references[0].text.includes('ref-a.png'), panel.references);
  check('参照 1 枚: Antigravity がグレー + 理由「この手段は画像を受け取れません」', route(panel, 'antigravity').grey === 'true' && route(panel, 'antigravity').radioDisabled
    && route(panel, 'antigravity').reason === 'この手段は画像を受け取れません', route(panel, 'antigravity'));
  check('参照 1 枚: Grok は押せて注記「参照は縮めて送られます」', route(panel, 'grok').grey === 'false' && !route(panel, 'grok').radioDisabled
    && route(panel, 'grok').note === '参照は縮めて送られます', route(panel, 'grok'));
  check('参照 1 枚: Codex はそのまま', route(panel, 'codex').grey === 'false' && !route(panel, 'codex').radioDisabled && !route(panel, 'codex').reason, route(panel, 'codex'));

  // (a) 素材パネルからドラッグ → 2 枚目。Grok が「1 枚まで」でグレー
  await stage('(a) drag from the material panel');
  const tileSel = '[data-akari-material-path="assets/ref-b.png"]';
  await waitEval(cdp, `Boolean(document.querySelector(${S(tileSel)}))`, 'material tile ref-b', 60_000);
  const from = await pointOf(cdp, tileSel);
  const to = await pointOf(cdp, '[data-akari-inspector-ai-reference-drop]');
  await evalOn(cdp, `(()=>{window.__l1Drag=[];for(const type of ['dragstart','dragenter','dragover','drop','dragend'])window.addEventListener(type,e=>{
    const t=e.target instanceof Element?e.target:null;window.__l1Drag.push({type,phase:'capture',target:t?(t.tagName+'.'+String(t.className).slice(0,60)):String(e.target),
      zone:!!t?.closest?.('[data-akari-inspector-ai-reference-drop]'),types:[...(e.dataTransfer?.types??[])],prevented:e.defaultPrevented})},true);
    for(const type of ['dragenter','dragover','drop'])window.addEventListener(type,e=>{window.__l1Drag.push({type,phase:'bubble',prevented:e.defaultPrevented,dropEffect:e.dataTransfer?.dropEffect,effectAllowed:e.dataTransfer?.effectAllowed})});
    return true})()`);
  await cdp.send('Input.setInterceptDrags', { enabled: true });
  const intercepted = new Promise(resolve => cdp.on('Input.dragIntercepted', p => resolve(p.data)));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, button: 'left', buttons: 1 });
    await sleep(40);
  }
  const dragData = await Promise.race([intercepted, sleep(5000).then(() => null)]);
  results.observations.dragData = dragData ? { items: dragData.items.map(i => ({ mimeType: i.mimeType, data: i.data })), dragOperationsMask: dragData.dragOperationsMask } : null;
  check('素材パネルのカードからブラウザの実ドラッグが始まり、application/x-akari-material を運ぶ', !!dragData && dragData.items.some(i => i.mimeType === 'application/x-akari-material'), results.observations.dragData);
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data: dragData });
    await sleep(80);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.send('Input.setInterceptDrags', { enabled: false });
  results.observations.dragEvents = await evalOn(cdp, `window.__l1Drag.slice(0,12).concat(window.__l1Drag.slice(-6))`);
  await save();
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-reference="assets/ref-b.png"]'))`, 'dropped ref-b', 15_000);
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  results.observations.afterDrag = panel;
  await scrollInspectorTo(cdp, '[data-akari-inspector-ai-references]');
  await shot(cdp, '02-reference-dragged-grok-limit.png');
  check('ドラッグで落とした参照が 2 枚目として並ぶ', S(panel.references.map(r => r.path)) === S(['assets/ref-a.png', 'assets/ref-b.png']), panel.references);
  check('参照 2 枚: Grok がグレー +「Grok は 1 枚まで」', route(panel, 'grok').grey === 'true' && route(panel, 'grok').radioDisabled
    && route(panel, 'grok').reason === 'Grok は 1 枚まで', route(panel, 'grok'));

  // (c)「今のコマ」→ 3 枚目（assets/captures/ に保存された PNG）
  await stage('(c) current frame');
  await exec('akari.timeline.seek', { seconds: 1.5 });
  await sleep(800);
  const notifications = () => evalOn(cdp, `[...document.querySelectorAll('.theia-notification-list-item, .theia-notification-message')].map(e=>e.textContent.trim()).filter(Boolean)`);
  const captured = `[...document.querySelectorAll('[data-akari-inspector-ai-reference]')].some(e=>e.getAttribute('data-akari-inspector-ai-reference').startsWith('assets/captures/'))`;
  await clearNotifications(cdp);
  await settle(cdp);
  const capturePoint = await pointOf(cdp, '[data-akari-inspector-ai-reference-capture]');
  await realClick(cdp, capturePoint.x, capturePoint.y);
  const capturedOk = await waitEval(cdp, captured, 'capture current frame', 20_000).then(() => true, () => false);
  if (!capturedOk) {
    results.observations.captureFailure = { notifications: await notifications(), panelError: (await evalOn(cdp, inspectStill)).error,
      captures: await readdir(path.join(PROJECT, 'assets/captures')).catch(() => []) };
  }
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  results.observations.afterCapture = panel;
  const capturePath = panel.references.find(r => r.path.startsWith('assets/captures/'))?.path;
  const captureSize = capturePath ? await pngSize(path.join(PROJECT, capturePath)).catch(() => null) : null;
  results.observations.capture = { path: capturePath ?? null, size: captureSize, files: await readdir(path.join(PROJECT, 'assets/captures')).catch(() => []) };
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-reference-capture]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  // 失敗時は通知を消さずに撮る（通知に理由が出る）
  { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); const name = capturedOk ? '04-reference-current-frame.png' : '04-reference-current-frame-FAILED.png';
    await writeFile(path.join(ROOT, name), Buffer.from(data, 'base64')); results.screenshots.push({ name }); await save(); }
  const captureOk = check('「今のコマ」でプレビューのコマが assets/captures/ に保存され 3 枚目として付く', capturedOk && panel.references.length === 3 && !!captureSize,
    { ...results.observations.capture, failure: results.observations.captureFailure ?? null }, { soft: true });
  await clearNotifications(cdp);

  // (iv) Codex で 9:16 を頼み、スタブが正方形（1254×1254）を返す → 切りそろえられて枠に 9:16 で入る
  await stage('(iv) codex 9:16 → square → cropped');
  check('切りそろえのチェックが既定でオン', panel.crop === true, panel.crop);
  check(`参照 ${panel.references.length} 枚で選ばれている手段は Codex`, route(panel, 'codex').checked, panel.routes);
  const typePrompt = async text => {
    const p = await pointOf(cdp, '[data-akari-inspector-ai-prompt="true"]');
    await realClick(cdp, p.x, p.y);
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-ai-prompt="true"]');t.select();return true})()`);
    await cdp.send('Input.insertText', { text });
    await settle(cdp);
  };
  const generate = async (name, done) => {
    await waitEval(cdp, `document.querySelector('[data-akari-inspector-ai-create="true"]')?.disabled===false`, `${name}: create enabled`, 60_000);
    const p = await pointOf(cdp, '[data-akari-inspector-ai-create="true"]');
    await realClick(cdp, p.x, p.y);
    const until = Date.now() + 180_000;
    while (Date.now() < until) { if (await done()) return; await sleep(300); }
    results.observations[`${name}Panel`] = await evalOn(cdp, inspectStill).catch(() => null);
    throw new Error(`Timed out: ${name}`);
  };
  const logBefore = (await stubLog()).length;
  await typePrompt('夕焼けの海辺に立つ猫');
  const before916 = await itemSource(FRAME);
  await generate('codex916', async () => { const now = await itemSource(FRAME); return now.path !== before916.path && !/frame|card/u.test(path.basename(now.path)) ? true
    : await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-cropped]'))`).catch(() => false); });
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  results.observations.afterCodex = panel;
  const codexSource = await itemSource(FRAME);
  const codexMeta = JSON.parse(await readFile(path.join(PROJECT, `${codexSource.path}.meta.json`), 'utf8'));
  const codexPng = await pngSize(path.join(PROJECT, codexSource.path));
  const validate = async file => (await run(process.execPath, [VALIDATOR, file])).code;
  const codexValid = await validate(path.join(PROJECT, `${codexSource.path}.meta.json`));
  const codexCalls = (await stubLog()).slice(logBefore).filter(r => r.route === 'codex' && r.turnStartInput);
  results.observations.codex = { source: codexSource.path, png: codexPng, meta: { status: codexMeta.status, output: codexMeta.output, result: codexMeta.result,
    reference_images: codexMeta.inputs.reference_images, history: codexMeta.history }, validatorExit: codexValid, stubReceived: codexCalls };
  const expectRefs = ['assets/ref-a.png', 'assets/ref-b.png', ...(captureOk ? [capturePath] : [])];
  const expectAbs = await Promise.all(expectRefs.map(r => realpath(path.join(PROJECT, r))));
  const received = codexCalls.at(-1)?.turnStartInput ?? [];
  check(`スタブの Codex が受けた turn/start の input = 指示文 + 参照 ${expectRefs.length} 枚の localImage（絶対パス・指示の後ろ）`,
    received[0]?.type === 'text' && S(received.slice(1).map(r => r.type)) === S(expectRefs.map(() => 'localImage'))
    && S(received.slice(1).map(r => r.path)) === S(expectAbs) && received[0].text.includes('参照画像の人物・物・色を保って'), received.map(r => r.type === 'text' ? { type: r.type, text: clean(r.text) } : { type: r.type, path: clean(r.path) }));
  check('スタブは正方形 1254×1254 を返し、枠に入った画像は 705×1254（9:16）に切りそろえ済み', codexCalls.at(-1)?.wrote?.width === 1254 && codexPng.width === 705 && codexPng.height === 1254, { wrote: codexCalls.at(-1)?.wrote, placed: codexPng });
  check('meta に参照要素（path・sha256）が残る', S(codexMeta.inputs.reference_images.map(r => r.path)) === S(expectRefs)
    && (await Promise.all(expectRefs.map(r => sha256(path.join(PROJECT, r))))).every((h, i) => codexMeta.inputs.reference_images[i].sha256 === h), codexMeta.inputs.reference_images);
  check('meta に切った事実（cropped_from=1254x1254）が残り、正典の検証器を通る', codexMeta.history.some(h => String(h.reason ?? '').includes('cropped_from=1254x1254')) && codexValid === 0,
    { history: codexMeta.history, validatorExit: codexValid });
  check('パネルの完了表示に「9:16 を頼んで正方形 → 切りそろえました」（空白は無視）', (panel.cropped ?? panel.notice ?? '').replace(/\s+/gu, '').includes('9:16を頼んで正方形→切りそろえました'), { cropped: panel.cropped, notice: panel.notice });
  await seekUntilVisible(FRAME, 1.5, 'generated still visible');
  const codexShape = await waitShape(FRAME, 9 / 16, 'generated 9:16 in preview');
  results.observations.codex.previewShape = codexShape;
  check('プレビューの枠に 9:16 で入る（縦横比 ±3%）', close(codexShape.aspect, 9 / 16, 9 / 16 * 0.03), codexShape);
  await evalOn(cdp, `(()=>{document.querySelector('.akari-inspector-ai-still-notice')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '05-codex-9x16-cropped.png');

  // (v) Grok に参照つきで頼む（スタブが受けた指示文に image_edit と参照の絶対パス）
  await stage('(v) grok with a reference');
  await selectFrame();
  await openStillPanel();
  panel = await evalOn(cdp, inspectStill);
  for (const ref of panel.references.slice().reverse()) {
    await clickUntil(cdp, `[data-akari-inspector-ai-reference-remove="${ref.path}"]`, `!document.querySelector('[data-akari-inspector-ai-reference=${S(ref.path)}]')`, `remove ${ref.path}`);
  }
  await clickUntil(cdp, '[data-akari-inspector-ai-reference-pick]', `Boolean(document.querySelector('[data-akari-inspector-ai-reference-option="assets/ref-a.png"]'))`, 'open material list (grok)');
  await clickUntil(cdp, '[data-akari-inspector-ai-reference-option="assets/ref-a.png"]', `Boolean(document.querySelector('[data-akari-inspector-ai-reference="assets/ref-a.png"]'))`, 'pick ref-a (grok)');
  await clickUntil(cdp, '[data-akari-inspector-ai-route="grok"] .akari-inspector-ai-still-badge', `document.querySelector('[data-akari-inspector-ai-route="grok"] input')?.checked===true`, 'choose grok');
  await clickUntil(cdp, '[data-akari-inspector-ai-aspect="4:5"]', `document.querySelector('[data-akari-inspector-ai-aspect="4:5"]')?.getAttribute('aria-pressed')==='true'`, 'aspect 4:5');
  await writeFile(STUB_SIZE, '1024x1280');
  await typePrompt('参照の人物を水彩画に');
  const grokLogBefore = (await stubLog()).length;
  const beforeGrok = await itemSource(FRAME);
  await generate('grok', async () => (await itemSource(FRAME)).path !== beforeGrok.path);
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  const grokCalls = (await stubLog()).slice(grokLogBefore).filter(r => r.route === 'grok' && r.args?.[0] === '-p');
  const grokPrompt = grokCalls.at(-1)?.args?.[1] ?? '';
  const refAbs = await realpath(path.join(PROJECT, 'assets/ref-a.png'));
  const grokSource = await itemSource(FRAME);
  const grokMeta = JSON.parse(await readFile(path.join(PROJECT, `${grokSource.path}.meta.json`), 'utf8'));
  results.observations.grok = { stubPrompt: clean(grokPrompt), stubArgs: grokCalls.at(-1)?.args?.slice(2).map(clean), source: grokSource.path,
    png: await pngSize(path.join(PROJECT, grokSource.path)), meta: { model: grokMeta.model, reference_images: grokMeta.inputs.reference_images, output: grokMeta.output, history: grokMeta.history },
    validatorExit: await validate(path.join(PROJECT, `${grokSource.path}.meta.json`)), panel };
  check('スタブの Grok が受けた指示文に image_edit・参照の絶対パス・aspect_ratio 4:5', grokPrompt.includes('image_edit') && grokPrompt.includes(refAbs)
    && grokPrompt.includes('aspect_ratio') && grokPrompt.includes('4:5'), results.observations.grok.stubPrompt);
  check('Grok の生成物の meta に参照要素が残り、比率どおりなので切りそろえの記録は無い', S(grokMeta.inputs.reference_images.map(r => r.path)) === S(['assets/ref-a.png'])
    && grokMeta.inputs.reference_images[0].sha256 === await sha256(path.join(PROJECT, 'assets/ref-a.png'))
    && !grokMeta.history.some(h => String(h.reason ?? '').includes('cropped_from')) && results.observations.grok.validatorExit === 0, results.observations.grok.meta);
  await scrollInspectorTo(cdp, '[data-akari-inspector-ai-references]');
  await shot(cdp, '06-grok-reference.png');

  // 切りそろえオフ: Codex で 16:9 を頼み、正方形が返る → 切らずに注意書きだけ
  await stage('crop off');
  await selectFrame();
  await openStillPanel();
  await clickUntil(cdp, '[data-akari-inspector-ai-route="codex"] .akari-inspector-ai-still-badge', `document.querySelector('[data-akari-inspector-ai-route="codex"] input')?.checked===true`, 'choose codex');
  await clickUntil(cdp, '[data-akari-inspector-ai-aspect="16:9"]', `document.querySelector('[data-akari-inspector-ai-aspect="16:9"]')?.getAttribute('aria-pressed')==='true'`, 'aspect 16:9');
  await clickUntil(cdp, '[data-akari-inspector-ai-crop]', `document.querySelector('[data-akari-inspector-ai-crop]')?.checked===false`, 'crop off');
  const stored = await evalOn(cdp, `localStorage.getItem('akari-inspector-ai-still-crop')`);
  await writeFile(STUB_SIZE, '1254x1254');
  await typePrompt('夜の街並み');
  const beforeOff = await itemSource(FRAME);
  await generate('cropOff', async () => (await itemSource(FRAME)).path !== beforeOff.path);
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  const offSource = await itemSource(FRAME);
  const offMeta = JSON.parse(await readFile(path.join(PROJECT, `${offSource.path}.meta.json`), 'utf8'));
  const offPng = await pngSize(path.join(PROJECT, offSource.path));
  results.observations.cropOff = { localStorage: stored, source: offSource.path, png: offPng, history: offMeta.history, panelMismatch: panel.mismatch, panelCropped: panel.cropped, panelNotice: panel.notice };
  check('オフは localStorage に記憶される', stored === 'false', stored);
  check('オフでは切らない（1254×1254 のまま・meta に cropped_from なし・注意書きが出る）', offPng.width === 1254 && offPng.height === 1254
    && !offMeta.history.some(h => String(h.reason ?? '').includes('cropped_from')) && !panel.cropped && !(panel.notice ?? '').includes('切りそろえました') && (panel.mismatch ?? panel.notice ?? '').includes('16:9'), results.observations.cropOff);
  await evalOn(cdp, `(()=>{document.querySelector('.akari-inspector-ai-still-notice, .akari-inspector-ai-still-mismatch')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '07-crop-off-mismatch.png');

  const agyGenerations = (await stubLog()).filter(r => r.route === 'agy' && r.args?.[0] === '-p');
  results.observations.agyGenerations = agyGenerations.length;
  check('Antigravity は一度も生成に呼ばれていない（参照つきでは押せない）', agyGenerations.length === 0, agyGenerations.length);
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
  if (results.status !== 'pass') process.exitCode = 1;
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await shot(cdp, 'zz-failure.png').catch(() => undefined);
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
