import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/electron-main/partner-web-main.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

function contents(type = 'window') {
    const listeners = new Map();
    return {
        getType: () => type,
        on(name, callback) {
            const callbacks = listeners.get(name) ?? [];
            callbacks.push(callback);
            listeners.set(name, callbacks);
        },
        emit(name, ...args) { for (const callback of listeners.get(name) ?? []) callback(...args); },
        listenerCount: name => (listeners.get(name) ?? []).length
    };
}

function harness(existing) {
    const app = contents('app');
    const exports = {};
    const electron = {
        app,
        webContents: { getAllWebContents: () => existing },
        session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
        ipcMain: { handle() {} },
        BrowserWindow: { fromWebContents: () => undefined },
        dialog: {}, shell: {}
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
        URL
    });
    return { app, main: new exports.PartnerWebMain() };
}

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
    assert.equal(guestContents.listenerCount('will-attach-webview'), 0);
    app.emit('web-contents-created', {}, existingWindow);
    assert.equal(existingWindow.listenerCount('will-attach-webview'), 1);
    const laterWindow = contents();
    app.emit('web-contents-created', {}, laterWindow);
    assert.equal(laterWindow.listenerCount('will-attach-webview'), 1);
});

test('existing window rejects invalid src and closes guests without a matching guard pass', () => {
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
    let rejected = false;
    window.emit('will-attach-webview', { preventDefault() { rejected = true; } },
        { partition: 'persist:akari-partner-deepseek' }, { src: 'http://127.0.0.1:42317/' });
    assert.equal(rejected, false);
    window.emit('did-attach-webview', {}, guest);
    assert.equal(guest.listenerCount('will-navigate'), 1);
    assert.equal(guest.listenerCount('will-redirect'), 1);
    assert.equal(typeof guest.windowOpenHandler, 'function');
});
