#!/usr/bin/env node
// Isolated Electron/CDP probe for the script selection viewport and selection event bridge.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = path.join(repo, 'apps/shell');
const out = process.env.AKARI_L1_EVIDENCE_DIR;
if (!out) throw new Error('AKARI_L1_EVIDENCE_DIR is required');
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-script-selection-')));
const project = path.join(scratch, 'project');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;
const cdpPort = Number(process.env.AKARI_L1_CDP_PORT ?? 9370);
const electron = path.join(shell, 'node_modules/electron/dist/electron.exe');
const result = { rowCount: 0, final: null, preview: null, timeline: null, manual: null, group: null,
  range: null, hiddenTab: null, playbackDock: null, sameRowTarget: null, stage: 'fixture', error: null };
let child;
let electronLog = '';
let electronExit;

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
    this.ws.addEventListener('close', () => { this.closed = true; });
  }
  send(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws?.close(); }
}

async function makeFixture() {
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await writeFile(path.join(project, '.akari/lint.json'), '{"version":1,"verdict":"pass"}\n');
  const video = path.join(project, 'assets/source.mp4');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
    '-i', 'color=c=black:s=160x90:r=1', '-t', '120', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
  { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`fixture ffmpeg: ${ff.error?.message ?? ff.stderr}`);
  const edit = { version: 2, output: { width: 160, height: 90, fps: 30 },
    sources: [{ id: 'src-1', path: 'assets/source.mp4', proxy: null }],
    tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip-1', at: 0, duration: 3600,
      source: { kind: 'media', src: 'src-1', in: 0, out: 120 } }] }] };
  const captions = { captions: Array.from({ length: 120 }, (_, index) => ({
    id: `c-${String(index + 1).padStart(4, '0')}`, start: index, end: index + 0.8,
    src: 'src-1', text: `確認用字幕 ${index + 1}`, speaker: null, sourceRef: null, edited: false,
    words: [{ start: index, end: index + 0.8, text: `確認用字幕 ${index + 1}` }]
  })) };
  await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit)}\n`);
  await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions)}\n`);
}

