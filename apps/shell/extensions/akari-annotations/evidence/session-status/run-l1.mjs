#!/usr/bin/env node
// L1: 録音セッションの状態可視化（task 2026-09-12-review-session-status-visibility）を実機で観測する。
// 由来 = evidence/recording-band/run-l1.mjs（同じ起動・後始末の流儀）。
//
// usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port>
//
// 観測の筋:
//   1. パネル: セッション行の状態バッジ（録音済み / 文字起こし済み / コンパイル済み）と recorded 行のヒント
//   2. ボード: 未コンパイル帯（N 件）・列名（未対応 / 対応済み / 確認済み）・s-XXXX 由来バッジ
//   3. 出力プレビューを閉じてもパネルの一覧が消えない（パネルの閉じ直しでも出る）
//   4. compile 相当（session.json を compiled 化 + review.json にチケット追加）で帯から消え、カードにバッジ
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, listTargets, evalOn } from '../../../akari-preview/evidence/preview-writeback-v2/scripts/cdp-lib.mjs';

const [shellDirArg, projectDirArg, evidenceDirArg, portArg] = process.argv.slice(2);
if (!shellDirArg || !projectDirArg || !evidenceDirArg || !portArg) {
  throw new Error('usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port>');
}
const port = Number(portArg);
const shellDir = await realpath(shellDirArg);
const projectDir = await realpath(projectDirArg);
// macOS の /tmp は symlink。realpath でない作業ディレクトリだと Theia の workspace 境界判定と
// URI が食い違う（recording-band / review-session-v2 evidence と同じ地雷）。
assert.equal(projectDir, path.resolve(projectDirArg),
  'project dir must be passed as a realpath');
const evidenceDir = path.resolve(evidenceDirArg);
await mkdir(evidenceDir, { recursive: true });

const userDataDir = path.join(path.dirname(projectDir), 'udd-session-status');
const akariHome = path.join(path.dirname(projectDir), 'akari-home-session-status');
await mkdir(userDataDir, { recursive: true });
await mkdir(akariHome, { recursive: true });

const editUri = pathToFileURL(path.join(projectDir, 'edit.json')).href;
const observations = [];
const record = (step, value) => {
  observations.push({ step, ...value });
  console.log(`[${step}] ${JSON.stringify(value)}`);
};

const waitFor = async (label, predicate, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`timed out: ${label}; last=${JSON.stringify(last)}`);
};

