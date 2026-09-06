import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as fx from '../lib/browser/inspector/adjust-fx-fields.js';
import * as adjust from '../lib/browser/inspector/adjust-fields.js';
import { ACTIVE_ADJUST_SECTIONS } from '../lib/browser/inspector/tab-model.js';
import { INSPECTOR_LOOK_PRESETS, matchLookPreset } from '../lib/browser/inspector/look-presets.js';
import { buildLutOptions } from '../lib/browser/inspector/lut-options.js';
import { createNumberField } from '../lib/browser/inspector/number-field.js';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';

const { INSPECTOR_ADJUST_FX, normalizeInspectorAdjustFx, addInspectorAdjustFx,
    removeInspectorAdjustFx, moveInspectorAdjustFx, updateInspectorAdjustFxParam,
    isInspectorAdjustFxIdentity } = fx;
const { updateInspectorAdjust, readInspectorAdjustSnapshot, isInspectorAdjustIdentity } = adjust;

test('効果語彙とパラメータは契約の範囲・既定・表示単位を持つ', () => {
    assert.deepEqual(INSPECTOR_ADJUST_FX.map(({ id, label, params }) => [id, label,
        params.map(p => [p.key, p.min, p.max, p.default, p.step, p.unit, p.displayScale])]), [
        ['vignette', 'ビネット', [
            ['amount', -1, 1, 0.5, 0.05, '%', 100], ['midpoint', 0, 1, 0.5, 0.01, '%', 100],
            ['roundness', -1, 1, 0, 0.01, '%', 100], ['feather', 0, 1, 0.5, 0.01, '%', 100]
        ]],
        ['blur', 'ぼかし', [['px', 0, 50, 8, 1, 'px', 1]]],
        ['grain', 'フィルムグレイン', [['amount', 0, 1, 0.3, 0.01, '%', 100], ['size', 0.5, 4, 1, 0.1, '倍', 1]]],
        ['sharpen', 'シャープ', [['amount', 0, 1, 0.5, 0.01, '%', 100]]],
        ['glow', 'グロー', [
            ['intensity', 0, 1, 0.5, 0.01, '%', 100],
            ['radius', 0, 100, 20, 1, 'px', 1],
            ['threshold', 0, 1, 0.7, 0.01, '%', 100],
            ['warmth', -1, 1, 0, 0.01, '%', 100]
        ]],
        ['clarity', '明瞭度', [
            ['amount', -1, 1, 0.3, 0.01, '%', 100],
            ['radius', 1, 50, 10, 1, 'px', 1]
        ]],
        ['dehaze', 'かすみ除去', [['amount', -1, 1, 0.3, 0.01, '%', 100]]],
        ['denoise', 'ノイズ除去', [['amount', 0, 1, 0.3, 0.01, '%', 100]]],
        ['motion_blur', 'モーションブラー', [
            ['px', 0, 100, 10, 1, 'px', 1],
            ['angle', -180, 180, 0, 1, '°', 1]
        ]]
    ]);
});

test('正規化は不正な要素・未知キー・重複を捨て既定キーを省略する', () => {
    for (const raw of [undefined, null, {}, 'blur']) assert.deepEqual(normalizeInspectorAdjustFx(raw), []);
    const raw = [null, [], {}, { id: 'unknown' }, { id: 'blur', extra: 1 },
        { id: 'blur', px: '8' }, { id: 'blur', px: NaN }, { id: 'blur', px: Infinity },
        { id: 'blur', px: 51 }, { id: 'vignette', amount: -2 }, { id: 'grain', size: 0 },
        { id: 'blur', px: 20 }, { id: 'blur', px: 30 },
        { id: 'vignette', amount: 0.5, roundness: 0 }, { id: 'grain', size: 1, amount: 0.3 }];
    const normalized = normalizeInspectorAdjustFx(raw);
    assert.deepEqual(normalized, [{ id: 'blur', px: 20 }, { id: 'vignette' }, { id: 'grain' }]);
    normalized[0].px = 40;
    assert.equal(raw[11].px, 20);
});

