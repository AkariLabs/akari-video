// シナリオA: 実 mp4 fixture（ws-success）で「この場で書き出す」→
// パートナー未接続のまま exports/ に実 MP4 が出ることを実機検証する。
import { writeFileSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { evalMain, realClick, screenshot } from './cdp-lib.mjs';
import { launchElectron, killElectronTree, assertNoOrphans, sleep } from './launch.mjs';
import {
    clickMenuIcon, exportButtonState, exportSectionText, installErrorCounter, errorLog,
    runQuickPickChain, connectMainWithRetry, waitForAppReady
} from './scenario-helpers.mjs';

const CDP_PORT = 29901;
const WORKSPACE = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/fixtures/ws-success';
const USER_DATA_DIR = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/user-data/scenario-a-' + CDP_PORT;
const EVIDENCE_DIR = '/Users/ryoma/_edit/30_products/akari-video-wt/quick-export/apps/shell/extensions/akari-shell-strip/evidence/quick-export';

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
    execSync(`rm -rf "${WORKSPACE}/exports" "${WORKSPACE}/.akari/render.json" "${WORKSPACE}/.akari/reports" "${WORKSPACE}/.akari/render-tmp"`);
    execSync(`mkdir -p "${WORKSPACE}/exports" "${WORKSPACE}/.akari/reports"`);
    execSync(`touch "${WORKSPACE}/exports/.gitkeep" "${WORKSPACE}/.akari/reports/.gitkeep"`);

    const child = launchElectron({ workspaceDir: WORKSPACE, cdpPort: CDP_PORT, userDataDir: USER_DATA_DIR, logPath: path.join(EVIDENCE_DIR, 'scenario-a-electron.log') });
    record('electron-spawned', { pid: child.pid });
    try {
        const cdp = await connectMainWithRetry(CDP_PORT);
        record('connected-main', {});
        const ready = await waitForAppReady(cdp);
        record('app-ready', { ready });
        if (!ready) fail('app did not become ready (menu icon never appeared)', {});
        await sleep(800);
        await installErrorCounter(cdp);
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-00-boot.png'));

        await clickMenuIcon(cdp);
        const enabledState = await exportButtonState(cdp);
        record('export-button-enabled', enabledState);
        if (!enabledState.found || enabledState.disabled) fail('export button should be enabled (edit.json present)', enabledState);

        await runQuickPickChain(cdp, {
            resolutionLabel: '1080p 横',
            outputName: undefined, // keep default final.mp4
            rerunLintLabel: 'lint を先に再実行する（既定）',
            executionModeLabel: 'この場で書き出す（推奨）'
        });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-01-quickpicks-submitted.png'));

        // 実行中: ボタン disabled（多重起動禁止の実測）
        const runningState = await exportButtonState(cdp);
        record('running-button-disabled', runningState);
        if (!runningState.found || !runningState.disabled) fail('export button should be disabled while quick export is running', runningState);
        const runningSection = await exportSectionText(cdp);
        record('running-section-text', { runningSection });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-02-running-disabled.png'));

        // 完了までポーリング（実 ffmpeg レンダー完了待ち）
        let sectionText = '';
        let doneObserved = false;
        for (let attempt = 0; attempt < 120; attempt++) {
            sectionText = await exportSectionText(cdp);
            if (sectionText.includes('この場での書き出しが完了しました')) { doneObserved = true; break; }
            await sleep(1000);
        }
        record('done-observed', { doneObserved, sectionText });
        if (!doneObserved) fail('local quick export did not reach done state in time', { sectionText });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-03-done.png'));

        // ボタン復帰
        const reenabledState = await exportButtonState(cdp);
        record('button-reenabled', reenabledState);
        if (!reenabledState.found || reenabledState.disabled) fail('export button should re-enable after completion', reenabledState);

        // 実ファイル存在 + サイズ>0 + ffprobe 実測
        const outputPath = path.join(WORKSPACE, 'exports', 'final.mp4');
        if (!existsSync(outputPath)) fail('exports/final.mp4 does not exist on disk', { outputPath });
        const stat = statSync(outputPath);
        record('output-file-stat', { size: stat.size });
        if (stat.size <= 0) fail('exports/final.mp4 has zero size', { size: stat.size });
        const ffprobeOut = execSync(`ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1 "${outputPath}"`).toString();
        record('ffprobe', { ffprobeOut });

        // 成果物リンクの実クリック
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
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-04-artifact-opened.png'));
        if (!openedTabTitle) fail('exported artifact did not open in a tab', { openedTabTitle });

        // 併存確認: render-cut 自身が書いた .akari/render.json が既存の読み取り専用パネル
        // （render-progress.ts・書き込みは一切していない既存機構）にも反映されていること。
        const renderJsonExists = existsSync(path.join(WORKSPACE, '.akari', 'render.json'));
        record('render-json-written-by-render-cut', { renderJsonExists });
        if (!renderJsonExists) fail('render-cut should have written .akari/render.json itself (coexistence check)', {});
        let coexistObserved = false;
        let coexistSectionText = '';
        for (let attempt = 0; attempt < 15; attempt++) {
            coexistSectionText = await exportSectionText(cdp);
            if (coexistSectionText.includes('書き出し完了') && coexistSectionText.includes('exports/final.mp4')) { coexistObserved = true; break; }
            await sleep(500);
        }
        record('existing-render-json-panel-coexist', { coexistObserved, coexistSectionText });
        if (!coexistObserved) fail('existing render.json-driven progress panel did not reflect render-cut\'s own render.json (coexistence broke)', { coexistSectionText });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-04b-coexist-render-json-panel.png'));

        // 回帰: メニュー既存項目・素材タブ
        const menuRegression = await evalMain(cdp, `(() => {
      const labels = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      return {
        hasTimeline: labels.includes('タイムライン'), hasTranscript: labels.includes('文字起こし'),
        hasHome: labels.includes('ホーム'), hasShowChanges: labels.includes('変更を見る')
      };
    })()`);
        record('regression-menu-actions', menuRegression);
        if (!menuRegression.hasTimeline || !menuRegression.hasTranscript || !menuRegression.hasHome || !menuRegression.hasShowChanges) {
            fail('existing menu actions regressed', menuRegression);
        }
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
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'a-05-regression-materials-tab.png'));

        const finalErrCount = await evalMain(cdp, 'window.__errCount');
        const finalErrLog = await errorLog(cdp);
        record('ALL-PASS', { ok: true, finalErrCount, finalErrLog });

        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-a-run-log.json'), JSON.stringify(log, null, 2));
        console.log('SCENARIO A SUCCESS');
        cdp.close();
    } finally {
        killElectronTree(child.pid, USER_DATA_DIR);
        const orphanCheck = await assertNoOrphans(child.pid, USER_DATA_DIR);
        record('orphan-check', orphanCheck);
        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-a-run-log.json'), JSON.stringify(log, null, 2));
        if (!orphanCheck.ok) {
            console.error('ORPHAN PROCESSES REMAIN', orphanCheck.remaining);
            process.exitCode = 1;
        }
    }
}

main().catch(async (err) => {
    console.error('FAILED', err);
    writeFileSync(path.join(EVIDENCE_DIR, 'scenario-a-run-log-FAILED.json'), JSON.stringify(log, null, 2));
    process.exitCode = 1;
});
