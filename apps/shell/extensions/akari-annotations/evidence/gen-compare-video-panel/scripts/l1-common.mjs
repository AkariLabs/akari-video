// 票 V2 の実機検証（BEFORE / AFTER）で共有する道具: 一時プロジェクト・ローカルのスタブ fal・隔離した Electron の起動・CDP の操作。
// 有償 API は叩かない（fal は 127.0.0.1 のスタブ。鍵は偽物）。オーナーの ~/.akari・既定の userData には触らない。
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

export const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(SCRIPTS);
export const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
export const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
export const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9653);
export const S = JSON.stringify;
export const sha = value => createHash('sha256').update(value).digest('hex');

const STUB_SCALE = Number(process.env.GCVP_STUB_SCALE ?? 1) || 1;
export const PROFILES = [
  { model: 'fal:h3-i2v', endpoint: '/minimax/h3/image-to-video', color: 'red', durationSec: 2, queueMs: 4000, processingMs: 12000 },
  { model: 'fal:kling-v3-standard-i2v', endpoint: '/fal-ai/kling-video/v3/standard/image-to-video', color: 'green', durationSec: 3, queueMs: 6000, processingMs: 16000 },
  { model: 'fal:seedance-2.0-i2v', endpoint: '/bytedance/seedance-2.0/image-to-video', color: 'blue', durationSec: 4, queueMs: 8000, processingMs: 20000 }
].map(profile => ({ ...profile, queueMs: profile.queueMs * STUB_SCALE, processingMs: profile.processingMs * STUB_SCALE }));

export async function makeIso(label) {
  const iso = await realpath(await mkdtemp(path.join(os.tmpdir(), `akari-gen-compare-video-panel-${label}-`)));
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home', 'project']) await mkdir(path.join(iso, name), { recursive: true });
  return iso;
}

export function makeResults(phase, iso, file) {
  const results = { phase, status: 'running', step: '', observations: {}, checks: [], screenshots: [] };
  const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(iso, '<TMP>').replaceAll(os.homedir(), '<HOME>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
  const save = async () => {
    const target = path.join(ROOT, file);
    await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
    await rename(`${target}.tmp`, target);
  };
  return { results, clean, save };
}

const ffmpeg = args => execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);

/** 動画 0〜3 秒 + 枠（静止画の仮枠）3〜7 秒。枠の meta に次の動画の下書き（いつもの = h3）。 */
export async function makeProject(iso) {
  const project = path.join(iso, 'project');
  await mkdir(path.join(project, 'assets', 'stills'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(project, 'assets', 'clip.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#e9c46a:s=1280x720', '-frames:v', '1', '-y', path.join(project, 'assets', 'stills', 'start.png')]);
  const { plannedStillMeta } = await import(pathToFileURL(path.join(REPO, 'packages/generate/src/cli/meta-still.mjs')).href);
  const now = new Date().toISOString();
  const meta = plannedStillMeta({ prompt: '', duration_s: 4, at: now, asOf: now.slice(0, 10) });
  meta.next = { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: '色の板がゆっくり動く', first_frame: { path: 'assets/stills/start.png' } },
    output: { duration_s: 4, resolution: '768P' }, updated_at: now };
  await writeFile(path.join(project, 'assets', 'stills', 'start.png.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(path.join(project, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(project, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-start', path: 'assets/stills/start.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'clip-video', at: 0, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } },
      { id: 'clip-frame', at: 90, duration: 120, source: { kind: 'media', src: 'src-start', in: 0, out: 4 } }
    ] }],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
  return project;
}

/** アプリ全体のいつもの = h3、★ = kling / seedance（隔離した AKARI_HOME の中だけ）。 */
export async function writeAppModels(iso) {
  await writeFile(path.join(iso, 'akari-home', 'ai-models.json'), `${JSON.stringify({
    defaults: { video: 'fal:h3-i2v' }, favorites: { video: ['fal:kling-v3-standard-i2v', 'fal:seedance-2.0-i2v'] }
  }, null, 2)}\n`);
}

