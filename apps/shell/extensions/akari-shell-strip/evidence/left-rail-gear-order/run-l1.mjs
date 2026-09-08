// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-08-left-rail-gear-order-and-output-rows 指示9。
//
// 使い方:
//   node run-l1.mjs <ワークスペース絶対パス> <ラベル> <CDP ポート> [プロファイル絶対パス]
//
// 第 4 引数にプロファイルを渡すと**そのディレクトリを使い回す**（= 保存レイアウトあり
// の 2 回目起動）。渡さないと mkdtemp した新規プロファイル（= 保存レイアウト無し）で
// 起動し、終了時にも消さずにパスを標準出力へ返すので、2 回目でそれを渡せる。
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて一時プロファイル配下に向けてあり、
// 実利用の ~/.theia ~/.akari ~/.config/akari-video は読み書きしない。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// このファイルは <repo>/apps/shell/extensions/akari-shell-strip/evidence/left-rail-gear-order/ にある。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw, profileArg] = process.argv;
const port = Number(portRaw ?? 21990);
const outDir = process.env.AKARI_L1_OUT ?? path.join(tmpdir(), 'akari-l1-left-rail-out');
mkdirSync(outDir, { recursive: true });
const profile = profileArg ?? mkdtempSync(path.join(tmpdir(), 'akari-l1-left-'));
const reusedProfile = !!profileArg;
const log = [];

const child = spawn(ELECTRON, [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'), ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');

/** Electron 本体 + Helper（GPU/Renderer）を profile パスで名指しして掃除する。 */
const killAll = () => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    for (const needle of [profile, `${SHELL} ${workspace}`]) {
        try { execFileSync('/usr/bin/pkill', ['-9', '-f', needle], { stdio: 'ignore' }); } catch { /* none left */ }
    }
};

/**
 * レイアウトは Theia の ShellLayoutRestorer が unload 時に localStorage へ書く。
 * SIGKILL だと保存されず「保存レイアウトあり」の 2 回目が作れないので、まず
 * renderer から window.close() して正規の終了経路を通し、そのあとで掃除する。
 */
const shutdown = async page => {
    // AKARI_L1_HARD_KILL=1 は逆に「保存させたくない」とき（下記 tamper 後）に使う。
    if (page && process.env.AKARI_L1_HARD_KILL !== '1') {
        try { await page.evaluate(() => window.close()); } catch { /* already closing */ }
        await sleep(6000);
    }
    killAll();
    await sleep(800);
};

/**
 * 本件の再現条件（歯車が保存レイアウトに無い = 歯車が増える前の版が書いたレイアウト）を
 * 人工的に作る。保存済みレイアウト（localStorage の `…:layout`）から指定 widget の
 * エントリを落として書き戻す。書き戻しが Theia 自身の保存に負けないようにする細工は
 * 下のコメント（'unload' リスナの登録順）を参照。呼び出し側は正規終了（HARD_KILL なし）で
 * 閉じること — SIGKILL では Chromium が leveldb へコミットする前に落ちる。
 */
const tamperLayout = (page, dropIds) => page.evaluate(ids => {
    const keys = Object.keys(localStorage);
    const layoutKey = keys.find(k => k.endsWith(':layout'));
    if (!layoutKey) { return { layoutKey: null }; }
    const raw = localStorage.getItem(layoutKey);
    // Theia の LocalStorageService は値を JSON 文字列として保存するため、レイアウト本体は
    // 二重エンコード（文字列を JSON.parse するともう一段 JSON 文字列が出てくる）。
    let data;
    try {
        data = JSON.parse(raw);
        if (typeof data === 'string') { data = JSON.parse(data); }
    } catch (error) { return { layoutKey, parseError: String(error) }; }
    const idsOf = item => {
        let widget = item && item.widget;
        if (typeof widget === 'string') { try { widget = JSON.parse(widget); } catch { return []; } }
        const options = widget && widget.constructionOptions;
        return [options && options.factoryId, options && options.options && options.options.id].filter(Boolean);
    };
    if (!data.leftPanel || !Array.isArray(data.leftPanel.items)) {
        return { layoutKey, topLevelKeys: Object.keys(data).slice(0, 40), raw: raw.slice(0, 1200) };
    }
    const items = data.leftPanel.items;
    const before = items.map(idsOf);
    const canary = localStorage.getItem('akari-l1-canary');
    if (!ids.length) { return { layoutKey, before, after: before, dropped: [], canary }; }
    data.leftPanel.items = items.filter(item => !idsOf(item).some(id => ids.includes(id)));
    const tampered = JSON.stringify(JSON.stringify(data));
    localStorage.setItem(layoutKey, tampered);
    localStorage.setItem('akari-l1-canary', String(Date.now()));
    // 書いた値を Chromium が leveldb へ確実にコミットするには正規終了（window.close）が要る
    // （SIGKILL では未コミットの書き込みが落ちる — 実測）。ところが正規終了経路では Theia の
    // ShellLayoutRestorer が現在のレイアウト（歯車入り）で上書きしてしまう:
    // default-window-service.js が startup 時に張る window 'unload' → onUnload →
    // frontend-application.js の storeLayout。同種リスナは登録順に走るので、**後から**
    // 'unload' を張って最後にもう一度書けば、こちらの値が最終状態になる。
    window.addEventListener('unload', () => localStorage.setItem(layoutKey, tampered));
    window.addEventListener('beforeunload', () => localStorage.setItem(layoutKey, tampered));
    return { layoutKey, before, after: data.leftPanel.items.map(idsOf), dropped: ids, writeGuardInstalled: true };
}, dropIds);

