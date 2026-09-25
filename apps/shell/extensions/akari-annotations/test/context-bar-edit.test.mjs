import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStyleClip, buildItemClipboard, contextBarKind, duplicateItem, findItemPlace, fitItemToScreen, hasCorners,
    isItemLocked, ITEM_CLIPBOARD_KIND, lockedItemIds, layerListAt, moveLayer, nudgeItem, parseItemClipboard, pasteItemClipboard,
    resizeShapeTo, serializeItemClipboard, setCornerRadius, setItemLocked, styleClipOf, styleWrites, swapLineEnds
} from '../lib/common/context-bar-edit.js';

const square = (fill, extra = {}) => ({ kind: 'shape', shape: 'path', params: { fill, stroke: 'none', strokeWidth: 0,
    width: 360, height: 240, path: { d: 'M3 3L97 3L97 97L3 97Z', vb: [100, 100] }, ...extra } });
const line = extra => ({ kind: 'shape', shape: 'line', params: { fill: 'none', stroke: '#000000', strokeWidth: 4, dash: 'solid',
    startCap: 'none', endCap: 'triangle', lineCap: 'butt', startCapFilled: true, endCapFilled: false, width: 500, height: 40, ...extra } });

function doc() {
    return {
        version: 2, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'photo', path: 'assets/photo.png' }, { id: 'mask-1', path: 'assets/masks/a.png' }],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [{ id: 'cut-1', at: 0, duration: 300, source: { kind: 'media', src: 'base', in: 0, out: 10 } }] },
            { id: 'v-photo', lane: 'visual', items: [{ id: 'photo-1', at: 0, duration: 300, mask: 'mask-1',
                source: { kind: 'media', src: 'photo', in: 0, out: 10 } }] },
            { id: 'v-a', lane: 'visual', items: [{ id: 'shape-a', at: 30, duration: 150, opacity: 0.5, transform: { x: 200, y: 140 },
                source: square('#3b82f6', { stroke: '#ff0000', strokeWidth: 6, cornerRadius: 20 }) }] },
            { id: 'v-b', lane: 'visual', items: [{ id: 'shape-b', at: 0, duration: 300, transform: { x: 700, y: 140 }, source: square('#a6a6a6') }] },
            { id: 'v-line', lane: 'visual', items: [{ id: 'line', at: 0, duration: 300, source: line() }] },
            { id: 'v-canvas', lane: 'visual', items: [{ id: 'canvas-1', at: 60, duration: 120, name: '表紙', source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
                items: [
                    { id: 'kid-1', at: 0, duration: 120, source: square('#111111') },
                    { id: 'kid-2', at: 30, duration: 60, source: square('#222222') }
                ] }] },
            { id: 'a1', lane: 'audio', items: [] }
        ]
    };
}

test('種類の見分け: 図形 / ライン / 写真 / キャンバス / そのほか', () => {
    const d = doc();
    assert.equal(contextBarKind(findItemPlace(d, 'shape-a').item), 'shape');
    assert.equal(contextBarKind(findItemPlace(d, 'line').item), 'line');
    assert.equal(contextBarKind(findItemPlace(d, 'photo-1').item, 'assets/photo.png'), 'photo');
    assert.equal(contextBarKind(findItemPlace(d, 'cut-1').item, 'assets/base.mp4'), 'other');
    assert.equal(contextBarKind(findItemPlace(d, 'canvas-1').item), 'canvas');
    assert.equal(contextBarKind({ id: 'c', source: { kind: 'caption', path: 'captions.json', id: 'c-1' } }), 'text');
});