/** モデルごとに色・尺・処理時間が違うスタブ fal。受信は全部 events に残る。 */
export async function startStubFal(iso, options = {}) {
  const clips = new Map();
  for (const profile of PROFILES) {
    const target = path.join(iso, `stub-${profile.color}.mp4`);
    ffmpeg(['-f', 'lavfi', '-i', `color=c=${profile.color}:s=640x360:r=30:d=${profile.durationSec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', target]);
    clips.set(profile.model, await readFile(target));
  }
  const byEndpoint = new Map(PROFILES.map(profile => [profile.endpoint, profile]));
  const state = { events: [], jobs: new Map(), failing: new Set(options.failing ?? []), speed: options.speed ?? 1 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const profile = byEndpoint.get(url.pathname);
      state.events.push({ kind: 'submit', endpoint: url.pathname, model: profile?.model ?? null, atMs: Date.now(),
        auth: Boolean(req.headers.authorization), bodyBytes: body.length });
      if (!profile) return send({ error: 'unknown endpoint' }, 404);
      const id = String(state.jobs.size + 1);
      state.jobs.set(id, { profile, receivedAtMs: Date.now(), failing: state.failing.has(profile.model) });
      const base = `http://127.0.0.1:${server.address().port}`;
      return send({ request_id: id, status: 'IN_QUEUE', status_url: `${base}/status/${id}`, response_url: `${base}/response/${id}` });
    }
    const id = url.pathname.split('/').at(-1);
    const job = state.jobs.get(id);
    if (!job) return send({ error: 'missing job' }, 404);
    if (url.pathname.startsWith('/status/')) {
      const elapsed = (Date.now() - job.receivedAtMs) * state.speed;
      if (elapsed < job.profile.queueMs) return send({ status: 'IN_QUEUE' });
      if (elapsed < job.profile.processingMs) return send({ status: 'IN_PROGRESS' });
      return send(job.failing ? { status: 'FAILED', error: 'stub model failure' } : { status: 'COMPLETED' });
    }
    if (url.pathname.startsWith('/response/')) {
      if (job.failing) return send({ status: 'FAILED', error: 'stub model failure' });
      return send({ video: { url: `http://127.0.0.1:${server.address().port}/video/${id}` } });
    }
    if (url.pathname.startsWith('/video/')) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(clips.get(job.profile.model));
      return;
    }
    return send({ error: 'unknown' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise(resolve => server.close(() => resolve()));
  return state;
}

export async function launchElectron(iso, project, extraEnv = {}) {
  const env = { ...process.env, HOME: path.join(iso, 'home'), AKARI_HOME: path.join(iso, 'akari-home'), THEIA_CONFIG_DIR: path.join(iso, 'theia-config'),
    FAL_KEY: 'local-stub-key', ...extraEnv };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'AKARI_IMAGE_AI_FAL_KEY']) delete env[name];
  const electron = spawn(ELECTRON, [SHELL, project, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(iso, 'user-data')}`, '--window-size=1800,1100', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  const until = Date.now() + 600_000;
  let target;
  while (Date.now() < until && !target) {
    if (electron.exitCode !== null) throw new Error(`Electron exited ${electron.exitCode}`);
    target = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('CDP page missing');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  return { electron, cdp };
}

export async function stopElectron(electron) {
  if (!electron || electron.exitCode !== null) return;
  electron.kill('SIGTERM');
  await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
  if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
}

export function helpers(cdp, ctx) {
  const waitEval = async (expression, name, timeout = 30_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const value = await evalOn(cdp, expression).catch(() => undefined);
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`Timed out: ${name}`);
  };
  const command = (id, arg) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    const r=await c.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});try{return JSON.stringify(r??null)}catch{return String(r)}})()`;
  const exec = (id, arg) => evalOn(cdp, command(id, arg));
  const clearNotifications = () => evalOn(cdp, `(async()=>{try{const c=window.theia?.container;const d=c?._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand('notifications.commands.clearAll');}catch{}
    for(const n of document.querySelectorAll('.theia-notification-toasts,.theia-notification-toast,.theia-Notification,.theia-notifications-container,[class*="notification-toast"]'))n.style.setProperty('display','none','important');
    return true})()`).catch(() => undefined);
  const settle = () => evalOn(cdp, `(()=>new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(x=>document.querySelector(x)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const o=new MutationObserver(reset);o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return o});
    function finish(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,400)}limit=setTimeout(finish,4000);reset()}) )()`);
  const pointOf = selector => waitEval(`(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
    for(const g of [0.5,0.25,0.75])for(const f of [0.5,0.25,0.75,0.15,0.85,0.05,0.95]){const x=b.left+b.width*f,y=b.top+b.height*g;const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===e||e.contains(hit)))return{x,y}}return null})()`, `click target ${selector}`);
  const click = async selector => { await clearNotifications(); const p = await pointOf(selector); await realClick(cdp, p.x, p.y); };
  const clickUntil = async (selector, expectation, name) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await settle();
      try { await click(selector); await waitEval(expectation, name, 8000); return; } catch (error) { if (attempt === 3) throw error; }
    }
  };
  const shot = async name => {
    await clearNotifications();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(data, 'base64');
    await writeFile(path.join(ROOT, name), bytes);
    ctx.results.screenshots.push({ name, bytes: bytes.length });
    await ctx.save();
  };
  const check = async (name, pass, detail) => {
    ctx.results.checks.push({ name, pass: Boolean(pass), detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
    await ctx.save();
  };
  return { waitEval, exec, clearNotifications, settle, pointOf, click, clickUntil, shot, check };
}

/** アプリの起動 → タイムライン → 枠（cut:1）を選ぶ → 編集タブの生成の欄。 */
export async function openFrameGeneration(h, cdp) {
  await h.waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await h.exec('akari.annotations.open');
  await h.waitEval(`Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900_000);
  await h.exec('akari.inspector.open').catch(() => undefined);
  await h.waitEval(`Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await h.waitEval(`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  await h.clickUntil('[data-akari-ui="timeline:cut:1"]',
    `document.querySelector('[data-akari-ui="timeline:cut:1"]')?.classList.contains('akari-annotations-selected')`, 'select frame');
  const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
  if (!await evalOn(cdp, tabActive)) await h.clickUntil('[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
  const SECTION = '[data-akari-ui="section:inspector-generation"]';
  if (!await evalOn(cdp, `Boolean(document.querySelector(${S(SECTION)}))`)) {
    await h.waitEval(`Boolean(document.querySelector('[data-akari-inspector-ai-tile="video"]'))`, 'video tile', 60_000);
    await h.clickUntil('[data-akari-inspector-ai-tile="video"]', `Boolean(document.querySelector(${S(SECTION)}))`, 'video panel');
  }
  await h.waitEval(`Boolean(document.querySelector(${S(SECTION)}))`, 'generation section', 120_000);
  await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const body=s?.querySelector('.akari-inspector-section-body');
    if(body?.hidden)s.querySelector('.akari-inspector-section-toggle')?.click();s?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
  await h.settle();
  return SECTION;
}

export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
export async function cleanupIso(iso) { if (!process.argv.includes('--keep-tmp')) await rm(iso, { recursive: true, force: true }).catch(() => undefined); }
