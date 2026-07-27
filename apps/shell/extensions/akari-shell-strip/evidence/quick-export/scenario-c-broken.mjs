// シナリオC: 壊れ edit.json fixture（ws-broken）+ lint OFF で「この場で書き出す」→
// render-cut 自体が失敗し、失敗表示 + stderr 要約が出ることを実機検証する。
import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { screenshot } from './cdp-lib.mjs';
import { launchElectron, killElectronTree, assertNoOrphans, sleep } from './launch.mjs';
import {
    clickMenuIcon, exportButtonState, exportSectionText, installErrorCounter, errorLog,
    runQuickPickChain, connectAndWaitReady
} from './scenario-helpers.mjs';

const CDP_PORT = 29903;
const WORKSPACE = '<scratch>/fixtures/ws-broken';
const USER_DATA_DIR = '<scratch>/user-data/scenario-c-' + CDP_PORT;
const EVIDENCE_DIR = '<WORKTREE>/apps/shell/extensions/akari-shell-strip/evidence/quick-export';

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
    execSync(`rm -rf "${WORKSPACE}/exports" "${WORKSPACE}/.akari/render.json" "${WORKSPACE}/.akari/reports" "${WORKSPACE}/.akari/render-tmp" "${WORKSPACE}/.akari/lint.json"`);
    execSync(`mkdir -p "${WORKSPACE}/exports" "${WORKSPACE}/.akari/reports"`);
    execSync(`touch "${WORKSPACE}/exports/.gitkeep" "${WORKSPACE}/.akari/reports/.gitkeep"`);

    const child = launchElectron({ workspaceDir: WORKSPACE, cdpPort: CDP_PORT, userDataDir: USER_DATA_DIR, logPath: path.join(EVIDENCE_DIR, 'scenario-c-electron.log') });
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
            rerunLintLabel: 'lint を再実行しない',
            executionModeLabel: 'この場で書き出す（推奨）'
        });

        let sectionText = '';
        let failedObserved = false;
        for (let attempt = 0; attempt < 180; attempt++) {
            sectionText = await exportSectionText(cdp);
            if (sectionText.includes('この場での書き出しに失敗しました')) { failedObserved = true; break; }
            await sleep(500);
        }
        record('failed-observed', { failedObserved, sectionText });
        if (!failedObserved) fail('failed state was not reached in time', { sectionText });
        if (!sectionText.includes('not valid JSON')) fail('failure summary should mention the JSON parse error (stderr tail)', { sectionText });
        await screenshot(cdp, path.join(EVIDENCE_DIR, 'c-01-failed.png'));

        const outputExists = existsSync(path.join(WORKSPACE, 'exports', 'final.mp4'));
        record('no-output-file', { outputExists });
        if (outputExists) fail('exports/final.mp4 should NOT exist when render-cut itself fails', { outputExists });

        const reenabledState = await exportButtonState(cdp);
        record('button-reenabled', reenabledState);
        if (!reenabledState.found || reenabledState.disabled) fail('export button should re-enable after failure', reenabledState);

        const finalErrLog = await errorLog(cdp);
        record('ALL-PASS', { ok: true, finalErrLog });

        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-c-run-log.json'), JSON.stringify(log, null, 2));
        console.log('SCENARIO C SUCCESS');
        cdp.close();
    } finally {
        const orphanCheck = await assertNoOrphans(child.pid, USER_DATA_DIR);
        record('orphan-check', orphanCheck);
        writeFileSync(path.join(EVIDENCE_DIR, 'scenario-c-run-log.json'), JSON.stringify(log, null, 2));
        if (!orphanCheck.ok) {
            console.error('ORPHAN PROCESSES REMAIN', orphanCheck.remaining);
            process.exitCode = 1;
        }
    }
}

main().catch(async (err) => {
    console.error('FAILED', err);
    writeFileSync(path.join(EVIDENCE_DIR, 'scenario-c-run-log-FAILED.json'), JSON.stringify(log, null, 2));
    process.exitCode = 1;
});
