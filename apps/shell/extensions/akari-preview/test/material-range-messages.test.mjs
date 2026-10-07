import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    clampPreviewMaterialRange, normalizeMaterialRange, parseMaterialRangeMessage,
    shouldApplyMaterialRangeEvent, materialPlacementArgs, materialRangeSetArgs,
    materialRangeEventUpdate, materialDragPayload, positionMaterialPlace,
    appendMaterialRangeSave, materialRangeHostTransition
} from '../lib/common/material-range-messages.js';
import { materialRangeWebviewScript } from '../lib/browser/preview-script-bootstrap.js';

test('material messages reject malformed values and retain a valid final range', () => {
    const base = { type: 'akari-material-range-change', durationSeconds: 10,
        stripWidthPx: 200, moving: 'in', final: true };
    assert.deepEqual(parseMaterialRangeMessage({ ...base, range: { in: 2, out: 8 } }),
        { ...base, range: { in: 2, out: 8 } });
    for (const range of [{ in: NaN, out: 8 }, { in: 9, out: 8 }, { in: -1, out: 8 },
        { in: 1, out: Infinity }, { in: 2 }]) {
        assert.equal(parseMaterialRangeMessage({ ...base, range }), undefined);
    }
    assert.equal(parseMaterialRangeMessage({ ...base, range: { in: 1, out: 8 }, stripWidthPx: 0 }), undefined);
    assert.equal(parseMaterialRangeMessage({ ...base, range: { in: 1, out: 8 }, final: 'yes' }), undefined);
    assert.deepEqual(normalizeMaterialRange({ in: 2, out: 80 }, 10), { in: 2, out: 10 });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-place' }), { type: 'akari-material-place' });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-drag-start' }), { type: 'akari-material-drag-start' });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-drag-end' }), { type: 'akari-material-drag-end' });
    assert.equal(parseMaterialRangeMessage({ type: 'akari-material-drag-rect', rect: null }), undefined);
    assert.equal(parseMaterialRangeMessage({ type: 'akari-material-surface-click' }), undefined);
});

test('reported duration and strip width are bounded before host range handling', () => {
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-range-ready',
        durationSeconds: 1e12, stripWidthPx: 1e9 }),
    { type: 'akari-material-range-ready', durationSeconds: 86400, stripWidthPx: 10000 });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-range-ready',
        durationSeconds: 40, stripWidthPx: 0.2 }),
    { type: 'akari-material-range-ready', durationSeconds: 40, stripWidthPx: 1 });
    assert.deepEqual(normalizeMaterialRange({ in: 86390, out: 1e12 }, 86400),
        { in: 86390, out: 86400 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 86390, out: 1e12 }, 86400, 10000, 'out'),
        { in: 86390, out: 86400 });
});

test('host duration changes only on ready and clamps later edits to that duration', () => {
    const change = parseMaterialRangeMessage({ type: 'akari-material-range-change',
        durationSeconds: 1e12, stripWidthPx: 200, range: { in: 5, out: 9e11 },
        moving: 'out', final: true });
    assert.ok(change);
    assert.equal(materialRangeHostTransition(undefined, change), undefined);
    const firstReady = parseMaterialRangeMessage({ type: 'akari-material-range-ready',
        durationSeconds: 14, stripWidthPx: 200 });
    assert.ok(firstReady);
    const first = materialRangeHostTransition(undefined, firstReady);
    assert.deepEqual(first, { type: 'ready', durationSeconds: 14 });
    assert.deepEqual(materialRangeHostTransition(first.durationSeconds, change),
        { type: 'change', durationSeconds: 14, range: { in: 5, out: 14 } });
    const hugeReady = parseMaterialRangeMessage({ type: 'akari-material-range-ready',
        durationSeconds: 1e12, stripWidthPx: 200 });
    assert.ok(hugeReady);
    assert.deepEqual(materialRangeHostTransition(14, hugeReady),
        { type: 'ready', durationSeconds: 86400 });
    const secondReady = parseMaterialRangeMessage({ type: 'akari-material-range-ready',
        durationSeconds: 20, stripWidthPx: 200 });
    assert.ok(secondReady);
    assert.deepEqual(materialRangeHostTransition(14, secondReady),
        { type: 'ready', durationSeconds: 20 });
});

