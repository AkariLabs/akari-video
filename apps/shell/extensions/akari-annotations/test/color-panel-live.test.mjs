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
    const view = { update(context) { this.context = context; }, resetDraft() { events.push(['reset']); } };
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
