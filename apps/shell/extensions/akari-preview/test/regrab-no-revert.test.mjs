import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const browser = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../src/browser/preview-script-host-adapter.ts', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const section = (source, start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
};

function overlayHarness() {
    const state = { activeDrag: null };
    const context = vm.createContext({
        window: { akari: { state: {} } },
        activeDrag: null,
        readTransform: container => ({ x: Number(container.style.x), y: Number(container.style.y) })
    });
    const source = section(interaction, '  const pendingDragTransforms = new Map();', '  function errorText(');
    vm.runInContext(`${source}\nglobalThis.protect = protectModelSummary;
        globalThis.restore = restorePendingDragTransforms;
        globalThis.pending = pendingDragTransforms;`, context);
    const container = () => ({ dataset: {}, style: {
        x: 0, y: 0, setProperty(key, value) { this[key === '--x' ? 'x' : 'y'] = Number.parseFloat(value); }
    } });
    const put = (id, x, y, keyframes = false) => {
        const node = container();
        node.style.x = x; node.style.y = y;
        const pending = { container: node, transform: { x, y }, keyframes,
            beforeKeyframes: JSON.stringify(keyframes ? [{ t: 0, transform: { x: 0 } }] : undefined), saved: false };
        context.pending.set(id, pending);
        return pending;
    };
    const deliver = (id, x, y, keyframes) => {
        const incoming = { overlays: [{ id, transform: { x, y }, ...(keyframes ? { keyframes } : {}) }],
            tree: [{ id, kind: 'leaf', transform: { x, y } }] };
        const protectedModel = context.protect(incoming);
        const target = context.pending.get(id);
        if (target) { target.container.style.x = x; target.container.style.y = y; }
        context.restore();
        return protectedModel;
    };
    return { context, put, deliver };
}

for (const [name, order] of [
    ['(a) same item three fast grabs', ['shape', 'shape', 'shape']],
    ['(b) A then B then A', ['shape', 'html', 'shape']],
    ['(c) place shape then move existing', ['placed', 'shape']],
    ['(d) five selections then move last', ['a', 'b', 'c', 'd', 'html']]
]) {
    test(`${name}: delayed model-update preserves shape and HTML pose until saved model arrives`, () => {
        const h = overlayHarness();
        const latest = new Map();
        for (const [index, id] of order.entries()) {
            const x = 100 + index * 40;
            const item = h.put(id, x, index * 10);
            latest.set(id, item);
            const old = h.deliver(id, 0, 0);
            assert.equal(old.overlays[0].transform.x, x);
            assert.equal(old.tree[0].transform.x, x);
            assert.equal(item.container.style.x, x, 'paint must keep the live position');
        }
        for (const [id, item] of latest) {
            item.saved = true;
            const current = h.deliver(id, item.transform.x, item.transform.y);
            assert.equal(current.overlays[0].transform.x, item.transform.x);
            assert.equal(h.context.pending.has(id), false, 'fresh model acknowledges the write');
        }
    });
}

test('(a) keyframed item retains its visible pose through old model, then accepts saved keyframes', () => {
    const h = overlayHarness();
    const item = h.put('keyframed', 380, 24, true);
    const oldKeyframes = [{ t: 0, transform: { x: 0 } }];
    const stale = h.deliver('keyframed', 0, 0, oldKeyframes);
    assert.equal(stale.overlays[0].transform.x, 380);
    assert.equal(item.container.style.x, 380);
    item.saved = true;
    h.deliver('keyframed', 0, 0, [{ t: 0, transform: { x: 380 } }]);
    assert.equal(h.context.pending.has('keyframed'), false);
});