async function waitForPage() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (electronExit) throw new Error(`Electron exited ${electronExit.code}/${electronExit.signal}: ${electronLog.slice(-4000)}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      const page = targets.find(item => item.type === 'page' && !item.url.startsWith('devtools:'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('Electron CDP page timeout');
}

let cdp;
async function evaluate(expression, timeoutMs) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function command(id, value) {
  return evaluate(`(async () => { const d = window.theia?.container?._bindingDictionary;
    const keys = d?._map ? [...d._map.keys()] : [];
    const C = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!C) throw new Error('command registry missing');
    return window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(value)});
  })()`, 120000);
}
const snapshot = () => evaluate(`(() => {
  const panel = document.querySelector('.akari-daihon-widget');
  const rows = panel?.querySelector('.akari-daihon-rows');
  const dock = panel?.querySelector('.akari-daihon-dock');
  const selected = [...(panel?.querySelectorAll('.akari-daihon-row.selected') ?? [])];
  const rect = el => { const r = el?.getBoundingClientRect();
    return r && { top: r.top, bottom: r.bottom, height: r.height }; };
  const row = selected.length === 1 ? selected[0] : null;
  const viewport = rect(rows), inspector = rect(dock);
  const visibleBottom = dock?.classList.contains('open') ? Math.min(viewport?.bottom ?? 0,
    (rect(panel.querySelector('.akari-daihon-rows-region'))?.bottom ?? 0) - dock.offsetHeight) : viewport?.bottom;
  const active = document.activeElement;
  return { count: panel?.querySelectorAll('.akari-daihon-row').length ?? 0,
    selected: selected.map(el => el.dataset.captionId), dockTitle: dock?.querySelector('.akari-daihon-dock-title')?.textContent,
    footer: panel?.querySelector('.akari-daihon-footer')?.textContent,
    dockOpen: dock?.classList.contains('open'), scrollTop: rows?.scrollTop, row: rect(row), viewport,
    inspector, rowsRegion: rect(panel?.querySelector('.akari-daihon-rows-region')),
    visibleBottom, fullyVisible: !!row && row.getBoundingClientRect().top >= viewport.top
      && row.getBoundingClientRect().bottom <= visibleBottom,
    focused: rows === active, active: active && { tag: active.tagName, className: String(active.className), id: active.id } };
})()`);

async function capture(name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(out, `r2-${name}.png`), Buffer.from(png.data, 'base64'));
}
async function click(point, modifiers = 0) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
}
const rowPoint = id => evaluate(`(() => { const row = document.querySelector('.akari-daihon-row[data-caption-id="${id}"]');
  if (!row) return null; const r = row.getBoundingClientRect();
  return { x: r.left + 10, y: (r.top + r.bottom) / 2 }; })()`);
async function timelinePoint(id) {
  return evaluate(`(() => { const row = document.querySelector('.akari-annotations-widget '
    + '[data-akari-item-kind="caption"][data-akari-item-id="${id}"]');
    if (!row) return null; row.scrollIntoView({ block: 'nearest' });
    const rect = row.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2,
      width: rect.width, height: rect.height }; })()`);
}

try {
  await mkdir(out, { recursive: true });
  await makeFixture();
  result.stage = 'launch'; console.error('[l1] launch Electron');
  try { await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${cdpPort} occupied`); } catch (error) { if (String(error).includes('occupied')) throw error; }
  const profile = path.join(scratch, 'user-data');
  const config = path.join(scratch, 'theia-config');
  const home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  const electronEnv = { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [shell, project, `--remote-debugging-port=${cdpPort}`, '--hostname=127.0.0.1',
    '--port=49019', `--user-data-dir=${profile}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  { cwd: shell, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { electronLog = (electronLog + chunk.toString()).slice(-12000); });
  }
  child.on('exit', (code, signal) => { electronExit = { code, signal }; });
  const page = await waitForPage();
  result.stage = 'connect'; console.error('[l1] connect CDP');
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await capture('wake');
  result.stage = 'wait-layout'; console.error('[l1] wait for layout');
  for (let attempt = 0; attempt < 240; attempt++) {
    if (cdp.closed || electronExit) throw new Error(`Electron page closed during layout: ${electronLog.slice(-2000)}`);
    if (await evaluate('Boolean(window.theia?.container && document.querySelector(".akari-daihon-widget"))').catch(() => false)) break;
    await sleep(1000);
  }
  result.stage = 'wait-ready'; console.error('[l1] wait for ready workbench');
  let ready = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    ready = await evaluate('!document.querySelector(".theia-preload")').catch(() => false);
    if (ready) break;
    await sleep(1000);
  }
  if (!ready) throw new Error('workbench preload did not clear');
  result.stage = 'open-daihon'; console.error('[l1] open daihon');
  await command('akari.daihon.open', { captionId: 'c-0120', open: 'template' });
  result.stage = 'wait-rows'; console.error('[l1] wait for rows');
  for (let attempt = 0; attempt < 180; attempt++) {
    if (await evaluate('Boolean(document.querySelector(".akari-daihon-widget .akari-daihon-row"))').catch(() => false)) break;
    await sleep(1000);
  }
  await sleep(600);
  result.stage = 'measure'; console.error('[l1] measure and capture');
  result.final = await snapshot();
  result.rowCount = result.final.count;
  await capture('final-row');
  result.stage = 'check-timeline'; console.error('[l1] check timeline');
  result.openTimeline = await evaluate(`document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind="caption"]').length`);
  result.stage = 'open-preview'; console.error('[l1] open preview');
  result.openPreview = await command('akari.preview.ensureVisible', { editUri });
  await sleep(400);
  await evaluate(`document.querySelector('.akari-daihon-dock-close')?.click()`);
  const point60 = await timelinePoint('c-0060');
  result.timeline = { clicked: !!point60, point: point60 };
  if (!point60) throw new Error('timeline caption 60 missing');
  await click(point60);
  await sleep(600);
  result.timeline.state = await snapshot();
  await capture('timeline-row');
  await evaluate(`window.__l1Ticks = []; window.addEventListener('akari.preview.playbackTick',
    e => window.__l1Ticks.push({ time: e.detail?.time, playing: e.detail?.playing }))`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(900);
  result.space = await evaluate(`window.__l1Ticks.slice(-60)`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  try {
    result.stage = 'preview-click'; console.error('[l1] click preview caption');
    const seek = await command('akari.preview.seekOutput', { editUri, time: 39.4, waitForReady: true });
    await sleep(500);
    const point = { x: 480, y: 260 };
    await click(point);
    await sleep(600);
    result.previewClick = { seek, point, state: await snapshot() };
    await capture('preview-click-row');
  } catch (error) { result.previewClick = { error: String(error?.message ?? error) }; }
  result.preview = result.previewClick?.state;
  await command('akari.daihon.open', { captionId: 'c-0040', open: 'template' });
  const point60Open = await timelinePoint('c-0060');
  if (!point60Open) throw new Error('timeline caption 60 missing with dock open');
  await click(point60Open);
  await sleep(500);
  result.dockOpenSwitch = await snapshot();
  await capture('dock-open-switch');
  result.manual = await evaluate(`(() => { const rows = document.querySelector('.akari-daihon-rows');
    rows.style.scrollBehavior = 'auto'; rows.scrollTop = 4000; return { afterScroll: rows.scrollTop }; })()`);
  await sleep(250);
  const dockTabPoint = await evaluate(`(() => { const button = document.querySelector('.akari-daihon-dock-tabs button[data-dock-tab="look"]');
    const r = button?.getBoundingClientRect(); return r ? { x: (r.left+r.right)/2, y: (r.top+r.bottom)/2 } : null; })()`);
  if (!dockTabPoint) throw new Error('dock tab missing');
  await click(dockTabPoint);
  await sleep(500);
  result.manual.afterTab = await snapshot();
  await capture('manual-scroll');
  await command('akari.daihon.open', { captionId: 'c-0060', open: 'template' });
  await sleep(450);
  result.sameRowTarget = { before: result.manual.afterTab, after: await snapshot() };
  await capture('same-row-target');
  await command('akari.timeline.selectCaptions', { editUri,
    captionIds: ['c-0001', 'c-0002', 'c-0003'], primaryCaptionId: 'c-0002' });
  await command('akari.preview.seekOutput', { editUri, time: 1.4, waitForReady: true });
  await sleep(500);
  result.group = { before: await snapshot(), point: { x: 480, y: 260 } };
  await click(result.group.point);
  await sleep(500);
  result.group.after = await snapshot();
  await capture('group-preview-click');
  result.stage = 'range-selection'; console.error('[l1] Shift range and Ctrl+A');
  await command('akari.daihon.open', { captionId: 'c-0010', open: 'template' });
  await sleep(350);
  const row80 = await evaluate(`(() => { const rows = document.querySelector('.akari-daihon-rows');
    const row = document.querySelector('.akari-daihon-row[data-caption-id="c-0080"]');
    rows.style.scrollBehavior = 'auto'; rows.scrollTop = row.offsetTop - 80;
    return { scrollTop: rows.scrollTop, targetOffset: row.offsetTop }; })()`);
  await sleep(250);
  const point80 = await rowPoint('c-0080');
  if (!point80) throw new Error('row 80 missing');
  await click(point80, 8);
  await sleep(350);
  result.range = { before: row80, afterShift: await snapshot() };
  await capture('shift-range');
  await evaluate(`window.__r2KeyTrace = []; window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'a') window.__r2KeyTrace.push({ key: e.key, ctrl: e.ctrlKey,
      prevented: e.defaultPrevented, active: document.activeElement?.className,
      scrollTop: document.querySelector('.akari-daihon-rows')?.scrollTop });
  }, true)`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(350);
  result.range.afterAll = await snapshot();
  result.range.keyboardTrace = await evaluate('window.__r2KeyTrace');
  await capture('select-all');
  result.stage = 'hidden-tab'; console.error('[l1] hidden daihon tab selection');
  await command('akari.cuts.open');
  await sleep(350);
  result.hiddenTab = { hidden: await evaluate(`(() => { const panel = document.querySelector('.akari-daihon-widget');
    return panel && { visible: panel.offsetParent !== null, rect: panel.getBoundingClientRect().width }; })()`) };
  const point110 = await timelinePoint('c-0110');
  if (!point110) throw new Error('timeline caption 110 missing');
  await click(point110);
  await sleep(350);
  result.hiddenTab.selectionWhileHidden = await snapshot();
  await command('akari.daihon.open');
  await sleep(550);
  result.hiddenTab.afterShow = await snapshot();
  await capture('hidden-tab-return');
  result.stage = 'playback-dock'; console.error('[l1] playback follow then dock tab');
  await command('akari.daihon.open', { captionId: 'c-0010', open: 'template' });
  await sleep(2300);
  await command('akari.preview.seekOutput', { editUri, time: 39.4, waitForReady: true });
  const beforePlay = await snapshot();
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(900);
  const afterFollow = await snapshot();
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  const tabPoint = await evaluate(`(() => { const button = document.querySelector('.akari-daihon-dock-tabs button[data-dock-tab="look"]');
    const r = button?.getBoundingClientRect(); return r ? { x: (r.left+r.right)/2, y: (r.top+r.bottom)/2 } : null; })()`);
  if (!tabPoint) throw new Error('dock look tab missing after playback');
  await click(tabPoint);
  await sleep(450);
  result.playbackDock = { beforePlay, afterFollow, afterTab: await snapshot() };
  await capture('playback-dock-tab');
  const advancing = result.space?.filter(t => t.playing && Number.isFinite(t.time)) ?? [];
  if (result.rowCount !== 120 || !result.final.fullyVisible || result.final.selected[0] !== 'c-0120'
    || !result.timeline.clicked || result.timeline.state?.selected[0] !== 'c-0060'
    || !result.timeline.state?.fullyVisible || result.timeline.state?.dockOpen
    || result.timeline.state?.focused || advancing.length < 2 || advancing.at(-1).time <= advancing[0].time
    || result.previewClick?.seek !== 'seeked' || result.preview?.selected[0] !== 'c-0040'
    || !result.preview.fullyVisible || result.preview.focused
    || !result.dockOpenSwitch.dockOpen || !result.dockOpenSwitch.dockTitle?.includes('確認用字幕 60')
    || result.manual.afterScroll !== result.manual.afterTab.scrollTop
    || result.sameRowTarget.before.selected[0] !== 'c-0060'
    || result.sameRowTarget.before.fullyVisible || !result.sameRowTarget.after.fullyVisible
    || result.group.after?.selected.length !== 3
    || result.range.afterShift.selected.length < 2
    || Math.abs(result.range.afterShift.scrollTop - result.range.before.scrollTop) > 1
    || result.range.afterAll.selected.length !== 120
    || Math.abs(result.range.afterAll.scrollTop - result.range.before.scrollTop) > 1
    || result.hiddenTab.hidden?.visible !== false
    || Number(result.hiddenTab.selectionWhileHidden.selected[0]?.slice(2)) < 100
    || result.hiddenTab.afterShow.selected[0] !== result.hiddenTab.selectionWhileHidden.selected[0]
    || !result.hiddenTab.afterShow.fullyVisible
    || result.playbackDock.beforePlay.selected[0] !== 'c-0010'
    || result.playbackDock.afterFollow.scrollTop === result.playbackDock.beforePlay.scrollTop
    || Math.abs(result.playbackDock.afterTab.scrollTop - result.playbackDock.afterFollow.scrollTop) > 1) {
    throw new Error('selection acceptance assertion failed');
  }
} catch (error) {
  result.error = String(error?.message ?? error);
} finally {
  result.electronLog = electronLog.slice(-12000);
  cdp?.close();
  if (child?.pid) {
    const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    result.cleanup = { pid: child.pid, exit: stopped.status, error: stopped.error?.message ?? null };
  }
  await writeFile(path.join(out, 'r2-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const tempRoot = await realpath(os.tmpdir());
  if (!scratch.startsWith(tempRoot + path.sep)) throw new Error('scratch path escaped temp root');
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await rm(scratch, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 9) result.cleanupError = String(error);
      else await sleep(500);
    }
  }
}
console.log(JSON.stringify({ rowCount: result.rowCount, finalVisible: result.final?.fullyVisible,
  previewSelected: result.preview?.selected, error: result.error }));
if (result.error) process.exitCode = 1;
