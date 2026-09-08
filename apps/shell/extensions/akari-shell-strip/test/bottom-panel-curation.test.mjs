import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldCloseAtStartup, BOTTOM_PANEL_MENU_ITEMS, PARTNER_TERMINAL_KIND, TIMELINE_WIDGET_ID } =
    require('../lib/common/bottom-panel-curation.js');

test('復元済み bottom の Theia 既定タブだけを閉じる', () => {
    for (const id of ['problems', 'outputView', 'debug-console']) {
        assert.equal(shouldCloseAtStartup({ id, area: 'bottom', isTerminal: false }), true, id);
        for (const area of ['main', 'left', 'right', undefined]) {
            assert.equal(shouldCloseAtStartup({ id, area, isTerminal: false }), false, `${id}/${area}`);
        }
    }
});

test('タイムラインと未知のタブを保持する', () => {
    for (const id of [TIMELINE_WIDGET_ID, 'custom-output', 'terminal', 'zsh', 'akari-partner-onboarding']) {
        assert.equal(shouldCloseAtStartup({ id, area: 'bottom', isTerminal: false }), false, id);
    }
});

test('端末はタイトルや ID でなく型と kind で判定する', () => {
    for (const label of ['zsh', 'Claude', 'Codex', 'タイムライン', '']) {
        const terminal = { id: 'terminal-123', area: 'bottom', isTerminal: true, label };
        assert.equal(shouldCloseAtStartup({ ...terminal, kind: 'user' }), true, label);
        assert.equal(shouldCloseAtStartup({ ...terminal, kind: PARTNER_TERMINAL_KIND }), false, label);
        assert.equal(shouldCloseAtStartup({ ...terminal, kind: undefined }), false, label);
        assert.equal(shouldCloseAtStartup({ ...terminal, kind: 'user', area: 'right' }), false, label);
        assert.equal(shouldCloseAtStartup({ ...terminal, kind: 'user', area: 'main' }), false, label);
    }
});

test('パートナー端末が誤って bottom にあっても保護する', () => {
    assert.equal(PARTNER_TERMINAL_KIND, 'akari-partner');
    for (const id of ['terminal-123', 'problems', 'outputView', 'debug-console']) {
        assert.equal(shouldCloseAtStartup({ id, area: 'bottom', isTerminal: true, kind: 'akari-partner' }), false);
    }
});

test('プルダウンはタイムラインとターミナルだけ', () => {
    assert.deepEqual(BOTTOM_PANEL_MENU_ITEMS, [
        { id: 'timeline', label: 'タイムライン' },
        { id: 'terminal', label: 'ターミナル' }
    ]);
});

// ブラウザー依存の境界だけを差し替え、実際にビルドされた contribution の
// 起動処理・イベント購読を実行する。ソース文字列の一致では再掃除の退行を検知できない。
class TerminalWidget {}
class DisposableCollection {
    entries = [];
    push(entry) { this.entries.push(entry); }
    dispose() { this.entries.splice(0).forEach(entry => entry.dispose()); }
}
function signal() {
    const listeners = new Map();
    return {
        connect(fn, context) { listeners.set(fn, context); },
        disconnect(fn) { listeners.delete(fn); },
        fire() { for (const [fn, context] of listeners) fn.call(context); },
        event(fn) { listeners.set(fn, undefined); return { dispose: () => listeners.delete(fn) }; }
    };
}
const originalLoad = Module._load;
let AkariBottomPanelCuration;
try {
    Module._load = function (id, ...args) {
        if (id === '@theia/core/shared/inversify') return { inject: () => () => {}, injectable: () => value => value };
        if (id === '@theia/core/lib/browser' || id === '@theia/core/shared/@lumino/widgets') return {};
        if (id === '@theia/core/lib/common') return { DisposableCollection, CommandRegistry: class {} };
        if (id === '@theia/terminal/lib/browser/base/terminal-widget') return { TerminalWidget };
        if (id === '@theia/terminal/lib/browser/base/terminal-service') return { TerminalService: Symbol() };
        if (id === '@theia/terminal/lib/browser/terminal-frontend-contribution') return { TerminalCommands: { NEW: { id: 'terminal:new' } } };
        if (id === './akari-developer-mode-service') return { AkariDeveloperModeService: class {} };
        return originalLoad.call(this, id, ...args);
    };
    ({ AkariBottomPanelCuration } = require('../lib/browser/akari-bottom-panel-curation.js'));
} finally {
    Module._load = originalLoad;
}

