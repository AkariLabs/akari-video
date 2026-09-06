#!/usr/bin/env node
// トリガー狩り（契約 指示 4・上限 2 時間）。
// Codex webview の内側 frame で CSSStyleDeclaration の removeProperty / setProperty / cssText setter と
// documentElement の setAttribute / removeAttribute を「その frame 内だけ」ラップし、
// --vscode-* の削除・空文字設定が起きたら stack と時刻をホストページの window.__akariVarLog に積む。
// その状態で (a)〜(g) を順に実行し、各操作の後に N と画素を記録する。
//   node run-trigger-hunt.mjs --port 9762 --out <dir> --edit <edit.json> [--idle-min 30]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, findCodexWebview, iframeRect, decodePng, samplePanel, shot, runCommand,
  setTheme, shellExpr, themeServiceExpr, sleep, measure, sanitize, innerExpr as innerExprLocal, VIEW_W, VIEW_H
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const editPath = args.get('--edit');
const idleMin = Number(args.get('--idle-min') ?? 30);
// (c) の「左パネルへ移す」は Codex の webview を破棄し、以後どのコマンドでも復活しない
// （実測 = 本票の所見）。そのため (c) は別セッションで単独に回す。--steps で選ぶ。
const steps = (args.get('--steps') ?? 'abdefg').split('');
const suffix = args.get('--suffix') ?? '';
if (!out) throw new Error('usage: run-trigger-hunt.mjs --port <p> --out <dir> --edit <path> [--idle-min N]');
await mkdir(out, { recursive: true });
const jsonPath = path.join(out, `trigger-hunt${suffix}.json`);

const main = await connectMain(port);
let { target, view } = await findCodexWebview(port);
const rows = [];
const notes = [];
const started = Date.now();
const flush = async () => writeFile(jsonPath, JSON.stringify(sanitize({
  startedAt: new Date(started).toISOString(), steps: steps.join(''), idleMinutes: idleMin, rows, notes
}, [[out, '<evidence>']]), null, 2) + '\n');

const VAR_NAMES = innerExprLocal('return [...html.style].filter(p => p.startsWith("--vscode-"));');
let lastNames = null;

const INSTRUMENT = `(() => {
  window.__akariVarLog = window.__akariVarLog || [];
  window.__akariFrameLog = window.__akariFrameLog || [];
  if (!window.__akariFrameObserver) {
    window.__akariFrameObserver = new MutationObserver(list => {
      for (const m of list) {
        for (const n of m.addedNodes) if (n.tagName === 'IFRAME') window.__akariFrameLog.push({ t: Date.now(), op: 'frame-added', id: n.id });
        for (const n of m.removedNodes) if (n.tagName === 'IFRAME') window.__akariFrameLog.push({ t: Date.now(), op: 'frame-removed', id: n.id });
      }
    });
    window.__akariFrameObserver.observe(document.body, { childList: true });
  }
  const frames = [...document.querySelectorAll('iframe')];
  const f = document.getElementById('active-frame') || frames[frames.length - 1];
  if (!f || !f.contentWindow) return 'no-frame';
  const w = f.contentWindow;
  if (w.__akariVarPatched) return 'already';
  w.__akariVarPatched = true;
  const log = window.__akariVarLog;
  const rootStyle = () => w.document.documentElement.style;
  const P = w.CSSStyleDeclaration.prototype;
  const origRemove = P.removeProperty;
  P.removeProperty = function (prop) {
    try {
      if (typeof prop === 'string' && prop.startsWith('--vscode-') && this === rootStyle()) {
        log.push({ t: Date.now(), op: 'removeProperty', prop, stack: String(new w.Error().stack).slice(0, 1500) });
      }
    } catch (e) { /* noop */ }
    return origRemove.apply(this, arguments);
  };
  const origSet = P.setProperty;
  P.setProperty = function (prop, value) {
    try {
      if (typeof prop === 'string' && prop.startsWith('--vscode-') && (value === '' || value === null || value === undefined) && this === rootStyle()) {
        log.push({ t: Date.now(), op: 'setProperty-empty', prop, stack: String(new w.Error().stack).slice(0, 1500) });
      }
    } catch (e) { /* noop */ }
    return origSet.apply(this, arguments);
  };
  const desc = Object.getOwnPropertyDescriptor(P, 'cssText');
  Object.defineProperty(P, 'cssText', {
    configurable: true, enumerable: desc.enumerable, get: desc.get,
    set: function (value) {
      try {
        if (this === rootStyle()) {
          const text = String(value);
          log.push({ t: Date.now(), op: 'cssText', length: text.length, hasVscodeVars: text.includes('--vscode-'), stack: String(new w.Error().stack).slice(0, 1500) });
        }
      } catch (e) { /* noop */ }
      return desc.set.call(this, value);
    }
  });
  const E = w.Element.prototype;
  const origSetAttr = E.setAttribute;
  E.setAttribute = function (name, value) {
    try {
      if (name === 'style' && this === w.document.documentElement) {
        log.push({ t: Date.now(), op: 'setAttribute-style', length: String(value).length, hasVscodeVars: String(value).includes('--vscode-'), stack: String(new w.Error().stack).slice(0, 1500) });
      }
    } catch (e) { /* noop */ }
    return origSetAttr.apply(this, arguments);
  };
  const origRemoveAttr = E.removeAttribute;
  E.removeAttribute = function (name) {
    try {
      if (name === 'style' && this === w.document.documentElement) {
        log.push({ t: Date.now(), op: 'removeAttribute-style', stack: String(new w.Error().stack).slice(0, 1500) });
      }
    } catch (e) { /* noop */ }
    return origRemoveAttr.apply(this, arguments);
  };
  return 'installed';
})()`;