test('追加は id だけを保存し重複・9 個目・未知 id を拒否する', () => {
    let list = [];
    for (const { id } of INSPECTOR_ADJUST_FX.slice(0, 8)) {
        const previous = structuredClone(list);
        const next = addInspectorAdjustFx(list, id);
        assert.deepEqual(list, previous);
        assert.deepEqual(next.at(-1), { id });
        assert.throws(() => addInspectorAdjustFx([{ id }], id), /同じ効果は 1 つまでです/u);
        list = next;
    }
    assert.throws(() => addInspectorAdjustFx(Array.from({ length: 8 }, () => ({ id: 'blur' })), 'grain'), /8 個まで/u);
    assert.throws(() => addInspectorAdjustFx(list, INSPECTOR_ADJUST_FX[8].id), /8 個まで/u);
    assert.throws(() => addInspectorAdjustFx([], 'nonexistent_fx'), /一覧から/u);
});

test('並べ替え・削除は入力を変更せずパラメータと適用順を保持する', () => {
    const list = Object.freeze([Object.freeze({ id: 'vignette', amount: 0.8 }), Object.freeze({ id: 'blur', px: 20 })]);
    const moved = moveInspectorAdjustFx(list, 1, -1);
    assert.deepEqual(moved, [list[1], list[0]]);
    assert.deepEqual(moveInspectorAdjustFx(moved, 0, 1), list);
    assert.deepEqual(moveInspectorAdjustFx(list, 0, -1), list);
    assert.deepEqual(moveInspectorAdjustFx(list, 1, 1), list);
    assert.deepEqual(removeInspectorAdjustFx(moved, 0), [list[0]]);
    assert.equal(isInspectorAdjustFxIdentity(removeInspectorAdjustFx([list[0]], 0)), true);
    assert.equal(isInspectorAdjustFxIdentity([{ id: 'blur', px: 0 }]), false);
    for (const index of [-1, 2, 0.5, NaN]) {
        assert.throws(() => removeInspectorAdjustFx(list, index), /効果を選択/u);
        assert.throws(() => moveInspectorAdjustFx(list, index, 1), /効果を選択/u);
    }
    assert.throws(() => moveInspectorAdjustFx(list, 0, 2), /上か下/u);
});

test('全パラメータの境界・null・既定値を検証し未知キーと不正値を拒否する', () => {
    for (const effect of INSPECTOR_ADJUST_FX) {
        for (const param of effect.params) {
            const list = [{ id: effect.id }];
            for (const value of [param.min, param.max]) {
                const result = updateInspectorAdjustFxParam(list, 0, param.key, value);
                assert.deepEqual(result, [{ id: effect.id, ...(value === param.default ? {} : { [param.key]: value }) }]);
                assert.deepEqual(updateInspectorAdjustFxParam(result, 0, param.key, null), list);
                assert.deepEqual(updateInspectorAdjustFxParam(result, 0, param.key, param.default), list);
            }
            for (const value of [param.min - 0.01, param.max + 0.01, NaN, Infinity, '0']) {
                assert.throws(() => updateInspectorAdjustFxParam(list, 0, param.key, value), /範囲/u);
            }
            assert.deepEqual(list, [{ id: effect.id }]);
        }
    }
    assert.throws(() => updateInspectorAdjustFxParam([{ id: 'blur' }], 0, 'amount', null), /未対応/u);
    assert.throws(() => updateInspectorAdjustFxParam([], 0, 'px', 20), /効果を選択/u);
});

