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
const out = path.join(repo, 'evidence/script-panel-selection-sync');
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-script-selection-')));
const project = path.join(scratch, 'project');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;
const cdpPort = 9579;
const electron = path.join(shell, 'node_modules/electron/dist/electron.exe');
const result = { rowCount: 0, final: null, preview: null, timeline: null, manual: null, stage: 'fixture', error: null };
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
  return { count: panel?.querySelectorAll('.akari-daihon-row').length ?? 0,
    selected: selected.map(el => el.dataset.captionId), dockTitle: dock?.querySelector('.akari-daihon-dock-title')?.textContent,
    footer: panel?.querySelector('.akari-daihon-footer')?.textContent,
    dockOpen: dock?.classList.contains('open'), scrollTop: rows?.scrollTop, row: rect(row), viewport,
    inspector, rowsRegion: rect(panel?.querySelector('.akari-daihon-rows-region')),
    visibleBottom, fullyVisible: !!row && row.getBoundingClientRect().top >= viewport.top
      && row.getBoundingClientRect().bottom <= visibleBottom,
    focused: rows === document.activeElement };
})()`);

try {
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
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(out, 'final-row.png'), Buffer.from(png.data, 'base64'));
  result.stage = 'check-timeline'; console.error('[l1] check timeline');
  result.openTimeline = await evaluate(`document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind="caption"]').length`);
  result.stage = 'open-preview'; console.error('[l1] open preview');
  result.openPreview = await command('akari.preview.ensureVisible', { editUri });
  await sleep(400);
  await evaluate(`window.dispatchEvent(new CustomEvent('akari.preview.captionSelected', {
    detail: { editUri: ${JSON.stringify(editUri)}, captionId: 'c-0040' } }))`);
  await sleep(500);
  result.preview = await snapshot();
  const previewPng = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(out, 'preview-row.png'), Buffer.from(previewPng.data, 'base64'));
  const timelinePoint = await evaluate(`(() => {
    const row = document.querySelector('.akari-annotations-widget [data-akari-item-kind="caption"][data-akari-item-id="c-0060"]');
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2,
      width: rect.width, height: rect.height };
  })()`);
  result.timeline = { clicked: !!timelinePoint, point: timelinePoint };
  if (timelinePoint) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: timelinePoint.x, y: timelinePoint.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: timelinePoint.x, y: timelinePoint.y, button: 'left', clickCount: 1 });
    await sleep(600);
    result.timeline.state = await snapshot();
    const timelinePng = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(out, 'timeline-row.png'), Buffer.from(timelinePng.data, 'base64'));
  }
  result.manual = await evaluate(`(() => {
    const rows = document.querySelector('.akari-daihon-rows');
    rows.style.scrollBehavior = 'auto';
    rows.scrollTop += 160; return { afterScroll: rows.scrollTop };
  })()`);
  await sleep(500);
  result.manual.afterWait = await snapshot();
  if (result.rowCount !== 120 || !result.final.fullyVisible || result.final.selected[0] !== 'c-0120'
    || result.preview.selected[0] !== 'c-0040' || !result.preview.focused
    || !result.preview.dockTitle?.includes('確認用字幕 40')
    || !result.timeline.clicked || result.timeline.state?.selected[0] !== 'c-0060'
    || !result.timeline.state?.fullyVisible || !result.timeline.state?.dockTitle?.includes('確認用字幕 60')
    || result.manual.afterScroll !== result.manual.afterWait.scrollTop) {
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
  await writeFile(path.join(out, 'l1-result.json'), `${JSON.stringify(result, null, 2)}\n`);
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
