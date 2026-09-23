#!/usr/bin/env node

// L1 harness (verification-only; not product source). refs #82.
//
// 注釈 15 件（すべて「対応済み」）の review.json を持つ scratch プロジェクトを実機の shell で開き、
//  P1 注釈パネル（絞り込み = すべて）: 一覧を下までスクロール → 12 件目 a-0012 を「確認済みにする」
//  P2 注釈パネル（絞り込み = 対応済み）: 表示中の 12 件目（a-0013）を先頭付近へ置いて「確認済みにする」
//     （確認済みになった項目は一覧から消える → 次の項目が同じ位置に来るべき）
//  P3 注釈パネル（すべて）: 下までスクロールした状態で review.json へ外から 1 件追加（sourceT 最小 = 一覧の先頭に入る）
//  B1 ボード（対応済みの列）: 列を下までスクロール → 列の 12 件目を「確認済みにする」
//  B2 ボード（対応済みの列）: 外から 1 件追加（先頭に入る）
// のそれぞれで、操作の前後の scrollTop・表示先頭の項目 id・その項目の画面上の位置（コンテナ上端からの px）を
// CDP で測り、JSON + PNG に残す。スクロールコンテナの scrollTop の変化は scroll イベントでも時系列に記録する。
//
// AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて mkdtemp した一時ディレクトリ（slug 入り）へ向ける。
// 終了時は自分が spawn した Electron の pid だけを kill する。
//
// 使い方: AKARI_CDP_PORT=9484 AKARI_L1_LABEL=before node run-l1.mjs

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const electron = path.join(repoRoot, 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'MacOS', 'Electron');
const port = Number(process.env.AKARI_CDP_PORT ?? 9484);
const label = process.env.AKARI_L1_LABEL ?? 'after';

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-issue-82-resolve-scroll-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const reviewPath = path.join(project, 'review.json');
const editUri = pathToFileURL(editPath).href;

await Promise.all([mkdir(profile, { recursive: true }), mkdir(config, { recursive: true }),
  mkdir(akariHome, { recursive: true }), mkdir(path.join(project, '.akari'), { recursive: true })]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

const fixtureEdit = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [],
  tracks: [
    {
      id: 'v1', lane: 'visual', name: 'V1',
      items: [
        { id: 'card-a', at: 0, duration: 900, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
          source: { kind: 'text', text: 'issue 82' } }
      ]
    }
  ]
};
await writeFile(editPath, `${JSON.stringify(fixtureEdit, null, 2)}\n`);

function annotation(index, overrides = {}) {
  const id = `a-${String(index).padStart(4, '0')}`;
  return {
    id, createdAt: `2026-09-23T10:${String(index).padStart(2, '0')}:00.000Z`, src: null,
    sourceT: index * 2, sourceRange: null, timelineT: null, target: null, targetKind: 'instant',
    region: null, strokes: null, refs: null, insertPosition: null, intent: 'fix',
    text: `注釈 ${index} 件目: テロップの位置を少し上げたい`, input: 'typed', audio: null, poses: null,
    status: 'addressed',
    response: { summary: `${index} 件目を直しました`, action: 'edited', respondedAt: '2026-09-23T11:00:00.000Z' },
    ...overrides
  };
}
const initialReview = { version: 0, annotations: Array.from({ length: 15 }, (_, i) => annotation(i + 1)) };
await writeFile(reviewPath, `${JSON.stringify(initialReview, null, 2)}\n`);

const sanitize = value => String(value)
  .split(scratch).join('<TMP>')
  .split(repoRoot).join('<REPO>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');

const log = [];
function record(step, data = {}) {
  const entry = JSON.parse(sanitize(JSON.stringify({ step, ...data })));
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(entry));
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
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
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }
      }, 120000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket?.close(); } catch { /* already gone */ } }
}

