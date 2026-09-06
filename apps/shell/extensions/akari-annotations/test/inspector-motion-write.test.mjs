import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS, MOTION_EASES, MOTION_PRESET_LABELS,
    MOTION_DURATION_DEFAULTS, MOTION_AMOUNT_DEFAULTS, normalizeInspectorMotion,
    updateInspectorMotion, validateInspectorMotion, createMotionWriteRequest
} from '../lib/browser/inspector/motion-fields.js';
import { layerSections, itemSections, visualSnapshot, timelineMethod } from './helpers/perspective-transition-fixture.mjs';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';
import { maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';
import { layerSnapshotChromaKey, legacyTransformOpFor } from '../lib/browser/inspector/field-mappings.js';
import { isCutFramingWriteRequest } from '../lib/browser/inspector/framing-fields.js';
import { isCutFreezeWriteRequest } from '../lib/browser/inspector/freeze-fields.js';

const allMotion = {
    in: { preset: 'slide-up', duration: 12, ease: 'out-cubic', amount: 40 },
    out: { preset: 'fade', duration: 8 }, loop: { preset: 'float', period: 90 }
};
const rows = (snapshot, write, factory = layerSections) => factory(snapshot, write)
    .find(section => section.id === 'motion').fields;

test('motion の語彙・日本語ラベルと既定値は契約どおり', () => {
    assert.deepEqual(MOTION_IN_OUT_PRESETS, ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale', 'wipe']);
    assert.deepEqual(MOTION_LOOP_PRESETS, ['pulse', 'float', 'spin']);
    assert.deepEqual([...MOTION_IN_OUT_PRESETS, ...MOTION_LOOP_PRESETS].map(id => MOTION_PRESET_LABELS[id]), [
        'フェード', 'スライド（上へ）', 'スライド（下へ）', 'スライド（左へ）', 'スライド（右へ）',
        '拡縮', 'ワイプ', '脈動', '浮遊', '回転'
    ]);
    assert.deepEqual(MOTION_EASES, ['linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad',
        'in-cubic', 'out-cubic', 'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart',
        'in-expo', 'out-expo', 'in-out-expo', 'in-back', 'out-back', 'in-out-back', 'out-bounce', 'out-elastic', 'hold']);
    assert.deepEqual(MOTION_DURATION_DEFAULTS, { in: 12, out: 8, loop: 90 });
    for (const id of ['slide-up', 'slide-down', 'slide-left', 'slide-right']) {
        assert.deepEqual(MOTION_AMOUNT_DEFAULTS[id], { value: 40, unit: 'px' });
    }
    for (const [id, value, unit] of [['scale', 0.2, '倍'], ['pulse', 0.05, '倍'], ['float', 6, 'px'], ['spin', 1, '方向']]) {
        assert.deepEqual(MOTION_AMOUNT_DEFAULTS[id], { value, unit });
    }
    assert.equal(MOTION_AMOUNT_DEFAULTS.fade, undefined);
    assert.equal(MOTION_AMOUNT_DEFAULTS.wipe, undefined);
});

test('normalize は不正な席と任意値を欠け扱いにし、入力を変更しない', () => {
    for (const raw of [null, undefined, [], 'bad', 1, { in: null }, { in: [] },
        { in: { preset: 'spin', duration: 12 } }, { loop: { preset: 'float', duration: 90 } },
        { out: { preset: 'fade', duration: 0 } }, { in: { preset: 'fade', duration: 1.5 } }]) {
        assert.deepEqual(normalizeInspectorMotion(raw), {});
    }
    const raw = structuredClone(allMotion);
    const result = normalizeInspectorMotion(raw);
    assert.deepEqual(result, raw);
    result.in.duration = 24;
    assert.deepEqual(raw, allMotion);
    assert.deepEqual(normalizeInspectorMotion({ in: { preset: 'fade', duration: 12, ease: 1, amount: Infinity, extra: true } }),
        { in: { preset: 'fade', duration: 12 } });
});

test('席の新規選択は preset と duration / period の2キーだけを書く', () => {
    for (const slot of ['in', 'out', 'loop']) {
        for (const preset of slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS) {
            const expected = { [slot]: { preset, [slot === 'loop' ? 'period' : 'duration']: MOTION_DURATION_DEFAULTS[slot] } };
            assert.deepEqual(updateInspectorMotion(undefined, slot, 'preset', preset), expected);
            assert.deepEqual(updateInspectorMotion(undefined, slot, 'preset', MOTION_PRESET_LABELS[preset]), expected);
        }
    }
});

test('なし・preset reset は対象席だけ削除し、3席空なら null', () => {
    let motion = structuredClone(allMotion);
    motion = updateInspectorMotion(motion, 'in', 'preset', 'なし');
    assert.deepEqual(motion, { out: allMotion.out, loop: allMotion.loop });
    motion = updateInspectorMotion(motion, 'out', 'preset', null);
    assert.deepEqual(motion, { loop: allMotion.loop });
    assert.equal(updateInspectorMotion(motion, 'loop', 'preset', 'なし'), null);
    assert.equal(updateInspectorMotion(undefined, 'in', 'preset', 'なし'), null);
});

test('尺・周期・ease・amount の更新と reset は他の席を保持する', () => {
    const raw = structuredClone(allMotion);
    let motion = updateInspectorMotion(raw, 'in', 'duration', '15');
    motion = updateInspectorMotion(motion, 'in', 'amount', '200');
    motion = updateInspectorMotion(motion, 'loop', 'duration', '60');
    assert.deepEqual(motion, { in: { preset: 'slide-up', duration: 15, ease: 'out-cubic', amount: 200 },
        out: allMotion.out, loop: { preset: 'float', period: 60 } });
    for (const field of ['duration', 'ease', 'amount']) motion = updateInspectorMotion(motion, 'in', field, null);
    motion = updateInspectorMotion(motion, 'loop', 'duration', null);
    assert.deepEqual(motion, { in: { preset: 'slide-up', duration: 12 }, out: allMotion.out, loop: allMotion.loop });
    assert.deepEqual(raw, allMotion);
    assert.deepEqual(updateInspectorMotion(raw, 'in', 'preset', 'slide-down'), {
        ...allMotion, in: { ...allMotion.in, preset: 'slide-down' }
    });
    assert.deepEqual(updateInspectorMotion(raw, 'in', 'preset', 'wipe').in,
        { preset: 'wipe', duration: 12, ease: 'out-cubic' });
});

test('不正入力・未選択席への更新は throw、量の符号やゼロは保持する', () => {
    for (const value of [0, -1, 1.5, Infinity, NaN, '', 'no']) {
        assert.throws(() => updateInspectorMotion(allMotion, 'in', 'duration', value), /整数フレーム/u);
    }
    for (const field of ['duration', 'ease', 'amount']) assert.throws(() => updateInspectorMotion(null, 'in', field, '1'));
    assert.throws(() => updateInspectorMotion(allMotion, 'in', 'preset', 'spin'));
    assert.throws(() => updateInspectorMotion(allMotion, 'loop', 'preset', 'fade'));
    assert.throws(() => updateInspectorMotion(allMotion, 'in', 'ease', 'bad'));
    for (const input of ['', ' ', 'Infinity', 'NaN']) assert.throws(() => updateInspectorMotion(allMotion, 'in', 'amount', input));
    for (const input of [0, -1, 0.05]) assert.equal(updateInspectorMotion(allMotion, 'in', 'amount', input).in.amount, input);
    assert.throws(() => updateInspectorMotion(allMotion, 'out', 'amount', 1), /このプリセットに量はありません/u);
});

test('validate は入り12 + 抜き8 の尺15超過と整数でない尺・周期を拒否する', () => {
    assert.throws(() => validateInspectorMotion(allMotion, 15), /合計 20.*尺 15.*超え/u);
    assert.doesNotThrow(() => validateInspectorMotion(allMotion, 20));
    assert.doesNotThrow(() => validateInspectorMotion({ loop: { preset: 'spin', period: 90 } }, 1));
    assert.doesNotThrow(() => validateInspectorMotion(null, 15));
    for (const slot of ['in', 'out', 'loop']) {
        for (const value of [undefined, 0, -1, 1.2, '12', NaN, Infinity]) {
            assert.throws(() => validateInspectorMotion({ [slot]: {
                preset: slot === 'loop' ? 'float' : 'fade', [slot === 'loop' ? 'period' : 'duration']: value
            } }, 150), /整数フレーム/u);
        }
    }
});

test('layer / item 行から正確な motion リクエストを発行し、超過を ok:false に変換する', async () => {
    for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
        const snapshot = visualSnapshot(kind);
        const requests = [];
        const fields = rows(snapshot, async request => { requests.push(request); return { ok: true }; }, factory);
        assert.deepEqual(await fields[0].write(snapshot, 'スライド（上へ）'), { ok: true });
        assert.deepEqual(requests.pop(), { kind: 'item-field', id: snapshot.id, path: 'motion',
            value: { in: { preset: 'slide-up', duration: 12 } } });
        await fields[0].write({ ...snapshot, motion: { in: allMotion.in } }, 'なし');
        assert.equal(requests.pop().value, null);
        const short = { ...snapshot, durationFrames: 15, motion: { in: allMotion.in } };
        const shortRows = rows(short, async () => assert.fail('超過時は保存しない'), factory);
        const result = await shortRows[4].write(short, 'フェード');
        assert.equal(result.ok, false);
        assert.match(result.message, /合計 20.*尺 15/u);
    }
});

test('全12行の reset とプリセットごとの量の表示', async () => {
    const snapshot = visualSnapshot('layer', { motion: {
        in: { preset: 'scale', duration: 20, ease: 'out-cubic', amount: 0.5 },
        out: { preset: 'slide-left', duration: 10, ease: 'in-cubic', amount: 100 },
        loop: { preset: 'spin', period: 60, ease: 'ease-in-out', amount: -1 }
    } });
    const requests = [];
    for (const field of rows(snapshot, async request => { requests.push(request); return { ok: true }; })) {
        assert.equal((await field.reset(snapshot)).ok, true);
    }
    for (const [index, slot] of ['in', 'out', 'loop'].entries()) {
        assert.equal(requests[index * 4].value[slot], undefined);
        assert.equal(requests[index * 4 + 1].value[slot][slot === 'loop' ? 'period' : 'duration'], MOTION_DURATION_DEFAULTS[slot]);
        assert.equal(Object.hasOwn(requests[index * 4 + 2].value[slot], 'ease'), false);
        assert.equal(Object.hasOwn(requests[index * 4 + 3].value[slot], 'amount'), false);
    }
    for (const [preset, expected] of Object.entries(MOTION_AMOUNT_DEFAULTS)) {
        const slot = MOTION_LOOP_PRESETS.includes(preset) ? 'loop' : 'in';
        const current = visualSnapshot('layer', { motion: updateInspectorMotion(null, slot, 'preset', preset) });
        const amount = rows(current, async () => ({ ok: true }))[slot === 'loop' ? 11 : 3];
        assert.equal(amount.unit, expected.unit);
        assert.equal(Number(amount.getValue()), expected.value);
    }
});

test('cubic-bezier の現在値は raw 選択肢に残し、未設定の select には出さない', async () => {
    const ease = 'cubic-bezier(0.25,0.1,0.25,1)';
    const snapshot = visualSnapshot('layer', { motion: { in: { preset: 'fade', duration: 12, ease } } });
    const requests = [];
    const row = rows(snapshot, async request => { requests.push(request); return { ok: true }; })[2];
    assert.equal(row.getValue(), ease);
    assert.deepEqual(row.options, [...MOTION_EASES, ease]);
    assert.equal((await row.write(snapshot, ease)).ok, true);
    assert.equal(requests[0].value.in.ease, ease);
    assert.deepEqual(rows(visualSnapshot(), () => {})[2].options, MOTION_EASES);
});

const handleWrite = timelineMethod('handleInspectorWriteV2', {
    updateTreeV2Item, legacyTransformOpFor, isCutFramingWriteRequest, isCutFreezeWriteRequest, validateInspectorMotion
});
test('書き込みブリッジは motion を保存・席削除・全削除し、超過とHTMLを拒否する', async () => {
    const state = {
        commits: 0, editDocument: { version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
            id: 'visual-1', at: 0, duration: 150, source: { kind: 'media', src: 'main' }
        }] }] },
        rawKeyframeItem() { return this.editDocument.tracks[0].items[0]; },
        async commitEditMutation(label, mutate) { this.label = label; this.editDocument = mutate(this.editDocument); this.commits++; },
        hideNotice() {}, showNotice() {}, footer: {}, errorMessage: error => error.message
    };
    const request = { kind: 'item-field', id: 'visual-1', path: 'motion', value: allMotion };
    for (const value of [allMotion, { loop: allMotion.loop }, null]) {
        assert.deepEqual(await handleWrite.call(state, { ...request, value }), { ok: true });
        assert.deepEqual(state.rawKeyframeItem().motion, value ?? undefined);
        assert.equal(state.label, 'クリップの動きを変更');
    }
    assert.equal(Object.hasOwn(state.rawKeyframeItem(), 'motion'), false);
    state.rawKeyframeItem().duration = 15;
    assert.equal((await handleWrite.call(state, request)).ok, false);
    state.rawKeyframeItem().duration = 150;
    state.rawKeyframeItem().source.kind = 'html';
    assert.equal((await handleWrite.call(state, request)).ok, false);
    assert.equal(state.commits, 3);
    assert.throws(() => createMotionWriteRequest(visualSnapshot('item', { sourceKind: 'html' }), 'in', 'preset', 'fade'), /HTML/u);
});

