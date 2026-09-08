// L1 harness (wrapper-authored, verification-only; not product source).
//
// 使い方:
//   cd apps/shell && npm run build
//   AKARI_L1_ROWS='台本,カット候補,注釈,タイムライン' \
//     node extensions/akari-shell-strip/evidence/menu-rows/run-l1.mjs <ワークスペース絶対パス> <ラベル> [CDPポート] [出力ディレクトリ]
//
// 何を測るか:
//   1. 左パネル「メニュー」の「ひらく」セクションの行（並び・ラベル・アイコン class）
//   2. 右ドック縦タブの y 座標（= 間隔。注釈タブだけ離れていないか）
//   3. AKARI_L1_ROWS の各行を押したとき、右ドック（または下パネル）で前面になるタブ
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME / AKARI_CREDENTIALS_FILE は
// すべて使い捨ての一時プロファイルへ向ける（実利用の ~/.theia ~/.akari ~/.config/akari-video を触らない）。
// 起動直後にフロントエンドがリロードされる（パートナー CLI の配備など）ことがあるため、
// page が閉じたら context から取り直す（1 走目の `Target page ... has been closed` 対策）。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// .../apps/shell/extensions/akari-shell-strip/evidence/menu-rows → リポ直下まで 6 階層上がる
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../..');
const require = createRequire(path.join(REPO, 'apps/shell/package.json'));
const { chromium } = require('playwright-core');

const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw, outRaw] = process.argv;
const port = Number(portRaw ?? 21994);
const outDir = outRaw ?? '/tmp/menu-rows-l1/out';
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-menu-'));
const akariHome = path.join(profile, '.akari');
mkdirSync(akariHome, { recursive: true });
const log = [];

const child = spawn(ELECTRON, [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: {
        ...process.env,
        HOME: profile,
        THEIA_CONFIG_DIR: path.join(profile, '.theia'),
        AKARI_HOME: akariHome,
        AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
        ELECTRON_ENABLE_LOGGING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');

const finish = async (measurements) => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await sleep(2000);
    // Electron が終了しきる前だと ENOTEMPTY になることがあるので数回試す。
    for (let attempt = 0; attempt < 5; attempt++) {
        try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(1500); }
    }
    console.log(JSON.stringify(measurements, null, 2));
};

const READ_STATE = () => {
    const rect = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    // 同じ領域に複数の .lm-TabBar がある（サイドバーの縦アイコンバーと、展開中の
    // dockPanel 自身のタブバー）ので、どのバーに属するタブかを必ず記録する。
    const tabsOf = (selector, orientation) => {
        const bars = [...document.querySelectorAll(`${selector} .lm-TabBar[data-orientation="${orientation}"]`)];
        return bars.flatMap((bar, barIndex) => [...bar.querySelectorAll('.lm-TabBar-tab')]
            .filter(tab => tab.getClientRects().length > 0)
            .map(tab => ({
                bar: barIndex,
                barClass: bar.className,
                label: tab.getAttribute('title') || tab.textContent.trim(),
                icon: (tab.querySelector('.lm-TabBar-tabIcon') || {}).className || null,
                current: tab.classList.contains('lm-mod-current'),
                rect: rect(tab)
            })));
    };
    const menu = document.querySelector('#akari-menu-widget');
    const openSection = menu ? menu.querySelector('section') : undefined;
    const rows = openSection
        ? [...openSection.querySelectorAll('button')].map(button => ({
            label: (button.querySelector('span:last-child') || button).textContent.trim(),
            icon: (button.querySelector('span[aria-hidden]') || {}).className || null,
            disabled: button.disabled
        }))
        : [];
    const visible = id => {
        const node = document.getElementById(id);
        return !!node && node.getClientRects().length > 0;
    };
    return {
        rows,
        menuAttached: !!menu,
        menuVisible: !!menu && menu.getClientRects().length > 0,
        // 右サイドバーの縦アイコンバー（= 右ドックのタブ）だけを見る。
        rightTabs: tabsOf('#theia-right-content-panel', 'vertical'),
        // 展開中の右ドック内側にできる横タブ（同じ名前で重複するので分けて記録）。
        rightDockTabs: tabsOf('#theia-right-content-panel', 'horizontal'),
        bottomTabs: tabsOf('#theia-bottom-content-panel', 'horizontal'),
        leftTabs: tabsOf('#theia-left-content-panel', 'vertical'),
        visibleWidgets: {
            partner: visible('akari-partner-onboarding'),
            daihon: visible('akari-daihon-widget'),
            cuts: visible('akari-cuts-widget'),
            review: visible('akari-review-panel-widget'),
            timeline: visible('akari-annotations-widget'),
            menu: visible('akari-menu-widget')
        }
    };
};

let browser;
let page;
/** リロードで page が閉じても取り直して続行する。 */
const livePage = async () => {
    if (page && !page.isClosed()) { return page; }
    const context = browser.contexts()[0];
    for (let i = 0; i < 60; i++) {
        const candidate = context.pages().find(p => !p.isClosed() && !p.url().startsWith('devtools://'));
        if (candidate) {
            page = candidate;
            page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));
            await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
            return page;
        }
        await sleep(1000);
    }
    throw new Error('no live page');
};
const evalOnPage = async (fn, arg) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try { return await (await livePage()).evaluate(fn, arg); } catch (error) {
            if (attempt === 2) { throw error; }
            log.push(`[harness] retry evaluate after: ${String(error).split('\n')[0]}\n`);
            page = undefined;
            await sleep(3000);
        }
    }
};
const shot = async (name) => {
    try { await (await livePage()).screenshot({ path: path.join(outDir, `${name}.png`) }); } catch (error) {
        log.push(`[harness] screenshot ${name} failed: ${String(error).split('\n')[0]}\n`);
    }
};

