#!/usr/bin/env node

// L1（検証専用）: インスペクターのタブ（映像 / 色 / 音声 / 編集 / 動き / 情報）・編集タブの 3 群・
// 動きタブ → 映像タブの要約・図形 / ライン / 吹き出しの行を本物の Electron シェルで操作し、
// スクショと数値（タブの並び・節の見出し・行・edit.json に書き戻った値・プレビューの SVG）を残す。
//
// 使い方:
//   node evidence/i1-inspector-tabs/run-l1.mjs --shell <apps/shell の絶対パス> --label after --out <出力 dir> [--only a,b]
// 環境変数 AKARI_CDP_PORT（既定 9555）・L1_TMP_PREFIX（一時ディレクトリ名の接頭辞）。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const shellDir = path.resolve(argument('shell'));
const label = argument('label', 'run');
const outDir = path.resolve(argument('out', '.'));
const only = (argument('only', '') || '').split(',').filter(Boolean);
const port = Number(process.env.AKARI_CDP_PORT ?? 9555);
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), process.env.L1_TMP_PREFIX ?? 'libcanvas-i1-inspector-tabs-l1-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;

// ---- fixture ----------------------------------------------------------------------------

const shapeItem = (id, source, transform) => ({ id, at: 0, duration: 300, transform, source });
const track = (id, items) => ({ id, lane: 'visual', name: id, items });
const EDIT = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 's2', path: 'assets/photo.png' }],
  tracks: [
    track('v-main', [{ id: 'cut-1', at: 0, duration: 300, source: { kind: 'media', src: 'base', in: 0, out: 10 } }]),
    track('v-photo', [{ id: 'photo', at: 0, duration: 300, transform: { x: 120, y: 120, scale: 0.35 },
      source: { kind: 'media', src: 's2', in: 0, out: 10 } }]),
    track('v-box', [shapeItem('box', { kind: 'shape', shape: 'path', params: {
      fill: '#a6a6a6', stroke: 'none', strokeWidth: 0, preset: 'basic-square',
      path: { d: 'M3 3L97 3L97 97L3 97Z', vb: [100, 100] } } }, { x: 900, y: 140, scaleX: 3, scaleY: 3 })]),
    track('v-line', [shapeItem('line', { kind: 'shape', shape: 'line', params: {
      fill: 'none', stroke: '#000000', strokeWidth: 4, dash: 'solid', startCap: 'none', endCap: 'triangle',
      lineCap: 'butt', startCapFilled: true, endCapFilled: true, preset: 'line-solid-none-tri' } },
      { x: 900, y: 620, scaleX: 5, scaleY: 1 })]),
    track('v-bubble', [shapeItem('bubble', { kind: 'shape', shape: 'bubble', params: {
      fill: '#ffffff', stroke: '#000000', strokeWidth: 5, style: 'burst', count: 16, depth: 40, jitter: 25, seed: 1,
      tail: 'point', tailAngle: 210, tailLength: 45, tailWidth: 30, tailCurve: 0, dash: 'solid', preset: 'manga-burst' } },
      { x: 1400, y: 300, scaleX: 4, scaleY: 4 })]),
  ],
};
const CAPTIONS = { captions: [{ id: 'c-0001', start: 0, end: 10, time_domain: 'output', text: 'インスペクターの確かめ用の字幕',
  speaker: null, sourceRef: null, edited: true }] };

await stat(electron);
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome, { recursive: true }),
  mkdir(path.join(project, '.akari'), { recursive: true }), mkdir(path.join(project, 'assets'), { recursive: true }),
  mkdir(outDir, { recursive: true })]);
await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
await writeFile(captionsPath, `${JSON.stringify(CAPTIONS, null, 2)}\n`);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
// 素材（ffmpeg は実機の検証にだけ使う。テストでは使わない）
for (const args of [
  ['-f', 'lavfi', '-i', 'color=c=0xe7e5e4:s=1920x1080:d=10:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(project, 'assets', 'base.mp4')],
  ['-f', 'lavfi', '-i', 'testsrc2=s=1280x960:d=1', '-frames:v', '1', path.join(project, 'assets', 'photo.png')],
]) {
  const encoded = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);
}