test('コピー: edit.json の item と参照する sources（素材・マスク）を写す・キャンバスの子は出力の時刻へ', () => {
    const d = doc();
    const photo = buildItemClipboard(d, 'photo-1');
    assert.equal(photo.kind, ITEM_CLIPBOARD_KIND);
    assert.deepEqual(photo.sources.map(source => source.id), ['photo', 'mask-1']);
    assert.equal(photo.item.source.src, 'photo');
    const kid = buildItemClipboard(d, 'kid-2');
    assert.equal(kid.item.at, 90, '親 60 + 子 30');
    assert.deepEqual(kid.sources, []);
    assert.equal(buildItemClipboard(d, 'nope'), undefined);
    assert.equal(buildItemClipboard({ ...d, tracks: [{ id: 't', lane: 'visual', items: [{ id: 'cap', at: 0, duration: 30,
        source: { kind: 'caption', path: 'captions.json', id: 'c-1' } }] }] }, 'cap'), undefined, '字幕は edit.json だけでは写せない');
    // 文字列にして戻しても同じ
    assert.deepEqual(parseItemClipboard(serializeItemClipboard(photo)), photo);
});

test('貼り付け: 別のプロジェクトへ・素材の sources ごと・プレイヘッドの時刻・20px ずらす・いちばん上の新しいトラック', () => {
    const envelope = buildItemClipboard(doc(), 'photo-1');
    const other = { version: 2, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'photo', path: 'assets/other.png' }],
        tracks: [{ id: 'v1', lane: 'visual', items: [{ id: 'photo-1', at: 0, duration: 30, source: { kind: 'media', src: 'photo', in: 0, out: 1 } }] }] };
    const result = pasteItemClipboard(other, envelope, { atFrame: 45, offset: { x: 20, y: 20 } });
    const tracks = result.document.tracks;
    assert.equal(tracks.at(-1).id, result.trackId);
    const pasted = tracks.at(-1).items[0];
    assert.equal(pasted.id, 'photo-1-copy-1', 'id がぶつかるときは付け替える');
    assert.equal(pasted.at, 45);
    assert.deepEqual(pasted.transform, { x: 20, y: 20 });
    // 同じ id で別のパスの素材があるので、写した素材は別の id になる
    const photoSource = result.document.sources.find(source => source.path === 'assets/photo.png');
    assert.equal(photoSource.id, 'photo-2');
    assert.equal(pasted.source.src, 'photo-2');
    assert.equal(pasted.mask, 'mask-1');
    assert.ok(result.document.sources.some(source => source.id === 'mask-1' && source.path === 'assets/masks/a.png'));
    assert.equal(other.tracks.length, 1, '入力は変えない');
});

test('貼り付け: 同じパスの素材があればそれを使う・fps が違えば尺を換算する・ロックは外す', () => {
    const source = doc();
    source.tracks[1].items[0].locked = true;
    const envelope = buildItemClipboard(source, 'photo-1');
    const target = doc();
    target.output.fps = 60;
    const result = pasteItemClipboard(target, envelope, { atFrame: 0, offset: { x: 20, y: 20 } });
    const pasted = findItemPlace(result.document, result.itemId).item;
    assert.equal(pasted.source.src, 'photo');
    assert.equal(pasted.duration, 600);
    assert.equal(pasted.locked, undefined);
    assert.equal(result.document.sources.length, 3, '同じ素材を足さない');
});

test('貼り付け: 素の item も受け取る・参照先の素材が無ければ止める', () => {
    const plain = parseItemClipboard(JSON.stringify({ id: 'x', at: 0, duration: 30, source: square('#000000') }));
    assert.equal(plain.item.id, 'x');
    const pasted = pasteItemClipboard(doc(), plain, { atFrame: 10, offset: { x: 20, y: 20 } });
    assert.equal(findItemPlace(pasted.document, 'x').item.at, 10);
    const media = parseItemClipboard(JSON.stringify({ id: 'y', at: 0, duration: 30, source: { kind: 'media', src: 'ghost' } }));
    assert.throws(() => pasteItemClipboard(doc(), media, { atFrame: 0, offset: { x: 0, y: 0 } }), /ghost/);
    assert.equal(parseItemClipboard('{"kind":"akari-video/timeline-fragment"}'), undefined);
    assert.equal(parseItemClipboard('ただの文字'), undefined);
});