const reattach = async () => {
  try { await measure(view); return; } catch { /* ターゲットが消えている */ }
  try { view.close?.(); } catch { /* noop */ }
  ({ target, view } = await findCodexWebview(port, 60000));
};
const instrument = async () => { await reattach(); try { return await evalIn(view, INSTRUMENT); } catch (e) { return 'error: ' + String(e).slice(0, 120); } };
const drain = async () => {
  try {
    return await evalIn(view, `(() => { const v = window.__akariVarLog || []; const f = window.__akariFrameLog || []; window.__akariVarLog = []; window.__akariFrameLog = []; return { vars: v, frames: f }; })()`);
  } catch (e) { return { vars: [], frames: [], error: String(e).slice(0, 120) }; }
};

async function snapshot(id, extra = {}) {
  await reattach();
  // 画素を撮るには Codex パネルが見えている必要がある。意図的に隠す行（b1/b3）以外は、
  // 隠れていたら明示的に前面へ出してから撮る（隠れた状態は inside=null として正直に残す）。
  if (extra.allowReveal !== false) {
    const r0 = await iframeRect(main, target.url).catch(() => null);
    if (!r0 || r0.width <= 100) {
      await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
      await sleep(2000);
      await reattach();
    }
  }
  const inst = await instrument();
  const m = await measure(view).catch(() => null);
  let samples = null; let rect = null;
  try {
    rect = await iframeRect(main, target.url);
    if (rect && rect.width > 100) {
      const png = path.join(out, `hunt${suffix}-${id}.png`);
      await shot(main, png);
      samples = samplePanel(await decodePng(png), rect);
    }
  } catch (e) { notes.push({ id, screenshotError: String(e).slice(0, 160) }); }
  const names = await evalIn(view, VAR_NAMES).catch(() => null);
  // 変数名の増減を残す（実測: 起動直後は 627 個、テーマ往復後は 629 個 = 2 個足りない）。
  const varsAdded = names && lastNames ? names.filter(x => !lastNames.includes(x)) : null;
  const varsRemoved = names && lastNames ? lastNames.filter(x => !names.includes(x)) : null;
  const varNames = lastNames === null ? names : undefined;
  if (names) lastNames = names;
  const drained = await drain();
  const theme = await evalIn(main, `(() => { const C = ${themeServiceExpr}; return C ? window.theia.container.get(C).getCurrentTheme().id : null; })()`).catch(() => null);
  const row = {
    id, at: new Date().toISOString(), instrument: inst, theme, n: m?.n ?? null, varNames, varsAdded, varsRemoved,
    bodyBackgroundColor: m?.bodyBackgroundColor ?? null, themeKindBody: m?.themeKindBody ?? null,
    inside: samples ? samples.inside.map(p => p.rgb) : null,
    panel: samples ? samples.panel.map(p => p.rgb) : null,
    maxDeltaToPanel: samples ? samples.maxDeltaToPanel : null,
    varLog: drained.vars, frameLog: drained.frames, ...extra
  };
  rows.push(row);
  console.log(id, 'theme=' + row.theme, 'n=' + row.n, 'inside=' + JSON.stringify(row.inside), 'panel=' + JSON.stringify(row.panel), 'varLog=' + drained.vars.length, 'frameLog=' + drained.frames.length, 'added=' + JSON.stringify(varsAdded), 'removed=' + JSON.stringify(varsRemoved));
  await flush();
  return row;
}