let main;
async function evaluate(expression) {
  const response = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const evalJson = expression => evaluate(`JSON.stringify(${expression})`).then(JSON.parse);

async function waitForJson(url, predicate, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitFor(description, expression, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch { /* redraw */ }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function executeCommand(command, argument) {
  return evaluate(`(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function'
        && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}${argument === undefined ? '' : `, ${JSON.stringify(argument)}`});
      return { ok: true };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function shot(name) {
  await main.send('Page.bringToFront').catch(() => {});
  await sleep(400);
  const image = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(here, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(image.data, 'base64'));
  return path.basename(file);
}

const readReview = async () => {
  try { return JSON.parse(await readFile(reviewPath, 'utf8')); } catch { return null; }
};
async function writeReviewExternally(review) {
  const tmp = `${reviewPath}.ext-${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(review, null, 2)}\n`);
  await rename(tmp, reviewPath);
}

// ── 計測 ──────────────────────────────────────────────────────────────
// scope: 'panel' | 'board:<status>'。行セレクタの親 = スクロールコンテナ。
const SCOPES = {
  panel: { root: '.akari-review-panel-widget', row: '[data-annotation-row],[data-annotation-undo]',
    idOf: "node => node.getAttribute('data-annotation-row') ?? node.getAttribute('data-annotation-undo')" },
  'board:addressed': { root: '[data-board-column="addressed"]', row: '[data-board-card],[data-board-undo]',
    idOf: "node => node.getAttribute('data-board-card') ?? node.getAttribute('data-board-undo')" },
  'board:resolved': { root: '[data-board-column="resolved"]', row: '[data-board-card],[data-board-undo]',
    idOf: "node => node.getAttribute('data-board-card') ?? node.getAttribute('data-board-undo')" }
};
const containerExpr = scope => `(() => {
  const root = document.querySelector(${JSON.stringify(SCOPES[scope].root)});
  if (!root) return null;
  const row = root.querySelector(${JSON.stringify(SCOPES[scope].row)});
  if (row) return row.parentElement;
  // 空の列でも overflow:auto の要素を拾う
  return [...root.querySelectorAll('div')].find(node => getComputedStyle(node).overflowY === 'auto') ?? null;
})()`;

const measure = scope => evalJson(`(() => {
  const container = ${containerExpr(scope)};
  if (!container) return { found: false };
  const idOf = ${SCOPES[scope].idOf};
  const box = container.getBoundingClientRect();
  const rows = [...container.querySelectorAll(${JSON.stringify(SCOPES[scope].row)})];
  const first = rows.find(node => node.getBoundingClientRect().bottom > box.top + 1);
  const firstBox = first?.getBoundingClientRect();
  return {
    found: true,
    scrollTop: Math.round(container.scrollTop * 10) / 10,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    firstVisibleId: first ? idOf(first) : null,
    firstVisibleOffset: firstBox ? Math.round((firstBox.top - box.top) * 10) / 10 : null,
    firstVisibleHeight: firstBox ? Math.round(firstBox.height * 10) / 10 : null,
    order: rows.map(idOf)
  };
})()`);

const installScrollLog = scope => evaluate(`(() => {
  const container = ${containerExpr(scope)};
  if (!container) return false;
  window.__akari82ScrollLog = [];
  const start = performance.now();
  if (container.__akari82Listener) container.removeEventListener('scroll', container.__akari82Listener);
  container.__akari82Listener = () => window.__akari82ScrollLog.push(
    { t: Math.round(performance.now() - start), scrollTop: Math.round(container.scrollTop) });
  container.addEventListener('scroll', container.__akari82Listener);
  return true;
})()`);
const readScrollLog = () => evalJson('window.__akari82ScrollLog ?? []');

const scrollTo = (scope, where) => evalJson(`(() => {
  const container = ${containerExpr(scope)};
  if (!container) return null;
  const where = ${JSON.stringify(where)};
  if (where === 'bottom') {
    container.scrollTop = container.scrollHeight;
  } else {
    const row = container.querySelector('[data-annotation-row="' + where + '"],[data-board-card="' + where + '"]');
    if (row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }
  return { scrollTop: container.scrollTop, max: container.scrollHeight - container.clientHeight };
})()`);

async function realClick(selector) {
  const box = await evalJson(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
  })()`);
  if (!box || box.w <= 0) return null;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await main.send('Input.dispatchMouseEvent', {
      type, x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0
    });
    await sleep(60);
  }
  return box;
}

async function waitReview(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const review = await readReview();
    if (review && predicate(review)) return review;
    await sleep(250);
  }
  return readReview();
}

/** 1 操作の前後を測る。settle 中に scrollTop が動いたら scroll ログに残る。 */
async function scenario(name, scope, { prepare, act, expectAnchor }) {
  await prepare();
  await sleep(1200);
  const before = await measure(scope);
  const beforeShot = await shot(`${name}-1-before`);
  await installScrollLog(scope);
  const actResult = await act(before);
  await sleep(2500);
  const after = await measure(scope);
  const scrollLog = await readScrollLog();
  const afterShot = await shot(`${name}-2-after`);
  const anchor = expectAnchor(before, after);
  const tolerance = before.firstVisibleHeight ?? 0;
  const offsetDelta = anchor.afterOffset === null || anchor.beforeOffset === null
    ? null : Math.round((anchor.afterOffset - anchor.beforeOffset) * 10) / 10;
  const pass = anchor.id !== null && offsetDelta !== null && Math.abs(offsetDelta) <= tolerance
    && (anchor.expectedFirstVisible === undefined || after.firstVisibleId === anchor.expectedFirstVisible);
  record('scenario', {
    name, scope, pass,
    before: { scrollTop: before.scrollTop, firstVisibleId: before.firstVisibleId,
      firstVisibleOffset: before.firstVisibleOffset, rowHeight: before.firstVisibleHeight,
      scrollHeight: before.scrollHeight, clientHeight: before.clientHeight },
    after: { scrollTop: after.scrollTop, firstVisibleId: after.firstVisibleId,
      firstVisibleOffset: after.firstVisibleOffset, scrollHeight: after.scrollHeight, clientHeight: after.clientHeight },
    anchor: { ...anchor, offsetDelta, tolerance },
    scrollLog, act: actResult, screenshots: [beforeShot, afterShot],
    orderBefore: before.order, orderAfter: after.order
  });
  return pass;
}

async function offsetOf(scope, id) {
  return evaluate(`(() => {
    const container = ${containerExpr(scope)};
    if (!container) return null;
    const node = container.querySelector('[data-annotation-row="${id}"],[data-annotation-undo="${id}"],[data-board-card="${id}"],[data-board-undo="${id}"]');
    if (!node) return null;
    return Math.round((node.getBoundingClientRect().top - container.getBoundingClientRect().top) * 10) / 10;
  })()`);
}

/** 既定のアンカー判定: 操作前の表示先頭項目（hiddenId が表示先頭なら、操作前の並びで次の項目）。 */
async function finalize(key, scope, hiddenId) {
  const entry = log[log.length - 1];
  let anchorId = entry.before.firstVisibleId;
  if (hiddenId && anchorId === hiddenId) {
    anchorId = entry.orderBefore[entry.orderBefore.indexOf(hiddenId) + 1] ?? null;
  }
  const afterOffset = anchorId ? await offsetOf(scope, anchorId) : null;
  const beforeOffset = entry.before.firstVisibleOffset;
  entry.anchor = { id: anchorId, beforeOffset, afterOffset,
    offsetDelta: afterOffset === null || beforeOffset === null ? null : Math.round((afterOffset - beforeOffset) * 10) / 10,
    tolerance: entry.before.rowHeight };
  entry.pass = entry.anchor.offsetDelta !== null && Math.abs(entry.anchor.offsetDelta) <= entry.anchor.tolerance
    && (entry.after.firstVisibleId === anchorId || clampedAtEnd(entry))
    && (entry.act?.savedStatus === undefined || entry.act.savedStatus === 'resolved');
  results[key] = entry.pass;
  console.log(`[${key}-final]`, JSON.stringify({ pass: entry.pass, anchor: entry.anchor,
    before: entry.before, after: entry.after }));
}

/** 一覧が短くなって末尾でクランプされた（それ以上スクロールできない）か。このときは先頭 id でなく位置ずれ（±1 行）で判定する。 */
function clampedAtEnd(entry) {
  const clamped = entry.after.scrollTop >= entry.after.scrollHeight - entry.after.clientHeight - 1;
  entry.clampedAtEnd = clamped;
  return clamped;
}

let child;
let status = 'FAILED';
const results = {};
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox', '--disable-features=MacWebContentsOcclusion',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore'
  });
  record('launched', { pid: child.pid, label, port });

  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')));
  main = new CDP(targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:')).webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  await waitFor('theia ready', 'Boolean(window.theia && window.theia.container)', 300000);
  await sleep(8000);
  const windowInfo = await main.send('Browser.getWindowForTarget').catch(() => null);
  if (windowInfo) {
    await main.send('Browser.setWindowBounds', { windowId: windowInfo.windowId,
      bounds: { left: 40, top: 40, width: 1500, height: 860, windowState: 'normal' } }).catch(() => {});
  }
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.trim() === '開くだけ'); if (button) button.click(); return true; })()`);
  await sleep(1500);

  for (let attempt = 0; attempt < 10; attempt++) {
    const opened = await executeCommand('akari.annotations.open', { editUri });
    if (opened.ok) break;
    await sleep(3000);
  }
  await executeCommand('akari.review.open');
  await waitFor('panel rows', `document.querySelectorAll('.akari-review-panel-widget [data-annotation-row]').length >= 15`, 180000);
  record('panel-ready', { rows: await evaluate(`document.querySelectorAll('.akari-review-panel-widget [data-annotation-row]').length`) });

  // ── P1 パネル・すべて・下までスクロール → a-0012 を確認済みに ─────────────
  {
    // 下までスクロールしてから、12 件目がビューに入る位置（12 件目がビュー上端）まで戻す。
    await scenario('p1-panel-all-resolve-12', 'panel', {
      prepare: async () => { await scrollTo('panel', 'bottom'); await sleep(300); await scrollTo('panel', 'a-0012'); },
      act: async () => {
        const click = await realClick('.akari-review-panel-widget [data-resolve-button="a-0012"]');
        const review = await waitReview(r => r.annotations.find(a => a.id === 'a-0012')?.status === 'resolved');
        return { clicked: Boolean(click), savedStatus: review?.annotations.find(a => a.id === 'a-0012')?.status,
          savedRecord: review?.annotations.find(a => a.id === 'a-0012') };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    await finalize('p1', 'panel');
  }

  // ── P2 パネル・対応済みで絞り込み → 表示 12 件目（a-0013）を先頭へ置いて確認済みに（消える）────
  {
    await evaluate(`(() => { const select = document.querySelector('.akari-review-panel-widget select[aria-label="状態で絞り込み"]');
      select.value = 'addressed'; select.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor('filtered', `!document.querySelector('.akari-review-panel-widget [data-annotation-row="a-0012"]')`, 30000);
    let before;
    await scenario('p2-panel-addressed-resolve-13', 'panel', {
      prepare: async () => { await scrollTo('panel', 'a-0013'); },
      act: async measured => {
        before = measured;
        const click = await realClick('.akari-review-panel-widget [data-resolve-button="a-0013"]');
        const review = await waitReview(r => r.annotations.find(a => a.id === 'a-0013')?.status === 'resolved');
        return { clicked: Boolean(click), savedStatus: review?.annotations.find(a => a.id === 'a-0013')?.status,
          indexInList: measured.order.indexOf('a-0013') + 1 };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    const entry = log[log.length - 1];
    // アンカー: 表示先頭が消えた項目なら、操作前の並びで次の項目。それ以外は表示先頭そのもの。
    let anchorId = entry.before.firstVisibleId;
    let beforeOffset = entry.before.firstVisibleOffset;
    if (anchorId === 'a-0013') {
      anchorId = entry.orderBefore[entry.orderBefore.indexOf('a-0013') + 1] ?? null;
    }
    const afterOffset = anchorId ? await offsetOf('panel', anchorId) : null;
    entry.anchor = { id: anchorId, beforeOffset, afterOffset,
      offsetDelta: afterOffset === null ? null : Math.round((afterOffset - beforeOffset) * 10) / 10,
      tolerance: entry.before.rowHeight };
    entry.pass = afterOffset !== null && Math.abs(entry.anchor.offsetDelta) <= entry.anchor.tolerance
      && (entry.after.firstVisibleId === anchorId || clampedAtEnd(entry)) && entry.act?.savedStatus === 'resolved';
    results.p2 = entry.pass;
    console.log('[p2-final]', JSON.stringify({ pass: entry.pass, anchor: entry.anchor }));
  }

  // ── P2b パネル・対応済み → 一覧の中ほど（a-0005）を先頭に置いて確認済みに（消える・末尾クランプなし）────
  {
    await scenario('p2b-panel-addressed-resolve-mid', 'panel', {
      prepare: async () => { await scrollTo('panel', 'a-0005'); },
      act: async () => {
        const click = await realClick('.akari-review-panel-widget [data-resolve-button="a-0005"]');
        const review = await waitReview(r => r.annotations.find(a => a.id === 'a-0005')?.status === 'resolved');
        return { clicked: Boolean(click), savedStatus: review?.annotations.find(a => a.id === 'a-0005')?.status };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    await finalize('p2b', 'panel', 'a-0005');
  }

  // ── P3 パネル・すべて・下までスクロール → 外から 1 件追加（先頭に入る）─────────
  {
    await evaluate(`(() => { const select = document.querySelector('.akari-review-panel-widget select[aria-label="状態で絞り込み"]');
      select.value = 'all'; select.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor('all', `Boolean(document.querySelector('.akari-review-panel-widget [data-annotation-row="a-0012"]'))`, 30000);
    await scenario('p3-panel-external-add', 'panel', {
      prepare: async () => { await scrollTo('panel', 'bottom'); },
      act: async () => {
        const review = await readReview();
        review.annotations.push(annotation(16, { sourceT: 0.2, text: '外から追加された注釈（録音レビューのコンパイル相当）' }));
        await writeReviewExternally(review);
        await waitFor('external row', `Boolean(document.querySelector('.akari-review-panel-widget [data-annotation-row="a-0016"]'))`, 60000);
        return { added: 'a-0016' };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    const entry = log[log.length - 1];
    const anchorId = entry.before.firstVisibleId;
    const afterOffset = await offsetOf('panel', anchorId);
    entry.anchor = { id: anchorId, beforeOffset: entry.before.firstVisibleOffset, afterOffset,
      offsetDelta: afterOffset === null ? null : Math.round((afterOffset - entry.before.firstVisibleOffset) * 10) / 10,
      tolerance: entry.before.rowHeight };
    entry.pass = afterOffset !== null && Math.abs(entry.anchor.offsetDelta) <= entry.anchor.tolerance
      && (entry.after.firstVisibleId === anchorId || clampedAtEnd(entry));
    results.p3 = entry.pass;
    console.log('[p3-final]', JSON.stringify({ pass: entry.pass, anchor: entry.anchor }));
  }

  // ── B1 ボード・対応済みの列を下までスクロール → 列の 12 件目を確認済みに ─────────
  {
    await executeCommand('akari.review.board.open');
    await waitFor('board cards', `document.querySelectorAll('[data-board-column="addressed"] [data-board-card]').length >= 12`, 120000);
    await sleep(1500);
    const order = (await measure('board:addressed')).order;
    const target = order[11];
    await scenario('b1-board-resolve-12th', 'board:addressed', {
      prepare: async () => { await scrollTo('board:addressed', 'bottom'); await sleep(300); await scrollTo('board:addressed', target); },
      act: async () => {
        const click = await realClick(`[data-board-resolve="${target}"]`);
        const review = await waitReview(r => r.annotations.find(a => a.id === target)?.status === 'resolved');
        return { target, clicked: Boolean(click), savedStatus: review?.annotations.find(a => a.id === target)?.status,
          savedRecord: review?.annotations.find(a => a.id === target) };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    const entry = log[log.length - 1];
    let anchorId = entry.before.firstVisibleId;
    if (anchorId === target) anchorId = entry.orderBefore[entry.orderBefore.indexOf(target) + 1] ?? null;
    const afterOffset = anchorId ? await offsetOf('board:addressed', anchorId) : null;
    entry.anchor = { id: anchorId, beforeOffset: entry.before.firstVisibleOffset, afterOffset,
      offsetDelta: afterOffset === null ? null : Math.round((afterOffset - entry.before.firstVisibleOffset) * 10) / 10,
      tolerance: entry.before.rowHeight };
    entry.pass = afterOffset !== null && Math.abs(entry.anchor.offsetDelta) <= entry.anchor.tolerance
      && (entry.after.firstVisibleId === anchorId || clampedAtEnd(entry)) && entry.act?.savedStatus === 'resolved';
    results.b1 = entry.pass;
    console.log('[b1-final]', JSON.stringify({ pass: entry.pass, anchor: entry.anchor }));
  }

  // ── B2 ボード・対応済みの列 → 外から 1 件追加（先頭に入る）─────────────────
  {
    await scenario('b2-board-external-add', 'board:addressed', {
      prepare: async () => { await scrollTo('board:addressed', 'bottom'); },
      act: async () => {
        const review = await readReview();
        review.annotations.push(annotation(17, { sourceT: 0.1, text: '外から追加された注釈（ボード）' }));
        await writeReviewExternally(review);
        await waitFor('external card', `Boolean(document.querySelector('[data-board-card="a-0017"]'))`, 60000);
        return { added: 'a-0017' };
      },
      expectAnchor: () => ({ id: null, beforeOffset: null, afterOffset: null })
    });
    const entry = log[log.length - 1];
    const anchorId = entry.before.firstVisibleId;
    const afterOffset = await offsetOf('board:addressed', anchorId);
    entry.anchor = { id: anchorId, beforeOffset: entry.before.firstVisibleOffset, afterOffset,
      offsetDelta: afterOffset === null ? null : Math.round((afterOffset - entry.before.firstVisibleOffset) * 10) / 10,
      tolerance: entry.before.rowHeight };
    entry.pass = afterOffset !== null && Math.abs(entry.anchor.offsetDelta) <= entry.anchor.tolerance
      && (entry.after.firstVisibleId === anchorId || clampedAtEnd(entry));
    results.b2 = entry.pass;
    console.log('[b2-final]', JSON.stringify({ pass: entry.pass, anchor: entry.anchor }));
  }

  status = Object.values(results).every(Boolean) ? 'PASS' : 'FAIL';
} catch (error) {
  record('error', { message: error?.stack ?? String(error) });
} finally {
  main?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(2000);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  record('done', { status, results });
  const finalReview = await readReview();
  await writeFile(path.join(here, `run-log-${label}.json`), `${sanitize(JSON.stringify({
    label, status, results, log,
    finalReviewStatuses: finalReview?.annotations.map(a => ({ id: a.id, status: a.status }))
  }, null, 2))}\n`);
}
process.exit(status === 'PASS' ? 0 : 1);
