import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as fx from '../lib/browser/inspector/adjust-fx-fields.js';
import * as adjust from '../lib/browser/inspector/adjust-fields.js';
import { ACTIVE_ADJUST_SECTIONS } from '../lib/browser/inspector/tab-model.js';
import { INSPECTOR_LOOK_PRESETS, matchLookPreset } from '../lib/browser/inspector/look-presets.js';
import { buildLutOptions } from '../lib/browser/inspector/lut-options.js';

const { INSPECTOR_ADJUST_FX, addInspectorAdjustFx, updateInspectorAdjustFxParam, normalizeInspectorAdjustFx } = fx;

test('(a) 第 2 群は既存 4 種の後に契約どおりの順序・語彙・パラメータを持つ', () => {
    assert.deepEqual(INSPECTOR_ADJUST_FX.slice(0, 4).map(effect => effect.id), ['vignette', 'blur', 'grain', 'sharpen']);
    assert.deepEqual(INSPECTOR_ADJUST_FX.slice(4), [
        { id: 'glow', label: 'グロー', params: [
            { key: 'intensity', label: '強さ', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 },
            { key: 'radius', label: '半径', min: 0, max: 100, default: 20, step: 1, unit: 'px', displayScale: 1 },
            { key: 'threshold', label: 'しきい値', min: 0, max: 1, default: 0.7, step: 0.01, unit: '%', displayScale: 100 },
            { key: 'warmth', label: '色味', min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 }
        ] },
        { id: 'clarity', label: '明瞭度', params: [
            { key: 'amount', label: '量', min: -1, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
            { key: 'radius', label: '半径', min: 1, max: 50, default: 10, step: 1, unit: 'px', displayScale: 1 }
        ] },
        { id: 'dehaze', label: 'かすみ除去', params: [
            { key: 'amount', label: '量', min: -1, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 }
        ] },
        { id: 'denoise', label: 'ノイズ除去', params: [
            { key: 'amount', label: '量', min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 }
        ] },
        { id: 'motion_blur', label: 'モーションブラー', params: [
            { key: 'px', label: '長さ', min: 0, max: 100, default: 10, step: 1, unit: 'px', displayScale: 1 },
            { key: 'angle', label: '角度', min: -180, max: 180, default: 0, step: 1, unit: '°', displayScale: 1 }
        ] }
    ]);
});

test('(b) グローは id だけで追加し半径の更新後に既定値へ戻すとキーを省略する', () => {
    const added = addInspectorAdjustFx([], 'glow');
    assert.deepEqual(added, [{ id: 'glow' }]);
    const updated = updateInspectorAdjustFxParam(added, 0, 'radius', 40);
    assert.deepEqual(updated, [{ id: 'glow', radius: 40 }]);
    assert.deepEqual(updateInspectorAdjustFxParam(updated, 0, 'radius', 20), [{ id: 'glow' }]);
});

test('(c) モーションブラーの角度は両端を受理し範囲外の要素を捨てる', () => {
    for (const angle of [-180, 180]) {
        const expected = [{ id: 'motion_blur', angle }];
        assert.deepEqual(updateInspectorAdjustFxParam([{ id: 'motion_blur' }], 0, 'angle', angle), expected);
        assert.deepEqual(normalizeInspectorAdjustFx(expected), expected);
    }
    assert.deepEqual(normalizeInspectorAdjustFx([{ id: 'motion_blur', angle: 181 }]), []);
});

test('(d) 語彙 9 種を順に追加すると 8 個まで成功し 9 個目を拒否する', () => {
    assert.equal(INSPECTOR_ADJUST_FX.length, 9);
    let list = [];
    for (const [index, { id }] of INSPECTOR_ADJUST_FX.entries()) {
        if (index === 8) {
            assert.throws(() => addInspectorAdjustFx(list, id), /8 個まで/u);
        } else {
            list = addInspectorAdjustFx(list, id);
            assert.deepEqual(list, INSPECTOR_ADJUST_FX.slice(0, index + 1).map(effect => ({ id: effect.id })));
        }
    }
    assert.equal(list.length, 8);
});

// 既存テストと同様、AST から実際のフィールド生成関数を取り出して DOM 非依存で検査する。
const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ADJUST_SECTIONS');
assert.ok(factory);
const dependencies = { ...fx, ...adjust, ACTIVE_ADJUST_SECTIONS, INSPECTOR_LOOK_PRESETS, matchLookPreset, buildLutOptions };
delete dependencies.default;
delete dependencies['module.exports'];
const code = ts.transpileModule(factory.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const sections = new Function(...Object.keys(dependencies), `${code}\nreturn ADJUST_SECTIONS;`)(...Object.values(dependencies));

test('(e) 効果追加 select は選択…と既存 4 種・第 2 群 5 種のラベル順を持つ', () => {
    for (const kind of ['cut', 'layer', 'overlay', 'item']) {
        const snapshot = { kind, id: 'clip', itemId: 'clip', index: 0, adjust: adjust.readInspectorAdjustSnapshot(undefined) };
        const all = sections(snapshot, async () => ({ ok: true }), { projectLutRefs: [] });
        const section = all.find(entry => entry.id === 'adjust:fx');
        assert.ok(section);
        const row = section.fields.find(field => field.name === 'adjust-fx-add');
        assert.ok(row);
        assert.equal(row.inputKind, 'select');
        assert.deepEqual(row.options, ['選択…', 'ビネット', 'ぼかし', 'フィルムグレイン', 'シャープ', 'グロー', '明瞭度', 'かすみ除去', 'ノイズ除去', 'モーションブラー']);
    }
});
