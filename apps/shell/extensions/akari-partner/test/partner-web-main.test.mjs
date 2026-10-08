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
    const on = (name, callback) => {
        const callbacks = listeners.get(name) ?? [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
    };
    const removeListener = (name, callback) => {
        listeners.set(name, (listeners.get(name) ?? []).filter(listener => listener !== callback));
    };
    const emit = (name, ...args) => {
        for (const callback of listeners.get(name) ?? []) callback(...args);
    };
    const debuggerClient = {
            get attachCalls() { return attachCalls; },
            on(name, callback) {
                on('debugger:' + name, callback);
            },
            removeListener(name, callback) {
                if (destroyed) throw new Error('Object has been destroyed');
                removeListener('debugger:' + name, callback);
            },
            emit(name, ...args) {
                if (name === 'detach') attached = false;
                emit('debugger:' + name, ...args);
            },
            isAttached: () => attached,
            attach() { if (this.attachError) throw this.attachError; attachCalls++; attached = true; },
            async sendCommand(name, params) {
                if (this.commandError) throw this.commandError;
                commands.push({ name, params });
            }
    };
    const target = {
        commands,
        debugger: debuggerClient,
        getType: () => type,
        on,
        removeAllListeners(name) { listeners.delete(name); },
        removeListener,
        once(name, callback) {
            const once = (...args) => { removeListener(name, once); callback(...args); };
            on(name, once);
        },
        emit,
        listenerCount: name => (listeners.get(name) ?? []).length,
        isDestroyed: () => destroyed,
        destroy() { destroyed = true; emit('destroyed'); }
    };
    return new Proxy(target, {
        get(object, property, receiver) {
            if (destroyed) throw new Error('Object has been destroyed');
            return Reflect.get(object, property, receiver);
        }
    });
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
    return { app, webSession, dialogs, warnings, windowFor, main: new exports.PartnerWebMain(),
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
    const debuggerClient = guest.debugger;
    const commands = guest.commands;
    assert.equal(debuggerClient.isAttached(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ name: 'Emulation.setEmulatedMedia',
        params: { features: [{ name: 'prefers-color-scheme', value: 'dark' }] } }]);
    await fixture.invoke(host, 'setTheme', '1', 'light');
    await settle();
    assert.equal(commands.at(-1).params.features[0].value, 'light');
    assert.equal(commands.length, 2);
    assert.equal(debuggerClient.attachCalls, 1);
    let laterDestroyedListenerCalled = false;
    guest.once('destroyed', () => {
        laterDestroyedListenerCalled = true;
        assert.throws(() => guest.debugger, /Object has been destroyed/);
        assert.throws(() => guest.getType, /Object has been destroyed/);
    });
    assert.doesNotThrow(() => guest.destroy());
    assert.equal(laterDestroyedListenerCalled, true);
    assert.throws(() => debuggerClient.removeListener('detach', () => {}), /Object has been destroyed/);
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    await settle();
    assert.equal(commands.length, 2);
    debuggerClient.emit('detach', {}, 'later');
    assert.equal(fixture.warnings.length, 0);
});

for (const invalid of ['invalid', null, { unexpected: true }, 'system']) {
    test(`theme IPC ignores invalid value ${String(invalid)} without replacing the active theme`, async () => {
        const host = contents();
        host.mainFrame = {};
        const fixture = harness([host]);
        fixture.main.onStart({});
        await fixture.invoke(host, 'setTheme', '1', 'dark');
        const guest = contents('webview');
        attachGuardedGuest(host, guest);
        await settle();
        assert.equal(guest.commands.length, 1);
        await fixture.invoke(host, 'setTheme', '1', invalid);
        await settle();
        assert.equal(guest.commands.length, 1);
        assert.equal(guest.commands[0].params.features[0].value, 'dark');
    });
}

test('two windows keep separate themes, reject foreign owner IDs, and clear closed owners', async () => {
    const first = contents();
    const second = contents();
    first.windowId = 1;
    second.windowId = 2;
    first.mainFrame = {};
    second.mainFrame = {};
    const fixture = harness([first, second]);
    fixture.main.onStart({});
    await fixture.invoke(first, 'setTheme', '1', 'dark');
    await fixture.invoke(second, 'setTheme', '2', 'light');
    const firstGuest = contents('webview');
    const secondGuest = contents('webview');
    attachGuardedGuest(first, firstGuest);
    attachGuardedGuest(second, secondGuest);
    await settle();
    assert.deepEqual([firstGuest.commands.at(-1).params.features[0].value,
        secondGuest.commands.at(-1).params.features[0].value], ['dark', 'light']);
    await fixture.invoke(first, 'setTheme', '2', 'dark');
    await settle();
    assert.equal(secondGuest.commands.length, 1);
    assert.equal(secondGuest.commands[0].params.features[0].value, 'light');
    await fixture.invoke(first, 'setTheme', '1', 'light');
    await settle();
    assert.equal(firstGuest.commands.at(-1).params.features[0].value, 'light');
    assert.equal(secondGuest.commands.length, 1);
    fixture.windowFor(first).emit('closed');
    const afterClose = contents('webview');
    attachGuardedGuest(first, afterClose);
    await settle();
    assert.equal(afterClose.commands.length, 0);
    assert.equal(secondGuest.commands.at(-1).params.features[0].value, 'light');
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
    const debuggerClient = guest.debugger;
    debuggerClient.emit('detach', {}, 'target closed');
    assert.equal(fixture.warnings.length, 2);
    assert.equal(debuggerClient.attachCalls, 1);
    debuggerClient.emit('detach', {}, 'devtools opened');
    assert.equal(fixture.warnings.length, 3);
    assert.match(fixture.warnings[0], /attach failed/);
    assert.match(fixture.warnings[1], /command failed/);
    assert.match(fixture.warnings[2], /debugger detached/);
    assert.equal(debuggerClient.attachCalls, 1);
    debuggerClient.commandError = undefined;
    await fixture.invoke(host, 'setTheme', '1', 'dark');
    await settle();
    assert.equal(debuggerClient.attachCalls, 2);
    guest.destroy();
    debuggerClient.emit('detach', {}, 'later');
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