// ---- CDP --------------------------------------------------------------------------------

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
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }
      }, 30000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId }),
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const consoleErrors = [];
const mainWorldContexts = new Map();
function trackContexts(cdp) {
  cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
    if (!params?.context?.auxData?.isDefault) return;
    const list = mainWorldContexts.get(sessionId) ?? [];
    list.push(params.context.id);
    mainWorldContexts.set(sessionId, list);
  });
  cdp.on('Runtime.executionContextsCleared', (_params, sessionId) => mainWorldContexts.delete(sessionId));
}
function trackErrors(cdp) {
  cdp.on('Runtime.consoleAPICalled', params => {
    if (params.type !== 'error' && params.type !== 'warning') return;
    consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 600));
  });
  cdp.on('Runtime.exceptionThrown', params => {
    consoleErrors.push(String(params.exceptionDetails?.exception?.description
      ?? params.exceptionDetails?.text ?? '').slice(0, 600));
  });
}

async function findPreviewView(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        mainWorldContexts.delete(sessionId);
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        await browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        await sleep(300);
        for (const contextId of mainWorldContexts.get(sessionId) ?? []) {
          try {
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle'))`,
              contextId, sessionId);
            if (hit) return { sessionId, contextId };
          } catch { /* context gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  return undefined;
}

let main;
let browser;
let view;

async function executeCommand(command, argumentValue) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argumentValue)});
      let plain = null; try { plain = value === undefined ? null : JSON.parse(JSON.stringify(value)); } catch { plain = typeof value; }
      return { ok: true, value: plain };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function screenshot(name, clip) {
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  await writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  return `${name}.png`;
}

// ---- インスペクターの観測 ------------------------------------------------------------------

const INSPECTOR = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
const AI_WORD = '/(^|[^A-Za-z])AI([^A-Za-z]|$)/';

async function inspector() {
  return evaluate(main, `(() => {
    const root = ${INSPECTOR};
    if (!root) return null;
    const visible = node => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const text = node => (node?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const tabs = [...root.querySelectorAll('[data-akari-ui="tabs:inspector"] [data-akari-ui^="tab:inspector-"]')].map(button => ({
      id: button.getAttribute('data-akari-ui').slice('tab:inspector-'.length), label: text(button),
      active: button.getAttribute('aria-selected') === 'true', disabled: !!button.disabled, title: button.title || null }));
    const sections = [...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].filter(visible).map(section => {
      const heading = section.querySelector('h2, h3, h4, summary, [class*="section-title"], [class*="section-header"], button');
      return { ui: section.getAttribute('data-akari-ui'), heading: text(heading).slice(0, 40) };
    });
    const headings = [...root.querySelectorAll('h2, h3, h4, [class*="section-title"], [class*="section-label"], [class*="ai-heading"]')]
      .filter(visible).map(text).filter(Boolean);
    const rows = [...root.querySelectorAll('[data-akari-field]')].filter(visible).map(row => {
      const input = row.querySelector('select, input, textarea');
      return { field: row.getAttribute('data-akari-field'),
        label: text(row.querySelector('.akari-inspector-row-label')).slice(0, 60),
        marks: [...row.querySelectorAll('.akari-inspector-motion-mark')].map(text),
        value: input ? (input.value ?? '') : text(row).slice(0, 80),
        cloud: !!row.querySelector('.akari-inspector-cloud'),
        section: row.closest('[data-akari-ui^="section:inspector-"]')?.getAttribute('data-akari-ui') ?? null };
    });
    const tiles = [...root.querySelectorAll('.akari-inspector-ai-tile, [class*="ai-tile"]')].filter(visible).map(tile => ({
      label: text(tile.querySelector('.akari-inspector-ai-title') ?? tile).slice(0, 40),
      cloud: !!tile.querySelector('.akari-inspector-cloud'), disabled: !!tile.disabled,
      group: text(tile.closest('section')?.querySelector('h3')).slice(0, 30) }));
    const clouds = [...root.querySelectorAll('.akari-inspector-cloud')].filter(visible).map(node =>
      text(node.closest('[data-akari-field], .akari-inspector-ai-tile, button, section')).slice(0, 50));
    const attrs = [...root.querySelectorAll('*')].flatMap(node => ['title', 'aria-label', 'placeholder', 'alt']
      .map(name => node.getAttribute(name)).filter(Boolean));
    const re = ${AI_WORD};
    const aiHits = [...(root.innerText ?? '').split('\\n'), ...attrs].filter(line => re.test(line)).slice(0, 20);
    const rect = root.getBoundingClientRect();
    return { tabs, sections, headings, rows, tiles, clouds, aiHits, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  })()`);
}

async function inspectorShot(name) {
  const state = await inspector();
  if (!state?.rect?.width) return screenshot(`${label}-${name}`);
  const { x, y, width, height } = state.rect;
  return screenshot(`${label}-${name}`, { x: Math.max(0, x - 4), y: Math.max(0, y - 4), width: width + 8, height: Math.min(height + 8, 1000) });
}

async function clickTab(id) {
  const ok = await evaluate(main, `(() => {
    const button = ${INSPECTOR}?.querySelector('[data-akari-ui="tab:inspector-${id}"]');
    if (!button || button.disabled) return false;
    button.click(); return true; })()`);
  await sleep(900);
  return ok;
}

async function select(id) {
  const result = await executeCommand('akari.timeline.focusItem', { itemId: id, reveal: true });
  await sleep(1500);
  return result;
}

// 行の値を書き換える（select = change / 数値・色の文字入力 = 本物の入力: 押す → 全選択 → 文字を打つ → Enter）
async function setField(field, value) {
  const target = await evaluate(main, `(() => {
    const row = ${INSPECTOR}?.querySelector('[data-akari-field="${field}"]');
    if (!row) return { kind: 'no-row' };
    const input = row.querySelector('select') ?? row.querySelector('input[type="text"], input:not([type])');
    if (!input) return { kind: 'no-input' };
    input.scrollIntoView({ block: 'center' });
    if (input.tagName === 'SELECT') {
      input.focus();
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { kind: 'select' };
    }
    const b = input.getBoundingClientRect();
    return { kind: 'text', x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (target.kind === 'text') {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await main.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await sleep(40);
    }
    await sleep(200);
    // 押しても入力欄にフォーカスが来ていなければ、その入力欄へ直接フォーカスする
    target.focused = await evaluate(main, `(() => {
      const row = ${INSPECTOR}?.querySelector('[data-akari-field="${field}"]');
      const input = row?.querySelector('input[type="text"], input:not([type])');
      if (input && document.activeElement !== input) input.focus();
      const e = document.activeElement; if (e && e.select) e.select();
      return e === input; })()`);
    await main.send('Input.insertText', { text: String(value) });
    await sleep(100);
    for (const type of ['keyDown', 'keyUp']) {
      await main.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
        ...(type === 'keyDown' ? { text: '\r' } : {}) });
    }
    await evaluate(main, `(() => { const e = document.activeElement; if (e && e.tagName === 'INPUT') e.blur(); return true; })()`);
  }
  await sleep(1500);
  return target.kind === 'text' ? `text:${target.focused ? 'focused' : 'unfocused'}` : target.kind;
}

async function dismissToasts() {
  return evaluate(main, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '後で');
    if (b) b.click(); return !!b; })()`);
}

async function pressAction(field) {
  const done = await evaluate(main, `(() => {
    const row = ${INSPECTOR}?.querySelector('[data-akari-field="${field}"]');
    const button = row?.querySelector('button');
    if (!button) return false;
    button.click(); return true; })()`);
  await sleep(1500);
  return done;
}

async function readEdit() { return JSON.parse(await readFile(editPath, 'utf8')); }
function findItem(edit, id) {
  for (const t of edit.tracks ?? []) for (const item of t.items ?? []) if (item.id === id) return item;
  return undefined;
}
async function waitEditChange(previousText, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await readFile(editPath, 'utf8') !== previousText) return true;
    await sleep(200);
  }
  return false;
}
async function previewSvg(id) {
  try { return await previewSvgOnce(id); } catch {
    // プレビューの webview が作り直されたら付け直す
    view = await findPreviewView(browser, 15000);
    return view ? previewSvgOnce(id).catch(error => ({ error: String(error).slice(0, 200) })) : null;
  }
}
async function previewSvgOnce(id) {
  if (!view) return null;
  return evaluate(browser, `(() => {
    const node = document.querySelector('[data-overlay-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
    const svg = node?.querySelector('svg');
    if (!svg) return null;
    const painted = [...svg.querySelectorAll('path, line, polyline, polygon, rect, ellipse, circle')];
    return { fills: [...new Set(painted.map(n => n.getAttribute('fill')).filter(Boolean))],
      strokes: [...new Set(painted.map(n => n.getAttribute('stroke')).filter(Boolean))],
      strokeWidths: [...new Set(painted.map(n => n.getAttribute('stroke-width')).filter(Boolean))],
      length: svg.outerHTML.length, head: svg.outerHTML.slice(0, 160) };
  })()`, view.contextId, view.sessionId);
}
async function undo() {
  // ⌘Z（入力欄にフォーカスが無い状態で。ショートカットの経路 = akari.timeline.undo）
  const text = await readFile(editPath, 'utf8');
  await evaluate(main, `(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4, commands: ['undo'] });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  const result = 'cmd+z';
  const changed = await waitEditChange(text);
  await sleep(800);
  return { result, changed };
}

// ---- シナリオ ----------------------------------------------------------------------------

const results = {};
async function scenario(name, run) {
  if (only.length && !only.includes(name)) return;
  try { results[name] = await run(); } catch (error) { results[name] = { error: String(error?.stack ?? error).slice(0, 1200) }; }
}

async function runScenarios() {
  // 1. 写真: タブの並び・「AI」の語が無い・編集タブの 3 群と ☁
  await scenario('photo', async () => {
    const focus = await select('photo');
    await clickTab('video');
    const video = await inspector();
    await inspectorShot('01-photo-video-tab');
    const tabEdit = await clickTab('edit');
    await sleep(1500);
    const edit = await inspector();
    await inspectorShot('02-photo-edit-tab');
    const tabsText = {};
    const aiHitsByTab = { video: video?.aiHits, edit: edit?.aiHits };
    for (const tab of video?.tabs ?? []) {
      if (tab.disabled || ['video', 'edit'].includes(tab.id)) continue;
      await clickTab(tab.id);
      const state = await inspector();
      aiHitsByTab[tab.id] = state?.aiHits;
      tabsText[tab.id] = { sections: state?.sections.map(s => s.heading), rows: state?.rows.length };
    }
    return { focus, tabs: video?.tabs, tabEdit, editSections: edit?.sections, editHeadings: edit?.headings,
      editRows: edit?.rows, editTiles: edit?.tiles, clouds: edit?.clouds, aiHitsByTab, otherTabs: tabsText };
  });

  // 2. 動きタブで入りを「フェード」→ 映像タブの動きの要約
  await scenario('motion', async () => {
    await select('photo');
    await clickTab('motion');
    const before = await inspector();
    await inspectorShot('03-photo-motion-tab');
    const text = await readFile(editPath, 'utf8');
    const how = await setField('motion-in-preset', 'フェード');
    const written = await waitEditChange(text);
    const item = findItem(await readEdit(), 'photo');
    await sleep(800);
    const afterMotion = await inspector();
    await inspectorShot('04-photo-motion-fade');
    await clickTab('video');
    const video = await inspector();
    await inspectorShot('05-photo-video-motion-summary');
    return { motionTabSections: before?.sections, motionTabRows: before?.rows.map(r => r.field), how, written,
      motionAfter: item?.motion ?? null, motionTabAfter: afterMotion?.rows.filter(r => r.field.startsWith('motion-in')),
      summary: video?.rows.filter(r => r.field.startsWith('motion-')),
      marks: video?.rows.filter(r => r.marks.length).map(r => ({ field: r.field, marks: r.marks })) };
  });

  // 3. 図形: 外観に 塗り・枠・角の丸み → 変えるとプレビューに出る・undo 1 回
  await scenario('shape', async () => {
    await select('box');
    await clickTab('video');
    const state = await inspector();
    await inspectorShot('06-shape-appearance');
    const appearance = state?.rows.filter(r => r.section?.includes('appearance') || r.field.startsWith('shape-'));
    const svgBefore = await previewSvg('box');
    const original = findItem(await readEdit(), 'box').source.params;
    // 塗りの色
    let text = await readFile(editPath, 'utf8');
    const fillHow = await setField('shape-fill', '#ef4444');
    const fillWritten = await waitEditChange(text);
    await sleep(1500);
    const fillParams = findItem(await readEdit(), 'box').source.params;
    const svgFill = await previewSvg('box');
    const shotFill = await screenshot(`${label}-07-shape-fill-window`);
    const undoFill = await undo();
    const afterUndo = findItem(await readEdit(), 'box').source.params;
    // プレビューが読み直すまで最大 10 秒待つ（何秒で戻ったかも残す）
    const undoStarted = Date.now();
    let svgUndo = await previewSvg('box');
    while (svgUndo?.fills?.includes('#ef4444') && Date.now() - undoStarted < 10000) { await sleep(250); svgUndo = await previewSvg('box'); }
    svgUndo = { ...svgUndo, waitedMs: Date.now() - undoStarted };
    await screenshot(`${label}-07b-shape-fill-undo-window`);
    // 枠を「色」にして太さ 12・角の丸み 30
    text = await readFile(editPath, 'utf8');
    const strokeModeHow = await setField('shape-strokeMode', '色');
    await waitEditChange(text);
    await sleep(600);
    const strokeModeParams = findItem(await readEdit(), 'box').source.params;
    text = await readFile(editPath, 'utf8');
    const widthHow = await setField('shape-strokeWidth', '12');
    await waitEditChange(text);
    await sleep(600);
    text = await readFile(editPath, 'utf8');
    const cornerHow = await setField('shape-cornerRadius', '30');
    await waitEditChange(text);
    await sleep(1500);
    const strokeParams = findItem(await readEdit(), 'box').source.params;
    const svgStroke = await previewSvg('box');
    const after = await inspector();
    await inspectorShot('08-shape-stroke-corner');
    await screenshot(`${label}-09-shape-stroke-window`);
    return { appearance, original, fillHow, fillWritten, fillParams, svgBefore, svgFill, shotFill, undoFill, afterUndo, svgUndo,
      strokeModeHow, strokeModeParams: { stroke: strokeModeParams.stroke, strokeWidth: strokeModeParams.strokeWidth }, widthHow, cornerHow, strokeParams, svgStroke,
      rowsAfter: after?.rows.filter(r => r.field.startsWith('shape-')) };
  });

  // 4. ライン: 線の行
  await scenario('line', async () => {
    await select('line');
    await clickTab('video');
    const state = await inspector();
    await inspectorShot('10-line-appearance');
    const before = findItem(await readEdit(), 'line').source.params;
    const text = await readFile(editPath, 'utf8');
    const swap = await pressAction('shape-swap-ends');
    const swapped = await waitEditChange(text);
    const after = findItem(await readEdit(), 'line').source.params;
    const undone = await undo();
    const afterUndo = findItem(await readEdit(), 'line').source.params;
    return { rows: state?.rows.filter(r => r.field.startsWith('shape-')), before: { startCap: before.startCap, endCap: before.endCap },
      swap, swapped, after: { startCap: after.startCap, endCap: after.endCap }, undone,
      afterUndo: { startCap: afterUndo.startCap, endCap: afterUndo.endCap } };
  });

  // 5. 吹き出し: 吹き出しの節で数・しっぽの向き・別の形にする
  await scenario('bubble', async () => {
    await select('bubble');
    await clickTab('video');
    const state = await inspector();
    await inspectorShot('11-bubble-section');
    const svgBefore = await previewSvg('bubble');
    let text = await readFile(editPath, 'utf8');
    const countHow = await setField('shape-count', '24');
    const countWritten = await waitEditChange(text);
    text = await readFile(editPath, 'utf8');
    const angleHow = await setField('shape-tailAngle', '90');
    const angleWritten = await waitEditChange(text);
    text = await readFile(editPath, 'utf8');
    const seedHow = await pressAction('shape-next-seed');
    const seedWritten = await waitEditChange(text);
    await sleep(1500);
    const params = findItem(await readEdit(), 'bubble').source.params;
    const svgAfter = await previewSvg('bubble');
    const undoSeed = await undo();
    const afterUndo = findItem(await readEdit(), 'bubble').source.params;
    const after = await inspector();
    await inspectorShot('12-bubble-changed');
    await screenshot(`${label}-13-bubble-window`);
    return { sections: state?.sections, rows: state?.rows.filter(r => r.field.startsWith('shape-')),
      countHow, countWritten, angleHow, angleWritten, seedHow, seedWritten,
      params: { count: params.count, tailAngle: params.tailAngle, seed: params.seed }, undoSeed,
      afterUndo: { count: afterUndo.count, tailAngle: afterUndo.tailAngle, seed: afterUndo.seed },
      svgChanged: svgBefore && svgAfter ? svgBefore.head !== svgAfter.head || svgBefore.length !== svgAfter.length : null,
      rowsAfter: after?.rows.filter(r => ['shape-count', 'shape-tailAngle'].includes(r.field)) };
  });

  // 6. 字幕: テキスト / 動き / 情報
  await scenario('caption', async () => {
    const selected = await executeCommand('akari.timeline.selectCaptions', { editUri, captionIds: ['c-0001'] });
    await sleep(1500);
    let state = await inspector();
    if (!state?.tabs?.some(tab => tab.id === 'text') && view) {
      // プレビューの字幕を押して選ぶ
      const box = await evaluate(browser, `(() => { const n = document.querySelector('.akari-caption__line');
        if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`,
        view.contextId, view.sessionId);
      if (box) {
        const frame = await evaluate(main, `(() => { const f = document.querySelector('iframe'); const r = f ? f.getBoundingClientRect() : { x: 0, y: 0 }; return { x: r.x, y: r.y }; })()`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await main.send('Input.dispatchMouseEvent', { type, x: frame.x + box.x, y: frame.y + box.y, button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
          await sleep(60);
        }
        await sleep(1500);
        state = await inspector();
      }
    }
    await clickTab('motion');
    const motion = await inspector();
    await inspectorShot('14-caption-motion-tab');
    return { selected, tabs: state?.tabs, motionSections: motion?.sections, motionRows: motion?.rows.map(r => r.field).slice(0, 30),
      aiHits: motion?.aiHits };
  });
}

// ---- 起動 -------------------------------------------------------------------------------

let child;
const report = { label, port };
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
    detached: true,
  });
  report.pid = child.pid;
  const isShellPage = value => value.type === 'page' && value.url && !value.url.startsWith('devtools:');
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, values => values.find(isShellPage));
  const target = targets.find(isShellPage);
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  trackErrors(main);
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  trackContexts(browser);
  trackErrors(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  try {
    const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds',
      { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } });
  } catch { /* best-effort */ }

  await sleep(10000);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
  report.timelineOpen = await executeCommand('akari.annotations.open');
  await sleep(5000);
  const deadline = Date.now() + 120000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand('akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreviewView(browser, 15000);
  }
  report.previewBuilt = Boolean(view);
  if (view) {
    await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:5}, '*'); return true; })()`,
      view.contextId, view.sessionId);
    await sleep(1500);
  }
  report.inspectorOpen = await executeCommand('akari.inspector.open');
  await sleep(2000);
  report.toastDismissed = await dismissToasts();
  await runScenarios();
  report.results = results;
  report.windowShot = await screenshot(`${label}-window`);
} catch (error) {
  report.error = String(error?.stack ?? error?.message ?? error?.type ?? error);
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  await sleep(500);
  try { report.finalEdit = JSON.parse(await readFile(editPath, 'utf8')); } catch { /* none */ }
  await rm(scratch, { recursive: true, force: true });
}

const scrub = line => line.replace(/file:\/\/\/[^\s)"]+/g, '<file>').replace(/\/(?:private|tmp|Users|var)\/[^\s):"]+/g, '<path>')
  .replace(/(?:127\.0\.0\.1|localhost):\d+/g, '<local>');
report.consoleErrors = [...new Set(consoleErrors.filter(line => /TypeError|ReferenceError|inspector|shape|motion/i.test(line))
  .map(line => scrub(line).replace(/^\S+Z /, '')))].slice(-15);
if (report.error) report.error = scrub(report.error);
const text = scrub(JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, `${label}.json`), `${text}\n`);
console.log(text.slice(0, 3000));
