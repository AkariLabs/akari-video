// L1 (a) 質問ゼロ + L1 (c) 上書きしない。
// 同じ Electron セッションで「書き出し」を 2 回押し、1 回目は quick-pick が
// 1 つも出ないこと・完了ラベルが GPU であることを、2 回目は final-2.mp4 が
// 新規に生まれ final.mp4 の sha256 が不変であることを実測する。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import {
    launchElectron, assertNoOrphans, connectAndWaitReady, clickMenuIcon, clickButtonByText,
    buttonState, quickInputProbe, exportSectionText, progressLabels, installErrorCounter, errorLog, toastLog,
    screenshot, sleep
} from './harness.mjs';

const WS = '/tmp/qeoc/ws-a';
const OUT = new URL('.', import.meta.url).pathname;
const CDP_PORT = 9333;
const USER_DATA = '/tmp/qeoc/udata-a';
const THEIA_CFG = '/tmp/qeoc/theia-a';

const log = { scenario: 'a+c', steps: [] };
function note(step, detail) { log.steps.push({ step, detail }); console.log(step, JSON.stringify(detail)); }

function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function exportsList() { return existsSync(`${WS}/exports`) ? readdirSync(`${WS}/exports`).sort() : []; }
function renderJson() {
    const p = `${WS}/.akari/render.json`;
    if (!existsSync(p)) return undefined;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; }
}

async function waitForDoneLabel(cdp, timeoutMs) {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeoutMs) {
        const text = await exportSectionText(cdp);
        last = text ?? '';
        if (last.includes('書き出し完了')) return last;
        if (last.includes('失敗しました') || last.includes('lint NG')) throw new Error('export failed: ' + last);
        await sleep(1000);
    }
    throw new Error('timed out waiting for completion; last section text: ' + last);
}

const child = launchElectron({
    workspaceDir: WS, cdpPort: CDP_PORT, userDataDir: USER_DATA,
    themeConfigDir: THEIA_CFG, logPath: `${OUT}/scenario-a-electron.log`
});

