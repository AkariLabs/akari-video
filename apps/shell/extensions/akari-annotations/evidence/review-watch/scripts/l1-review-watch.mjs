#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ISO = path.join(ROOT, 'runs', 'l1');
const PROJECT = path.join(ISO, 'project');
const AKARI_HOME = path.join(ISO, 'akari-home');
const RESULTS = path.join(ROOT, 'results.json');
const LOG = path.join(ISO, 'electron.log');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22214);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], activateWidget: [], cleanup: null };

const sanitizeText = value => {
  let text = String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const sanitize = value => sanitizeText(value?.stack || value?.message || value);
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const run = (command, args, { cwd = ROOT, timeoutMs = 240_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true;
    clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 1_500_000;
  let reloadAt = Date.now() + 300_000;
  let reloads = 0;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    if (Date.now() > reloadAt && reloads < 2) {
      reloads += 1;
      reloadAt = Date.now() + 300_000;
      hiddenSince = null;
      out.preloadReloads = reloads;
      await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
      await sleep(3000);
    }
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el)return false;el.style.pointerEvents='none';return true})()`);
        return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const inspectorFront = `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`;
const DISMISS_TRANSIENT_UI = `(()=>{let dialogs=0,notifications=0;
for(const dialog of document.querySelectorAll('.dialogBlock')){
const button=[...dialog.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent||b.getAttribute('aria-label')||''))||dialog.querySelector('.closeButton,.codicon-close');
if(button){button.click();dialogs++}}
for(const overlay of document.querySelectorAll('.dialogOverlay')){overlay.remove();dialogs++}
const notices=[...document.querySelectorAll('.theia-notification-list,.theia-Notification-list,.theia-Notification,.theia-notification-toast')];
for(const notice of notices){
const closes=[...notice.querySelectorAll('button,[role="button"]')].filter(b=>/close|閉じる/u.test(b.getAttribute('aria-label')||b.getAttribute('title')||'')||b.classList.contains('codicon-close'));
for(const close of closes){close.click();notifications++}
notice.style.setProperty('display','none','important')}
return{dialogs,notifications,noticeContainers:notices.length}})()`;
const instrumentation = `(()=>{if(window.__akariReviewWatch)return true;
const state={shell:null,events:[],reviewAdds:[],allChangeEvents:0,addedChanges:0,instrumented:{shell:null,fileService:null}};
try{const d=window.theia.container._bindingDictionary;const fileServices=[];
for(const key of d._map.keys()){try{const value=window.theia.container.get(key);
if(!state.shell&&value?.rightPanelHandler?.tabBar&&typeof value.activateWidget==='function')state.shell=value;
if(typeof value?.onDidFilesChange==='function')fileServices.push(value)}catch{}}
const fileService=fileServices.find(value=>value?.constructor?.name==='FileService')||
fileServices.find(value=>typeof value?.watch==='function'&&typeof value?.resolve==='function');
state.instrumented={shell:state.shell?.constructor?.name||null,fileService:fileService?.constructor?.name||null};
if(state.shell){const original=state.shell.activateWidget.bind(state.shell);
state.shell.activateWidget=async(id,...rest)=>{if(id==='akari-review-panel-widget')state.events.push({id,at:Date.now()});return original(id,...rest)}}
if(fileService){fileService.onDidFilesChange(event=>{state.allChangeEvents+=1;
for(const change of event?.changes||[]){const added=change?.type===1||String(change?.type)==='ADDED';
if(added)state.addedChanges+=1;const basename=change?.resource?.path?.base||String(change?.resource??'').split('/').pop();
if(added&&basename==='review.json')state.reviewAdds.push({at:Date.now()})}})}}catch{}
window.__akariReviewWatch=state;return true})()`;
const panelState = `(()=>{const state=window.__akariReviewWatch;return{
front:state?.shell?.rightPanelHandler?.tabBar?.currentTitle?.owner?.id||null,
events:[...(state?.events||[])],reviewAdds:[...(state?.reviewAdds||[])],
allChangeEvents:Number(state?.allChangeEvents||0),addedChanges:Number(state?.addedChanges||0),
instrumented:{shell:state?.instrumented?.shell||null,fileService:state?.instrumented?.fileService||null}}})()`;

async function dismissTransientUi(cdp, attempts = 5) {
  let total = { dialogs: 0, notifications: 0, noticeContainers: 0 };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await evalOn(cdp, DISMISS_TRANSIENT_UI).catch(() => null);
    if (result) total = {
      dialogs: total.dialogs + result.dialogs,
      notifications: total.notifications + result.notifications,
      noticeContainers: Math.max(total.noticeContainers, result.noticeContainers)
    };
    await sleep(400);
  }
  return total;
}

async function ensureInspectorVisible(cdp) {
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  const visible = await waitEval(cdp, inspectorFront,
    { label: 'visible inspector panel', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!visible) {
    const clicked = await evalOn(cdp, `(()=>{const candidates=[
...document.querySelectorAll('.p-TabBar-tab[title*="インスペクター"],.lm-TabBar-tab[title*="インスペクター"],[aria-label*="インスペクター"]'),
...document.querySelectorAll('.codicon-inspect')].map(e=>e.closest('.p-TabBar-tab,.lm-TabBar-tab,button,[role="tab"]')||e);
const target=candidates.find(e=>e instanceof HTMLElement&&e.offsetParent!==null);if(!target)return false;target.click();return true})()`);
    assert(clicked, '右レールのインスペクターアイコンが見つからない');
  }
  await waitEval(cdp, inspectorFront, { label: 'inspector panel foreground', timeoutMs: 600_000 });
}

async function writeReviewFiles(base, names) {
  const files = names.map(name => path.join(base, name, 'review.json'));
  await Promise.all(files.map(file => mkdir(path.dirname(file), { recursive: true })));
  await sleep(500);
  await Promise.all(files.map(file => writeFile(file, '{"version":1,"annotations":[]}\n')));
  return files;
}

async function shot(cdp, name, expectedFront) {
  const destination = path.join(ROOT, name);
  await dismissTransientUi(cdp, 2);
  await screenshot(cdp, destination);
  const state = await evalOn(cdp, panelState);
  assert(state.front === expectedFront, `${name}: right panel front=${state.front}`);
  const sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
  const detail = { name, sha256, front: state.front, activateCount: state.events.length };
  out.screenshots.push(detail);
  await save();
  return detail;
}

let spawnedChild;
async function launch() {
  await mkdir(AKARI_HOME, { recursive: true });
  await mkdir(path.join(ISO, 'theia-config'), { recursive: true });
  await mkdir(path.join(ISO, 'user-data'), { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME, THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') },
    stdio: ['ignore', 'pipe', 'pipe'], detached: false
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let earlyExit;
  child.once('exit', (code, signal) => { earlyExit = { code, signal }; });
  let target;
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline && !target) {
    if (earlyExit) throw new Error(`Electron exited before CDP opened: ${JSON.stringify(earlyExit)}`);
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 1_500_000 });
  return { child, cdp };
}

async function stop(session) {
  session?.cdp?.close();
  const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    await sleep(800);
  }
  const alive = pid ? (() => { try { process.kill(pid, 0); return 1; } catch { return 0; } })() : 0;
  const ps = await run('ps', ['-eo', 'pid,ppid,args'], { timeoutMs: 10_000 }).catch(() => ({ stdout: '' }));
  const survivingProcesses = ps.stdout.split('\n').filter(line => line.includes(ISO)).length;
  const survivingBackendMain = ps.stdout.split('\n').filter(line => line.includes(path.join(SHELL_DIR, 'lib', 'backend', 'main.js'))).length;
  out.cleanup = { killedPid: pid ?? null, alive, survivingProcesses, survivingBackendMain };
  await save();
  return alive + survivingProcesses + survivingBackendMain;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim());
  session = await launch();
  const { cdp } = session;
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.dismissedAtStartup = await dismissTransientUi(cdp);
  const restored = await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`, { label: 'restored timeline', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!restored) await evalOn(cdp, command('akari.annotations.open'));
  const clip = await waitEval(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:0"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, { label: 'timeline clip', timeoutMs: 600_000 });
  await realClick(cdp, clip.x, clip.y);
  await ensureInspectorVisible(cdp);
  assert(await evalOn(cdp, instrumentation), 'ApplicationShell instrumentation unavailable');

  await step('A: outside-root and node_modules review files do not take the right panel', async () => {
    const external = await writeReviewFiles(path.join(AKARI_HOME, 'cli', 'x', 'package', 'vendor'), ['a', 'b', 'c']);
    const nodeModules = await writeReviewFiles(path.join(PROJECT, 'node_modules', 'x'), ['a', 'b', 'c']);
    const vendor = await writeReviewFiles(path.join(PROJECT, 'vendor', 'pkg'), ['a', 'b', 'c']);
    await sleep(5000);
    const state = await evalOn(cdp, panelState);
    assert(state.front === 'akari-inspector-widget', `front changed to ${state.front}`);
    assert(state.events.length === 0, `review activate count=${state.events.length}`);
    return {
      external: external.map(file => path.relative(AKARI_HOME, file)),
      nodeModules: nodeModules.map(file => path.relative(PROJECT, file)),
      vendor: vendor.map(file => path.relative(PROJECT, file)),
      front: state.front,
      activateCount: 0,
      observedReviewAdds: state.reviewAdds.length,
      allChangeEvents: state.allChangeEvents,
      addedChanges: state.addedChanges,
      instrumented: state.instrumented
    };
  });
  await shot(cdp, '01-skipped-review-inspector.png', 'akari-inspector-widget');

  await step('B: three valid project reviews coalesce into one panel activation', async () => {
    const before = await evalOn(cdp, panelState);
    const valid = await writeReviewFiles(path.join(PROJECT, '.akari', 'reviews', 'dogfood'), ['a', 'b', 'c']);
    const state = await waitEval(cdp, `(()=>{const s=${panelState};return s.front==='akari-review-panel-widget'&&s.events.length>=1?s:null})()`, { label: 'one review panel activation', timeoutMs: 60_000 });
    await sleep(3000);
    const settled = await evalOn(cdp, panelState);
    assert(settled.events.length === 1, `review activate count=${settled.events.length}`);
    return {
      valid: valid.map(file => path.relative(PROJECT, file)),
      front: settled.front,
      activateCount: settled.events.length,
      firstObserved: state.events.length,
      observedReviewAdds: settled.reviewAdds.length - before.reviewAdds.length,
      allChangeEvents: settled.allChangeEvents - before.allChangeEvents,
      addedChanges: settled.addedChanges - before.addedChanges,
      instrumented: settled.instrumented
    };
  });
  await shot(cdp, '02-valid-review-panel.png', 'akari-review-panel-widget');
  assert(new Set(out.screenshots.map(item => item.sha256)).size === 2, 'screenshot SHA256 values must differ');
  out.activateWidget = (await evalOn(cdp, panelState)).events.map(event => ({ id: event.id }));
  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  await save().catch(() => {});
  process.exitCode = 1;
} finally {
  const survivingTotal = await stop(session);
  if (survivingTotal !== 0) {
    out.status = 'fail';
    out.cleanupError = `surviving process total: ${survivingTotal}`;
    await save();
    process.exitCode = 1;
  }
}
