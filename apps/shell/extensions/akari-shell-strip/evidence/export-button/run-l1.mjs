// export-button L1 実機検証ドライバ。cdp-lib.mjs は card-ask-agent (f740707) /
// left-panel-domain-browser (35bbc88) と同じ共有ヘルパー（様式踏襲・中身無改変）。
//
// パートナー端末バッファへの到達確認（L1-1）だけは、実 claude/codex CLI の
// ネットワーク越しブートストラップを避けるため、AkariMenuWidget（本タスクが
// 所有する akari-shell-strip 側のファイル）の postConstruct に一時デバッグフック
// `globalThis.__akariShellStripMenuWidgetDebug = this` を追加し、そこから
// 「このウィジェット自身が注入済みの WidgetManager」経由で
// `widgetManager.getOrCreateWidget('akari-partner-onboarding')`
// （本ファイルの HOME_WIDGET_ID 参照と同じ、既存の「文字列 id だけ知っている」
// パターン）で実行中の AkariPartnerWidget シングルトンを取得し、
// `terminalService.newTerminal()` + `attachTerminal()`（begin() の成功パスが
// 呼ぶのと同じ本番コードそのもの）でダミーの echo CLI を接続した。
// akari-partner 側のファイルは一切編集していない（境界順守）。
// フックは証跡取得後に完全に削除してから最終コミットし、フック不在の
// 最終ビルドに対して final-smoke.mjs で L1-2/3/4/5 を再実測した
// （card-ask-agent と同じ手順）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, workspaceDirArg, dummyCliArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const WS = workspaceDirArg;
const DUMMY_CLI = dummyCliArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function clickMenuIcon(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (state.found) { await realClick(cdp, state.x, state.y); await sleep(500); }
  return state;
}

async function exportButtonState(cdp) {
  return evalMain(cdp, `(() => {
    const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
    return target ? { found: true, disabled: target.disabled, title: target.title } : { found: false };
  })()`);
}

async function clickExportButton(cdp) {
  const btn = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
    if (!el || el.disabled) return { found: false, disabled: el ? el.disabled : null };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!btn.found) fail('export button not clickable', btn);
  await realClick(cdp, btn.x, btn.y);
  await sleep(500);
}

// Monaco/Theia の quick-input はステップ間（解像度→ファイル名→lint）で
// DOM を差し替える際に一瞬前のステップの行が残っている場合があるため、
// クリック前に「入力欄が表示中 かつ 目的の行が可視（width>0）」を確認してから
// クリックし、直後に quick-input が閉じる/次のプレースホルダへ遷移したことまで
// 確認する（前ステップの残骸行を誤クリックするレースを防ぐ）。
async function clickQuickPickRow(cdp, text) {
  let clicked = false;
  for (let attempt = 0; attempt < 25 && !clicked; attempt++) {
    const row = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return { found: false };
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(text)});
      if (!row) return { found: false };
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { found: false };
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (row.found) {
      await realClick(cdp, row.x, row.y);
      clicked = true;
      break;
    }
    await sleep(200);
  }
  if (!clicked) fail('quick pick row not found/visible', { text });
  // クリック後、行が実際に消える（次ステップへ遷移 or 閉じる）まで待つ。
  for (let attempt = 0; attempt < 25; attempt++) {
    const stillThere = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return false;
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      return rows.some(r => r.textContent.trim() === ${JSON.stringify(text)} && r.getBoundingClientRect().width > 0);
    })()`);
    if (!stillThere) { await sleep(300); return; }
    await sleep(200);
  }
  fail('quick pick did not advance after clicking row', { text });
}

async function waitForQuickInputPlaceholder(cdp, placeholder) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const state = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      const input = widget ? widget.querySelector('input') : null;
      const visible = !!widget && getComputedStyle(widget).display !== 'none';
      return { visible, placeholder: input ? input.placeholder : null };
    })()`);
    if (state.visible && state.placeholder === placeholder) return;
    await sleep(200);
  }
  fail('quick input did not reach expected placeholder', { placeholder });
}