function harness(widgets, enabled = false) {
    const added = signal();
    const changed = signal();
    const layout = signal();
    const closed = [];
    const activated = [];
    const commands = [];
    const service = new AkariBottomPanelCuration();
    const shell = {
        bottomPanel: { widgets: () => widgets.filter(widget => widget.area === 'bottom'), tabBars: () => [], layoutModified: layout },
        getAreaFor: widget => widget.area,
        async closeWidget(id) { closed.push(id); widgets.splice(widgets.findIndex(widget => widget.id === id), 1); },
        onDidAddWidget: fn => added.event(fn),
        async activateWidget(id) { activated.push(id); },
        async addWidget(widget, { area }) { widget.area = area; added.fire(); },
        pendingUpdates: Promise.resolve()
    };
    service.developerMode = { isEnabled: enabled, onDidChange: fn => changed.event(fn) };
    service.commands = { async executeCommand(id) { commands.push(id); } };
    service.terminals = { all: [] };
    return { service, shell, closed, activated, commands, added, changed, layout };
}

test('起動時だけ掃除し、後から追加した端末や問題タブは F6 切替でも閉じない', async () => {
    const partner = Object.assign(new TerminalWidget(), { id: 'partner', kind: 'akari-partner', area: 'bottom' });
    const terminal = Object.assign(new TerminalWidget(), { id: 'shell', kind: 'user', area: 'bottom' });
    const widgets = [partner, terminal, { id: 'problems', area: 'bottom' }, { id: TIMELINE_WIDGET_ID, area: 'bottom' }];
    const h = harness(widgets);
    await h.service.onDidInitializeLayout({ shell: h.shell });
    assert.deepEqual(h.closed, ['shell', 'problems']);
    widgets.push(terminal, { id: 'problems', area: 'bottom' });
    h.added.fire();
    h.layout.fire();
    for (const enabled of [true, false]) {
        h.service.developerMode.isEnabled = enabled;
        h.changed.fire();
    }
    await h.service.onDidInitializeLayout({ shell: h.shell });
    assert.deepEqual(h.closed, ['shell', 'problems']);
    assert.ok(widgets.includes(partner));
    h.service.onStop();
});

test('開発者モードで起動した場合は掃除せず、OFF にしても復元タブを維持する', async () => {
    const widgets = [{ id: 'problems', area: 'bottom' }];
    const h = harness(widgets, true);
    await h.service.onDidInitializeLayout({ shell: h.shell });
    h.service.developerMode.isEnabled = false;
    h.changed.fire();
    assert.deepEqual(h.closed, []);
    h.service.onStop();
});

test('タイムライン項目は既存タブの有無にかかわらず常に akari.annotations.open を呼び、activateWidget は呼ばない', async () => {
    const widgets = [{ id: TIMELINE_WIDGET_ID, area: 'bottom' }];
    const h = harness(widgets);
    await h.service.onDidInitializeLayout({ shell: h.shell });
    await h.service.selectItem('timeline');
    assert.deepEqual(h.activated, []);
    assert.deepEqual(h.commands, ['akari.annotations.open']);
    widgets.splice(0);
    await h.service.selectItem('timeline');
    assert.deepEqual(h.activated, []);
    assert.deepEqual(h.commands, ['akari.annotations.open', 'akari.annotations.open']);
    h.service.onStop();
});

test('terminal:new の新規端末を bottom に置き、既存・パートナー端末は動かさない', async () => {
    const h = harness([]);
    await h.service.onDidInitializeLayout({ shell: h.shell });
    const existing = { id: 'existing', kind: 'user', area: 'main' };
    const created = { id: 'new', kind: 'user', area: 'main' };
    const partner = { id: 'partner', kind: 'akari-partner', area: 'right' };
    h.service.terminals.all.push(existing);
    h.service.commands.executeCommand = async id => {
        h.commands.push(id);
        h.service.terminals.all.push(created, partner);
    };
    await h.service.selectItem('terminal');
    assert.deepEqual(h.commands, ['terminal:new']);
    assert.equal(created.area, 'bottom');
    assert.equal(existing.area, 'main');
    assert.equal(partner.area, 'right');
    assert.deepEqual(h.activated, ['new']);
    assert.deepEqual(h.closed, []);
    h.service.onStop();
});