const treeSnapshot = timelineMethod('treeItemSnapshot', { readInspectorAdjustSnapshot, maskSourceOptionsForSources });
const layerSnapshot = timelineMethod('snapshotForSelection', {
    readInspectorAdjustSnapshot, maskSourceOptionsForSources, layerSnapshotChromaKey, resolveTimelineClipName: item => item.id
});
test('layer / tree snapshot は native の motion と実フレーム尺を運び、HTML の motion は運ばない', () => {
    for (const kind of ['media', 'telop', 'group', 'html']) {
        const raw = { id: 'visual-1', at: 0, duration: 48, source: { kind }, motion: allMotion };
        const state = {
            fps: 24, sourceMap: new Map(), expandedTimelineTreeRows: [],
            layers: [{ id: raw.id, kind: 'video', t: 0, duration: 2 }],
            rawV2Item: () => raw, rawKeyframeItem: () => raw, trackDisplayNameForItem: () => 'Video'
        };
        for (const snapshot of [treeSnapshot.call(state, { kind: 'item', id: raw.id, itemKind: kind, trackId: 'video' }, raw),
            layerSnapshot.call(state, { kind: 'layer', id: raw.id })]) {
            assert.equal(snapshot.durationFrames, 48);
            assert.equal(snapshot.sourceKind, kind);
            assert.equal(Object.hasOwn(snapshot, 'motion'), kind !== 'html');
            if (kind !== 'html') assert.deepEqual(snapshot.motion, allMotion);
        }
        delete raw.duration;
        assert.equal(layerSnapshot.call(state, { kind: 'layer', id: raw.id }).durationFrames, 48);
    }
});
