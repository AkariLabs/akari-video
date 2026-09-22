// L1 harness — 設定ダイアログ刷新（settings-dialog-refresh）。
//
//   L1_PORT=9457 L1_OUT=<出力ディレクトリ> L1_SETTINGS=<THEIA_CONFIG_DIR/settings.json> L1_MOCK_LOG=<模擬サーバーのログ> \
//   PLAYWRIGHT_CORE=<playwright-core の場所> node run-l1.mjs
//
// 観測すること（契約の受け入れ条件）:
//   1. 全 10 節をダーク / ライトで撮る（ナビ順・グループ・部品の種類を DOM からも記録）
//   2. 選択中のナビの computed border-inline-start-width（= 0px）と面の色
//   3. 画面上に見えている素の select / radio / checkbox の数（= 0）
//   4. 自前ドロップダウンのキーボード操作（ArrowDown で開く・矢印で移動・Enter で決定・Esc で閉じてもダイアログは残る）
//   5. テーマのカードでアプリのテーマが変わる / 書き出し画質・形式・文字起こしのモードが settings.json に保存される（前後の値）
//   6. Akari アカウントに Store の状態が出て、接続と API キーには Store が無い。Store を開く先が https://akari.video/lab/
//   7. 公式ロゴ（画像が実際に読めた = naturalWidth > 0）/ 残高を見るの有効・無効 / 押したときだけ問い合わせる（模擬サーバーのログ）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.default ?? pw;
const PORT = process.env.L1_PORT || '9457';
const OUT = process.env.L1_OUT;
const SETTINGS = process.env.L1_SETTINGS;
const MOCK_LOG = process.env.L1_MOCK_LOG;
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const measurements = { port: PORT, startedAt: new Date().toISOString(), pages: { dark: [], light: [] } };
const note = (key, value) => { measurements[key] = value; console.log(key, JSON.stringify(value)); };
const userSettings = () => existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8') || '{}') : {};
const mockRequests = () => existsSync(MOCK_LOG) ? readFileSync(MOCK_LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const started = Date.now();

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];
let page = context.pages().find(candidate => !candidate.url().startsWith('devtools://'));
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); page = context.pages().find(candidate => !candidate.url().startsWith('devtools://')); }
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text().slice(0, 200)); } });
await page.waitForSelector('.theia-ApplicationShell', { timeout: 240000 });
await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload');
    return !preload || getComputedStyle(preload).display === 'none' || preload.offsetParent === null;
}, undefined, { timeout: 240000 });
await sleep(5000);
await page.setViewportSize?.({ width: 1280, height: 860 }).catch(() => undefined);
note('clearedLastSection', await page.evaluate(() => { try { localStorage.removeItem('akari.settings.lastSection'); return true; } catch { return false; } }));

const executeCommand = (id, arg) => page.evaluate(({ id, arg }) => {
    const bindings = window.theia.container._bindingDictionary;
    const klass = [...bindings._map.keys()].find(key => typeof key === 'function' && typeof key.prototype?.executeCommand === 'function');
    // akari.settings.open は閉じるまで解決しないので待たない。
    void window.theia.container.get(klass).executeCommand(id, arg);
    return true;
}, { id, arg });
const dialogCount = () => page.$$eval('[data-akari-settings-dialog]', nodes => nodes.length);
const openSettings = async arg => {
    if (await dialogCount() === 0) { await executeCommand('akari.settings.open', arg); }
    await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 60000 });
    await sleep(2500);
};
const clickNav = async id => { await page.click(`[data-settings-nav="${id}"]`); await sleep(900); };
const shot = async name => {
    const block = await page.$('[data-akari-settings-dialog] .dialogBlock');
    await (block ?? page).screenshot({ path: `${OUT}/${name}.png` });
};

