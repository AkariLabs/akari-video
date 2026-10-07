import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    clampPreviewMaterialRange, normalizeMaterialRange, parseMaterialRangeMessage,
    parseMaterialRangeUpdate, shouldApplyMaterialRangeEvent, materialPlacementArgs,
    materialRangeSetArgs, materialRangeEventUpdate, materialDragPayload
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
    assert.deepEqual(normalizeMaterialRange({ in: 2, out: 80 }, 10, 200, 'out'), { in: 2, out: 10 });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-place' }), { type: 'akari-material-place' });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-drag-start' }), { type: 'akari-material-drag-start' });
    assert.deepEqual(parseMaterialRangeMessage({ type: 'akari-material-drag-end' }), { type: 'akari-material-drag-end' });
    assert.equal(parseMaterialRangeMessage({ type: 'akari-material-drag-rect', rect: null }), undefined);
    assert.equal(parseMaterialRangeMessage({ type: 'akari-material-surface-click' }), undefined);
    assert.equal(parseMaterialRangeUpdate({ type: 'akari-material-range-update', range: { in: 5, out: 4 } }), undefined);
});

test('moving I or O stops at the minimum and rounding never shrinks the range', () => {
    assert.deepEqual(clampPreviewMaterialRange({ in: 9, out: 10 }, 10, 120, 'in'), { in: 8, out: 10 });
    assert.deepEqual(clampPreviewMaterialRange({ in: 8, out: 1 }, 10, 120, 'out'), { in: 8, out: 10 });
    assert.deepEqual(normalizeMaterialRange({ in: 9, out: 10 }, 10, 120, 'in'), { in: 8, out: 10 });
    assert.deepEqual(normalizeMaterialRange({ in: 2.001, out: 2.004 }, 20, 240, 'out'),
        { in: 2, out: 4 });
    assert.equal(normalizeMaterialRange({ in: 0, out: 10 }, 10, 120, 'out'), null);
    assert.equal(normalizeMaterialRange(null, 10, 120, 'in'), null);
    for (let duration = 0.2; duration < 32; duration += 0.37) {
        for (const moving of ['in', 'out']) {
            const result = normalizeMaterialRange({ in: duration * 0.85, out: duration * 0.9 },
                duration, 135, moving);
            if (!result) continue;
            const minimum = Math.min(duration, Math.max(1, duration * 24 / 135));
            assert.ok(result.in >= 0 && result.out <= duration + 1e-9);
            assert.ok(result.out - result.in + 1e-9 >= minimum);
        }
    }
});

test('each embedded function works in an isolated scope and agrees with the host', () => {
    const embeddedClamp = vm.runInNewContext(`(${clampPreviewMaterialRange.toString()})`);
    const embedded = vm.runInNewContext(`(${normalizeMaterialRange.toString()})`);
    const embeddedPayload = vm.runInNewContext(`(${materialDragPayload.toString()})`);
    for (const duration of [0.4, 10, 14, 40, 40.007]) {
        for (const width of [80, 160, 400]) {
            for (const moving of ['in', 'out']) {
                const range = { in: duration * 0.7, out: duration * 0.71 };
                assert.deepEqual({ ...embeddedClamp(range, duration, width, moving) },
                    { ...clampPreviewMaterialRange(range, duration, width, moving) });
                assert.deepEqual({ ...embedded(range, duration, width, moving) },
                    { ...normalizeMaterialRange(range, duration, width, moving) });
            }
        }
    }
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
    const range = normalizeMaterialRange(message.range, message.durationSeconds, message.stripWidthPx, message.moving);
    const command = materialRangeSetArgs('file:///project', 'assets/a.mp4', range);
    assert.deepEqual(command, { projectUri: 'file:///project', relativePath: 'assets/a.mp4',
        range: { in: 1.24, out: 5.68 }, source: 'material-preview' });
    assert.equal(materialRangeEventUpdate({ relativePath: command.relativePath, range, source: command.source },
        command.relativePath), undefined);
    assert.deepEqual(parseMaterialRangeUpdate(materialRangeEventUpdate({ relativePath: command.relativePath,
        range: { in: 2, out: 6 }, source: 'materials-pane' }, command.relativePath)),
        { type: 'akari-material-range-update', range: { in: 2, out: 6 } });
});

test('placement carries range when set and omits both points for the full source', () => {
    assert.deepEqual(materialPlacementArgs('assets/a.mp4', 'video', 12, { in: 2, out: 6 }),
        { relativePath: 'assets/a.mp4', kind: 'video', durationSeconds: 12, in: 2, out: 6 });
    assert.deepEqual(materialPlacementArgs('assets/a.wav', 'audio', 12, null),
        { relativePath: 'assets/a.wav', kind: 'audio', durationSeconds: 12 });
});