// クリックで入力欄へ明示的にフォーカスしてから Enter を送る。ステップ遷移
// 直後は input 要素が生成されてもまだ実フォーカスが乗っていない一瞬があり、
// その隙に Enter を送るとどこにもヒットせず quick-input が閉じる（cancel 扱い）
// レースを何度か実測したため、フォーカスを明示的に取ってから確実に送る。
async function focusQuickInput(cdp) {
  const rect = await evalMain(cdp, `(() => {
    const input = document.querySelector('.quick-input-widget input');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (rect) {
    await realClick(cdp, rect.x, rect.y);
    await sleep(150);
  }
}

async function pressEnter(cdp) {
  await focusQuickInput(cdp);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
  await sleep(500);
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
  await sleep(400);
}

async function toastMessages(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
}

async function exportSectionText(cdp) {
  return evalMain(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '書き出し');
    const s = b ? b.closest('section') : null;
    return s ? s.textContent.trim() : null;
  })()`);
}

async function readPartnerTerminalBuffer(cdp) {
  return evalMain(cdp, `(async () => {
    const menuDebug = window.__akariShellStripMenuWidgetDebug;
    const widget = await menuDebug.widgetManager.getOrCreateWidget('akari-partner-onboarding');
    const buf = widget.terminal.term.buffer.active;
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      out += line.isWrapped ? text : ('\\n' + text);
    }
    return out;
  })()`);
}

async function installErrorCounter(cdp) {
  await evalMain(cdp, `(() => {
    window.__errCount = 0;
    window.__errLog = [];
    const orig = console.error;
    console.error = (...args) => { window.__errCount++; window.__errLog.push(String(args[0]).slice(0, 300)); orig(...args); };
    window.addEventListener('error', (e) => { window.__errCount++; window.__errLog.push('window.error: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', (e) => { window.__errCount++; window.__errLog.push('unhandledrejection: ' + String(e.reason).slice(0, 300)); });
    return true;
  })()`);
}