test('(a) through (d): delayed captions-update retains the last caption position', () => {
    const flags = section(browser, '            let selectionDragActive =', '            let suppressClick =');
    const context = vm.createContext({ window: { akari: { reportGesture() {} } } });
    vm.runInContext(`${flags}\nglobalThis.remember = rememberCaptionPosition;
        globalThis.protect = protectCaptionUpdate;
        globalThis.overrides = captionPositionOverrides;`, context);
    for (const order of [['A', 'A', 'A'], ['A', 'B', 'A'], ['placed', 'A'], ['A', 'B', 'C', 'D', 'E']]) {
        let last;
        for (const [index, id] of order.entries()) {
            const value = { anchor: 'bc', position: { x: (index + 1) / 10, y: 0.5 } };
            context.remember(id, value);
            last = { id, value };
            const stale = context.protect([{ id, textStyle: { position: { x: 0, y: 0.5 } } }]);
            assert.equal(stale[0].textStyle.position.x, value.position.x);
        }
        context.overrides.get(last.id).saved = true;
        const fresh = context.protect([{ id: last.id, textStyle: last.value && {
            text_anchor: last.value.anchor, position: last.value.position } }]);
        assert.equal(fresh[0].textStyle.position.x, last.value.position.x);
        assert.equal(context.overrides.has(last.id), false);
        context.overrides.clear();
    }
});

test('caption position guard accepts another row text and forgets a removed cue', () => {
    const flags = section(browser, '            let selectionDragActive =', '            let suppressClick =');
    const context = vm.createContext({ window: { akari: { reportGesture() {} } } });
    vm.runInContext(`${flags}\nglobalThis.remember = rememberCaptionPosition;
        globalThis.protect = protectCaptionUpdate;
        globalThis.overrides = captionPositionOverrides;`, context);
    context.remember('A', { anchor: 'bc', position: { x: 0.4, y: 0.5 } });
    const updated = context.protect([
        { id: 'A', text: 'A', textStyle: { position: { x: 0, y: 0.5 } } },
        { id: 'B', text: 'new text', textStyle: { position: { x: 0, y: 0.5 } } }
    ]);
    assert.equal(updated[0].textStyle.position.x, 0.4);
    assert.equal(updated[1].text, 'new text');
    context.protect([{ id: 'B', text: 'after removal' }]);
    assert.equal(context.overrides.has('A'), false);
    const later = context.protect([{ id: 'A', textStyle: { position: { x: 0.2, y: 0.5 } } }]);
    assert.equal(later[0].textStyle.position.x, 0.2);
});

test('saved position guard expires when no matching update arrives', () => {
    const flags = section(browser, '            let selectionDragActive =', '            let suppressClick =');
    const context = vm.createContext({ window: { akari: { reportGesture() {} } } });
    vm.runInContext(`${flags}\nglobalThis.remember = rememberCaptionPosition;
        globalThis.protect = protectCaptionUpdate;
        globalThis.overrides = captionPositionOverrides;`, context);
    const pending = context.remember('A', { anchor: 'bc', position: { x: 0.4, y: 0.5 } });
    pending.saved = true;
    pending.savedAt = Date.now() - 3100;
    const result = context.protect([{ id: 'A', textStyle: { position: { x: 0.2, y: 0.5 } } }]);
    assert.equal(result[0].textStyle.position.x, 0.2);
    assert.equal(context.overrides.has('A'), false);
});

test('inline text save keeps the host rederived word timings', async () => {
    const commit = section(browser, '            const commitCaptionEdit = async () => {',
        '            const placeCaptionCaretAtEnd =');
    const words = [{ text: 'new', start: 0, end: 0.4 }];
    const context = vm.createContext({
        window: { akari: { reportCaptionEditFocus() {}, syncRunSelection() {},
            engine: { captionWrite: async () => { context.setPersisted(); } } } },
        console,
        restoreCaptionEditElement() {}, rerenderCaptionAfterEdit() {},
        captionRows: new Map(), renderCaption() {},
        captionEditorValueFn: value => value,
        activeCaptionEdit: { element: { innerText: 'new', lastChild: null },
            originalText: 'old', captionId: 'A' },
        captions: [{ id: 'A', text: 'old', words: [{ text: 'old', start: 0, end: 0.4 }] }]
    });
    vm.runInContext(`${commit}\nglobalThis.commit = commitCaptionEdit;
        globalThis.current = () => captions;
        globalThis.setPersisted = () => { captions = [{ id: 'A', text: 'new', words: ${JSON.stringify(words)} }]; };`, context);
    await context.commit();
    assert.equal(context.current()[0].words[0].text, 'new');
});

