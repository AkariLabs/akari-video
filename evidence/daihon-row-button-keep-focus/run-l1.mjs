#!/usr/bin/env node
// Measure real mouse, keyboard, focus, playback and scroll behavior in isolated Electron.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

if (await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) process.exit(0);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = path.join(repo, 'apps/shell');
const out = process.env.AKARI_L1_EVIDENCE_DIR;
const taskTmp = process.env.AKARI_TASK_TMP;
if (!out || !taskTmp) throw new Error('Set AKARI_L1_EVIDENCE_DIR and AKARI_TASK_TMP');
await mkdir(taskTmp, { recursive: true });
const scratch = await realpath(await mkdtemp(path.join(taskTmp, 'l1-')));
const project = path.join(scratch, 'project');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;
const port = Number(process.env.AKARI_L1_CDP_PORT ?? 9380);
const electron = path.join(repo, 'node_modules/electron/dist/electron.exe');
const result = { stage: 'fixture', rowCount: null, tc: null, playback: null, gear: null,
  speaker: null, split: null, cut: null, cutPopup: null, keyboard: null, blank: null, word: null, error: null };
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

async function fixture() {
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await writeFile(path.join(project, '.akari/lint.json'), '{"version":1,"verdict":"pass"}\n');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
    '-i', 'color=c=black:s=160x90:r=1', '-t', '120', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    path.join(project, 'assets/source.mp4')], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`fixture ffmpeg: ${ff.error?.message ?? ff.stderr}`);
  const edit = { version: 2, output: { width: 160, height: 90, fps: 30 },
    sources: [{ id: 'src-1', path: 'assets/source.mp4', proxy: null }],
    tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip-1', at: 0, duration: 3600,
      source: { kind: 'media', src: 'src-1', in: 0, out: 120 } }] }] };
  const captions = { captions: Array.from({ length: 120 }, (_, index) => ({
    id: `c-${String(index + 1).padStart(4, '0')}`, start: index, end: index + 0.8,
    src: 'src-1', text: `確認用字幕${index + 1}`, speaker: index % 2 ? '話者B' : '話者A',
    sourceRef: null, edited: false, words: [
      { start: index, end: index + 0.4, text: '確認用' },
      { start: index + 0.4, end: index + 0.8, text: `字幕${index + 1}` }
    ]
  })) };
  await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit)}\n`);
  await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions)}\n`);
}

