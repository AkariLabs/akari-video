#!/usr/bin/env node
// 指示 3（AFTER）: 静止画の専用パネルで複数の手段を同時に走らせ、候補を並べて見比べ、1 つを使う。
//   node l1-after.mjs [--port=9642] [--keep-tmp]
// 一時ディレクトリにプロジェクトを作り、開発ビルドの Electron を隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して
// CDP で操作する。画像生成の CLI（ChatGPT / Antigravity / Grok）はスタブ（手段ごとに別の秒数・別の色）。fal は偽の鍵 +
// AKARI_FAL_STUB_URL で手元の HTTP スタブへ向け、受けたリクエストをすべて記録する。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
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
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9642);
const STUB_PORT = 19642;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-gen-compare-candidates-after-')));
const PROJECT = path.join(ISO, 'project');
const STUB_LOG = path.join(ISO, 'stub-log.jsonl');
const FAIL_FILE = path.join(ISO, 'stub-fail.txt');
const FAKE_KEY = 'stub-gen-compare-candidates';
const S = JSON.stringify;
const LAYER = process.argv.includes('--layer');
const SUFFIX = LAYER ? '-layer' : '';
const results = { phase: 'after', placement: LAYER ? 'V2 layer (above V1)' : 'V1 gap (cut)', status: 'running', step: '', checks: [], observations: {}, screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, `results-after${SUFFIX}.json`);
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[after] ${name}`); await save(); }
function check(name, pass, detail = {}) { results.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); }
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
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'cellauto=s=1920x1080:r=30:rule=110,format=rgb24,colorchannelmixer=rr=1:gg=0.6:bb=0.2',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  // fal のスタブが返す絵（紫の単色）。手段ごとに色が違うことをスクリーンショットで見分けるため
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#8e44ad:s=1024x576',
    '-frames:v', '1', path.join(ISO, 'fal-image.png')]);
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
const editText = () => readFile(path.join(PROJECT, 'edit.json'), 'utf8');
const readEdit = async () => JSON.parse(await editText());
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const frameItems = async () => (await readEdit()).tracks.flatMap(t => t.items ?? []).filter(row => String(row.id).startsWith('frame-'));
const sourceOf = async id => { const edit = await readEdit(); const item = edit.tracks.flatMap(t => t.items ?? []).find(row => row.id === id);
  return { src: item?.source?.src, path: edit.sources.find(row => row.id === item?.source?.src)?.path, transform: item?.transform }; };
const stubLog = async () => (await readFile(STUB_LOG, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const candidateFiles = async frame => (await readdir(path.join(PROJECT, 'assets/generated/candidates', frame)).catch(() => [])).sort();
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
async function clickUntil(cdp, selector, expectation, name, { quiet = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!quiet) await settle(cdp);
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
  if (SUFFIX) name = name.replace(/\.png$/u, `${SUFFIX}.png`);
  await clearNotifications(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  results.screenshots.push({ name, bytes: bytes.length });
  await save();
}

const requests = [];
let electron, cdp, server, preview;
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
try {
  await stage('fixture and local fal stub');
  await stat(ELECTRON);
  await makeFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  // 偽の鍵（本物の fal へは届かない。AKARI_FAL_STUB_URL で手元のスタブへ向ける）
  await writeFile(path.join(ISO, 'akari-home', 'credentials.env'), `FAL_KEY=${FAKE_KEY}\n`, { mode: 0o600 });
  const falImage = await readFile(path.join(ISO, 'fal-image.png'));
  server = createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    const row = { at: new Date().toISOString(), method: req.method, path: url.pathname, authorizedWithDummyKey: req.headers.authorization === `Key ${FAKE_KEY}` };
    requests.push(row);
    results.observations.falStubRequests = requests;
    if (req.method === 'POST' && url.pathname.includes('/openai/gpt-image-2.5/flare/')) {
      await sleep(4000);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ request_id: `stub-${requests.length}`, status_url: `http://127.0.0.1:${STUB_PORT}/status/1`,
        response_url: `http://127.0.0.1:${STUB_PORT}/response/1` }));
    } else if (url.pathname === '/status/1') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'COMPLETED' })); }
    else if (url.pathname === '/response/1') { res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ images: [{ url: `http://127.0.0.1:${STUB_PORT}/image.png` }] })); }
    else if (url.pathname === '/image.png') { res.setHeader('content-type', 'image/png'); res.end(falImage); }
    else { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(STUB_PORT, '127.0.0.1', resolve));

  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), AKARI_FAL_STUB_URL: `http://127.0.0.1:${STUB_PORT}`,
    STUB_LOG, STUB_FAIL_FILE: FAIL_FILE, STUB_DELAY_MS_CODEX: '5000', STUB_DELAY_MS_AGY: '11000', STUB_DELAY_MS_GROK: '17000' };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY',
    'ANTHROPIC_API_KEY', 'FAL_API_KEY', 'AKARI_IMAGE_AI_FAL_KEY', 'AKARI_IMAGE_AI_USE_NARRATION_KEY', 'AKARI_CREDENTIALS_FILE']) delete env[name];
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

  // 出力プレビュー（入れ子の webview の内側）へつなぐ
  const connectPreview = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
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
              return{kind:'inner',visible:document.visibilityState==='visible'&&r.width>0&&r.height>0,layers:document.querySelectorAll('[data-akari-layer-id]').length}}return null})()`, c.id), 10000).catch(() => null);
            if (info?.kind === 'inner') { const sc = (info.visible ? 1000 : 0) + info.layers; if (sc > score) { score = sc; inner = c.id; } }
          }
          if (inner && (score >= 1000 || attempt >= 5)) found.push({ cdp: sub, inner, score });
          else sub.close();
        } catch { try { sub?.close(); } catch {} }
      }
      if (found.length) {
        found.sort((a, b) => b.score - a.score);
        for (const extra of found.slice(1)) { try { extra.cdp.close(); } catch {} }
        return found[0];
      }
      await sleep(1000);
    }
    throw new Error('preview content context not found');
  };
  const pv = async expression => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await withTimeout(evalOn(preview.cdp, expression, preview.inner), 10_000); }
      catch (error) { if (attempt === 2) throw error; try { preview.cdp.close(); } catch {} preview = await connectPreview(); }
    }
  };
  // プレビューの枠のレイヤー（IMG）の src の種類と、描画された中央の色
  const previewLayer = id => pv(`(async()=>{const el=[...document.querySelectorAll('[data-akari-layer-id]')].find(e=>e.dataset.akariLayerId===${S(id)})
    ??[...document.querySelectorAll('[data-akari-cut-id]')].find(e=>e.dataset.akariCutId===${S(id)}&&getComputedStyle(e).display!=='none');
    const src=el?.currentSrc||el?.src||'';
    const canvas=[...document.querySelectorAll('canvas')].filter(c=>c.width>0&&c.height>0).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    let center=null;try{if(el&&el.tagName==='IMG'&&el.complete){const c=document.createElement('canvas');c.width=8;c.height=8;const x=c.getContext('2d');x.drawImage(el,0,0,8,8);
      const d=x.getImageData(4,4,1,1).data;center=[d[0],d[1],d[2]];const e=x.getImageData(0,0,1,1).data;center.push(e[0],e[1],e[2])}}catch(err){center=String(err)}
    return{found:!!el,tag:el?.tagName??null,visible:!!el&&getComputedStyle(el).display!=='none',srcKind:src.startsWith('data:')?'data-uri':src?'file':'none',
      srcHash:src.length+':'+src.slice(-24),center}})()`);

  // プレビューに実際に描かれている色: 出力プレビューのキャンバス中央 48×48 px を撮り、ffmpeg で 1 画素へ平均する
  const previewColor = async () => {
    const stageFrac = await pv(`(()=>{const r=document.getElementById('overlay-stage').getBoundingClientRect();
      return{cx:(r.left+r.width/2)/innerWidth,cy:(r.top+r.height/2)/innerHeight}})()`);
    const frame = await evalOn(cdp, `(()=>{const f=[...document.querySelectorAll('iframe')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0)
      .sort((a,b)=>b.width*b.height-a.width*a.height)[0];return f?{x:f.left,y:f.top,w:f.width,h:f.height}:null})()`);
    const x = frame.x + frame.w * stageFrac.cx - 24, y = frame.y + frame.h * stageFrac.cy - 24;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 48, height: 48, scale: 1 } });
    const file = path.join(ISO, `pv-${Date.now()}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    const out = await new Promise((resolve, reject) => {
      const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = []; child.stdout.on('data', c => chunks.push(c)); child.once('error', reject); child.once('close', () => resolve(Buffer.concat(chunks)));
    });
    return [...out.subarray(0, 3)];
  };
  // 手段ごとの絵の色（スタブ）: codex = 青・antigravity = 橙・grok = 緑・fal = 紫。空の枠 = 暗い灰
  const hue = ([r, g, b]) => b > r + 30 && b > g + 10 ? 'blue' : g > r + 20 && g > b + 10 ? 'green' : r > b + 40 && r > g + 20 ? 'orange' : Math.max(r, g, b) < 90 ? 'dark' : 'other';

  await stage('draw an empty frame above V1');
  let created;
  for (let attempt = 1; attempt <= 3 && !created; attempt++) {
    await exec('akari.timeline.setTool', { tool: 'frame' });
    await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
    await settle(cdp);
    await clearNotifications(cdp);
    // 既定は V1 のすき間（3〜5 秒）に描く = V1 の cut になり、タイムラインの札（G2）が出る経路。
    // --layer を付けると V1 の上（V2 のレイヤー）に描く。
    const g = await evalOn(cdp, `(()=>{const a=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();
      const b=document.querySelector('[data-akari-ui="timeline:cut:1"]').getBoundingClientRect();return{left:a.left,right:a.right,top:a.top,mid:a.top+a.height/2,gapLeft:a.right,gapRight:b.left}})()`);
    const onLayer = process.argv.includes('--layer');
    const from = onLayer ? { x: g.left + 8, y: g.top - 14 } : { x: g.gapLeft + 6, y: g.mid };
    const to = onLayer ? { x: g.right - 8, y: g.top - 14 } : { x: g.gapRight - 6, y: g.mid };
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
  const frameSeconds = (created.at + created.duration / 2) / 30;
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 30_000)
    .catch(() => clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select frame'));

  await stage('open the still panel');
  const openPanel = async () => {
    const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) return;
    if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
    }
  };
  await openPanel();
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60_000).catch(() => undefined);
  await sleep(1500);
  await settle(cdp);
  const panelState = () => evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
    const create=root.querySelector('[data-akari-inspector-ai-create="true"]');
    return{checkboxes:[...root.querySelectorAll('[data-akari-inspector-ai-route-checkbox]')].map(e=>({id:e.getAttribute('data-akari-inspector-ai-route-checkbox'),checked:e.checked,disabled:e.disabled})),
      radios:root.querySelectorAll('input[type="radio"]').length,
      create:create?{text:create.textContent.trim(),disabled:create.disabled,count:create.getAttribute('data-akari-inspector-ai-create-count')}:null,
      progress:[...root.querySelectorAll('[data-akari-inspector-ai-progress-route]')].map(e=>({route:e.getAttribute('data-akari-inspector-ai-progress-route'),
        state:e.getAttribute('data-akari-inspector-ai-progress-state'),elapsed:Number(e.getAttribute('data-akari-inspector-ai-progress-elapsed')),text:e.textContent.trim()})),
      candidates:[...root.querySelectorAll('[data-akari-inspector-ai-candidate]')].map(e=>({path:e.getAttribute('data-akari-inspector-ai-candidate'),
        selected:e.getAttribute('data-akari-inspector-ai-candidate-selected'),text:e.textContent.replace(/\\s+/g,' ').trim(),
        thumbnail:!!e.querySelector('img')?.getAttribute('src')})),
      failed:[...root.querySelectorAll('[data-akari-inspector-ai-failed-route]')].map(e=>({route:e.getAttribute('data-akari-inspector-ai-failed-route'),text:e.textContent.replace(/\\s+/g,' ').trim()})),
      adopt:root.querySelector('[data-akari-inspector-ai-adopt]')?{disabled:root.querySelector('[data-akari-inspector-ai-adopt]').disabled}:null,
      remain:root.querySelector('[data-akari-inspector-ai-candidates-remain]')?.textContent.trim()??null}})()`);
  // 枠の要素: V2 のレイヤーは data-akari-item-id、V1 の cut は timeline:cut:<順番>（すき間に描いた枠は 2 本目 = cut:1）
  results.observations.timelineItems = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-item-kind]')].map(e=>({kind:e.dataset.akariItemKind,id:e.dataset.akariItemId,
    ui:e.getAttribute('data-akari-ui'),state:e.dataset.akariGenerationState??null,w:Math.round(e.getBoundingClientRect().width),text:e.textContent.replace(/\\s+/g,' ').trim().slice(0,40)}))`);
  // V1 の cut の番号は素材の順なので、生成の状態を持つ（none でない）cut を枠として選ぶ
  const frameEl = LAYER ? `document.querySelector('[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]')`
    : `[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-item-kind="cut"]')].find(e=>(e.dataset.akariGenerationState??'none')!=='none')`;
  const chip = () => evalOn(cdp, `(()=>{const e=(${frameEl});if(!e)return '';
    const label=e.querySelector('.akari-generation-badge-label')?.textContent?.trim();return label?('札:'+label):e.textContent.replace(/\\s+/g,' ').trim()})()`);
  // 札が読める幅までタイムラインを拡大する（ズームの目盛りを動かす）
  for (const value of [150, 200, 250, 300, 340, 380, 420, 460, 500]) {
    const width = await evalOn(cdp, `(()=>{const s=document.querySelector('[data-testid="akari-timeline-zoom-slider"]');if(!s)return 0;
      s.value=String(Math.round(Number(s.max)*${value}/1000));s.dispatchEvent(new Event('input',{bubbles:true}));
      return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r((${frameEl})?.getBoundingClientRect().width??0))))})()`);
    results.observations.timelineZoom = { value, frameWidthPx: width };
    if (width >= 240) break;
  }
  await exec('akari.timeline.seek', { seconds: frameSeconds }).catch(() => undefined);
  const scrollTo = selector => evalOn(cdp, `(()=>{document.querySelector(${S(selector)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);

  // 既定のチェック: お気に入りの保存なし → 追加料金なしの段で使える手段すべて・有料（fal・鍵あり）は外す
  const initial = await panelState();
  results.observations.defaultChecks = initial;
  const checkedOf = state => state.checkboxes.filter(row => row.checked).map(row => row.id).sort();
  check('既定のチェック = 追加料金なしの 3 手段・fal は外れている', S(checkedOf(initial)) === S(['antigravity', 'codex', 'grok'])
    && initial.checkboxes.find(row => row.id === 'fal')?.disabled === false, initial.checkboxes);
  check('ラジオが無く手段はチェック', initial.radios === 0 && initial.checkboxes.length === 4, { radios: initial.radios });
  check('ボタン = 「3 案を作る · 追加料金なし」', initial.create?.text === '3 案を作る · 追加料金なし', initial.create);
  await scrollTo('[data-akari-inspector-ai-route-checkbox]');
  await shot(cdp, '01-after-three-routes-checked.png');

  await stage('(ii) run three routes at the same time');
  const editBefore = await editText();
  results.observations.editBeforeSha = sha(editBefore);
  await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-ai-prompt]');t.focus();return true})()`);
  await cdp.send('Input.insertText', { text: '朝の港と灯台' });
  await waitEval(cdp, `!document.querySelector('[data-akari-inspector-ai-create="true"]').disabled`, 'create enabled');
  const startedAt = Date.now();
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]', `document.querySelectorAll('[data-akari-inspector-ai-progress-state="running"]').length>=2`, 'progress rows', { quiet: true });
  await waitEval(cdp, `((${frameEl})?.textContent??'').includes('3 案作成中')`, 'chip 0/3', 3_000).catch(() => undefined);
  const running0 = { panel: await panelState(), chip: await chip(), afterMs: Date.now() - startedAt };
  results.observations.running0 = running0;
  await scrollTo('[data-akari-inspector-ai-progress]');
  await shot(cdp, '02-after-three-running.png');
  // 3 本とも走り始めている（スタブの受信記録: 各手段の started が 1 件ずつ・最初の完了前）
  await sleep(1000);
  const startedLog = (await stubLog()).filter(row => row.started);
  results.observations.stubStartsFirstRun = startedLog.map(row => ({ route: row.route, started: row.started }));
  const spread = startedLog.length >= 3 ? (Math.max(...startedLog.map(r => Date.parse(r.started))) - Math.min(...startedLog.map(r => Date.parse(r.started)))) : null;
  check('3 手段が同時に走り始める（開始時刻の差 < 4 秒・どの手段も 5 秒の最短より前）', startedLog.length === 3
    && new Set(startedLog.map(r => r.route)).size === 3 && spread !== null && spread < 4000, { spreadMs: spread });
  await waitEval(cdp, `((${frameEl})?.textContent??'').includes('1/3')`, 'chip 1/3', 30_000).catch(() => undefined);
  const running1 = { panel: await panelState(), chip: await chip(), afterMs: Date.now() - startedAt };
  results.observations.running1 = running1;
  check('タイムラインの札「3 案作成中 · 1/3」', running1.chip.includes('3 案作成中 · 1/3'), { chip: running1.chip });
  check('手段ごとの進み具合（1 つ done・2 つ running）', running1.panel.progress.filter(r => r.state === 'done').length === 1
    && running1.panel.progress.filter(r => r.state === 'running').length === 2, running1.panel.progress);
  await scrollTo('[data-akari-inspector-ai-progress]');
  await shot(cdp, '03-after-running-1-of-3.png');

  await stage('(iii) candidates line up');
  await waitEval(cdp, `document.querySelectorAll('[data-akari-inspector-ai-candidate]').length>=3&&!document.querySelector('[data-akari-inspector-ai-progress-state="running"]')`, 'three candidates', 90_000);
  await settle(cdp);
  const done = { panel: await panelState(), chip: await chip(), afterMs: Date.now() - startedAt };
  results.observations.done = done;
  const files1 = await candidateFiles(FRAME);
  results.observations.candidateFilesAfterFirst = files1;
  const metas = [];
  for (const name of files1.filter(n => n.endsWith('.png.meta.json'))) {
    const meta = JSON.parse(await readFile(path.join(PROJECT, 'assets/generated/candidates', FRAME, name), 'utf8'));
    metas.push({ name, status: meta.status, candidate_of: meta.candidate_of, model: meta.model?.id, elapsed_s: meta.result?.elapsed_s, cost: meta.cost });
  }
  results.observations.candidateMetas = metas;
  check('候補 3 つが assets/generated/candidates/<枠>/<手段>-<時刻>.png + meta（done・candidate_of）', metas.length === 3
    && metas.every(m => m.status === 'done' && m.candidate_of === FRAME) && files1.filter(n => /^(codex|antigravity|grok)-.*\.png$/u.test(n)).length === 3, metas);
  check('edit.json は候補の時点で変わらない', sha(await editText()) === sha(editBefore), { before: sha(editBefore), now: sha(await editText()) });
  check('札「候補 3」', done.chip.includes('候補 3'), { chip: done.chip });
  check('候補のサムネイルと「ほかの候補は素材に残ります」', done.panel.candidates.length === 3 && done.panel.candidates.every(c => c.thumbnail)
    && done.panel.remain === 'ほかの候補は素材に残ります', done.panel);
  await scrollTo('[data-akari-inspector-ai-candidate]');
  await shot(cdp, '04-after-candidates.png');

  await stage('(iv) press a candidate → preview frame');
  preview = await connectPreview();
  const seek = async () => {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      await exec('akari.timeline.seek', { seconds: frameSeconds });
      await sleep(800);
      const layer = await previewLayer(FRAME).catch(() => null);
      if (layer?.visible) return layer;
    }
    return previewLayer(FRAME);
  };
  const layerBefore = LAYER ? await seek() : (await exec('akari.timeline.seek', { seconds: frameSeconds }), await sleep(2500), null);
  results.observations.previewLayerBefore = layerBefore;
  const colorBefore = await previewColor();
  const grokCandidate = done.panel.candidates.find(c => c.path.includes('/grok-'))?.path;
  const codexCandidate = done.panel.candidates.find(c => c.path.includes('/codex-'))?.path;
  await clickUntil(cdp, `[data-akari-inspector-ai-candidate="${grokCandidate}"]`,
    `document.querySelector('[data-akari-inspector-ai-candidate="${grokCandidate}"]')?.getAttribute('data-akari-inspector-ai-candidate-selected')==='true'`, 'pick grok');
  await sleep(1500);
  const layerGrok = await previewLayer(FRAME).catch(error => String(error));
  results.observations.previewLayerGrok = layerGrok;
  const colorGrok = await previewColor();
  results.observations.previewColor = { before: colorBefore, grok: colorGrok };
  check('候補を押すとプレビューの枠に候補（Grok = 緑）の絵が描かれる・edit.json は変わらない', hue(colorGrok) === 'green'
    && sha(await editText()) === sha(editBefore), { before: colorBefore, beforeHue: hue(colorBefore), grok: colorGrok, grokHue: hue(colorGrok) });
  await shot(cdp, '05-after-pick-grok-in-preview.png');
  await clickUntil(cdp, `[data-akari-inspector-ai-candidate="${codexCandidate}"]`,
    `document.querySelector('[data-akari-inspector-ai-candidate="${codexCandidate}"]')?.getAttribute('data-akari-inspector-ai-candidate-selected')==='true'`, 'pick codex');
  await sleep(1500);
  const layerCodex = await previewLayer(FRAME).catch(error => String(error));
  results.observations.previewLayerCodex = layerCodex;
  const colorCodex = await previewColor();
  results.observations.previewColor.codex = colorCodex;
  check('別の候補（ChatGPT = 青）を押すとプレビューの絵が入れ替わる', hue(colorCodex) === 'blue' && sha(await editText()) === sha(editBefore), { codex: colorCodex, hue: hue(colorCodex) });
  await shot(cdp, '06-after-pick-codex-in-preview.png');
  // もう一度押すと仮表示が外れて元（空の枠）に戻る
  await clickUntil(cdp, `[data-akari-inspector-ai-candidate="${codexCandidate}"]`,
    `document.querySelector('[data-akari-inspector-ai-candidate="${codexCandidate}"]')?.getAttribute('data-akari-inspector-ai-candidate-selected')==='false'`, 'unpick codex');
  await sleep(1500);
  const colorUnpicked = await previewColor();
  results.observations.previewColor.unpicked = colorUnpicked;
  check('もう一度押すと仮表示が外れて元の枠に戻る', hue(colorUnpicked) === hue(colorBefore), { unpicked: colorUnpicked, hue: hue(colorUnpicked), before: hue(colorBefore) });
  await shot(cdp, '06b-after-unpick-back-to-frame.png');
  await clickUntil(cdp, `[data-akari-inspector-ai-candidate="${codexCandidate}"]`,
    `document.querySelector('[data-akari-inspector-ai-candidate="${codexCandidate}"]')?.getAttribute('data-akari-inspector-ai-candidate-selected')==='true'`, 'pick codex again');
  await sleep(1000);

  await stage('(v) use this candidate → one undo');
  const beforeAdopt = await sourceOf(FRAME);
  await clickUntil(cdp, '[data-akari-inspector-ai-adopt]', 'true', 'adopt');
  const untilAdopt = Date.now() + 20_000;
  while (Date.now() < untilAdopt && (await sourceOf(FRAME)).path === beforeAdopt.path) await sleep(200);
  const afterAdopt = await sourceOf(FRAME);
  results.observations.adopt = { before: beforeAdopt, after: afterAdopt };
  check('「この案を使う」で枠の素材が選んだ候補に（変形は残る）', afterAdopt.path === codexCandidate && S(afterAdopt.transform) === S(beforeAdopt.transform), results.observations.adopt);
  await sleep(1500);
  await settle(cdp);
  results.observations.chipAfterAdopt = await chip();
  if (LAYER) results.observations.previewLayerAfterAdopt = await seek(); else { await exec('akari.timeline.seek', { seconds: frameSeconds }); await sleep(2500); }
  results.observations.previewColor.afterAdopt = await previewColor();
  check('確定後もプレビューは選んだ候補（青）', hue(results.observations.previewColor.afterAdopt) === 'blue', { color: results.observations.previewColor.afterAdopt });
  await shot(cdp, '07-after-adopt.png');
  const editAfterAdopt = await editText();
  await exec('akari.timeline.undo');
  const untilUndo = Date.now() + 20_000;
  while (Date.now() < untilUndo && (await editText()) === editAfterAdopt) await sleep(200);
  const afterUndo = await sourceOf(FRAME);
  results.observations.undo = afterUndo;
  check('undo 1 回で元の枠へ戻る', afterUndo.path === beforeAdopt.path && S(afterUndo.transform) === S(beforeAdopt.transform), { beforeAdopt, afterUndo });
  await sleep(1500);
  await settle(cdp);
  await shot(cdp, '08-after-one-undo.png');
  check('確定・undo のあとも候補ファイルは全部残る', S(await candidateFiles(FRAME)) === S(files1), { files: await candidateFiles(FRAME) });

  await stage('(vi) remaining candidates in the material panel');
  const materials = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-material-path]')].map(e=>e.getAttribute('data-akari-material-path'))`);
  results.observations.materialPaths = materials;
  const candidateMaterials = materials.filter(p => p.startsWith(`assets/generated/candidates/${FRAME}/`));
  check('素材パネルに候補が並ぶ', candidateMaterials.length >= 3, { candidateMaterials });
  if (candidateMaterials[0]) await evalOn(cdp, `(()=>{document.querySelector('[data-akari-material-path=${S(candidateMaterials[0])}]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '09-after-material-panel.png');

  await stage('(vii) one route fails, others still become candidates');
  // 選び直し: 枠を選び直して専用パネルで候補が meta から作り直されることも見る
  await openPanel().catch(() => undefined);
  await writeFile(FAIL_FILE, 'agy');
  const beforeFailRun = (await stubLog()).length;
  const editBeforeFail = await editText();
  await waitEval(cdp, `!document.querySelector('[data-akari-inspector-ai-create="true"]').disabled`, 'create enabled again', 30_000);
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]', `document.querySelectorAll('[data-akari-inspector-ai-progress-state="running"]').length>=2`, 'second run', { quiet: true });
  await sleep(1500);
  results.observations.failedRunStart = { panel: await panelState(), chip: await chip() };
  check('2 回目の実行でも手段ごとの進み具合は今回の分だけ（始めは 3 つとも running）', results.observations.failedRunStart.panel.progress.filter(r => r.state === 'running').length === 3,
    results.observations.failedRunStart.panel.progress);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-failed-route="antigravity"]'))&&!document.querySelector('[data-akari-inspector-ai-progress-state="running"]')`, 'failed row', 90_000);
  await settle(cdp);
  const failedRun = { panel: await panelState(), chip: await chip() };
  results.observations.failedRun = failedRun;
  results.observations.stubLogFailedRun = (await stubLog()).slice(beforeFailRun).map(row => ({ route: row.route, started: !!row.started, failed: !!row.failed, wrote: !!row.wrote }));
  check('1 手段（Antigravity）が失敗しても他の候補は並ぶ', failedRun.panel.failed.some(f => f.route === 'antigravity')
    && failedRun.panel.progress.filter(r => r.state === 'done').length === 2 && failedRun.panel.progress.find(r => r.route === 'antigravity')?.state === 'failed',
    failedRun.panel);
  check('失敗の回でも edit.json は変わらない', (await editText()) === editBeforeFail);
  await scrollTo('[data-akari-inspector-ai-failed-route="antigravity"]');
  await shot(cdp, '10-after-one-route-failed.png');
  await writeFile(FAIL_FILE, '');
  await clickUntil(cdp, '[data-akari-inspector-ai-retry-route="antigravity"]', `document.querySelectorAll('[data-akari-inspector-ai-progress-state="running"]').length>=1`, 'retry', { quiet: true });
  await waitEval(cdp, `!document.querySelector('[data-akari-inspector-ai-progress-state="running"]')&&!document.querySelector('[data-akari-inspector-ai-failed-route="antigravity"]')`, 'retry done', 60_000).catch(() => undefined);
  await settle(cdp);
  results.observations.retry = { panel: await panelState(), chip: await chip() };
  check('「同じ入力でもう一度」で失敗した手段だけ作り直す', !results.observations.retry.panel.failed.some(f => f.route === 'antigravity')
    && (await candidateFiles(FRAME)).filter(n => /^antigravity-.*\.png$/u.test(n)).length === 2, results.observations.retry.panel);
  await scrollTo('[data-akari-inspector-ai-candidate]');
  await shot(cdp, '11-after-retry-failed-route.png');

  await stage('(viii) paid route → one total approval; deny sends nothing');
  await clickUntil(cdp, '[data-akari-inspector-ai-route-checkbox="fal"]', `document.querySelector('[data-akari-inspector-ai-route-checkbox="fal"]')?.checked===true`, 'check fal');
  await settle(cdp);
  const paidPanel = await panelState();
  results.observations.paidPanel = paidPanel;
  check('有料を含むとボタン = 「4 案を作る · 見積 $X」', /^4 案を作る · 見積 \$0\.053$/u.test(paidPanel.create?.text ?? ''), paidPanel.create);
  const logBeforeDeny = (await stubLog()).length, requestsBeforeDeny = requests.length, editBeforeDeny = await editText();
  const filesBeforeDeny = await candidateFiles(FRAME);
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]', `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent?.includes('費用承認する')))`, 'approval dialog');
  const dialogText = await evalOn(cdp, `[...document.querySelectorAll('.dialogBlock, .p-Widget.dialogOverlay, .dialogOverlay')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).join(' | ')`);
  results.observations.approvalDialog = dialogText;
  check('合計の見積もりで費用承認 1 回', /4 案.*合計見積もり \$0\.053/u.test(dialogText), { dialogText });
  await shot(cdp, '12-after-total-approval.png');
  await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='キャンセル'&&x.closest('.dialogOverlay'));b?.click();return !!b})()`);
  await sleep(4000);
  results.observations.deny = { stubLogDelta: (await stubLog()).length - logBeforeDeny, falRequestsDelta: requests.length - requestsBeforeDeny };
  check('断ると何も送らない（CLI スタブ 0 回・fal スタブ 0 回・候補も edit.json も増えない）', results.observations.deny.stubLogDelta === 0
    && results.observations.deny.falRequestsDelta === 0 && S(await candidateFiles(FRAME)) === S(filesBeforeDeny) && (await editText()) === editBeforeDeny, results.observations.deny);
  await shot(cdp, '13-after-deny-nothing-sent.png');
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]', `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent?.includes('費用承認する')))`, 'approval dialog again');
  await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='費用承認する');b?.click();return !!b})()`);
  await waitEval(cdp, `document.querySelectorAll('[data-akari-inspector-ai-progress-state="running"]').length>=3`, 'paid run', 20_000).catch(() => undefined);
  await sleep(1500);
  results.observations.paidRunning = { panel: await panelState(), chip: await chip() };
  await scrollTo('[data-akari-inspector-ai-progress]');
  await shot(cdp, '14-after-four-running-with-fal.png');
  await waitEval(cdp, `!document.querySelector('[data-akari-inspector-ai-progress-state="running"]')`, 'paid done', 90_000);
  await settle(cdp);
  results.observations.paidDone = { panel: await panelState(), chip: await chip() };
  const falPosts = requests.filter(r => r.method === 'POST');
  check('承認すると fal へは 1 回だけ送る（偽の鍵・手元のスタブ）', falPosts.length === 1 && falPosts[0].authorizedWithDummyKey, { falPosts });
  check('fal の候補も並ぶ（料金つき）', results.observations.paidDone.panel.candidates.some(c => c.path.includes('/fal-') && c.text.includes('$0.053')), results.observations.paidDone.panel.candidates);
  await scrollTo('[data-akari-inspector-ai-candidate]');
  await shot(cdp, '15-after-four-candidates-with-fal.png');
  results.observations.falStubOutsideHosts = requests.filter(r => !['/status/1', '/response/1', '/image.png'].includes(r.path) && !r.path.includes('/openai/gpt-image-2.5/flare/'));

  results.status = results.checks.every(row => row.pass) ? 'pass' : 'fail';
  if (results.status !== 'pass') process.exitCode = 1;
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await shot(cdp, 'zz-after-failure.png').catch(() => undefined);
} finally {
  await save();
  try { preview?.cdp.close(); } catch {}
  try { cdp?.close(); } catch {}
  server?.close();
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
