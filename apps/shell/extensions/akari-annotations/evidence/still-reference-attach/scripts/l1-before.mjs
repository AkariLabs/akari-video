#!/usr/bin/env node
// 手順 0（BEFORE）: 空の枠 → 静止画の専用パネルを開き、参照画像の欄が無いこと・画角が 3 種であることを撮る。
//   node l1-before.mjs [--port=9637]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + すき間 + 写真 5〜7 秒）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。有償 API は呼ばない。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/ai-still-routes-bin');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9637);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-still-reference-attach-before-')));
const PROJECT = path.join(ISO, 'project');
const S = JSON.stringify;
const results = { phase: 'before', status: 'running', step: '', checks: [], observations: {}, screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, 'results-before.json');
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[before] ${name}`); await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: !!pass, measured });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(`${name}: ${JSON.stringify(measured)}`);
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
const frameItems = async () => (await readEdit()).tracks.flatMap(t => t.items ?? []).filter(row => String(row.id).startsWith('frame-'));
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
const inspectStill = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const text=root?.textContent??'';
  return{stillPanel:!!root?.querySelector('[data-akari-inspector-ai-create="true"]'),
    aspects:[...(root?.querySelectorAll('[data-akari-inspector-ai-aspect]')??[])].map(e=>e.getAttribute('data-akari-inspector-ai-aspect')),
    routes:[...(root?.querySelectorAll('[data-akari-inspector-ai-route]')??[])].map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),
      disabled:!!e.querySelector('input')?.disabled,text:e.textContent.trim()})),
    referenceSection:!!root?.querySelector('[data-akari-inspector-ai-references],[data-akari-inspector-ai-reference]'),
    referenceWords:(text.match(/参照画像|参照|素材から選ぶ|今のコマ/g)??[]),
    cropToggle:(text.match(/切りそろえる/g)??[]).length}})()`;

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok') };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1000', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  results.observations.electronPid = electron.pid;
  console.log(`[before] electron pid ${electron.pid}`);
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
  results.observations.frame = created.id;
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 30_000)
    .catch(() => clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${created.id}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'select frame'));

  await stage('open the still panel');
  const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
  if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
  }
  await settle(cdp);
  const panel = await evalOn(cdp, inspectStill);
  results.observations.stillPanel = panel;
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-prompt="true"]')?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
  await shot(cdp, '00-before-still-panel.png');
  check('BEFORE: 静止画の専用パネルに参照画像の欄が無い（再現）', panel.stillPanel && !panel.referenceSection && panel.referenceWords.length === 0, panel);
  check('BEFORE: 画角は 3 種（16:9・9:16・1:1）（再現）', S(panel.aspects) === S(['16:9', '9:16', '1:1']), panel.aspects);
  check('BEFORE: 「ずれたら切りそろえる」のチェックが無い（再現）', panel.cropToggle === 0, panel);
  results.status = 'pass';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await save();
  try { cdp?.close(); } catch {}
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
