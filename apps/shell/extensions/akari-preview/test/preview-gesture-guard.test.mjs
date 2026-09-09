import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { reducePreviewGesture } from '../lib/common/preview-gesture-guard.js';

const compiledUrl = new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url);
const compiled = readFileSync(compiledUrl, 'utf8');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const require = createRequire(compiledUrl);
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
}

function hostFixture() {
    const body = ['queueRefresh', 'markRecentWrite', 'recentWriteAt', 'resourceSuffix'].map(name => {
        const start = compiled.search(new RegExp(`^    ${name}\\(`, 'mu'));
        assert.ok(start >= 0, name);
        return compiled.slice(start, compiled.indexOf('\n    }', start) + 6);
    }).join('\n');
    const bindings = {};
    for (const [, name, path] of compiled.matchAll(/^const (\w+) = require\("([^"]+)"\);$/gmu)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(body)) bindings[name] = require(path);
    }
    const Host = vm.runInNewContext(`(class { ${body} })`, { ...bindings, console });
    const host = new Host();
    host.previewGestureGuards = new WeakMap();
    host.reviewTransportByEdit = new Map();
    host.recentWrites = new Map();
    const calls = [];
    host.refreshPreview = async (...args) => { calls.push(args); };
    host.handleRefreshFailure = (_widget, error) => { throw error; };
    const widget = { isDisposed: false, akariPreviewLastKnownTime: 3 };
    const identity = {};
    const queue = (force = false, text) => host.queueRefresh(widget, identity, 'output', undefined, force, text);
    // Execute the actual receiver, including its end -> queueRefresh wiring.
    const receiver = section("            if (message?.type === 'akari-preview-gesture'", '            const selectionKey =');
    const receive = vm.runInNewContext(`(function (message) { ${receiver} })`, {
        reducePreviewGesture, widget, identityUri: identity, kind: 'output'
    }).bind(host);
    return { host, widget, calls, queue, receive };
}

test('gesture 中の watcher / 直接通知を end で一度だけ流し、古い本文を使わない', async () => {
    const f = hostFixture();
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    for (let i = 0; i < 20; i++) f.queue(i === 2, `old edit ${i}`);
    await settle();
    assert.equal(f.calls.length, 0);
    f.receive({ type: 'akari-preview-gesture', phase: 'saved' });
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][4], true, 'force rebuild is not lost');
    assert.equal(f.calls[0][5], undefined, 'read the saved file');
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await settle();
    assert.equal(f.calls.length, 1, 'duplicate end does not reload');
});

test('gesture 外は従来の Promise キューで即実行し、保留なしの end は何もしない', async () => {
    const f = hostFixture();
    f.queue(false, 'current edit');
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][5], 'current edit');
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await settle();
    assert.equal(f.calls.length, 1);
});

test('すでに Promise 待ちの refresh も実行直前に gesture を確認する', async () => {
    const f = hostFixture();
    let release;
    f.widget.akariPreviewRefresh = new Promise(resolve => { release = resolve; });
    f.queue(false, 'old edit');
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    release();
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls.length, 0);
    f.receive({ type: 'akari-preview-gesture', phase: 'saved' });
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][5], undefined);
});

test('純粋キューは最後の明示 seek と forceRebuild を維持する', () => {
    const original = { active: true, writeRevision: 1 };
    const first = reducePreviewGesture(original, {
        type: 'refresh', request: { forceRebuild: true, seekTimeOverride: 9, editSource: 'old' }
    });
    const next = reducePreviewGesture(first.state, { type: 'refresh', request: { forceRebuild: false } });
    assert.deepEqual(original, { active: true, writeRevision: 1 });
    assert.equal(next.refresh, undefined);
    assert.deepEqual(reducePreviewGesture(next.state, { type: 'end' }), {
        state: { active: false, writeRevision: 1 }, refresh: { forceRebuild: true, seekTimeOverride: 9 }
    });
});

test('順番待ち中に gesture が完了しても古い直接通知を適用しない', async () => {
    const f = hostFixture();
    let release;
    f.widget.akariPreviewRefresh = new Promise(resolve => { release = resolve; });
    f.queue(false, 'before gesture');
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    f.receive({ type: 'akari-preview-gesture', phase: 'saved' });
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    release();
    await f.widget.akariPreviewRefresh;
    assert.ok(f.calls.length > 0);
    assert.ok(f.calls.every(call => call[5] === undefined));
});

test('保存完了後に届いた通知本文は保留 flush でも保持する', async () => {
    const f = hostFixture();
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    f.queue(false, 'before save');
    f.receive({ type: 'akari-preview-gesture', phase: 'saved' });
    f.queue(false, 'after save');
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][5], 'after save');
});

