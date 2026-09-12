#!/usr/bin/env node

// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-12-clip-context-annotation 指示 5。
//
// 録音していない状態で
//  (a) タイムラインのクリップ右クリック →「注釈…」→ 注釈パネルの composer がそのクリップ対象で開く
//  (b) 出力プレビュー右クリック →「この位置に注釈」（webview-context-menu に項目 1 件）→ 同じ composer
//  (c) 着地した注釈がパネル・ボードで「🎛️ クリップ名」として読め、クリックで該当クリップが選択される
//  (d) 空き帯の右クリック（時刻のみポップアップ）が不変
//  (e) 着地した review.json が packages/schemas の validate-review で緑
// を実機で計測して JSON + PNG に残す。
//
// AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて mkdtemp した一時ディレクトリへ向ける。
// 実利用の ~/.akari ~/.theia ~/.config/akari-video は読み書きしない。
// 終了時は自分が spawn した Electron の pid だけを指名 kill する（pkill -f Electron はしない）。
//
// 使い方: AKARI_CDP_PORT=9481 node run-l1.mjs

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const fixtureDir = path.join(repoRoot, 'dev-fixtures', 'cross-track-image-overlap');
const validateReview = path.join(repoRoot, 'packages', 'schemas', 'bin', 'validate-review.mjs');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'MacOS', 'Electron');
const port = Number(process.env.AKARI_CDP_PORT ?? 9481);
const label = process.env.AKARI_L1_LABEL ?? 'after';

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-clipannot-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const reviewPath = path.join(project, 'review.json');
const editUri = pathToFileURL(editPath).href;

await cp(fixtureDir, project, {
  recursive: true,
  filter: source => !source.endsWith('run-l1.mjs') && !source.endsWith('README.md')
});
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome),
  mkdir(path.join(project, '.akari'), { recursive: true })]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

// 主視覚トラックに 3 本のカットを置く（C1/C2/C3 — reveal の選択移動を観測できるように）。
const fixtureEdit = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [
    { id: 'photo-a', path: 'photo-a.png', proxy: null },
    { id: 'photo-b', path: 'photo-b.png', proxy: null }
  ],
  tracks: [
    {
      id: 'v1', lane: 'visual', name: 'V1 — cuts',
      items: [
        { id: 'cut-alpha', at: 0, duration: 120, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
          source: { kind: 'media', src: 'photo-a', in: 0, out: 4 } },
        { id: 'cut-bravo', at: 120, duration: 120, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
          source: { kind: 'media', src: 'photo-b', in: 0, out: 4 } },
        { id: 'cut-charlie', at: 240, duration: 120, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
          source: { kind: 'media', src: 'photo-a', in: 0, out: 4 } }
      ]
    }
  ]
};
await writeFile(editPath, `${JSON.stringify(fixtureEdit, null, 2)}\n`);

// 証跡に作業機のパスを残さない（wrapper-codex.md 2026-09-09 追記）。
const sanitize = value => String(value)
  .split(scratch).join('<TMP>')
  .split(repoRoot).join('<WORKTREE>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');

const log = [];
function record(step, data = {}) {
  const entry = JSON.parse(sanitize(JSON.stringify({ step, ...data })));
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(entry));
}
const failures = [];
function check(condition, message, data = {}) {
  record(condition ? 'ok' : 'FAILED', { message, ...data });
  if (!condition) failures.push(message);
  return Boolean(condition);
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
      }, 60000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  close() { try { this.socket?.close(); } catch { /* already gone */ } }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId })
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* endpoint not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

let main;
let browser;
let view;