test('overlapping saves keep the host gesture guard raised through the final response', () => {
    const report = section(adapter, '            let pendingGestureWrites = 0;', '            let pendingLiveValues =');
    const messages = [];
    const context = vm.createContext({ vscode: { postMessage: message => messages.push(message) } });
    vm.runInContext(`const window = { akari: {} }; ${report}
        globalThis.report = window.akari.reportGesture;`, context);
    context.report('begin'); context.report('begin'); context.report('saved'); context.report('end');
    assert.deepEqual(messages.map(message => message.phase), ['begin', 'saved']);
    context.report('saved'); context.report('end');
    assert.deepEqual(messages.map(message => message.phase), ['begin', 'saved', 'saved', 'end']);
});

test('(a) three rapid overlay writes finish in order and persist the final move', async () => {
    const enqueue = section(interaction, '  function enqueueWrite(context, overlayId, patch, kind) {',
        '  function enqueueWriteBatch(');
    const releases = [];
    const disk = { x: 0, y: 0 };
    const context = vm.createContext({
        window: { akari: { state: { editPath: 'edit.json' }, engine: {
            overlayWrite: (_path, _id, patch) => new Promise(resolve => releases.push(() => {
                Object.assign(disk, patch.transform);
                resolve();
            }))
        } } },
        console: { error() {} }
    });
    vm.runInContext(`let writeTail = Promise.resolve(); let writeGeneration = 0;
        ${section(interaction, '  function errorText(', '  function captureWriteContext()')}
        ${section(interaction, '  function captureWriteContext()', '  function enqueueWrite(')}
        ${enqueue}
        globalThis.write = patch => enqueueWrite(captureWriteContext(), 'shape', { transform: patch }, 'transform');`, context);
    const records = [context.write({ x: 160, y: 0 }), context.write({ x: 160, y: 120 }),
        context.write({ x: 0, y: 120 })];
    for (let index = 0; index < records.length; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(releases.length, index + 1, 'only one save is in flight');
        releases[index]();
    }
    await Promise.all(records.map(record => record.promise));
    assert.deepEqual(disk, { x: 0, y: 120 });
});

test('caption-only refresh uses incremental messages and preserves the iframe', () => {
    assert.match(handler, /if \(captionsChanged \|\| overlaysAppended\)/u);
    assert.match(handler, /updateKind = 'incremental'/u);
    assert.match(handler, /widget\.sendMessage\(\{ type: 'akari-preview-captions-update'/u);
    assert.match(handler, /widget\.sendMessage\(\{ type: 'akari-preview-model-update'/u);
    assert.match(browser, /if \(overlaysAppended\) \{\s*window\.akari\.interaction\?\.clearSelection\?\.\(\);\s*void window\.akari\.runtime\.mount\(summary\)/u);
});

test('script caption write inside the preview write window queues a direct update', () => {
    const listener = section(handler, '        const onEditStoreDidWrite =',
        '        const onOptimisticItemUpdate =');
    const callbacks = new Map();
    const updates = [];
    class URI {
        constructor(value) { this.value = value; }
        toString() { return this.value; }
    }
    const widget = { akariPreviewEditUri: new URI('file:///project/edit.json'),
        akariPreviewCaptionsUri: new URI('file:///project/captions.json'), isDisposed: false,
        sendMessage() {} };
    const recentWrites = new Map([['project/captions.json', Date.now()]]);
    const host = { resourceSuffix: uri => uri.toString().split('/').slice(-2).join('/'),
        markRecentWrite(uri) { recentWrites.set(this.resourceSuffix(uri), Date.now()); },
        queueCaptionsUpdate: target => updates.push(target),
        queueRefresh() {} };
    const context = vm.createContext({ widget, URI, callbacks, host,
        listen: (_window, name, callback) => { callbacks.set(name, callback); return {}; },
        window: {}, disposables: [], EDIT_STORE_DID_WRITE_EVENT: 'akari.editStore.didWrite',
        kind: 'output', identityUri: widget.akariPreviewEditUri });
    const compiled = ts.transpileModule(`(function () { ${listener} }).call(host);`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    vm.runInContext(compiled, context);
    callbacks.get('akari.editStore.didWrite')({ detail: {
        uri: 'file:///project/captions.json', content: '{"captions":[]}' } });
    assert.equal(updates.length, 1);
    assert.ok(Date.now() - recentWrites.get('project/captions.json') < 1000);
});
