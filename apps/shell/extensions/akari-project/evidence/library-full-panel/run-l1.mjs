// L1 実機検証: ライブラリ面をパネル全体へ + サイドパネル最上部のタイトル帯（「素材」）を畳む。
// タスク: 2026-09-03-library-full-panel（オーナー指示 2026-09-03）
// 起動は外側（Electron 直接起動）が担う。ここでは既に起動済みインスタンスに CDP で
// アタッチし、DOM 実測 + スクショのみ行う。様式は left-panel-split / catalog-tab を踏襲。
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';

const PORT = process.env.CDP_PORT || '32951';
const OUT_DIR = new URL('.', import.meta.url).pathname;
const log = {};

function record(key, value) {
    log[key] = value;
    console.log(`[${key}]`, JSON.stringify(value));
}

async function waitFor(cdp, expression, timeoutMs = 20000, intervalMs = 500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const last = await evalMain(cdp, expression, 20000);
            if (last) return last;
        } catch (err) {
            console.warn('  (waitFor retry after transient error)', err.message);
        }
        await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms: ${expression}`);
}

/** 左パネルの実測。タイトル帯の可視性・レイアウト種別・できたものの有無・ライブラリ面の高さ。 */
const PROBE = `(() => {
    const widget = document.querySelector('#akari-role-buckets-widget');
    const bar = document.querySelector('.theia-sidepanel-toolbar.theia-left-side-panel');
    const r = el => el ? el.getBoundingClientRect() : null;
    const barRect = r(bar);
    const root = widget && widget.querySelector('[data-akari-left-panel-layout]');
    const paneRect = r(root);
    const outputsRefresh = widget && widget.querySelector('[data-akari-outputs-refresh]');
    const segments = widget
        ? Array.from(widget.querySelectorAll('[data-akari-panel-segment]')).map(b => ({
            view: b.getAttribute('data-akari-panel-segment'),
            selected: b.getAttribute('aria-selected'),
            rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(b.getBoundingClientRect())
        }))
        : [];
    // 「素材」の文字がタイトル帯として画面に出ているか（帯が畳まれていれば高さ 0 / 非表示）
    const titleEl = bar ? bar.querySelector('.theia-sidepanel-title') : null;
    return {
        widgetFound: !!widget,
        titleBarPresent: !!bar,
        titleBarHiddenClass: bar ? bar.classList.contains('lm-mod-hidden') : null,
        titleBarHeight: barRect ? Math.round(barRect.height) : null,
        titleBarText: titleEl ? titleEl.innerText : null,
        layout: root ? root.getAttribute('data-akari-left-panel-layout') : null,
        outputsPanePresent: !!outputsRefresh,
        outputCardCount: widget ? widget.querySelectorAll('[data-akari-output-path]').length : null,
        materialCardCount: widget ? widget.querySelectorAll('[data-akari-material-path]').length : null,
        paneTop: paneRect ? Math.round(paneRect.top) : null,
        paneHeight: paneRect ? Math.round(paneRect.height) : null,
        segments
    };
})()`;

async function clickSegment(cdp, view) {
    const rect = await evalMain(cdp, `(() => {
        const b = document.querySelector('[data-akari-panel-segment="${view}"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!rect) throw new Error(`segment not found: ${view}`);
    await realClick(cdp, rect.x, rect.y);
    await sleep(900);
}

/** activity bar の n 番目のアイコンをクリック（0 = 素材 / 1 = 検索）。 */
async function clickActivityIcon(cdp, index) {
    const rect = await evalMain(cdp, `(() => {
        const tabs = document.querySelectorAll('.theia-app-left .lm-TabBar-tab:not(.lm-mod-hidden)');
        const t = tabs[${index}];
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), count: tabs.length };
    })()`);
    if (!rect) throw new Error(`activity icon not found: index=${index}`);
    await realClick(cdp, rect.x, rect.y);
    await sleep(900);
    return rect;
}

async function main() {
    const cdp = await connectMain(PORT);
    await evalMain(cdp, `(() => { window.__errCount = 0; window.addEventListener('error', () => { window.__errCount++; }); true; })()`);

    // --- 0. boot: プロジェクト面 = 上下 2 分割のまま / タイトル帯は畳まれている --------
    await waitFor(cdp, `!!document.querySelector('#akari-role-buckets-widget')`, 90000);
    await sleep(2500); // 素材・できたものの非同期ロード猶予
    record('00-boot-project-face', await evalMain(cdp, PROBE));
    await screenshot(cdp, OUT_DIR + '00-boot-project-face.png');

    // --- 1. ライブラリ面へ: できたものが消え、1 面がパネル全体を占める -----------------
    await clickSegment(cdp, 'catalog');
    await sleep(1200);
    record('01-library-face', await evalMain(cdp, PROBE));
    await screenshot(cdp, OUT_DIR + '01-library-face-full-panel.png');

    // --- 2. プロジェクト面へ戻す: できたものが戻る（撤去ではなく面の切り替え） ---------
    await clickSegment(cdp, 'materials');
    await sleep(1200);
    record('02-back-to-project-face', await evalMain(cdp, PROBE));
    await screenshot(cdp, OUT_DIR + '02-back-to-project-face.png');

    // --- 3. 検索ビューへ切替: タイトル帯が戻る（他ビューの回帰） -----------------------
    const searchIcon = await clickActivityIcon(cdp, 1);
    record('03-search-view-title-bar', {
        icon: searchIcon,
        ...(await evalMain(cdp, `(() => {
            const bar = document.querySelector('.theia-sidepanel-toolbar.theia-left-side-panel');
            const titleEl = bar ? bar.querySelector('.theia-sidepanel-title') : null;
            return {
                titleBarHiddenClass: bar ? bar.classList.contains('lm-mod-hidden') : null,
                titleBarHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
                titleBarText: titleEl ? titleEl.innerText : null
            };
        })()`))
    });
    await screenshot(cdp, OUT_DIR + '03-search-view-title-bar-restored.png');

    // --- 4. 素材ビューへ戻す: 再びタイトル帯が畳まれる --------------------------------
    await clickActivityIcon(cdp, 0);
    await sleep(1200);
    record('04-back-to-assets-view', await evalMain(cdp, PROBE));
    await screenshot(cdp, OUT_DIR + '04-back-to-assets-view.png');

    record('99-errCount', await evalMain(cdp, 'window.__errCount'));
    await writeFile(OUT_DIR + 'run-log.json', JSON.stringify(log, undefined, 2) + '\n');
    console.log('\nrun-log.json written');
    cdp.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
