import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCaptionId, pasteTimelineFragment, planPaste, parseTimelineFragment, serializeTimelineFragment } from '../lib/common/timeline-clipboard.js';
import { parseCaptions } from '../lib/common/caption-store.js';
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

const captionIds = ['c-0001', 'c-0002', 'c-0003', 'c-0004', 'c-0005', 'c-0006'];
const pasteCaptions = (ids, count, mode = 'paste') => {
    const records = ids.map((id, index) => ({ id, start: index * 2, end: index * 2 + 1,
        text: `字幕 ${index + 1}`, speaker: null, sourceRef: null, edited: false, src: 'src1' }));
    const before = {
        edit: JSON.stringify({ version: 2, output: { fps: 30, width: 1920, height: 1080 },
            sources: [{ id: 'src1', path: 'clip.mp4' }], tracks: [] }),
        captions: JSON.stringify({ version: 1, captions: records })
    };
    const { captions, warnings } = parseCaptions(before.captions);
    assert.deepEqual(warnings, []);
    const options = {
        fragment: fragment(...captions.slice(0, count).map(caption => ({
            kind: 'captions', trackId: 'captions', trackIndex: 0,
            t: caption.start, duration: caption.end - caption.start, payload: caption
        }))),
        playhead: 20, target: [], mode,
        getTracks: () => [track('captions', 'captions', captions.map(caption => ({
            id: caption.id, t: caption.start, duration: caption.end - caption.start
        })))],
        frameAt: seconds => Math.round(seconds * 30), captions, audioSfx: [], displayTimelineTracks: []
    };
    const original = structuredClone({ before, fragment: options.fragment, captions });
    const after = pasteTimelineFragment(before, options);
    assert.deepEqual({ before, fragment: options.fragment, captions }, original);
    assert.deepEqual(JSON.parse(after.edit), JSON.parse(before.edit));
    const result = JSON.parse(after.captions).captions;
    assert.deepEqual(result.slice(0, records.length), records);
    assert.equal(result.length, records.length + count);
    return { captions: result, added: result.slice(records.length) };
};

test('字幕の採番は入力を変更せず、1 から最小の欠番を返す', () => {
    const ids = Object.freeze(['c-0003', 'c-0001', 'c-0003', 'c-0001-copy', 'caption-old', 'c-0000']);
    assert.equal(nextCaptionId(ids), 'c-0002');
    assert.equal(nextCaptionId(ids), 'c-0002');
    assert.equal(nextCaptionId([]), 'c-0001');
});

test('字幕の採番は 9999 を超えても重複せず桁を延ばす', () => {
    const ids = Array.from({ length: 9999 }, (_, index) => `c-${String(index + 1).padStart(4, '0')}`);
    assert.equal(nextCaptionId(ids), 'c-10000');
    assert.equal(nextCaptionId([...ids, 'c-10000']), 'c-10001');
});

for (const mode of ['paste', 'duplicate']) {
    test(`字幕を 1 件 ${mode} すると c-0007 になる`, () => {
        const { added } = pasteCaptions(captionIds, 1, mode);
        assert.deepEqual(added.map(caption => caption.id), ['c-0007']);
        assert.deepEqual(added.map(caption => [caption.start, caption.end]), [[20, 21]]);
    });

    test(`字幕を 3 件 ${mode} すると c-0007..c-0009 になる`, () => {
        const { added } = pasteCaptions(captionIds, 3, mode);
        assert.deepEqual(added.map(caption => caption.id), ['c-0007', 'c-0008', 'c-0009']);
        assert.deepEqual(added.map(caption => [caption.start, caption.end]), [[20, 21], [22, 23], [24, 25]]);
    });
}

test('字幕を複数貼ると最小の欠番から順に埋める', () => {
    const { added } = pasteCaptions(['c-0001', 'c-0003', 'c-0005', 'c-0006'], 3);
    assert.deepEqual(added.map(caption => caption.id), ['c-0002', 'c-0004', 'c-0007']);
});

test('貼り付け結果の字幕 ID は captions 検査相当で指摘がない', () => {
    const { captions } = pasteCaptions(captionIds, 3);
    // edit-lint/src/edit-lint.mjs の validateCaptions は非公開のため、同じ ID 正規表現で代替する。
    const findings = captions.filter(caption => !/^c-\d{4}$/.test(caption.id));
    assert.deepEqual(findings, []);
    assert.equal(new Set(captions.map(caption => caption.id)).size, captions.length);
});

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