try {
    mkdirSync(USER_DATA, { recursive: true });
    const cdp = await connectAndWaitReady(CDP_PORT);
    await installErrorCounter(cdp);
    await clickMenuIcon(cdp);
    await sleep(1200);
    await screenshot(cdp, `${OUT}/a-00-menu-before-export.png`);
    note('menu-opened', { exportButton: await buttonState(cdp, '書き出し'), detailButton: await buttonState(cdp, '詳細設定で書き出す…') });

    // --- L1 (a): 主ボタンを押す → quick-pick は 1 つも出ない -------------------
    note('exports-before-run1', exportsList());
    await clickButtonByText(cdp, '書き出し');
    const quickInputProbes = [];
    for (let i = 0; i < 5; i++) {
        await sleep(1000);
        quickInputProbes.push(await quickInputProbe(cdp));
        if (i === 0) await screenshot(cdp, `${OUT}/a-01-no-quickpick-t1.png`);
        if (i === 4) await screenshot(cdp, `${OUT}/a-02-no-quickpick-t5.png`);
    }
    note('quick-input-probes(5x1s)', quickInputProbes);
    if (quickInputProbes.some(p => p.visible)) throw new Error('quick-pick appeared on the one-click path');

    // 進行中ラベル（provenance.engine が読めた時点で「（GPU で書き出し中）」）。
    // セクション全文だとボタン名や <style> に埋もれるので、ラベル要素だけを読む。
    const seenLabels = [];
    let inProgressShot = false;
    for (let i = 0; i < 900; i++) {
        const labels = (await progressLabels(cdp)).labels ?? [];
        for (const label of labels) if (!seenLabels.includes(label)) seenLabels.push(label);
        if (!inProgressShot && labels.some(l => l.includes('で書き出し中'))) {
            await screenshot(cdp, `${OUT}/a-03-in-progress-gpu-label.png`);
            inProgressShot = true;
        }
        const text = await exportSectionText(cdp);
        if (text && text.includes('書き出し完了')) break;
        if (text && (text.includes('失敗しました') || text.includes('lint NG'))) throw new Error('export failed: ' + text);
        await sleep(1000);
    }
    note('labels-seen-run1', seenLabels);
    if (!seenLabels.some(l => l.includes('（GPU で書き出し中）'))) {
        throw new Error('in-progress label never showed the GPU engine: ' + JSON.stringify(seenLabels));
    }

    const doneText = await waitForDoneLabel(cdp, 600000);
    await sleep(1500);
    await screenshot(cdp, `${OUT}/a-04-done-gpu.png`);
    const receipt1 = renderJson();
    note('run1-done', {
        sectionTextHasGpuLabel: doneText.includes('書き出し完了（GPU）'),
        sectionText: doneText.slice(0, 400),
        provenanceEngine: receipt1?.provenance?.engine,
        warnings: receipt1?.warnings,
        artifacts: receipt1?.artifacts?.map(a => ({ path: a.path, sha256: a.sha256 })),
        exports: exportsList(),
        toasts: await toastLog(cdp)
    });
    if (!doneText.includes('書き出し完了（GPU）')) throw new Error('done label is not the GPU label');
    if (receipt1?.provenance?.engine !== 'gpu') throw new Error('provenance.engine !== gpu');
    const toastsAfterRun1 = await toastLog(cdp);
    if (toastsAfterRun1.some(t => t.includes('書き出し完了'))) throw new Error('GPU success must stay quiet (no toast)');

    // --- L1 (c): 2 回目は上書きしない -----------------------------------------
    const finalSha = sha256(`${WS}/exports/final.mp4`);
    note('run2-before', { exports: exportsList(), finalSha });
    for (let i = 0; i < 60; i++) {
        const state = await buttonState(cdp, '書き出し');
        if (state.found && !state.disabled) break;
        await sleep(1000);
    }
    await clickButtonByText(cdp, '書き出し');
    const probes2 = [];
    for (let i = 0; i < 3; i++) { await sleep(1000); probes2.push(await quickInputProbe(cdp)); }
    note('run2-quick-input-probes', probes2);
    if (probes2.some(p => p.visible)) throw new Error('quick-pick appeared on the second one-click run');
    const doneText2 = await waitForDoneLabel(cdp, 600000);
    await sleep(1500);
    await screenshot(cdp, `${OUT}/a-05-second-run-no-overwrite.png`);
    const receipt2 = renderJson();
    note('run2-done', {
        sectionText: doneText2.slice(0, 400),
        provenanceEngine: receipt2?.provenance?.engine,
        artifacts: receipt2?.artifacts?.map(a => ({ path: a.path, sha256: a.sha256 })),
        exports: exportsList(),
        finalShaAfter: sha256(`${WS}/exports/final.mp4`),
        finalShaUnchanged: sha256(`${WS}/exports/final.mp4`) === finalSha,
        final2Exists: existsSync(`${WS}/exports/final-2.mp4`),
        final2Sha: existsSync(`${WS}/exports/final-2.mp4`) ? sha256(`${WS}/exports/final-2.mp4`) : null
    });
    if (!existsSync(`${WS}/exports/final-2.mp4`)) throw new Error('final-2.mp4 was not created');
    if (sha256(`${WS}/exports/final.mp4`) !== finalSha) throw new Error('final.mp4 was overwritten');

    note('console-errors', await errorLog(cdp));
    log.result = 'PASS';
} catch (error) {
    log.result = 'FAIL';
    log.error = String(error && error.stack ? error.stack : error);
    console.error(log.error);
} finally {
    writeFileSync(`${OUT}/scenario-a-run-log.json`, JSON.stringify(log, null, 2));
    const orphans = await assertNoOrphans(child.pid, USER_DATA);
    console.log('orphans', JSON.stringify(orphans));
    process.exit(log.result === 'PASS' ? 0 : 1);
}