test('保存しなかった操作では保留通知の本文を失効させない', async () => {
    const f = hostFixture();
    f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
    f.queue(false, 'external edit');
    f.receive({ type: 'akari-preview-gesture', phase: 'end' });
    await f.widget.akariPreviewRefresh;
    assert.equal(f.calls[0][5], 'external edit');
});

test('自己書き込みの成功だけでは end に refresh を新設しない', async () => {
    const f = hostFixture();
    for (let i = 0; i < 20; i++) {
        f.receive({ type: 'akari-preview-gesture', phase: 'begin' });
        f.receive({ type: 'akari-preview-gesture', phase: 'saved' });
        f.receive({ type: 'akari-preview-gesture', phase: 'end' });
        await settle();
    }
    assert.equal(f.calls.length, 0, 'self writes must not rebuild the selected cut between pointerdowns');
});

test('markRecentWrite は URI と suffix の 2 キーへ同じ時刻を記録する', () => {
    const { host } = hostFixture();
    const URI = require('@theia/core/lib/common/uri').default;
    const link = new URI('file:///linked/project/edit.json');
    const real = new URI('file:///real/location/project/edit.json');
    host.markRecentWrite(link);
    assert.equal(host.recentWrites.size, 2);
    const timestamp = host.recentWrites.get(link.toString());
    assert.ok(timestamp > 0);
    assert.equal(host.recentWrites.get('project/edit.json'), timestamp);
    assert.equal(host.recentWriteAt(real), timestamp);
    host.recentWrites.set(real.toString(), timestamp + 5);
    assert.equal(host.recentWriteAt(real), timestamp + 5);
    for (const name of ['handleLayerWrite', 'handleCutWrite']) {
        const start = compiled.indexOf(`    async ${name}(`);
        const method = compiled.slice(start, compiled.indexOf('\n    }', start));
        assert.match(method, /this\.markRecentWrite\(editUri\)/u);
        assert.doesNotMatch(method, /this\.recentWrites\.set/u);
    }
});

function dragFixture(crop = false) {
    const listeners = new Map();
    const messages = [], errors = [], writes = [];
    const pendingWrites = [];
    let transform = { x: 0, y: 0, scale: 1, rotate: 0 };
    let rect = { x: 0, y: 0, w: 1, h: 1 };
    const target = {
        kind: 'cut', entry: null,
        transformNow: () => ({ ...transform }),
        applyTransform: next => { transform = { ...next }; },
        flushTransform: () => {}, flushCrop: () => {},
        naturalSize: () => ({ width: 100, height: 100 }),
        cropNow: () => ({ ...rect }),
        cropRestorePoint: () => ({ rect: { ...rect }, transform: { ...transform } }),
        cropEntryTransform: value => value,
        applyCropAndTransform: (next, t) => { rect = { ...next }; transform = { ...t }; },
        restoreCrop: point => { rect = point.rect; transform = point.transform; },
        canWrite: () => true,
        write: patch => {
            writes.push(plain(patch));
            return new Promise((resolve, reject) => { pendingWrites.push({ resolve, reject }); });
        }
    };
    const capture = { setPointerCapture() {}, hasPointerCapture: () => false };
    const event = (x = 0, y = 0) => ({ pointerId: 1, clientX: x, clientY: y,
        currentTarget: capture, preventDefault() {}, stopPropagation() {} });
    const context = vm.createContext({
        window: {
            akari: { reportGesture: (...args) => messages.push(args), showWriteError: error => errors.push(String(error)) },
            addEventListener: (name, fn) => listeners.set(name, fn),
            removeEventListener: name => listeners.delete(name)
        },
        isPlaying: false, CLICK_THRESHOLD_PX: 3, cropModeActive: true, CROP_MIN: 0.02,
        layerVideoPointForPivot: (_t, _p, x, y) => ({ x, y }),
        cropRectAfterEdgeDragFn: (_original, _dir, point) => ({ x: point.x, y: 0, w: 1 - point.x, h: 1 }),
        cropAnchorCorrectedTransformFn: () => ({ x: 0, y: 0 })
    });
    const flags = section('            let selectionDragActive =', '            let suppressClick =');
    const drag = crop
        ? section('            const beginMediaCropDrag =', '            // ㉔ ⛶ クロップモード')
        : section('            const beginMediaTransformDrag =', '            const pointerTranslationFrom');
    const api = vm.runInContext(`${flags}\n${drag}\n({
        begin: ${crop ? 'beginMediaCropDrag' : 'beginMediaTransformDrag'},
        active: () => selectionDragActive,
        applyCut: ${section('            const applyCutVisual =', '            const layerEntries =').trim().replace(/^const applyCutVisual = /u, '').replace(/;$/u, '')},
        setTarget: beginSelectionGesture,
        protected: () => selectionGestureProtects('cut'),
        applyLayer: ${section('            const applyIncrementalLayerSpec =', '            // CF-select + transform').trim().replace(/^const applyIncrementalLayerSpec = /u, '').replace(/;$/u, '')}
    })`, context);
    const start = () => crop ? api.begin(target, 'w', event())
        : api.begin(target, event(), (e, original) => ({ ...original, x: e.clientX, y: e.clientY }));
    return { api, target, start, event, listeners, messages, errors, writes,
        resolve: (index = pendingWrites.length - 1) => pendingWrites[index].resolve(),
        reject: (index = pendingWrites.length - 1) => pendingWrites[index].reject(new Error('write rejected')) };
}

