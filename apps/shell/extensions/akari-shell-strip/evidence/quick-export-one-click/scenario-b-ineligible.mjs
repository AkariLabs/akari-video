// L1 (b) 不適格の可視化。ws-b（<iframe> を含む overlay を 1 つ足した複製）で
// 主ボタンを押し、完了ラベルに「OSR — GPU 不適格: <overlay id>: embedded-context」
// が出ること・同じ内容のトーストが 1 回だけ出ること・GPU 成功時は静かなことを実測する。
// 併せて書き出し中ラベルにエンジン名が乗ることも記録する。
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import {
    launchElectron, assertNoOrphans, connectAndWaitReady, clickMenuIcon, clickButtonByText,
    quickInputProbe, exportSectionText, progressLabels, installErrorCounter, errorLog, toastLog,
    screenshot, sleep
} from './harness.mjs';

const WS = '/tmp/qeoc/ws-b';
const OUT = new URL('.', import.meta.url).pathname;
const CDP_PORT = 9334;
const USER_DATA = '/tmp/qeoc/udata-b';
const THEIA_CFG = '/tmp/qeoc/theia-b';

const log = { scenario: 'b', steps: [] };
function note(step, detail) { log.steps.push({ step, detail }); console.log(step, JSON.stringify(detail)); }
function renderJson() {
    const p = `${WS}/.akari/render.json`;
    if (!existsSync(p)) return undefined;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; }
}

const child = launchElectron({
    workspaceDir: WS, cdpPort: CDP_PORT, userDataDir: USER_DATA,
    themeConfigDir: THEIA_CFG, logPath: `${OUT}/scenario-b-electron.log`
});

try {
    mkdirSync(USER_DATA, { recursive: true });
    const cdp = await connectAndWaitReady(CDP_PORT);
    await installErrorCounter(cdp);
    await clickMenuIcon(cdp);
    await sleep(1200);
    await screenshot(cdp, `${OUT}/b-00-menu.png`);

    await clickButtonByText(cdp, '書き出し');
    const probes = [];
    for (let i = 0; i < 3; i++) { await sleep(1000); probes.push(await quickInputProbe(cdp)); }
    note('quick-input-probes', probes);

    const seenLabels = [];
    let doneText = '';
    let inProgressShot = false;
    for (let i = 0; i < 900; i++) {
        const labels = (await progressLabels(cdp)).labels ?? [];
        for (const label of labels) if (!seenLabels.includes(label)) seenLabels.push(label);
        if (!inProgressShot && labels.some(l => l.includes('で書き出し中'))) {
            await screenshot(cdp, `${OUT}/b-01-in-progress-engine-label.png`);
            inProgressShot = true;
        }
        const text = await exportSectionText(cdp);
        if (text && text.includes('書き出し完了')) { doneText = text; break; }
        if (text && (text.includes('失敗しました') || text.includes('lint NG'))) throw new Error('export failed: ' + text);
        await sleep(1000);
    }
    note('labels-seen', seenLabels);
    await sleep(1500);
    await screenshot(cdp, `${OUT}/b-02-done-osr-ineligible.png`);

    const receipt = renderJson();
    const toasts = await toastLog(cdp);
    const expectedFragment = 'OSR — GPU 不適格: ineligible-frame: embedded-context';
    note('done', {
        doneLabels: seenLabels.filter(l => l.startsWith('書き出し完了')),
        labelHasIneligible: seenLabels.some(l => l.includes(expectedFragment)),
        provenanceEngine: receipt?.provenance?.engine,
        osrLauncherTier: receipt?.provenance?.osr?.provenance?.launcher_tier,
        warnings: receipt?.warnings,
        toasts,
        toastCountMatching: toasts.filter(t => t.includes(expectedFragment)).length
    });
    if (!seenLabels.some(l => l.includes(expectedFragment))) throw new Error('ineligible label missing');
    if (receipt?.provenance?.engine !== 'osr') throw new Error('provenance.engine !== osr');
    if (toasts.filter(t => t.includes(expectedFragment)).length !== 1) throw new Error('expected exactly one warning toast');

    note('console-errors', await errorLog(cdp));
    log.result = 'PASS';
} catch (error) {
    log.result = 'FAIL';
    log.error = String(error && error.stack ? error.stack : error);
    console.error(log.error);
} finally {
    writeFileSync(`${OUT}/scenario-b-run-log.json`, JSON.stringify(log, null, 2));
    const orphans = await assertNoOrphans(child.pid, USER_DATA);
    console.log('orphans', JSON.stringify(orphans));
    process.exit(log.result === 'PASS' ? 0 : 1);
}
