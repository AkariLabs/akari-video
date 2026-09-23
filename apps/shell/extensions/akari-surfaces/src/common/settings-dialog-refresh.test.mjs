// 設定ダイアログ刷新（2026-09-22 settings-dialog-refresh）の固定:
// (a) ナビの順と新しい 2 節 / (b) 素の select・radio・checkbox を作らない / (c) 絵文字・記号文字のアイコンが無い /
// (d) Store は接続節に無くアカウント節にある / (e) 残高の口がある / 無いサービスの表。
// あわせて部品（ドロップダウン・カード・スイッチ）の操作が設定値へ届くことを小さな擬似 DOM で確かめる。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const libUrl = path => new URL(`../../lib/${path}`, import.meta.url);

// ---- 小さな擬似 DOM（このテストで使う API だけ） -------------------------------------------------
class FakeNode {
    constructor(tag) {
        Object.assign(this, { tagName: tag.toUpperCase(), tag, children: [], attributes: {}, listeners: {}, style: {}, parentNode: null });
        this.hidden = false; this.disabled = false; this.className = ''; this.value = ''; this.type = ''; this.tabIndex = 0;
        this._text = '';
        this.classList = { toggle: (name, on) => {
            const set = new Set(this.className.split(/\s+/).filter(Boolean));
            if (on ?? !set.has(name)) { set.add(name); } else { set.delete(name); }
            this.className = [...set].join(' ');
        }, contains: name => this.className.split(/\s+/).includes(name) };
    }
    get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get childElementCount() { return this.children.filter(child => typeof child !== 'string').length; }
    get lastElementChild() { return [...this.children].reverse().find(child => typeof child !== 'string'); }
    append(...nodes) { for (const node of nodes) { if (typeof node !== 'string') { node.parentNode = this; } this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') { this.className = String(value); } }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== listener); }
    fire(type, init = {}) {
        const event = { type, target: this, defaultPrevented: false, propagationStopped: false, ...init,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
        for (const listener of this.listeners[type] ?? []) { listener(event); }
        return event;
    }
    click() { if (!this.disabled) { this.fire('click'); } }
    focus() { fakeDocument.activeElement = this; }
    contains(node) { return node === this || this.children.some(child => typeof child !== 'string' && child.contains(node)); }
    closest() { return null; }
    getBoundingClientRect() { return { top: 0, bottom: 20, left: 0, right: 100 }; }
    get offsetHeight() { return 100; }
    querySelectorAll(selector) {
        const tags = selector.split(',').map(item => item.trim());
        return all(this).slice(1).filter(node => tags.some(tag => tag.startsWith('.') ? node.className.split(/\s+/).includes(tag.slice(1)) : node.tag === tag));
    }
}
const fakeDocument = {
    activeElement: null, listeners: {},
    createElement: tag => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== listener); }
};
globalThis.document = fakeDocument;
globalThis.window = { innerHeight: 800, localStorage: { getItem: () => null } };
globalThis.requestAnimationFrame = callback => { callback(); return 1; };
const all = node => [node, ...node.children.filter(child => typeof child !== 'string').flatMap(all)];
const find = (root, predicate) => all(root).find(predicate);
const byText = (root, text) => find(root, node => node._text === text || (node.tag === 'button' && node.textContent === text));

// ---- ダイアログのモジュールを、Theia の実体なしで読み込む ----------------------------------------------
function loadDialogModule() {
    const code = readFileSync(libUrl('browser/akari-settings-dialog.js'), 'utf8');
    const local = createRequire(libUrl('browser/akari-settings-dialog.js'));
    const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
    const stubs = {
        '@theia/core/lib/browser/dialogs': { AbstractDialog: class {} },
        './akari-first-run-setup-dialog': { AkariFirstRunSetupDialog: class {} },
        './akari-home-command-contribution': { AkariHomeCommands: { OPEN_FIRST_RUN_SETUP: { id: 'first-run' } } },
        '@theia/core/shared/inversify': { injectable: () => () => {}, inject: () => () => {} },
        '@theia/core/lib/common/preferences': { PreferenceScope, PreferenceService: Symbol('PreferenceService'), PreferenceSchemaService: Symbol('PreferenceSchemaService') },
        '@theia/core/lib/common/os': { OS: { type: () => 'OSX', Type: { OSX: 'OSX', Windows: 'Windows' } } },
        '@theia/core/lib/browser': { CommonCommands: { OPEN_PREFERENCES: { id: 'preferences' } }, WebSocketConnectionProvider: class {}, WidgetManager: class {}, ApplicationShell: class {} },
        '@theia/workspace/lib/browser/workspace-service': { WorkspaceService: class {} },
        '@theia/core/lib/browser/window/window-service': { WindowService: Symbol('WindowService') },
        '@theia/core/lib/common': { CommandService: Symbol('CommandService') },
        '@theia/filesystem/lib/browser': { FileDialogService: Symbol('FileDialogService') },
        '@theia/filesystem/lib/browser/file-service': { FileService: Symbol('FileService') },
        '@theia/core/lib/common/env-variables': { EnvVariablesServer: Symbol('EnvVariablesServer') },
        'akari-project/lib/common/akari-project-protocol': { AkariProjectService: Symbol('AkariProjectService') },
        'akari-project/lib/common/store-connection-flow': { StoreConnectionFlowController: class {} }
    };
    const exports = {};
    new Function('require', 'exports', code)(id => id in stubs ? stubs[id] : local(id), exports);
    return exports;
}
const dialogModule = loadDialogModule();
function makeDialog(values = {}, extra = {}) {
    const dialog = Object.create(dialogModule.AkariSettingsDialog.prototype);
    const writes = [];
    Object.assign(dialog, {
        notice: new FakeNode('p'), preferenceWrites: Promise.resolve(), localPreferenceWrites: new Set(), compareDraft: [], compareEnabled: false,
        transcribe: new FakeNode('section'), sections: new Map(), isDisposed: false,
        preferences: {
            get(key, fallback) { return key in values ? values[key] : fallback; },
            async set(key, value, scope) { values[key] = value; writes.push([key, value, scope]); }
        }
    }, extra);
    return { dialog, values, writes };
}

// ---- (a) ナビの順と新しい 2 節 ---------------------------------------------------------------------
test('(a) ナビは Akari アカウント先頭・外観を新設し、開発者モードだけが開発者グループ', () => {
    const { SETTINGS_SECTIONS, SECTION_PREFERENCE_KEYS, resolveSettingsSectionId, sectionForPreferenceKey } = require('../../lib/common/settings-sections.js');
    assert.deepEqual(SETTINGS_SECTIONS.map(section => section.label),
        ['Akari アカウント', 'はじめかた', '書き出し', '外観', '接続と API キー', 'パートナー', '文字起こし', '読み上げ', 'プレビュー品質', '通知', '道具', 'ストレージ', 'プライバシーとアクセス許可', '統計と利用状況', '困ったとき', 'このアプリについて', '開発者モード']);
    assert.deepEqual(SETTINGS_SECTIONS.filter(section => section.group === 'developer').map(section => section.id), ['developer']);
    const { SETTINGS_ICON_PATHS } = require('../../lib/browser/settings/settings-icons.js');
    for (const section of SETTINGS_SECTIONS) { assert.ok(section.icon in SETTINGS_ICON_PATHS, section.id); }
    // テーマは外観へ。開発者モードの節にはスイッチ 1 個（Developer mode）だけが残る。
    assert.ok(SECTION_PREFERENCE_KEYS.appearance.includes('workbench.colorTheme'));
    assert.ok(SECTION_PREFERENCE_KEYS.appearance.includes('akari.appearance.zoom'));
    assert.deepEqual(SECTION_PREFERENCE_KEYS.developer, ['akari.developerMode']);
    assert.equal(sectionForPreferenceKey('workbench.colorTheme'), 'appearance');
    // 旧 id developer でテーマを指して来た場合は外観へ寄せる。developer だけなら開発者モードのまま。
    assert.equal(resolveSettingsSectionId({ section: 'developer', preference: 'workbench.colorTheme' }), 'appearance');
    assert.equal(resolveSettingsSectionId({ section: 'developer' }), 'developer');
    assert.equal(resolveSettingsSectionId('account'), 'account');
    assert.equal(resolveSettingsSectionId('appearance'), 'appearance');
});

test('(a) 選択中のナビは面の色で示し、縦バー（border-inline-start）を使わない', () => {
    const dialog = source('../browser/akari-settings-dialog.ts');
    const css = require('../../lib/browser/settings/settings-ui-style.js').AKARI_SETTINGS_UI_CSS;
    assert.doesNotMatch(dialog, /borderInlineStart|border-inline-start|borderLeft/);
    assert.doesNotMatch(css, /border-inline-start|border-left:/);
    assert.match(css, /button\.akari-set-nav-item\[aria-current="true"\] \{ background: var\(--akari-elevated\); color: var\(--akari-ink\); font-weight: 600; \}/);
    assert.match(css, /button\.akari-set-nav-item\[aria-current="true"\] \.akari-set-icon \{ color: var\(--akari-accent\); \}/);
    assert.match(css, /button\.akari-set-nav-item \{ all: unset;[^}]*border: 0;/);
});

// ---- (b) 素の select / radio / checkbox を作らない -----------------------------------------------------
test('(b) 設定ダイアログのソースは素の select / radio / checkbox を生成しない', () => {
    const files = ['../browser/akari-settings-dialog.ts', ...readdirSync(new URL('../browser/settings/', import.meta.url)).map(name => `../browser/settings/${name}`)];
    for (const file of files) {
        const text = source(file);
        assert.doesNotMatch(text, /createElement\(\s*['"]select['"]|element\(\s*['"]select['"]|el\(\s*['"]select['"]|<select|theia-select/, file);
        // input の type としての radio / checkbox（role 属性の 'radio' / 'checkbox' は対象外）。
        assert.doesNotMatch(text, /\.type\s*=\s*['"](?:radio|checkbox)['"]|type=radio|type=checkbox|input\[type=(?:radio|checkbox)|choice\(\s*['"](?:radio|checkbox)/, file);
    }
    // 選択は ARIA の role を持つ button で作る（アクセシビリティ用の隠し input は使っていない）。
    const ui = source('../browser/settings/settings-ui.ts');
    for (const role of ['listbox', 'option', 'radiogroup', 'radio', 'switch', 'checkbox']) {
        assert.match(ui, new RegExp(`'${role}'`), role);
    }
    assert.doesNotMatch(ui, /el\('input'[^;]*\n[^;]*type = '(radio|checkbox)'/);
});

// ---- (c) 絵文字・記号文字のアイコンが無い -------------------------------------------------------------
test('(c) 設定ダイアログの表示文字列に絵文字・記号文字のアイコンが無い', () => {
    const files = ['../browser/akari-settings-dialog.ts', '../common/settings-sections.ts',
        ...readdirSync(new URL('../browser/settings/', import.meta.url)).filter(name => name !== 'provider-logos.ts').map(name => `../browser/settings/${name}`)];
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}]/u;
    const symbols = ['✓', '✔', '▼', '▾', '↗', '⚙', '🔔', '★', '●', '◆', '›', '‹', '→', '×'];
    for (const file of files) {
        const text = source(file);
        const hit = text.replaceAll('⌘', '').match(emoji);
        assert.equal(hit, null, `${file}: ${hit?.[0]}`);
        for (const symbol of symbols) { assert.equal(text.includes(symbol), false, `${file}: ${symbol}`); }
    }
    // 旧実装の「取得先 ↗」リンクは線画アイコン付きのボタンへ置き換えた。
    assert.doesNotMatch(source('../browser/akari-settings-dialog.ts'), /取得先 /);
});

// ---- (d) Store の行はアカウント節にあり、接続節に無い ------------------------------------------------------
test('(d) Store はアカウント節に描かれ、接続と API キーの一覧には入らない', () => {
    const store = new FakeNode('div'), account = new FakeNode('section');
    const opened = [];
    const { dialog } = makeDialog({}, {
        storeRow: store, sections: new Map([['account', account]]),
        storeState: { connection: { connected: false }, connectionLoading: false, phase: 'idle' },
        windows: { openNewWindow: (url, options) => opened.push([url, options]) },
        storeController: { start() {}, cancel() {}, disconnect: async () => {} }
    });
    dialog.renderStore();
    dialog.renderSection('account');
    assert.ok(account.children.includes(store), 'account section holds the Store content');
    assert.equal(find(store, node => node.attributes['data-akari-store-status'])?.attributes['data-akari-store-status'], 'disconnected');
    byText(store, 'ストアを開く').click();
    assert.equal(opened.length, 1);
    assert.match(opened[0][0], /^https:\/\/akari\.video\/lab\/$/);
    // プラン（準備中）の枠は出さない。
    assert.equal(all(store).some(node => node._text.includes('プラン')), false);
    // 接続一覧を描いても Store は入らない。
    const providerList = new FakeNode('div');
    Object.assign(dialog, { providerList, service: { readBalance: async () => ({ ok: false, error: 'x', checked_at: '' }) }, renderSection() {} });
    dialog.renderProviders([
        { id: 'groq', label: 'Groq', description: 'd', setup_url: null, env_name: 'GROQ_API_KEY', configured: false, masked_tail: null, doctor: { status: 'unconfigured', detail: '', last_checked: null } }
    ]);
    assert.equal(all(providerList).some(node => node.attributes['data-akari-store-settings']), false);
    assert.equal(providerList.contains(store), false);
});

// ---- (e) 残高の口がある / 無いサービスの表 ------------------------------------------------------------------
test('(e) 残高の口: OpenRouter / fal / ElevenLabs はあり、Groq / Replicate は管理画面だけ', () => {
    const { PROVIDER_BALANCE_SUPPORT, providerHasBalanceEndpoint } = require('../../lib/common/akari-connections-protocol.js');
    assert.deepEqual(Object.fromEntries(Object.entries(PROVIDER_BALANCE_SUPPORT).map(([id, entry]) => [id, entry.balance])),
        { openrouter: true, fal: true, elevenlabs: true, groq: false, replicate: false });
    for (const [id, entry] of Object.entries(PROVIDER_BALANCE_SUPPORT)) {
        assert.ok(entry.docs.length > 0 && entry.docs.every(url => url.startsWith('https://')), id);
        assert.match(entry.billing_url, /^https:\/\//, id);
        assert.equal(providerHasBalanceEndpoint(id), entry.balance);
    }
    assert.equal(providerHasBalanceEndpoint('voicevox'), false);
    const { BALANCE_REQUESTS, describeBalanceResponse, balanceRequestUrl } = require('../../lib/node/akari-connections-service.js');
    assert.deepEqual(Object.keys(BALANCE_REQUESTS).sort(), ['elevenlabs', 'fal', 'openrouter']);
    assert.equal(BALANCE_REQUESTS.openrouter.url, 'https://openrouter.ai/api/v1/credits');
    assert.deepEqual(BALANCE_REQUESTS.openrouter.headers('k'), { Authorization: 'Bearer k' });
    assert.equal(BALANCE_REQUESTS.fal.url, 'https://api.fal.ai/v1/account/billing?expand=credits');
    assert.deepEqual(BALANCE_REQUESTS.fal.headers('k'), { Authorization: 'Key k' });
    assert.equal(BALANCE_REQUESTS.elevenlabs.url, 'https://api.elevenlabs.io/v1/user/subscription');
    assert.deepEqual(BALANCE_REQUESTS.elevenlabs.headers('k'), { 'xi-api-key': 'k' });
    // 応答 → 1 行の表示
    assert.deepEqual(describeBalanceResponse('openrouter', 200, { data: { total_credits: 10, total_usage: 3.25 } }),
        { ok: true, display: '口座の残高 残り $6.75' });
    assert.deepEqual(describeBalanceResponse('openrouter', 403, {}, { status: 200, body: { data: { limit_remaining: 4.7234, usage: 1 } } }),
        { ok: true, display: 'キーの上限 残り $4.72', account_url: 'https://openrouter.ai/settings/credits' });
    assert.deepEqual(describeBalanceResponse('openrouter', 403, {}, { status: 200, body: { data: { limit_remaining: null, usage: 12.5 } } }),
        { ok: true, display: 'キーの上限なし · 使用 $12.50', account_url: 'https://openrouter.ai/settings/credits' });
    assert.deepEqual(describeBalanceResponse('fal', 200, { credits: { current_balance: 18.4, currency: 'USD' } }), { ok: true, display: '口座のクレジット 残り $18.40' });
    assert.deepEqual(describeBalanceResponse('elevenlabs', 200, { character_limit: 100000, character_count: 12345 }), { ok: true, display: '今月の残り 87,655 クレジット' });
    assert.match(describeBalanceResponse('fal', 403, {}).error, /ADMIN/);
    assert.equal(describeBalanceResponse('openrouter', 401, {}).ok, false);
    assert.equal(describeBalanceResponse('openrouter', 500, {}).error, '残高を取得できませんでした（HTTP 500）。');
    assert.equal(describeBalanceResponse('fal', 200, { credits: { current_balance: 'x' } }).ok, false);
    // 模擬サーバーへの向け替えはループバックだけ
    assert.equal(balanceRequestUrl('https://api.fal.ai/v1/account/billing?expand=credits', { AKARI_BALANCE_API_ORIGIN: 'http://127.0.0.1:9458' }),
        'http://127.0.0.1:9458/v1/account/billing?expand=credits');
    assert.equal(balanceRequestUrl('https://openrouter.ai/api/v1/key', { AKARI_BALANCE_API_ORIGIN: 'https://evil.example' }), 'https://openrouter.ai/api/v1/key');
    assert.equal(balanceRequestUrl('https://openrouter.ai/api/v1/key', {}), 'https://openrouter.ai/api/v1/key');
});

test('(e) 残高を見るは押したときだけ問い合わせ、未登録なら押せない', async () => {
    const calls = [];
    const { dialog } = makeDialog({}, {
        providerList: new FakeNode('div'), storage: new FakeNode('div'), windows: { openNewWindow() {} }, renderSection() {},
        service: {
            readBalance: async id => { calls.push(id); return { ok: true, display: '残り $4.72', checked_at: new Date().toISOString() }; },
            readGenerationDefaults: async () => { throw new Error('skip'); }, readGenerationCatalog: async () => ({ models: [] })
        }
    });
    const row = (id, configured) => ({ id, label: id, description: 'd', setup_url: `https://example.com/${id}`, env_name: 'X', configured,
        masked_tail: configured ? '1234' : null, doctor: configured ? { status: 'ok', detail: '', last_checked: null } : { status: 'unconfigured', detail: '', last_checked: null } });
    dialog.renderProviders([row('openrouter', true), row('elevenlabs', false), row('groq', false), row('replicate', false)]);
    const list = dialog.providerList;
    assert.equal(calls.length, 0, 'no automatic balance lookups');
    const button = id => find(list, node => node.attributes['data-akari-balance-button'] === id);
    assert.ok(button('openrouter'));
    assert.equal(button('openrouter').disabled, false);
    assert.equal(button('elevenlabs').disabled, true, 'no key → disabled');
    assert.equal(find(list, node => node.attributes['data-akari-balance'] === 'elevenlabs').textContent.includes('未接続'), true);
    assert.equal(button('groq'), undefined);
    assert.equal(button('replicate'), undefined);
    for (const id of ['groq', 'replicate']) {
        const provider = find(list, node => node.attributes['data-akari-provider'] === id);
        assert.ok(byText(provider, '管理画面'), `${id} has a billing link`);
    }
    // グループ見出し: 生成 AI / 文字起こし
    assert.deepEqual(list.children.map(card => card.attributes['data-akari-provider-group']), ['generate', 'transcribe']);
    // 公式ロゴ 4 社 + Replicate は data URI の画像、それ以外は頭文字
    for (const id of ['openrouter', 'elevenlabs', 'groq', 'replicate']) {
        assert.match(find(list, node => node.attributes['data-akari-provider-logo'] === id)?.src ?? '', /^data:image\/(png|svg\+xml);base64,/, id);
    }
    button('openrouter').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['openrouter']);
    const balance = find(list, node => node.attributes['data-akari-balance'] === 'openrouter');
    assert.match(balance.textContent, /残り \$4\.72.*たった今/);
    // OpenRouter の説明は Akari Vibe の趣旨（シェル側の 1 か所の上書き）
    assert.match(find(list, node => node.attributes['data-akari-provider'] === 'openrouter').textContent, /1 つのキーで。つなぐと Akari Vibe（声で話しかけて動画を編集）が使えます/);
});

test('公式ロゴの表は各社の公式ドメインの出典と取得日を持つ', () => {
    const text = source('../browser/settings/provider-logos.ts');
    for (const origin of ['https://fal.ai/', 'https://openrouter.ai/', 'https://elevenlabs.io/', 'https://groq.com/', 'https://static.replicateassets.com/']) {
        assert.ok(text.includes(origin), origin);
    }
    assert.match(text, /2026-09-22/);
    const { PROVIDER_LOGOS } = require('../../lib/browser/settings/provider-logos.js');
    assert.deepEqual(Object.keys(PROVIDER_LOGOS).sort(), ['elevenlabs', 'fal', 'groq', 'openrouter', 'replicate']);
    for (const [id, uri] of Object.entries(PROVIDER_LOGOS)) {
        if (!uri.startsWith('data:image/svg+xml')) { continue; }
        const svg = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
        assert.doesNotMatch(svg, /<script|\son\w+=|href=|xlink:/i, id);
    }
});

// ---- 部品の操作 ----------------------------------------------------------------------------------------------
test('自前ドロップダウンは ↓ Enter で開いて選び、Esc はダイアログへ伝えずに閉じる', () => {
    const { dropdown } = require('../../lib/browser/settings/settings-ui.js');
    const picked = [];
    const control = dropdown({ label: '形式', value: 'a', onChange: value => picked.push(value), options: [
        { value: 'a', label: 'A', description: 'first' }, { value: 'b', label: 'B', description: 'second' }, { value: 'c', label: 'C', disabled: true }] });
    const button = control.children[0], list = control.children[1];
    assert.equal(button.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(list.getAttribute('role'), 'listbox');
    assert.equal(list.hidden, true);
    button.fire('keydown', { key: 'ArrowDown' });
    assert.equal(list.hidden, false);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    list.fire('keydown', { key: 'ArrowDown' });
    assert.equal(list.getAttribute('aria-activedescendant'), list.children[1].id);
    list.fire('keydown', { key: 'ArrowDown' }); // c は無効なので a へ回る
    assert.equal(list.getAttribute('aria-activedescendant'), list.children[0].id);
    list.fire('keydown', { key: 'ArrowUp' });
    const enter = list.fire('keydown', { key: 'Enter' });
    assert.equal(enter.propagationStopped, true);
    assert.deepEqual(picked, ['b']);
    assert.equal(list.hidden, true);
    assert.equal(list.children[1].getAttribute('aria-selected'), 'true');
    button.click();
    const escape = list.fire('keydown', { key: 'Escape' });
    assert.equal(escape.propagationStopped, true, 'Esc must not close the settings dialog');
    assert.equal(list.hidden, true);
    assert.deepEqual(picked, ['b']);
});

test('選択カード・セグメントは矢印キーで選び、スイッチは role=switch で切り替える', () => {
    const { choiceCards, segmentedControl, switchControl } = require('../../lib/browser/settings/settings-ui.js');
    const picked = [];
    const cards = choiceCards({ label: '画質', columns: 4, value: 'standard', onChange: value => picked.push(value),
        options: [{ value: 'light', label: '軽量' }, { value: 'standard', label: '標準' }, { value: 'high', label: '高画質' }] });
    assert.equal(cards.getAttribute('role'), 'radiogroup');
    assert.deepEqual(cards.children.map(card => [card.getAttribute('role'), card.getAttribute('aria-checked'), card.tabIndex]),
        [['radio', 'false', -1], ['radio', 'true', 0], ['radio', 'false', -1]]);
    cards.children[1].fire('keydown', { key: 'ArrowRight' });
    cards.children[0].click();
    assert.deepEqual(picked, ['high', 'light']);
    const segment = segmentedControl({ label: 'fps', value: '', onChange: value => picked.push(value),
        options: [{ value: '', label: '編集データ' }, { value: '24', label: '24' }, { value: '30', label: '30', disabled: true }] });
    segment.children[0].fire('keydown', { key: 'ArrowLeft' });
    assert.equal(picked.at(-1), '24');
    const toggled = [];
    const toggle = switchControl({ label: '通知', checked: true, onChange: value => toggled.push(value) });
    assert.equal(toggle.getAttribute('role'), 'switch');
    toggle.click(); toggle.click();
    assert.deepEqual(toggled, [false, true]);
});

test('書き出し: 画質カード・形式ドロップダウン・fps セグメントの操作が設定値へ保存される', async () => {
    const page = new FakeNode('section');
    const { dialog, writes } = makeDialog({ 'akari.export.quality': 'standard', 'akari.export.codec': 'h264' }, { sections: new Map([['export', page]]) });
    dialog.renderSection('export');
    const quality = find(page, node => node.attributes['data-akari-choice-cards'] === '書き出し画質');
    assert.deepEqual(quality.children.map(card => card.textContent), ['軽量共有・確認向け', '標準ふだんの投稿', '高画質大きい画面向け', 'マスター再編集・保管用']);
    quality.children[3].click();
    const codec = find(page, node => node.attributes['data-akari-dropdown'] === '形式 / コーデック');
    codec.children[0].click();
    codec.children[1].children[2].fire('click');
    const fps = find(page, node => node.attributes['data-akari-segmented'] === 'フレームレート');
    fps.children[2].click();
    fps.children[0].click();
    const encoder = find(page, node => node.attributes['data-akari-segmented'] === 'エンコーダ');
    assert.deepEqual(encoder.children.filter(item => item.tag === 'button').map(item => item.textContent), ['自動', 'GPU', 'CPU']);
    await dialog.preferenceWrites;
    assert.deepEqual(writes.map(([key, value]) => [key, value]), [
        ['akari.export.quality', 'master'], ['akari.export.codec', 'prores422'], ['akari.export.fps', 30], ['akari.export.fps', undefined]
    ]);
});

test('外観: テーマはプレビュー付きのカードで選び、ダーク / ライトを保存する', async () => {
    const page = new FakeNode('section');
    const { dialog, writes } = makeDialog({ 'workbench.colorTheme': 'dark' }, { sections: new Map([['appearance', page]]) });
    dialog.renderSection('appearance');
    const cards = find(page, node => node.attributes['data-akari-choice-cards'] === 'テーマ');
    assert.deepEqual(cards.children.map(card => [card.getAttribute('data-value'), find(card, node => node.className === 'akari-set-theme-preview')?.getAttribute('data-theme')]),
        [['dark', 'dark'], ['light', 'light'], ['system', 'system']]);
    cards.children[1].click();
    await dialog.preferenceWrites;
    assert.deepEqual(writes.map(([key, value]) => [key, value]), [['akari.appearance.themeMode', 'light'], ['workbench.colorTheme', 'light']]);
    // 開発者モードの節にはテーマが無い
    const developer = new FakeNode('section');
    const other = makeDialog({}, { sections: new Map([['developer', developer]]) });
    other.dialog.renderSection('developer');
    assert.equal(all(developer).filter(node => node.getAttribute('role') === 'switch').length, 1);
    assert.equal(all(developer).some(node => node.attributes['data-akari-choice-cards']), false);
});

test('カタログのフォルダは手入力と選択でユーザー設定に保存し、キャンセルでは変更しない', async () => {
    const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
    const page = new FakeNode('section'), tools = new FakeNode('div');
    let destination;
    const { dialog, writes, values } = makeDialog({ 'akari.catalog.root': '/catalog/initial' }, {
        sections: new Map([['tools', page]]), toolsView: { content: tools },
        fileDialogs: { async showOpenDialog(options) {
            assert.equal(options.canSelectFiles, false);
            assert.equal(options.canSelectFolders, true);
            return destination;
        } }
    });
    const input = () => find(page, node => node.tag === 'input');
    const pick = () => find(page, node => node.tag === 'button' && node.textContent === '選ぶ').listeners.click[0]();
    dialog.renderSection('tools');
    assert.ok(page.children.includes(tools));
    assert.equal(input().value, '/catalog/initial');
    assert.equal(input().attributes['aria-label'], 'カタログの素材フォルダ');
    input().value = '';
    input().fire('change');
    await dialog.preferenceWrites;
    assert.deepEqual(writes, [['akari.catalog.root', '', PreferenceScope.User]]);
    const beforeCancel = input();
    await pick();
    assert.equal(input(), beforeCancel);
    assert.equal(writes.length, 1);
    destination = { path: { fsPath: () => '/catalog/選んだ素材' } };
    await pick();
    assert.notEqual(input(), beforeCancel, '選択後は保存した値で再描画する');
    assert.equal(input().value, '/catalog/選んだ素材');
    assert.equal(values['akari.catalog.root'], '/catalog/選んだ素材');
    assert.deepEqual(writes.at(-1), ['akari.catalog.root', '/catalog/選んだ素材', PreferenceScope.User]);
});

test('文字起こし: モードのカードで比較・カットのフォームを置き換え、設定値を保つ', async () => {
    const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
    const { dialog, values, writes } = makeDialog({ 'akari.transcribe.compareSet': ['whisper-cpp', 'cloud:scribe'], 'akari.transcribe.autoCuts': false });
    dialog.preferences.set = async (key, value, scope) => { values[key] = value; writes.push([key, value, scope]); dialog.renderTranscribe(); };
    const chips = () => all(dialog.transcribe).filter(node => node.getAttribute('role') === 'checkbox');
    const switches = () => all(dialog.transcribe).filter(node => node.getAttribute('role') === 'switch');
    const selectMode = async mode => {
        find(dialog.transcribe, node => node.attributes['data-akari-choice-cards'] === '文字起こしのモード')
            .children.find(card => card.getAttribute('data-value') === mode).click();
        await dialog.preferenceWrites;
    };
    dialog.renderTranscribe();
    const modes = find(dialog.transcribe, node => node.attributes['data-akari-choice-cards'] === '文字起こしのモード');
    assert.deepEqual(modes.children.map(card => [card.getAttribute('data-value'), card.getAttribute('aria-checked')]), [['simple', 'true'], ['advanced', 'false']]);
    assert.equal(chips().length, 0);
    assert.equal(all(dialog.transcribe).filter(node => node._text.includes('アドバンスで使います')).length, 1);
    await selectMode('advanced');
    assert.equal(chips().length, 4);
    assert.equal(chips().filter(node => node.getAttribute('aria-checked') === 'true').length, 2);
    assert.deepEqual(switches().map(node => node.getAttribute('aria-checked')), ['true', 'false']);
    assert.equal(all(dialog.transcribe).filter(node => node._text.includes('アドバンスで使います')).length, 0);
    await selectMode('simple');
    assert.equal(chips().length, 0);
    assert.deepEqual(writes, [
        ['akari.transcribe.mode', 'advanced', PreferenceScope.User],
        ['akari.transcribe.mode', 'simple', PreferenceScope.User]
    ]);
    assert.deepEqual(values['akari.transcribe.compareSet'], ['whisper-cpp', 'cloud:scribe']);
    assert.equal(values['akari.transcribe.autoCuts'], false);
});

test('文字起こし: エンジンはおまかせ / 決めたエンジンのセグメントとドロップダウンで保存する', async () => {
    const { dialog, writes } = makeDialog({ 'akari.transcribe.backend': 'auto' });
    dialog.renderTranscribe();
    const engine = find(dialog.transcribe, node => node.attributes['data-akari-dropdown'] === '文字起こしのエンジン');
    assert.equal(engine.children[0].disabled, true, 'おまかせのときはエンジンを選べない');
    const policy = find(dialog.transcribe, node => node.attributes['data-akari-segmented'] === '使うエンジン');
    policy.children[1].click();
    assert.equal(engine.children[0].disabled, false);
    engine.children[0].click();
    engine.children[1].children[3].fire('click');
    policy.children[0].click();
    await dialog.preferenceWrites;
    assert.deepEqual(writes.map(([key, value]) => [key, value]), [
        ['akari.transcribe.backend', 'speech-analyzer'], ['akari.transcribe.backend', 'cloud:groq'], ['akari.transcribe.backend', 'auto']
    ]);
});

test('プレビュー品質: Draft / Final のカードと「値を読む機能が無い」注記、サムネイルはスイッチ', async () => {
    const page = new FakeNode('section');
    const { dialog, writes } = makeDialog({}, { sections: new Map([['quality', page]]) });
    dialog.renderSection('quality');
    const cards = find(page, node => node.attributes['data-akari-choice-cards'] === 'プレビュー品質');
    assert.deepEqual(cards.children.map(card => card.getAttribute('data-value')), ['draft', 'final']);
    assert.ok(all(page).some(node => node._text === '今はこの値を読む機能がありません（AI 生成の品質段階として予約）'));
    cards.children[1].click();
    find(page, node => node.getAttribute('role') === 'switch').click();
    await dialog.preferenceWrites;
    assert.deepEqual(writes.map(([key, value]) => [key, value]), [['akari.qualityTier', 'final'], ['akari.timeline.visualThumbnails', true]]);
});
