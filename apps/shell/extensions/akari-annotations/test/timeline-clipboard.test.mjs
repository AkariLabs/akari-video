import test from 'node:test';
import assert from 'node:assert/strict';
import { planPaste, parseTimelineFragment, serializeTimelineFragment } from '../lib/common/timeline-clipboard.js';
import { insertItem, splitItem, updateItem } from '../lib/common/edit-v2-mutations.js';

const track = (id, kind = 'layers', items = []) => ({ id, kind, items });
const item = (trackId = 'v1', trackIndex = 0, t = 2, duration = 3, kind = 'layers') =>
    ({ trackId, trackIndex, t, duration, kind, payload: { id: `${trackId}-clip`, source: { kind: 'media', src: 'src1', in: 0, out: duration } } });
const fragment = (...items) => ({ kind: 'akari-video/timeline-fragment', version: 1, anchor: Math.min(...items.map(i => i.t)), items });
const plan = (f, playhead, tracks, target) => {
    const result = planPaste({ fragment: f, playhead, tracks, target });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
};

test('(a) 1 個を後ろの再生ヘッドへ、総尺を越えても同じ段に貼る', () => {
    const result = plan(fragment(item()), 30, [track('v1')]);
    assert.deepEqual(result.placements.map(p => [p.trackId, p.t]), [['v1', 30]]);
    assert.deepEqual(result.newTracks, []);
});

test('(b) 3 トラックまとめて時刻と上下の相対位置を保持する', () => {
    const f = fragment(item('v3', 2, 4), item('v1', 0, 2), item('v2', 1, 8));
    const tracks = ['v1', 'v2', 'v3'].map(id => track(id));
    const before = JSON.stringify({ f, tracks });
    const result = plan(f, 12, tracks);
    assert.deepEqual(result.placements.map(p => [p.trackId, p.t]), [['v1', 12], ['v2', 18], ['v3', 14]]);
    assert.equal(JSON.stringify({ f, tracks }), before);
});