async function waitForPage() {
  for (let i = 0; i < 240; i++) {
    if (electronExit) throw new Error(`Electron exited: ${JSON.stringify(electronExit)} ${electronLog.slice(-3000)}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find(item => item.type === 'page' && !item.url.startsWith('devtools:'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('Electron CDP page timeout');
}

let cdp;
async function evaluate(expression, timeout = 30000) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const command = (id, value) => evaluate(`(async () => { const d = window.theia?.container?._bindingDictionary;
  const keys = d?._map ? [...d._map.keys()] : [];
  const C = keys.find(k => typeof k === 'function' && k.prototype
    && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
  if (!C) throw new Error('command registry missing');
  return window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(value)});
})()`, 120000);
const snapshot = () => evaluate(`(() => { const rows = document.querySelector('.akari-daihon-rows');
  const active = document.activeElement; const tick = window.__ticks?.at(-1) ?? null;
  return { rowCount: document.querySelectorAll('.akari-daihon-row').length,
    visibleRows: document.querySelectorAll('.akari-daihon-row:not(.speaker-hidden):not(.qc-hidden)').length,
    active: active && { tag: active.tagName, className: String(active.className) },
    focusedRows: active === rows, scrollTop: rows?.scrollTop, tick,
    popOpen: !!document.querySelector('.akari-daihon-pop') }; })()`);
async function capture(name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(out, `${name}.png`), Buffer.from(png.data, 'base64'));
}
async function point(selector, rowId) {
  return evaluate(`(() => { const row = document.querySelector('.akari-daihon-row[data-caption-id=${JSON.stringify(rowId)}]');
    const el = ${JSON.stringify(selector)} === 'blank' ? row
      : row?.querySelector(${JSON.stringify(selector)});
    if (!el) return null; row.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: ${JSON.stringify(selector)} === 'blank' ? r.left + 5 : (r.left+r.right)/2,
      y: (r.top+r.bottom)/2 }; })()`);
}
async function click(p) {
  if (!p) throw new Error('click target missing');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
async function key(key, code, vk, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
}
const space = () => key(' ', 'Space', 32);
async function playbackProbe(label, waitMs = 1100) {
  const before = await snapshot();
  const startIndex = await evaluate('window.__ticks.length');
  await space();
  await sleep(waitMs);
  const after = await snapshot();
  const ticks = await evaluate(`window.__ticks.slice(${startIndex})`);
  await space();
  await sleep(150);
  const stopped = await snapshot();
  const playing = ticks.filter(t => t.playing && Number.isFinite(t.time));
  const discontinuity = playing.findIndex((tick, index) => index > 0 && tick.time - playing[index - 1].time > 1);
  const first = playing[discontinuity >= 0 ? discontinuity : 0];
  const advance = playing.length > 1 ? playing.at(-1).time - first.time : 0;
  const measure = { before, after, stopped, playingTicks: playing.length,
    firstTime: first?.time ?? null, lastTime: playing.at(-1)?.time ?? null,
    times: playing.map(t => t.time), advance,
    scrollDelta: after.scrollTop - before.scrollTop };
  result[label] = measure;
  if (playing.length < 2 || advance < 0.5 || stopped.tick?.playing !== false) {
    throw new Error(`${label}: playback failed (${JSON.stringify(measure)})`);
  }
  return measure;
}

try {
  await mkdir(out, { recursive: true });
  await fixture();
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${port} occupied`); } catch (error) { if (String(error).includes('occupied')) throw error; }
  result.stage = 'launch';
  const isolated = path.join(scratch, 'home');
  const temp = path.join(scratch, 'temp');
  const profile = path.join(scratch, 'user-data');
  const config = path.join(scratch, 'theia-config');
  const akari = path.join(scratch, 'akari-home');
  for (const dir of [isolated, temp, profile, config, akari]) await mkdir(dir, { recursive: true });
  const env = { ...process.env, HOME: isolated, USERPROFILE: isolated, TEMP: temp, TMP: temp,
    AKARI_HOME: akari, THEIA_CONFIG_DIR: config };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1',
    '--port=49019', `--user-data-dir=${profile}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  { cwd: shell, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    electronLog = (electronLog + chunk.toString()).slice(-12000);
  });
  child.on('exit', (code, signal) => { electronExit = { code, signal }; });
  const page = await waitForPage();
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await capture('wake');
  result.stage = 'workbench';
  let ready = false;
  for (let i = 0; i < 600; i++) {
    ready = await evaluate('!document.querySelector(".theia-preload") && Boolean(window.theia?.container)').catch(() => false);
    if (ready) break;
    await sleep(1000);
  }
  if (!ready) throw new Error('workbench did not become ready');
  await command('akari.daihon.open', { captionId: 'c-0040', open: 'template' });
  await command('akari.preview.ensureVisible', { editUri });
  for (let i = 0; i < 180; i++) {
    if (await evaluate('document.querySelectorAll(".akari-daihon-row").length >= 100').catch(() => false)) break;
    await sleep(1000);
  }
  result.rowCount = (await snapshot()).rowCount;
  if (result.rowCount < 100) throw new Error(`only ${result.rowCount} rows loaded`);
  await evaluate(`window.__ticks = []; window.addEventListener('akari.preview.playbackTick',
    e => window.__ticks.push({ time: e.detail?.time, playing: e.detail?.playing }))`);

  result.stage = 'timecode';
  await click(await point('.akari-daihon-tc', 'c-0040'));
  await sleep(350);
  result.tc = await snapshot();
  await capture('timecode');
  if (!result.tc.focusedRows) throw new Error(`timecode focus failed: ${JSON.stringify(result.tc)}`);
  await playbackProbe('playback');
  result.tc.seekTime = result.playback.firstTime;
  if (Math.abs((result.tc.seekTime ?? -10) - 39) > 0.6) throw new Error(`timecode seek failed: ${result.tc.seekTime}`);
  if (Math.abs(result.playback.scrollDelta) > 1) throw new Error(`space scrolled rows: ${result.playback.scrollDelta}`);

  result.stage = 'gear';
  await click(await point('.akari-daihon-gear', 'c-0041'));
  await sleep(150);
  result.gear = { opened: await snapshot() };
  if (!result.gear.opened.popOpen) throw new Error('gear pop did not open');
  const selectPoint = await evaluate(`(() => { const r = document.querySelector('.akari-daihon-pop select')?.getBoundingClientRect();
    return r && { x: (r.left+r.right)/2, y: (r.top+r.bottom)/2 }; })()`);
  await click(selectPoint);
  result.gear.inside = await snapshot();
  await capture('gear');
  if (result.gear.inside.active?.tag !== 'SELECT') throw new Error('gear select was not focusable');
  await key('Escape', 'Escape', 27);
  await sleep(150);
  result.gear.closed = await snapshot();
  if (result.gear.closed.popOpen) {
    await click(await point('blank', 'c-0041'));
    result.gear.closed = await snapshot();
  }
  result.gear.playback = await playbackProbe('gearPlayback');

  result.stage = 'speaker';
  const beforeSpeaker = (await snapshot()).rowCount;
  await click(await point('.akari-daihon-speaker', 'c-0042'));
  await sleep(150);
  result.speaker = { before: beforeSpeaker, filtered: await snapshot() };
  if (!result.speaker.filtered.focusedRows || result.speaker.filtered.visibleRows >= beforeSpeaker) {
    throw new Error(`speaker filter/focus failed: ${JSON.stringify(result.speaker)}`);
  }
  result.speaker.playback = await playbackProbe('speakerPlayback');
  await command('akari.daihon.open', { captionId: 'c-0043', open: 'template' });
  await evaluate(`document.querySelector('.akari-daihon-dock-close')?.click()`);
  result.speaker.cleared = await snapshot();
  if (result.speaker.cleared.visibleRows !== 120) throw new Error('speaker filter did not clear for next scenario');

  result.stage = 'split';
  await click(await point('.akari-daihon-split', 'c-0043'));
  result.split = { state: await snapshot(), selected: await evaluate(`Boolean(document.querySelector('.akari-daihon-row[data-caption-id="c-0043"].splitting'))`) };
  if (!result.split.state.focusedRows || !result.split.selected) throw new Error('split mode/focus failed');
  result.split.playback = await playbackProbe('splitPlayback');
  await click(await point('.akari-daihon-split', 'c-0043'));

  result.stage = 'keyboard';
  await evaluate(`document.querySelector('.akari-daihon-row[data-caption-id="c-0046"] .akari-daihon-speaker').focus()`);
  await key('Tab', 'Tab', 9);
  result.keyboard = { tab: await snapshot() };
  if (result.keyboard.tab.active?.className !== 'akari-daihon-tc') throw new Error('Tab did not reach timecode');
  await evaluate(`window.__keyboardClicks = 0; document.activeElement.addEventListener('click',
    () => window.__keyboardClicks++, { once: true })`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(250);
  result.keyboard.enter = await snapshot();
  result.keyboard.clicks = await evaluate('window.__keyboardClicks');
  if (result.keyboard.enter.active?.className !== 'akari-daihon-tc') throw new Error('Enter changed keyboard focus');
  const keyboardTickIndex = await evaluate('window.__ticks.length');
  await command('akari.preview.togglePlayback', { editUri });
  await sleep(350);
  result.keyboard.seekTicks = await evaluate(`window.__ticks.slice(${keyboardTickIndex})`);
  await command('akari.preview.togglePlayback', { editUri });
  result.keyboard.seekTime = result.keyboard.seekTicks.find(t => t.playing && t.time >= 44)?.time ?? null;
  if (Math.abs((result.keyboard.seekTime ?? -10) - 45) > 0.6) throw new Error('Enter did not seek');
  await evaluate(`window.__keyboardSpaceClicks = 0; document.activeElement.addEventListener('click',
    () => window.__keyboardSpaceClicks++, { once: true })`);
  const keyboardSpaceIndex = await evaluate('window.__ticks.length');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space',
    windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(150);
  result.keyboard.space = { clicks: await evaluate('window.__keyboardSpaceClicks'),
    ticks: await evaluate(`window.__ticks.slice(${keyboardSpaceIndex})`), state: await snapshot() };
  if (result.keyboard.space.clicks !== 1 || result.keyboard.space.state.active?.className !== 'akari-daihon-tc'
    || result.keyboard.space.ticks.some(t => t.playing)) throw new Error('keyboard Space no longer activates timecode');

  result.stage = 'blank-word';
  await click(await point('blank', 'c-0045'));
  result.blank = { click: await snapshot(), playback: await playbackProbe('blankPlayback') };
  await click(await point('.akari-daihon-word', 'c-0045'));
  result.word = { click: await snapshot(), playback: await playbackProbe('wordPlayback') };

  result.stage = 'cut';
  await click(await point('.akari-daihon-cut', 'c-0044'));
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`Boolean(document.querySelector('.akari-daihon-row[data-caption-id="c-0044"].iscut'))`).catch(() => false)) break;
    await sleep(500);
  }
  result.cut = { state: await snapshot(), cut: await evaluate(`Boolean(document.querySelector('.akari-daihon-row[data-caption-id="c-0044"].iscut'))`) };
  if (!result.cut.cut || !result.cut.state.focusedRows) throw new Error(`cut action/focus failed: ${JSON.stringify(result.cut)}`);
  result.cut.playback = await playbackProbe('cutPlayback', 1800);
  result.stage = 'cut-popup';
  await click(await point('.akari-daihon-tc', 'c-0044'));
  result.cutPopup = { opened: await snapshot() };
  if (!result.cutPopup.opened.popOpen || !result.cutPopup.opened.focusedRows) throw new Error('cut timecode pop did not open');
  await evaluate(`document.querySelector('.akari-daihon-pop button')?.focus()`);
  result.cutPopup.inside = await snapshot();
  if (result.cutPopup.inside.active?.tag !== 'BUTTON') throw new Error('cut pop button could not receive focus');
  await key('Escape', 'Escape', 27);
  result.cutPopup.closed = await snapshot();
  if (result.cutPopup.closed.popOpen) throw new Error('cut pop did not close');
  result.cutPopup.playback = await playbackProbe('cutPopupPlayback');
  await capture('final');
  result.stage = 'passed';
} catch (error) {
  result.error = String(error?.stack ?? error);
} finally {
  cdp?.close();
  result.electronLog = electronLog.slice(-12000);
  if (child?.pid) {
    const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    result.cleanup = { pid: child.pid, exit: stopped.status, stdout: stopped.stdout, stderr: stopped.stderr };
  }
  const scratchRoot = await realpath(taskTmp);
  if (!scratch.startsWith(scratchRoot + path.sep)) throw new Error('scratch path escaped task temporary directory');
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'l1-result.json'), `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify({ stage: result.stage, rowCount: result.rowCount, tc: result.tc,
  playback: result.playback && { advance: result.playback.advance, scrollDelta: result.playback.scrollDelta },
  error: result.error }));
if (result.error) process.exitCode = 1;