test('複製: 同じ時刻・20px ずらして元のすぐ上のトラックへ（キャンバスの子は親の中の次）・複製はロックしない', () => {
    const d = setItemLocked(doc(), 'shape-a', true);
    const result = duplicateItem(d, 'shape-a', { x: 20, y: 20 });
    const index = result.document.tracks.findIndex(track => track.id === result.trackId);
    assert.equal(result.document.tracks[index - 1].id, 'v-a');
    const copy = result.document.tracks[index].items[0];
    assert.equal(copy.id, 'shape-a-copy-1');
    assert.equal(copy.at, 30);
    assert.deepEqual(copy.transform, { x: 220, y: 160 });
    assert.equal(copy.locked, undefined);
    assert.equal(findItemPlace(result.document, 'shape-a').item.locked, true, '元はロックのまま');
    const kid = duplicateItem(doc(), 'kid-1', { x: 20, y: 20 });
    assert.deepEqual(findItemPlace(kid.document, 'canvas-1').item.items.map(item => item.id), ['kid-1', 'kid-1-copy-1', 'kid-2']);
});

test('スタイルをコピー: 図形 → 図形は塗り・枠・太さ・角の丸み・不透明度 / 種類が違えば不透明度だけ', () => {
    const d = doc();
    const clip = styleClipOf(findItemPlace(d, 'shape-a').item, 'shape');
    assert.deepEqual(clip.values, { 'source.params.fill': '#3b82f6', 'source.params.stroke': '#ff0000',
        'source.params.strokeWidth': 6, 'source.params.cornerRadius': 20, opacity: 0.5 });
    const painted = applyStyleClip(d, 'shape-b', clip, 'shape');
    const b = findItemPlace(painted, 'shape-b').item;
    assert.equal(b.source.params.fill, '#3b82f6');
    assert.equal(b.source.params.stroke, '#ff0000');
    assert.equal(b.source.params.strokeWidth, 6);
    assert.equal(b.source.params.cornerRadius, 20);
    assert.equal(b.opacity, 0.5);
    assert.deepEqual(b.source.params.path, square('#a6a6a6').params.path, '形は変えない');
    const lineAfter = findItemPlace(applyStyleClip(d, 'line', clip, 'line'), 'line').item;
    assert.equal(lineAfter.opacity, 0.5);
    assert.equal(lineAfter.source.params.stroke, '#000000');
    assert.deepEqual(styleWrites(clip, 'photo'), [{ path: 'opacity', value: 0.5 }]);
    // 無い値は消して写す（不透明度の無い図形から写すと、相手の不透明度も既定へ戻る）
    const back = applyStyleClip(painted, 'shape-b', styleClipOf(findItemPlace(d, 'kid-1').item, 'shape'), 'shape');
    assert.equal(findItemPlace(back, 'shape-b').item.opacity, undefined);
});

test('スタイルをコピー: ラインは色・太さ・線種・端・不透明度', () => {
    const d = doc();
    d.tracks.push({ id: 'v-line2', lane: 'visual', items: [{ id: 'line-2', at: 0, duration: 30, source: line({ stroke: '#ffffff', dash: 'dot', endCap: 'none' }) }] });
    const clip = styleClipOf(findItemPlace(d, 'line').item, 'line');
    const params = findItemPlace(applyStyleClip(d, 'line-2', clip, 'line'), 'line-2').item.source.params;
    assert.equal(params.stroke, '#000000');
    assert.equal(params.dash, 'solid');
    assert.equal(params.endCap, 'triangle');
    assert.equal(params.width, 500, '長さは変えない');
});

test('ロック・線の始点と終点の入れ替え', () => {
    const locked = setItemLocked(doc(), 'shape-a', true);
    assert.equal(isItemLocked(locked, 'shape-a'), true);
    assert.equal(isItemLocked(setItemLocked(locked, 'shape-a', false), 'shape-a'), false);
    assert.equal(isItemLocked(locked, 'kid-1'), false);
    const swapped = findItemPlace(swapLineEnds(doc(), 'line'), 'line').item.source.params;
    assert.equal(swapped.startCap, 'triangle');
    assert.equal(swapped.endCap, 'none');
    assert.equal(swapped.startCapFilled, false);
    assert.equal(swapped.endCapFilled, true);
    assert.throws(() => swapLineEnds(doc(), 'photo-1'), /ライン/);
});

