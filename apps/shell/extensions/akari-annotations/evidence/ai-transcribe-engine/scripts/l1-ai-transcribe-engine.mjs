#!/usr/bin/env node
// Run: node apps/shell/extensions/akari-annotations/evidence/ai-transcribe-engine/scripts/l1-ai-transcribe-engine.mjs
// Requires a built Electron shell. The script makes its project and all profiles under os.tmpdir().
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22243);
const TEMP_DIR = os.tmpdir();
const TEMP_DIR_REAL = await realpath(TEMP_DIR);
const ISO = await mkdtemp(path.join(TEMP_DIR, 'akari-ai-transcribe-engine-l1-'));
const PROJECT = path.join(ISO, 'project');
const tempPaths = new Set([ISO, TEMP_DIR, TEMP_DIR_REAL]);
for (const dir of [...tempPaths]) {
  if (dir.startsWith('/private/var/folders/')) tempPaths.add(dir.slice('/private'.length));
  if (dir.startsWith('/var/folders/')) tempPaths.add(`/private${dir}`);
}
const redactedTempPaths = [...tempPaths].sort((a, b) => b.length - a.length);
const S = JSON.stringify;
const launchEnv = { ...process.env };
for (const key of Object.keys(launchEnv)) if (/GROQ|ELEVENLABS|FAL|OPENAI|GEMINI|XAI/iu.test(key)) delete launchEnv[key];
const result = { status: 'running', checks: [], clicks: [], screenshots: [],
  measurements: { selectableEngines: 0, unavailableEngines: 0, chosenEngine: null }, blockedTranscriptions: 0 };
