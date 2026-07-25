// シナリオB: lint FAIL fixture（ws-lint-fail）で「この場で書き出す」→
// 書き出しが中断され件数表示・render-cut は起動されないことを実機検証する。
import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { screenshot, evalMain, realClick } from './cdp-lib.mjs';
import { launchElectron, killElectronTree, assertNoOrphans, sleep } from './launch.mjs';
import {
    clickMenuIcon, exportButtonState, exportSectionText, installErrorCounter, errorLog,
    runQuickPickChain, connectAndWaitReady
} from './scenario-helpers.mjs';

const CDP_PORT = 29902;
const WORKSPACE = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/fixtures/ws-lint-fail';
const USER_DATA_DIR = '/private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-wt-quick-export/82766364-1be8-4985-8ada-df6f44377f25/scratchpad/user-data/scenario-b-' + CDP_PORT;
const EVIDENCE_DIR = '/Users/ryoma/_edit/30_products/akari-video-wt/quick-export/apps/shell/extensions/akari-shell-strip/evidence/quick-export';

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
    execSync(`rm -rf "${WORKSPACE}/exports" "${WORKSPACE}/.akari/render.json" "${WORKSPACE}/.akari/reports" "${WORKSPACE}/.akari/render-tmp"`);
    execSync(`mkdir -p "${WORKSPACE}/exports" "${WORKSPACE}/.akari/reports"`);
    execSync(`touch "${WORKSPACE}/exports/.gitkeep" "${WORKSPACE}/.akari/reports/.gitkeep"`);

    const child = launchElectron({ workspaceDir: WORKSPACE, cdpPort: CDP_PORT, userDataDir: USER_DATA_DIR, logPath: path.join(EVIDENCE_DIR, 'scenario-b-electron.log') });
    record('electron-spawned', { pid: child.pid });
    try {
        const cdp = await connectAndWaitReady(CDP_PORT);
        record('connected-and-ready', {});
        await sleep(500);
        await installErrorCounter(cdp);
        await clickMenuIcon(cdp);

        await runQuickPickChain(cdp, {
            resolutionLabel: '1080p 横',
            outputName: undefined,
            rerunLintLabel: 'lint を先に再実行する（既定）',
            executionModeLabel: 'この場で書き出す（推奨）'
        });

        let sectionText = '';
        let lintFailObserved = false;
        for (let attempt = 0; attempt < 180; attempt++) {
            sectionText = await exportSectionText(cdp);
            if (sectionText.includes('lint NG')) { lintFailObserved = true; break; }
            await sleep(500);
        }
        record('lint-fail-observed', { lintFailObserved, sectionText });
        if (!lintFailObserved) fail('lint-failed state was not reached in time', { sectionText });
        if (!sectionText.includes('1 件')) fail('lint issue count badge should show 1 件 (cuts.range error)', { sectionText });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'b-01-lint-failed.png'));

        // render-cut は起動されない = exports/final.mp4 が存在しない・.akari/render.json も書かれない
        const outputExists = existsSync(path.join(WORKSPACE, 'exports', 'final.mp4'));
        const renderJsonExists = existsSync(path.join(WORKSPACE, '.akari', 'render.json'));
        record('render-cut-not-invoked', { outputExists, renderJsonExists });
        if (outputExists) fail('exports/final.mp4 should NOT exist when lint fails', { outputExists });
        if (renderJsonExists) fail('.akari/render.json should NOT exist — render-cut must not have been invoked', { renderJsonExists });

        // lint レポートを開くリンクの実クリック
        const reportBtn = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('lint レポートを開く'));
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
        record('lint-report-button', reportBtn);
        if (reportBtn.found) {
            await realClick(cdp, reportBtn.x, reportBtn.y);
            await sleep(1000);
            const openedTabs = await evalMain(cdp, `Array.from(document.querySelectorAll('.lm-TabBar-tabLabel')).map(e => e.textContent.trim())`);
            record('lint-report-opened', { openedTabs });
            await screenshot(cdp, path.join(EVIDENCE_DIR, 'b-02-lint-report-opened.png'));
        }

        // ボタン復帰確認
        const reenabledState = await exportButtonState(cdp);
        record('button-reenabled', reenabledState);
        if (!reenabledState.found || reenabledState.disabled) fail('export button should re-enable after lint-fail abort', reenabledState);

        const finalErrCount = await errorLog(cdp);
        record('ALL-PASS', { ok: true, finalErrLog: finalErrCount });

        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-b-run-log.json'), JSON.stringify(log, null, 2));
        console.log('SCENARIO B SUCCESS');
        cdp.close();
    } finally {
        const orphanCheck = await assertNoOrphans(child.pid, USER_DATA_DIR);
        record('orphan-check', orphanCheck);
        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-b-run-log.json'), JSON.stringify(log, null, 2));
        if (!orphanCheck.ok) {
            console.error('ORPHAN PROCESSES REMAIN', orphanCheck.remaining);
            process.exitCode = 1;
        }
    }
}

main().catch(async (err) => {
    console.error('FAILED', err);
    writeFileSync(path.join(EVIDENCE_DIR, 'scenario-b-run-log-FAILED.json'), JSON.stringify(log, null, 2));
    process.exitCode = 1;
});