/** 表示中の節の構成（ナビ・グループ見出し・部品の種類）と、素のフォームの可視数・選択中ナビの computed。 */
const observe = () => page.evaluate(() => {
    const dialog = document.querySelector('[data-akari-settings-dialog]');
    const visibleNode = node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const sections = [...dialog.querySelectorAll('[data-akari-settings-section]')];
    const shown = sections.find(node => !node.hidden);
    const active = dialog.querySelector('[data-settings-nav][aria-current="true"]');
    const activeStyle = active ? getComputedStyle(active) : null;
    const activeIcon = active?.querySelector('svg');
    const inactive = dialog.querySelector('[data-settings-nav]:not([aria-current="true"])');
    const raw = [...dialog.querySelectorAll('select, input[type=radio], input[type=checkbox]')];
    const count = selector => [...shown.querySelectorAll(selector)].filter(visibleNode).length;
    return {
        visible: sections.filter(node => !node.hidden).map(node => node.getAttribute('data-akari-settings-section')),
        nav: [...dialog.querySelectorAll('[data-settings-nav]')].map(node => node.textContent),
        navGroups: [...dialog.querySelectorAll('.akari-set-nav-group')].map(node => node.textContent),
        activeNav: active?.getAttribute('data-settings-nav'),
        activeNavComputed: activeStyle && {
            borderInlineStartWidth: activeStyle.borderInlineStartWidth, borderLeftWidth: activeStyle.borderLeftWidth,
            backgroundColor: activeStyle.backgroundColor, fontWeight: activeStyle.fontWeight, color: activeStyle.color,
            iconColor: activeIcon ? getComputedStyle(activeIcon).color : null
        },
        inactiveNavBackground: inactive ? getComputedStyle(inactive).backgroundColor : null,
        heading: shown.querySelector('h2')?.textContent,
        groups: [...shown.querySelectorAll('[data-akari-settings-group]')].filter(visibleNode).map(node => node.getAttribute('data-akari-settings-group') || '(見出しなし)'),
        parts: {
            choiceCards: count('[role=radiogroup].akari-set-cards'), cards: count('button.akari-set-card'),
            dropdowns: count('[data-akari-dropdown]'), segmented: count('[data-akari-segmented]'),
            switches: count('[role=switch]'), checkChips: count('[role=checkbox]'), textInputs: count('input.akari-set-input'),
            svgIcons: count('svg.akari-set-icon'), logos: count('img[data-akari-provider-logo]')
        },
        rawFormControls: { total: raw.length, visible: raw.filter(visibleNode).length },
        pageScrollHeight: shown.scrollHeight, pageClientHeight: shown.clientHeight
    };
});

const SECTIONS = ['account', 'start', 'export', 'appearance', 'connections', 'transcribe', 'quality', 'notifications', 'tools', 'developer'];
const themeState = () => page.evaluate(() => ({
    bodyClass: document.body.className.split(/\s+/).filter(name => /theia-(light|dark)|theme/i.test(name)),
    akariBg: getComputedStyle(document.documentElement).getPropertyValue('--akari-bg').trim(),
    akariInk: getComputedStyle(document.documentElement).getPropertyValue('--akari-ink').trim(),
    colorScheme: document.documentElement.style.getPropertyValue('color-scheme')
}));

// ---- 1. 開く（保存値なし = 先頭の Akari アカウント）-------------------------------------------------------------
await openSettings();
// 道具の確認（はじめかたの進み具合の枠が読む）と接続一覧が読み込まれるまで待つ。
note('toolsAndConnectionsLoaded', await page.waitForFunction(() => document.querySelectorAll('[data-akari-tool-id]').length > 0
    && document.querySelectorAll('[data-akari-provider]').length > 0, undefined, { timeout: 120000 }).then(() => true, () => false));
note('initialOpen', await observe());
note('settingsBefore', userSettings());
note('mockRequestsBeforeAnyClick', mockRequests().length);

// ---- 2. ダークで全 10 節 -------------------------------------------------------------------------------------------
note('themeBefore', await themeState());
for (const [index, id] of SECTIONS.entries()) {
    await clickNav(id);
    const observation = { id, ...(await observe()) };
    measurements.pages.dark.push(observation);
    await shot(`dark-${String(index + 1).padStart(2, '0')}-${id}`);
}

