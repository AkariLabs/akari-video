import assert from 'node:assert/strict';
import test from 'node:test';
import { ColorPanelHost } from '../lib/browser/inspector/color-panel-host.js';
import { shapeLiveMarkup } from '../lib/browser/inspector/shape-live.js';

function panel(write) {
    const events = [];
    const host = new ColorPanelHost({
        executeCommand: async () => undefined, readProjectText: async () => undefined,
        readProjectBytes: async () => undefined, videoFrame: async () => undefined,
        notice: message => events.push(['notice', message])
    });
    const view = { update(context) { this.context = context; }, resetDraft() { events.push(['reset']); }, dispose() {} };
    const resolved = { title: '塗り', current: '#112233', preview: paint => events.push(['live', paint]),
        write: async paint => { events.push(['write', paint]); return write(paint); } };
    const session = { request: { target: { kind: 'field', field: 'shape-fill' } },
        selectionKey: 'shape', view, resolved };
    host.session = session;
    host.updateView();
    return { host, view, events };
}

test('色パネルの最終クリックは書き込みより先にライブ値を送る', async () => {
    const { view, events } = panel(async () => ({ ok: true }));
    view.context.onApply('#abcdef', { final: true });
    assert.deepEqual(events.slice(0, 2), [['live', '#abcdef'], ['write', '#abcdef']]);
});

test('色パネルの書き込み失敗と例外は元の色に戻す', async () => {
    for (const write of [async () => ({ ok: false }), async () => { throw Error('failed'); }]) {
        const { view, events } = panel(write);
        view.context.onApply('#abcdef', { final: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events.filter(event => event[0] === 'live'),
            [['live', '#abcdef'], ['live', '#112233']]);
    }
});

test('item と path の入口も図形の元パラメータからライブ HTML を作れる', () => {
    const { host } = panel(async () => ({ ok: true }));
    host.editDoc = { output: { width: 1920 }, tracks: [{ items: [
        { id: 'box-a', source: { kind: 'shape', shape: 'rounded-rect',
            params: { width: 600, height: 340, fill: '#112233' } } }
    ] }] };
    const source = host.shapeSource('box-a');
    assert.equal(source.outputWidth, 1920);
    assert.match(shapeLiveMarkup(source, 'fill', '#abcdef'), /fill="#abcdef"/u);
});

test('five rapid colors write only first and last, including after close', async () => {
    const gates = [];
    const writes = [];
    const { host, view } = panel(paint => new Promise(resolve => {
        writes.push(paint);
        gates.push(resolve);
    }));
    for (const paint of ['#111111', '#222222', '#333333', '#444444', '#555555']) {
        view.context.onApply(paint, { final: true });
    }
    host.close();
    assert.deepEqual(writes, ['#111111']);
    gates.shift()({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, ['#111111', '#555555']);
    gates.shift()({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.history[0], '#555555');
});

test('gradient stop colors and angle, then none, preview before write', async () => {
    const { view, events } = panel(async () => ({ ok: true }));
    const base = { type: 'linear', angle: 0, stops: [
        { color: '#ff0000', offset: 0 }, { color: '#0000ff', offset: 1 }
    ] };
    for (const paint of [base,
        { ...base, stops: [{ color: '#00ff00', offset: 0 }, base.stops[1]] },
        { ...base, stops: [base.stops[0], { color: '#ffff00', offset: 1 }] },
        { ...base, angle: 90 }, 'none']) {
        view.context.onApply(paint, { final: false });
        assert.deepEqual(events.at(-1), ['live', paint]);
    }
    view.context.onApply('#123456', { final: true });
    assert.deepEqual(events.slice(-2), [['live', '#123456'], ['write', '#123456']]);
});

test('failed final color restores the last committed paint', async () => {
    const gates = [];
    const { host, view, events } = panel(() => new Promise(resolve => gates.push(resolve)));
    view.context.onApply('#111111', { final: true });
    view.context.onApply('#222222', { final: true });
    gates.shift()({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    gates.shift()({ ok: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.session.committedPaint, '#111111');
    assert.deepEqual(events.filter(event => event[0] === 'live').at(-1), ['live', '#111111']);
});
