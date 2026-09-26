#!/usr/bin/env node
// R-2 L1: 図形と写真に UI から位置の点を 12 個ずつ打ち、袋への出入りと webview を測る。
// 呼び出し側が heavy-slot の枠を取得し、Electron 終了後に返すこと。
// CDP 9576 / HTTP 49011。一時領域・user-data-dir・AKARI_HOME は本票専用。
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const slug = '2026-09-26-libcanvas-r2-motion-bag-reload';
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex < 0 ? 'before' : process.argv[labelIndex + 1];
if (!['before', 'after'].includes(label)) throw new Error('--label before|after が必要です');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = path.join(repo, 'apps/shell');
const out = path.join(repo, 'evidence/r2-motion-bag-reload');
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `${slug}-l1-`)));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const cdpPort = 9576, httpPort = 49011, fps = 30;
const shotW = 1920, shotH = 1080;
const clean = value => String(value).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>')
  .replace(/\/Users\/[^\s"')]+/g, '<local>').replace(/\/(?:private\/)?(?:tmp|var)\/[^\s"')]+/g, '<tmp>');
const round = value => Math.round(value * 100) / 100;
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const itemOf = (doc, id) => doc.tracks.flatMap(track => track.items ?? []).find(item => item.id === id);
const items = [
  { id: 'shape-1', kind: 'shape', color: 'blue', at: 0 },
  { id: 'photo-1', kind: 'photo', color: 'red', at: 180 }
];
const pointFrames = Array.from({ length: 12 }, (_, i) => i * 10);

async function makeFixture() {
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await writeFile(path.join(project, '.akari/lint.json'), '{"version":1,"verdict":"pass"}\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  const photo = path.join(project, 'assets/photo-red.png');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
    '-i', 'color=c=0xFF0000:s=480x320', '-frames:v', '1', photo], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`photo fixture: ${clean(ff.stderr)}`);
  const doc = { version: 2, output: { width: 1920, height: 1080, fps },
    sources: [{ id: 'photo-source', path: 'assets/photo-red.png', proxy: null }],
    tracks: [
      { id: 'shape-track', lane: 'visual', items: [{ id: 'shape-1', at: 0, duration: 180,
        transform: { x: 300, y: 250, scale: 1, rotate: 0 },
        source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#0000ff' } } }] },
      { id: 'photo-track', lane: 'visual', items: [{ id: 'photo-1', at: 180, duration: 180,
        transform: { x: 0, y: 0, scale: 0.6, rotate: 0 },
        source: { kind: 'media', src: 'photo-source', in: 0, out: 6 } }] }
    ] };
  await writeFile(editPath, `${JSON.stringify(doc, null, 2)}\n`);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      } else if (message.method) for (const fn of this.listeners.get(message.method) ?? []) fn(message.params, message.sessionId);
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, 30000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]); }
  close() { this.socket?.close(); }
}
async function waitForJson(url, pred, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await (await fetch(url)).json(); if (pred(value)) return value; } catch {}
    await sleep(300);
  }
  throw new Error(`timeout ${url}`);
}
async function evalCdp(cdp, expression, contextId, sessionId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId }) }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