// ---- 3. Akari アカウント / 接続（Store の位置・URL・ロゴ・残高）-------------------------------------------------------
await clickNav('account');
note('account', await page.evaluate(() => {
    const dialog = document.querySelector('[data-akari-settings-dialog]');
    const account = dialog.querySelector('[data-akari-settings-section="account"]');
    const connections = dialog.querySelector('[data-akari-settings-section="connections"]');
    return {
        storeInAccount: account.querySelectorAll('[data-akari-store-settings]').length,
        storeInConnections: connections.querySelectorAll('[data-akari-store-settings], [data-akari-store-group]').length,
        storeStatus: account.querySelector('[data-akari-store-status]')?.textContent,
        storeStatusKind: account.querySelector('[data-akari-store-status]')?.getAttribute('data-akari-store-status'),
        storeOpenUrl: account.querySelector('[data-akari-store-open]')?.getAttribute('data-akari-store-open'),
        planFrame: /プラン/.test(account.textContent),
        accountName: account.querySelector('.akari-set-account-name')?.textContent
    };
}));
await clickNav('connections');
note('connectionsBeforeBalance', await page.evaluate(() => {
    const section = document.querySelector('[data-akari-settings-section="connections"]');
    return {
        groups: [...section.querySelectorAll('[data-akari-provider-group]')].map(node => ({
            group: node.getAttribute('data-akari-provider-group'), title: node.querySelector('.akari-set-group-title')?.textContent,
            providers: [...node.querySelectorAll('[data-akari-provider]')].map(row => row.getAttribute('data-akari-provider'))
        })),
        logos: [...section.querySelectorAll('img[data-akari-provider-logo]')].map(image => ({
            id: image.getAttribute('data-akari-provider-logo'), naturalWidth: image.naturalWidth, complete: image.complete,
            kind: image.src.slice(0, image.src.indexOf(';'))
        })),
        pills: [...section.querySelectorAll('[data-akari-provider]')].map(row => ({
            id: row.getAttribute('data-akari-provider'), pill: row.querySelector('[data-connection-status]')?.textContent,
            balanceButton: row.querySelector('[data-akari-balance-button]') ? (row.querySelector('[data-akari-balance-button]').disabled ? 'disabled' : 'enabled') : 'none',
            balanceValue: row.querySelector('[data-akari-balance] .akari-set-bal-value')?.textContent ?? null,
            billingLink: [...row.querySelectorAll('button')].some(button => button.textContent.includes('管理画面'))
        })),
        openRouterDescription: section.querySelector('[data-akari-provider="openrouter"] .akari-set-prov-desc')?.textContent,
        storageSegment: [...section.querySelectorAll('[data-akari-segmented="キーの保存先"] [role=radio]')].map(button => ({
            label: button.textContent, checked: button.getAttribute('aria-checked'), disabled: button.disabled
        }))
    };
}));
note('mockRequestsBeforeBalanceClick', mockRequests().length);
for (const id of ['openrouter', 'fal']) {
    await page.click(`[data-akari-balance-button="${id}"]`);
    await page.waitForFunction(provider => {
        const value = document.querySelector(`[data-akari-balance="${provider}"] [data-state]`);
        return value && ['ok', 'error'].includes(value.getAttribute('data-state'));
    }, id, { timeout: 30000 });
}
await sleep(500);
note('balanceAfterClick', await page.evaluate(() => ['openrouter', 'fal'].map(id => ({
    id, text: document.querySelector(`[data-akari-balance="${id}"]`)?.innerText.replace(/\s+/g, ' ').trim(),
    state: document.querySelector(`[data-akari-balance="${id}"] [data-state]`)?.getAttribute('data-state')
}))));
note('mockRequestsAfterBalanceClick', mockRequests());
await page.evaluate(() => document.querySelector('[data-akari-balance="openrouter"]')?.scrollIntoView({ block: 'center' }));
await sleep(400);
await shot('dark-11-connections-balance');

