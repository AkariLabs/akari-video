// L1 (d) 詳細設定 + 非退行（エージェント経路）。
// 「詳細設定で書き出す…」を押し、出る quick-pick の placeholder 列と各選択肢
// ラベルを全て記録する（エンジン / 解像度 / lint / 出力名の質問が無いことの証拠）。
// 実行方法は「エージェントに任せる」を選び、パートナー未接続トースト = 既存の
// 依頼パケット注入経路が従来どおり生きていることを確認する。最後に
// 「既定にする」= はい で THEIA_CONFIG_DIR/settings.json に akari.export.* が
// 書かれることを実ファイルで確認し、主ボタンが保存済み設定で走ることも見る。
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import {
    launchElectron, assertNoOrphans, connectAndWaitReady, clickMenuIcon, clickButtonByText,
    quickInputProbe, quickPickRows, clickQuickPickRow, waitForQuickInputPlaceholder,
    exportSectionText, progressLabels, installErrorCounter, errorLog, toastLog,
    screenshot, sleep
} from './harness.mjs';

const WS = '/tmp/qeoc/ws-d';
const OUT = new URL('.', import.meta.url).pathname;
const CDP_PORT = 9335;
const USER_DATA = '/tmp/qeoc/udata-d';
const THEIA_CFG = '/tmp/qeoc/theia-d';
const SETTINGS = `${THEIA_CFG}/settings.json`;

const log = { scenario: 'd', steps: [] };
function note(step, detail) { log.steps.push({ step, detail }); console.log(step, JSON.stringify(detail)); }

const STEPS = [
    { placeholder: '画質を選択', pick: '軽量（light・crf 26 相当）', shot: 'd-01-quality.png' },
    { placeholder: 'エンコーダ（自動/ハードウェア/ソフトウェア）を選択', pick: 'ハードウェア（VideoToolbox）', shot: 'd-02-encoder.png' },
    { placeholder: 'フレームレートを選択', pick: '30fps', shot: 'd-03-fps.png' },
    { placeholder: '出力先を選択', pick: 'プロジェクトの exports/ 直下', shot: 'd-04-output-destination.png' },
    { placeholder: '実行方法を選択', pick: 'エージェントに任せる', shot: 'd-05-execution-method.png' },
    { placeholder: 'この設定を既定にしますか', pick: 'はい、この設定を既定にする', shot: 'd-06-save-as-default.png' }
];

const child = launchElectron({
    workspaceDir: WS, cdpPort: CDP_PORT, userDataDir: USER_DATA,
    themeConfigDir: THEIA_CFG, logPath: `${OUT}/scenario-d-electron.log`
});

try {
    mkdirSync(USER_DATA, { recursive: true });
    mkdirSync(THEIA_CFG, { recursive: true });
    const cdp = await connectAndWaitReady(CDP_PORT);
    await installErrorCounter(cdp);
    await clickMenuIcon(cdp);
    await sleep(1200);
    await screenshot(cdp, `${OUT}/d-00-menu.png`);

    await clickButtonByText(cdp, '詳細設定で書き出す…');
    const observed = [];
    for (const step of STEPS) {
        await waitForQuickInputPlaceholder(cdp, step.placeholder);
        const rows = await quickPickRows(cdp);
        observed.push({ placeholder: step.placeholder, rows });
        await screenshot(cdp, `${OUT}/${step.shot}`);
        await clickQuickPickRow(cdp, step.pick);
    }
    note('quick-pick-sequence', observed);

    // quick-pick 連鎖が終わったこと（= 6 問で打ち止め）を確認する。
    await sleep(2500);
    const afterChain = await quickInputProbe(cdp);
    note('quick-input-after-chain', afterChain);
    if (afterChain.visible) throw new Error('an extra quick-pick appeared after the 6 declared steps: ' + JSON.stringify(afterChain));

    const forbidden = ['エンジン', 'legacy', '解像度', 'lint', '出力ファイル名', 'OSR', 'v2（'];
    const haystack = JSON.stringify(observed);
    const hits = forbidden.filter(word => haystack.includes(word));
    note('forbidden-words-in-detailed-flow', hits);
    if (hits.length > 0) throw new Error('detailed flow still asks about: ' + hits.join(', '));

    await sleep(2000);
    await screenshot(cdp, `${OUT}/d-07-agent-path-toast.png`);
    const toasts = await toastLog(cdp);
    note('agent-path', { toasts, exportSection: (await exportSectionText(cdp) ?? '').slice(0, 200) });

    // preference が実ファイルに書かれたこと。
    let settings;
    for (let attempt = 0; attempt < 40 && !settings; attempt++) {
        if (existsSync(SETTINGS)) {
            try { settings = JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { settings = undefined; }
        }
        if (!settings) await sleep(500);
    }
    note('settings-json', { path: SETTINGS, content: settings });
    if (!settings || settings['akari.export.quality'] !== 'light'
        || settings['akari.export.encoder'] !== 'videotoolbox'
        || settings['akari.export.fps'] !== 30) {
        throw new Error('preferences were not persisted as expected: ' + JSON.stringify(settings));
    }

    // 保存した既定で主ボタンが質問ゼロのまま走ること（preference 経路の通し確認）。
    await clickButtonByText(cdp, '書き出し');
    const probes = [];
    for (let i = 0; i < 3; i++) { await sleep(1000); probes.push(await quickInputProbe(cdp)); }
    note('main-button-after-prefs-quick-input', probes);
    if (probes.some(p => p.visible)) throw new Error('main button asked a question after preferences were saved');
    let doneText = '';
    for (let i = 0; i < 900; i++) {
        const text = await exportSectionText(cdp);
        if (text && text.includes('書き出し完了')) { doneText = text; break; }
        if (text && (text.includes('失敗しました') || text.includes('lint NG'))) throw new Error('export failed: ' + text);
        await sleep(1000);
    }
    await sleep(1500);
    await screenshot(cdp, `${OUT}/d-08-main-button-with-saved-prefs.png`);
    const receipt = JSON.parse(readFileSync(`${WS}/.akari/render.json`, 'utf8'));
    note('main-button-after-prefs-done', {
        labels: (await progressLabels(cdp)).labels,
        provenanceEngine: receipt?.provenance?.engine,
        fps: receipt?.plan?.output?.fps ?? receipt?.output?.fps,
        artifacts: receipt?.artifacts?.map(a => ({ path: a.path, ffprobe: a.ffprobe }))
    });
    if (!doneText.includes('書き出し完了')) throw new Error('main button run did not finish');

    note('console-errors', await errorLog(cdp));
    log.result = 'PASS';
} catch (error) {
    log.result = 'FAIL';
    log.error = String(error && error.stack ? error.stack : error);
    console.error(log.error);
} finally {
    writeFileSync(`${OUT}/scenario-d-run-log.json`, JSON.stringify(log, null, 2));
    const orphans = await assertNoOrphans(child.pid, USER_DATA);
    console.log('orphans', JSON.stringify(orphans));
    process.exit(log.result === 'PASS' ? 0 : 1);
}
