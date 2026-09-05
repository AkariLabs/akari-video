import assert from 'node:assert/strict';
import test from 'node:test';
import {
    INSPECTOR_PERSPECTIVE_IDENTITY, normalizeInspectorPerspective, updateInspectorPerspective,
    validateInspectorPerspective, isIdentityInspectorPerspective
} from '../lib/browser/inspector/perspective-fields.js';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';
import { legacyTransformOpFor } from '../lib/browser/inspector/field-mappings.js';
import { isCutFramingWriteRequest } from '../lib/browser/inspector/framing-fields.js';
import { isCutFreezeWriteRequest } from '../lib/browser/inspector/freeze-fields.js';
import { perspectiveFields, timelineMethod, timelineSource, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

test('perspective normalize は欠け・不正な座標を identity で補完し独立した配列を返す', () => {
    for (const raw of [undefined, null, [], {}, { corners: null }]) {
        assert.deepEqual(normalizeInspectorPerspective(raw), INSPECTOR_PERSPECTIVE_IDENTITY);
    }
    const normalized = normalizeInspectorPerspective({ corners: [[0.25, NaN], [Infinity], null, [0.8, '1']] });
    assert.deepEqual(normalized, [[0.25, 0], [1, 0], [0, 1], [0.8, 1]]);
    normalized[1][0] = 0;
    assert.equal(INSPECTOR_PERSPECTIVE_IDENTITY[1][0], 1);
});

test('perspective update は指定座標だけを変更し、identity へ戻すと null', () => {
    const next = updateInspectorPerspective(undefined, 'tl', 'x', 0.25);
    assert.deepEqual(next, { corners: [[0.25, 0], [1, 0], [0, 1], [1, 1]] });
    assert.equal(isIdentityInspectorPerspective(next.corners), false);
    assert.equal(updateInspectorPerspective(next, 'tl', 'x', 0), null);
    assert.equal(updateInspectorPerspective(next, 'tl', 'x', null), null);
    assert.equal(next.corners[0][0], 0.25);
    assert.equal(isIdentityInspectorPerspective(INSPECTOR_PERSPECTIVE_IDENTITY), true);
});

test('perspective validate は preview と同文で形・範囲・非有限値・退化を拒否する', () => {
    assert.doesNotThrow(() => validateInspectorPerspective(INSPECTOR_PERSPECTIVE_IDENTITY));
    assert.throws(() => validateInspectorPerspective([]), {
        message: 'perspective.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります。'
    });
    assert.throws(() => validateInspectorPerspective([[0], [1, 0], [0, 1], [1, 1]]), {
        message: 'perspective.corners[0] (TL) は [x, y] の 2 要素配列である必要があります。'
    });
    for (const value of [-0.1, 1.1, NaN, Infinity, '0']) {
        assert.throws(() => validateInspectorPerspective([[value, 0], [1, 0], [0, 1], [1, 1]]), {
            message: 'perspective.corners[0] (TL) は 0 から 1 の範囲の有限数である必要があります。'
        });
    }
    assert.throws(() => validateInspectorPerspective([[0, 0], [0.3, 0.3], [0.6, 0.6], [1, 1]]), {
        message: 'perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。'
    });
    // preview の area2 境界を維持する（TL,TR,BR,BL の順に巡回）。
    assert.doesNotThrow(() => validateInspectorPerspective([[0, 0], [1, 0], [0, 0.00005], [1, 0.00005]]));
    assert.throws(() => validateInspectorPerspective([[0, 0], [1, 0], [0, 0.00004], [1, 0.00004]]));
});

test('perspective 全8行は対応座標を書き、各 reset はその座標だけを identity に戻す', async () => {
    for (const kind of ['layer', 'item']) {
        const snapshot = visualSnapshot(kind);
        const requests = [];
        const fields = perspectiveFields(snapshot, async request => { requests.push(request); return { ok: true }; });
        assert.equal(fields.length, 9);
        for (const [index, row] of fields.slice(0, 8).entries()) {
            assert.equal(row.inputKind, 'scrub-number');
            assert.equal(row.displayScale, 100);
            assert.equal(row.scrubStep * row.displayScale, 0.5);
            assert.equal(row.max * row.displayScale, 100);
            assert.equal(row.liveField, undefined);
            assert.equal(row.keyframeDisabled, undefined);
            assert.deepEqual(await row.write(snapshot, '0.25'), { ok: true });
            const corners = normalizeInspectorPerspective(undefined);
            corners[Math.floor(index / 2)][index % 2] = 0.25;
            assert.deepEqual(requests.at(-1), { kind: 'item-field', id: snapshot.id, path: 'perspective', value: { corners } });
            await row.reset({ ...snapshot, perspective: { corners } });
            assert.equal(requests.at(-1).value, null);
        }
    }
});

test('perspective 行は範囲外と退化四角形を ok:false にして書き込まない', async () => {
    const snapshot = visualSnapshot('layer', { perspective: { corners: [[0, 1], [1, 1], [0, 1], [1, 0]] } });
    const fields = perspectiveFields(snapshot, async () => assert.fail('invalid write'));
    for (const input of ['-0.1', '1.1', 'NaN']) {
        assert.equal((await fields[0].write(snapshot, input)).ok, false);
    }
    assert.deepEqual(await fields[7].write(snapshot, '1'), {
        ok: false, message: 'perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。'
    });
});

test('perspective KF があれば8行を disabled、他プロパティの KF は編集を妨げない', async () => {
    for (const kind of ['layer', 'item']) {
        const snapshot = visualSnapshot(kind, { keyframes: [{ t: 0 }, { t: 30, perspective: { corners: INSPECTOR_PERSPECTIVE_IDENTITY } }] });
        const fields = perspectiveFields(snapshot, async () => assert.fail('disabled write'));
        for (const row of fields.slice(0, 8)) {
            assert.equal(row.disabled, true);
            assert.equal(row.title, 'キーフレームがあるため数値行では編集できません');
            assert.equal((await row.write(snapshot, '0.25')).ok, false);
        }
        assert.equal(perspectiveFields(visualSnapshot(kind, { keyframes: [{ t: 0, opacity: 0.5 }] }), () => {})[0].disabled, false);
    }
});

test('perspective 解除は null を書き、未設定なら disabled', async () => {
    const requests = [];
    const write = async request => { requests.push(request); return { ok: true }; };
    const snapshot = visualSnapshot('layer', { perspective: { corners: INSPECTOR_PERSPECTIVE_IDENTITY } });
    const row = perspectiveFields(snapshot, write).at(-1);
    assert.equal(row.disabled, false);
    await row.action(snapshot);
    assert.deepEqual(requests, [{ kind: 'item-field', id: snapshot.id, path: 'perspective', value: null }]);
    assert.equal(perspectiveFields(visualSnapshot(), write).at(-1).disabled, true);
});

const handleWriteV2 = timelineMethod('handleInspectorWriteV2', {
    validateInspectorPerspective, updateTreeV2Item, legacyTransformOpFor,
    isCutFramingWriteRequest, isCutFreezeWriteRequest
});

test('perspective item-field は v2 mutation で保存・削除され、無効な値は保存前に拒否する', async () => {
    const context = {
        editDocument: { version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
            id: 'visual-1', at: 0, duration: 150, source: { kind: 'media', src: 'main' }
        }] }] },
        rawKeyframeItem() { return this.editDocument.tracks[0].items[0]; },
        async commitEditMutation(label, mutate) { this.label = label; this.editDocument = mutate(this.editDocument); },
        hideNotice() {}, showNotice() {}, footer: {}, errorMessage: error => error.message
    };
    const value = updateInspectorPerspective(undefined, 'tl', 'x', 0.25);
    const request = { kind: 'item-field', id: 'visual-1', path: 'perspective', value };
    assert.deepEqual(await handleWriteV2.call(context, request), { ok: true });
    assert.deepEqual(context.rawKeyframeItem().perspective, value);
    assert.equal(context.label, 'クリップのパースを変更');
    assert.equal((await handleWriteV2.call(context, { ...request, value: { corners: [[0, 0], [0, 0], [0, 0], [0, 0]] } })).ok, false);
    assert.deepEqual(context.rawKeyframeItem().perspective, value);
    assert.deepEqual(await handleWriteV2.call(context, { ...request, value: null }), { ok: true });
    assert.equal(Object.hasOwn(context.rawKeyframeItem(), 'perspective'), false);
});

test('legacy perspective item-field は既存の v2-only メッセージで拒否する', async () => {
    assert.deepEqual(await handleWriteV2.call({ legacyReadOnly: true, cutItemIds: [] }, {
        kind: 'item-field', id: 'visual-1', path: 'perspective', value: null
    }), { ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。' });
});

test('layer snapshot は rawKeyframeItem の perspective を運び、専用 path 分岐へ接続する', () => {
    assert.match(timelineSource, /const rawItem = this\.rawKeyframeItem\(layer\.id\)/u);
    assert.match(timelineSource, /perspective: rawItem\.perspective/u);
    assert.match(timelineSource, /request\.path === 'perspective'[\s\S]*?patch = \{ perspective: value \};/u);
});
