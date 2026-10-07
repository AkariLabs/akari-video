import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const dialogPath = require.resolve('@theia/core/lib/browser/dialogs');
let confirmations = [];
let allowConfirmation = true;
require.cache[dialogPath] = { id: dialogPath, filename: dialogPath, loaded: true, exports: {
    ConfirmDialog: class {
        constructor(options) { confirmations.push(options); }
        async open() { return allowConfirmation; }
    }
} };

class Node {
    constructor(tag = 'div') {
        this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {};
        this.classList = { toggle() {} }; this._hidden = false; this.observers = []; this.disabled = false; this.textContent = '';
    }
    get hidden() { return this._hidden; }
    set hidden(value) { this._hidden = value; this.observers.forEach(observer => observer.callback()); }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parent = this; } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); }
    click() { if (!this.disabled) for (const fn of this.listeners.click ?? []) fn({ preventDefault() {} }); }
    closest() { return null; }
    getBoundingClientRect() { return { top: 0, bottom: 500 }; }
    focus() {}
    scrollIntoView() {}
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}
const nodes = root => [root, ...root.children.flatMap(nodes)];
const text = root => [root.textContent, ...root.children.map(text)].join(' ');
const byText = (root, label) => nodes(root).find(node => node.tag === 'button' && node.textContent === label);
globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag) };
globalThis.requestAnimationFrame = fn => { fn(); return 1; };
globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(node) { this.node = node; node.observers.push(this); }
    disconnect() { if (this.node) this.node.observers = this.node.observers.filter(observer => observer !== this); }
};

