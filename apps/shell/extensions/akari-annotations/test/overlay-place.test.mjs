import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildOverlayItem, insertOverlayItem, isUsableOverlayBox, nextOverlayItemId, overlayDefaultVars,
    overlayBoxOrOutput, overlayTransformForBox, parseOverlayPlaceRequest, resolveThenWriteOverlay } from '../lib/common/overlay-place.js';
import { timelineMethod } from './helpers/perspective-transition-fixture.mjs';

test('置く要求のキーと位置を検証する', () => {
    assert.deepEqual(parseOverlayPlaceRequest({ key: 'overlay/lower-third-clean', t: 3,
        center: { x: 1500, y: 200 } }), { key: 'overlay/lower-third-clean', t: 3,
        center: { x: 1500, y: 200 } });
    assert.equal(parseOverlayPlaceRequest({ key: '../bad' }), undefined);
});

test('meta の既定値と fragment の CSS 既定値をツマミに写す', () => {
    const meta = { knobs: [{ cssVar: '--accent-color', type: 'color', default: '#abcdef' },
        { cssVar: '--font-size', type: 'slider' }, { cssVar: '--unused', type: 'text' }] };
    assert.deepEqual(overlayDefaultVars(meta, 'color:var(--accent-color,#123456);font-size:var(--font-size, 38px)'),
        { '--accent-color': '#abcdef', '--font-size': '38px' });
});

test('同梱オーバーレイのツマミは実際の fragment の既定値を持つ', () => {
    const root = new URL('../../../../../assets/overlay/lower-third-clean/', import.meta.url);
    const meta = JSON.parse(readFileSync(new URL('meta.json', root), 'utf8'));
    const fragment = readFileSync(new URL('fragment.html', root), 'utf8');
    const vars = overlayDefaultVars(meta, fragment);
    assert.equal(vars['--accent-color'], '#73e0c1');
    assert.equal(vars['--font-size'], '38px');
    assert.equal(vars['--max-width'], '620px');
});

for (const output of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    for (const [name, box] of [
        ['chalkboard-jp', output.width === 1280
            ? { x: 0, y: 0, width: 1520, height: 860 }
            : { x: 200, y: 110, width: 1520, height: 860 }],
        ['lower-third-clean', { x: 0, y: 0, width: 620, height: 112 }]
    ]) test(`${name} 相当の選択枠は ${output.width}×${output.height} で落とした点が中心・幅 4/10`, () => {
        const center = { x: output.width * 0.75, y: output.height * 0.25 };
        const transform = overlayTransformForBox(output, center, box);
        const actualCenter = { x: output.width / 2 + transform.x
            + transform.scale * (box.x + box.width / 2 - output.width / 2),
        y: output.height / 2 + transform.y
            + transform.scale * (box.y + box.height / 2 - output.height / 2) };
        assert.ok(Math.abs(actualCenter.x - center.x) < 1e-9);
        assert.ok(Math.abs(actualCenter.y - center.y) < 1e-9);
        assert.ok(Math.abs(box.width * transform.scale - output.width * 0.4) < 1e-9);
    });
}

test('落とした点を中心に 5 秒の html item を最上段へ 1 個書く', () => {
    const doc = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [
        { id: 'v0', lane: 'visual', items: [{ id: 'base', at: 0, duration: 300,
            source: { kind: 'media', src: 'base', in: 0, out: 10 } }] }
    ] };
    const id = nextOverlayItemId(doc);
    const item = buildOverlayItem({ id, at: 90, duration: 150, path: 'assets/overlay/lower-third-clean/fragment.html',
        output: doc.output, center: { x: 1500, y: 200 }, box: { x: 0, y: 0, width: 1920, height: 1080 },
        vars: { '--accent-color': '#abcdef' } });
    assert.deepEqual(item.transform, { x: 540, y: -340, scale: 0.4 });
    assert.deepEqual(item.source, { kind: 'html', path: 'assets/overlay/lower-third-clean/fragment.html',
        vars: { '--accent-color': '#abcdef' } });
    const after = insertOverlayItem(doc, item);
    assert.equal(doc.tracks.length, 1);
    assert.equal(after.tracks.length, 2);
    assert.deepEqual(after.tracks[1].items, [item]);
});

