#!/usr/bin/env node
// L1: 実 Electron の計算済みスタイルと実クリックによる折り畳みを観測する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL_DIR = path.join(REPO, 'apps/shell');
const electronCandidates = [SHELL_DIR, REPO].map(directory =>
  path.join(directory, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
const ELECTRON = process.env.ELECTRON || electronCandidates.find(candidate => existsSync(candidate));
if (!ELECTRON) {
  throw new Error(`Electron executable not found. Set ELECTRON=/path/to/Electron. Searched: ${electronCandidates.join(', ')}`);
}
const vendoredFfmpeg = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFMPEG = process.env.FFMPEG || (existsSync(vendoredFfmpeg) ? vendoredFfmpeg : 'ffmpeg');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22214);
assert.ok(Number.isInteger(PORT) && PORT > 0 && PORT < 65536, 'invalid CDP port');
const RESULTS = path.join(ROOT, 'results.json');
const S = JSON.stringify;
const out = { status: 'running', measurements: [], screenshots: [], cleanup: null };
let iso, child, cdp, launchError;
let log = '';

const sanitizeText = value => {
  let text = String(value);
  if (iso) text = text.replaceAll(iso, '<TMP>');
  return text.replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
    .replaceAll(os.tmpdir(), '<TMP>')
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};

async function waitEval(expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const processChild = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: false });
  let stderr = '';
  processChild.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const timer = setTimeout(() => processChild.kill('SIGKILL'), 120_000);
  processChild.once('error', error => { clearTimeout(timer); reject(error); });
  processChild.once('close', code => {
    clearTimeout(timer);
    code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`));
  });
});

async function fixture() {
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  iso = await mkdtemp(path.join(ROOT, 'runs', 'l1-'));
  const project = path.join(iso, 'project');
  await cp(path.join(REPO, 'templates/project-default'), project, { recursive: true });
  for (const dir of ['akari-home', 'theia-config', 'user-data']) {
    await mkdir(path.join(iso, dir), { recursive: true });
  }
  await mkdir(path.join(project, 'assets/video'), { recursive: true });
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc=size=640x360:rate=30', '-t', '3', '-an', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', path.join(project, 'assets/video/a.mp4')], project);
  await copyFile(path.join(project, 'assets/video/a.mp4'), path.join(project, 'assets/video/b.mp4'));
  const edit = {
    version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: ['a', 'b'].map(name => ({ id: `video-${name}`, path: `assets/video/${name}.mp4` })),
    tracks: [{ id: 'visual-main', lane: 'visual', items: ['a', 'b'].map((name, index) => ({
      id: `clip-${name}`, at: index * 90, duration: 90,
      source: { kind: 'media', src: `video-${name}`, in: 0, out: 3 }
    })) }],
    audio: { narration: [], sfx: [] }
  };
  await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  out.fixture = { project, clips: edit.tracks[0].items.map(item => item.id), ffmpeg: FFMPEG };
  return project;
}

async function launch(project) {
  // Refuse to attach to an existing debugging session on the requested port.
  let occupied = false;
  try { await listTargets(PORT); occupied = true; } catch {}
  assert.equal(occupied, false, `CDP port ${PORT} is already in use`);
  child = spawn(ELECTRON, [SHELL_DIR, project, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(iso, 'user-data')}`, '--no-sandbox',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling'], {
    cwd: REPO, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AKARI_HOME: path.join(iso, 'akari-home'), THEIA_CONFIG_DIR: path.join(iso, 'theia-config') }
  });
  child.once('error', error => { launchError = error; });
  const append = chunk => { log = (log + sanitizeText(chunk)).slice(-100_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 600_000;
  while (!target && Date.now() < deadline) {
    if (launchError) throw launchError;
    assert.ok(child.exitCode === null && child.signalCode === null, 'Electron exited before CDP was ready');
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert.ok(target, 'CDP page target did not appear');
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(`Boolean(window.theia?.container && document.getElementById('theia-app-shell'))`, {
    timeoutMs: 1_500_000, label: 'Theia workbench'
  });
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
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

// appendSection prefixes the exact section.label with ▸ / ▾; no substring matches.
const sectionElement = label => `[...document.querySelectorAll('.akari-inspector-widget .akari-inspector-section')].find(e =>
  e.querySelector('.akari-inspector-section-toggle')?.textContent.replace(/^[▸▾]\\s*/u, '').trim() === ${S(label)})`;
const snapshot = `(()=>[...document.querySelectorAll('.akari-inspector-widget .akari-inspector-section')].map(section => {
  const toggle = section.querySelector('.akari-inspector-section-toggle');
  const body = section.querySelector('.akari-inspector-section-body');
  return { heading: toggle?.textContent.trim(), label: toggle?.textContent.replace(/^[▸▾]\\s*/u, '').trim(),
    hidden: body?.hasAttribute('hidden'), display: body ? getComputedStyle(body).display : null,
    height: body?.getBoundingClientRect().height, expanded: toggle?.getAttribute('aria-expanded') };
}))()`;

async function measure(stage) {
  const sections = await evalOn(cdp, snapshot);
  out.measurements.push({ stage, sections });
  await save(); // Preserve the observed values even when the following assertion fails.
  return sections;
}
function expectBody(sections, label, display) {
  const section = sections.find(value => value.label === label);
  assert.ok(section, `section ${label} missing`);
  assert.equal(section.display, display, `${label}: computed display`);
  assert.equal(section.hidden, display === 'none', `${label}: hidden attribute`);
  assert.equal(section.expanded, String(display !== 'none'), `${label}: aria-expanded`);
  if (display === 'none') assert.equal(section.height, 0, `${label}: collapsed height`);
  else assert.ok(section.height > 0, `${label}: expanded height`);
}

async function clickElement(expression) {
  const point = await waitEval(`(()=>{const e=${expression};if(!e)return null;
    e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return r.width>0&&r.height>0&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, { label: 'clickable element' });
  await realClick(cdp, point.x, point.y);
}
async function selectClip(index) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await clickElement(`document.querySelector(${S(selector)})`);
  await waitEval(`document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')`, {
    label: `clip ${index + 1} selected`
  });
  await evalOn(cdp, command('akari.inspector.open'));
  await waitEval(`(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return e&&e.offsetParent!==null})()`, {
    label: 'inspector foreground after selection'
  });
  // The video tab's time section identifies the newly rendered clip by its output position.
  await waitEval(`(()=>{const body=(${sectionElement('時間')})?.querySelector('.akari-inspector-section-body');
    return document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')
      && body?.textContent.includes(${S(index === 0 ? '00:00:00.000' : '00:00:03.000')})})()`, {
    label: `inspector for clip ${index + 1}`
  });
}
async function toggleTransform(collapsed) {
  await clickElement(`(${sectionElement('変形')})?.querySelector('.akari-inspector-section-toggle')`);
  await waitEval(`(()=>{const body=(${sectionElement('変形')})?.querySelector('.akari-inspector-section-body');
    return body && body.hidden===${collapsed}})()`, { label: 'transform hidden attribute updated' });
  await evalOn(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
}
async function shot(name) {
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

try {
  await mkdir(ROOT, { recursive: true });
  // Do not leave stale success images from an earlier run.
  for (const name of ['before.png', 'after-collapsed.png', 'failure.png']) {
    await rm(path.join(ROOT, name), { force: true });
  }
  const project = await fixture();
  await save();
  await launch(project);
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  const restored = await waitEval(`Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`, {
    timeoutMs: 60_000, label: 'restored timeline'
  }).then(() => true).catch(() => false);
  if (!restored) await evalOn(cdp, command('akari.annotations.open'));
  await evalOn(cdp, command('akari.inspector.open'));
  await waitEval(`(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return e&&e.offsetParent!==null})()`, {
    timeoutMs: 600_000, label: 'visible inspector'
  });
  await selectClip(0);
  await clickElement(`document.querySelector('[data-akari-ui="tab:inspector-info"]')`);
  await waitEval(`Boolean(${sectionElement('情報')})`, { label: 'information tab section rendered' });
  expectBody(await measure('info-tab-initial'), '情報', 'none');
  const infoText = await evalOn(cdp, `(${sectionElement('情報')}).textContent`);
  assert.ok(infoText.includes('a.mp4'), 'information tab identifies clip a.mp4');
  await clickElement(`document.querySelector('[data-akari-ui="tab:inspector-video"]')`);
  await waitEval(`(()=>{const body=(${sectionElement('変形')})?.querySelector('.akari-inspector-section-body');
    return body && getComputedStyle(body).display==='grid' && body.getBoundingClientRect().height>0})()`, {
    label: 'transform visible after returning to video tab'
  });
  const initial = await measure('initial-clip-a');
  expectBody(initial, '変形', 'grid');
  await evalOn(cdp, `(${sectionElement('変形')}).scrollIntoView({block:'center',behavior:'instant'})`);
  await shot('before.png');
  await toggleTransform(true);
  expectBody(await measure('collapsed-clip-a'), '変形', 'none');
  await shot('after-collapsed.png');
  await toggleTransform(false);
  expectBody(await measure('reopened-clip-a'), '変形', 'grid');
  await toggleTransform(true);
  expectBody(await measure('closed-before-reselection'), '変形', 'none');
  await selectClip(1);
  expectBody(await measure('selected-clip-b'), '変形', 'none');
  await selectClip(0);
  expectBody(await measure('reselected-clip-a'), '変形', 'none');
  await toggleTransform(false);
  expectBody(await measure('restored-open-clip-a'), '変形', 'grid');
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitizeText(error.stack || error.message || error);
  if (cdp) {
    await measure('failure').catch(() => {});
    await shot('failure.png').catch(() => {});
  }
  process.exitCode = 1;
} finally {
  cdp?.close();
  // Kill only the child created by this run, never a process-name pattern or process group.
  const alive = () => Boolean(child?.pid && child.exitCode === null && child.signalCode === null && !launchError);
  if (alive()) {
    child.kill('SIGTERM');
    for (let i = 0; i < 25 && alive(); i++) await sleep(100);
    if (alive()) child.kill('SIGKILL');
    for (let i = 0; i < 25 && alive(); i++) await sleep(100);
  }
  out.cleanup = { pid: child?.pid ?? null, alive: alive(), isolatedDirectory: iso ?? null, removed: false };
  if (alive()) {
    out.status = 'fail';
    out.cleanup.error = 'Electron did not stop';
    process.exitCode = 1;
  } else if (iso) {
    try {
      await rm(iso, { recursive: true, force: true });
      out.cleanup.removed = true;
    } catch (error) {
      out.status = 'fail';
      out.cleanup.error = sanitizeText(error.message);
      process.exitCode = 1;
    }
  }
  if (out.status === 'fail') out.electronLogTail = log.slice(-8000);
  await save();
}