for (const crop of [false, true]) {
    test(`${crop ? 'crop' : 'transform'}: 保存応答待ちでも次の 20 回を捨てず、全保存完了まで refresh を保留する`, async () => {
        const f = dragFixture(crop);
        const host = hostFixture();
        let messageIndex = 0;
        const deliver = () => {
            for (; messageIndex < f.messages.length; messageIndex++) {
                host.receive({ type: 'akari-preview-gesture', phase: f.messages[messageIndex][0] });
            }
        };
        for (let i = 0; i < 20; i++) {
            f.start();
            assert.equal(f.api.active(), true, `gesture ${i} starts while earlier saves are pending`);
            f.listeners.get('pointermove')(f.event(i + 1, 5));
            f.listeners.get('pointerup')(f.event(i + 1, 5));
            assert.equal(f.api.active(), false);
            assert.equal(f.api.protected(), true);
            assert.equal(f.writes.length, i + 1);
            deliver();
            host.queue(false, 'external edit during pending saves');
        }
        assert.deepEqual(f.messages, [['begin']], 'one host hold spans overlapping saves');
        for (let i = 0; i < 19; i++) {
            f.resolve(i);
            await settle();
            deliver();
            assert.equal(f.api.protected(), true, 'older completion cannot release newer protection');
            assert.equal(host.calls.length, 0);
        }
        f.resolve(19);
        await settle();
        deliver();
        await host.widget.akariPreviewRefresh;
        assert.equal(f.api.protected(), false);
        assert.equal(host.calls.length, 1);
        assert.equal(host.calls[0][5], undefined, 'pending notifications predate the final save');
        if (crop) assert.equal(f.target.cropNow().x, 0.2);
        else assert.equal(f.target.transformNow().x, 20);
    });

    test(`${crop ? 'crop' : 'transform'}: 古い保存の失敗は次のドラッグ中の位置と入力を巻き戻さない`, async () => {
        const f = dragFixture(crop);
        f.start();
        f.listeners.get('pointerup')(f.event(10, 0));
        f.start();
        f.listeners.get('pointermove')(f.event(20, 0));
        f.reject(0);
        await settle();
        assert.equal(f.api.active(), true);
        assert.equal(f.api.protected(), true);
        assert.equal(f.messages.some(([phase]) => phase === 'end'), false);
        if (crop) assert.equal(f.target.cropNow().x, 0.2);
        else assert.equal(f.target.transformNow().x, 20);
        f.listeners.get('pointerup')(f.event(20, 0));
        f.resolve(1);
        await settle();
        assert.equal(f.api.active(), false);
        assert.equal(f.api.protected(), false);
        assert.equal(f.errors.length, 1);
    });

    test(`${crop ? 'crop' : 'transform'}: 前の保存応答は押下中の次のドラッグを解除しない`, async () => {
        const f = dragFixture(crop);
        f.start();
        f.listeners.get('pointerup')(f.event(10, 0));
        f.start();
        f.listeners.get('pointermove')(f.event(20, 0));
        f.resolve(0);
        await settle();
        assert.equal(f.api.active(), true);
        assert.equal(f.api.protected(), true);
        assert.equal(f.messages.some(([phase]) => phase === 'end'), false);
        f.listeners.get('pointermove')(f.event(30, 0));
        f.listeners.get('pointerup')(f.event(30, 0));
        if (crop) assert.equal(f.writes[1].crop.x, 0.3);
        else assert.equal(f.writes[1].transform.x, 30);
        f.resolve(1);
        await settle();
        assert.equal(f.api.protected(), false);
        assert.deepEqual(f.messages, [['begin'], ['saved'], ['saved'], ['end']]);
    });

    test(`${crop ? 'crop' : 'transform'}: 動かさず離した場合も解除し、書き込まない`, () => {
        const f = dragFixture(crop);
        f.start();
        f.listeners.get('pointerup')(f.event());
        assert.equal(f.api.active(), false);
        assert.equal(f.writes.length, 0);
        assert.deepEqual(f.messages, [['begin'], ['end']]);
    });

    test(`${crop ? 'crop' : 'transform'}: 20 回の操作で保存応答まで保護し、最終値を 1 回だけ書く`, async () => {
        const f = dragFixture(crop);
        for (let i = 1; i <= 20; i++) {
            f.start();
            f.listeners.get('pointermove')(f.event(i, 5));
            f.api.applyCut(null); // A refresh must not clear cutIndex / cutId or overwrite the DOM.
            const up = f.listeners.get('pointerup');
            up(f.event(i + 1, 5));
            up(f.event(i + 1, 5));
            assert.equal(f.api.active(), false, 'pointerup releases input before the save response');
            assert.equal(f.api.protected(), true, 'the pending save still protects DOM values');
            assert.equal(f.messages.at(-1)[0], 'begin');
            assert.equal(f.writes.length, i);
            if (crop) assert.equal(f.writes.at(-1).crop.x, (i + 1) / 100);
            else assert.equal(f.writes.at(-1).transform.x, i + 1);
            f.resolve();
            await settle();
            assert.equal(f.api.active(), false);
            assert.deepEqual(f.messages.at(-1), ['end']);
        }
        assert.equal(f.messages.length, 60);
        assert.equal(f.messages.filter(([phase]) => phase === 'saved').length, 20);
    });

    test(`${crop ? 'crop' : 'transform'}: pointercancel / Escape / 保存拒否でも必ず end を送る`, async () => {
        for (const cancel of ['pointercancel', 'Escape', 'rejected', 'unwritable']) {
            const f = dragFixture(crop);
            f.start();
            f.listeners.get('pointermove')(f.event(25, 0));
            if (cancel === 'pointercancel') f.listeners.get('pointercancel')(f.event());
            else if (cancel === 'Escape') f.listeners.get('keydown')({ key: 'Escape' });
            else {
                if (cancel === 'unwritable') f.target.canWrite = () => false;
                f.listeners.get('pointerup')(f.event(25, 0));
                if (cancel === 'rejected') f.reject();
            }
            await settle();
            assert.equal(f.api.active(), false);
            assert.equal(f.listeners.size, 0);
            assert.deepEqual(f.messages.at(-1), ['end']);
            assert.equal(f.target.transformNow().x, 0);
            assert.equal(f.target.cropNow().x, 0);
            assert.equal(f.errors.length, ['rejected', 'unwritable'].includes(cancel) ? 1 : 0);
        }
    });
}