const { ListeningSettingsSection } = require('../lib/browser/listening-settings-section.js');
const { SettingsVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');
const { mountSettingsSectionBody } = require('akari-surfaces/lib/common/settings-section-body');

function fixture(values = {}) {
    const store = { 'akari.vibe.mode': 'off', 'akari.listening.engine': 'auto', 'akari.companion.enabled': true, ...values };
    const changes = [];
    const writes = [];
    const preferences = {
        inspect: key => ({ globalValue: store[key] }),
        onPreferenceChanged: fn => { changes.push(fn); return { dispose() { changes.splice(changes.indexOf(fn), 1); } }; },
        set: async (key, value, scope) => { writes.push([key, value, scope]); store[key] = value; changes.slice().forEach(fn => fn({ preferenceName: key })); }
    };
    const events = { status: [], level: [], utterance: [] };
    const ear = {
        capabilities: async () => ({ engines: [
            { id: 'speechanalyzer-live', available: true },
            { id: 'record-then-transcribe', available: false, reason: '利用できません' }
        ] }),
        startCalls: [], stopCalls: 0,
        start: async options => { ear.startCalls.push(options); return { state: 'listening', mic: 'ok', engine: options.engine }; },
        stop: async () => { ear.stopCalls++; return { state: 'idle', mic: 'unknown' }; },
        onStatus: fn => subscribe('status', fn),
        onLevel: fn => subscribe('level', fn),
        onUtterance: fn => subscribe('utterance', fn)
    };
    const subscribe = (kind, fn) => { events[kind].push(fn); return { dispose() { events[kind].splice(events[kind].indexOf(fn), 1); } }; };
    return { preferences, ear, writes, store, events };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('聞き取り節は 3 択を描き、ロック時に理由を示し、辞書未登録を無効にする', async () => {
    const data = fixture();
    const section = new ListeningSettingsSection();
    Object.assign(section, data, { commandRegistry: { getCommand: () => undefined }, commands: {}, windows: {} });
    const host = new Node();
    const view = section.render(host);
    await tick();
    assert.deepEqual(nodes(host).filter(node => node.attributes['role'] === 'radio').map(node => node.textContent),
        ['メモのみ', '画面を動かす', '画面も編集も']);
    assert.equal(byText(host, '開く').disabled, true);
    view.dispose();

    const locked = fixture({ 'akari.companion.enabled': false, 'akari.vibe.mode': 'full' });
    const lockedSection = new ListeningSettingsSection();
    Object.assign(lockedSection, locked, { commandRegistry: { getCommand: () => undefined }, commands: {}, windows: {} });
    const lockedHost = new Node();
    const lockedView = lockedSection.render(lockedHost);
    await tick();
    assert.equal(nodes(lockedHost).filter(node => node.attributes['role'] === 'radio').every(node => node.disabled), true);
    assert.match(text(lockedHost), /つながりがオフ/);
    assert.equal(locked.store['akari.vibe.mode'], 'full');
    lockedView.dispose();

    const noLive = fixture({ 'akari.vibe.mode': 'screen' });
    noLive.ear.capabilities = async () => ({ engines: [{ id: 'speechanalyzer-live', available: false, reason: '未対応' }] });
    const noLiveSection = new ListeningSettingsSection();
    Object.assign(noLiveSection, noLive, { commandRegistry: { getCommand: () => undefined }, commands: {}, windows: {} });
    const noLiveHost = new Node();
    const noLiveView = noLiveSection.render(noLiveHost);
    await tick();
    assert.equal(nodes(noLiveHost).filter(node => node.attributes['role'] === 'radio').every(node => node.disabled), true);
    assert.match(text(noLiveHost), /ライブの文字起こしに未対応/);
    assert.equal(noLive.store['akari.vibe.mode'], 'screen');
    noLiveView.dispose();
});

test('メモから画面への切替だけ確認し、試し聞きは節を離れると止まり保存しない', async () => {
    const data = fixture();
    const section = new ListeningSettingsSection();
    Object.assign(section, data, { commandRegistry: { getCommand: () => undefined }, commands: {}, windows: {} });
    const host = new Node();
    const view = section.render(host);
    await tick();
    confirmations = [];
    nodes(host).find(node => node.attributes['data-value'] === 'screen' && node.attributes.role === 'radio').click();
    await tick();
    assert.equal(confirmations.length, 1);
    assert.equal(data.store['akari.vibe.mode'], 'screen');
    nodes(host).find(node => node.attributes['data-value'] === 'full' && node.attributes.role === 'radio').click();
    await tick();
    assert.equal(confirmations.length, 1);
    assert.equal(data.store['akari.vibe.mode'], 'full');

    const base = process.env.TMPDIR ?? process.cwd();
    const sandbox = mkdtempSync(join(base, 'listening-trial-'));
    const previousHome = process.env.AKARI_HOME;
    const previousTmp = process.env.TMPDIR;
    const previousStorage = globalThis.localStorage;
    let storageWrites = 0;
    process.env.AKARI_HOME = sandbox;
    process.env.TMPDIR = sandbox;
    globalThis.localStorage = { setItem: () => { storageWrites++; } };
    try {
        const before = readdirSync(sandbox);
        byText(host, '話してみる').click();
        await tick();
        assert.deepEqual(data.ear.startCalls, [{ purpose: 'trial', engine: 'speechanalyzer-live' }]);
        view.dispose();
        await tick();
        assert.equal(data.ear.stopCalls, 1);
        assert.deepEqual(readdirSync(sandbox), before);
        assert.equal(storageWrites, 0);
    } finally {
        process.env.AKARI_HOME = previousHome;
        process.env.TMPDIR = previousTmp;
        globalThis.localStorage = previousStorage;
        rmSync(sandbox, { recursive: true, force: true });
    }
});

test('区画の設定タブには聞き取り・Jev・辞書の実件数が出る', async () => {
    const data = fixture();
    const tab = new SettingsVibeDockTab();
    Object.assign(tab, data, { commands: { executeCommand() {} }, dictionary: { list: async () => ({ user: [{ id: 'one' }], builtin: [] }) } });
    const host = new Node();
    const view = tab.render(host, {});
    await tick();
    const summary = nodes(host).find(node => node.attributes['aria-label'] === '設定の要約');
    assert.equal(summary.children.length, 3);
    assert.match(text(summary), /聞き取り: ライブ文字起こし/);
    assert.match(text(summary), /Jev で画面を動かす/);
    assert.match(text(summary), /辞書/);
    assert.match(text(summary), /1/);
    assert.match(summary.title, /マイク: 許可あり/);
    view.dispose();
});

test('節から離れると試し聞きを停止する', async () => {
    const data = fixture();
    const section = new ListeningSettingsSection();
    Object.assign(section, data, { commandRegistry: { getCommand: () => undefined }, commands: {}, windows: {} });
    const host = new Node();
    const slot = mountSettingsSectionBody(host, section);
    await tick();
    byText(host, '話してみる').click();
    await tick();
    host.hidden = true;
    await tick();
    assert.equal(data.ear.stopCalls, 1);
    slot.dispose();
});
