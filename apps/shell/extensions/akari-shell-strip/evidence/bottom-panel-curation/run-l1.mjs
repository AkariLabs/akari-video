// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-08-bottom-panel-plus-button の L1 evidence (a)〜(d) を実機で採る。
//
// 使い方:
//   node run-l1.mjs <ワークスペース絶対パス> <ラベル> <CDP ポート> [プロファイル絶対パス]
//
// env:
//   AKARI_L1_PHASE=setup    下パネルに タイムライン / ターミナル×2 / 問題 / 出力 /
//                           デバッグコンソール を開いてから正規終了（= 次回の「前セッション」）
//   AKARI_L1_PHASE=observe   観測とスクショだけ（既定）
//   AKARI_L1_PHASE=plus      観測 →「+」クリック → プルダウン → 「ターミナル」を選ぶ
//   AKARI_L1_PHASE=tamper    観測 → 保存レイアウトの端末 1 本目の kind を akari-partner に
//                           書き換えて正規終了（パートナー端末が bottom にある最悪ケースを作る）
//   AKARI_L1_DEV_MODE=1     起動前に <profile>/.theia/settings.json へ akari.developerMode=true
//   AKARI_L1_OUT            出力先ディレクトリ
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて一時プロファイル配下に向けてあり、
// 実利用の ~/.theia ~/.akari ~/.config/akari-video は読み書きしない。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw, profileArg] = process.argv;
const port = Number(portRaw ?? 22990);
const phase = process.env.AKARI_L1_PHASE ?? 'observe';
const outDir = process.env.AKARI_L1_OUT ?? path.join(tmpdir(), 'akari-l1-bottom-out');
mkdirSync(outDir, { recursive: true });
const profile = profileArg ?? mkdtempSync(path.join(tmpdir(), 'akari-l1-bottom-'));
mkdirSync(path.join(profile, '.theia'), { recursive: true });
// 端末のプロンプトに作業機のユーザー名・ホスト名が出ると証跡そのものが機械を特定するので、
// 隔離 HOME の .zshrc で固定プロンプトへ差し替える（Theia の端末は `zsh -l` で起動する）。
writeFileSync(path.join(profile, '.zshrc'), "PROMPT='akari %% '\nRPROMPT=''\n");
writeFileSync(path.join(profile, '.zprofile'), "PROMPT='akari %% '\nRPROMPT=''\n");
if (process.env.AKARI_L1_DEV_MODE === '1') {
    writeFileSync(path.join(profile, '.theia/settings.json'), JSON.stringify({ 'akari.developerMode': true }, null, 2));
}
const log = [];

const child = spawn(ELECTRON, [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'), ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');

const killAll = () => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    for (const needle of [profile, `${SHELL} ${workspace}`]) {
        try { execFileSync('/usr/bin/pkill', ['-9', '-f', needle], { stdio: 'ignore' }); } catch { /* none left */ }
    }
};

/** setup / tamper は保存レイアウトを次回へ渡すので正規終了させる（SIGKILL では localStorage が leveldb へ落ちない）。 */
const shutdown = async page => {
    if (page && (phase === 'setup' || phase === 'tamper')) {
        try { await page.evaluate(() => window.close()); } catch { /* already closing */ }
        await sleep(8000);
    }
    killAll();
    await sleep(800);
};

/** 下パネル・右ドック・「+」・プルダウンの実測。widget id はタブ DOM id（shell-tab-<id>）から復元する。 */
const readState = page => page.evaluate(() => {
    const rectOf = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const tabsOf = rootId => {
        const root = document.getElementById(rootId);
        if (!root) { return []; }
        return [...root.querySelectorAll('.lm-TabBar-tab')].map(tab => ({
            id: (tab.id || '').replace(/^shell-tab-/, ''),
            label: (tab.querySelector('.lm-TabBar-tabLabel') || {}).textContent || tab.textContent.trim(),
            title: tab.getAttribute('title') || '',
            rect: rectOf(tab)
        })).filter(t => t.id && !t.id.endsWith('-hidden') && t.rect.w > 0 && t.rect.h > 0);
    };
    const bottomRoot = document.getElementById('theia-bottom-content-panel');
    const addButtons = !bottomRoot ? [] : [...bottomRoot.querySelectorAll('.lm-TabBar-addButton')].map(node => ({
        text: node.textContent,
        title: node.title,
        ariaLabel: node.getAttribute('aria-label'),
        hidden: node.classList.contains('lm-mod-hidden'),
        inTabRow: !!node.closest('.theia-tabBar-tab-row'),
        rect: rectOf(node)
    }));
    const popup = document.querySelector('[data-akari-bottom-panel-menu]');
    return {
        bottomTabs: tabsOf('theia-bottom-content-panel'),
        bottomTabIds: tabsOf('theia-bottom-content-panel').map(t => t.id),
        rightTabIds: tabsOf('theia-right-content-panel').map(t => t.id),
        mainTabIds: tabsOf('theia-main-content-panel').map(t => t.id),
        bottomPanelHidden: bottomRoot ? bottomRoot.classList.contains('lm-mod-hidden') : null,
        addButtons,
        popupItems: popup ? [...popup.querySelectorAll('button')].map(b => b.textContent) : null
    };
});