const electronBinary = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const child = spawn(electronBinary, [
  shellDir, projectDir,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-sandbox'
], {
  env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: userDataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => process.stdout.write(`[electron] ${chunk}`));
child.stderr.on('data', chunk => process.stderr.write(`[electron!] ${chunk}`));
record('electron-spawned', { pid: child.pid });

// 注釈パネル側の読み取り。タイムラインの録音帯（.akari-review-session-range）は同じ
// data-review-session を持つので除外する。
const READ_PANEL = `(() => {
  const panel = document.querySelector('.akari-review-panel-widget');
  if (!panel) return { mounted: false };
  const rows = [...panel.querySelectorAll('[data-review-session]')]
    .filter(node => !node.classList.contains('akari-review-session-range'));
  return {
    mounted: true,
    attached: panel.isConnected,
    headingHint: panel.querySelector('[data-review-sessions-hint]')?.textContent ?? null,
    emptyText: rows.length === 0
      ? (panel.querySelector('[data-review-session]') ? null : panel.textContent.includes('録音済みセッションはありません。'))
      : null,
    rows: rows.map(row => ({
      session: row.getAttribute('data-review-session'),
      badge: row.querySelector('[data-review-session-badge]')?.getAttribute('data-review-session-badge') ?? null,
      badgeLabel: row.querySelector('[data-review-session-badge]')?.textContent ?? null,
      hint: row.parentElement?.querySelector('[data-review-session-hint]')?.textContent ?? null
    }))
  };
})()`;

const READ_BOARD = `(() => {
  const board = document.querySelector('.akari-review-board-widget');
  if (!board) return { mounted: false };
  const band = board.querySelector('[data-board-sessions]');
  return {
    mounted: true,
    columns: [...board.querySelectorAll('[data-board-column]')].map(column => ({
      status: column.getAttribute('data-board-column'),
      title: column.querySelector('strong')?.textContent ?? null,
      count: column.querySelector('[data-board-column-count]')?.textContent ?? null
    })),
    band: band ? {
      display: getComputedStyle(band).display,
      heading: band.querySelector('[data-board-sessions-count]')?.textContent ?? null,
      count: band.querySelector('[data-board-sessions-count]')?.getAttribute('data-board-sessions-count') ?? null,
      rows: [...band.querySelectorAll('[data-board-session]')].map(row => ({
        session: row.getAttribute('data-board-session'),
        badge: row.querySelector('[data-board-session-badge]')?.getAttribute('data-board-session-badge') ?? null,
        compile: Boolean(row.querySelector('[data-board-session-compile]')),
        text: row.textContent
      }))
    } : null,
    cards: [...board.querySelectorAll('[data-board-card]')].map(card => ({
      id: card.getAttribute('data-board-card'),
      origin: card.querySelector('[data-board-session-origin]')?.getAttribute('data-board-session-origin') ?? null,
      originLabel: card.querySelector('[data-board-session-origin]')?.textContent ?? null
    }))
  };
})()`;

// 作業機の絶対パスがタイトルバー・タブに写るため、対象ウィジェットの矩形だけ切り出す。
const clipShot = async (cdp, selector, filePath) => {
  const rect = await evalOn(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  })()`);
  if (!rect || rect.width < 1 || rect.height < 1) {
    record('screenshot-skipped', { selector, rect });
    return false;
  }
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: false
  });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return true;
};

let main;
let failure;
try {
  const pageTarget = await waitFor('devtools target', async () => {
    const targets = await listTargets(port).catch(() => []);
    return targets.find(target => target.type === 'page') ?? false;
  }, 120_000);
  main = new CDP(pageTarget.webSocketDebuggerUrl);
  await main.connect(15_000);
  await main.send('Page.enable', {}, 15_000);
  await main.send('Runtime.enable', {}, 15_000);
  await waitFor('theia ready', () => evalOn(main, 'Boolean(window.theia && window.theia.container)'), 120_000);

  // production バンドルはクラス名が最小化されるため、ApplicationShell は prototype の
  // メソッド構成（duck typing）で引き当てる。
  await evalOn(main, `(() => {
    window.__akariShell = () => {
      const keys = [...window.theia.container._bindingDictionary._map.keys()];
      const shellClass = keys.find(key => typeof key === 'function'
        && typeof key.prototype?.getCurrentWidget === 'function'
        && typeof key.prototype?.addWidget === 'function'
        && typeof key.prototype?.activateWidget === 'function');
      if (!shellClass) throw new Error('ApplicationShell binding not found');
      return window.theia.container.get(shellClass);
    };
    return true;
  })()`);
  record('shell-resolved', await evalOn(main, '(() => { const s = window.__akariShell(); return { widgets: s.widgets.map(w => w.id).slice(0, 40) }; })()'));

  const runCommand = (id, argument) => evalOn(main, `(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function'
      && typeof key.prototype?.registerCommand === 'function');
    if (!commandClass) return false;
    await window.theia.container.get(commandClass).executeCommand(
      ${JSON.stringify(id)}${argument === undefined ? '' : `, ${JSON.stringify(argument)}`}
    );
    return true;
  })()`);
  const runCommandWhenReady = (id, argument) => waitFor(`command ${id}`,
    () => runCommand(id, argument).then(() => true).catch(() => false), 120_000);
  const tryCommand = async (id, argument, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = 'never attempted';
    while (Date.now() < deadline) {
      try {
        await runCommand(id, argument);
        record('command-ok', { id });
        return true;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await sleep(500);
    }
    record('command-failed', { id, error: String(last).slice(0, 300) });
    return false;
  };

  await tryCommand('akari.annotations.attachPassive');
  await runCommandWhenReady('akari.preview.ensureVisible', { editUri });
  await tryCommand('akari.review.open');
  await waitFor('timeline mounted', () => evalOn(main,
    "Boolean(document.querySelector('.akari-annotations-widget'))"), 120_000);

  // 1) パネルの状態バッジ
  const panelWithBadges = await waitFor('panel session rows', async () => {
    const state = await evalOn(main, READ_PANEL);
    return state.rows?.length ? state : false;
  }, 60_000);
  record('panel-badges', panelWithBadges);
  await clipShot(main, '.akari-review-panel-widget', path.join(evidenceDir, 'l1-01-panel-badges.png'));

  // 2) ボードの未コンパイル帯・列名・由来バッジ
  await tryCommand('akari.review.board.open');
  const boardInitial = await waitFor('board band', async () => {
    const state = await evalOn(main, READ_BOARD);
    return state.band?.rows?.length ? state : false;
  }, 60_000);
  record('board-initial', boardInitial);
  await clipShot(main, '.akari-review-board-widget', path.join(evidenceDir, 'l1-02-board-band.png'));

  // 3) 出力プレビューを閉じてもパネルの一覧が残る
  // WebviewWidget の widget.id は 'webview-...'。プレビューの正体は identifier.id なのでそちらで引く。
  const COUNT_PREVIEWS = `(() => {
    const shell = window.__akariShell();
    return shell.widgets
      .map(widget => widget.identifier?.id ?? widget.id)
      .filter(id => typeof id === 'string'
        && (id.startsWith('akari-output-preview-') || id.startsWith('akari-preview-')));
  })()`;
  record('previews-before-close', { ids: await evalOn(main, COUNT_PREVIEWS) });
  record('preview-closed', await evalOn(main, `(async () => {
    const shell = window.__akariShell();
    const widgets = shell.widgets.filter(widget => {
      const id = widget.identifier?.id ?? widget.id;
      return typeof id === 'string'
        && (id.startsWith('akari-output-preview-') || id.startsWith('akari-preview-'));
    });
    const ids = widgets.map(widget => widget.identifier?.id ?? widget.id);
    for (const widget of widgets) widget.close();
    return { closed: ids };
  })()`));
  const previewsGone = await waitFor('previews closed',
    async () => (await evalOn(main, COUNT_PREVIEWS)).length === 0 ? { ids: [] } : false, 30_000);
  record('previews-after-close', previewsGone);
  await sleep(2000);
  const panelAfterPreviewClose = await evalOn(main, READ_PANEL);
  record('panel-after-preview-close', panelAfterPreviewClose);
  await clipShot(main, '.akari-review-panel-widget',
    path.join(evidenceDir, 'l1-03-panel-after-preview-closed.png'));

  // プレビューを閉じたまま、パネルも閉じて開き直す（= attach 経路だけで一覧が出ることの確認）
  record('panel-toggled', await evalOn(main, `(async () => {
    const shell = window.__akariShell();
    const panel = shell.widgets.find(widget => widget.id === 'akari-review-panel-widget');
    if (panel) panel.close();
    return { closed: Boolean(panel) };
  })()`));
  await sleep(1200);
  record('panel-while-closed', await evalOn(main, READ_PANEL));
  await tryCommand('akari.review.open');
  const panelReopened = await waitFor('panel rows after reopen', async () => {
    const state = await evalOn(main, READ_PANEL);
    return state.rows?.length ? state : false;
  }, 60_000);
  record('panel-after-reopen', panelReopened);
  record('previews-at-reopen', { ids: await evalOn(main, COUNT_PREVIEWS) });
  await clipShot(main, '.akari-review-panel-widget',
    path.join(evidenceDir, 'l1-04-panel-after-panel-reopen.png'));

  // 4) compile 相当の着地（skills/compile-review-session と同じ書き方）を外から起こす
  const manifestPath = path.join(projectDir, 'review', 'sessions', 's-0003', 'session.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.status = 'compiled';
  manifest.compiledAnnotations = ['a-0003'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const reviewPath = path.join(projectDir, 'review.json');
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  review.annotations.push({
    id: 'a-0003', createdAt: '2026-09-12T10:00:00.000Z', src: null, sourceT: 12, sourceRange: null,
    timelineT: null, target: null, targetKind: null, region: null, strokes: null, refs: null,
    insertPosition: null, intent: null, text: 'ここのテロップを大きく', input: 'session',
    audio: 'review/sessions/s-0003/audio.wav', poses: null, status: 'open', response: null,
    transcript: 'ここのテロップもう少し大きくして',
    session: { id: 's-0003', recRange: [1, 4], confidence: 'high' }
  });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  record('compile-simulated', { session: 's-0003', annotation: 'a-0003' });

  const boardAfterCompile = await waitFor('board after compile', async () => {
    const state = await evalOn(main, READ_BOARD);
    const gone = !state.band?.rows?.some(row => row.session === 's-0003');
    const badged = state.cards?.some(card => card.id === 'a-0003' && card.origin === 's-0003');
    return gone && badged ? state : false;
  }, 60_000);
  record('board-after-compile', boardAfterCompile);
  await clipShot(main, '.akari-review-board-widget',
    path.join(evidenceDir, 'l1-05-board-after-compile.png'));

  await tryCommand('akari.review.open');
  await sleep(1500);
  record('panel-after-compile', await evalOn(main, READ_PANEL));

  // 5) 帯の「コンパイル」ボタン = パネルと同じ定型文コピー（裁定 A: フォーカスを飛ばさない）
  await tryCommand('akari.review.board.open');
  await sleep(800);
  // clipboard.readText は「Document is not focused」で落ちるのでウィンドウを前面に出してから読む。
  await main.send('Page.bringToFront', {}, 10_000).catch(() => undefined);
  await evalOn(main, 'window.focus(); document.body.click(); true').catch(() => undefined);
  await sleep(400);
  record('compile-button-click', await evalOn(main, `(async () => {
    const button = document.querySelector('[data-board-session-compile="s-0001"]');
    if (!button) return { clicked: false };
    const before = document.activeElement?.className ?? null;
    button.click();
    await new Promise(resolve => setTimeout(resolve, 1200));
    let clipboard = null;
    let clipboardError = null;
    try { clipboard = await navigator.clipboard.readText(); }
    catch (error) { clipboardError = String(error && error.message ? error.message : error); }
    const board = document.querySelector('.akari-review-board-widget');
    return {
      clicked: true,
      clipboard,
      clipboardError,
      notice: board.querySelector('[data-board-notice]')?.textContent ?? null,
      toast: [...document.querySelectorAll('.theia-notification-message, .theia-notification-message span')]
        .map(node => node.textContent).filter(Boolean).slice(0, 3),
      partnerWidgetFocused: Boolean(document.activeElement?.closest?.('[id*="partner"]')),
      activeBefore: before,
      activeAfter: document.activeElement?.className ?? null
    };
  })()`));
  await clipShot(main, '.akari-review-board-widget',
    path.join(evidenceDir, 'l1-06-board-compile-clicked.png'));
} catch (error) {
  failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  record('failure', { message: failure.split('\n')[0] });
} finally {
  try { main?.close(); } catch { /* ignore */ }
  if (child.pid !== undefined && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(2500);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  // 証跡に作業機の絶対パスを残さない（harness/wrapper-codex.md 2026-09-09 追記）。
  const scrub = text => text
    .split(path.resolve(shellDir, '../..')).join('<WORKTREE>')
    .split(path.dirname(projectDir)).join('<TMP>')
    .split(process.env.HOME ?? '<HOME>').join('<HOME>');
  await writeFile(
    path.join(evidenceDir, 'l1-observations.json'),
    `${scrub(JSON.stringify({ observations, failed: Boolean(failure) }, null, 2))}\n`
  );
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