// 1 手が転んでも行列全体を落とさない（失敗も 1 行として残す）。
async function safeSnapshot(id, extra = {}) {
  try { return await snapshot(id, extra); } catch (e) {
    const row = { id, at: new Date().toISOString(), error: String(e).slice(0, 300), n: null, inside: null, panel: null, ...extra };
    rows.push(row); console.log(id, 'ERROR', row.error); await flush();
    try {
      await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
      await sleep(3000);
      ({ target, view } = await findCodexWebview(port, 60000));
    } catch (e2) { notes.push({ id, recoveryError: String(e2).slice(0, 200) }); }
    return row;
  }
}

await instrument();
await safeSnapshot('baseline');

// テーマ切替は setCurrentTheme(persist=true) が preference ファイルへ非同期に書くため、
// 連続で呼ぶと後から届いた書き込みで巻き戻る（実測: dark 適用の 30 秒後に light へ戻った）。
// id が 5 秒間安定するまで待ってから次へ進む。
const currentTheme = () => evalIn(main, `(() => { const C = ${themeServiceExpr}; return C ? window.theia.container.get(C).getCurrentTheme().id : null; })()`);
async function setThemeStable(id) {
  await setTheme(main, id);
  let stable = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const cur = await currentTheme();
    if (cur === id) { stable++; if (stable >= 5) return { id: cur, settledAfterSec: i + 1 }; } else { stable = 0; }
  }
  return { id: await currentTheme(), settledAfterSec: null, warning: 'did not settle' };
}

// (a) テーマ dark → light → dark
if (steps.includes('a')) for (const theme of ['light', 'dark']) {
  const r = await setThemeStable(theme);
  notes.push({ step: `a-theme-${theme}`, themeSettle: r });
  await safeSnapshot(`a-theme-${theme}`, { themeSet: r });
}