test('ドラッグ中の layer は spec と DOM を更新しない', () => {
    const f = dragFixture();
    const entry = { spec: { id: 'item-a', transform: { x: 20 } } };
    f.api.setTarget({ kind: 'layer', entry });
    f.api.applyLayer(entry, { id: 'item-a', transform: { x: 0 } });
    assert.equal(entry.spec.transform.x, 20);
});

test('v1 cut 選択時は既存通知経路でクロップ不可の理由を一度表示し、v2 は編集可能', () => {
    const errors = [];
    const context = vm.createContext({
        summary: { editVersion: 1 }, cutSelected: true, outputGeometryIsSource: true,
        cutSelectionVideo: () => ({ dataset: { akariCutIndex: '0', akariCutId: 'clip-a' } }),
        window: { akari: { showWriteError: value => errors.push(value) } }
    });
    vm.runInContext(section('            let cutCropNoticeKey =', '            const applyCutCropAndTransformNow ='), context);
    assert.equal(vm.runInContext('cutCropEditable()', context), false);
    assert.equal(vm.runInContext('cutCropEditable()', context), false);
    assert.deepEqual(errors, ['この編集データ（v1）ではクロップできません。v2 へ移行してください']);
    assert.equal(vm.runInContext('summary.editVersion = 2; cutCropEditable()', context), true);
});

test('24px の選択はクロップ辺バーを保持する', () => {
    const visibility = vm.runInNewContext(section('            const CROP_EDGE_MIN_BOX_PX =', '            const clampCrop =')
        + '\napplyCropEdgeVisibility;');
    const classes = new Map();
    visibility({ classList: { toggle: (name, on) => classes.set(name, on) } }, 24, 23, true);
    assert.equal(classes.get('akari-crop-edges-off'), false);
    assert.equal(classes.get('akari-crop-edges-hide-x'), false);
    assert.equal(classes.get('akari-crop-edges-hide-y'), true);
});