/** 保存レイアウト（localStorage の `…:layout`）を読む・書き換える。二重 JSON エンコードに注意。 */
const layoutOp = (page, mode) => page.evaluate(op => {
    const key = Object.keys(localStorage).find(k => k.endsWith(':layout'));
    if (!key) { return { key: null }; }
    const raw = localStorage.getItem(key);
    let data;
    try { data = JSON.parse(raw); if (typeof data === 'string') { data = JSON.parse(data); } }
    catch (error) { return { key, parseError: String(error) }; }

    // ネストした widget 記述（JSON 文字列で埋まっていることがある）まで降りて歩く。
    const descriptions = [];
    let patched = 0;
    const walk = value => {
        if (typeof value === 'string') {
            const t = value.trim();
            if (!t.startsWith('{') && !t.startsWith('[')) { return value; }
            try { return JSON.stringify(walk(JSON.parse(value))); } catch { return value; }
        }
        if (Array.isArray(value)) { return value.map(walk); }
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) { out[k] = walk(v); }
            const options = out.constructionOptions;
            if (options && typeof options === 'object') {
                descriptions.push({ factoryId: options.factoryId, options: options.options });
                if (op === 'tamper' && options.factoryId === 'terminal' && patched === 0) {
                    options.options = { ...(options.options || {}), kind: 'akari-partner' };
                    patched += 1;
                }
            }
            return out;
        }
        return value;
    };
    const bottom = walk(data.bottomPanel ?? null);
    const bottomDescriptions = descriptions.slice();
    descriptions.length = 0;
    const next = { ...data, bottomPanel: bottom };
    walk(data.rightPanel ?? null);
    const rightDescriptions = descriptions.slice();
    const result = {
        key,
        bottom: bottomDescriptions.map(d => ({ factoryId: d.factoryId, options: d.options })),
        right: rightDescriptions.map(d => ({ factoryId: d.factoryId, options: d.options })),
        patched
    };
    if (op !== 'tamper') { return result; }
    const tampered = JSON.stringify(JSON.stringify(next));
    localStorage.setItem(key, tampered);
    // Theia 自身が unload 時に現在（掃除後）のレイアウトで上書きするので、あとから
    // unload を張って最後にもう一度書く（同種リスナは登録順に走る）。
    window.addEventListener('unload', () => localStorage.setItem(key, tampered));
    window.addEventListener('beforeunload', () => localStorage.setItem(key, tampered));
    result.writeGuardInstalled = true;
    return result;
}, mode);

const shot = async (page, name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const shotOf = async (page, selector, name) => {
    const node = await page.$(selector);
    if (node) { await node.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => undefined); }
};

const finish = async (measurements, page) => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    measurements.profile = profile;
    measurements.phase = phase;
    measurements.devMode = process.env.AKARI_L1_DEV_MODE === '1';
    await shutdown(page);
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify(measurements, null, 2));
    console.log(`PROFILE=${profile}`);
};