test('external values keep their endpoints even when narrower than the preview minimum', () => {
    for (const [range, duration, width] of [
        [{ in: 37.6, out: 40 }, 40, 388],
        [{ in: 20, out: 22.4 }, 40, 388],
        [{ in: 166, out: 180 }, 180, 307],
        [{ in: 60, out: 71 }, 180, 307],
        [{ in: 56.4, out: 58 }, 60, 307]
    ]) {
        assert.deepEqual(normalizeMaterialRange(range, duration), range, String(width));
    }
    assert.deepEqual(normalizeMaterialRange({ in: 0, out: 10 }, 10), { in: 0, out: 10 });
    assert.equal(normalizeMaterialRange({ in: 11, out: 12 }, 10), null);
    assert.equal(normalizeMaterialRange(null, 10), null);
});

test('moving I or O stops only the moving side at the materials pane minimum', () => {
    assert.deepEqual(clampPreviewMaterialRange({ in: 9, out: 10 }, 10, 120, 'in'), { in: 8, out: 10 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 8, out: 1 }, 10, 120, 'out'), { in: 8, out: 10 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 56.4, out: 57 }, 60, 307, 'out'),
        { in: 56.4, out: 60 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 2.001, out: 2.004 }, 20, 240, 'out'),
        { in: 2, out: 4 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 0, out: 10 }, 10, 120, 'out'),
        { in: 0, out: 10 });
    assert.equal(clampPreviewMaterialRange(null, 10, 120, 'in'), null);
    for (let duration = 0.2; duration < 32; duration += 0.37) {
        for (const moving of ['in', 'out']) {
            const result = clampPreviewMaterialRange({ in: duration * 0.85, out: duration * 0.9 },
                duration, 135, moving);
            if (!result) continue;
            const minimum = Math.min(duration, Math.max(1, duration * 24 / 135));
            assert.ok(result.in >= 0 && result.out <= duration + 1e-9);
            if (moving === 'in' && result.out >= minimum || moving === 'out' && duration - result.in >= minimum) {
                assert.ok(result.out - result.in + 1e-9 >= minimum);
            }
        }
    }
});

test('I, O, and handle drags match the materials pane clamp for the five saved ranges', () => {
    const cases = [
        [{ in: 37.6, out: 40 }, 40, 388],
        [{ in: 20, out: 22.4 }, 40, 388],
        [{ in: 166, out: 180 }, 180, 307],
        [{ in: 60, out: 71 }, 180, 307],
        [{ in: 56.4, out: 58 }, 60, 307]
    ];
    const paneClamp = (range, duration, width, moving) => {
        const minimum = Math.min(duration, Math.max(1, duration * 24 / width));
        const bound = value => Math.max(0, Math.min(duration, value));
        return moving === 'in'
            ? { in: Math.min(bound(range.in), Math.max(0, bound(range.out) - minimum)), out: bound(range.out) }
            : { in: bound(range.in), out: Math.max(bound(range.out), Math.min(duration, bound(range.in) + minimum)) };
    };
    for (const [saved, duration, width] of cases) {
        for (const moving of ['in', 'out']) {
            const stationary = moving === 'in' ? 'out' : 'in';
            const candidate = moving === 'in' ? saved.out - 0.2 : saved.in + 0.2;
            const input = { ...saved, [moving]: candidate };
            const actual = clampPreviewMaterialRange(input, duration, width, moving);
            const stationaryRounded = Math.round(saved[stationary] * 100) / 100;
            const reference = paneClamp({ ...input, [stationary]: stationaryRounded }, duration, width, moving);
            const minimum = Math.min(duration, Math.max(1, duration * 24 / width));
            let moved = Math.min(duration, Math.round(reference[moving] * 100) / 100);
            if (moving === 'in' && stationaryRounded >= minimum
                && stationaryRounded - moved + 1e-9 < minimum) {
                moved = Math.max(0, Math.floor((stationaryRounded - minimum + 1e-9) * 100) / 100);
            }
            if (moving === 'out' && duration - stationaryRounded >= minimum
                && moved - stationaryRounded + 1e-9 < minimum) {
                moved = Math.min(duration, Math.ceil((stationaryRounded + minimum - 1e-9) * 100) / 100);
            }
            assert.deepEqual(actual, { ...reference, [stationary]: stationaryRounded, [moving]: moved },
                `${duration}s ${moving}`);
            assert.equal(actual[stationary], stationaryRounded);
        }
    }
});

