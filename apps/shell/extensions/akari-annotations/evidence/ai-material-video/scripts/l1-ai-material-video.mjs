#!/usr/bin/env node
// Requires a built Electron shell. Generation is confined to the local fake CLI.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-material-video-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22245);
const S = JSON.stringify;
const tempPaths = new Set([ISO, os.tmpdir(), await realpath(os.tmpdir())]);
for (const dir of [...tempPaths]) {
  if (dir.startsWith('/private/var/folders/')) tempPaths.add(dir.slice('/private'.length));
  if (dir.startsWith('/var/folders/')) tempPaths.add(`/private${dir}`);
}
const redactions = [...tempPaths].sort((a, b) => b.length - a.length);
const launchEnv = { ...process.env, AKARI_GENERATE_CLI: path.join(ROOT, 'scripts/fake-generate.mjs'),
  AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') };
for (const name of Object.keys(launchEnv)) if (/FAL_KEY|OPENAI_API_KEY|GROQ|ELEVENLABS|GEMINI_API_KEY|XAI_API_KEY/iu.test(name)) delete launchEnv[name];
const results = { status: 'running', checks: [], clicks: [], screenshots: [], fakeCli: { configured: true, falKeyPresent: false, invocations: 0 }, measurements: {} };
const save = async () => {
  let data = JSON.stringify(results, null, 2);
  for (const dir of redactions) data = data.replaceAll(dir, '<TEMP>');
  const target = path.join(ROOT, 'results.json'), temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, data + '\n'); await rename(temporary, target);
};
const check = (name, passed, observed) => { results.checks.push({ name, passed: Boolean(passed), observed }); if (!passed) throw Error(`${name}: ${JSON.stringify(observed)}`); };
async function waitEval(cdp, expression, name, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression, undefined, Math.min(60_000, until - Date.now())).catch(() => null);
    if (value) return value;
    await sleep(150);
  }
  throw Error(`Timed out: ${name}`);
}
async function settle(cdp) {
  const stable = await evalOn(cdp, `new Promise(resolve=>{const roots=[document.querySelector('[data-akari-ui="panel:inspector"]'),document.querySelector('[data-akari-ui="panel:timeline"]'),document.querySelector('[data-akari-material-path]')?.parentElement].filter(Boolean);if(!roots.length){resolve(true);return}let quiet,limit;const observers=roots.map(root=>{const o=new MutationObserver(reset);o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return o});function done(value){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(value)}function reset(){clearTimeout(quiet);quiet=setTimeout(()=>done(true),500)}limit=setTimeout(()=>done(false),20_000);reset()})`, undefined, 60_000);
  if (!stable) throw Error('UI did not settle within 20 seconds');
}
async function dismiss(cdp) {
  await evalOn(cdp, `(async()=>{const d=window.theia?.container?._bindingDictionary;const C=d&&[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(C)await window.theia.container.get(C).executeCommand('notifications.commands.clearAll');return true})()`).catch(() => null);
  await evalOn(cdp, `(()=>{const toast=[...document.querySelectorAll('.akari-update-toast')].find(e=>e.textContent?.includes('新しい版があります'));if(!toast)return false;const buttons=[...toast.querySelectorAll('button')];const close=buttons.find(e=>e.textContent?.trim()==='後で')??buttons.find(e=>e.textContent?.trim()==='×'||e.getAttribute('aria-label')==='この版は出さない');if(!close)return false;close.click();return true})()`).catch(() => null);
}
async function clickUntil(cdp, selector, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await settle(cdp); await dismiss(cdp);
      const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,h=document.elementFromPoint(x,y);if(!b.width||!b.height||!h)return null;const blocked=h!==e&&!e.contains(h);const blocker=blocked?(h.closest('.akari-update-toast,.theia-notification-list-item,[role="alert"],[role="status"],[class*="toast"]')??h):null;return{x,y,blocked,blockerText:blocker?.textContent?.trim().slice(0,60)??''}})()`, `${name} target`, 5000);
      if (point.blocked) throw new Error(`${name} target blocked by: ${point.blockerText || '(text unavailable)'}`);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expected, name, 5000);
      results.clicks.push({ name, attempt, passed: true }); return;
    } catch (error) { results.clicks.push({ name, attempt, passed: false, error: String(error) }); if (attempt === 3) throw error; }
  }
}
async function shot(cdp, filename, selector = '[data-akari-ui="panel:inspector"]') {
  await settle(cdp);
  await dismiss(cdp);
  const rect = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height}:null})()`, `${filename} rect`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...rect, scale: 1 } });
  const bytes = Buffer.from(data, 'base64'); await writeFile(path.join(ROOT, filename), bytes);
  results.screenshots.push({ filename, bytes: bytes.length }); await save();
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs'), PROJECT], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { error += b; });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw Error(`fixture ${code}: ${error}`);
  results.fixture = JSON.parse(output.trim());
}
async function waitForExit(child, ms = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => { const timer = setTimeout(() => resolve(false), ms); child.once('exit', () => { clearTimeout(timer); resolve(true); }); });
}
const card = relative => `[data-akari-material-path=${S(relative)}]`;
const tile = '[data-akari-inspector-ai-tile="video"]';
const action = '[data-akari-generation-action="generate"]';
let electron, cdp;
try {
  await stat(ELECTRON); await runFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(ISO, name));
  const editBefore = await readFile(path.join(PROJECT, 'edit.json'));
  const imageBefore = createHash('sha256').update(await readFile(path.join(PROJECT, 'assets/still.png'))).digest('hex');
  check('FAL_KEY removed before Electron launch', !Object.hasOwn(launchEnv, 'FAL_KEY'), false);
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], { cwd: REPO, env: launchEnv, stdio: 'ignore' });
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) { const found = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => null); if (found) return found; await sleep(300); } throw Error('Electron CDP page did not appear'); })();
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell')&&(()=>{const p=document.querySelector('.theia-preload');return !p||getComputedStyle(p).display==='none'||Number(getComputedStyle(p).opacity)===0})())`, 'preload removed', 180_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:timeline"]'))`)) {
    await evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');await window.theia.container.get(C).executeCommand('akari.annotations.open');return true})()`);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:timeline"]'))`, 'timeline panel');
  await waitEval(cdp, `Boolean(document.querySelector(${S(card('assets/still.png'))}))`, 'image card');
  await clickUntil(cdp, card('assets/still.png'), `document.querySelector('.akari-inspector-ai-material-name')?.textContent==='still.png'`, 'image card');
  const timelineBefore = await evalOn(cdp, `document.querySelector('[data-akari-ui="panel:timeline"]')?.outerHTML ?? null`);
  check('original image card remains', await evalOn(cdp, `Boolean(document.querySelector(${S(card('assets/still.png'))}))`), true);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'video tile');
  await shot(cdp, '01-image-video-tile.png');
  await clickUntil(cdp, tile, `Boolean(document.querySelector('[data-akari-field="generation-model"]'))`, 'video form');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-field="generation-estimate"]')&&document.querySelector(${S(action)}))`, 'model and estimate');
  await shot(cdp, '02-image-video-form.png');
  await clickUntil(cdp, action, `Boolean([...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認')))`, 'cost approval');
  await shot(cdp, '03-cost-approval.png', '.dialogBlock');
  await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認'));const b=[...d.querySelectorAll('button')].find(e=>e.textContent.includes('費用承認する'));if(!b)throw Error('approval button missing');b.click();return true})()`);
  await waitEval(cdp, `Boolean(document.querySelector(${S(action)})?.textContent.includes('生成中'))`, 'generating');
  await shot(cdp, '04-generating.png');
  const invocation = await (async () => { const until = Date.now() + 90_000; while (Date.now() < until) { try { return JSON.parse(await readFile(path.join(PROJECT, 'fake-invocation.json'), 'utf8')); } catch { await sleep(200); } } throw Error('fake CLI invocation missing'); })();
  results.fakeCli.invocations = 1; results.fakeCli.args = invocation.args; results.fakeCli.falKeyPresent = invocation.falKeyPresent;
  check('fake CLI used without fal key', invocation.args.includes('--from-image') && !invocation.falKeyPresent, invocation);
  await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-material-created')?.textContent.includes('新しい素材'))`, 'new material completion', 90_000);
  await shot(cdp, '05-created.png');
  const generated = (await readFile(path.join(PROJECT, 'fake-invocation.json'), 'utf8')) && (await (async () => { const dir = path.join(PROJECT, 'assets/generated'); const { readdir } = await import('node:fs/promises'); return (await readdir(dir)).find(name => name.endsWith('.mp4')); })());
  check('generated video file exists', Boolean(generated), generated);
  await waitEval(cdp, `Boolean(document.querySelector(${S(card(`assets/generated/${generated}`))}))`, 'new video card', 90_000);
  await shot(cdp, '06-material-cards.png', 'body');
  const editAfter = await readFile(path.join(PROJECT, 'edit.json'));
  const imageAfter = createHash('sha256').update(await readFile(path.join(PROJECT, 'assets/still.png'))).digest('hex');
  results.measurements = { editBytesBefore: editBefore.length, editBytesAfter: editAfter.length,
    editByteEqual: editBefore.equals(editAfter), imageSha256Before: imageBefore, imageSha256After: imageAfter,
    timelineDomEqual: timelineBefore === await evalOn(cdp, `document.querySelector('[data-akari-ui="panel:timeline"]')?.outerHTML ?? null`), generated };
  check('edit and timeline DOM unchanged', results.measurements.editByteEqual && results.measurements.timelineDomEqual, results.measurements);
  check('original image unchanged and still present', imageBefore === imageAfter && await evalOn(cdp, `Boolean(document.querySelector(${S(card('assets/still.png'))}))`), imageAfter);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.error = String(error);
  if (cdp) try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(ROOT, 'error-full.png'), Buffer.from(data, 'base64')); } catch {}
} finally {
  try { cdp?.close(); } catch {}
  if (electron?.pid) {
    results.killedPid = electron.pid;
    if (electron.exitCode === null && electron.signalCode === null) try { process.kill(electron.pid, 'SIGTERM'); } catch {}
    if (!await waitForExit(electron)) { try { process.kill(electron.pid, 'SIGKILL'); } catch {} await waitForExit(electron); }
  }
  try { await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (error) { results.cleanupError = String(error); }
  await save();
}
if (results.status !== 'PASS' || results.cleanupError) process.exitCode = 1;