test('adjust.fx は正規化した配列で置換し空なら fx と identity adjust を除去する', () => {
    const current = { basic: { exposure: 1 }, fx: [{ id: 'blur' }], future: { keep: true } };
    const result = updateInspectorAdjust(current, 'adjust.fx', [{ id: 'grain', size: 1 }, { id: 'unknown' }]);
    assert.deepEqual(result, { basic: { exposure: 1 }, fx: [{ id: 'grain' }], future: { keep: true } });
    assert.deepEqual(current.fx, [{ id: 'blur' }]);
    assert.deepEqual(updateInspectorAdjust(result, 'adjust.fx', []), { basic: { exposure: 1 }, future: { keep: true } });
    assert.equal(updateInspectorAdjust({ fx: [{ id: 'blur' }], sections: { fx: false } }, 'adjust.fx', []), null);
    assert.equal(updateInspectorAdjust({ fx: [{ id: 'blur' }] }, 'adjust.fx', null), null);
    assert.equal(isInspectorAdjustIdentity({ fx: [], sections: { fx: false } }), true);
    assert.equal(isInspectorAdjustIdentity({ fx: [{ id: 'blur', px: 0 }] }), false);
    assert.equal(isInspectorAdjustIdentity({ fx: [{ id: 'future' }] }), false);
    assert.throws(() => updateInspectorAdjust(undefined, 'adjust.fx', 'blur'), /配列/u);
});

test('sections.fx は効果を保持して無効化し ON と null で疎辞書へ戻す', () => {
    const current = { fx: [{ id: 'vignette', amount: 0.8 }] };
    const disabled = updateInspectorAdjust(current, 'adjust.sections.fx', false);
    assert.deepEqual(disabled, { ...current, sections: { fx: false } });
    assert.equal(readInspectorAdjustSnapshot(disabled).sections.fx, false);
    assert.deepEqual(readInspectorAdjustSnapshot(disabled).fx, current.fx);
    for (const value of [true, null]) assert.deepEqual(updateInspectorAdjust(disabled, 'adjust.sections.fx', value), current);
    assert.equal(readInspectorAdjustSnapshot(undefined).sections.fx, true);
    assert.deepEqual(readInspectorAdjustSnapshot({ fx: [{ id: 'blur', px: 8 }, null] }).fx, [{ id: 'blur' }]);
    assert.throws(() => updateInspectorAdjust(current, 'adjust.sections.fx', 'false'), /boolean/u);
});

