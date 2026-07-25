// シナリオD: 「エージェントに任せる」= 現行パケット注入の無退行確認
// （export-button の run-l1.mjs と同じ手法 — 一時デバッグフックでダミー
// パートナー端末を接続し、文脈パケット全文の到達を実測）+ edit.json 有無ゲート・
// 未接続トースト・キャンセル no-op・既存メニュー/素材タブの回帰を併せて確認する。
import { writeFile, unlink } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { evalMain, realClick, screenshot } from './cdp-lib.mjs';
import { launchElectron, killElectronTree, assertNoOrphans, sleep } from './launch.mjs';
import {
    clickMenuIcon, exportButtonState, toastMessages, installErrorCounter, errorLog,
    waitForQuickInputPlaceholder, clickQuickPickRow, pressEnter, pressEscape,
    connectAndWaitReady, confirmFilenameAndWait
} from './scenario-helpers.mjs';

const CDP_PORT = 29904;
const WORKSPACE = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/fixtures/ws-agent';
const USER_DATA_DIR = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/user-data/scenario-d-' + CDP_PORT;
const EVIDENCE_DIR = '/Users/ryoma/_edit/30_products/akari-video-wt/quick-export/apps/shell/extensions/akari-shell-strip/evidence/quick-export';
const DUMMY_CLI = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/dummy-partner-cli.sh';
const EDIT_JSON_PATH = path.join(WORKSPACE, 'edit.json');
const EDIT_JSON_BACKUP_PATH = path.join(WORKSPACE, '.edit.json.bak');

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function clickExportButtonRaw(cdp) {
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

async function readPartnerTerminalBuffer(cdp) {
    return evalMain(cdp, `(async () => {
    const menuDebug = window.__akariMenuWidgetDebug;
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

async function main() {
    execSync(`rm -rf "${WORKSPACE}/exports" "${WORKSPACE}/.akari/render.json" "${WORKSPACE}/.akari/reports" "${WORKSPACE}/.akari/render-tmp" "${WORKSPACE}/.akari/lint.json"`);
    execSync(`mkdir -p "${WORKSPACE}/exports" "${WORKSPACE}/.akari/reports"`);
    execSync(`touch "${WORKSPACE}/exports/.gitkeep" "${WORKSPACE}/.akari/reports/.gitkeep"`);
    // edit.json 無し状態からスタート（L1-2 の disabled 確認のため一時退避）
    await import('node:fs/promises').then(fs => fs.rename(EDIT_JSON_PATH, EDIT_JSON_BACKUP_PATH));

    const child = launchElectron({ workspaceDir: WORKSPACE, cdpPort: CDP_PORT, userDataDir: USER_DATA_DIR, logPath: path.join(EVIDENCE_DIR, 'scenario-d-electron.log') });
    record('electron-spawned', { pid: child.pid });
    try {
        const cdp = await connectAndWaitReady(CDP_PORT);
        record('connected-and-ready', {});
        await sleep(500);
        await installErrorCounter(cdp);
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-00-boot.png'));

        await clickMenuIcon(cdp);
        const disabledState = await exportButtonState(cdp);
        record('editjson-absent-disabled', disabledState);
        const expectedTooltip = 'edit.json がまだありません。編集を進めてから書き出してください。';
        if (!disabledState.found || !disabledState.disabled || disabledState.title !== expectedTooltip) {
            fail('export button should be disabled with expected tooltip when edit.json is absent', disabledState);
        }
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-01-editjson-absent-disabled.png'));

        // regression: 既存メニュー項目・スキル通知
        const menuRegressionBefore = await evalMain(cdp, `(() => {
      const labels = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      return {
        hasTimeline: labels.includes('タイムライン'), hasTranscript: labels.includes('文字起こし'),
        hasHome: labels.includes('ホーム'), hasShowChanges: labels.includes('変更を見る'),
        hasSkillsNotice: document.body.textContent.includes('このプロジェクトにはスキルがまだありません')
      };
    })()`);
        record('regression-menu-before', menuRegressionBefore);
        if (!menuRegressionBefore.hasTimeline || !menuRegressionBefore.hasTranscript || !menuRegressionBefore.hasHome || !menuRegressionBefore.hasShowChanges) {
            fail('existing menu actions regressed', menuRegressionBefore);
        }

        // edit.json 復元 → reactive に有効化
        await import('node:fs/promises').then(fs => fs.rename(EDIT_JSON_BACKUP_PATH, EDIT_JSON_PATH));
        let enabledState;
        for (let attempt = 0; attempt < 15; attempt++) {
            enabledState = await exportButtonState(cdp);
            if (enabledState.found && !enabledState.disabled) break;
            await sleep(400);
        }
        record('editjson-created-reactive-enable', enabledState);
        if (!enabledState.found || enabledState.disabled) fail('export button did not become enabled after edit.json was created', enabledState);
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-02-editjson-present-enabled.png'));

        // === 未接続 → quick-pick 4連鎖の最後で「エージェントに任せる」→ トースト + 注入なし ===
        const toastsBefore = (await toastMessages(cdp)).length;
        await clickExportButtonRaw(cdp);
        await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
        await clickQuickPickRow(cdp, '1080p 横');
        await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
        await confirmFilenameAndWait(cdp, 'lint を先に再実行しますか');
        await clickQuickPickRow(cdp, 'lint を先に再実行する（既定）');
        await waitForQuickInputPlaceholder(cdp, '実行方法を選択');
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-03-execution-method-quickpick.png'));
        await clickQuickPickRow(cdp, 'エージェントに任せる');
        await sleep(800);
        const toastsAfter = await toastMessages(cdp);
        record('not-connected-toast', { toastsBefore, toastsAfter });
        const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
        if (toastsAfter.length <= toastsBefore || !toastsAfter.includes(expectedToast)) {
            fail('expected not-connected toast missing', { toastsAfter, expectedToast });
        }
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-04-not-connected-toast.png'));

        // 直接実行パスが誤って動いていないこと（ボタンが disabled のまま固着しない・ローカル状態パネルが出ない）
        const afterToastButtonState = await exportButtonState(cdp);
        record('button-not-stuck-after-agent-path', afterToastButtonState);
        if (!afterToastButtonState.found || afterToastButtonState.disabled) fail('button should not be disabled after choosing agent path', afterToastButtonState);

        // === cancel: 途中で Escape → no-op ===
        const toastsBeforeCancel = (await toastMessages(cdp)).length;
        await clickExportButtonRaw(cdp);
        await pressEscape(cdp);
        const qiClosed = await evalMain(cdp, `(() => { const w = document.querySelector('.quick-input-widget'); return !w || getComputedStyle(w).display === 'none'; })()`);
        const toastsAfterCancel = await toastMessages(cdp);
        record('cancel-no-op', { toastsBeforeCancel, toastsAfterCancelCount: toastsAfterCancel.length, qiClosed });
        if (toastsAfterCancel.length !== toastsBeforeCancel) fail('cancel produced an unexpected toast', { toastsBeforeCancel, toastsAfterCancel });
        if (!qiClosed) fail('quick-input did not close after Escape', { qiClosed });

        // === dummy partner terminal attach（一時デバッグフック経由） ===
        const attach = await evalMain(cdp, `(async () => {
      const menuDebug = window.__akariMenuWidgetDebug;
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
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-05-partner-connected.png'));

        // === 既定値のまま確定 → 端末バッファに文脈パケット全文 ===
        await clickExportButtonRaw(cdp);
        await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
        await clickQuickPickRow(cdp, '1080p 横');
        await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
        await confirmFilenameAndWait(cdp, 'lint を先に再実行しますか');
        await clickQuickPickRow(cdp, 'lint を先に再実行する（既定）');
        await waitForQuickInputPlaceholder(cdp, '実行方法を選択');
        await clickQuickPickRow(cdp, 'エージェントに任せる');
        await sleep(900);
        const buffer1 = await readPartnerTerminalBuffer(cdp);
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-06-injection-defaults.png'));
        const expected1 = '【書き出し依頼】edit.json を render-cut スキルで書き出してください。設定: 解像度 1080p 横・出力名 final.mp4・lint 再実行 する。ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。進捗を .akari/render.json に随時書き込みながら進めてください';
        record('defaults-injection', { containsExpected: buffer1.includes(expected1) });
        if (!buffer1.includes(expected1)) fail('default-values packet did not appear verbatim in the terminal buffer', { buffer1, expected1 });

        // === カスタム値（別解像度・別出力名・lint再実行しない） ===
        await clickExportButtonRaw(cdp);
        await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
        await clickQuickPickRow(cdp, '正方形');
        await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
        await evalMain(cdp, `(() => { document.querySelector('.quick-input-widget input').select(); })()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace' });
        await sleep(150);
        await cdp.send('Input.insertText', { text: 'my-square-export.mp4' });
        await sleep(200);
        await confirmFilenameAndWait(cdp, 'lint を先に再実行しますか');
        await clickQuickPickRow(cdp, 'lint を再実行しない');
        await waitForQuickInputPlaceholder(cdp, '実行方法を選択');
        await clickQuickPickRow(cdp, 'エージェントに任せる');
        await sleep(900);
        const buffer2 = await readPartnerTerminalBuffer(cdp);
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-07-injection-custom.png'));
        const expected2 = '【書き出し依頼】edit.json を render-cut スキルで書き出してください。設定: 解像度 正方形・出力名 my-square-export.mp4・lint 再実行 しない。ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。進捗を .akari/render.json に随時書き込みながら進めてください';
        record('custom-injection', { containsExpected: buffer2.includes(expected2) });
        if (!buffer2.includes(expected2)) fail('custom-values packet did not appear verbatim in the terminal buffer', { buffer2, expected2 });

        // regression: 素材タブ
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
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'd-08-regression-materials-tab.png'));

        const finalErrLog = await errorLog(cdp);
        record('ALL-PASS', { ok: true, finalErrLog });

        await writeFile(path.join(EVIDENCE_DIR, 'scenario-d-run-log.json'), JSON.stringify(log, null, 2));
        console.log('SCENARIO D SUCCESS');
        cdp.close();
    } finally {
        const orphanCheck = await assertNoOrphans(child.pid, USER_DATA_DIR);
        record('orphan-check', orphanCheck);
        await writeFile(path.join(EVIDENCE_DIR, 'scenario-d-run-log.json'), JSON.stringify(log, null, 2));
        if (!orphanCheck.ok) {
            console.error('ORPHAN PROCESSES REMAIN', orphanCheck.remaining);
            process.exitCode = 1;
        }
    }
}

main().catch(async (err) => {
    console.error('FAILED', err);
    await writeFile(path.join(EVIDENCE_DIR, 'scenario-d-run-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
    process.exitCode = 1;
});
