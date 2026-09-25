import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildShapeItem, insertShapeItem, nextShapeItemId, parseShapePlaceRequest, planShapeTrack,
    SHAPE_PLACE_DEFAULT_DURATION_SECONDS, shapeDefaultSize, shapePathBounds
} from '../lib/common/shape-place.js';
import { parseLibraryDragPayload } from '../lib/browser/library-drop-model.js';

// 棚の正本（presets/shapes/index.jsonl）から引く。
const rows = new Map(readFileSync(new URL('../../../../../presets/shapes/index.jsonl', import.meta.url), 'utf8')
    .trimEnd().split('\n').map(line => JSON.parse(line)).map(row => [row.id, row]));
const row = id => rows.get(id);
const output = { width: 1920, height: 1080 };
const place = (id, extra = {}) => buildShapeItem({
    preset: row(id), base: row(id).rounded_from ? row(row(id).rounded_from.base) : undefined,
    id: 'shape-1', at: 60, duration: 150, output, ...extra
});
const center = item => ({
    x: item.transform.x + item.source.params.width / 2,
    y: item.transform.y + item.source.params.height / 2
});

test('引数: preset は必須、t・center・transform は有限の数だけ受け取る', () => {
    assert.equal(parseShapePlaceRequest(undefined), undefined);
    assert.equal(parseShapePlaceRequest({ preset: ' ' }), undefined);
    assert.deepEqual(parseShapePlaceRequest({ preset: 'star-5' }), { preset: 'star-5' });
    assert.deepEqual(parseShapePlaceRequest({ preset: 'star-5', t: 2.5, center: { x: 100, y: 900 }, transform: { x: 3 } }),
        { preset: 'star-5', t: 2.5, center: { x: 100, y: 900 }, transform: { x: 3 } });
    assert.deepEqual(parseShapePlaceRequest({ preset: 'star-5', t: -1, center: { x: 'a', y: 1 }, transform: { x: NaN } }),
        { preset: 'star-5' });
    assert.deepEqual(parseShapePlaceRequest({ preset: 'star-5', canvasAware: true, outsideCanvas: true }),
        { preset: 'star-5', canvasAware: true, outsideCanvas: true });
});

test('外形は曲線の膨らみを含む実寸（棚の viewBox の余白は捨てる）', () => {
    assert.deepEqual(shapePathBounds('M3 3L97 3L97 97L3 97Z'), { x: 3, y: 3, width: 94, height: 94 });
    const circle = shapePathBounds(row('basic-circle').d);
    assert.ok(Math.abs(circle.width - 94) < 0.01 && Math.abs(circle.height - 94) < 0.01);
    // 制御点は外形の外に出るが、外形は曲線の頂点で止まる。
    const arc = shapePathBounds('M0 0C0 100 100 100 100 0Z');
    assert.equal(arc.height, 75);
    assert.equal(shapePathBounds('M0 0Q1 1 2 2'), undefined);
});

test('既定寸 = 出力の短辺の 1/3（長い辺）・縦横比は形のまま', () => {
    assert.deepEqual(shapeDefaultSize(row('basic-square'), undefined, output), { width: 360, height: 360 });
    const star = shapeDefaultSize(row('star-5'), undefined, output);
    const starBounds = shapePathBounds(row('star-5').d);
    assert.equal(star.width, 360);
    assert.equal(star.height, Math.round(360 / (starBounds.width / starBounds.height)));
    const diamond = shapeDefaultSize(row('basic-diamond'), undefined, output);
    assert.equal(diamond.height, 360);
    assert.ok(diamond.width < 360);
    // ライン・吹き出しは棚の vb の比（降下が置いた寸法の中で形を作り直す）。
    assert.deepEqual(shapeDefaultSize(row('line-dash-tri-tri'), undefined, output), { width: 360, height: 72 });
    assert.deepEqual(shapeDefaultSize(row('manga-shout'), undefined, { width: 1080, height: 1920 }),
        { width: 360, height: Math.round(360 * row('manga-shout').vb[1] / row('manga-shout').vb[0]) });
});

test('書く item（path）: 形を値で写し + params.preset・灰の塗り・出力の中央・5 秒', () => {
    const item = place('star-5');
    assert.equal(item.id, 'shape-1');
    assert.equal(item.at, 60);
    assert.equal(item.duration, 150);
    assert.equal(item.source.kind, 'shape');
    assert.equal(item.source.shape, 'path');
    assert.equal(item.source.params.preset, 'star-5');
    assert.deepEqual(item.source.params.path, { d: row('star-5').d, vb: row('star-5').vb });
    assert.equal(item.source.params.fill, '#a6a6a6');
    assert.equal(item.source.params.stroke, 'none');
    assert.equal(item.source.params.width, 360);
    const c = center(item);
    assert.ok(Math.abs(c.x - 960) <= 0.01 && Math.abs(c.y - 540) <= 0.01);
    assert.equal(SHAPE_PLACE_DEFAULT_DURATION_SECONDS, 5);
});