const measurements = { label, workspace, timeline: [] };
try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) { throw new Error('CDP connect failed'); }
    await livePage();

    // ready 到達 + 右ドック 4 タブが出るまで待ち、そのあと 20 秒静置して
    // 起動直後のリロード（パートナー CLI 配備など）が済むのを待つ。
    for (let i = 0; i < 24; i++) {
        await sleep(10000);
        const state = await evalOnPage(READ_STATE);
        measurements.timeline.push({
            atSeconds: (i + 1) * 10,
            ready: text().includes("to 'ready'"),
            rightTabs: state.rightTabs.map(t => t.label)
        });
        if (text().includes("to 'ready'") && state.rightTabs.length >= 4) { break; }
    }
    await sleep(20000);

    // 1) 触る前の右ドック縦タブ（y 座標 = 間隔の一次証拠）
    const initial = await evalOnPage(READ_STATE);
    // 縦アイコンバー（bar 0 = SideTabBar）だけを間隔の一次証拠にする。
    const sideBar = tabs => tabs.filter(tab => tab.bar === 0);
    measurements.rightTabsInitial = initial.rightTabs;
    measurements.rightSideTabsInitial = sideBar(initial.rightTabs);
    measurements.rightTabGapsInitial = sideBar(initial.rightTabs).slice(1)
        .map((tab, i) => tab.rect.y - sideBar(initial.rightTabs)[i].rect.y);
    await shot(`${label}-startup`);
    // 右サイドバー（縦アイコンバー）だけを切り出した証跡。
    const railBox = await evalOnPage(() => {
        const bar = document.querySelector('#theia-right-content-panel .lm-TabBar[data-orientation="vertical"]');
        if (!bar) { return null; }
        const r = bar.getBoundingClientRect();
        return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: r.width + 8, height: Math.min(r.height, 420) };
    });
    if (railBox) {
        try { await (await livePage()).screenshot({ path: path.join(outDir, `${label}-rail.png`), clip: railBox }); } catch { /* best effort */ }
    }

    // 2) 左パネルの「メニュー」タブを開いて行を読む
    // Theia のサイドバーは「現在のタブをもう一度押す」と畳む。1 回押して畳まれてしまう
    // ことがあるので、実際に見えるまで押し直す。
    // Lumino の TabBar は mousedown で切り替えるので、element.click() では反応しない。
    // Playwright の実マウスクリック（elementHandle.click）を使う。サイドバーは
    // 「現在のタブをもう一度押す」と畳むので、実際に見えるまで押し直す。
    measurements.menuTabClicks = [];
    let menuState;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const box = await evalOnPage(() => {
                const tab = [...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')]
                    .filter(node => node.getClientRects().length > 0)
                    .find(node => (node.getAttribute('title') || node.textContent).includes('メニュー'));
                if (!tab) { return null; }
                const r = tab.getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            });
            if (!box) { measurements.menuTabClicks.push('no-tab'); } else {
                await (await livePage()).mouse.click(box.x, box.y);
                measurements.menuTabClicks.push(`clicked@${Math.round(box.x)},${Math.round(box.y)}`);
            }
        } catch (error) {
            measurements.menuTabClicks.push(`error: ${String(error).split('\n')[0]}`);
        }
        await sleep(4000);
        menuState = await evalOnPage(READ_STATE);
        if (menuState.menuVisible) { break; }
    }
    measurements.menuTabClick = measurements.menuTabClicks[measurements.menuTabClicks.length - 1];
    measurements.rows = menuState.rows;
    measurements.menuVisible = menuState.menuVisible;
    // ツールチップが行に被らないようポインタを退かしてから撮る。
    try { await (await livePage()).mouse.move(900, 900); } catch { /* best effort */ }
    await sleep(1500);
    await shot(`${label}-menu`);
    try {
        const menuBox = await (await livePage()).$('#akari-menu-widget');
        if (menuBox) { await menuBox.screenshot({ path: path.join(outDir, `${label}-menu-panel.png`) }); }
    } catch { /* best effort */ }

    // 3) 各行を押して、前面になるタブを記録する
    const targets = (process.env.AKARI_L1_ROWS ?? '').split(',').filter(Boolean);
    measurements.rowClicks = {};
    // 「タイムライン（下パネル）」行が本当に前面へ持ってくることを見るため、
    // 押す前に下パネルを別タブ（Problems など）へ切り替えておく。
    const focusOtherBottomTab = async () => {
        const box = await evalOnPage(() => {
            const tab = [...document.querySelectorAll('#theia-bottom-content-panel .lm-TabBar-tab')]
                .filter(node => node.getClientRects().length > 0)
                .find(node => !(node.getAttribute('title') || node.textContent).includes('タイムライン'));
            if (!tab) { return null; }
            const r = tab.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: tab.getAttribute('title') || tab.textContent.trim() };
        });
        if (!box) { return 'no-other-bottom-tab'; }
        await (await livePage()).mouse.click(box.x, box.y);
        await sleep(2500);
        const state = await evalOnPage(READ_STATE);
        return { switchedTo: box.label, bottomCurrent: state.bottomTabs.filter(t => t.current).map(t => t.label) };
    };

    for (const needle of targets) {
        if (needle.includes('タイムライン')) {
            measurements.bottomPreState = await focusOtherBottomTab();
        }
        const click = await evalOnPage((wanted) => {
            const menu = document.querySelector('#akari-menu-widget');
            const section = menu && menu.querySelector('section');
            if (!section) { return 'no-menu'; }
            const button = [...section.querySelectorAll('button')]
                .find(node => node.textContent.trim() === wanted)
                ?? [...section.querySelectorAll('button')].find(node => node.textContent.trim().includes(wanted));
            if (!button) { return 'no-row'; }
            button.click();
            return 'clicked';
        }, needle);
        await sleep(4000);
        const after = await evalOnPage(READ_STATE);
        measurements.rowClicks[needle] = {
            click,
            rightCurrent: after.rightTabs.filter(t => t.current).map(t => t.label),
            bottomCurrent: after.bottomTabs.filter(t => t.current).map(t => t.label),
            visibleWidgets: after.visibleWidgets,
            rightTabs: after.rightTabs.map(t => ({ label: t.label, current: t.current, y: t.rect.y })),
            bottomTabs: after.bottomTabs.map(t => ({ label: t.label, current: t.current }))
        };
        await shot(`${label}-click-${needle.replace(/[^0-9A-Za-zぁ-んァ-ヶー一-龥]/g, '')}`);
    }

    // 4) 右ドック縦タブの最終 y 座標（クリック後）
    const final = await evalOnPage(READ_STATE);
    measurements.rightTabsFinal = final.rightTabs;
    measurements.rightSideTabsFinal = sideBar(final.rightTabs);
    measurements.rightTabGapsFinal = sideBar(final.rightTabs).slice(1)
        .map((tab, i) => tab.rect.y - sideBar(final.rightTabs)[i].rect.y);
    await finish(measurements);
    process.exit(0);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish(measurements);
    process.exit(1);
}
