// L1 実機検証: 左パネル 2 分割（U6 裁定）。
// タスク: 2026-08-03-left-panel-split
// 起動は run-l1.sh（このスクリプトの外側）が担う。ここでは既に起動済みの
// Electron インスタンスに CDP でアタッチし、DOM 実測 + スクショのみ行う。
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';

const PORT = process.env.CDP_PORT || '32945';
const OUT_DIR = new URL('.', import.meta.url).pathname;
const log = {};

function record(key, value) {
    log[key] = value;
    console.log(`[${key}]`, JSON.stringify(value));
}

// 高負荷環境では単発の Runtime.evaluate 自体が詰まって例外を投げることがある
// （このマシンは他レーンと同時稼働中で load average が高いことを実測済み）。
// 1 回の evalMain 失敗でリトライループ全体を諦めないよう、例外も「まだ来ていない」
// 扱いにして次のポーリングへ進む。
async function waitFor(cdp, expression, timeoutMs = 20000, intervalMs = 500) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
        try {
            last = await evalMain(cdp, expression, 20000);
            if (last) return last;
        } catch (err) {
            console.warn('  (waitFor retry after transient error)', err.message);
        }
        await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms: ${expression}`);
}

async function main() {
    const cdp = await connectMain(PORT);

    // errCount instrumentation（catalog-tab 検証の流儀を踏襲）
    await evalMain(cdp, `(() => { window.__errCount = 0; window.addEventListener('error', () => { window.__errCount++; }); true; })()`);

    // --- 0. boot: 左パネルが 2 分割で見えているか（widget マウントを poll で待つ） -----
    await waitFor(cdp, `!!document.querySelector('#akari-role-buckets-widget')`, 90000);
    const boot = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        if (!widget) return { found: false };
        const materialsHeader = Array.from(widget.querySelectorAll('span')).find(s => s.textContent === '素材');
        const outputsHeader = Array.from(widget.querySelectorAll('span')).find(s => s.textContent === 'できたもの');
        const catalogBtn = widget.querySelector('[data-akari-open-catalog]');
        const r = (el) => el ? el.getBoundingClientRect() : null;
        return {
            found: true,
            materialsHeaderVisible: !!materialsHeader && r(materialsHeader).height > 0,
            outputsHeaderVisible: !!outputsHeader && r(outputsHeader).height > 0,
            catalogBtnVisible: !!catalogBtn && r(catalogBtn).width > 0,
            dropzonePresent: widget.hasAttribute('data-akari-dropzone'),
            materialsTop: materialsHeader ? r(materialsHeader).top : null,
            outputsTop: outputsHeader ? r(outputsHeader).top : null
        };
    })()`);
    record('00-boot', boot);
    await sleep(2000); // 素材/成果物の非同期ロード猶予
    await screenshot(cdp, OUT_DIR + '00-boot-two-panes.png');

    // --- 1. 素材カード（既存機能の回帰） ------------------------------------------
    await sleep(1500); // サムネ/分析バッジの非同期ロード猶予
    const materialsState = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        const cards = widget.querySelectorAll('[data-akari-material-path]');
        return { cardCount: cards.length, names: Array.from(cards).map(c => c.getAttribute('data-akari-material-path')) };
    })()`);
    record('01-materials-regression', materialsState);

    // --- 2. できたもの（下段）: exports 2 件 + reports 1 件、新しい順、タイトル抽出 ---
    const outputsState = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        const cards = Array.from(widget.querySelectorAll('[data-akari-output-path]'));
        return {
            count: cards.length,
            entries: cards.map(c => {
                // 2 番目の子 div（サムネ以外）が label/meta の 2 span を持つ。
                // サムネ box 側は img かアイコン span かで span 数が変わるため、
                // 「2 番目の div の中の span」で決め打ちして数え間違いを避ける。
                const textCol = c.children[1];
                const spans = textCol ? textCol.querySelectorAll('span') : [];
                return {
                    path: c.getAttribute('data-akari-output-path'),
                    kind: c.getAttribute('data-akari-output-kind'),
                    label: spans[0]?.textContent,
                    meta: spans[1]?.textContent
                };
            })
        };
    })()`);
    record('02-outputs-list', outputsState);
    await screenshot(cdp, OUT_DIR + '01-outputs-list.png');

    // --- 3. カタログへ widget 内遷移 -----------------------------------------------
    const catalogBtnPos = await evalMain(cdp, `(() => {
        const el = document.querySelector('[data-akari-open-catalog]');
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await realClick(cdp, catalogBtnPos.x, catalogBtnPos.y);
    await waitFor(cdp, `!!document.querySelector('[data-akari-back-to-materials]')`, 10000);
    const catalogState = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        const backBtn = widget.querySelector('[data-akari-back-to-materials]');
        const materialsCardsVisible = widget.querySelectorAll('[data-akari-material-path]').length;
        const outputsStillVisible = widget.querySelectorAll('[data-akari-output-path]').length;
        const searchInput = widget.querySelector('input[type="text"]');
        return {
            backBtnPresent: !!backBtn,
            materialsCardsVisibleWhileInCatalog: materialsCardsVisible,
            outputsStillVisibleWhileInCatalog: outputsStillVisible,
            searchInputPresent: !!searchInput,
            catalogItemCount: widget.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count')
        };
    })()`);
    record('03-catalog-navigated', catalogState);
    await screenshot(cdp, OUT_DIR + '02-catalog-navigated.png');

    // --- 4. 「← 素材にもどる」で復帰 -------------------------------------------------
    const backBtnPos = await evalMain(cdp, `(() => {
        const el = document.querySelector('[data-akari-back-to-materials]');
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await realClick(cdp, backBtnPos.x, backBtnPos.y);
    await waitFor(cdp, `!!document.querySelector('[data-akari-open-catalog]')`, 10000);
    const backState = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        return {
            materialsCardsVisible: widget.querySelectorAll('[data-akari-material-path]').length,
            catalogBtnVisibleAgain: !!widget.querySelector('[data-akari-open-catalog]'),
            outputsStillVisible: widget.querySelectorAll('[data-akari-output-path]').length
        };
    })()`);
    record('04-back-to-materials', backState);
    await screenshot(cdp, OUT_DIR + '03-back-to-materials.png');

    // --- 5. できたもの: クリックで中央に開く -----------------------------------------
    const tabCountBefore = await evalMain(cdp, `document.querySelectorAll('.lm-TabBar-tab').length`);
    const reportCardPos = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        const el = widget.querySelector('[data-akari-output-kind="report"]');
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, path: el.getAttribute('data-akari-output-path') };
    })()`);
    await realClick(cdp, reportCardPos.x, reportCardPos.y);
    await waitFor(cdp, `document.querySelectorAll('.lm-TabBar-tab').length > ${tabCountBefore} ? 'yes' : ''`, 10000);
    const tabCountAfter = await evalMain(cdp, `document.querySelectorAll('.lm-TabBar-tab').length`);
    const openedTabTitles = await evalMain(cdp, `Array.from(document.querySelectorAll('.lm-TabBar-tab .lm-TabBar-tabLabel')).map(e => e.textContent)`);
    record('05-report-opened-in-center', {
        clickedPath: reportCardPos.path,
        tabCountBefore,
        tabCountAfter,
        openedTabTitles
    });
    await screenshot(cdp, OUT_DIR + '04-report-opened-center.png');

    // --- 6. できたもの: mp4 クリックでも中央に開く ------------------------------------
    const exportCardPos = await evalMain(cdp, `(() => {
        const widget = document.querySelector('#akari-role-buckets-widget');
        const el = widget.querySelector('[data-akari-output-kind="export"]');
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, path: el.getAttribute('data-akari-output-path') };
    })()`);
    const tabCountBeforeExport = await evalMain(cdp, `document.querySelectorAll('.lm-TabBar-tab').length`);
    await realClick(cdp, exportCardPos.x, exportCardPos.y);
    await waitFor(cdp, `document.querySelectorAll('.lm-TabBar-tab').length > ${tabCountBeforeExport} ? 'yes' : ''`, 10000);
    const tabCountAfterExport = await evalMain(cdp, `document.querySelectorAll('.lm-TabBar-tab').length`);
    record('06-export-opened-in-center', {
        clickedPath: exportCardPos.path,
        tabCountBeforeExport,
        tabCountAfterExport
    });
    await screenshot(cdp, OUT_DIR + '05-export-opened-center.png');

    // --- 7. 手動リフレッシュボタン ---------------------------------------------------
    const refreshBtnPresent = await evalMain(cdp, `!!document.querySelector('[data-akari-outputs-refresh]')`);
    record('07-refresh-button-present', { refreshBtnPresent });

    // --- 8. console error 総数 ------------------------------------------------------
    const errCount = await evalMain(cdp, `window.__errCount`);
    record('08-console-error-count', { errCount });

    cdp.close();
    await writeFile(OUT_DIR + 'run-log.json', JSON.stringify(log, null, 2));
    console.log('DONE');
}

main().catch(err => {
    console.error('L1 FAILED:', err);
    process.exit(1);
});
