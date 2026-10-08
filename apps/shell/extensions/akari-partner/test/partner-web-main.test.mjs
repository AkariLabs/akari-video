import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/electron-main/partner-web-main.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

function contents(type = 'window') {
    const listeners = new Map();
    let destroyed = false;
    let attached = false;
    let attachCalls = 0;
    const commands = [];
    return {
        commands,
        getType: () => type,
        on(name, callback) {
            const callbacks = listeners.get(name) ?? [];
            callbacks.push(callback);
            listeners.set(name, callbacks);
        },
        removeAllListeners(name) { listeners.delete(name); },
        removeListener(name, callback) {
            listeners.set(name, (listeners.get(name) ?? []).filter(listener => listener !== callback));
        },
        once(name, callback) {
            const once = (...args) => { this.removeListener(name, once); callback(...args); };
            this.on(name, once);
        },
        emit(name, ...args) { for (const callback of listeners.get(name) ?? []) callback(...args); },
        listenerCount: name => (listeners.get(name) ?? []).length,
        isDestroyed: () => destroyed,
        destroy() { destroyed = true; this.emit('destroyed'); },
        debugger: {
            get attachCalls() { return attachCalls; },
            on(name, callback) {
                const callbacks = listeners.get('debugger:' + name) ?? [];
                callbacks.push(callback);
                listeners.set('debugger:' + name, callbacks);
            },
            removeListener(name, callback) {
                listeners.set('debugger:' + name,
                    (listeners.get('debugger:' + name) ?? []).filter(listener => listener !== callback));
            },
            emit(name, ...args) {
                for (const callback of listeners.get('debugger:' + name) ?? []) callback(...args);
            },
            isAttached: () => attached,
            attach() { if (this.attachError) throw this.attachError; attachCalls++; attached = true; },
            async sendCommand(name, params) {
                if (this.commandError) throw this.commandError;
                commands.push({ name, params });
            }
        }
    };
}

function harness(existing) {
    const app = contents('app');
    const webSession = contents('session');
    webSession.setPermissionRequestHandler = () => undefined;
    webSession.setPermissionCheckHandler = () => undefined;
    webSession.webRequest = { onBeforeRequest(listener) { webSession.beforeRequest = listener; } };
    const dialogs = [];
    const warnings = [];
    const exports = {};
    const windows = new WeakMap();
    const ipcHandlers = new Map();
    const windowFor = sender => {
        if (sender.noWindow) return undefined;
        let window = windows.get(sender);
        if (!window) {
            window = contents('window');
            window.id = sender.windowId ?? 1;
            windows.set(sender, window);
        }
        return window;
    };
    const electron = {
        app,
        webContents: { getAllWebContents: () => existing },
        session: { fromPartition: partition => {
            assert.equal(partition, 'persist:akari-partner-deepseek');
            return webSession;
        } },
        ipcMain: { handle(name, handler) { ipcHandlers.set(name, handler); } },
        BrowserWindow: { fromWebContents: windowFor },
        dialog: { async showMessageBox(_window, options) { dialogs.push(options); return { response: 0 }; } },
        shell: { async openExternal() { assert.fail('external navigation was not approved'); } }
    };
    const modules = {
        '@theia/core/electron-shared/electron': electron,
        '@theia/core/shared/inversify': { injectable: () => target => target },
        '../electron-common/electron-api': { CHANNEL_PARTNER_WEB: 'AkariPartnerWeb' },
        '../electron-common/partner-web-url': require('../lib/electron-common/partner-web-url.js')
    };
    vm.runInNewContext(source, {
        exports,
        require: id => {
            assert.ok(id in modules, `unexpected import: ${id}`);
            return modules[id];
        },
        URL,
        console: { warn: message => warnings.push(message) }
    });
    return { app, webSession, dialogs, warnings, main: new exports.PartnerWebMain(),
        invoke: (sender, operation, ...args) => {
            const handler = ipcHandlers.get('AkariPartnerWeb');
            return handler({ sender, senderFrame: sender.mainFrame }, operation, ...args);
        } };
}