test('each embedded function works in an isolated scope and agrees with the host', () => {
    const embeddedClamp = vm.runInNewContext(`(${clampPreviewMaterialRange.toString()})`);
    const embedded = vm.runInNewContext(`(${normalizeMaterialRange.toString()})`);
    const embeddedPlace = vm.runInNewContext(`(${positionMaterialPlace.toString()})`);
    const embeddedPayload = vm.runInNewContext(`(${materialDragPayload.toString()})`);
    for (const duration of [0.4, 10, 14, 40, 40.007]) {
        for (const width of [80, 160, 400]) {
            for (const moving of ['in', 'out']) {
                const range = { in: duration * 0.7, out: duration * 0.71 };
                assert.deepEqual({ ...embeddedClamp(range, duration, width, moving) },
                    { ...clampPreviewMaterialRange(range, duration, width, moving) });
                assert.deepEqual({ ...embedded(range, duration) }, { ...normalizeMaterialRange(range, duration) });
            }
        }
    }
    const stage = { left: -100, top: -80, right: 300, bottom: 300 };
    const viewport = { left: 0, top: 0, right: 200, bottom: 160 };
    assert.deepEqual({ ...embeddedPlace(stage, viewport, 100, 20) },
        positionMaterialPlace(stage, viewport, 100, 20));
    const identity = { relativePath: 'assets/a.mp4', kind: 'video', name: 'a.mp4' };
    assert.deepEqual({ ...embeddedPayload(identity, 10, { in: 2, out: 6 }) },
        materialDragPayload(identity, 10, { in: 2, out: 6 }));
});

test('drag payload includes points only for a selected range', () => {
    const identity = { relativePath: 'assets/a.mp4', kind: 'video', name: 'a.mp4' };
    assert.deepEqual(materialDragPayload(identity, 10, { in: 2, out: 6 }),
        { ...identity, durationSeconds: 10, in: 2, out: 6 });
    assert.deepEqual(materialDragPayload(identity, 10, null), { ...identity, durationSeconds: 10 });
});

function runMaterialWebview(mode, duration = 40, width = 388) {
    const sent = [];
    const frames = [];
    const listeners = new Map();
    const nodes = new Map();
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, {
            id, style: {}, clientWidth: width, offsetWidth: 100, offsetHeight: 20,
            duration, currentTime: 0, value: '0',
            max: id === 'material-audio-seek' ? '0' : String(duration), paused: true, loop: false,
            listeners: new Map(), classList: { contains: () => false },
            addEventListener(type, listener) { this.listeners.set(type, listener); },
            emit(type, event) { this.listeners.get(type)?.(event); },
            getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }; },
            closest() { return null; }, pause() { this.paused = true; },
            play() { this.paused = false; return Promise.resolve(); },
            setPointerCapture() {}, hasPointerCapture() { return false; }
        });
        return nodes.get(id);
    };
    const window = {
        akari: { materialPostMessage: message => sent.push(message), materialPreviewSeek() {} },
        akariAudioPostMessage: message => sent.push(message),
        addEventListener(type, listener, capture = false) {
            const entries = listeners.get(type) ?? [];
            entries.push({ listener, capture });
            listeners.set(type, entries);
        }
    };
    const document = { getElementById: get, querySelector: () => get('preview-pane') };
    vm.runInNewContext(materialRangeWebviewScript(mode,
        { relativePath: 'assets/a.' + (mode === 'video' ? 'mp4' : 'wav'), kind: mode, name: 'a' }),
    { window, document, Number, JSON, Math,
        ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
        requestAnimationFrame: callback => frames.push(callback) });
    frames.shift()();
    const update = range => {
        for (const { listener } of listeners.get('message') ?? []) listener({ data: {
            type: 'akari-material-range-update', range
        } });
    };
    const keydown = (key, options = {}) => {
        const event = { key, repeat: false, target: get('preview-stage'), ...options,
            prevented: false, stopped: false, immediate: false,
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.immediate = true; this.stopped = true; } };
        const entries = listeners.get('keydown') ?? [];
        for (const { listener } of [...entries.filter(entry => entry.capture),
            ...entries.filter(entry => !entry.capture)]) {
            if (event.immediate) break;
            listener(event);
        }
        return event;
    };
    return { get, window, sent, frames, update, keydown };
}