// ---- 4. 書き出し: 画質カード + 形式ドロップダウン（キーボード）----------------------------------------------------------
await clickNav('export');
const exportBefore = userSettings();
await page.click('[data-akari-choice-cards="書き出し画質"] [data-value="master"]');
await sleep(600);
const codecButton = '[data-akari-dropdown="形式 / コーデック"] > button';
await page.focus(codecButton);
await page.keyboard.press('ArrowDown');
await sleep(300);
const dropdownOpened = await page.evaluate(selector => {
    const button = document.querySelector(selector);
    const list = button.nextElementSibling;
    return { ariaExpanded: button.getAttribute('aria-expanded'), listVisible: !list.hidden, activeElementRole: document.activeElement?.getAttribute('role'),
        options: [...list.querySelectorAll('[role=option]')].map(option => ({ label: option.querySelector('.akari-set-option-label')?.textContent,
            description: option.querySelector('.akari-set-option-desc')?.textContent, selected: option.getAttribute('aria-selected') })) };
}, codecButton);
await shot('dark-12-export-dropdown-open');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const activeAfterArrows = await page.evaluate(selector => {
    const list = document.querySelector(selector).nextElementSibling;
    return document.getElementById(list.getAttribute('aria-activedescendant'))?.getAttribute('data-value');
}, codecButton);
await page.keyboard.press('Enter');
await sleep(800);
const afterEnter = await page.evaluate(selector => ({ current: document.querySelector(selector).textContent, expanded: document.querySelector(selector).getAttribute('aria-expanded') }), codecButton);
await page.focus(codecButton);
await page.keyboard.press('ArrowDown');
await sleep(300);
await page.keyboard.press('Escape');
await sleep(600);
const afterEscape = await page.evaluate(selector => ({ expanded: document.querySelector(selector).getAttribute('aria-expanded'),
    dialogs: document.querySelectorAll('[data-akari-settings-dialog]').length }), codecButton);
await sleep(800);
const exportAfter = userSettings();
note('exportKeyboard', { dropdownOpened, activeAfterArrows, afterEnter, afterEscape,
    before: { quality: exportBefore['akari.export.quality'] ?? '(既定 standard)', codec: exportBefore['akari.export.codec'] ?? '(既定 h264)' },
    after: { quality: exportAfter['akari.export.quality'], codec: exportAfter['akari.export.codec'] } });

// ---- 5. 文字起こし: モードのカード ----------------------------------------------------------------------------------------
await clickNav('transcribe');
const transcribeBefore = userSettings()['akari.transcribe.mode'] ?? '(既定 simple)';
await page.click('[data-akari-choice-cards="文字起こしのモード"] [data-value="advanced"]');
await sleep(1500);
const advancedView = await observe();
await shot('dark-13-transcribe-advanced');
const transcribeAfter = userSettings()['akari.transcribe.mode'];
note('transcribeMode', { before: transcribeBefore, after: transcribeAfter, advancedParts: advancedView.parts, advancedGroups: advancedView.groups });

// ---- 6. 外観: テーマのカードでライトへ -----------------------------------------------------------------------------------------
await clickNav('appearance');
const themeSettingBefore = userSettings()['workbench.colorTheme'] ?? '(既定 dark)';
await page.click('[data-akari-choice-cards="テーマ"] [data-value="light"]');
await sleep(3500);
note('themeSwitch', { settingBefore: themeSettingBefore, settingAfter: userSettings()['workbench.colorTheme'], stateAfter: await themeState() });

// ---- 7. ライトで全 10 節 -------------------------------------------------------------------------------------------------
for (const [index, id] of SECTIONS.entries()) {
    await clickNav(id);
    const observation = { id, ...(await observe()) };
    measurements.pages.light.push(observation);
    await shot(`light-${String(index + 1).padStart(2, '0')}-${id}`);
}

// ---- 8. 片付け: ダークへ戻して閉じる（隔離プロファイルなので設定は捨てる）------------------------------------------------------
await clickNav('appearance');
await page.click('[data-akari-choice-cards="テーマ"] [data-value="dark"]');
await sleep(2500);
note('themeRestored', { setting: userSettings()['workbench.colorTheme'], state: await themeState() });
await page.evaluate(() => (document.querySelector('[data-akari-settings-dialog] [data-settings-nav]'))?.focus());
await page.keyboard.press('Escape');
await sleep(1200);
note('dialogsAfterEscape', await dialogCount());
note('consoleErrors', consoleErrors);
note('elapsedSeconds', Math.round((Date.now() - started) / 1000));
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2).replaceAll(process.env.HOME ?? '\u0000', '<HOME>') + '\n');
await browser.close();
console.log('L1 OK');
