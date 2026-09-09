// L1 harness (wrapper-authored, verification-only; not product source).
//
// 使い方:
//   cd apps/shell && npm run build
//   node extensions/akari-shell-strip/evidence/small-cleanup/run-l1.mjs <ワークスペース絶対パス> <ラベル> [CDPポート] [出力ディレクトリ]
//
// 何を測るか（task 2026-09-09-small-cleanup-partner-open-centering-catalog-root の指示 4）:
//   1. メニュー「ひらく」の「パートナー」行を押す前後で
//      - 右ドックで前面になるタブが「パートナーを追加」になること
//      - onboarding の状態（data-akari-flow-state / 接続ダイアログ / ターミナルタブ）が
//        変わらないこと
//   2. 対照として `akari.partner.beginOnboarding` を直接実行し、
//      同じ観測点が確かに変わること（= 観測点が鈍感でないことの証明）
//   3. 設定ダイアログの「道具」ページに `akari.catalog.root` の行（パス入力 +
//      フォルダ選択ボタン + 説明）が出ること
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME / AKARI_CREDENTIALS_FILE は
// すべて使い捨ての一時プロファイルへ向ける（実利用の ~/.theia ~/.akari ~/.config/akari-video を触らない）。
// Electron は detached にせず、finish() で PID 指名 kill する。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// .../apps/shell/extensions/akari-shell-strip/evidence/small-cleanup → リポ直下まで 6 階層上がる
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../../..');
const require = createRequire(path.join(REPO, 'apps/shell/package.json'));
const { chromium } = require('playwright-core');

const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw, outRaw] = process.argv;
const port = Number(portRaw ?? 21996);
const outDir = outRaw ?? '/tmp/small-cleanup-l1/out';
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-cleanup-'));
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