async function waitFor(description, expression, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(main, expression)) return true; } catch { /* redraw */ }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function executeCommand(command, argument) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function'
        && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
      return { ok: true };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function findPreviewView(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        const tree = await browser.send('Page.getFrameTree', {}, sessionId);
        const frames = [];
        (function walk(node) { frames.push(node.frame); (node.childFrames ?? []).forEach(walk); })(tree.frameTree);
        for (const frame of frames) {
          try {
            const world = await browser.send('Page.createIsolatedWorld',
              { frameId: frame.id, worldName: 'akari-clipannot' }, sessionId);
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-stage') && document.getElementById('preview-layers'))`,
              world.executionContextId, sessionId);
            if (hit) return { sessionId, contextId: world.executionContextId, frameId: frame.id, targetId: info.targetId };
          } catch { /* frame gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview context not found');
}

/** ContextMenuRenderer.doRender を包み、menuPath / 項目ラベルを記録して実 popup は抑止する。
 *  titleBarStyle=native では OS ネイティブメニューが出て計測がモーダルで止まるため
 *  （前票 2026-09-12-preview-context-menu-blank の証跡と同じ流儀）。 */
const installRendererProbe = () => evaluate(main, `(() => {
  window.__akariClipRender = [];
  try {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const RendererClass = keys.find(key => typeof key === 'function' && key.prototype
      && typeof key.prototype.render === 'function'
      && typeof key.prototype.setCurrent === 'function');
    const renderer = RendererClass ? window.theia.container.get(RendererClass) : undefined;
    if (!renderer || typeof renderer.doRender !== 'function') {
      return { ok: false, error: 'context menu renderer not found' };
    }
    const labelsOf = node => {
      const out = [];
      const walk = current => {
        if (!current) return;
        if (typeof current.label === 'string' && current.label) out.push(current.label);
        if (Array.isArray(current.children)) current.children.forEach(walk);
      };
      walk(node);
      return out;
    };
    const commandsOf = node => {
      const out = [];
      const walk = current => {
        if (!current) return;
        const id = current.command ?? current.id;
        if (typeof id === 'string' && id.includes('.')) out.push(id);
        if (Array.isArray(current.children)) current.children.forEach(walk);
      };
      walk(node);
      return out;
    };
    if (!renderer.__akariClipHooked) {
      renderer.__akariClipHooked = true;
      const original = renderer.doRender.bind(renderer);
      renderer.doRender = params => {
        let groups = null;
        try {
          const children = params?.menu?.children;
          groups = Array.isArray(children) ? children.length : (children?.length ?? null);
        } catch { /* opaque menu model */ }
        window.__akariClipRender.push({
          menuPath: Array.isArray(params?.menuPath) ? params.menuPath.join('/') : String(params?.menuPath),
          groups,
          labels: labelsOf(params?.menu),
          commands: commandsOf(params?.menu),
          anchor: params?.anchor ? { x: Math.round(params.anchor.x), y: Math.round(params.anchor.y) } : null
        });
        return { onDispose: () => ({ dispose: () => {} }), dispose: () => {} };
      };
    }
    return { ok: true, renderer: renderer.constructor?.name };
  } catch (error) { return { ok: false, error: String(error) }; }
})()`);

const readRendererProbe = () => evaluate(main,
  'JSON.stringify(window.__akariClipRender ?? [])').then(JSON.parse);
const clearRendererProbe = () => evaluate(main, '(() => { window.__akariClipRender = []; return true; })()');

const rect = selector => evaluate(main, `JSON.stringify((() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
})())`).then(JSON.parse);

const clickSelector = selector => evaluate(main, `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (node) node.click();
  return Boolean(node);
})()`);

async function leftClick(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await main.send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0
    });
    await sleep(60);
  }
}

/** クリップは pointerdown で選択される（DOM の .click() では選択が動かない）ため実マウスで押す。 */
async function clickClip(index) {
  const box = await rect(`[data-akari-item-kind="cut"][data-akari-item-id="${index}"]`);
  if (!box || box.width <= 0) return null;
  await leftClick(box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

async function rightClick(x, y, sessionId, offset = { x: 0, y: 0 }) {
  const px = Math.round(x - offset.x);
  const py = Math.round(y - offset.y);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await (sessionId ? browser : main).send('Input.dispatchMouseEvent', {
      type, x: px, y: py, button: 'right', clickCount: 1,
      buttons: type === 'mousePressed' ? 2 : 0
    }, sessionId);
    await sleep(80);
  }
}

async function shot(name) {
  const image = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(here, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(image.data, 'base64'));
  return path.basename(file);
}

const readReview = async () => {
  try { return JSON.parse(await readFile(reviewPath, 'utf8')); } catch { return null; }
};
const waitForReview = async (predicate, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const review = await readReview();
    if (review && predicate(review)) return review;
    await sleep(300);
  }
  return await readReview();
};