let main, browser, view, child, logFd, step = 'startup';
const progress = message => console.error(`[r2-l1] ${message}`);
const contexts = new Map(), targetUrls = new Map(), targetTypes = new Map(), targetEvents = [], contextLosses = [];
const webviewIdOf = url => {
  if (!String(url).includes('webview')) return null;
  try { return new URL(url).searchParams.get('id'); } catch { return null; }
};
const recordEvent = (event, targetId, url = '') => {
  targetEvents.push({ event, method: `Target.target${event === 'created' ? 'Created' : 'Destroyed'}`,
    targetId, targetType: targetTypes.get(targetId) ?? null,
    webview: String(url).includes('webview'), webviewId: webviewIdOf(url), at: Date.now(), step });
};
function track(cdp) {
  cdp.on('Runtime.executionContextCreated', (p, session) => {
    if (p?.context?.auxData?.isDefault) contexts.set(session, [...(contexts.get(session) ?? []), p.context.id]);
  });
  cdp.on('Runtime.executionContextDestroyed', (p, session) => {
    if ((contexts.get(session) ?? []).includes(p.executionContextId)) {
      contextLosses.push({ event: 'destroyed', at: Date.now(), step, session });
      contexts.set(session, (contexts.get(session) ?? []).filter(id => id !== p.executionContextId));
    }
  });
  cdp.on('Runtime.executionContextsCleared', (_p, session) => {
    if (contexts.get(session)?.length) contextLosses.push({ event: 'cleared', at: Date.now(), step, session });
    contexts.delete(session);
  });
}
function trackTargets(cdp) {
  cdp.on('Target.targetCreated', p => {
    const id = p?.targetInfo?.targetId, url = String(p?.targetInfo?.url ?? '');
    if (id) targetUrls.set(id, url);
    if (id) targetTypes.set(id, p?.targetInfo?.type ?? '');
    recordEvent('created', id, url);
  });
  cdp.on('Target.targetDestroyed', p => recordEvent('destroyed', p?.targetId, targetUrls.get(p?.targetId)));
  cdp.on('Target.targetInfoChanged', p => {
    const id = p?.targetInfo?.targetId, url = String(p?.targetInfo?.url ?? '');
    const previous = targetUrls.get(id);
    if (id) targetUrls.set(id, url);
    // created 時点で URL が空でも、後続の情報更新で同じ実イベントを webview と確定する。
    if (!String(previous).includes('webview') && url.includes('webview')) {
      const created = [...targetEvents].reverse().find(entry => entry.event === 'created' && entry.targetId === id);
      if (created) { created.webview = true; created.webviewId = webviewIdOf(url); }
    }
  });
}
async function findPreview(ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { targetInfos = [] } = await browser.send('Target.getTargets').catch(() => ({}));
    for (const info of targetInfos) {
      if (!['iframe', 'page', 'webview'].includes(info.type) || !String(info.url).includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        contexts.delete(sessionId);
        await browser.send('Runtime.enable', {}, sessionId);
        await browser.send('Page.enable', {}, sessionId);
        await sleep(300);
        for (const contextId of contexts.get(sessionId) ?? []) {
          if (await evalCdp(browser, 'Boolean(document.getElementById("preview-stage") && document.getElementById("seek"))',
            contextId, sessionId).catch(() => false)) return { targetId: info.targetId, sessionId, contextId };
        }
      } catch {}
    }
    await sleep(400);
  }
  throw new Error('preview target not found');
}
const pv = async expression => {
  try { return await evalCdp(browser, expression, view.contextId, view.sessionId); }
  catch (error) {
    if (!/Cannot find context|No session with given id|Session with given id not found/i.test(String(error))) throw error;
    contextLosses.push({ event: 'evaluate-failed', at: Date.now(), step, message: String(error).slice(0, 160) });
    view = await findPreview();
    return evalCdp(browser, expression, view.contextId, view.sessionId);
  }
};
async function command(id, value) {
  return evalCdp(main, `(async () => { try {
    const d = window.theia?.container?._bindingDictionary;
    const keys = d?._map ? [...d._map.keys()] : [];
    const C = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!C) return { ok: false, error: 'command registry missing' };
    const value = await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(value)});
    let plain = null;
    try { plain = value === undefined ? null : JSON.parse(JSON.stringify(value)); }
    catch { plain = typeof value; }
    return { ok: true, value: plain };
  } catch (error) { return { ok: false, error: String(error?.message ?? error) }; } })()`);
}
async function seek(seconds) {
  for (let n = 0; n < 4; n++) {
    await command('akari.preview.seekOutput', { editUri, time: seconds });
    await sleep(700);
    const actual = await pv('Number(document.getElementById("seek")?.value)');
    if (Math.abs(actual - seconds) < 0.04) return actual;
  }
  throw new Error(`seek failed ${seconds}`);
}
async function focus(id) {
  const result = await command('akari.timeline.focusItem', { itemId: id, reveal: true });
  await sleep(500);
  await evalCdp(main, 'document.querySelector(\'[data-akari-ui="tab:inspector-video"]\')?.click()');
  await sleep(400);
  return result;
}
async function snapshotState() {
  const inspector = await evalCdp(main, `(() => { const n = document.querySelector('.akari-inspector-widget');
    return { scrollTop: n?.scrollTop ?? null, scrollMax: n ? Math.max(0, n.scrollHeight - n.clientHeight) : null,
      selected: n?.querySelector('[data-akari-ui="field:inspector-transform-x"]') !== null,
      itemLabel: n?.innerText?.split('\\n')[0] ?? null,
      activeTab: document.querySelector('[data-akari-ui="tab:inspector-video"][aria-selected="true"]') !== null }; })()`);
  const webviewId = await evalCdp(main, `(() => { const frame = [...document.querySelectorAll('iframe')]
    .filter(f => /webview/.test(f.src || '')).sort((a,b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return br.width*br.height-ar.width*ar.height;
    })[0];
    try { return frame ? new URL(frame.src).searchParams.get('id') : null; } catch { return null; } })()`);
  const preview = await pv(`(() => ({ seek: Number(document.getElementById('seek')?.value),
    selectedId: window.akari?.interaction?.selectedId ?? null,
    layerSelected: Boolean(document.querySelector('#layer-select-box.is-active')),
    cutSelected: Boolean(document.querySelector('#cut-select-box.is-active')) }))()`);
  return { inspector, preview, webviewId };
}
async function armInspectorScroll() {
  return evalCdp(main, `(() => { const n = document.querySelector('.akari-inspector-widget');
    if (!n) return { ok: false, reason: 'inspector missing' };
    const naturalMax = Math.max(0, n.scrollHeight - n.clientHeight);
    // 小さい合成プロジェクトでも実際の scrollTop 復元を測れる高さを確保する。
    if (naturalMax < 80) n.style.paddingBottom = '260px';
    n.scrollTop = 80;
    n.dispatchEvent(new Event('scroll'));
    return { ok: n.scrollTop > 0, naturalMax, scrollTop: n.scrollTop,
      scrollMax: Math.max(0, n.scrollHeight - n.clientHeight), spacer: naturalMax < 80 }; })()`);
}
function preservedState(before, after) {
  return {
    selection: before.inspector.itemLabel === after.inspector.itemLabel
      && before.inspector.selected === after.inspector.selected
      && before.preview.selectedId === after.preview.selectedId,
    seek: Math.abs(before.preview.seek - after.preview.seek) <= 0.04,
    scroll: before.inspector.scrollTop > 0
      && Math.abs(before.inspector.scrollTop - after.inspector.scrollTop) <= 1
  };
}
async function waitForEventsQuiet(startedAt, quietMs = 1500, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const latest = Math.max(startedAt, targetEvents.at(-1)?.at ?? 0, contextLosses.at(-1)?.at ?? 0);
    if (Date.now() - latest >= quietMs) return { quiet: true, idleMs: Date.now() - latest };
    await sleep(150);
  }
  return { quiet: false, idleMs: 0 };
}
function previewRecreated(events, losses, webviewId) {
  return events.some(event => event.webviewId === webviewId
    && ['iframe', 'page', 'webview'].includes(event.targetType)
    && (event.event === 'destroyed' || event.event === 'created'))
    || losses.some(event => event.event === 'destroyed'
      || event.event === 'cleared' || event.event === 'evaluate-failed');
}
async function bagState(id) {
  const item = itemOf(await readEdit(), id);
  const inline = Array.isArray(item?.keyframes) ? item.keyframes : [];
  const bagPath = typeof item?.keyframes?.path === 'string' ? item.keyframes.path : `motion/${id}.json`;
  const file = path.join(project, bagPath);
  let bag = null;
  try { bag = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const bagRaw = bag?.items?.[id] ?? [];
  const real = points => points.filter(point => point.transform || point.opacity !== undefined
    || point.crop || point.perspective || point.animator || point.gain_db !== undefined);
  return { inlineCount: real(inline).length, inlineRawCount: inline.length,
    reference: typeof item?.keyframes?.path === 'string'
    ? { path: item.keyframes.path, count: item.keyframes.count } : null,
    bagExists: bag !== null, bagCount: real(bagRaw).length, bagRawCount: bagRaw.length,
    points: real(typeof item?.keyframes?.path === 'string' ? bagRaw : inline) };
}
async function ensureOutputTabVisible() {
  const visible = () => evalCdp(main, `(() => [...document.querySelectorAll('iframe')]
    .some(f => /webview/.test(f.src || '') && f.getBoundingClientRect().width > 100
      && f.getBoundingClientRect().height > 100))()`);
  if (await visible()) return;
  for (let n = 0; n < 3; n++) {
    await command('akari.preview.ensureVisible', { editUri });
    await evalCdp(main, `(() => { const tab = [...document.querySelectorAll('.lm-TabBar-tab')]
      .find(e => e.textContent?.includes('出力プレビュー')); tab?.click(); return !!tab; })()`);
    await sleep(700);
    if (await visible()) return;
  }
  throw new Error('output preview tab is not visible');
}
async function stagePng() {
  await ensureOutputTabVisible();
  const inner = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const host = await evalCdp(main, `(() => { const frames = [...document.querySelectorAll('iframe')]
    .filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect())
    .filter(r => r.width > 100 && r.height > 100).sort((a,b) => b.width*b.height-a.width*a.height);
    return frames[0] ? { x: frames[0].x, y: frames[0].y } : null; })()`);
  if (!host) throw new Error('preview iframe box missing');
  const rect = { x: host.x + inner.x, y: host.y + inner.y, w: inner.w, h: inner.h };
  const dpr = await evalCdp(main, 'window.devicePixelRatio');
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: {
    x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: shotW / rect.w / dpr } });
  return Buffer.from(data, 'base64');
}
function measurePng(buffer, color) {
  const decoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vf', `scale=${shotW}:${shotH}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { input: buffer, maxBuffer: shotW * shotH * 4 });
  if (decoded.status !== 0) throw new Error(`screenshot decode: ${clean(decoded.stderr)}`);
  const raw = decoded.stdout;
  let minX = shotW, minY = shotH, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < shotH; y++) for (let x = 0; x < shotW; x++) {
    // 図形と同色のツールバーアイコンは映像面ではない。
    if (color === 'blue' && (y < 190 || x < 200)) continue;
    const offset = (y * shotW + x) * 3;
    const r = raw[offset], g = raw[offset + 1], b = raw[offset + 2];
    const hit = color === 'red' ? r > 40 && r - g > 15 && r - b > 15 && g < r * 0.5
      : b > 40 && b - r > 15 && b - g > 15 && g < b * 0.5;
    if (!hit) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
  }
  if (count < 30) return null;
  return { x: round((minX + maxX) / 2 - 960), y: round((minY + maxY) / 2 - 540),
    count, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}