// 起動ログ・計測 JSON に作業機のパスを残さない（wrapper-codex.md 2026-09-09 追記）。
const REPLACEMENTS = [
    [profile, '<TMP>'],
    [outDir, '<OUT>'],
    [workspace, '<WORKSPACE>'],
    [REPO, '<WORKTREE>'],
    [process.env.HOME, '<HOME>']
];
const scrub = value => REPLACEMENTS
    .reduce((text, [needle, token]) => needle ? text.split(needle).join(token) : text, String(value))
    .replace(/\/private\/var\/folders\/[^\s"',)]*/g, '<TMP>')
    .replace(/\/var\/folders\/[^\s"',)]*/g, '<TMP>');

const finish = async (measurements, code) => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    writeFileSync(path.join(outDir, `${label}-log.txt`), scrub(text()));
    writeFileSync(path.join(outDir, `measurements-${label}.json`), scrub(JSON.stringify(measurements, null, 2)));
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await sleep(2000);
    for (let attempt = 0; attempt < 5; attempt++) {
        try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(1500); }
    }
    console.log(scrub(JSON.stringify(measurements, null, 2)));
    process.exit(code);
};

/** onboarding の「状態」を観測する 1 か所（押す前後で同じ関数を使う）。 */
const READ_STATE = () => {
    const rect = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const tabsOf = (selector, orientation) => {
        const bars = [...document.querySelectorAll(`${selector} .lm-TabBar[data-orientation="${orientation}"]`)];
        return bars.flatMap((bar, barIndex) => [...bar.querySelectorAll('.lm-TabBar-tab')]
            .filter(tab => tab.getClientRects().length > 0)
            .map(tab => ({
                bar: barIndex,
                label: (tab.getAttribute('title') || tab.textContent || '').trim(),
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
    const partner = document.getElementById('akari-partner-onboarding');
    const flowNode = document.querySelector('[data-akari-flow-state]');
    const rightTabs = tabsOf('#theia-right-content-panel', 'vertical');
    return {
        rows,
        menuVisible: !!menu && menu.getClientRects().length > 0,
        rightTabs,
        rightFrontTab: (rightTabs.find(tab => tab.bar === 0 && tab.current) || {}).label ?? null,
        bottomTabs: tabsOf('#theia-bottom-content-panel', 'horizontal').map(tab => tab.label),
        // ---- onboarding の状態（この 5 点が「接続フローが始まっていない」の観測点） ----
        onboarding: {
            flowState: flowNode ? flowNode.getAttribute('data-akari-flow-state') : null,
            dialogCount: document.querySelectorAll('.dialogOverlay').length,
            dialogTitles: [...document.querySelectorAll('.dialogTitle')].map(node => node.textContent.trim()),
            terminalTabs: [...document.querySelectorAll('.lm-TabBar-tab')]
                .map(tab => (tab.getAttribute('title') || tab.textContent || '').trim())
                .filter(title => /claude|codex|opencode|gemini|zsh|bash|ターミナル/i.test(title)),
            partnerVisible: !!partner && partner.getClientRects().length > 0,
            partnerTextLength: partner ? partner.innerText.length : 0
        }
    };
};

let browser;
let page;
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
/** 本番の CommandRegistry を DI コンテナから引いてコマンドを実行する。 */
const runCommand = async (id, arg) => evalOnPage(([commandId, commandArg]) => {
    const bindings = window.theia.container._bindingDictionary;
    const key = [...bindings._map.keys()].find(candidate =>
        typeof candidate === 'function'
        && typeof candidate.prototype?.executeCommand === 'function'
        && typeof candidate.prototype?.registerCommand === 'function');
    if (!key) { return { ok: false, reason: 'CommandRegistry not found' }; }
    const registry = window.theia.container.get(key);
    const known = !!registry.getCommand(commandId);
    void registry.executeCommand(commandId, commandArg);
    return { ok: true, known };
}, [id, arg]);
/** Lumino の TabBar は mousedown で切り替わるので実マウスクリックで押す。 */
const clickTab = async (selector, needle) => {
    const box = await evalOnPage(([sel, want]) => {
        const tab = [...document.querySelectorAll(`${sel} .lm-TabBar-tab`)]
            .filter(node => node.getClientRects().length > 0)
            .find(node => ((node.getAttribute('title') || node.textContent) || '').includes(want));
        if (!tab) { return null; }
        const r = tab.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, [selector, needle]);
    if (!box) { return false; }
    await (await livePage()).mouse.click(box.x, box.y);
    await sleep(3000);
    return true;
};

const measurements = { label, checks: {}, timeline: [] };
const failures = [];
const check = (name, ok, detail) => {
    measurements.checks[name] = { ok, detail };
    if (!ok) { failures.push(name); }
};

try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) { throw new Error('CDP connect failed'); }
    await livePage();

    for (let i = 0; i < 24; i++) {
        await sleep(10000);
        const state = await evalOnPage(READ_STATE);
        measurements.timeline.push({
            atSeconds: (i + 1) * 10,
            ready: text().includes("to 'ready'"),
            rightTabs: state.rightTabs.filter(tab => tab.bar === 0).map(tab => tab.label)
        });
        if (text().includes("to 'ready'") && state.rightTabs.filter(tab => tab.bar === 0).length >= 4) { break; }
    }
    await sleep(20000);

    // 起動直後はパートナータブが前面なので、まず別タブ（注釈）へ寄せておく。
    measurements.movedAwayFromPartner = await clickTab('#theia-right-content-panel', '注釈');
    const before = await evalOnPage(READ_STATE);
    measurements.before = before;
    await shot(`${label}-01-before-click`);

    // 左パネルの「メニュー」タブを開く（現在タブをもう一度押すと畳むので見えるまで押し直す）。
    let menuState = before;
    for (let attempt = 0; attempt < 3 && !menuState.menuVisible; attempt++) {
        await clickTab('#theia-left-content-panel', 'メニュー');
        menuState = await evalOnPage(READ_STATE);
    }
    measurements.menuVisible = menuState.menuVisible;
    measurements.rows = menuState.rows;
    check('menu-has-partner-row', menuState.rows.some(row => row.label === 'パートナー'),
        menuState.rows.map(row => row.label));
    await shot(`${label}-02-menu`);

    // 押す直前の状態（メニューを開く操作自体では状態が動いていないことも記録に残す）。
    const beforeClick = await evalOnPage(READ_STATE);
    measurements.beforeClick = beforeClick;

    // 「パートナー」行を押す（実マウスクリック）。
    const rowBox = await evalOnPage(() => {
        const menu = document.querySelector('#akari-menu-widget');
        const button = menu && [...menu.querySelectorAll('section button')]
            .find(node => ((node.querySelector('span:last-child') || node).textContent || '').trim() === 'パートナー');
        if (!button) { return null; }
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rowBox) { throw new Error('menu row パートナー not found'); }
    await (await livePage()).mouse.click(rowBox.x, rowBox.y);
    await sleep(8000);
    const after = await evalOnPage(READ_STATE);
    measurements.after = after;
    await shot(`${label}-03-after-click`);

    check('partner-tab-front-after-row-click', after.rightFrontTab === 'パートナーを追加',
        { beforeClick: beforeClick.rightFrontTab, after: after.rightFrontTab });
    check('onboarding-unchanged-after-row-click',
        beforeClick.onboarding.flowState === after.onboarding.flowState
        && beforeClick.onboarding.dialogCount === after.onboarding.dialogCount
        && JSON.stringify(beforeClick.onboarding.dialogTitles) === JSON.stringify(after.onboarding.dialogTitles)
        && JSON.stringify(beforeClick.onboarding.terminalTabs) === JSON.stringify(after.onboarding.terminalTabs),
        { beforeClick: beforeClick.onboarding, after: after.onboarding });

    // 設定ダイアログの「道具」ページに akari.catalog.root の行が出るか。
    measurements.settingsCommand = await runCommand('akari.settings.open', { section: 'tools' });
    await sleep(8000);
    // 道具チェックが揃うとページが伸びてカタログ行が折り返し下へ落ちる。
    // 一番下までスクロールしてから測る（sticky bar が実際に貼り付く = 重なりの最悪ケース）。
    measurements.settingsScroll = await evalOnPage(() => {
        const section = document.querySelector('#akari-settings-tools');
        if (!section) { return null; }
        section.scrollTop = section.scrollHeight;
        return { scrollTop: section.scrollTop, scrollHeight: section.scrollHeight, clientHeight: section.clientHeight };
    });
    await sleep(2000);
    const settings = await evalOnPage(() => {
        const dialog = document.querySelector('[data-akari-settings-dialog]');
        const section = document.querySelector('#akari-settings-tools');
        if (!dialog || !section) { return { dialogPresent: !!dialog, sectionPresent: !!section }; }
        const box = node => {
            if (!node) { return null; }
            const r = node.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        // 道具パネルの「選んだ道具をインストール」行は position: sticky・不透明背景・
        // margin-bottom: -20px なので、後ろに置いた行を覆いうる。矩形で重なりを測る。
        const installRow = section.querySelector('[data-akari-tool-install-selected]');
        const catalogInput = [...section.querySelectorAll('input[type=text]')]
            .find(node => /カタログ|素材/.test(node.getAttribute('aria-label') ?? ''));
        const catalogLabel = [...section.querySelectorAll('label')]
            .find(node => /カタログ|素材/.test(node.textContent ?? ''));
        const overlap = (a, b) => (a && b)
            ? Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
            : null;
        const installBox = box(installRow ? installRow.parentElement : null);
        const labelBox = box(catalogLabel);
        const inputBox = box(catalogInput);
        return {
            dialogPresent: true,
            sectionPresent: true,
            sectionHidden: !!section.hidden,
            heading: (section.querySelector('h2') || {}).textContent ?? null,
            inputs: [...section.querySelectorAll('input[type=text]')].map(node => ({
                ariaLabel: node.getAttribute('aria-label'),
                value: node.value,
                className: node.className
            })),
            buttons: [...section.querySelectorAll('button')].map(node => node.textContent.trim()),
            labels: [...section.querySelectorAll('label')].map(node => node.textContent.trim()).filter(Boolean),
            paragraphs: [...section.querySelectorAll('p')].map(node => node.textContent.trim()).filter(Boolean),
            rects: { installActionsRow: installBox, catalogLabel: labelBox, catalogInput: inputBox },
            verticalOverlapPx: {
                label: overlap(installBox, labelBox),
                input: overlap(installBox, inputBox)
            },
            // 覆われていれば elementFromPoint はインストール行側を返す。
            topElementAtCatalogLabel: labelBox
                ? (node => node ? `${node.tagName}${node.getAttribute('aria-label') ? `[${node.getAttribute('aria-label')}]` : ''}${node.textContent ? `:${node.textContent.trim().slice(0, 24)}` : ''}` : null)(
                    document.elementFromPoint(labelBox.x + 8, labelBox.y + Math.round(labelBox.h / 2)))
                : null
        };
    });
    measurements.settingsTools = settings;
    await shot(`${label}-04-settings-tools`);
    try {
        const node = await (await livePage()).$('#akari-settings-tools');
        if (node) { await node.screenshot({ path: path.join(outDir, `${label}-04-settings-tools-section.png`) }); }
    } catch { /* best effort */ }
    const catalogRow = (settings.inputs ?? []).some(input => /カタログ|素材/.test(input.ariaLabel ?? ''))
        || (settings.labels ?? []).some(t => /カタログ|素材/.test(t));
    check('settings-tools-has-catalog-root-row', catalogRow, settings);
    check('settings-tools-has-folder-picker',
        (settings.buttons ?? []).some(t => t.includes('フォルダ')), settings.buttons);
    check('catalog-row-not-covered-by-install-bar',
        (settings.verticalOverlapPx?.label ?? 0) === 0 && (settings.verticalOverlapPx?.input ?? 0) === 0
        && /カタログ|素材|LABEL|INPUT/.test(settings.topElementAtCatalogLabel ?? ''),
        { rects: settings.rects, overlap: settings.verticalOverlapPx, top: settings.topElementAtCatalogLabel });

    // ダイアログを閉じる。
    try { await (await livePage()).keyboard.press('Escape'); } catch { /* best effort */ }
    await sleep(5000);

    // 対照: beginOnboarding を直接実行すると同じ観測点が変わること。
    measurements.beginOnboardingCommand = await runCommand('akari.partner.beginOnboarding');
    await sleep(15000);
    const contrast = await evalOnPage(READ_STATE);
    measurements.contrast = contrast;
    await shot(`${label}-05-after-begin-onboarding`);
    check('begin-onboarding-does-change-state',
        contrast.onboarding.dialogCount !== after.onboarding.dialogCount
        || contrast.onboarding.flowState !== after.onboarding.flowState
        || JSON.stringify(contrast.onboarding.terminalTabs) !== JSON.stringify(after.onboarding.terminalTabs),
        { afterRowClick: after.onboarding, afterBeginOnboarding: contrast.onboarding });

    measurements.failures = failures;
    measurements.pass = failures.length === 0;
    await finish(measurements, failures.length === 0 ? 0 : 2);
} catch (error) {
    measurements.error = scrub(String(error && error.stack ? error.stack : error));
    measurements.failures = failures;
    measurements.pass = false;
    await finish(measurements, 2);
}