let browser;
const measurements = { label, workspace, timeline: [] };
try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) { throw new Error('CDP connect failed'); }
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    for (let i = 0; i < 24; i++) {
        await sleep(5000);
        measurements.timeline.push({ atSeconds: (i + 1) * 5, ready: text().includes("to 'ready'"), ...(await readState(page)) });
        if (text().includes("to 'ready'")) { break; }
    }
    await sleep(6000);   // レイアウト復元後の掃除（onDidInitializeLayout）まで待つ
    if (process.env.AKARI_L1_WIDE === '1') {
        // タブが 6 枚あると ToolbarAwareTabBar が既定幅ではアクティブ view のツールバーに
        // 押されてタブ列が見えなくなる。描画幅だけを広げる（アプリの状態には触らない）。
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1100, deviceScaleFactor: 1, mobile: false });
        await sleep(4000);
        measurements.wideViewport = { width: 2200, height: 1100 };
    }

    if (phase === 'setup') {
        // 「前セッション」を作る: タイムライン（コマンドパレット）+ 端末 2 本 + 問題 / 出力 / デバッグコンソール。
        await page.keyboard.press('F1');
        await sleep(1500);
        await page.keyboard.insertText('タイムラインを開く');
        await sleep(2500);
        await page.keyboard.press('Enter');
        await sleep(6000);
        measurements.afterTimeline = await readState(page);
        // キー入力は取りこぼすことがある（実測）ので、下パネルのタブが増えたかを毎回確かめて再試行する。
        const bottomIds = async () => (await readState(page)).bottomTabIds;
        const ensure = async (keys, matches, attempts = 3) => {
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                const before = (await bottomIds()).filter(matches).length;
                await page.keyboard.press(keys[attempt % keys.length]);
                await sleep(5000);
                if ((await bottomIds()).filter(matches).length > before) { return true; }
            }
            return false;
        };
        const isTerminal = id => id.startsWith('terminal-');
        // 端末は既定キーバインド（ctrl+shift+`）だと右ドックの activate 合戦に負けて取りこぼす
        // ことがあった（実測）。前セッションを作るだけなので、確実に効く「+」→「ターミナル」
        // （= 本タスクで足した導線そのもの）を使う。
        const plusTerminal = async (attempts = 3) => {
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                const before = (await bottomIds()).filter(isTerminal).length;
                const button = await page.$('#theia-bottom-content-panel .lm-TabBar-addButton:not(.lm-mod-hidden)');
                if (!button) { await sleep(3000); continue; }
                await button.click({ timeout: 8000 }).catch(() => undefined);
                await sleep(1500);
                for (const item of await page.$$('[data-akari-bottom-panel-menu] button')) {
                    if ((await item.textContent()) === 'ターミナル') { await item.click({ timeout: 8000 }).catch(() => undefined); break; }
                }
                await sleep(9000);
                if ((await bottomIds()).filter(isTerminal).length > before) { return true; }
            }
            return false;
        };
        measurements.setupResults = {
            terminalA: await plusTerminal(),
            terminalB: await plusTerminal(),
            problems: await ensure(['Meta+Shift+M'], id => id === 'problems'),
            output: await ensure(['Meta+Shift+U'], id => id === 'outputView'),
            debugConsole: await ensure(['Meta+Shift+Y'], id => id === 'debug-console')
        };
        await sleep(4000);
    }

    Object.assign(measurements, await readState(page));
    await shot(page, label);
    await shotOf(page, '#theia-bottom-content-panel', `${label}-bottom`);
    await shotOf(page, '#theia-bottom-content-panel .theia-tabBar-tab-row', `${label}-tabs`);
    measurements.storedLayout = await layoutOp(page, 'read').catch(e => ({ error: String(e).split('\n')[0] }));

    if (phase === 'plus') {
        const button = await page.$('#theia-bottom-content-panel .lm-TabBar-addButton:not(.lm-mod-hidden)');
        measurements.addButtonFound = !!button;
        if (button) {
            await button.click({ timeout: 8000 });
            await sleep(1500);
            measurements.menu = await readState(page);
            await shot(page, `${label}-menu`);
            await shotOf(page, '[data-akari-bottom-panel-menu]', `${label}-menu-popup`);
            const items = await page.$$('[data-akari-bottom-panel-menu] button');
            for (const item of items) {
                if ((await item.textContent()) === 'ターミナル') { await item.click({ timeout: 8000 }); break; }
            }
            await sleep(9000);
            measurements.afterTerminal = await readState(page);
            await shot(page, `${label}-terminal`);
            await shotOf(page, '#theia-bottom-content-panel', `${label}-terminal-bottom`);
            await shotOf(page, '#theia-bottom-content-panel .theia-tabBar-tab-row', `${label}-terminal-tabs`);
        }
    }

    if (phase === 'tamper') {
        measurements.tamper = await layoutOp(page, 'tamper').catch(e => ({ error: String(e).split('\n')[0] }));
        await sleep(6000);
    }

    await finish(measurements, page);
    process.exit(0);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish(measurements, undefined);
    process.exit(1);
}