test('I and O keydown stays inside both webviews, including repeated keys', () => {
    for (const mode of ['video', 'audio']) {
        const view = runMaterialWebview(mode);
        const forwarded = [];
        view.window.addEventListener('keydown', event => forwarded.push(event.key));
        view.update({ in: 2, out: 8 });
        view.get('seek').value = '4';
        view.get('audio').currentTime = 4;
        for (const key of ['i', 'O']) {
            const event = view.keydown(key);
            assert.equal(event.prevented, true, mode + key);
            assert.equal(event.stopped, true, mode + key);
            assert.equal(event.immediate, true, mode + key);
        }
        const changes = view.sent.filter(message => message.type === 'akari-material-range-change');
        assert.equal(changes.length, 2);
        for (const key of ['i', 'o']) {
            const event = view.keydown(key, { repeat: true });
            assert.equal(event.prevented, true);
            assert.equal(event.immediate, true);
        }
        assert.equal(view.sent.filter(message => message.type === 'akari-material-range-change').length, 2);
        const textTarget = { closest: selector => selector === 'input' ? { type: 'text' } : null };
        for (const [key, options] of [['a', {}], ['i', { ctrlKey: true }],
            ['i', { isComposing: true }], ['o', { keyCode: 229 }],
            ['i', { target: textTarget }]]) {
            const event = view.keydown(key, options);
            assert.equal(event.prevented, false);
        }
        assert.deepEqual(forwarded, ['a', 'i', 'i', 'o', 'i']);
    }
});

test('external range update keeps exact handles and drag payload without writing back', () => {
    for (const mode of ['video', 'audio']) {
        const view = runMaterialWebview(mode);
        view.update({ in: 37.6, out: 40 });
        assert.equal(parseFloat(view.get('material-range-in').style.left), 94);
        assert.equal(parseFloat(view.get('material-range-out').style.left), 100);
        assert.equal(view.sent.filter(message => message.type === 'akari-material-range-change').length, 0);
        const surface = view.get(mode === 'video' ? 'preview-stage' : 'material-drag-surface');
        const transfer = { values: new Map(), setData(type, value) { this.values.set(type, value); } };
        surface.emit('dragstart', { target: surface, dataTransfer: transfer, preventDefault() {} });
        assert.deepEqual(JSON.parse(transfer.values.get('application/x-akari-material')),
            { relativePath: 'assets/a.' + (mode === 'video' ? 'mp4' : 'wav'),
                kind: mode, name: 'a', durationSeconds: 40, in: 37.6, out: 40 });
    }
});

test('audio starts and loops inside a selected range but full-source playback remains non-looping', () => {
    const view = runMaterialWebview('audio', 10, 200);
    const media = view.get('audio');
    assert.equal(media.loop, false);
    view.update({ in: 2, out: 6 });
    media.currentTime = 1;
    media.emit('play', {});
    assert.equal(media.currentTime, 2);
    media.currentTime = 8;
    media.emit('play', {});
    assert.equal(media.currentTime, 2);
    media.paused = false;
    media.currentTime = 6.1;
    view.frames.shift()();
    assert.equal(media.currentTime, 2);
    view.update(null);
    media.currentTime = 10;
    media.emit('ended', {});
    view.frames.shift()();
    assert.equal(media.currentTime, 10);
    assert.equal(media.loop, false);
    assert.equal(runMaterialWebview('video', 10, 200).get('preview-video').loop, false);
});

