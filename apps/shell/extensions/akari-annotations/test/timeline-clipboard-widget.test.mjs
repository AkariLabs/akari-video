import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fragmentForSelection, cutTimelineFragment, pasteTimelineFragment, nextCopyId
} from '../lib/common/timeline-clipboard.js';
import { indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { parseCaptions } from '../lib/common/caption-store.js';

const visual = (id, at, duration) => ({ id, at, duration, source: { kind: 'media', src: 'src', in: 0, out: duration / 30 } });
const selections = [
    { kind: 'cut', index: 0 }, { kind: 'layer', id: 'layer' },
    { kind: 'caption', id: 'caption' }, { kind: 'audio', id: 'sfx' }
];
function fixture(editOverride) {
    const edit = editOverride ?? { version: 2, output: { fps: 30 }, sources: [{ id: 'src', path: 'clip.mp4' }], tracks: [
        { id: 'a1', lane: 'audio', items: [{ ...visual('sfx', 30, 60), role: 'sfx', link: 'cut' }] },
        { id: 'main', lane: 'visual', items: [visual('cut', 0, 300)] },
        { id: 'v2', lane: 'visual', items: [visual('layer', 30, 60)] },
        { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
    ] };
    const before = Object.freeze({ edit: JSON.stringify(edit), captions: JSON.stringify([
        { id: 'caption', start: 10, end: 14, text: '字幕', speaker: null,
            sourceRef: { segment: 0 }, edited: false, time_domain: 'source',
            words: [{ text: '字幕', start: 11, end: 13 }], unrecognized: [{ start: 10, end: 11 }] }
    ]) });
    const captions = parseCaptions(before.captions).captions.map(caption => ({
        ...caption, words: JSON.parse(before.captions).find(raw => raw.id === caption.id).words
    }));
    const itemLocations = indexEditV2Items(edit);
    const displayTimelineTracks = [
        { id: 'a1', kind: 'sfx', ref: 0 }, { id: 'main', kind: 'cuts', ref: 0 },
        { id: 'v2', kind: 'layers', ref: 0 }, { id: 'captions', kind: 'captions', ref: 0 }
    ];
    const tracks = displayTimelineTracks.map(track => ({ ...track,
        items: (edit.tracks.find(raw => raw.id === track.id)?.items ?? []).map(item => ({
            id: item.id, t: item.at / 30, duration: item.duration / 30
        }))
    }));
    const audioSfx = tracks[0].items.filter(item => item.id === 'sfx');
    const selectionId = selection => selection.kind === 'cut' ? 'cut' : selection.id;
    const fragmentOptions = {
        selections, getTracks: () => tracks, selectionId,
        trackIdOfSelection: selection => selection.kind === 'caption' ? 'captions'
            : itemLocations.get(selectionId(selection))?.trackId,
        captionIdForSelection: (selection, id) => selection.kind === 'caption' ? id : undefined,
        itemLocations, editDocument: edit, captions,
        captionRangeToOutputRanges: () => [[1, 3]], rows: [], fps: 30, audioSfx,
        sfxIntervalEnd: item => item.t + item.duration
    };
    const fragment = fragmentForSelection(fragmentOptions);
    return { before, edit, tracks, fragment, fragmentOptions,
        cutOptions: { fragment, itemLocations, isTrackLocked: () => false },
        pasteOptions: { fragment, playhead: 6, target: [], getTracks: () => tracks,
            frameAt: seconds => Math.max(0, Math.round(seconds * 30)), captions, audioSfx, displayTimelineTracks } };
}
const read = snapshot => ({ edit: JSON.parse(snapshot.edit), captions: parseCaptions(snapshot.captions).captions });
const items = (edit, id) => edit.tracks.find(track => track.id === id).items;
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

test('複数種別の貼り付けは 1 つの全文対を返し、cuts 分割挿入・相対位置・字幕の出力秒を保つ', () => {
    const f = fixture();
    assert.deepEqual(f.fragment.items.map(item => item.kind), ['cuts', 'layers', 'captions', 'sfx']);
    const after = pasteTimelineFragment(f.before, f.pasteOptions);
    assert.deepEqual(Object.keys(after).sort(), ['captions', 'edit']);
    assert.equal(typeof after.edit, 'string');
    assert.equal(typeof after.captions, 'string');
    const result = read(after);
    assert.deepEqual(items(result.edit, 'main').map(item => [item.at, item.duration]), [[0, 180], [180, 300], [480, 120]]);
    assert.deepEqual(items(result.edit, 'v2').map(item => item.at), [30, 210]);
    assert.deepEqual(items(result.edit, 'a1').map(item => item.at), [30, 210]);
    assert.equal(items(result.edit, 'a1')[1].link, 'cut-copy');
    const caption = result.captions.find(item => item.id === 'caption-copy');
    assert.equal(result.captions.length, 2);
    assert.deepEqual([caption.start, caption.end], [7, 9]);
    assert.equal(caption.timeDomain, 'output');
    assert.equal(caption.sourceRef, null);
    assert.equal(caption.edited, true);
    const rawCaption = JSON.parse(after.captions).find(item => item.id === 'caption-copy');
    assert.deepEqual(rawCaption.words.map(word => [word.start, word.end]), [[7.5, 8.5]]);
    assert.deepEqual(caption.unrecognized, [{ start: 7, end: 7.5 }]);
});

test('断片作成・貼り付け・切り取りは入力を変更せず、before / after の 2 全文を保存できる', () => {
    const f = fixture();
    const original = structuredClone(f.before);
    const originalEdit = structuredClone(f.edit);
    freeze(f.edit);
    freeze(f.fragmentOptions.captions);
    freeze(f.tracks);
    const fragment = fragmentForSelection(f.fragmentOptions);
    freeze(fragment);
    const originalFragment = structuredClone(fragment);
    const after = pasteTimelineFragment(f.before, { ...f.pasteOptions, fragment });
    const cut = cutTimelineFragment(f.before, { ...f.cutOptions, fragment });
    assert.notEqual(after.edit, f.before.edit);
    assert.notEqual(after.captions, f.before.captions);
    assert.notEqual(cut.edit, f.before.edit);
    assert.notEqual(cut.captions, f.before.captions);
    assert.deepEqual(f.before, original);
    assert.deepEqual(f.edit, originalEdit);
    assert.deepEqual(fragment, originalFragment);
    assert.notStrictEqual(fragment.items[0].payload, f.edit.tracks[1].items[0]);
    assert.deepEqual(pasteTimelineFragment(f.before, { ...f.pasteOptions, fragment }), after);
});

test('切り取りは断片の全実体と字幕をまとめて削除する', () => {
    const f = fixture();
    const after = read(cutTimelineFragment(f.before, f.cutOptions));
    assert.deepEqual(after.captions, []);
    assert.deepEqual(after.edit.tracks.flatMap(track => track.items ?? []), []);
});

test('選択外の分離音声は残し、切り取った映像への link だけを解除する', () => {
    const f = fixture();
    const fragment = fragmentForSelection({ ...f.fragmentOptions, selections: selections.slice(0, 3) });
    const after = read(cutTimelineFragment(f.before, { ...f.cutOptions, fragment }));
    const { link, ...unlinked } = items(f.edit, 'a1')[0];
    assert.equal(link, 'cut');
    assert.deepEqual(after.edit.tracks.flatMap(track => track.items ?? []), [unlinked]);
    assert.deepEqual(after.captions, []);
    assert.equal(items(JSON.parse(f.before.edit), 'a1')[0].link, 'cut');
});

test('リンク解除先のロックは従来の理由を投げ、入力全文を保つ', () => {
    const f = fixture();
    const before = structuredClone(f.before);
    const fragment = fragmentForSelection({ ...f.fragmentOptions, selections: [selections[0]] });
    assert.throws(() => cutTimelineFragment(f.before, {
        ...f.cutOptions, fragment, isTrackLocked: id => id === 'a1'
    }), { message: 'リンク先の音声トラックはロック中です。' });
    assert.deepEqual(f.before, before);
});

test('BGM とナレーションは複数選択に含まれても断片へ入れない', () => {
    const edit = fixture().edit;
    edit.tracks[0].items.push({ ...visual('bgm', 0, 300), role: 'bgm' }, { ...visual('narration', 0, 90), role: 'narration' });
    const f = fixture(edit);
    const excluded = [{ kind: 'audio', id: 'bgm' }, { kind: 'audio', id: 'narration' }];
    assert.equal(fragmentForSelection({ ...f.fragmentOptions, selections: excluded }), undefined);
    const fragment = fragmentForSelection({ ...f.fragmentOptions, selections: [...excluded, selections[3]] });
    assert.deepEqual(fragment.items.map(item => item.payload.id), ['sfx']);
});

for (const [name, target, locked, reason] of [
    ['種別違い', ['a1'], false, '種別が違うトラックには貼り付けできません。'],
    ['ロック段', ['v2'], true, '貼り先のトラックはロック中です。']
]) {
    test(`${name}への貼り付けは理由付きで拒否し、全文対を返さない`, () => {
        const f = fixture();
        const before = structuredClone(f.before);
        const fragment = fragmentForSelection({ ...f.fragmentOptions, selections: [selections[1]] });
        let after;
        assert.throws(() => {
            after = pasteTimelineFragment(f.before, { ...f.pasteOptions, fragment, target,
                getTracks: () => f.tracks.map(track => ({ ...track, locked: track.id === 'v2' && locked })) });
        }, { message: reason });
        assert.equal(after, undefined);
        assert.deepEqual(f.before, before);
    });
}

test('衝突時は上の新段へ同じ相対位置で貼り、元段は保持する', () => {
    const f = fixture();
    const fragment = fragmentForSelection({ ...f.fragmentOptions, selections: [selections[1]] });
    const after = read(pasteTimelineFragment(f.before, { ...f.pasteOptions, fragment, playhead: 1 }));
    const index = after.edit.tracks.findIndex(track => track.id === 'v2');
    assert.deepEqual(items(after.edit, 'v2'), items(f.edit, 'v2'));
    assert.equal(after.edit.tracks[index + 1].items[0].id, 'layer-copy');
    assert.equal(after.edit.tracks[index + 1].items[0].at, 30);
});

test('legacy sfx を実段へ貼ると source・フレーム時刻へ変換する', () => {
    const f = fixture();
    const legacy = { id: 'legacy', path: 'hit.wav', t: 1, in: 0.5, out: 2.5,
        gain_db: -3, keyframes: [{ t: 0.5, gain_db: -6 }] };
    f.edit.audio = { sfx: [legacy] };
    const fragment = fragmentForSelection({ ...f.fragmentOptions,
        selections: [{ kind: 'audio', id: 'legacy' }], trackIdOfSelection: () => 'a1',
        audioSfx: [{ id: 'legacy', t: 1, duration: 2 }]
    });
    const before = { ...f.before, edit: JSON.stringify(f.edit) };
    const after = read(pasteTimelineFragment(before, { ...f.pasteOptions, fragment }));
    const item = items(after.edit, 'a1').find(entry => entry.id === 'legacy-copy');
    assert.equal(item.at, 180);
    assert.equal(item.duration, 60);
    assert.deepEqual(item.source, { kind: 'media', src: 'audio-copy-source', in: 0.5, out: 2.5 });
    assert.equal(after.edit.sources.find(source => source.id === item.source.src).path, 'hit.wav');
    assert.equal(item.keyframes[0].t, 15);
    assert.equal(item.path, undefined);
    assert.equal(JSON.parse(before.edit).audio.sfx[0].keyframes[0].t, 0.5);
});

test('nextCopyId は既存 ID を変更せず空き番号を返す', () => {
    const ids = Object.freeze(['cut-copy', 'cut-copy-2', 'cut-copy-4']);
    assert.equal(nextCopyId('cut-copy', ids), 'cut-copy-3');
    assert.equal(nextCopyId('layer-copy', ids), 'layer-copy');
});