const composerState = () => evaluate(main, `JSON.stringify((() => {
  const panel = document.querySelector('.akari-review-panel-widget');
  if (!panel) return { panel: false };
  const chip = panel.querySelector('[data-review-clip-selection-chip]');
  const chipLabel = panel.querySelector('[data-review-clip-selection-label]');
  const input = panel.querySelector('input[aria-label="コメントを入力"]');
  const uiChip = panel.querySelector('[data-review-ui-selection-chip]');
  return {
    panel: true,
    clipChipDisplay: chip ? chip.style.display : null,
    clipChipText: chipLabel ? chipLabel.textContent : null,
    clipChipTitle: chipLabel ? chipLabel.title : null,
    uiChipDisplay: uiChip ? uiChip.style.display : null,
    placeholder: input ? input.placeholder : null,
    focused: Boolean(input && document.activeElement === input)
  };
})())`).then(JSON.parse);

const submitComment = text => evaluate(main, `(() => {
  const panel = document.querySelector('.akari-review-panel-widget');
  const input = panel?.querySelector('input[aria-label="コメントを入力"]');
  const add = [...(panel?.querySelectorAll('button') ?? [])].find(node => node.textContent?.trim() === '追加');
  if (!input || !add) return false;
  input.value = ${JSON.stringify(text)};
  add.click();
  return true;
})()`);

const panelUiTargets = () => evaluate(main, `JSON.stringify(
  [...document.querySelectorAll('.akari-review-panel-widget [data-review-ui-target]')]
    .map(node => ({ tag: node.tagName, target: node.getAttribute('data-review-ui-target'),
      text: node.textContent, title: node.title }))
)`).then(JSON.parse);

const boardUiTargets = () => evaluate(main, `JSON.stringify(
  [...document.querySelectorAll('[data-board-ui-target]')]
    .map(node => ({ tag: node.tagName, target: node.getAttribute('data-board-ui-target'),
      text: node.textContent, title: node.title }))
)`).then(JSON.parse);

const selectedClips = () => evaluate(main, `JSON.stringify(
  [...document.querySelectorAll('[data-akari-item-kind].akari-annotations-selected')]
    .map(node => ({ kind: node.dataset.akariItemKind, id: node.dataset.akariItemId,
      ui: node.getAttribute('data-akari-ui') }))
)`).then(JSON.parse);

const contextMenuItems = () => evaluate(main, `JSON.stringify(
  [...document.querySelectorAll('[data-akari-context-menu] [data-akari-context-item]')]
    .map(node => ({ id: node.dataset.akariContextItem, label: node.textContent }))
)`).then(JSON.parse);

// review.json v1 のレコード形（packages/schemas/examples/review-v1-sample + 本票以前から
// annotation-store.ts が書いている transcript / session）。本票でキーを増やしていないことの照合用。
const V1_ANNOTATION_KEYS = new Set(['id', 'createdAt', 'src', 'sourceT', 'sourceRange', 'timelineT',
  'target', 'targetKind', 'region', 'strokes', 'refs', 'insertPosition', 'intent', 'text', 'input',
  'audio', 'transcript', 'session', 'poses', 'status', 'response']);