// (b) Codex コンテナを閉じる → 開く / 右パネル折り畳み → 展開
if (steps.includes('b')) { const toggleId = 'plugin-view-container:workbench.view.extension.codexSecondaryViewContainer:toggle-visibility';
await runCommand(main, toggleId); await sleep(1500); await safeSnapshot('b1-container-closed', { allowReveal: false, note: 'Codex コンテナを閉じた直後（パネル非表示）' });
await runCommand(main, toggleId); await sleep(2000);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus'); await sleep(2000); await safeSnapshot('b2-container-reopened');
const panelOp = op => evalIn(main, `(() => {
  const C = ${shellExpr}; if (!C) return 'no-shell';
  try { window.theia.container.get(C).${op}('right'); return 'ok'; } catch (e) { return String(e).slice(0, 160); }
})()`);
await panelOp('collapsePanel'); await sleep(1500); await safeSnapshot('b3-right-collapsed', { allowReveal: false, note: '右パネル折り畳み中（パネル非表示）' });
await panelOp('expandPanel'); await sleep(2000);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus'); await sleep(2000); await safeSnapshot('b4-right-expanded'); }

// (c) Codex ビューを左パネルへ → 戻す
// addWidget は解決しないことがある（実測: 左パネルへの移動で await が返らない）。
// ページ内で 8 秒のタイムアウトを噛ませ、CDP の evaluate が固まらないようにする。
const moveTo = area => evalIn(main, `(async () => {
  const C = ${shellExpr}; if (!C) return 'no-shell';
  const shell = window.theia.container.get(C);
  const w = shell.widgets.find(x => /codex/iu.test(String(x.id)) || /codex/iu.test(String(x.title?.label ?? '')));
  if (!w) return 'no-widget';
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 8000));
  try {
    const r = await Promise.race([
      Promise.resolve(shell.addWidget(w, { area: ${JSON.stringify(area)} })).then(() => 'resolved'),
      timeout
    ]);
    try { shell.revealWidget(w.id); } catch (e) { /* noop */ }
    return r + ':' + w.id;
  } catch (e) { return 'error:' + String(e).slice(0, 160); }
})()`);
// 注意: 左パネルへ移すと widget が detach され webview の iframe ごと破棄される
// （WebviewWidget.onBeforeAttach が toDisposeOnDetach に forceHide を積む）。
// 移動後は必ず再表示して webview を作り直させてから撮る。
if (steps.includes('c')) {
const movedLeft = await moveTo('left');
await sleep(2000);
await runCommand(main, 'chatgpt.sidebarView.focus');
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
await sleep(3000);
await safeSnapshot('c1-moved-left', { move: movedLeft });
const back = await moveTo('right'); await sleep(2000);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus'); await sleep(3000);
await safeSnapshot('c2-moved-back', { move: back });
}

// (d) 新しいウィンドウを開く → 閉じる
if (steps.includes('d')) {
const newWindow = [];
for (const id of ['workbench.action.newWindow', 'electron.newWindow', 'core.newWindow']) {
  const r = await runCommand(main, id);
  newWindow.push({ id, ok: Boolean(r && r.ok), error: r && r.error });
  if (r && r.ok) break;
}
await sleep(3000); await safeSnapshot('d1-new-window', { newWindow });
// 追加で開いたウィンドウは CDP で閉じる（メインウィンドウを閉じるコマンドは絶対に使わない）。
const closed = [];
try {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  // 並び順は保証されないので、メインウィンドウの targetId を除いて閉じる
  //（実測: slice(1) だとメインを閉じてしまい CDP ごと落ちた）。
  const pages = list.filter(t => t.type === 'page' && t.id !== main.targetId);
  for (const t of pages) {
    await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
    closed.push(t.id);
  }
} catch (e) { closed.push('error:' + String(e).slice(0, 120)); }
await sleep(2000); await safeSnapshot('d2-window-closed', { closed });
}

// (e) 最小化 → 復帰 / 幅 600px ↔ 元
if (steps.includes('e')) {
let windowState = 'skipped';
try {
  const { windowId, bounds } = await main.send('Browser.getWindowForTarget');
  await main.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  await sleep(3000);
  await main.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await sleep(2500);
  windowState = 'minimized/restored ' + JSON.stringify(bounds);
} catch (e) { windowState = 'error:' + String(e).slice(0, 160); }
await main.send('Page.bringToFront');
await sleep(1500); await safeSnapshot('e1-minimize-restore', { windowState });
await main.send('Emulation.setDeviceMetricsOverride', { width: 600, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await sleep(2500); await safeSnapshot('e2-width-600');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await sleep(2500);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus'); await sleep(1500);
await safeSnapshot('e3-width-restored');
}

// (f) 出力プレビューを開いて 2 分再生・シーク
if (steps.includes('f') && editPath) {
  const uri = 'file://' + editPath;
  await runCommand(main, 'akari.preview.ensureVisible', { editUri: uri });
  await sleep(4000);
  await runCommand(main, 'akari.preview.togglePlayback', { editUri: uri });
  for (let i = 0; i < 8; i++) {
    await sleep(15000);
    await runCommand(main, 'akari.preview.seekOutput', { editUri: uri, time: 1 + i * 0.5 });
  }
  await runCommand(main, 'akari.preview.togglePlayback', { editUri: uri });
  await runCommand(main, 'chatgpt.sidebarSecondaryView.focus'); await sleep(2000);
  await safeSnapshot('f1-preview-playback');
}

// (g) 何もせず放置（既定 30 分・5 分ごとに記録）
if (steps.includes('g')) {
const idleSteps = Math.max(1, Math.round(idleMin / 5));
for (let i = 1; i <= idleSteps; i++) {
  await sleep(5 * 60 * 1000);
  await safeSnapshot(`g-idle-${i * 5}min`);
}
}

await flush();
console.log('written', jsonPath);
view.close?.(); main.close();
