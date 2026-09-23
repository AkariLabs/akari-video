#!/usr/bin/env node
// Run after the shell bundle is built. All profiles, generated files, and provider calls are isolated.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const electronRelativePath = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const shellElectron = path.join(SHELL, electronRelativePath);
const ELECTRON = await stat(shellElectron).then(entry => entry.isFile()).catch(() => false)
  ? shellElectron : path.join(REPO, electronRelativePath);
const PROJECT = path.join(ROOT, 'fixture/project');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22223);
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-tab-l1-'));
const S = JSON.stringify;
const results = { status: 'running', step: 'initializing', port: PORT, checks: [], screenshots: [], scenarios: [] };
export const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  text = text.replaceAll(ISO, '<TMP>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const save = async () => {
  const file = path.join(ROOT, 'results.json');
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(results, null, 2))}\n`);
  await rename(temporary, file);
};
const stage = async name => { results.step = name; await save(); };
function check(name, pass, measured) {
  results.checks.push({ name, pass: Boolean(pass), measured });
  if (!pass) throw new Error(`${name}: ${JSON.stringify(measured)}`);
}
async function waitEval(cdp, expression, name, timeout = 90_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression).catch(() => undefined);
    if (value) return value;
    await sleep(180);
  }
  throw new Error(`Timed out: ${name}`);
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs')], { cwd: REPO, stdio: 'pipe' });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(`Fixture failed: ${error}`);
  return JSON.parse(output.trim());
}
async function click(cdp, selector) {
  const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, selector);
  await realClick(cdp, point.x, point.y);
}
async function selectCut(cdp, index) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await click(cdp, selector);
  await waitEval(cdp, `document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')`, `cut ${index}`);
}
const tab = '[data-akari-ui="tab:inspector-generation"]';
const tile = '[data-akari-inspector-ai-tile="video"]';
const back = '.akari-inspector-ai-back';
const section = '[data-akari-ui="section:inspector-generation"]';
async function openAi(cdp) {
  await waitEval(cdp, `(()=>{const t=document.querySelector(${S(tab)});return t&&!t.disabled})()`, 'AI tab enabled');
  const state = await evalOn(cdp, `(()=>{const t=document.querySelector(${S(tab)});return{text:t.textContent.trim(),id:t.getAttribute('data-akari-ui'),enabled:!t.disabled}})()`);
  check('AI tab label and id', state.text === 'AI' && state.id === 'tab:inspector-generation' && state.enabled, state);
  if (await evalOn(cdp, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')!=='true'`)) await click(cdp, tab);
  await waitEval(cdp, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`, 'AI tab selected');
}
async function shot(cdp, name) {
  const rect = await waitEval(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');if(!e)return null;
    const r=e.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height}:null})()`, 'inspector rect');
  check(`${name}: readable inspector width`, rect.width >= 320, rect);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
  const file = path.join(ROOT, name);
  const bytes = Buffer.from(data, 'base64');
  await writeFile(file, bytes);
  results.screenshots.push({ file: name, bytes: bytes.length, panelWidth: rect.width });
  check(`${name}: screenshot under 500KB`, bytes.length <= 500_000, { bytes: bytes.length });
  await save();
}
async function inspectTile(cdp, disabled) {
  const measured = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(tile)}),img=e?.querySelector('img'),title=e?.querySelector('.akari-inspector-ai-title'),reason=e?.querySelector('.akari-inspector-ai-reason');
    if(!e||!img||!title)return null;const rect=x=>{const r=x.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const style=getComputedStyle(e);return{image:rect(img),natural:{width:img.naturalWidth,height:img.naturalHeight},complete:img.complete,
      title:rect(title),reason:reason?rect(reason):null,reasonText:reason?.textContent??null,
      filter:getComputedStyle(img).filter,background:style.backgroundColor,borderWidth:style.borderTopWidth,
      borderStyle:style.borderTopStyle,ariaDisabled:e.getAttribute('aria-disabled')}})()`);
  check('tile artwork loads', measured?.complete && measured.natural.width === 320 && measured.natural.height === 180, measured);
  const ratio = measured.image.width / measured.image.height;
  check('tile artwork rectangle 16:9', Math.abs(ratio - 16 / 9) <= 0.02, { ratio, rect: measured.image });
  check('title and reason rectangles do not intersect', !measured.reason ||
    measured.title.bottom <= measured.reason.top || measured.reason.bottom <= measured.title.top,
    { title: measured.title, reason: measured.reason });
  check('tile enabled state', measured.ariaDisabled === String(disabled), measured);
  if (disabled) {
    check('disabled artwork grayscale', measured.filter.includes('grayscale'), { filter: measured.filter });
    check('disabled reason one line', measured.reasonText === '静止画か空の枠で使えます' &&
      measured.reason.height <= 20, { reason: measured.reasonText, rect: measured.reason });
  } else {
    check('enabled tile has background or border',
      !['transparent', 'rgba(0, 0, 0, 0)'].includes(measured.background) ||
      (Number.parseFloat(measured.borderWidth) > 0 && measured.borderStyle !== 'none'),
      { background: measured.background, borderWidth: measured.borderWidth, borderStyle: measured.borderStyle });
  }
  return measured;
}
async function waitSidecarStatus(status, timeout = 30_000) {
  const file = path.join(PROJECT, 'assets/generated/gen-clip-a.mp4.meta.json');
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const meta = await readFile(file, 'utf8').then(JSON.parse).catch(() => undefined);
    if (meta?.status === status) return meta;
    await sleep(150);
  }
  throw new Error(`fake sidecar did not reach ${status}`);
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
  await stage('checking Electron and port');
  await stat(ELECTRON);
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid --port');
  await stage('preparing isolated fixture');
  results.fixture = await runFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(ISO, name));
  await stage('launching Electron');
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
      AKARI_GENERATE_CLI: path.join(ROOT, 'scripts/fake-generate.mjs') }, stdio: 'ignore'
  });
  await stage('connecting CDP');
  const target = await (async () => {
    const until = Date.now() + 600_000;
    while (Date.now() < until) {
      const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
      if (page) return page;
      await sleep(300);
    }
    throw new Error('Electron CDP page did not appear');
  })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const window = await cdp.send('Browser.getWindowForTarget').catch(() => null);
  if (window) await cdp.send('Browser.setWindowBounds', { windowId: window.windowId,
    bounds: { width: 1600, height: 1000 } }).catch(() => {});
  await stage('waiting for Theia workbench');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 1_500_000);
  const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
  await stage('opening timeline and inspector');
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) {
    await evalOn(cdp, command('akari.annotations.open'));
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:3"]'))`, 'timeline clips', 600_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');

  await stage('01 still tile list');
  await selectCut(cdp, 3); // Plain still, without a next job.
  await openAi(cdp);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'still tile');
  const headings = await evalOn(cdp, `[...document.querySelectorAll('.akari-inspector-ai-heading')].map(e=>e.textContent)`);
  check('still list shows only 作る', JSON.stringify(headings) === '["作る"]', headings);
  await inspectTile(cdp, false);
  await shot(cdp, '01-still-list.png');

  await stage('02 video action panel');
  await click(cdp, tile);
  await waitEval(cdp, `Boolean(document.querySelector(${S(back)})&&document.querySelector(${S(section)}))`, 'video panel');
  const form = await evalOn(cdp, `(()=>{const s=document.querySelector(${S(section)});return{back:document.querySelector(${S(back)})?.textContent,
    title:document.querySelector('.akari-inspector-ai-panel-title')?.textContent,
    model:!!s?.querySelector('[data-akari-ui="field:inspector-generation-model"]'),
    prompt:!!s?.querySelector('[data-akari-ui="field:inspector-prompt"]'),
    estimate:s?.textContent?.includes('見積'),generate:!!s?.querySelector('[data-akari-generation-action="generate"]')}})()`);
  check('existing video form inside panel', form.back === '← AI' && form.title === '動画にする' &&
    form.model && form.prompt && form.estimate && form.generate, form);
  await shot(cdp, '02-video-panel.png');

  await stage('03 return to AI list');
  await click(cdp, back);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'back to tiles');
  check('← AI is clickable and returns to list', true, { tilePresent: true });
  await shot(cdp, '03-back-to-list.png');

  await stage('04 ordinary video disabled tile');
  await selectCut(cdp, 4); // Ordinary mp4 with no generation sidecar.
  await openAi(cdp);
  await waitEval(cdp, `document.querySelector(${S(tile)})?.getAttribute('aria-disabled')==='true'`, 'disabled video tile');
  await inspectTile(cdp, true);
  await shot(cdp, '04-ordinary-video.png');

  await stage('05 planned empty frame list');
  await selectCut(cdp, 1); // Empty planned frame with no next job.
  await openAi(cdp);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'planned slot list');
  check('planned slot opens list', !await evalOn(cdp, `Boolean(document.querySelector(${S(back)}))`),
    { list: true, panel: false });
  await shot(cdp, '05-planned-slot.png');

  await stage('06 planned video form');
  await selectCut(cdp, 0); // Video-planned still with a fake runnable next job.
  await openAi(cdp);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'generation input list');
  await click(cdp, tile);
  await waitEval(cdp, `Boolean(document.querySelector(${S(section)}))`, 'planned slot form');
  await shot(cdp, '06-before-fake-generate.png');
  await stage('07 fake generation progress');
  await click(cdp, '[data-akari-generation-action="generate"]');
  await waitEval(cdp, `Boolean([...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認')))`, 'cost approval');
  await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認'));
    const b=[...d.querySelectorAll('button')].find(e=>e.textContent.includes('費用承認する'));if(!b)throw new Error('approval button missing');b.click()})()`);
  const meta = await waitSidecarStatus('generating');
  await waitEval(cdp, `(()=>{const s=document.querySelector(${S(section)});return s?.textContent?.includes('生成中')})()`, 'generation progress', 25_000);
  check('fake generate progress', meta.job?.provider === 'fake', { status: meta.status, provider: meta.job?.provider });
  await shot(cdp, '07-fake-generating.png');

  await stage('08 reselect generating clip');
  await selectCut(cdp, 3);
  await selectCut(cdp, 0);
  await openAi(cdp);
  const reselected = await waitEval(cdp, `(()=>{const b=document.querySelector(${S(back)}),s=document.querySelector(${S(section)});
    return b&&s&&s.textContent.includes('生成中')?{back:b.textContent.trim(),progress:true,
      tilePresent:!!document.querySelector(${S(tile)})}:null})()`, 'generating clip direct panel');
  check('reselected generating clip opens dedicated panel', reselected.back === '← AI' &&
    reselected.progress && !reselected.tilePresent, reselected);
  await shot(cdp, '08-reselect-generating.png');
  results.scenarios = ['still list', 'video form', 'back', 'ordinary video disabled',
    'planned slot list', 'fake generating', 'reselect generating'];
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.failedStep = results.step;
  results.error = sanitizeText(error?.stack ?? error);
} finally {
  results.step = 'cleanup';
  try { cdp?.close(); } catch (error) { results.cleanupError = sanitizeText(error?.stack ?? error); }
  if (electron?.pid) {
    results.killedPid = electron.pid;
    try {
      if (electron.exitCode === null && electron.signalCode === null) process.kill(electron.pid, 'SIGTERM');
      let exited = await waitForExit(electron);
      if (!exited) {
        process.kill(electron.pid, 'SIGKILL');
        exited = await waitForExit(electron);
      }
      results.electronExited = exited;
      if (!exited) throw new Error('Electron did not exit after SIGKILL');
    } catch (error) {
      results.cleanupError = sanitizeText(error?.stack ?? error);
    }
  }
  try {
    await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (error) {
    results.cleanupError = sanitizeText(error?.stack ?? error);
  }
  if (results.cleanupError) results.status = 'FAIL';
  else results.step = 'finished';
  await save();
}
if (results.status !== 'PASS' || results.checks.some(row => !row.pass)) process.exitCode = 1;