// 既存 transition テストと同様、Theia を起動せず実際のフィールド生成関数を実行する。
const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'ADJUST_SECTIONS');
assert.ok(factory);
const dependencies = { ...fx, ...adjust, ACTIVE_ADJUST_SECTIONS, INSPECTOR_LOOK_PRESETS, matchLookPreset, buildLutOptions };
delete dependencies.default;
delete dependencies['module.exports'];
const code = ts.transpileModule(factory.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const sections = new Function(...Object.keys(dependencies), `${code}\nreturn ADJUST_SECTIONS;`)(...Object.values(dependencies));
function fixture(kind = 'item', initial) {
    let value = initial;
    const writes = [];
    const snapshot = () => ({ kind, id: 'clip', itemId: 'clip', index: 0, adjust: readInspectorAdjustSnapshot(value) });
    const write = async request => {
        writes.push(request);
        value = updateInspectorAdjust(value, request.path, request.value);
        return { ok: true };
    };
    const all = () => sections(snapshot(), write, { projectLutRefs: [] });
    const section = () => all().find(entry => entry.id === 'adjust:fx');
    return { all, section, writes, snapshot, value: () => value,
        row: name => section().fields.find(field => field.name === `adjust-fx-${name}`) };
}

test('全 visual 選択で実働 6 セクションと追加 select が同じ adjust.fx 要求を作る', async () => {
    for (const kind of ['cut', 'layer', 'overlay', 'item']) {
        const f = fixture(kind);
        assert.deepEqual(f.all().map(section => section.label), ACTIVE_ADJUST_SECTIONS);
        const row = f.row('add');
        assert.equal(row.inputKind, 'select');
        assert.deepEqual(row.options, ['選択…', 'ビネット', 'ぼかし', 'フィルムグレイン', 'シャープ', 'グロー', '明瞭度', 'かすみ除去', 'ノイズ除去', 'モーションブラー']);
        assert.equal(row.getValue(), '選択…');
        assert.equal((await row.write(f.snapshot(), 'ビネット')).ok, true);
        assert.deepEqual(f.writes, [{ kind: 'item-field', id: 'clip', path: 'adjust.fx', value: [{ id: 'vignette' }] }]);
        assert.deepEqual(await f.row('add').write(f.snapshot(), 'ビネット'), { ok: false, message: '同じ効果は 1 つまでです' });
        assert.equal(f.writes.length, 1);
    }
});

test('UI は量 80%・ぼかし 20px・並べ替え・リセット・全削除を配列一括で書く', async () => {
    const f = fixture();
    await f.row('add').write(f.snapshot(), 'ビネット');
    const amount = f.row('vignette-amount');
    assert.equal(amount.inputKind, 'scrub-number');
    assert.equal(amount.displayScale, 100);
    assert.equal(amount.scrubStep * amount.displayScale, 5);
    assert.equal(amount.getEditValue(), '0.5');
    await amount.write(f.snapshot(), '0.8');
    assert.deepEqual(f.writes.at(-1).value, [{ id: 'vignette', amount: 0.8 }]);
    await f.row('add').write(f.snapshot(), 'ぼかし');
    await f.row('blur-px').write(f.snapshot(), '20');
    assert.deepEqual(f.value().fx, [{ id: 'vignette', amount: 0.8 }, { id: 'blur', px: 20 }]);
    assert.equal(f.row('vignette').actions[0].disabled, true);
    assert.equal(f.row('blur').actions[1].disabled, true);
    assert.deepEqual(f.row('blur').actions.map(action => action.label), ['↑', '↓', '削除']);
    await f.row('blur').actions[0].action(f.snapshot());
    assert.deepEqual(f.value().fx, [{ id: 'blur', px: 20 }, { id: 'vignette', amount: 0.8 }]);
    await f.row('vignette-amount').reset(f.snapshot());
    assert.deepEqual(f.value().fx, [{ id: 'blur', px: 20 }, { id: 'vignette' }]);
    await f.row('blur').actions[2].action(f.snapshot());
    await f.row('vignette').actions[2].action(f.snapshot());
    assert.equal(f.value(), null);
    assert.ok(f.writes.every(request => request.path === 'adjust.fx'));
});

test('OFF は追加・並べ替え・削除・数値・リセットを無効化し要求を送らない', async () => {
    const f = fixture('item', { fx: [{ id: 'blur', px: 20 }], sections: { fx: false } });
    assert.equal(f.section().enable.checked, false);
    for (const field of f.section().fields) {
        assert.equal(field.disabled, true);
        assert.equal(field.keyframeDisabled, true);
        if (field.write) assert.equal((await field.write(f.snapshot(), 'ぼかし')).ok, false);
        if (field.reset) assert.equal((await field.reset(f.snapshot())).ok, false);
        for (const action of field.actions ?? []) assert.equal((await action.action(f.snapshot())).ok, false);
    }
    assert.deepEqual(f.writes, []);
    await f.section().enable.write(true);
    assert.deepEqual(f.writes[0], { kind: 'item-field', id: 'clip', path: 'adjust.sections.fx', value: null });
    assert.ok(f.section().fields.every(field => !field.disabled));
});

test('UI は不正入力を日本語の ok:false で返して書き込まない', async () => {
    const f = fixture('item', { fx: [{ id: 'blur' }] });
    assert.equal((await f.row('add').write(f.snapshot(), '存在しない効果')).ok, false);
    for (const value of ['', 'NaN', '51']) {
        const result = await f.row('blur-px').write(f.snapshot(), value);
        assert.equal(result.ok, false);
        assert.match(result.message, /範囲/u);
    }
    assert.deepEqual(f.writes, []);
});

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = {};
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, event = {}) { this.listeners.get(type)?.(event); }
    querySelectorAll(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return descendants;
        if (selector.startsWith('.akari-inspector-kf-controls')) return [];
        const tags = selector.split(',').map(tag => tag.trim().toUpperCase());
        return descendants.filter(child => tags.includes(child.tagName));
    }
}
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const appendMethod = widget.members.find(member => member.name?.getText(ast) === 'appendRow');
const appendCode = ts.transpileModule(`class Widget { ${appendMethod.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const appendRow = new Function('createNumberField', `${appendCode}\nreturn Widget.prototype.appendRow;`)(createNumberField);
async function withRows(callback) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true,
        value: { createElement: tag => new FakeElement(tag) } });
    const notices = [];
    const context = { keyframeSeatOptions: () => undefined, attachRowMenu: () => {},
        showFieldNotice: message => notices.push(message) };
    const render = (field, snapshot) => {
        const parent = new FakeElement('div');
        appendRow.call(context, parent, field, snapshot, snapshot.kind);
        return parent.children[0];
    };
    try { await callback(render, notices); }
    finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
    }
}

test('実際の数値行は 80% を 0.8 に変換し、5% 刻みと disabled を反映する', async () => withRows(async render => {
    const f = fixture('item', { fx: [{ id: 'vignette' }] });
    const row = render(f.row('vignette-amount'), f.snapshot());
    const number = row.children[1];
    const input = number.children[1];
    assert.equal(input.value, '50');
    assert.equal(input.attributes.get('aria-valuemin'), '-100');
    assert.equal(input.attributes.get('aria-valuemax'), '100');
    assert.equal(number.children[2].textContent, '%');
    input.value = '80';
    input.emit('blur');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.writes.at(-1).value, [{ id: 'vignette', amount: 0.8 }]);
    number.children[3].children[0].emit('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.writes.at(-1).value, [{ id: 'vignette', amount: 0.85 }]);
    const disabled = fixture('item', { fx: [{ id: 'blur' }], sections: { fx: false } });
    const controls = render(disabled.row('blur-px'), disabled.snapshot()).querySelectorAll('button, input');
    assert.ok(controls.length > 0);
    assert.ok(controls.every(control => control.disabled));
}));

test('小見出しはラベルと 3 ボタンを同じ行に描画しクリックで削除する', async () => withRows(async render => {
    const f = fixture('item', { fx: [{ id: 'blur' }] });
    const row = render(f.row('blur'), f.snapshot());
    assert.equal(row.children[0].textContent, 'ぼかし');
    const buttons = row.children[1].children;
    assert.deepEqual(buttons.map(button => button.textContent), ['↑', '↓', '削除']);
    assert.deepEqual(buttons.map(button => button.disabled), [true, true, false]);
    buttons[2].emit('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.value(), null);
    const disabled = fixture('item', { fx: [{ id: 'blur' }], sections: { fx: false } });
    assert.ok(render(disabled.row('blur'), disabled.snapshot()).querySelectorAll('button').every(button => button.disabled));
}));

test('最後の効果削除は v2 tree item の adjust フィールドを消す', () => {
    let document = { version: 2, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'main', path: 'assets/main.mp4' }],
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 30,
            source: { kind: 'media', src: 'main', in: 0, out: 1 }, future: 'keep' }] }] };
    const item = () => document.tracks[0].items[0];
    for (const list of [[{ id: 'vignette', amount: 0.8 }], []]) {
        document = updateTreeV2Item(document, 'clip', { adjust: updateInspectorAdjust(item().adjust, 'adjust.fx', list) });
        assert.equal(Object.hasOwn(item(), 'adjust'), list.length > 0);
    }
    assert.equal(item().future, 'keep');
});