test('audio seek limit is set when metadata arrives before playback', () => {
    const view = runMaterialWebview('audio', 0, 200);
    const media = view.get('audio');
    const seek = view.get('material-audio-seek');
    assert.equal(seek.max, '0');
    assert.equal(media.paused, true);
    media.duration = 10;
    media.emit('loadedmetadata', {});
    assert.equal(seek.max, '10');
    seek.value = '3';
    seek.emit('input', {});
    assert.equal(media.currentTime, 3);
    assert.equal(media.paused, true);
});

test('place button stays inside the visible stage and viewport intersection', () => {
    const viewport = { left: 0, top: 0, right: 200, bottom: 160 };
    const embedded = vm.runInNewContext(`(${positionMaterialPlace.toString()})`);
    const cases = [
        [{ left: 20, top: 20, right: 180, bottom: 120 }, { left: 100, top: 90 }],
        [{ left: -100, top: -80, right: 300, bottom: 300 }, { left: 100, top: 130 }],
        [{ left: 300, top: 300, right: 500, bottom: 500 }, { left: 150, top: 140 }]
    ];
    for (const [stage, expected] of cases) {
        assert.deepEqual(positionMaterialPlace(stage, viewport, 100, 20), expected);
        assert.deepEqual({ ...embedded(stage, viewport, 100, 20) }, expected);
    }
});

test('a failed range save reports once and does not block the next save or placement', async () => {
    const writes = [];
    const reports = [];
    const first = appendMaterialRangeSave(Promise.resolve(), async () => {
        writes.push('first');
        throw new Error('save failed');
    }, () => reports.push('save failed'));
    await first;
    assert.deepEqual(reports, ['save failed']);
    const placed = [];
    await first.then(() => placed.push(materialPlacementArgs('assets/a.mp4', 'video', 10,
        { in: 2, out: 6 })));
    assert.deepEqual(placed, [{ relativePath: 'assets/a.mp4', kind: 'video',
        durationSeconds: 10, in: 2, out: 6 }]);
    const second = appendMaterialRangeSave(first, async () => { writes.push('second'); },
        () => reports.push('save failed again'));
    await second;
    assert.deepEqual(writes, ['first', 'second']);
    assert.deepEqual(reports, ['save failed']);
});

test('both generated webviews run without module bindings and start a native material drag', () => {
    for (const mode of ['video', 'audio']) {
        const identity = { relativePath: mode === 'video' ? 'assets/a.mp4' : 'assets/a.wav',
            kind: mode, name: '</script><img>' };
        const sent = [];
        const frames = [];
        const previewTimes = [];
        const element = id => ({ id, style: {}, clientWidth: 200, offsetHeight: 30,
            duration: 10, currentTime: 0, value: '0', max: '10', paused: true,
            listeners: new Map(), classList: { contains: () => false },
            addEventListener(type, listener) { this.listeners.set(type, listener); },
            emit(type, event) { this.listeners.get(type)?.(event); },
            getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 120, bottom: 120 }; },
            closest() { return null; }, pause() { this.paused = true; },
            setPointerCapture() {}, hasPointerCapture() { return false; }
        });
        const nodes = new Map();
        const get = id => nodes.get(id) ?? (nodes.set(id, element(id)), nodes.get(id));
        const listeners = new Map();
        const window = { akari: { materialPostMessage: message => sent.push(message),
            materialPreviewSeek: time => previewTimes.push(time) },
            akariAudioPostMessage: message => sent.push(message),
            addEventListener(type, listener) { listeners.set(type, listener); } };
        const document = { getElementById: get, querySelector: () => get('preview-pane') };
        const source = materialRangeWebviewScript(mode, identity);
        assert.doesNotMatch(source, /<\/script>/i);
        vm.runInNewContext(source, { window, document, Number, JSON, Math,
            ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
            requestAnimationFrame: callback => frames.push(callback) });
        frames.shift()();
        assert.ok(sent.some(message => message.type === 'akari-material-range-ready'));
        listeners.get('message')({ data: { type: 'akari-material-range-update', range: { in: 2, out: 6 } } });
        const surface = get(mode === 'video' ? 'preview-stage' : 'material-drag-surface');
        const transfer = { values: new Map(), setData(type, value) { this.values.set(type, value); } };
        surface.emit('pointerdown', { target: surface });
        surface.emit('dragstart', { target: surface, dataTransfer: transfer, preventDefault() {} });
        assert.equal(transfer.effectAllowed, 'copy');
        assert.deepEqual(JSON.parse(transfer.values.get('application/x-akari-material')),
            { relativePath: identity.relativePath, kind: identity.kind, name: identity.name,
                durationSeconds: 10, in: 2, out: 6 });
        assert.ok(sent.some(message => message.type === 'akari-material-drag-start'));
        surface.emit('dragend', {});
        assert.ok(sent.some(message => message.type === 'akari-material-drag-end'));
        const mark = get('material-range-in');
        mark.emit('pointerdown', { pointerId: 1, preventDefault() {}, stopPropagation() {} });
        mark.emit('pointermove', { clientX: 80 });
        mark.emit('pointerup', { pointerId: 1 });
        assert.ok(sent.some(message => message.type === 'akari-material-range-change'
            && message.range?.in === 4 && message.final === true));
        if (mode === 'video') assert.deepEqual(previewTimes, [4]);
        else { assert.equal(get('audio').currentTime, 4); assert.equal(get('audio').paused, true); }
        get('material-range-button-in').emit('click', {});
        if (mode === 'video') assert.deepEqual(previewTimes, [4]);
        else assert.equal(get('audio').currentTime, 4);
        if (mode === 'audio') {
            get('audio').paused = false;
            get('audio').currentTime = 6.1;
            frames.shift()();
            assert.equal(get('audio').currentTime, 4);
        }
    }
});