test('書く item（角丸）: 元の形の path + cornerRadius（角丸を形に焼き込まない）', () => {
    const item = place('basic-rounded-square');
    assert.equal(item.source.shape, 'path');
    assert.equal(item.source.params.preset, 'basic-rounded-square');
    assert.equal(item.source.params.path.d, row('basic-square').d);
    assert.equal(item.source.params.cornerRadius, 36);
    assert.deepEqual([item.source.params.width, item.source.params.height], [360, 360]);
});

test('書く item（ライン）: line の params を写す・黒・4px', () => {
    const item = place('line-dash-tri-tri');
    assert.equal(item.source.shape, 'line');
    assert.equal(item.source.params.preset, 'line-dash-tri-tri');
    assert.equal(item.source.params.dash, 'dash');
    assert.equal(item.source.params.startCap, 'triangle');
    assert.equal(item.source.params.endCap, 'triangle');
    assert.equal(item.source.params.stroke, '#000000');
    assert.equal(item.source.params.strokeWidth, 4);
    assert.equal(item.source.params.path, undefined);
});

test('書く item（吹き出し）: bubble の params を写す・白塗り + 黒枠 5px', () => {
    const item = place('manga-shout');
    assert.equal(item.source.shape, 'bubble');
    assert.equal(item.source.params.preset, 'manga-shout');
    assert.equal(item.source.params.style, row('manga-shout').defaults.style);
    assert.equal(item.source.params.fill, '#ffffff');
    assert.equal(item.source.params.stroke, '#000000');
    assert.equal(item.source.params.strokeWidth, 5);
    assert.equal(item.source.params.path, undefined);
});

test('中心の指定（プレビューへのドロップ用）と transform の直接指定', () => {
    const dropped = place('heart-heart', { center: { x: 300, y: 820 } });
    const c = center(dropped);
    assert.ok(Math.abs(c.x - 300) <= 0.01 && Math.abs(c.y - 820) <= 0.01);
    const direct = place('heart-heart', { transform: { x: 10, y: 20 } });
    assert.deepEqual(direct.transform, { x: 10, y: 20 });
    // 置いた後の値は棚と切り離す（写した値を変えても棚は変わらない）。
    dropped.source.params.path.vb[0] = 1;
    assert.equal(row('heart-heart').vb[0], 100);
});

const doc = tracks => ({ version: 2, output: { ...output, fps: 30 }, sources: [], tracks });
const main = { id: 'v1', lane: 'visual', items: [{ id: 'bg', at: 0, duration: 300, source: { kind: 'media', src: 's', in: 0, out: 10 } }] };

test('段の選び方: 映像の段が本編だけなら上に新しい段・空いた上の段は使う・重なり / ロックなら上に足す', () => {
    const range = { at: 60, duration: 150 };
    assert.deepEqual(planShapeTrack([], range), { insertIndex: 0 });
    const audio = { id: 'a1', lane: 'audio', items: [] };
    assert.deepEqual(planShapeTrack([audio, main], range), { insertIndex: 2 });
    const upper = { id: 'v2', lane: 'visual', items: [{ id: 'img', at: 300, duration: 60 }] };
    assert.deepEqual(planShapeTrack([audio, main, upper], range), { trackId: 'v2' });
    assert.deepEqual(planShapeTrack([audio, main, upper], { at: 280, duration: 150 }), { insertIndex: 3 });
    assert.deepEqual(planShapeTrack([audio, main, upper], range, new Set(['v2'])), { insertIndex: 3 });
    assert.deepEqual(planShapeTrack([audio, main, { ...upper, locked: true }], range), { insertIndex: 3 });
});

test('挿入: いちばん上に置き、id は shape-N で重複しない・元の文書は変えない', () => {
    const before = doc([main]);
    const snapshot = JSON.stringify(before);
    const first = insertShapeItem(before, { ...place('star-5'), id: nextShapeItemId(before) });
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(first.createdTrack, true);
    assert.equal(first.doc.tracks.length, 2);
    assert.equal(first.doc.tracks[1].id, first.trackId);
    assert.equal(first.doc.tracks[1].items[0].id, 'shape-1');
    const secondId = nextShapeItemId(first.doc);
    assert.equal(secondId, 'shape-2');
    // 同じ時刻にもう 1 個 → 重なるのでさらに上の段。
    const second = insertShapeItem(first.doc, { ...place('heart-heart'), id: secondId });
    assert.equal(second.doc.tracks.length, 3);
    assert.equal(second.doc.tracks[2].items[0].id, 'shape-2');
    // 時刻がずれていれば同じ段に並ぶ。
    const later = insertShapeItem(first.doc, { ...place('heart-heart'), id: secondId, at: 600 });
    assert.equal(later.createdTrack, false);
    assert.deepEqual(later.doc.tracks[1].items.map(item => item.id), ['shape-1', 'shape-2']);
});

test('ドラッグの payload: kind shape は preset だけを信じる', () => {
    assert.deepEqual(parseLibraryDragPayload(JSON.stringify({ kind: 'shape', preset: 'star-5', name: '5 点の星', vb: [100, 95] })),
        { kind: 'shape', preset: 'star-5' });
    assert.equal(parseLibraryDragPayload({ kind: 'shape', preset: '' }), undefined);
    assert.equal(parseLibraryDragPayload({ kind: 'shape' }), undefined);
});
