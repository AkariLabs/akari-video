import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addObject, arrowHead, boundingBox, decimatePoints, deleteObject, deriveTargets, duplicateObject, hitTest,
    inkFromStrokes, moveObject, nextId, setColor, setText, strokeWidthForPaperHeight, strokesFromInk, validateInk
} from '../lib/common/ink-model.js';

const aspect = { w: 1920, h: 1080 };
const empty = () => ({ schema: 'akari.ink.v0', space: 'canvas-rect', aspect, objects: [] });
const pen = (id = 'ink-1', points = [[0.1, 0.1], [0.2, 0.2]]) => ({ id, type: 'pen', color: '#f97316', x: points[0][0], y: points[0][1], points, strokeWidth: 0.008 });
const arrow = (id = 'ink-2') => ({ id, type: 'arrow', color: '#f97316', x: 0.3, y: 0.4, from: [0.3, 0.4], to: [0.5, 0.4], strokeWidth: 0.008 });
const text = (id = 'ink-3') => ({ id, type: 'text', color: '#f97316', x: 0.6, y: 0.5, at: [0.6, 0.5], text: '文字', textHeight: 0.05 });

test('ペンと矢印の線幅は描画時の紙で約 2.4px', () => {
    for (const height of [240, 320, 480]) assert.ok(Math.abs(strokeWidthForPaperHeight(height) * height - 2.4) < 1e-10);
    assert.equal(strokeWidthForPaperHeight(0), 2.4 / 300);
});

test('追加、移動、削除、複製は元を変えず、番号を再利用しない', () => {
    const original = empty();
    const a = addObject(original, pen());
    const b = moveObject(a, 'ink-1', -0.5, 2);
    assert.deepEqual(a.objects[0].points, [[0.1, 0.1], [0.2, 0.2]]);
    assert.deepEqual(b.objects[0].points, [[0, 0.9], [0.1, 1]]);
    const c = duplicateObject(b, 'ink-1');
    assert.equal(c.objects[1].id, 'ink-2');
    const d = deleteObject(c, 'ink-2');
    assert.equal(nextId(d), 'ink-3');
    assert.equal(nextId(deleteObject(d, 'ink-1')), 'ink-3');
    assert.equal(original.objects.length, 0);
    assert.equal(setColor(a, 'ink-1', 'blue').objects[0].color, 'blue');
    assert.equal(a.objects[0].color, '#f97316');
    const words = addObject(a, text());
    assert.equal(setText(words, 'ink-3', '更新').objects[1].text, '更新');
    assert.equal(words.objects[1].text, '文字');
});

test('間引きは既存の端点付き丸め均等サンプリングと一致', () => {
    const points = Array.from({ length: 251 }, (_, i) => [i / 250, Math.sin(i)]);
    const reference = Array.from({ length: 100 }, (_, i) => points[Math.round(i * 250 / 99)]);
    assert.deepEqual(decimatePoints(points), reference);
    assert.deepEqual(decimatePoints(points.slice(0, 50)), points.slice(0, 50));
    assert.deepEqual(decimatePoints(points, 2), [points[0], points.at(-1)]);
});

test('線分、矢じり、文字矩形、重なり最前面と許容境界で当たる', () => {
    const doc = { ...empty(), objects: [pen(), arrow(), text()] };
    assert.equal(hitTest(doc, [0.15, 0.15], 0.003), 'ink-1');
    assert.equal(hitTest(doc, [0.15, 0.25], 0.003), null);
    assert.equal(hitTest(doc, [0.5, 0.4], 0.001), 'ink-2');
    assert.equal(hitTest(doc, arrowHead(arrow(), aspect)[0], 0), 'ink-2');
    assert.equal(hitTest(doc, [0.62, 0.48], 0), 'ink-3');
    const overlapping = { ...doc, objects: [pen(), pen('ink-9')] };
    assert.equal(hitTest(overlapping, [0.15, 0.15], 0), 'ink-9');
    const horizontal = { ...empty(), objects: [pen('ink-4', [[0.1, 0.5], [0.3, 0.5]])] };
    assert.equal(hitTest(horizontal, [0.2, 0.5099], 0.006), 'ink-4');
    assert.equal(hitTest(horizontal, [0.2, 0.5101], 0.006), null);
    assert.deepEqual(boundingBox(text()), { x: 0.6, y: 0.45, w: 0.06, h: 0.05 });
});

test('派生先は重なり、矢の10%延長、文字位置と最小矩形で解決', () => {
    const doc = { ...empty(), objects: [
        pen('ink-1', [[0.1, 0.1], [0.4, 0.4]]),
        { ...arrow(), from: [0.5, 0.5], to: [0.6, 0.5], x: 0.5, y: 0.5 },
        { ...text(), at: [0.8, 0.8], x: 0.8, y: 0.8 }
    ] };
    const targets = [
        { ref: 'overlay:large', box: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { ref: 'cut:3', box: { x: 0.605, y: 0.48, w: 0.05, h: 0.05 } },
        { ref: 'overlay:small', box: { x: 0.79, y: 0.79, w: 0.05, h: 0.05 } }
    ];
    const derived = deriveTargets(doc, targets);
    assert.equal(derived.objects[0].around, 'overlay:large');
    assert.equal(derived.objects[1].pointsTo, 'cut:3');
    assert.equal(derived.objects[2].over, 'overlay:small');
    assert.deepEqual(deriveTargets(doc, []).objects.map(obj => obj.type === 'pen' ? obj.around : obj.type === 'arrow' ? obj.pointsTo : obj.over), [null, null, null]);
    assert.equal(doc.objects[0].around, undefined);
});

test('検証は範囲外と不正型を報告し例外を投げない', () => {
    const doc = { ...empty(), objects: [pen('a', [[2, 0]]), { id: 'b', type: 'future', x: 0, y: 0 }] };
    const result = validateInk(doc);
    assert.ok(result.errors.some(value => value.includes('0..1')));
    assert.ok(result.warnings.some(value => value.includes('2 points')));
    assert.ok(result.warnings.some(value => value.includes('unknown type')));
    assert.deepEqual(validateInk(null).errors, ['document must be an object']);
    assert.ok(validateInk({ ...empty(), objects: [pen('long', Array.from({ length: 101 }, () => [0, 0]))] }).warnings.some(value => value.includes('point limit')));
});

test('strokes 写しは pen のみで最大100点、読み込みで ink を生成', () => {
    const points = Array.from({ length: 150 }, (_, i) => [i / 149, 0.5]);
    const doc = { ...empty(), objects: [pen('ink-1', points), arrow(), text()] };
    const strokes = strokesFromInk(doc);
    assert.equal(strokes.length, 1);
    assert.equal(strokes[0].points.length, 100);
    const loaded = inkFromStrokes(strokes);
    assert.equal(loaded.objects.length, 1);
    assert.deepEqual(strokesFromInk(loaded), strokes);
});