const finish = async (measurements, page) => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    measurements.profile = profile;
    measurements.reusedProfile = reusedProfile;
    await shutdown(page);
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify(measurements, null, 2));
    console.log(`PROFILE=${profile}`);
};

const readState = page => page.evaluate(() => {
    const rectOf = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    // (a) 左レール（activity bar）のタブ順。Theia の TabBarRenderer は tab の DOM id を
    //     'shell-tab-' + widget.id で振るので、そこから widget id を復元する。
    //     SideTabBar は寸法計測用の隠しノード（id 末尾 '-hidden'）と、サイドパネルの
    //     DockPanel が持つ 0px の内部 TabBar（id が 'tab-key-*'）も同じ親の下に置くので、
    //     実寸を持つ 'shell-tab-' 由来のタブだけを「見えているレール」として採る。
    const allTabs = [...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].map(tab => ({
        id: (tab.id || '').replace(/^shell-tab-/, ''),
        title: tab.getAttribute('title') || tab.textContent.trim(),
        icon: (tab.querySelector('.lm-TabBar-tabIcon') || {}).className || null,
        rect: rectOf(tab)
    }));
    const railTabs = allTabs.filter(t => t.id && !t.id.endsWith('-hidden') && !t.id.startsWith('tab-key-') && t.rect.w > 0 && t.rect.h > 0);
    // (b)(c) 「できたもの」編集データグループの行。
    const group = document.querySelector('[data-akari-outputs-group="data"]');
    const dataRows = !group ? [] : [...group.querySelectorAll('[data-akari-output-path]')].map(row => {
        const iconNode = row.querySelector('span[aria-hidden="true"][class*="codicon"]');
        // 行の子は [アイコン枠 div, テキスト列 div, ファイルマネージャで表示ボタン]。
        // ラベルはテキスト列の 1 つ目の span（2 つ目はメタ行）。
        const textColumn = row.children[1];
        const labelNode = textColumn ? textColumn.querySelector('span') : null;
        const style = labelNode ? getComputedStyle(labelNode) : null;
        const rowStyle = getComputedStyle(row);
        return {
            path: row.getAttribute('data-akari-output-path'),
            kind: row.getAttribute('data-akari-output-kind'),
            emphasis: row.getAttribute('data-akari-output-emphasis'),
            icon: iconNode ? iconNode.className : null,
            iconOpacity: iconNode ? getComputedStyle(iconNode).opacity : null,
            labelText: labelNode ? labelNode.textContent.trim() : null,
            labelFontWeight: style ? style.fontWeight : null,
            labelFontSize: style ? style.fontSize : null,
            borderLeft: `${rowStyle.borderLeftWidth} ${rowStyle.borderLeftStyle}`,
            background: rowStyle.backgroundColor,
            padding: rowStyle.padding,
            rect: rectOf(row)
        };
    });
    const groups = [...document.querySelectorAll('[data-akari-outputs-group]')]
        .map(node => node.getAttribute('data-akari-outputs-group'));
    return {
        allTabs,
        railTabs,
        railOrder: railTabs.map(t => t.id),
        dataRows,
        dataOrder: dataRows.map(r => r.path),
        outputGroups: groups,
        roleBucketsAttached: !!document.querySelector('#akari-role-buckets-widget'),
        settingsOpenerAttached: !!document.querySelector('#akari-settings-opener'),
        menuAttached: !!document.querySelector('#akari-menu-widget'),
        preloadVisible: !!document.querySelector('.theia-preload')
    };
});

let browser;
const measurements = { label, workspace, timeline: [] };
try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) throw new Error('CDP connect failed');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    for (let i = 0; i < 24; i++) {            // up to 4 minutes, sample every 10 s
        await sleep(10000);
        const state = await readState(page);
        measurements.timeline.push({
            atSeconds: (i + 1) * 10,
            ready: text().includes("to 'ready'"),
            railOrder: state.railOrder,
            dataOrder: state.dataOrder
        });
        if (text().includes("to 'ready'") && state.railTabs.length >= 5) break;
    }
    // 「できたもの」が DOM に無いときだけ「素材」タブを選び直す（歯車は押さない —
    // onActivateRequest が左パネルを畳んで設定ダイアログを開いてしまうため）。
    let state = await readState(page);
    if (!state.dataRows.length) {
        for (const id of ['akari-role-buckets-widget', 'explorer-view-container']) {
            const tab = await page.$(`#theia-left-content-panel .lm-TabBar-tab[id="shell-tab-${id}"]`);
            if (!tab) { continue; }
            await tab.click({ timeout: 8000 }).catch(() => undefined);
            await sleep(4000);
            state = await readState(page);
            if (state.dataRows.length) { break; }
        }
    }
    await sleep(2000);
    Object.assign(measurements, await readState(page));
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    const rail = await page.$('#theia-left-content-panel .lm-TabBar');
    if (rail) { await rail.screenshot({ path: path.join(outDir, `${label}-rail.png`) }).catch(() => undefined); }
    const outputs = await page.$('[data-akari-outputs-group="data"]');
    if (outputs) { await outputs.screenshot({ path: path.join(outDir, `${label}-outputs.png`) }).catch(() => undefined); }
    const drop = process.env.AKARI_L1_LAYOUT_DROP ? process.env.AKARI_L1_LAYOUT_DROP.split(',') : [];
    measurements.storedLayout = await tamperLayout(page, drop).catch(e => ({ error: String(e).split('\n')[0] }));
    if (drop.length) { await sleep(10000); }   // Chromium が localStorage を leveldb へコミットするのを待つ
    await finish(measurements, page);
    process.exit(0);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish(measurements, undefined);
    process.exit(1);
}