async function visible(color) {
  for (let n = 0; n < 25; n++) {
    try { const png = await stagePng(); const metric = measurePng(png, color); if (metric) return { metric, png }; } catch {}
    await sleep(400);
  }
  return { metric: null, png: null };
}
async function visibleAt(color, expected) {
  if (!expected) return visible(color);
  let last = { metric: null, png: null };
  for (let n = 0; n < 25; n++) {
    last = await visible(color);
    if (last.metric && Math.abs(last.metric.x - expected.x) <= 2
      && Math.abs(last.metric.y - expected.y) <= 2) return last;
    await sleep(400);
  }
  return last;
}
const visualAnchors = new Map();
async function writePoint(item, number) {
  const frame = pointFrames[number - 1];
  step = `${item.kind}-${number}`;
  progress(step);
  const eventsAt = targetEvents.length, lossesAt = contextLosses.length;
  const time = (item.at + frame) / fps;
  await seek(time);
  await focus(item.id);
  const scrollSetup = await armInspectorScroll();
  const beforeState = await snapshotState();
  const before = await bagState(item.id);
  let action;
  if (number === 1) {
    action = await evalCdp(main, `(() => { const button = document.querySelector('[data-akari-ui="inspector-kf-seat:transform-x"]');
      if (!button) return { ok: false, reason: 'seat missing' };
      const pressed = button.getAttribute('aria-pressed'); button.click();
      return { ok: true, via: 'inspector-kf-seat:transform-x', pressed }; })()`);
  } else {
    action = await evalCdp(main, `(() => { const field = document.querySelector('[data-akari-ui="field:inspector-transform-x"]');
      const input = field?.querySelector('input');
      const button = [...(field?.querySelectorAll('button') ?? [])]
        .find(b => b.getAttribute('aria-label') === 'Xを増やす');
      if (!input || !button) return { ok: false, reason: 'x step button missing' };
      const before = input.value;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      return { ok: true, via: 'inspector-transform-x-step', before, shift: true }; })()`);
  }
  if (!action.ok) throw new Error(`${step}: ${JSON.stringify(action)}`);
  let after = before;
  for (let n = 0; n < 50; n++) {
    await sleep(200);
    after = await bagState(item.id);
    if (after.points.length === number) break;
  }
  await sleep(1600); // ファイル監視とモデル更新の完了を観察する
  after = await bagState(item.id);
  progress(`${step}: ${after.points.length} points`);
  const point = after.points.find(p => p.t === frame) ?? null;
  const anchor = visualAnchors.get(item.id);
  const predicted = point?.transform && anchor ? {
    x: round(anchor.visual.x + point.transform.x - anchor.point.x),
    y: round(anchor.visual.y + point.transform.y - anchor.point.y)
  } : null;
  const { metric, png } = await visibleAt(item.color, predicted);
  const quiet = await waitForEventsQuiet(Date.now());
  const state = await snapshotState();
  if (number === 1 && metric && point?.transform) visualAnchors.set(item.id, {
    visual: { x: metric.x, y: metric.y }, point: { x: point.transform.x, y: point.transform.y }
  });
  const expected = predicted ?? (number === 1 && metric ? { x: metric.x, y: metric.y } : null);
  const deltaPx = metric && expected ? { x: round(metric.x - expected.x), y: round(metric.y - expected.y) } : null;
  const events = targetEvents.slice(eventsAt);
  const losses = contextLosses.slice(lossesAt);
  let screenshot = null;
  if ([1, 8, 9, 10, 11, 12].includes(number) && png) {
    screenshot = `${label}-${item.kind}-${number}.png`;
    await writeFile(path.join(out, screenshot), png);
  }
  return { kind: item.kind, number, frame, time, action, before: {
      inlineCount: before.inlineCount, inlineRawCount: before.inlineRawCount,
      reference: before.reference, bagExists: before.bagExists, bagCount: before.bagCount,
      bagRawCount: before.bagRawCount },
    after: { inlineCount: after.inlineCount, inlineRawCount: after.inlineRawCount,
      reference: after.reference, bagExists: after.bagExists, bagCount: after.bagCount,
      bagRawCount: after.bagRawCount },
    point, scrollSetup, beforeState, state, preserved: preservedState(beforeState, state), quiet,
    measured: metric, expected, deltaPx, screenshot,
    targetEvents: events, contextLosses: losses,
    recreated: previewRecreated(events, losses, beforeState.webviewId) };
}
async function undoAtNine(item) {
  step = `${item.kind}-undo-9-to-8`;
  const eventsAt = targetEvents.length, lossesAt = contextLosses.length;
  const scrollSetup = await armInspectorScroll();
  const beforeState = await snapshotState();
  await evalCdp(main, 'document.activeElement?.blur?.()');
  await main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90,
    modifiers: 4, commands: ['undo'] });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  let state;
  for (let n = 0; n < 50; n++) { await sleep(200); state = await bagState(item.id); if (state.points.length === 8) break; }
  await sleep(1600);
  state = await bagState(item.id);
  const anchor = visualAnchors.get(item.id);
  const last = state.points.at(-1)?.transform;
  const expected = anchor && last ? {
    x: round(anchor.visual.x + last.x - anchor.point.x),
    y: round(anchor.visual.y + last.y - anchor.point.y)
  } : null;
  const { metric, png } = await visibleAt(item.color, expected);
  const quiet = await waitForEventsQuiet(Date.now());
  const ui = await snapshotState();
  const deltaPx = metric && expected ? { x: round(metric.x - expected.x), y: round(metric.y - expected.y) } : null;
  const screenshot = png ? `${label}-${item.kind}-undo.png` : null;
  if (png) await writeFile(path.join(out, screenshot), png);
  const events = targetEvents.slice(eventsAt);
  return { kind: item.kind, action: 'undo 9→8', after: { inlineCount: state.inlineCount,
    reference: state.reference, bagExists: state.bagExists, bagCount: state.bagCount },
    scrollSetup, beforeState, state: ui, preserved: preservedState(beforeState, ui), quiet,
    measured: metric, expected, deltaPx, screenshot, targetEvents: events,
    contextLosses: contextLosses.slice(lossesAt),
    recreated: previewRecreated(events, contextLosses.slice(lossesAt), beforeState.webviewId) };
}