function attachGuardedGuest(host, guest) {
    guest.close = () => assert.fail('valid guest closed');
    guest.setWindowOpenHandler = () => undefined;
    host.emit('will-attach-webview', { preventDefault() { assert.fail('valid attach rejected'); } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
    host.emit('did-attach-webview', {}, guest);
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('owner theme reaches guarded guests at attach and updates without a reload', async () => {
    const host = contents();
    host.mainFrame = {};
    const fixture = harness([host]);
    fixture.main.onStart({});
    assert.equal(await fixture.invoke(host, 'ownerId'), '1');
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    const guest = contents('webview');
    attachGuardedGuest(host, guest);
    await settle();
    assert.equal(guest.debugger.isAttached(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(guest.commands)), [{ name: 'Emulation.setEmulatedMedia',
        params: { features: [{ name: 'prefers-color-scheme', value: 'dark' }] } }]);
    await fixture.invoke(host, 'setTheme', '1', 'light');
    await settle();
    assert.equal(guest.commands.at(-1).params.features[0].value, 'light');
    await fixture.invoke(host, 'setTheme', '1', 'system');
    await settle();
    assert.equal(guest.commands.at(-1).params.features[0].value, '');
    assert.equal(guest.commands.length, 3);
    assert.equal(guest.debugger.attachCalls, 1);
    guest.destroy();
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    await settle();
    assert.equal(guest.commands.length, 3);
    assert.equal(guest.listenerCount('debugger:detach'), 0);
});

test('theme IPC ignores mismatched owners and values outside the three choices', async () => {
    const host = contents();
    host.mainFrame = {};
    const fixture = harness([host]);
    fixture.main.onStart({});
    for (const [ownerId, theme] of [['other', 'dark'], ['1', 'invalid'], ['1', null]]) {
        await fixture.invoke(host, 'setTheme', ownerId, theme);
    }
    const guest = contents('webview');
    attachGuardedGuest(host, guest);
    await settle();
    assert.equal(guest.debugger.isAttached(), false);
    assert.equal(guest.commands.length, 0);
    await fixture.invoke(host, 'setTheme', '1', 'system');
    await settle();
    assert.equal(guest.debugger.isAttached(), false);
    assert.equal(guest.commands.length, 0);
});

test('debugger failures and detach do not interrupt a guarded work screen', async () => {
    const host = contents();
    host.mainFrame = {};
    const fixture = harness([host]);
    fixture.main.onStart({});
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    const guest = contents('webview');
    guest.debugger.attachError = new Error('attach failed');
    attachGuardedGuest(host, guest);
    await settle();
    assert.equal(guest.commands.length, 0);
    assert.equal(guest.listenerCount('will-navigate'), 1);
    guest.debugger.attachError = undefined;
    guest.debugger.commandError = new Error('command failed');
    await fixture.invoke(host, 'setTheme', '1', 'light');
    await settle();
    guest.debugger.emit('detach', {}, 'devtools opened');
    assert.equal(fixture.warnings.length, 3);
    assert.match(fixture.warnings[0], /attach failed/);
    assert.match(fixture.warnings[1], /command failed/);
    assert.match(fixture.warnings[2], /debugger detached/);
    guest.destroy();
    guest.debugger.emit('detach', {}, 'later');
    assert.equal(fixture.warnings.length, 3);
});

test('guest without a successful guard pass receives no theme command', async () => {
    const host = contents();
    host.mainFrame = {};
    const fixture = harness([host]);
    fixture.main.onStart({});
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    const guest = contents('webview');
    let closed = false;
    guest.close = () => { closed = true; };
    host.emit('did-attach-webview', {}, guest);
    await settle();
    assert.equal(closed, true);
    assert.equal(guest.commands.length, 0);
});

test('guard installs before onStart, catches existing windows, and does not install twice', () => {
    const earlyWindow = contents();
    const existingWindow = contents();
    const guestContents = contents('webview');
    const { app, main } = harness([earlyWindow, existingWindow, guestContents]);
    assert.equal(app.listenerCount('web-contents-created'), 1);
    app.emit('web-contents-created', {}, earlyWindow);
    assert.equal(earlyWindow.listenerCount('will-attach-webview'), 1);
    main.onStart({});
    assert.equal(earlyWindow.listenerCount('will-attach-webview'), 1);
    assert.equal(existingWindow.listenerCount('will-attach-webview'), 1);
    assert.equal(existingWindow.listenerCount('did-attach-webview'), 1);
    assert.equal(guestContents.listenerCount('will-attach-webview'), 1);
    app.emit('web-contents-created', {}, existingWindow);
    assert.equal(existingWindow.listenerCount('will-attach-webview'), 1);
    const laterWindow = contents();
    app.emit('web-contents-created', {}, laterWindow);
    assert.equal(laterWindow.listenerCount('will-attach-webview'), 1);
});

test('existing contents rejects invalid src and closes guests without a matching guard pass', () => {
    const window = contents();
    harness([window]).main.onStart({});
    for (const [src, partition] of [
        ['https://example.com/', 'persist:akari-partner-deepseek'],
        ['http://127.0.0.1:9/', 'persist:other'],
        ['http://localhost:9/', 'persist:akari-partner-deepseek']
    ]) {
        let rejected = false;
        window.emit('will-attach-webview', { preventDefault() { rejected = true; } }, { partition }, { src });
        assert.equal(rejected, true, src);
    }
    let closed = false;
    window.emit('did-attach-webview', {}, {
        getType: () => 'webview', close(options) {
            assert.equal(options.waitForBeforeUnload, false);
            closed = true;
        }
    });
    assert.equal(closed, true);

    const guest = contents('webview');
    guest.close = () => assert.fail('valid guest closed');
    guest.setWindowOpenHandler = handler => { guest.windowOpenHandler = handler; };
    guest.on('will-navigate', event => event.preventDefault());
    let rejected = false;
    window.emit('will-attach-webview', { preventDefault() { rejected = true; } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
    assert.equal(rejected, false);
    window.emit('did-attach-webview', {}, guest);
    assert.equal(guest.listenerCount('will-navigate'), 1);
    assert.equal(guest.listenerCount('will-redirect'), 1);
    assert.equal(guest.listenerCount('did-navigate'), 1);
    assert.equal(typeof guest.windowOpenHandler, 'function');
});

test('guest navigation replaces Theia blanket denial and offers external HTTPS', async () => {
    const host = contents();
    const { main, dialogs } = harness([host]);
    main.onStart({});
    const guest = contents('webview');
    guest.close = () => assert.fail('allowed guest closed');
    guest.setWindowOpenHandler = () => undefined;
    guest.on('will-navigate', event => event.preventDefault());
    host.emit('will-attach-webview', { preventDefault() { assert.fail('valid attach rejected'); } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
    host.emit('did-attach-webview', {}, guest);
    let prevented = false;
    guest.emit('will-navigate', { preventDefault() { prevented = true; } }, 'http://127.0.0.1:42317/chat');
    assert.equal(prevented, false);
    guest.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.com/');
    assert.equal(prevented, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].detail, 'https://example.com/');
});

test('programmatic cross-origin navigation returns to the attach origin without recursion', () => {
    const host = contents();
    harness([host]).main.onStart({});
    for (const target of ['https://example.com/', 'file:///tmp/escape.html', 'about:blank']) {
        const guest = contents('webview');
        const loadedUrls = [];
        guest.close = () => assert.fail('valid guest closed');
        guest.loadURL = url => { loadedUrls.push(url); return Promise.resolve(); };
        guest.setWindowOpenHandler = () => undefined;
        host.emit('will-attach-webview', { preventDefault() { assert.fail('valid attach rejected'); } },
            { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
        host.emit('did-attach-webview', {}, guest);
        guest.emit('did-navigate', {}, 'http://127.0.0.1:42317/chat');
        assert.deepEqual(loadedUrls, []);
        guest.emit('did-navigate', {}, target);
        assert.deepEqual(loadedUrls, ['http://127.0.0.1:42317/'], target);
        guest.emit('did-navigate', {}, target);
        assert.equal(loadedUrls.length, 1, 'one recovery at a time');
        guest.emit('did-navigate', {}, 'http://127.0.0.1:42317/');
        assert.equal(loadedUrls.length, 1, 'recovery did-navigate does not recurse');
    }
});

test('pending origin is overwritten and dedicated-partition requests are filtered', () => {
    const host = contents();
    const { main, webSession } = harness([host]);
    main.onStart({});
    let downloadPrevented = false;
    webSession.emit('will-download', { preventDefault() { downloadPrevented = true; } });
    assert.equal(downloadPrevented, true);
    const response = details => {
        let result;
        webSession.beforeRequest(details, value => { result = value; });
        return result;
    };
    assert.equal(response({ url: 'https://example.com/', resourceType: 'mainFrame' }).cancel, true);
    assert.equal(response({ url: 'http://127.0.0.1:42317/', resourceType: 'mainFrame' }).cancel, false);
    assert.equal(response({ url: 'https://example.com/app.js', resourceType: 'script' }).cancel, false);
    host.emit('will-attach-webview', { preventDefault() { assert.fail('valid attach rejected'); } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
    host.emit('will-attach-webview', { preventDefault() { assert.fail('valid attach rejected'); } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42318/' });
    const guest = contents('webview');
    const loadedUrls = [];
    let closed = false;
    guest.close = () => { closed = true; };
    guest.loadURL = url => { loadedUrls.push(url); return Promise.resolve(); };
    guest.setWindowOpenHandler = () => undefined;
    host.emit('did-attach-webview', {}, guest);
    guest.emit('did-navigate', {}, 'http://127.0.0.1:42317/');
    assert.deepEqual(loadedUrls, ['http://127.0.0.1:42318/']);
    assert.equal(closed, false);
    closed = false;
    host.emit('did-attach-webview', {}, guest);
    assert.equal(closed, true);
});