let child;
let status = 'FAILED';
const summary = {};
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox', '--disable-features=MacWebContentsOcclusion'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome, AKARI_FRAME_ENGINE: '1' },
    stdio: 'ignore'
  });
  record('launched', { pid: child.pid, label });

  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')));
  main = new CDP(targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:')).webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);

  await waitFor('theia ready', 'Boolean(window.theia && window.theia.container)', 180000);
  await sleep(8000);
  await evaluate(main, `(() => { const button = [...document.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.trim() === '開くだけ'); if (button) button.click(); return true; })()`);
  await sleep(1500);

  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await executeCommand('akari.annotations.open', { editUri });
    if (opened.ok) break;
    await sleep(3000);
  }
  await waitFor('timeline clips rendered',
    `document.querySelectorAll('[data-akari-item-kind="cut"]').length >= 3`, 90000);
  record('timeline-ready', { clips: await evaluate(main,
    `JSON.stringify([...document.querySelectorAll('[data-akari-item-kind="cut"]')]
      .map(node => ({ id: node.dataset.akariItemId, ui: node.getAttribute('data-akari-ui'),
        label: node.getAttribute('data-akari-ui-label') })))`).then(JSON.parse) });

  // ── (a) タイムラインのクリップ右クリック ────────────────────────────────
  const clipBox = await rect('[data-akari-item-kind="cut"][data-akari-item-id="2"]');
  check(Boolean(clipBox && clipBox.width > 0), 'C3 のクリップ矩形を取得できた', { clipBox });
  await rightClick(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
  await waitFor('clip context menu', `Boolean(document.querySelector('[data-akari-context-menu]'))`, 30000);
  const menuItems = await contextMenuItems();
  const annotateEntry = menuItems.find(entry => entry.id === 'annotate');
  const deleteIndex = menuItems.findIndex(entry => entry.id === 'delete');
  const annotateIndex = menuItems.findIndex(entry => entry.id === 'annotate');
  check(Boolean(annotateEntry), 'クリップ右クリックに「注釈…」がある', { menuItems });
  check(annotateEntry?.label === '注釈…', '項目ラベルが「注釈…」', { label: annotateEntry?.label });
  check(annotateIndex >= 0 && deleteIndex === annotateIndex + 1, '「注釈…」は「削除」の直前にある',
    { annotateIndex, deleteIndex });
  const menuShot = await shot('01-clip-context-menu');

  await clickSelector('[data-akari-context-item="annotate"]');
  await waitFor('clip chip in composer',
    `(() => { const chip = document.querySelector('[data-review-clip-selection-chip]');
      return Boolean(chip && chip.style.display === 'inline-flex'); })()`, 30000);
  const composerAfterMenu = await composerState();
  record('composer-after-timeline-menu', composerAfterMenu);
  check(composerAfterMenu.clipChipDisplay === 'inline-flex', 'composer にクリップ文脈チップが出る');
  check(String(composerAfterMenu.clipChipText ?? '').startsWith('🎛️'), 'チップは 🎛️ + クリップ名',
    { text: composerAfterMenu.clipChipText });
  check(composerAfterMenu.clipChipTitle === 'ui:timeline:item:cut-charlie',
    'チップの target は v2 語彙 ui:timeline:item:cut-charlie', { title: composerAfterMenu.clipChipTitle });
  check(composerAfterMenu.placeholder === 'このクリップについてコメント',
    'placeholder がクリップ文脈に変わる', { placeholder: composerAfterMenu.placeholder });
  check(composerAfterMenu.uiChipDisplay === 'none', '録音中 select 用チップは出ない（録音していない）');
  const composerShot = await shot('02-composer-clip-context');

  await submitComment('C3 の色が浮いている');
  const reviewAfterTimeline = await waitForReview(review =>
    (review.annotations ?? []).some(entry => entry.target === 'ui:timeline:item:cut-charlie'));
  const timelineAnnotation = (reviewAfterTimeline?.annotations ?? [])
    .find(entry => entry.target === 'ui:timeline:item:cut-charlie');
  check(Boolean(timelineAnnotation), 'review.json に ui:timeline:item:cut-charlie が着地した',
    { annotations: (reviewAfterTimeline?.annotations ?? []).map(entry => ({
      id: entry.id, target: entry.target, input: entry.input, status: entry.status,
      sourceT: entry.sourceT, text: entry.text })) });
  check(timelineAnnotation?.text === 'C3 の色が浮いている', '本文がそのまま着地した');
  check(reviewAfterTimeline?.version === 0,
    'review.json の version は v1 契約の 0 のまま（additive）', { version: reviewAfterTimeline?.version });
  check(Object.keys(timelineAnnotation ?? {}).every(key => V1_ANNOTATION_KEYS.has(key)),
    '注釈レコードに v1 契約外のキーを増やしていない',
    { keys: Object.keys(timelineAnnotation ?? {}) });
  const chipAfterSubmit = await composerState();
  check(chipAfterSubmit.clipChipDisplay === 'none', '送信後にクリップ選択は解除される');

  const panelTargets = await panelUiTargets();
  record('panel-ui-targets', { panelTargets });
  check(panelTargets.some(entry => entry.target === 'timeline:item:cut-charlie'
    && entry.tag === 'BUTTON' && entry.text === '🎛️ cut-charlie'),
  'パネルの行が 🎛️ クリップ名 + クリック導線（button）になる', { panelTargets });

  // ── (c) クリック導線 = 該当クリップを選択 ─────────────────────────────
  await clickClip(0);
  await sleep(1200);
  const selectionBeforeReveal = await selectedClips();
  await clickSelector('.akari-review-panel-widget [data-review-ui-target="timeline:item:cut-charlie"]');
  await sleep(1200);
  const selectionAfterReveal = await selectedClips();
  record('reveal', { selectionBeforeReveal, selectionAfterReveal });
  check(selectionBeforeReveal.some(entry => entry.ui === 'timeline:cut:0'), 'reveal 前は C1 が選択されている',
    { selectionBeforeReveal });
  check(selectionAfterReveal.some(entry => entry.ui === 'timeline:cut:2'),
    'パネルの 🎛️ クリックで C3 が選択される', { selectionAfterReveal });
  const revealShot = await shot('03-reveal-selects-clip');

  // ── (d) 空き帯の右クリックは時刻のみのまま ──────────────────────────────
  const stripBox = await rect('[data-akari-ui="panel:timeline"]');
  const lastClip = await rect('[data-akari-item-kind="cut"][data-akari-item-id="2"]');
  const emptyPoint = { x: Math.min(lastClip.x + lastClip.width + 60, stripBox.x + stripBox.width - 24),
    y: lastClip.y + lastClip.height / 2 };
  record('empty-band-point', { stripBox, lastClip, emptyPoint });
  await rightClick(emptyPoint.x, emptyPoint.y);
  await sleep(900);
  const emptyBandPopup = await evaluate(main, `JSON.stringify((() => {
    const inputs = [...document.querySelectorAll('input[aria-label="タイムラインに注釈を追加"]')];
    return { count: inputs.length, placeholder: inputs[0]?.placeholder ?? null,
      contextMenus: document.querySelectorAll('[data-akari-context-menu]').length };
  })())`).then(JSON.parse);
  record('empty-band-context-menu', emptyBandPopup);
  check(emptyBandPopup.count === 1, '空き帯の右クリックは従来の時刻ポップアップのまま', emptyBandPopup);
  check(/に注釈$/.test(String(emptyBandPopup.placeholder ?? '')),
    '時刻のみ（クリップ文脈なし）のプレースホルダ', { placeholder: emptyBandPopup.placeholder });
  check(emptyBandPopup.contextMenus === 0, '空き帯ではクリップ用メニューを出さない', emptyBandPopup);
  await evaluate(main, `(() => { document.body.click(); return true; })()`);
  await sleep(400);

  // ── (b) 出力プレビューの右クリック ───────────────────────────────────
  record('renderer-probe-installed', await installRendererProbe());
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await executeCommand('akari.preview.ensureVisible', { editUri });
    if (opened.ok) break;
    await sleep(3000);
  }
  await sleep(4000);
  await evaluate(main, `(() => { const tab = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')]
    .find(node => node.textContent?.trim() === '出力プレビュー'); if (tab) tab.click(); return true; })()`);
  view = await findPreviewView();
  record('preview-attached', {});
  await sleep(3000);

  // タイムラインで C2 を選ぶ → primaryTimelineSelections に cut が入る。
  const c2Box = await clickClip(1);
  await sleep(1800);
  record('preview-primary-selection', { c2Box, selected: await selectedClips() });

  await clearRendererProbe();
  const inner = await evaluate(browser, `(() => {
    const box = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`, view.contextId, view.sessionId);
  const outer = await evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')]
      .map(frame => frame.getBoundingClientRect())
      .filter(box => box.width > 0 && box.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const box = frames[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`);
  const point = { x: Math.round(outer.x + inner.x + inner.width / 2),
    y: Math.round(outer.y + inner.y + inner.height / 2) };
  record('preview-right-click-point', { inner, outer, point });
  await rightClick(point.x, point.y);
  await sleep(1200);
  let rendererProbe = await readRendererProbe();
  if (rendererProbe.length === 0) {
    await rightClick(point.x, point.y, view.sessionId, { x: outer.x, y: outer.y });
    await sleep(1200);
    rendererProbe = await readRendererProbe();
  }
  record('preview-context-menu-render', { rendererProbe });
  const webviewRender = rendererProbe.find(entry => entry.menuPath === 'webview-context-menu');
  check(Boolean(webviewRender), 'プレビュー右クリックで webview-context-menu が要求される',
    { rendererProbe });
  check((webviewRender?.labels ?? []).includes('この位置に注釈'),
    'webview-context-menu に「この位置に注釈」が登録されている（項目 0 = 空メニューの再発なし）',
    { labels: webviewRender?.labels });
  check((webviewRender?.commands ?? []).includes('akari.preview.annotateAtPoint'),
    'メニュー項目は akari.preview.annotateAtPoint を指す', { commands: webviewRender?.commands });

  // ネイティブ popup は抑止しているので、項目が実行する経路をコマンドで踏む。
  await executeCommand('akari.preview.annotateAtPoint');
  await waitFor('clip chip from preview',
    `(() => { const chip = document.querySelector('[data-review-clip-selection-chip]');
      return Boolean(chip && chip.style.display === 'inline-flex'); })()`, 30000);
  const composerFromPreview = await composerState();
  record('composer-after-preview-menu', composerFromPreview);
  check(composerFromPreview.clipChipTitle === 'ui:timeline:item:cut-bravo',
    'プレビュー由来の注釈は選択中クリップ（C2）を対象にする', { title: composerFromPreview.clipChipTitle });
  const previewShot = await shot('04-composer-from-preview');

  await submitComment('プレビューのこの位置、明るすぎる');
  const reviewAfterPreview = await waitForReview(review =>
    (review.annotations ?? []).some(entry => entry.target === 'ui:timeline:item:cut-bravo'));
  const previewAnnotation = (reviewAfterPreview?.annotations ?? [])
    .find(entry => entry.target === 'ui:timeline:item:cut-bravo');
  check(Boolean(previewAnnotation), 'review.json に ui:timeline:item:cut-bravo が着地した',
    { annotations: (reviewAfterPreview?.annotations ?? []).map(entry => ({
      id: entry.id, target: entry.target, input: entry.input, status: entry.status, text: entry.text })) });
  check((reviewAfterPreview?.annotations ?? []).length === 2,
    'review.json の注釈は 2 件（タイムライン由来 + プレビュー由来）',
    { count: (reviewAfterPreview?.annotations ?? []).length });
  check((reviewAfterPreview?.annotations ?? []).every(entry => entry.input === 'typed'),
    '両方とも typed 入力として記録される');

  // ── (c-2) ボードの ui: 描画 ───────────────────────────────────────────
  await executeCommand('akari.review.board.open');
  await waitFor('board ui target', `document.querySelectorAll('[data-board-ui-target]').length >= 2`, 30000);
  await sleep(1200);
  const boardTargets = await boardUiTargets();
  record('board-ui-targets', { boardTargets });
  check(boardTargets.some(entry => entry.target === 'timeline:item:cut-charlie'
    && entry.tag === 'BUTTON' && entry.text === '🎛️ cut-charlie'),
  'ボードのカードが 🎛️ クリップ名 + クリック導線になる（生 id ではない）', { boardTargets });
  check(boardTargets.some(entry => entry.target === 'timeline:item:cut-bravo'
    && entry.text === '🎛️ cut-bravo'), 'プレビュー由来のカードも 🎛️ クリップ名で読める', { boardTargets });
  const boardShot = await shot('05-board-ui-target');

  // ── (e) schema 検証 ──────────────────────────────────────────────────
  const validation = spawnSync(process.execPath, [validateReview, reviewPath], { encoding: 'utf8' });
  record('validate-review', { exit: validation.status,
    stdout: sanitize(validation.stdout ?? '').trim().slice(0, 600),
    stderr: sanitize(validation.stderr ?? '').trim().slice(0, 600) });
  check(validation.status === 0, 'packages/schemas の validate-review が exit 0', { exit: validation.status });

  summary.label = label;
  summary.menuItems = menuItems;
  summary.composerAfterTimelineMenu = composerAfterMenu;
  summary.composerAfterPreviewMenu = composerFromPreview;
  summary.panelUiTargets = panelTargets;
  summary.boardUiTargets = boardTargets;
  summary.selectionBeforeReveal = selectionBeforeReveal;
  summary.selectionAfterReveal = selectionAfterReveal;
  summary.emptyBandPopup = emptyBandPopup;
  summary.previewContextMenuRender = rendererProbe;
  summary.validateReviewExit = validation.status;
  summary.reviewVersion = reviewAfterPreview?.version ?? null;
  summary.reviewAnnotations = (reviewAfterPreview?.annotations ?? []).map(entry => ({
    id: entry.id, target: entry.target, input: entry.input, status: entry.status,
    sourceT: entry.sourceT, text: entry.text
  }));
  summary.shots = [menuShot, composerShot, revealShot, previewShot, boardShot];
  summary.failures = failures;
  status = failures.length === 0 ? 'PASS' : 'FAILED';
  record('verdict', { status, failures });
} catch (error) {
  record('error', { error: sanitize(String(error?.stack ?? error)) });
  console.error(error);
} finally {
  await writeFile(path.join(here, `run-log-${label}.json`),
    `${sanitize(JSON.stringify({ status, label, summary, records: log }, null, 2))}\n`)
    .catch(() => undefined);
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  await sleep(1500);
  await rm(scratch, { recursive: true, force: true });
}
console.log(`L1_STATUS=${status}`);
process.exit(status === 'PASS' ? 0 : 1);