test('(c) 貼り先指定は一番下を基準にし、選択していない中間段も保つ', () => {
    const tracks = ['v1', 'v2', 'v3', 'v4', 'v5'].map(id => track(id));
    const result = plan(fragment(item('v1', 0), item('v3', 2, 4)), 10, tracks, ['v4', 'v2']);
    assert.deepEqual(result.placements.map(p => [p.trackId, p.t]), [['v2', 10], ['v4', 12]]);
    const rejected = planPaste({ fragment: fragment(item()), playhead: 10,
        tracks: [track('v1'), track('a1', 'sfx')], target: ['a1'] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.reason, /種別/);
});

test('(c) 上段不足なら新トラックを追加して相対位置を保持する', () => {
    const result = plan(fragment(item('v1', 0), item('v2', 1, 4)), 10,
        [track('v1'), track('v2')], ['v2']);
    assert.equal(result.newTracks.length, 1);
    assert.deepEqual(result.placements.map(p => p.trackId), ['v2', result.newTracks[0].id]);
});

test('(d) cuts の途中を分割して挿入、右側だけ押し出し layers は不変', () => {
    const tracks = [track('main', 'cuts', [{ id: 'original', t: 0, duration: 10 }]),
        track('v1', 'layers', [{ id: 'layer', t: 4, duration: 3 }])];
    const result = plan(fragment(item('main', 0, 0, 4, 'cuts')), 6, tracks);
    assert.deepEqual(result.cuts, [{ trackId: 'main', at: 6, duration: 4, splitIds: ['original'] }]);
    let doc = { version: 2, output: { fps: 30 }, tracks: [
        { id: 'main', lane: 'visual', items: [{ id: 'original', at: 0, duration: 300,
            source: { kind: 'media', src: 'src1', in: 20, out: 30 } }] },
        { id: 'v1', lane: 'visual', items: [{ id: 'layer', at: 120, duration: 90 }] }
    ] };
    const originalLayer = structuredClone(doc.tracks[1]);
    doc = splitItem(doc, { itemId: 'original', atFrames: 180 });
    for (const entry of doc.tracks[0].items) {
        if (entry.at >= 180) doc = updateItem(doc, { itemId: entry.id, patch: { at: entry.at + 120 } });
    }
    doc = insertItem(doc, 'main', { id: 'copy', at: result.placements[0].t * 30, duration: 120 });
    assert.deepEqual(doc.tracks[0].items.map(i => [i.at, i.duration]), [[0, 180], [300, 120], [180, 120]]);
    assert.deepEqual(doc.tracks[0].items[0].source, { kind: 'media', src: 'src1', in: 20, out: 26 });
    assert.equal(doc.tracks[0].items[1].source.in, 26);
    assert.deepEqual(doc.tracks[1], originalLayer);
});

test('(d) cuts の末尾より後ろは末尾へ、選択内の間隔も保持する', () => {
    const result = plan(fragment(item('main', 0, 0, 2, 'cuts'), item('main', 0, 5, 3, 'cuts')), 50,
        [track('main', 'cuts', [{ id: 'existing', t: 0, duration: 10 }])]);
    assert.deepEqual(result.placements.map(p => p.t), [10, 15]);
    assert.equal(result.cuts[0].duration, 8);
    assert.deepEqual(result.cuts[0].splitIds, []);
});

for (const kind of ['layers', 'overlay', 'sfx']) {
    test(`(e) ${kind} の衝突は元段の直上へ新設し、時刻・元クリップを保持する`, () => {
        const tracks = [track('t1', kind, [{ id: 'existing', t: 9, duration: 3 }]), track('t2', kind)];
        const before = structuredClone(tracks);
        const result = plan(fragment(item('t1', 0, 0, 6, kind)), 8, tracks);
        assert.equal(result.placements[0].t, 8);
        assert.equal(result.placements[0].trackId, result.newTracks[0].id);
        assert.equal(result.newTracks[0].aboveTrackId, 't1');
        assert.deepEqual(tracks, before);
    });
}

test('同じ元段の複数クリップは一方が衝突してもまとめて新段へ置く', () => {
    const result = plan(fragment(item('v1', 0, 0, 2), item('v1', 0, 5, 2)), 10,
        [track('v1', 'layers', [{ id: 'existing', t: 16, duration: 2 }])]);
    assert.equal(result.newTracks.length, 1);
    assert.deepEqual(result.placements.map(p => [p.trackId, p.t]), [[result.newTracks[0].id, 10], [result.newTracks[0].id, 15]]);
});

test('境界が接するだけなら衝突しない・字幕の重なりは自動配置へ渡す', () => {
    assert.equal(plan(fragment(item()), 5, [track('v1', 'layers', [{ id: 'existing', t: 2, duration: 3 }])]).newTracks.length, 0);
    const result = plan(fragment(item('captions', 0, 0, 3, 'captions')), 2,
        [track('captions', 'captions', [{ id: 'existing', t: 0, duration: 8 }])]);
    assert.deepEqual(result.newTracks, []);
    assert.equal(result.placements[0].t, 2);
});

test('Option ドラッグ相当の同じ場所への複製でも元を残し衝突を処理する', () => {
    const result = plan(fragment(item()), 2, [track('v1', 'layers', [{ id: 'v1-clip', t: 2, duration: 3 }])]);
    assert.equal(result.newTracks.length, 1);
});

test('JSON 断片を往復し、不正値・対象外種別・版違いを拒否する', () => {
    const f = fragment(item());
    assert.deepEqual(parseTimelineFragment(serializeTimelineFragment(f)), f);
    for (const candidate of [null, {}, { ...f, version: 2 }, { ...f, anchor: 1 },
        { ...f, items: [{ ...f.items[0], duration: 0 }] },
        { ...f, items: [{ ...f.items[0], kind: 'bgm' }] },
        { ...f, items: [{ ...f.items[0], kind: 'narration' }] }]) {
        assert.equal(parseTimelineFragment(JSON.stringify(candidate)), undefined);
    }
    assert.equal(parseTimelineFragment('{'), undefined);
});

test('ロックされた貼り先はまとめて拒否する', () => {
    assert.equal(planPaste({ fragment: fragment(item()), playhead: 2,
        tracks: [{ ...track('v1'), locked: true }] }).ok, false);
});

test('Option ドラッグで cuts を複製すると挿入リップルせず、衝突した直上へ追加する', () => {
    const result = planPaste({ fragment: fragment(item('main', 0, 0, 4, 'cuts')), playhead: 2,
        tracks: [track('main', 'cuts', [{ id: 'original', t: 0, duration: 10 }])], mode: 'duplicate' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.cuts, []);
    assert.equal(result.newTracks.length, 1);
    assert.equal(result.placements[0].t, 2);
});