const report = { label, cdpPort, httpPort, fixture: { items, pointFrames }, operations: [],
  targetEvents, contextLosses };
try {
  await mkdir(out, { recursive: true });
  try { await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${cdpPort} occupied`); } catch (error) { if (String(error).includes('occupied')) throw error; }
  try { await fetch(`http://127.0.0.1:${httpPort}/`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`HTTP port ${httpPort} occupied`); } catch (error) { if (String(error).includes('occupied')) throw error; }
  await makeFixture();
  const profile = path.join(scratch, `${slug}-user-data-dir`);
  const config = path.join(scratch, `${slug}-theia-config`);
  const home = path.join(scratch, `${slug}-akari-home`);
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  logFd = openSync(path.join(out, `${label}-electron.log`), 'w');
  child = spawn(electron, [shell, project, `--remote-debugging-port=${cdpPort}`, '--hostname=127.0.0.1',
    `--port=${httpPort}`, `--user-data-dir=${profile}`, '--no-sandbox'],
  { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home },
    stdio: ['ignore', logFd, logFd], detached: true });
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`, v => v.find(isShell))).find(isShell);
  progress('shell target connected');
  main = new CDP(target.webSocketDebuggerUrl); await main.connect();
  await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser); trackTargets(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true });
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId,
      bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } }); } catch {}
  await sleep(9000);
  progress('opening timeline');
  const openOnly = () => evalCdp(main, `(() => { const b = [...document.querySelectorAll('button')]
    .find(e => ['開くだけ', '後で'].includes(e.textContent?.trim())); if (b) b.click(); return !!b; })()`);
  const soft = (id, value) => Promise.race([command(id, value).catch(e => ({ ok: false, error: String(e) })),
    sleep(5000).then(() => ({ ok: false, error: 'pending' }))]);
  await openOnly().catch(() => {});
  report.timelineOpen = await soft('akari.annotations.open');
  await sleep(1500);
  progress(`timeline: ${JSON.stringify(report.timelineOpen)}`);
  await evalCdp(main, `(() => { const b = [...document.querySelectorAll('button')]
    .find(e => e.textContent?.trim() === 'キャンセル');
    b?.click(); return !!b; })()`).catch(() => {});
  progress('opening preview');
  for (let n = 0; n < 40 && !view; n++) {
    await openOnly().catch(() => {});
    await soft('akari.preview.ensureVisible', { editUri });
    await sleep(2600);
    view = await findPreview(12000).catch(() => null);
    if (!view && n % 4 === 3) progress(`preview target retry ${n + 1}`);
  }
  if (!view) throw new Error('preview not opened');
  progress('preview ready');
  await command('akari.inspector.open'); await sleep(1000);
  await ensureOutputTabVisible();
  // 初回の frame-engine bootstrap と遅れて届く起動時の更新を終えてから計測を始める。
  for (let n = 0; n < 60; n++) {
    if (await pv(`Boolean(window.akari?.frameEngineClock?.updateModel && window.akari?.state?.summary)`)
      .catch(() => false)) break;
    await sleep(300);
  }
  await seek(0);
  await focus(items[0].id);
  await sleep(3000);
  await waitForEventsQuiet(Date.now(), 2500);
  progress('inspector ready');
  for (const item of items) {
    for (let number = 1; number <= 12; number++) {
      const operation = await writePoint(item, number);
      report.operations.push(operation);
      if (operation.after.inlineCount + operation.after.bagCount !== number) {
        throw new Error(`${item.kind}-${number}: expected ${number} points, got ${operation.after.inlineCount + operation.after.bagCount}`);
      }
      if (number === 9) {
        report.operations.push(await undoAtNine(item));
        report.operations.push(await writePoint(item, 9));
      }
    }
  }
  report.final = Object.fromEntries(await Promise.all(items.map(async item => [item.id, await bagState(item.id)])));
} catch (error) {
  report.error = clean(error?.stack ?? error);
} finally {
  main?.close(); browser?.close();
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await sleep(1800);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  // Theia backend が別 PGID で残る場合も、この実行固有 scratch を引数に持つ Helper の PID のみ終了する。
  const owned = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of owned.split('\n')) {
    if (!line.includes(scratch) || !line.includes('Electron Helper')) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  if (logFd !== undefined) try { closeSync(logFd); } catch {}
}
try {
  const logFile = path.join(out, `${label}-electron.log`);
  await writeFile(logFile, clean(await readFile(logFile, 'utf8')));
} catch {}
report.targetEvents = targetEvents;
report.contextLosses = contextLosses;
await writeFile(path.join(out, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ label, error: report.error ?? null, operations: report.operations.length,
  recreated: report.operations.filter(op => op.recreated).map(op => `${op.kind}-${op.number ?? 'undo'}`) }));
if (report.error) process.exitCode = 1;