test('same-source echoes are ignored and external range changes apply', () => {
    const detail = { relativePath: 'assets/a.mp4', range: { in: 1, out: 5 } };
    assert.equal(shouldApplyMaterialRangeEvent({ ...detail, source: 'material-preview' }, detail.relativePath), false);
    assert.equal(shouldApplyMaterialRangeEvent({ ...detail, source: 'materials-pane' }, detail.relativePath), true);
    assert.equal(shouldApplyMaterialRangeEvent({ ...detail, relativePath: 'assets/b.mp4' }, detail.relativePath), false);
    assert.equal(shouldApplyMaterialRangeEvent({ ...detail, range: { in: 8, out: 5 } }, detail.relativePath), false);
});

test('webview range passes through the command and an external event returns to the webview', () => {
    const message = parseMaterialRangeMessage({ type: 'akari-material-range-change',
        range: { in: 1.237, out: 5.678 }, durationSeconds: 10, stripWidthPx: 200,
        moving: 'in', final: true });
    assert.ok(message);
    const range = clampPreviewMaterialRange(message.range, message.durationSeconds, message.stripWidthPx, message.moving);
    const command = materialRangeSetArgs('file:///project', 'assets/a.mp4', range);
    assert.deepEqual(command, { projectUri: 'file:///project', relativePath: 'assets/a.mp4',
        range: { in: 1.24, out: 5.68 }, source: 'material-preview' });
    assert.equal(materialRangeEventUpdate({ relativePath: command.relativePath, range, source: command.source },
        command.relativePath), undefined);
    assert.deepEqual(materialRangeEventUpdate({ relativePath: command.relativePath,
        range: { in: 2, out: 6 }, source: 'materials-pane' }, command.relativePath),
        { type: 'akari-material-range-update', range: { in: 2, out: 6 } });
});

test('placement carries range when set and omits both points for the full source', () => {
    assert.deepEqual(materialPlacementArgs('assets/a.mp4', 'video', 12, { in: 2, out: 6 }),
        { relativePath: 'assets/a.mp4', kind: 'video', durationSeconds: 12, in: 2, out: 6 });
    assert.deepEqual(materialPlacementArgs('assets/a.wav', 'audio', 12, null),
        { relativePath: 'assets/a.wav', kind: 'audio', durationSeconds: 12 });
});
