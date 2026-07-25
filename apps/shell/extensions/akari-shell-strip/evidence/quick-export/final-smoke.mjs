// フック不在の最終ビルドに対する final smoke（export-button の final-smoke.mjs と同じ趣旨）。
// L1-1（パートナー端末バッファへの到達）はデバッグフックが無いと検証できないため
// scenario-d-agent.mjs 側でのみ実測済み（フック除去前）。ここでは
// フック非依存の項目（edit.json ゲート・未接続トースト・キャンセル no-op・
// メニュー/素材タブ回帰・この場で書き出す成功パス）を最終ビルドで再確認する。
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { statSync, existsSync } from 'node:fs';
import { evalMain, realClick, screenshot } from './cdp-lib.mjs';
import { launchElectron, assertNoOrphans, sleep } from './launch.mjs';
import {
    clickMenuIcon, exportButtonState, exportSectionText, toastMessages, installErrorCounter, errorLog,
    waitForQuickInputPlaceholder, clickQuickPickRow, pressEscape,
    connectAndWaitReady, runQuickPickChain
} from './scenario-helpers.mjs';

const CDP_PORT = 29905;
const WORKSPACE = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/fixtures/ws-agent';
const USER_DATA_DIR = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/user-data/final-smoke-' + CDP_PORT;
const EVIDENCE_DIR = '/Users/ryoma/_edit/30_products/akari-video-wt/quick-export/apps/shell/extensions/akari-shell-strip/evidence/quick-export';
const EDIT_JSON_PATH = path.join(WORKSPACE, 'edit.json');
const EDIT_JSON_BACKUP_PATH = path.join(WORKSPACE, '.edit.json.bak');

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
    execSync(`rm -rf "${WORKSPACE}/exports" "${WORKSPACE}/.akari/render.json" "${WORKSPACE}/.akari/reports" "${WORKSPACE}/.akari/render-tmp" "${WORKSPACE}/.akari/lint.json"`);
    execSync(`mkdir -p "${WORKSPACE}/exports" "${WORKSPACE}/.akari/reports"`);
    execSync(`touch "${WORKSPACE}/exports/.gitkeep" "${WORKSPACE}/.akari/reports/.gitkeep"`);
    await import('node:fs/promises').then(fs => fs.rename(EDIT_JSON_PATH, EDIT_JSON_BACKUP_PATH));

    const child = launchElectron({ workspaceDir: WORKSPACE, cdpPort: CDP_PORT, userDataDir: USER_DATA_DIR, logPath: path.join(EVIDENCE_DIR, 'final-smoke-electron.log') });
    record('electron-spawned', { pid: child.pid });
    try {
        const cdp = await connectAndWaitReady(CDP_PORT);
        record('connected-and-ready', {});
        await sleep(500);
        await installErrorCounter(cdp);

        // フックが本当に無いことを確認（証跡削除の検収）
        const hasDebugHook = await evalMain(cdp, `!!window.__akariMenuWidgetDebug`);
        record('debug-hook-absent', { hasDebugHook });
        if (hasDebugHook) fail('debug hook should be absent in the final build', { hasDebugHook });

        await clickMenuIcon(cdp);
        const disabledState = await exportButtonState(cdp);
        record('editjson-absent-disabled', disabledState);
        if (!disabledState.found || !disabledState.disabled) fail('export button should be disabled when edit.json is absent', disabledState);

        const menuRegression = await evalMain(cdp, `(() => {
      const labels = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      return { hasTimeline: labels.includes('タイムライン'), hasTranscript: labels.includes('文字起こし'), hasHome: labels.includes('ホーム'), hasShowChanges: labels.includes('変更を見る') };
    })()`);
        record('regression-menu', menuRegression);
        if (!menuRegression.hasTimeline || !menuRegression.hasTranscript || !menuRegression.hasHome || !menuRegression.hasShowChanges) {
            fail('existing menu actions regressed', menuRegression);
        }

        await import('node:fs/promises').then(fs => fs.rename(EDIT_JSON_BACKUP_PATH, EDIT_JSON_PATH));
        let enabledState;
        for (let attempt = 0; attempt < 15; attempt++) {
            enabledState = await exportButtonState(cdp);
            if (enabledState.found && !enabledState.disabled) break;
            await sleep(400);
        }
        record('editjson-created-reactive-enable', enabledState);
        if (!enabledState.found || enabledState.disabled) fail('export button did not become enabled after edit.json was created', enabledState);

        // 未接続 → トースト（4連鎖・エージェントに任せる）
        const toastsBefore = (await toastMessages(cdp)).length;
        await runQuickPickChain(cdp, {
            resolutionLabel: '1080p 横', outputName: undefined,
            rerunLintLabel: 'lint を先に再実行する（既定）', executionModeLabel: 'エージェントに任せる'
        });
        const toastsAfter = await toastMessages(cdp);
        record('not-connected-toast', { toastsBefore, toastsAfter });
        if (toastsAfter.length <= toastsBefore) fail('expected not-connected toast missing', { toastsAfter });

        // cancel no-op
        const toastsBeforeCancel = (await toastMessages(cdp)).length;
        await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`).then(async ({ x, y }) => { await realClick(cdp, x, y); await sleep(500); });
        await pressEscape(cdp);
        const qiClosed = await evalMain(cdp, `(() => { const w = document.querySelector('.quick-input-widget'); return !w || getComputedStyle(w).display === 'none'; })()`);
        const toastsAfterCancel = await toastMessages(cdp);
        record('cancel-no-op', { toastsBeforeCancel, toastsAfterCancelCount: toastsAfterCancel.length, qiClosed });
        if (toastsAfterCancel.length !== toastsBeforeCancel || !qiClosed) fail('cancel should be a no-op', { toastsBeforeCancel, toastsAfterCancel, qiClosed });

        // この場で書き出す成功パス（フック非依存の主要機能）を最終ビルドで再確認
        await runQuickPickChain(cdp, {
            resolutionLabel: '正方形', outputName: 'final-smoke.mp4',
            rerunLintLabel: 'lint を先に再実行する（既定）', executionModeLabel: 'この場で書き出す（推奨）'
        });
        let doneObserved = false;
        let sectionText = '';
        for (let attempt = 0; attempt < 120; attempt++) {
            sectionText = await exportSectionText(cdp);
            if (sectionText.includes('この場での書き出しが完了しました')) { doneObserved = true; break; }
            await sleep(500);
        }
        record('local-export-done', { doneObserved, sectionText });
        if (!doneObserved) fail('local quick export did not complete on final build', { sectionText });
        const outputPath = path.join(WORKSPACE, 'exports', 'final-smoke.mp4');
        if (!existsSync(outputPath) || statSync(outputPath).size <= 0) fail('exports/final-smoke.mp4 missing or empty', { outputPath });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-01-local-export-done.png'));

        // 素材タブ回帰
        const filesIcon = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
        if (filesIcon.found) { await realClick(cdp, filesIcon.x, filesIcon.y); await sleep(700); }
        const dzFound = await evalMain(cdp, `(() => {
      const el = document.querySelector('[data-akari-dropzone]');
      return el ? el.getBoundingClientRect().width > 0 : false;
    })()`);
        record('regression-materials-tab', { dzFound });
        if (!dzFound) fail('materials tab regressed', { dzFound });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-02-regression-materials-tab.png'));

        const finalErrLog = await errorLog(cdp);
        record('ALL-PASS', { ok: true, finalErrLog });
        console.log('FINAL SMOKE SUCCESS');
        cdp.close();
    } finally {
        const orphanCheck = await assertNoOrphans(child.pid, USER_DATA_DIR);
        record('orphan-check', orphanCheck);
        await writeFile(path.join(EVIDENCE_DIR, 'final-smoke-run-log.json'), JSON.stringify(log, null, 2));
        if (!orphanCheck.ok) {
            console.error('ORPHAN PROCESSES REMAIN', orphanCheck);
            process.exitCode = 1;
        }
    }
}

main().catch(async (err) => {
    console.error('FAILED', err);
    await writeFile(path.join(EVIDENCE_DIR, 'final-smoke-run-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
    process.exitCode = 1;
});