test('角の丸み: 直線だけの閉じた形に出す・v0 の四角は path へ直してから付ける', () => {
    const d = doc();
    assert.equal(hasCorners(findItemPlace(d, 'shape-a').item), true);
    assert.equal(hasCorners({ source: { kind: 'shape', shape: 'path', params: { path: { d: 'M0 0C1 1 2 2 3 3Z', vb: [3, 3] } } } }), false);
    assert.equal(hasCorners(findItemPlace(d, 'line').item), false);
    assert.equal(findItemPlace(setCornerRadius(d, 'shape-a', 35.4), 'shape-a').item.source.params.cornerRadius, 35);
    assert.equal(findItemPlace(setCornerRadius(d, 'shape-a', 0), 'shape-a').item.source.params.cornerRadius, undefined);
    d.tracks.push({ id: 'v-rect', lane: 'visual', items: [{ id: 'rect', at: 0, duration: 30, source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#ffffff' } } }] });
    const rect = findItemPlace(setCornerRadius(d, 'rect', 50), 'rect').item.source;
    assert.equal(rect.shape, 'path');
    assert.deepEqual(rect.params.path, { d: 'M0 0L300 0L300 200L0 200Z', vb: [300, 200] });
    assert.equal(rect.params.cornerRadius, 50);
});

test('画面に合わせる・揃え（ずらす）・幅と高さを px で（見えている左上を動かさない）', () => {
    const fit = findItemPlace(fitItemToScreen(doc(), 'shape-a'), 'shape-a').item.transform;
    // 拡縮の中心は画面の中心（960, 540）。左上 = x + 960 × (1 − sx) = 0
    assert.equal(fit.x + 960 * (1 - fit.scaleX), 0);
    assert.equal(fit.y + 540 * (1 - fit.scaleY), 0);
    assert.equal(360 * fit.scaleX, 1920);
    assert.equal(240 * fit.scaleY, 1080);
    assert.deepEqual(findItemPlace(fitItemToScreen(doc(), 'photo-1'), 'photo-1').item.transform, { x: 0, y: 0, scale: 1 });
    assert.deepEqual(findItemPlace(nudgeItem(doc(), 'shape-a', -200, 10.5), 'shape-a').item.transform, { x: 0, y: 150.5 });
    const resized = findItemPlace(resizeShapeTo(doc(), 'shape-a', { width: 720, keepRatio: true }), 'shape-a').item.transform;
    assert.equal(resized.scale, 2);
    assert.equal(resized.x + 960 * (1 - 2), 200, '左上の x はそのまま');
    assert.equal(resized.y + 540 * (1 - 2), 140);
    const stretched = findItemPlace(resizeShapeTo(doc(), 'shape-a', { height: 120 }), 'shape-a').item.transform;
    assert.equal(stretched.scaleX, 1);
    assert.equal(stretched.scaleY, 0.5);
});

test('レイヤー一覧: 同じ親の中でプレイヘッドに出ているものを前面から・今の親と時間の範囲', () => {
    const d = doc();
    const top = layerListAt(d, 'shape-b', 0, id => d.sources.find(source => source.id === id)?.path);
    assert.equal(top.parent, null);
    assert.deepEqual(top.rows.map(row => row.id), ['line', 'shape-b', 'photo-1', 'cut-1'], 'shape-a（1 秒から）と canvas-1（2 秒から）は 0 秒には出ていない');
    assert.equal(top.rows.find(row => row.id === 'photo-1').kind, 'photo');
    assert.equal(top.rows.find(row => row.id === 'shape-b').selected, true);
    const kids = layerListAt(d, 'kid-1', 70);
    assert.deepEqual(kids.parent, { id: 'canvas-1', name: '表紙' });
    assert.deepEqual(kids.rows.map(row => row.id), ['kid-1']);
    assert.deepEqual(layerListAt(d, 'kid-1', 95).rows.map(row => [row.id, row.start, row.end]), [['kid-2', 3, 5], ['kid-1', 2, 6]]);
});

test('レイヤー一覧の並べ替え: 前面へ / 背面へ・キャンバスの中', () => {
    const order = value => layerListAt(value, 'line', 60).rows.map(row => row.id);
    const d = doc();
    assert.deepEqual(order(d), ['canvas-1', 'line', 'shape-b', 'shape-a', 'photo-1', 'cut-1']);
    // 写真を line の位置へ（前面へ）
    assert.deepEqual(order(moveLayer(d, 'photo-1', 'line')), ['canvas-1', 'photo-1', 'line', 'shape-b', 'shape-a', 'cut-1']);
    // line を shape-a の位置へ（背面へ）
    assert.deepEqual(order(moveLayer(d, 'line', 'shape-a')), ['canvas-1', 'shape-b', 'shape-a', 'line', 'photo-1', 'cut-1']);
    const kids = moveLayer(d, 'kid-1', 'kid-2');
    assert.deepEqual(findItemPlace(kids, 'canvas-1').item.items.map(item => item.id), ['kid-2', 'kid-1']);
    assert.throws(() => moveLayer(d, 'kid-1', 'line'), /同じキャンバス/);
});

test('ロック中の id の一覧: キャンバスの子も拾う（プレビューがつまみ・ドラッグを止めるのに使う）', () => {
    let value = setItemLocked(setItemLocked(doc(), 'shape-a', true), 'kid-2', true);
    assert.deepEqual(lockedItemIds(value), ['shape-a', 'kid-2']);
    value = setItemLocked(value, 'shape-a', false);
    assert.deepEqual(lockedItemIds(value), ['kid-2']);
});

test('動きを持つ item の揃え・画面に合わせる・幅と高さは再生位置に点を打つ（静的値へ書いて戻らない・KF-1）', () => {
    const animated = () => {
        const d = doc();
        const shape = findItemPlace(d, 'shape-a').item;
        // shape-a は at = 30。item の中の 0 と 120 に位置の点（まとまりが揃った点）
        shape.keyframes = [{ t: 0, transform: { x: 0, y: 0 } }, { t: 120, transform: { x: 120, y: 240 } }];
        return d;
    };
    // 出力の 90 フレーム = item の中の 60 フレーム（見えている位置 = 60, 120）
    const nudged = findItemPlace(nudgeItem(animated(), 'shape-a', 10, -20, 90), 'shape-a').item;
    assert.deepEqual(nudged.transform, { x: 200, y: 140 }, '静的値は触らない');
    assert.deepEqual(nudged.keyframes.map(p => p.t), [0, 60, 120]);
    assert.deepEqual(nudged.keyframes[1].transform, { x: 70, y: 100 });
    // 静的な item は従来どおり静的値（atFrame があっても）
    assert.deepEqual(findItemPlace(nudgeItem(doc(), 'shape-a', -200, 10.5, 90), 'shape-a').item.transform, { x: 0, y: 150.5 });
    assert.equal(findItemPlace(nudgeItem(doc(), 'shape-a', -200, 10.5, 90), 'shape-a').item.keyframes, undefined);

    const resized = findItemPlace(resizeShapeTo(animated(), 'shape-a', { width: 720, keepRatio: true }, 90), 'shape-a').item;
    const point = resized.keyframes.find(p => p.t === 60).transform;
    assert.equal(point.x + 960 * (1 - 2), 60, '見えている左上の x はそのまま');
    assert.equal(point.y + 540 * (1 - 2), 120);
    // 大きさのまとまりは動きを持たないので静的値へ
    assert.equal(resized.transform.scaleX, 2);
    assert.equal(resized.transform.scaleY, 2);
    assert.deepEqual(Object.keys(point).sort(), ['x', 'y']);

    const fit = findItemPlace(fitItemToScreen(animated(), 'shape-a', 90), 'shape-a').item;
    const fitPoint = fit.keyframes.find(p => p.t === 60).transform;
    assert.equal(fitPoint.x + 960 * (1 - fit.transform.scaleX), 0);
    assert.equal(fitPoint.y + 540 * (1 - fit.transform.scaleY), 0);
    assert.equal(fit.keyframes.length, 3);
});