const save = async () => {
  const file = path.join(ROOT, 'results.json');
  const temporary = `${file}.tmp-${process.pid}`;
  let serialized = JSON.stringify(result, null, 2);
  for (const dir of redactedTempPaths) serialized = serialized.replaceAll(dir, '<TEMP>');
  await writeFile(temporary, serialized + '\n');
  await rename(temporary, file);
};
const check = (name, passed, measured) => {
  result.checks.push({ name, passed: Boolean(passed), measured });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(measured)}`);
};
async function waitEval(cdp, expression, label, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression, undefined, Math.min(60_000, until - Date.now())).catch(() => null);
    if (value) return value;
    await sleep(Math.min(160, Math.max(0, until - Date.now())));
  }
  throw new Error(`Timed out: ${label}`);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
async function dismiss(cdp) {
  await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => null);
  // The app's own update toast (akari-surfaces update-toast) can cover the inspector's bottom button.
  await evalOn(cdp, `(()=>{const b=document.querySelector('.akari-update-close');if(b){b.click();return true}return false})()`).catch(() => null);
  await waitEval(cdp, `document.querySelectorAll('.theia-notification-list-item').length===0`, 'notifications clear', 5000).catch(() => null);
}
async function settle(cdp) {
  return evalOn(cdp, `new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(s=>document.querySelector(s)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const observer=new MutationObserver(reset);
    observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return observer});
    function done(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(done,500)}limit=setTimeout(done,90000);reset()})`, undefined, 100_000);
}
async function clickUntil(cdp, selector, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await dismiss(cdp);
    try {
      const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=document.elementFromPoint(x,y);return r.width&&r.height&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `${name} point`, 5000);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expected, name, 5000);
      result.clicks.push({ name, attempt, passed: true });
      return;
    } catch (error) {
      result.clicks.push({ name, attempt, passed: false, error: String(error) });
      if (attempt === 3) throw error;
    }
  }
}
async function shot(cdp, name, selector = '[data-akari-ui="panel:inspector"]') {
  await settle(cdp);
  await dismiss(cdp);
  const rect = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    const r=e.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height}:null})()`, `${name} rect`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
    clip: { ...rect, scale: 1 } });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  result.screenshots.push({ name, bytes: bytes.length });
  check(`${name} <= 500KB`, bytes.length <= 500_000, bytes.length);
  await save();
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs'), PROJECT], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', part => { out += part; });
  child.stderr.on('data', part => { err += part; });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(`fixture failed: ${err}`);
  result.fixture = JSON.parse(out.trim());
}
const tab = '[data-akari-ui="tab:inspector-generation"]';
const tile = '[data-akari-inspector-ai-tile="transcribe"]';
const panel = '.akari-inspector-ai-transcribe-panel';
const button = label => `${panel} button.akari-inspector-ai-transcribe-button`;
const buttonWith = label => `Boolean([...document.querySelectorAll(${S(button(label))})].find(e=>e.textContent===${S(label)}))`;
async function openAi(cdp) {
  const selected = `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`;
  if (!await evalOn(cdp, selected)) await clickUntil(cdp, tab, selected, 'AI tab');
}
async function select(cdp, selector, name) {
  await clickUntil(cdp, selector, `Boolean(document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected'))`, name);
  await openAi(cdp);
}
async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(false); }, timeoutMs);
    child.once('exit', onExit);
  });
}
let electron, cdp;
try {
  await stat(ELECTRON);
  await runFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(ISO, name));
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: { ...launchEnv, AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') }, stdio: 'ignore'
  });
  electron.on('error', error => { result.launchError = String(error); });
  const target = await (async () => { const until = Date.now() + 90_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => null);
    if (page) return page; await sleep(300);
  } throw new Error('Electron CDP page did not appear'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell')&&(()=>{
    const preload=document.querySelector('.theia-preload');if(!preload)return true;
    const style=getComputedStyle(preload);return style.display==='none'||Number(style.opacity)===0})())`, 'Theia workbench', 180_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`))
    await evalOn(cdp, command('akari.annotations.open'));
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`, 'timeline');
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');

  // Guard the only RPC that can start transcription before touching the chooser.
  const guarded = await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;
    const K=[...d._map.keys()].find(k=>String(k)==='Symbol(CommandContribution)');
    if(!K)return false;
    const contribution=window.theia.container.getAll(K)
      .find(c=>typeof c.openTranscribeDialog==='function'&&c.projectService);
    if(!contribution)return false;
    const blocked=async()=>{window.__akariAiTranscribeBlocked=(window.__akariAiTranscribeBlocked||0)+1;
      throw new Error('L1 fixture blocks transcription');};
    const original=contribution.projectService;
    contribution.projectService=new Proxy(original,{get(t,p){
      if(p==='transcribeMaterial')return blocked;
      const value=Reflect.get(t,p);return typeof value==='function'?value.bind(t):value;
    }});
    return contribution.projectService.transcribeMaterial===blocked})()`);
  check('transcription RPC blocked before dialog', guarded, guarded);
  const engineRows = `${panel} [data-akari-inspector-ai-transcribe-engine]`;
  await select(cdp, '[data-akari-ui="timeline:cut:0"]', 'untranscribed video');
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'video transcribe tile');
  // The engine rows arrive after the two status RPCs; the click itself only has to open the panel.
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)}))`, 'video transcribe panel');
  await waitEval(cdp, `document.querySelectorAll(${S(engineRows)}).length>0`, 'video engine list');
  const inventory = await evalOn(cdp, `(()=>[...document.querySelectorAll(${S(engineRows)})].map(e=>({
    id:e.getAttribute('data-akari-inspector-ai-transcribe-engine'),
    disabled:e.querySelector('input')?.disabled,
    state:e.querySelector('[data-akari-inspector-ai-transcribe-availability]')?.getAttribute('data-akari-inspector-ai-transcribe-availability')
  })))()`);
  check('engine inventory', inventory.length >= 5 && inventory.some(row => row.id === 'auto'), inventory);
  check('unavailable engines disabled', inventory.every(row => row.state !== 'unavailable' || row.disabled), inventory);
  result.measurements.selectableEngines = inventory.filter(row => !row.disabled).length;
  result.measurements.unavailableEngines = inventory.filter(row => row.disabled).length;
  const chosen = inventory.find(row => ['speech-analyzer', 'whisper-cpp'].includes(row.id) && row.state === 'available' && !row.disabled)
    ?? inventory.find(row => row.id === 'auto' && !row.disabled);
  check('selectable local or auto', !!chosen, chosen);
  result.measurements.chosenEngine = chosen.id;
  await shot(cdp, '01-video-engine-list.png');
  const chosenRadio = `${panel} [data-akari-inspector-ai-transcribe-engine="${chosen.id}"] input`;
  await clickUntil(cdp, chosenRadio, `Boolean(document.querySelector(${S(chosenRadio)})?.checked)`, 'select engine');
  await shot(cdp, '02-engine-selected.png');
  await clickUntil(cdp, `${panel} button.akari-inspector-ai-transcribe-button`,
    `Boolean(document.querySelector('[data-akari-transcribe-dialog="true"]'))`, 'open selected dialog');
  const checked = await waitEval(cdp, `(()=>{const d=document.querySelector('[data-akari-transcribe-dialog="true"]');
    if(!d)return null;const id=${S(chosen.id)};
    const radio=id==='auto'?d.querySelector('input[name="transcribe-engine"]'):
      d.querySelector('[data-backend="'+id+'"] input[name="transcribe-engine"]');
    return radio?.checked?{id,checked:true}:null})()`, 'dialog selected engine');
  check('dialog retained selected engine', checked.id === chosen.id, checked);
  await shot(cdp, '03-dialog-engine.png', '[data-akari-transcribe-dialog="true"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-transcribe-dialog="true"]'))`)) break;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
  }
  await waitEval(cdp, `!document.querySelector('[data-akari-transcribe-dialog="true"]')`, 'dialog closed');
  result.blockedTranscriptions = await evalOn(cdp, `window.__akariAiTranscribeBlocked||0`);
  await select(cdp, '[data-akari-item-kind="audio"][data-akari-item-id="interview-clip"]', 'transcribed audio');
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)})?.querySelector('.akari-inspector-ai-done-badge'))`, 'done badge');
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)})?.textContent.includes('文字起こし済み'))`, 'done panel');
  await shot(cdp, '04-done-panel.png');
  await clickUntil(cdp, `${panel} button:last-child`,
    `!document.querySelector(${S(panel)})?.textContent.includes('文字起こし済み')`, 'redo');
  await waitEval(cdp, `document.querySelectorAll(${S(engineRows)}).length>0`, 'redo engine list');
  check('redo displays engines', await evalOn(cdp, `document.querySelectorAll(${S(engineRows)}).length===${inventory.length}`), inventory.length);
  await shot(cdp, '05-redo-engine-list.png');
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error);
  if (cdp) {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64');
      await writeFile(path.join(ROOT, 'error-full.png'), bytes);
      result.screenshots.push({ name: 'error-full.png', bytes: bytes.length });
    } catch (screenshotError) { result.errorScreenshot = String(screenshotError); }
    try {
      result.failureState = await evalOn(cdp, `(()=>({
        selectedClips:[...document.querySelectorAll('[data-akari-ui^="timeline:cut:"].akari-annotations-selected,[data-akari-item-kind="audio"].akari-annotations-selected')]
          .map(e=>({ui:e.getAttribute('data-akari-ui'),kind:e.getAttribute('data-akari-item-kind'),id:e.getAttribute('data-akari-item-id')})),
        tabs:[...document.querySelectorAll('[data-akari-ui^="tab:inspector-"]')]
          .map(e=>({id:e.getAttribute('data-akari-ui'),selected:e.getAttribute('aria-selected')})),
        inspector:{present:!!document.querySelector('[data-akari-ui="panel:inspector"]'),
          tile:!!document.querySelector(${S(tile)}),badge:!!document.querySelector('.akari-inspector-ai-done-badge'),
          transcribePanel:!!document.querySelector(${S(panel)}),back:!!document.querySelector('.akari-inspector-ai-back'),
          dialog:!!document.querySelector('[data-akari-transcribe-dialog="true"]')},
        notifications:document.querySelectorAll('.theia-notification-list-item').length
      }))()`);
    } catch (stateError) { result.failureState = { error: String(stateError) }; }
  }
} finally {
  try { cdp?.close(); } catch (error) { result.cleanupError = String(error); }
  if (electron?.pid) {
    result.killedPid = electron.pid;
    try {
      const signal = name => {
        try { process.kill(electron.pid, name); }
        catch (error) { if (error?.code !== 'ESRCH') throw error; }
      };
      if (electron.exitCode === null && electron.signalCode === null) signal('SIGTERM');
      let exited = await waitForExit(electron);
      if (!exited) {
        signal('SIGKILL');
        exited = await waitForExit(electron);
      }
      result.electronExited = exited;
      if (!exited) throw new Error('Electron did not exit after SIGKILL');
    } catch (error) { result.cleanupError = String(error); }
  }
  try {
    await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (error) { result.cleanupError = String(error); }
  try { await save(); } catch (error) { process.stderr.write(`Failed to save L1 result: ${String(error)}\n`); process.exitCode = 1; }
}
if (result.status !== 'PASS' || result.cleanupError) process.exitCode = 1;