test('キャンバス区間への配置は子に入り、終端で尺を切る。外へ指定すれば通常の段へ置く', () => {
    const doc = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [
        { id: 'v0', lane: 'visual', items: [{ id: 'canvas-1', at: 300, duration: 90,
            source: { kind: 'group', canvas: { durationMode: 'fixed' } }, items: [] }] }
    ] };
    const item = buildOverlayItem({ id: 'overlay-1', at: 360, duration: 150,
        path: 'assets/overlay/lower-third-clean/fragment.html', output: doc.output, vars: {} });
    const inside = insertOverlayItem(doc, item);
    assert.equal(inside.tracks[0].items[0].items.length, 1);
    assert.equal(inside.tracks[0].items[0].items[0].at, 60);
    assert.equal(inside.tracks[0].items[0].items[0].duration, 30);
    assert.deepEqual(inside.tracks[0].items[0].items[0].source, item.source);
    const outside = insertOverlayItem(doc, item, true);
    assert.equal(outside.tracks[0].items[0].items.length, 0);
    assert.equal(outside.tracks[1].items[0].at, 360);
    assert.equal(outside.tracks[1].items[0].duration, 150);
});

test('測定失敗・無効な box は出力全体へ戻す', () => {
    const output = { width: 1280, height: 720 };
    assert.deepEqual(overlayBoxOrOutput(output), { x: 0, y: 0, ...output });
    assert.deepEqual(overlayBoxOrOutput(output, { x: 0, y: 0, width: 0, height: 200 }),
        { x: 0, y: 0, ...output });
    assert.deepEqual(buildOverlayItem({ id: 'overlay-1', at: 90, duration: 150,
        path: 'assets/overlay/chalkboard-jp/fragment.html', output, center: { x: 960, y: 180 }, vars: {} }).transform,
    { x: 320, y: -180, scale: 0.4 });
});

test('取り込み失敗時は書かず、成功時は書き込みを 1 回だけ行う', async () => {
    let writes = 0;
    assert.equal(await resolveThenWriteOverlay(async () => undefined, async () => { writes++; }), false);
    assert.equal(writes, 0);
    assert.equal(await resolveThenWriteOverlay(async () => ({ path: 'fragment.html' }), async () => { writes++; }), true);
    assert.equal(writes, 1);
});

test('実コマンドは取り込み失敗で書かず、成功を undo 1 回で戻す', async () => {
    const method = timelineMethod('addOverlayAtOutputPoint', { parseOverlayPlaceRequest, resolveThenWriteOverlay,
        nextOverlayItemId, buildOverlayItem, insertOverlayItem, overlayDefaultVars, isUsableOverlayBox });
    const initial = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
        tracks: [{ id: 'v0', lane: 'visual', items: [] }] };
    let doc = initial;
    let resolved;
    let measured = { x: 0, y: 0, width: 1920, height: 1080 };
    const history = [];
    const notices = [];
    const state = {
        location: { editUri: { toString: () => 'file:///edit.json' } }, playheadT: 3,
        messages: { warn: text => notices.push(text) }, commands: { executeCommand: async id => id === 'akari.catalog.resolveOverlay'
            ? resolved : measured },
        frameAt: seconds => seconds * 30, errorMessage: error => error.message,
        async commitEditMutation(label, mutate) {
            const before = doc;
            doc = mutate(doc);
            history.push({ label, undo: () => { doc = before; } });
        },
        async focusTimelineItem() {}, footer: {}, revealOutputPreview() { assert.fail('置く操作で再表示しない'); }
    };
    assert.equal(await method.call(state, { key: 'overlay/lower-third-clean' }), undefined);
    assert.equal(doc, initial);
    assert.equal(history.length, 0);
    resolved = { relativePath: 'assets/overlay/lower-third-clean/fragment.html',
        meta: { knobs: [{ cssVar: '--accent-color', default: '#abcdef' }] }, fragment: '' };
    assert.equal(await method.call(state, { key: 'overlay/lower-third-clean' }), 'overlay-1');
    assert.equal(history.length, 1);
    assert.equal(doc.tracks[0].items[0].source.vars['--accent-color'], '#abcdef');
    history[0].undo();
    assert.equal(doc, initial);
    measured = undefined;
    const warning = console.warn;
    const warnings = [];
    console.warn = value => warnings.push(value);
    try {
        assert.equal(await method.call(state, { key: 'overlay/lower-third-clean' }), 'overlay-1');
    } finally { console.warn = warning; }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /出力全体の枠/u);
    assert.equal(doc.tracks[0].items[0].transform.scale, 0.4);
});
