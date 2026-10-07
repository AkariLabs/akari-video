import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/browser/akari-partner-web-widget.js', import.meta.url), 'utf8');
const noopDecorator = () => () => undefined;
const launch = { url: 'http://127.0.0.1:42317/?token=fixture', pid: 42317, cwd: 'C:\\project',
    provider: 'deepseek-official', providerNote: 'fixture' };

function harness() {
    const events = [];
    const timers = new Map();
    const created = [];
    let nextTimer = 0;
    const host = {
        children: [],
        appendChild(element) {
            element.parentElement = this;
            this.children.push(element);
            events.push(['append', element]);
        }
    };
    class ReactWidgetStub {
        constructor() {
            this.title = {};
            this.node = { style: {} };
            this.isDisposed = false;
            this.disposed = { connect: callback => { this.onDispose = callback; } };
        }
        update() { events.push('update'); }
        dispose() {
            if (this.isDisposed) return;
            this.isDisposed = true;
            events.push('dispose');
            this.onDispose?.();
        }
    }
    const modules = {
        '@theia/core/shared/react': { createElement: (type, props, ...children) => ({ type, props, children }) },
        '@theia/core/shared/inversify': { inject: noopDecorator, injectable: noopDecorator, postConstruct: noopDecorator },
        '@theia/core/lib/browser/widgets/react-widget': { ReactWidget: ReactWidgetStub },
        '../common/akari-partner-protocol': { AkariPartnerServer: Symbol('server') },
        './partner-catalog': { PARTNER_AGENT_LABELS: { deepseek: 'DeepSeek Harness' },
            PARTNER_CLI_ICON_CLASSES: { deepseek: 'codicon' } },
        '../electron-common/electron-api': {}
    };
    const exports = {};
    vm.runInNewContext(source, {
        exports,
        require: id => {
            assert.ok(id in modules, `unexpected import: ${id}`);
            return modules[id];
        },
        document: { createElement(tag) {
            assert.equal(tag, 'webview');
            const listeners = new Map();
            const element = {
                attributes: {}, style: {}, parentElement: null,
                setAttribute(name, value) { this.attributes[name] = value; events.push(['attribute', name]); },
                addEventListener(name, callback) { listeners.set(name, callback); },
                emit(name, detail = {}) { listeners.get(name)?.(detail); },
                remove() {
                    if (!this.parentElement) return;
                    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
                    this.parentElement = null;
                    events.push(['remove', this]);
                }
            };
            created.push(element);
            return element;
        } },
        setTimeout: (callback, delay) => {
            const id = ++nextTimer;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        console
    });
    const widget = new exports.PartnerWebWidget();
    widget.server = { stopWebPartner: async (pid, ownerId) => { events.push(['stop', pid, ownerId]); } };
    widget.init();
    widget.host = host;
    events.length = 0;
    return {
        widget, host, created, events,
        fireAfter: delay => {
            const [id, timer] = [...timers].find(([, value]) => value.delay === delay);
            timers.delete(id);
            timer.callback();
        },
        pendingDelays: () => [...timers.values()].map(timer => timer.delay)
    };
}

function findButton(node) {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 'button') return node;
    for (const child of node.children ?? []) {
        const found = findButton(child);
        if (found) return found;
    }
    return undefined;
}

test('launch creates a configured webview before attach and load event completes opening', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    const webview = fixture.created[0];
    assert.equal(fixture.host.children[0], webview);
    assert.equal(fixture.widget.loaded, false);
    assert.equal(webview.attributes.src, launch.url);
    assert.equal(webview.attributes.partition, 'persist:akari-partner-deepseek');
    assert.match(webview.attributes.webpreferences, /backgroundThrottling=no/);
    assert.equal(webview.attributes.allowpopups, undefined);
    assert.deepEqual(Object.assign({}, webview.style), { width: '100%', height: '100%', display: 'flex' });
    assert.ok(fixture.events.findIndex(event => event[0] === 'append') >
        fixture.events.findIndex(event => event[0] === 'attribute' && event[1] === 'webpreferences'));
    webview.emit('did-finish-load');
    await opening;
    assert.equal(fixture.widget.loaded, true);
    fixture.widget.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.host.children.length, 0);
    assert.deepEqual(Array.from(fixture.events.find(event => event[0] === 'stop')), ['stop', launch.pid, 'window-a']);
});

test('20-second guidance keeps loading and retry replaces the webview without stopping dsh', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    assert.deepEqual(fixture.pendingDelays(), [20_000]);
    fixture.fireAfter(20_000);
    assert.ok(findButton(fixture.widget.render()));
    assert.equal(fixture.widget.isDisposed, false);
    findButton(fixture.widget.render()).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.created.length, 2);
    assert.equal(fixture.host.children.length, 1);
    assert.equal(fixture.host.children[0], fixture.created[1]);
    assert.equal(fixture.events.some(event => event[0] === 'stop'), false);
    fixture.created[1].emit('did-fail-load', { isMainFrame: false, errorCode: -6 });
    fixture.created[1].emit('did-fail-load', { isMainFrame: true, errorCode: -3 });
    assert.equal(fixture.widget.isDisposed, false);
    fixture.created[1].emit('did-finish-load');
    await opening;
    assert.equal(fixture.widget.loaded, true);
    fixture.widget.dispose();
});

test('main-frame failure and renderer crash dispose the webview and stop dsh', async () => {
    for (const failure of ['did-fail-load', 'render-process-gone']) {
        const fixture = harness();
        const opening = fixture.widget.open('deepseek', launch, 'window-a');
        fixture.created[0].emit(failure, { isMainFrame: true, errorCode: -6, errorDescription: 'load failed' });
        await assert.rejects(opening, failure === 'did-fail-load' ? /load failed/ : /停止/);
        assert.equal(fixture.widget.isDisposed, true);
        assert.equal(fixture.host.children.length, 0);
        assert.deepEqual(Array.from(fixture.events.find(event => event[0] === 'stop')),
            ['stop', launch.pid, 'window-a']);
    }
});