async function errorLog(cdp) {
  return evalMain(cdp, 'window.__errLog || []');
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1500);
  await installErrorCounter(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  // === L1-2: edit.json 無し → ボタン disabled + ツールチップ ===
  await clickMenuIcon(cdp);
  const disabledState = await exportButtonState(cdp);
  record('l1-2-disabled-state', disabledState);
  const expectedTooltip = 'edit.json がまだありません。編集を進めてから書き出してください。';
  if (!disabledState.found || !disabledState.disabled || disabledState.title !== expectedTooltip) {
    fail('export button was not disabled with the expected tooltip when edit.json is absent', disabledState);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-editjson-absent-disabled.png'));
  record('L1-2-PASS', { ok: true });

  // === regression (part of L1-5): existing "ひらく" actions + skills notice unaffected ===
  const menuRegressionBefore = await evalMain(cdp, `(() => {
    const labels = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
    return {
      hasTimeline: labels.includes('タイムライン'), hasTranscript: labels.includes('文字起こし'),
      hasHome: labels.includes('ホーム'), hasShowChanges: labels.includes('変更を見る'),
      hasSkillsNotice: document.body.textContent.includes('このプロジェクトにはスキルがまだありません')
    };
  })()`);
  record('regression-menu-actions-before', menuRegressionBefore);
  if (!menuRegressionBefore.hasTimeline || !menuRegressionBefore.hasTranscript || !menuRegressionBefore.hasHome || !menuRegressionBefore.hasShowChanges || !menuRegressionBefore.hasSkillsNotice) {
    fail('existing menu actions/skills notice regressed', menuRegressionBefore);
  }

  // edit.json を実行時に作成 -> reactive に有効化されることを確認
  await writeFile(path.join(WS, 'edit.json'), JSON.stringify({ version: 1, source: { path: 'assets/placeholder.mp4' }, cuts: [], overlays: [], audio: { bgm: [], sfx: [], narration: [] } }, null, 2));
  let enabledState;
  for (let attempt = 0; attempt < 15; attempt++) {
    enabledState = await exportButtonState(cdp);
    if (enabledState.found && !enabledState.disabled) break;
    await sleep(400);
  }
  record('edit-json-created-reactive-enable', enabledState);
  if (!enabledState.found || enabledState.disabled) fail('export button did not become enabled after edit.json was created', enabledState);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-editjson-present-enabled.png'));

  // === L1-3: パートナー未接続 → クリック~確定でトースト + 注入なし ===
  const toastsBefore3 = (await toastMessages(cdp)).length;
  await clickExportButton(cdp);
  await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-quickpick-resolution.png'));
  await clickQuickPickRow(cdp, '1080p 横');
  await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-quickpick-filename.png'));
  await pressEnter(cdp); // keep default filename
  await waitForQuickInputPlaceholder(cdp, 'lint を先に再実行しますか');
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-quickpick-lint.png'));
  await clickQuickPickRow(cdp, 'lint を先に再実行する（既定）');
  await sleep(800);
  const toastsAfter3 = await toastMessages(cdp);
  record('l1-3-not-connected-toast', { toastsBefore3, toastsAfter3 });
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (toastsAfter3.length <= toastsBefore3 || !toastsAfter3.includes(expectedToast)) {
    fail('expected not-connected toast missing/short', { toastsAfter3, expectedToast });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-not-connected-toast.png'));
  record('L1-3-PASS', { ok: true });

  // === cancel: 途中で Escape → 何も起きない（no-op） ===
  const toastsBeforeCancel = (await toastMessages(cdp)).length;
  await clickExportButton(cdp);
  await pressEscape(cdp);
  const qiClosed = await evalMain(cdp, `(() => { const w = document.querySelector('.quick-input-widget'); return !w || getComputedStyle(w).display === 'none'; })()`);
  const toastsAfterCancel = await toastMessages(cdp);
  record('cancel-no-op', { toastsBeforeCancel, toastsAfterCancelCount: toastsAfterCancel.length, qiClosed });
  if (toastsAfterCancel.length !== toastsBeforeCancel) fail('cancel produced an unexpected toast', { toastsBeforeCancel, toastsAfterCancel });
  if (!qiClosed) fail('quick-input did not close after Escape', { qiClosed });
  record('cancel-PASS', { ok: true });

  // === attach a dummy partner terminal via the temporary debug hook (see file header) ===
  const attach = await evalMain(cdp, `(async () => {
    const menuDebug = window.__akariShellStripMenuWidgetDebug;
    if (!menuDebug) return { ok: false, reason: 'no-debug-hook' };
    const widget = await menuDebug.widgetManager.getOrCreateWidget('akari-partner-onboarding');
    if (!widget) return { ok: false, reason: 'partner-widget-not-found' };
    const roots = await widget.workspaceService.roots;
    const cwd = roots[0]?.resource.toString();
    const terminal = await widget.terminalService.newTerminal({
      title: 'dummy-partner-cli', shellPath: '/bin/bash', shellArgs: [${JSON.stringify(DUMMY_CLI)}], cwd,
      kind: 'akari-partner', attributes: { 'akari.partner': 'dummy' }, destroyTermOnClose: false, useServerTitle: false
    });
    await terminal.start();
    await widget.shell.addWidget(terminal, { area: 'right', rank: 50 });
    await widget.attachTerminal(terminal, 'Dummy CLI');
    return { ok: true };
  })()`, 20000);
  record('dummy-partner-terminal-attached', attach);
  if (!attach.ok) fail('failed to attach dummy partner terminal via debug hook', attach);
  await sleep(800);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-partner-connected.png'));

  // === L1-1a: 既定値のまま確定 → 端末バッファに文脈パケット全文（実クリック+実キー入力） ===
  await clickExportButton(cdp);
  await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
  await clickQuickPickRow(cdp, '1080p 横');
  await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
  await pressEnter(cdp);
  await waitForQuickInputPlaceholder(cdp, 'lint を先に再実行しますか');
  await clickQuickPickRow(cdp, 'lint を先に再実行する（既定）');
  await sleep(900);
  const buffer1 = await readPartnerTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '08-injection-defaults.png'));
  const expected1 = '【書き出し依頼】edit.json を render-cut スキルで書き出してください。設定: 解像度 1080p 横・出力名 final.mp4・lint 再実行 する。ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。進捗を .akari/render.json に随時書き込みながら進めてください';
  record('l1-1a-defaults-injection', { containsExpected: buffer1.includes(expected1) });
  if (!buffer1.includes(expected1)) fail('default-values packet did not appear verbatim in the terminal buffer', { buffer1, expected1 });
  record('L1-1a-PASS', { ok: true });

  // === L1-1b: カスタム値（別解像度・別出力名・lint再実行しない） ===
  await clickExportButton(cdp);
  await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
  await clickQuickPickRow(cdp, '正方形');
  await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
  await evalMain(cdp, `(() => { document.querySelector('.quick-input-widget input').select(); })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace' });
  await sleep(150);
  await cdp.send('Input.insertText', { text: 'my-square-export.mp4' });
  await sleep(200);
  await pressEnter(cdp);
  await waitForQuickInputPlaceholder(cdp, 'lint を先に再実行しますか');
  await clickQuickPickRow(cdp, 'lint を再実行しない');
  await sleep(900);
  const buffer2 = await readPartnerTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '09-injection-custom.png'));
  const expected2 = '【書き出し依頼】edit.json を render-cut スキルで書き出してください。設定: 解像度 正方形・出力名 my-square-export.mp4・lint 再実行 しない。ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。進捗を .akari/render.json に随時書き込みながら進めてください';
  record('l1-1b-custom-injection', { containsExpected: buffer2.includes(expected2) });
  if (!buffer2.includes(expected2)) fail('custom-values packet did not appear verbatim in the terminal buffer', { buffer2, expected2 });
  record('L1-1b-PASS', { ok: true });

  // === L1-4: render.json 段階的書き換え（開始→50%→完了→失敗→壊れたJSON→未知形→削除） ===
  // 直前までの dummy 端末アタッチ（xterm.js 側の既知の resize 整数丸め挙動、
  // render-progress.ts とは無関係）由来のノイズを切り分けるため、このスイープ
  // 開始直前の errCount をベースラインとして差分でゼロを検証する
  // （task.md の該当要求は「壊れたJSON/未知形フォールバックで例外なし」の
  // 範囲であり、render.json 処理コード自身がエラーを出さないことが本旨）。
  const renderSweepBaselineErrCount = await evalMain(cdp, 'window.__errCount');
  const renderJsonPath = path.join(WS, '.akari', 'render.json');

  await writeFile(renderJsonPath, JSON.stringify({ version: 1, phase: 'planning' }));
  await sleep(900);
  let sec = await exportSectionText(cdp);
  record('l1-4-start', { sec, errCount: await evalMain(cdp, 'window.__errCount') });
  if (!sec.includes('planning') || !sec.includes('15%')) fail('start stage rendering unexpected', { sec });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '10-render-start.png'));

  await writeFile(renderJsonPath, JSON.stringify({ version: 1, phase: 'rendering' }));
  await sleep(900);
  sec = await exportSectionText(cdp);
  record('l1-4-50pct', { sec, errCount: await evalMain(cdp, 'window.__errCount') });
  if (!sec.includes('rendering') || !sec.includes('50%')) fail('50pct stage rendering unexpected', { sec });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '11-render-50pct.png'));

  await writeFile(renderJsonPath, JSON.stringify({
    version: 1, phase: 'verified',
    artifacts: [{ path: 'exports/final.mp4', sha256: 'dummy', ffprobe: { duration_seconds: 2.0, width: 320, height: 240 } }],
    verify: { verdict: 'pass', findings: [{ severity: 'info', check: 'verify.duration', message: 'ok' }] }
  }));
  await sleep(900);
  sec = await exportSectionText(cdp);
  record('l1-4-done', { sec, errCount: await evalMain(cdp, 'window.__errCount') });
  if (!sec.includes('完了') || !sec.includes('exports/final.mp4')) fail('done stage rendering unexpected', { sec });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '12-render-done.png'));

  // 成果物リンクが機能する（クリックで実際に開く）
  const openBtn = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('成果物を開く'));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!openBtn.found) fail('open-artifact button not found in done state', openBtn);
  await realClick(cdp, openBtn.x, openBtn.y);
  await sleep(1200);
  const openedTabTitle = await evalMain(cdp, `(() => {
    const labels = Array.from(document.querySelectorAll('.lm-TabBar-tabLabel')).map(e => e.textContent.trim());
    return labels.some(t => t === 'final.mp4');
  })()`);
  record('artifact-link-opened', { openedTabTitle });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '13-artifact-opened.png'));
  if (!openedTabTitle) fail('exported artifact did not appear to open (no tab titled final.mp4 found)', { openedTabTitle });
  record('artifact-link-PASS', { ok: true });

  await writeFile(renderJsonPath, JSON.stringify({
    version: 1, phase: 'failed',
    verify: { verdict: 'fail', findings: [{ severity: 'error', check: 'verify.duration', message: 'duration mismatch: 12.0s vs expected 10.0s' }] }
  }));
  await sleep(900);
  sec = await exportSectionText(cdp);
  record('l1-4-failed', { sec, errCount: await evalMain(cdp, 'window.__errCount') });
  if (!sec.includes('書き出しに失敗しました')) fail('failed stage rendering unexpected', { sec });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '14-render-failed.png'));

  await writeFile(renderJsonPath, '{ broken json ,,,');
  await sleep(900);
  sec = await exportSectionText(cdp);
  record('l1-4-broken-json', { sec, errCount: await evalMain(cdp, 'window.__errCount') });
  if (!sec.includes('進捗不明')) fail('broken JSON did not fall back as expected', { sec });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '15-render-broken-fallback.png'));

  await writeFile(renderJsonPath, JSON.stringify({ someOtherTool: true, nested: { a: 1 } }));
  await sleep(900);
  sec = await exportSectionText(cdp);
  const errCountAfterUnknown = await evalMain(cdp, 'window.__errCount');
  const renderSweepErrorDelta = errCountAfterUnknown - renderSweepBaselineErrCount;
  record('l1-4-unknown-shape', { sec, errCount: errCountAfterUnknown, renderSweepBaselineErrCount, renderSweepErrorDelta });
  if (!sec.includes('進捗不明')) fail('unknown shape did not fall back as expected', { sec });
  if (renderSweepErrorDelta !== 0) fail('render.json fallback sweep introduced new console errors', { renderSweepBaselineErrCount, errCountAfterUnknown, errLog: await errorLog(cdp) });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '16-render-unknown-shape-fallback.png'));
  record('L1-4-PASS', { ok: true, renderSweepErrorDelta });

  await unlink(renderJsonPath);
  await sleep(900);
  sec = await exportSectionText(cdp);
  record('render-json-deleted-hides-section', { sec });
  if (sec !== '書き出し書き出し') fail('progress section did not hide after render.json was deleted', { sec });

  // === L1-5 regression (再確認): 素材タブが無退行 ===
  const filesIcon = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (filesIcon.found) { await realClick(cdp, filesIcon.x, filesIcon.y); await sleep(700); }
  const dzFound = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-dropzone]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`);
  record('regression-materials-tab', { dzFound });
  if (!dzFound) fail('materials tab regressed', { dzFound });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '17-regression-materials-tab.png'));
  record('L1-5-PASS', { ok: true });

  // 参考記録: セッション全体の console error 数（dummy 端末アタッチに使う
  // xterm.js 側の resize 整数丸め挙動 — L1-1 証跡取得専用の debug hook 経路
  // でのみ踏む、render-progress.ts とは無関係な既知ノイズ — を含みうるため
  // ここではハード fail の条件にはしない。render.json フォールバックの
  // 「例外なし」要求は renderSweepErrorDelta で厳密に検証済み）。
  const finalErrCount = await evalMain(cdp, 'window.__errCount');
  const finalErrLog = await errorLog(cdp);
  record('ALL-PASS', { ok: true, finalConsoleErrorCount: finalErrCount, finalErrLog, renderSweepErrorDelta });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: all L1 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
