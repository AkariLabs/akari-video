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
    const pendingOpens = [];
    let tick;
    let nextTimer = 0;
    class ReactWidgetStub {
        constructor() {
            this.title = {};
            this.node = { style: {} };
            this.isVisible = true;
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
    const web = {
        open: url => {
            events.push(['open', url]);
            return new Promise((resolve, reject) => { pendingOpens.push({ resolve, reject }); });
        },
        bounds: rect => { events.push(['bounds', rect]); return Promise.resolve(); },
        close: () => { events.push('close'); return Promise.resolve(); }
    };
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
        exports, require: id => {
            assert.ok(id in modules, `unexpected import: ${id}`);
            return modules[id];
        },
        window: { innerWidth: 1200, electronAkariPartner: { web } },
        setInterval: callback => { tick = callback; return 1; },
        clearInterval: () => undefined,
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
    widget.host = { getBoundingClientRect: () => ({ left: 40, top: 60, width: 300, height: 200 }) };
    events.length = 0;
    return {
        widget, events, tick: () => tick(),
        resolveOpen: (index = 0) => pendingOpens[index].resolve(),
        rejectOpen: (error, index = 0) => pendingOpens[index].reject(error),
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

test('web widget sends real bounds while open is still loading', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    assert.equal(fixture.widget.hasLaunch, true);
    assert.equal(fixture.widget.loaded, false);
    assert.match(JSON.stringify(fixture.widget.render()), /DeepSeek Harness を読み込んでいます/);
    fixture.tick();
    assert.equal(fixture.events[0], 'update');
    assert.deepEqual(Array.from(fixture.events[1]), ['open', launch.url]);
    assert.equal(fixture.events[2][0], 'bounds');
    assert.equal(fixture.events[2][1].visible, true);
    fixture.resolveOpen();
    await opening;
    assert.equal(fixture.widget.loaded, true);
    assert.doesNotMatch(JSON.stringify(fixture.widget.render()), /読み込んでいます/);
    fixture.widget.dispose();
});

test('web widget closes its view and stops dsh when open rejects', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    fixture.rejectOpen(new Error('load failed'));
    await assert.rejects(opening, /load failed/);
    assert.equal(fixture.widget.isDisposed, true);
    assert.ok(fixture.events.includes('close'));
    assert.deepEqual(Array.from(fixture.events.find(event => Array.isArray(event) && event[0] === 'stop')),
        ['stop', launch.pid, 'window-a']);
});

test('web widget has no 60-second cutoff and offers foreground guidance and retry after 20 seconds', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    assert.deepEqual(fixture.pendingDelays(), [20_000]);
    fixture.fireAfter(20_000);
    const rendered = fixture.widget.render();
    assert.match(JSON.stringify(rendered), /このウィンドウを前面に出すと読み込みが進みます/);
    assert.ok(findButton(rendered.children[0]));
    assert.equal(findButton(rendered.children[1]), undefined);
    assert.deepEqual(fixture.pendingDelays(), []);
    assert.equal(fixture.widget.isDisposed, false);
    assert.equal(fixture.widget.loaded, false);
    assert.equal(fixture.events.includes('close'), false);
    fixture.resolveOpen();
    await opening;
    assert.equal(fixture.widget.loaded, true);
    assert.doesNotMatch(JSON.stringify(fixture.widget.render()), /時間がかかっています/);
    fixture.widget.dispose();
});

test('retry closes the view and opens the same URL without stopping dsh', async () => {
    const fixture = harness();
    const opening = fixture.widget.open('deepseek', launch, 'window-a');
    fixture.fireAfter(20_000);
    findButton(fixture.widget.render()).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.events.filter(event => Array.isArray(event) && event[0] === 'open')
        .map(event => event[1]), [launch.url, launch.url]);
    const closeIndex = fixture.events.indexOf('close');
    const secondOpenIndex = fixture.events.findIndex((event, index) => index > closeIndex
        && Array.isArray(event) && event[0] === 'open');
    assert.ok(closeIndex >= 0 && secondOpenIndex > closeIndex);
    fixture.rejectOpen(new Error('closed for retry'));
    fixture.resolveOpen(1);
    await opening;
    assert.equal(fixture.widget.loaded, true);
    assert.equal(fixture.widget.isDisposed, false);
    assert.equal(fixture.events.some(event => Array.isArray(event) && event[0] === 'stop'), false);
    fixture.widget.dispose();
});
