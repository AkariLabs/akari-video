import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readHandlerCompiled } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const placeholder = require('../lib/common/preview-placeholder.js');
const source = readHandlerCompiled();
function method(name) {
    const start = source.search(new RegExp(`    (?:async )?${name}\\(`, 'u'));
    assert.notEqual(start, -1, name);
    const rest = source.slice(start);
    return rest.slice(0, rest.indexOf('\n    }') + 6);
}
class URI {
    constructor(value) { this.value = value; }
    normalizePath() { return this; }
    toString() { return this.value; }
}
class Element {
    constructor() { this.children = []; this.style = {}; this.attributes = new Map(); this.innerHTML = ''; this.dataset = {}; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    appendChild(child) { child.parent = this; this.children.push(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    querySelector(selector) { return this.children.find(child => child.attributes.has(selector.slice(1, -1))); }
}
const methods = [
    'seekOutputPreview', 'ensureVisible', 'openPlaceholderPreview', 'getOrOpenPreview',
    'configurePreview', 'discardFailedPlaceholder', 'discardPreviewWidget',
    'armPlaceholderPreviewTimeout', 'removePlaceholderPreview', 'showMessageCard'
].map(method).join('\n');
const Handler = new Function('uri_1', 'webview_1', 'preview_placeholder_1', 'preview_host_constants_1',
    'window', 'CustomEvent', 'PreviewLibraryDrop', 'document', 'setTimeout', 'clearTimeout',
    `return class { ${methods} }`)(
    { default: URI }, { WebviewWidget: { FACTORY_ID: 'webview' } }, placeholder,
    { PREVIEW_OPEN_ATTEMPTS: 2 }, { dispatchEvent() {}, requestAnimationFrame(callback) { callback(); } },
    class {}, class {}, { createElement: () => new Element() },
    (callback, milliseconds) => ({ callback, milliseconds, cleared: false }),
    timer => { timer.cleared = true; }
);

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function until(predicate) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('expected event did not occur');
}
function fixture() {
    const calls = [];
    const editRead = deferred();
    const configure = deferred();
    const widgets = [];
    const handler = new Handler();
    Object.assign(handler, {
        openOutputPreviews: new Map(), openPreviews: new Map(),
        pendingOutputInitialSeek: new Map(), placeholderPreviewStates: new WeakMap(),
        placeholderPreviewWidgets: new Map(),
        hash: () => 'hash',
        widgetManager: { async getOrCreateWidget(_factory, identifier) {
            calls.push(['widget', identifier]);
            let widget = widgets.at(-1);
            if (!widget || widget.isDisposed) {
                const listeners = new Set(), disposeListeners = new Set();
                const node = new Element();
                node.appendChild = child => { child.parent = node; node.children.push(child); calls.push(['layer', child]); };
                widget = { id: identifier.id, title: {}, node, isAttached: false, isDisposed: false,
                    akariLibraryDrop: {},
                    setContentOptions() { calls.push(['content-options']); },
                    setHTML(html) { calls.push(['html', html]); },
                    sendMessage(message) { calls.push(['message', message]); },
                    onMessage(listener) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
                    emit(message) { for (const listener of [...listeners]) listener(message); },
                    disposed: { connect(listener) { disposeListeners.add(listener); } },
                    dispose() { this.isDisposed = true; for (const listener of disposeListeners) listener(); calls.push(['dispose']); } };
                widgets.push(widget);
            }
            return widget;
        } },
        shell: { addWidget(widget) { calls.push(['add']); widget.isAttached = true; },
            revealWidget() { calls.push(['reveal']); } },
        loadPlaceholderPreviewGeometry: () => editRead.promise,
        loadPlaceholderPreviewImage: async () => undefined,
        doConfigurePreview: async (widget, uri) => {
            handler.openOutputPreviews.set(uri.toString(), widget);
            calls.push(['configure']);
            await configure.promise;
            widget.akariPreviewConfigured = true;
            calls.push(['real-html']);
        },
        withOpenTimeout: operation => operation,
        disposePreviewStreams: async () => undefined,
        reportOpenFailure: (_uri, error) => calls.push(['failure', error]),
        attachTimelinePassively() {}
    });
    return { handler, calls, widgets, editRead, configure };
}

test('cold seek reveals a placeholder while edit read and configuration remain unresolved', async () => {
    const f = fixture();
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 12.5 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    assert.deepEqual(f.calls.filter(call => ['add', 'reveal', 'layer'].includes(call[0])).map(call => call[0]), ['add', 'reveal', 'layer']);
    assert.equal(f.widgets[0].node.children[0].attributes.has('data-akari-preview-placeholder'), true);
    assert.match(f.widgets[0].node.children[0].innerHTML, /読み込み中 · 0:12\.5/u);
    assert.equal(f.calls.some(call => call[0] === 'html' || call[0] === 'content-options'), false);
    assert.deepEqual(f.calls[0][1], { id: 'akari-output-preview-hash', viewId: 'edit' });
    assert.equal(f.handler.openOutputPreviews.get('edit'), f.widgets[0]);
    f.editRead.resolve({ width: 1920, height: 1080 });
    f.configure.resolve();
    assert.equal(await operation, 'seeked');
});

test('configuration metadata arriving before the widget promise does not suppress the layer', async () => {
    const f = fixture();
    const getWidget = f.handler.widgetManager.getOrCreateWidget;
    f.handler.widgetManager.getOrCreateWidget = async (...args) => {
        const widget = await getWidget(...args);
        widget.akariPreviewEditUri = new URI('edit');
        return widget;
    };
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 1 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    assert.equal(f.widgets[0].node.children[0].attributes.has('data-akari-preview-placeholder'), true);
    f.configure.resolve();
    await operation;
});

test('cached poster appears without waiting for edit geometry', async () => {
    const f = fixture();
    const poster = deferred();
    f.handler.loadPlaceholderPreviewImage = () => poster.promise;
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 7 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    assert.doesNotMatch(f.widgets[0].node.children[0].innerHTML, /<img/u);
    poster.resolve('data:image/jpeg;base64,AA==');
    await until(() => f.widgets[0].node.children[0].innerHTML.includes('<img'));
    assert.equal(f.calls.some(call => call[0] === 'real-html'), false);
    f.configure.resolve();
    assert.equal(await operation, 'seeked');
});

test('poster lookup prefers the newest cached key and skips oversized images', async () => {
    const PosterHandler = new Function(`return class { ${method('loadPlaceholderPreviewImage')} }`)();
    const poster = name => ({ path: { base: name }, toString: () => name });
    const folder = (name, mtime) => ({ isDirectory: true, mtime, path: { base: name },
        resource: { path: { base: name }, resolve: () => poster(name) } });
    const cache = { name: 'cache' };
    const handler = Object.assign(new PosterHandler(), { fileService: {
        resolve: async resource => resource === cache
            ? { children: [folder('old', 1), folder('new', 2)] }
            : { isFile: true, size: resource.path.base === 'new' ? 600 * 1024 : 2 },
        readFile: async () => ({ value: { buffer: Uint8Array.from([0xff, 0xd8]) } })
    } });
    const root = { resolve: () => cache };
    assert.equal(await handler.loadPlaceholderPreviewImage(root), 'data:image/jpeg;base64,/9g=');
});

test('last seek while opening wins after configuration', async () => {
    const f = fixture();
    const first = f.handler.seekOutputPreview({ editUri: 'edit', time: 1.5 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    const second = f.handler.seekOutputPreview({ editUri: 'edit', time: 9.25 });
    await until(() => f.handler.pendingOutputInitialSeek.get('edit') === 9.25);
    await until(() => f.widgets[0].node.children[0].innerHTML.includes('0:09.3'));
    f.configure.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(f.calls.filter(call => call[0] === 'message').map(call => call[1]), [
        { type: 'akari-preview-seek', time: 9.25 }
    ]);
});

test('failed opening closes its placeholder', async () => {
    const f = fixture();
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 3 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    f.configure.reject(new Error('load failed'));
    assert.equal(await operation, 'mismatched-asset');
    assert.ok(f.calls.some(call => call[0] === 'dispose'));
    assert.ok(f.widgets.every(widget => widget.isDisposed));
    assert.ok(f.widgets.every(widget => widget.node.children.length === 0));
    assert.ok(f.calls.some(call => call[0] === 'failure'));
});

test('configured background tab reveals before a pending refresh finishes', async () => {
    const f = fixture();
    const refresh = deferred();
    const widget = { id: 'preview', akariPreviewConfigured: true, akariPreviewSeekable: true,
        isAttached: true, isDisposed: false, akariPreviewRefresh: refresh.promise,
        sendMessage: message => f.calls.push(['message', message]) };
    f.handler.openOutputPreviews.set('edit', widget);
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 4 });
    assert.deepEqual(f.calls.map(call => call[0]), ['reveal']);
    refresh.resolve();
    assert.equal(await operation, 'seeked');
    assert.deepEqual(f.calls.at(-1), ['message', { type: 'akari-preview-seek', time: 4 }]);
});

test('ensureVisible reveals an unconfigured placeholder before configuration completes', async () => {
    const f = fixture();
    const operation = f.handler.ensureVisible('edit');
    await until(() => f.calls.some(call => call[0] === 'configure'));
    assert.deepEqual(f.calls.filter(call => ['add', 'reveal', 'layer'].includes(call[0])).map(call => call[0]), ['add', 'reveal', 'layer']);
    f.configure.resolve();
    assert.equal(await operation, 'opened');
});

test('current page first ready tick removes the layer; stale and unready ticks do not', async () => {
    const f = fixture();
    const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 2 });
    await until(() => f.calls.some(call => call[0] === 'configure'));
    const widget = f.widgets[0];
    widget.akariPreviewPlaybackPageId = 'current-page';
    f.handler.armPlaceholderPreviewTimeout(widget);
    const timer = f.handler.placeholderPreviewStates.get(widget).timeout;
    assert.equal(timer.milliseconds, 10_000);
    widget.emit({ type: 'akari-preview-playback-tick', pageId: 'old-page', positionReady: true });
    widget.emit({ type: 'akari-preview-playback-tick', pageId: 'current-page', positionReady: false });
    assert.equal(widget.node.children.length, 1);
    widget.emit({ type: 'akari-preview-playback-tick', pageId: 'current-page', positionReady: true });
    assert.equal(widget.node.children.length, 0);
    assert.equal(f.handler.placeholderPreviewStates.has(widget), false);
    assert.equal(timer.cleared, true);
    f.configure.resolve();
    assert.equal(await operation, 'seeked');
});

test('safety timer and message card each remove a placeholder layer', async () => {
    for (const mode of ['timeout', 'message-card']) {
        const f = fixture();
        const operation = f.handler.seekOutputPreview({ editUri: 'edit', time: 2 });
        await until(() => f.calls.some(call => call[0] === 'configure'));
        const widget = f.widgets[0];
        f.handler.armPlaceholderPreviewTimeout(widget);
        if (mode === 'timeout') {
            f.handler.placeholderPreviewStates.get(widget).timeout.callback();
        } else {
            f.handler.resourceSuffix = () => 'edit';
            f.handler.prepareMessageHtml = () => '<p>card</p>';
            f.handler.disposePreviewStreams = async () => undefined;
            f.handler.showMessageCard(widget, new URI('edit'), 'card', new URI('edit'), 'output');
        }
        assert.equal(widget.node.children.length, 0);
        assert.equal(f.handler.placeholderPreviewStates.has(widget), false);
        f.configure.resolve();
        await operation;
    }
});
