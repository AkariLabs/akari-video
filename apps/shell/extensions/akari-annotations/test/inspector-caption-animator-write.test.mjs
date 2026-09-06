import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {
    INSPECTOR_ANIMATOR_BASES, INSPECTOR_ANIMATOR_SHAPES, INSPECTOR_ANIMATOR_NUMBER_FIELDS,
    INSPECTOR_ANIMATOR_MAX_ITEMS, normalizeInspectorAnimators, nextAnimatorId,
    addInspectorAnimator, removeInspectorAnimator, moveInspectorAnimator, updateInspectorAnimator
} from '../lib/browser/inspector/animator-fields.js';
import { MOTION_EASES } from '../lib/browser/inspector/motion-fields.js';
import { createNumberField } from '../lib/browser/inspector/number-field.js';
import { composeInspectorSections } from '../lib/browser/inspector/section-model.js';
import { inspectorSource, itemSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

const animator = (id = 'a1', fields = {}) => ({
    id, basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: 0, amount: {}, ...fields
});

test('数値語彙は契約の既定値・範囲・step・表示単位を固定する', () => {
    assert.deepEqual(INSPECTOR_ANIMATOR_NUMBER_FIELDS.map(field => [
        field.key, field.min, field.max, field.default, field.step, field.unit, field.displayScale
    ]), [
        ['start', 0, 1, 0, 0.01, '%', 100], ['end', 0, 1, 0.3, 0.01, '%', 100],
        ['offset', -1, 1, 0, 0.01, '%', 100],
        ['amount.x', undefined, undefined, 0, 1, 'px', 1], ['amount.y', undefined, undefined, 0, 1, 'px', 1],
        ['amount.scale', undefined, undefined, 0, 0.01, '%', 100], ['amount.rotate', undefined, undefined, 0, 1, '°', 1],
        ['amount.opacity', -1, 1, 0, 0.01, '%', 100],
        ['amount.letterSpacing', undefined, undefined, 0, 1, 'px', 1], ['amount.blur', undefined, undefined, 0, 1, 'px', 1],
        ['randomize.seed', undefined, undefined, null, 1, '', 1]
    ]);
});

test('追加は必須の 7 キーを既定値で保存する', () => {
    const list = Object.freeze([]);
    assert.deepEqual(addInspectorAnimator(list), [animator()]);
    assert.deepEqual(list, []);
});

test('start 0.2 は反映され、null は既定の 0 に戻る', () => {
    const list = [animator()];
    const updated = updateInspectorAnimator(list, 0, 'start', 0.2);
    assert.deepEqual(updated, [animator('a1', { start: 0.2 })]);
    assert.deepEqual(updateInspectorAnimator(updated, 0, 'start', null), list);
});

test('量 Y 24 は y だけを保存し、0 と null はキーを消す', () => {
    const list = [animator()];
    const updated = updateInspectorAnimator(list, 0, 'amount.y', 24);
    assert.deepEqual(updated, [animator('a1', { amount: { y: 24 } })]);
    for (const value of [0, null]) assert.deepEqual(updateInspectorAnimator(updated, 0, 'amount.y', value), list);
    assert.deepEqual(list, [animator()]);
});

test('ease は out-cubic を保存し linear と null を省略する', () => {
    const list = [animator()];
    const updated = updateInspectorAnimator(list, 0, 'ease', 'out-cubic');
    assert.deepEqual(updated, [animator('a1', { ease: 'out-cubic' })]);
    for (const value of ['linear', null]) assert.deepEqual(updateInspectorAnimator(updated, 0, 'ease', value), list);
    for (const ease of MOTION_EASES) {
        assert.equal(updateInspectorAnimator(list, 0, 'ease', ease)[0].ease, ease === 'linear' ? undefined : ease);
    }
});

test('9 本目は日本語 Error になり既存 8 本を変更しない', () => {
    let list = [];
    for (let i = 0; i < INSPECTOR_ANIMATOR_MAX_ITEMS; i++) list = addInspectorAnimator(list);
    assert.equal(list.length, 8);
    assert.throws(() => addInspectorAnimator(list), { message: 'アニメーターは 8 本までです。' });
    assert.equal(list.length, 8);
});

test('採番は最小の空き番号を使い、削除した a1 を再利用する', () => {
    const list = [animator(), animator('a2')];
    assert.equal(nextAnimatorId(list), 'a3');
    const remaining = removeInspectorAnimator(list, 0);
    assert.equal(nextAnimatorId(remaining), 'a1');
    assert.deepEqual(addInspectorAnimator(remaining).map(entry => entry.id), ['a2', 'a1']);
    assert.equal(nextAnimatorId([animator('custom'), animator('a01'), animator('a0'), animator('a3')]), 'a1');
});

test('正規化は不正要素・未知キー・重複 id・範囲外を捨てる', () => {
    for (const raw of [undefined, null, {}, 'a1']) assert.deepEqual(normalizeInspectorAnimators(raw), []);
    const invalid = [null, [], {}, animator('', {}), animator(' '), animator(1),
        animator('a1', { basis: 'unknown' }), animator('a1', { shape: 'unknown' }),
        animator('a1', { extra: 1 }), animator('a1', { amount: [] }), animator('a1', { amount: null }),
        animator('a1', { amount: { extra: 1 } }), animator('a1', { amount: { y: Infinity } }),
        animator('a1', { amount: { opacity: 1.1 } }), animator('a1', { ease: 'unknown' }),
        animator('a1', { randomize: { seed: 1.5 } }), animator('a1', { randomize: { seed: 1, extra: 1 } }),
        animator('a1', { randomize: [] })];
    for (const key of ['start', 'end', 'offset']) {
        for (const value of [undefined, NaN, Infinity, -Infinity, '0', -1.1, 1.1]) invalid.push(animator('a1', { [key]: value }));
    }
    const first = animator('a1', { amount: { y: 24 } });
    assert.deepEqual(normalizeInspectorAnimators([...invalid, first, animator(), animator('a2')]), [first, animator('a2')]);
});

test('正規化は必須キーを維持して任意の既定値を消し、深いコピーを返す', () => {
    const raw = [animator('a1', { amount: { x: 0, y: 24, opacity: 0 }, ease: 'linear', randomize: { seed: 0 } }),
        animator('a2', { randomize: {} })];
    const saved = structuredClone(raw);
    const normalized = normalizeInspectorAnimators(raw);
    assert.deepEqual(normalized, [animator('a1', { amount: { y: 24 }, randomize: { seed: 0 } }), animator('a2')]);
    normalized[0].amount.y = 50;
    normalized[0].randomize.seed = 9;
    assert.deepEqual(raw, saved);
    assert.equal(normalizeInspectorAnimators(Array.from({ length: 10 }, (_, i) => animator(`a${i + 1}`))).length, 8);
});

test('↑ ↓ は隣だけを入れ替え、境界で順序と入力を維持する', () => {
    const list = Object.freeze([animator(), animator('a2', { amount: Object.freeze({ y: 24 }) }), animator('a3')]);
    assert.deepEqual(moveInspectorAnimator(list, 1, -1), [list[1], list[0], list[2]]);
    assert.deepEqual(moveInspectorAnimator(list, 1, 1), [list[0], list[2], list[1]]);
    assert.deepEqual(moveInspectorAnimator(list, 0, -1), list);
    assert.deepEqual(moveInspectorAnimator(list, 2, 1), list);
    const moved = moveInspectorAnimator(list, 1, -1);
    moved[0].amount.y = 50;
    assert.equal(list[1].amount.y, 24);
    assert.throws(() => moveInspectorAnimator(list, 0, 2), /上か下/u);
});

test('全更新操作は不正 index を日本語 Error にする', () => {
    for (const index of [-1, 1, 0.5, NaN]) {
        const list = [animator()];
        assert.throws(() => removeInspectorAnimator(list, index), /アニメーターを選択/u);
        assert.throws(() => moveInspectorAnimator(list, index, 1), /アニメーターを選択/u);
        assert.throws(() => updateInspectorAnimator(list, index, 'start', 0.2), /アニメーターを選択/u);
    }
});

test('数値は範囲・有限数・整数を検証し、単位付きの日本語 Error を返す', () => {
    for (const field of INSPECTOR_ANIMATOR_NUMBER_FIELDS) {
        const list = [animator()];
        const invalid = [NaN, Infinity, -Infinity, '0'];
        if (field.min !== undefined) invalid.push(field.min - 0.01);
        if (field.max !== undefined) invalid.push(field.max + 0.01);
        if (field.integer) invalid.push(0.5);
        for (const value of invalid) assert.throws(() => updateInspectorAnimator(list, 0, field.key, value), error => {
            assert.match(error.message, /範囲/u);
            assert.ok(error.message.includes(field.label));
            assert.ok(error.message.includes(field.unit));
            return true;
        });
        for (const value of [field.min ?? -24, field.max ?? 24]) {
            const updated = updateInspectorAnimator(list, 0, field.key, value);
            assert.deepEqual(normalizeInspectorAnimators(updated), updated);
            assert.deepEqual(updateInspectorAnimator(updated, 0, field.key, null), list);
        }
    }
    assert.throws(() => updateInspectorAnimator([animator()], 0, 'unknown', null), /未対応/u);
});

test('単位と形は閉じた語彙を保存し、null は既定に戻す', () => {
    for (const [key, options] of [['basis', INSPECTOR_ANIMATOR_BASES], ['shape', INSPECTOR_ANIMATOR_SHAPES]]) {
        for (const option of options) {
            const updated = updateInspectorAnimator([animator()], 0, key, option.id);
            assert.equal(updated[0][key], option.id);
            assert.deepEqual(updateInspectorAnimator(updated, 0, key, null), [animator()]);
        }
        assert.throws(() => updateInspectorAnimator([animator()], 0, key, 'unknown'), /一覧から/u);
    }
});

test('seed は負数と 0 を保存し、null で randomize ごと消す', () => {
    for (const seed of [-3, 0, 7]) {
        const updated = updateInspectorAnimator([animator()], 0, 'randomize.seed', seed);
        assert.deepEqual(updated[0].randomize, { seed });
        assert.deepEqual(updateInspectorAnimator(updated, 0, 'randomize.seed', null), [animator()]);
    }
});

function fixture(initial, itemKind = 'captions') {
    let value = initial;
    const writes = [];
    const snapshot = () => visualSnapshot('item', { itemKind, sourceKind: itemKind, animator: value });
    const all = () => itemSections(snapshot(), async request => {
        writes.push(request);
        value = request.value;
        return { ok: true };
    });
    const section = () => all().find(entry => entry.id === 'animator');
    return { all, section, writes, snapshot, value: () => value,
        row: name => section().fields.find(field => field.name === `animator-${name}`) };
}

test('字幕袋 captions と caption item だけに畳んだアニメーター節を出す', () => {
    for (const kind of ['captions', 'caption']) {
        const f = fixture(undefined, kind);
        assert.equal(f.section().label, 'アニメーター');
        assert.equal(f.section().collapsedByDefault, true);
        const ids = f.all().map(section => section.id);
        assert.equal(ids[ids.indexOf('motion') + 1], 'animator');
    }
});

test('media・telop・group・bag・part item にはアニメーター節を出さない', () => {
    for (const kind of ['media', 'telop', 'group', 'bag', 'part']) assert.equal(fixture([animator()], kind).section(), undefined);
});

test('追加 select の選択…は no-op、追加は必須キー付き配列一括 write', async () => {
    const f = fixture();
    assert.deepEqual(f.row('add').options, ['選択…', 'アニメーター']);
    assert.deepEqual(await f.row('add').write(f.snapshot(), '選択…'), { ok: true });
    assert.deepEqual(f.writes, []);
    assert.deepEqual(await f.row('add').write(f.snapshot(), 'アニメーター'), { ok: true });
    assert.deepEqual(f.writes, [{ kind: 'item-field', id: 'visual-1', path: 'animator', value: [animator()] }]);
});

test('snapshot 上の animator から行を作り量 Y 24 を animator path に書く', async () => {
    const f = fixture([animator()]);
    const row = f.row('a1-amount-y');
    assert.equal(row.label, '量 Y');
    assert.equal(row.inputKind, 'scrub-number');
    await row.write(f.snapshot(), '24');
    assert.deepEqual(f.writes, [{ kind: 'item-field', id: 'visual-1', path: 'animator', value: [animator('a1', { amount: { y: 24 } })] }]);
    await f.row('a1-amount-y').reset(f.snapshot());
    assert.deepEqual(f.value(), [animator()]);
});

test('最後の削除は空配列を null にして animator を除去する', async () => {
    const f = fixture([animator()]);
    await f.row('a1-heading').actions[2].action(f.snapshot());
    assert.deepEqual(f.writes, [{ kind: 'item-field', id: 'visual-1', path: 'animator', value: null }]);
});

test('小見出しの ↑ ↓ 削除は順序と端の disabled を反映する', async () => {
    const f = fixture([animator(), animator('a2'), animator('a3')]);
    assert.deepEqual(f.row('a1-heading').actions.map(action => action.label), ['↑', '↓', '削除']);
    assert.equal(f.row('a1-heading').actions[0].disabled, true);
    assert.equal(f.row('a3-heading').actions[1].disabled, true);
    await f.row('a2-heading').actions[0].action(f.snapshot());
    assert.deepEqual(f.value().map(entry => entry.id), ['a2', 'a1', 'a3']);
    await f.row('a2-heading').actions[1].action(f.snapshot());
    assert.deepEqual(f.value().map(entry => entry.id), ['a1', 'a2', 'a3']);
});

test('UI の不正入力・9 本目は ok:false となり要求を送らない', async () => {
    const f = fixture([animator()]);
    for (const value of ['', 'NaN', '1.1']) assert.equal((await f.row('a1-start').write(f.snapshot(), value)).ok, false);
    assert.equal((await f.row('a1-randomize-seed').write(f.snapshot(), '1.5')).ok, false);
    assert.equal((await f.row('add').write(f.snapshot(), '不明')).ok, false);
    assert.deepEqual(f.writes, []);
    const full = fixture(Array.from({ length: 8 }, (_, i) => animator(`a${i + 1}`)));
    assert.deepEqual(await full.row('add').write(full.snapshot(), 'アニメーター'), { ok: false, message: 'アニメーターは 8 本までです。' });
    assert.deepEqual(full.writes, []);
});

test('行順・単位・表示倍率・step・注記は定数に従い全行 KF 無効', () => {
    const f = fixture([animator()]);
    assert.deepEqual(f.section().fields.map(field => field.label), [
        'アニメーターを追加', 'a1', '単位', '形', '範囲 始', '範囲 終', 'オフセット',
        '量 X', '量 Y', '量 拡縮', '量 回転', '量 不透明度', '量 字間', '量 ぼかし', 'イージング', 'ランダム seed'
    ]);
    assert.ok(f.section().fields.every(field => field.keyframeDisabled && !field.liveField));
    for (const field of INSPECTOR_ANIMATOR_NUMBER_FIELDS) {
        const row = f.row(`a1-${field.key.replace('.', '-')}`);
        assert.deepEqual([row.label, row.min, row.max, row.scrubStep, row.unit, row.displayScale, row.title],
            [field.label, field.min, field.max, field.step, field.unit, field.displayScale, field.title]);
    }
    assert.deepEqual(f.row('a1-basis').options, ['文字', '単語', '行', '文節']);
    assert.equal(f.row('a1-basis').optionTitles['文節'], 'v1 では words と同じ扱いです');
    assert.deepEqual(f.row('a1-shape').options, ['上り', '下り', '三角', '丸', 'なめらか', '矩形']);
    assert.deepEqual(f.row('a1-ease').options, MOTION_EASES);
    assert.equal(f.row('a1-amount-blur').title, 'gpu 出口では v1 未対応');
    const fields = fixture([animator('add'), animator('a1-start'), animator('a1_45_start'), animator('\ud800'), animator()])
        .all().flatMap(section => section.fields);
    assert.equal(new Set(fields.map(field => field.name)).size, fields.length);
});

test('ORDER の未知 id フォールバックは telop と同順位のまま', () => {
    assert.deepEqual(composeInspectorSections([{ id: 'info' }, { id: 'unknown' }, { id: 'telop' }, { id: 'animator' }, { id: 'motion' }])
        .map(section => section.id), ['motion', 'animator', 'unknown', 'telop', 'info']);
});

// 既存 FX テストと同様に実際の appendRow を評価し、DOM のイベントから書き込む。
const ast = ts.createSourceFile('inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = widget.members.find(member => member.name?.getText(ast) === 'appendRow');
const code = ts.transpileModule(`class Widget { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const appendRow = new Function('createNumberField', `${code}\nreturn Widget.prototype.appendRow;`)(createNumberField);
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
        const children = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return children;
        if (selector.startsWith('.')) return children.filter(child => child.className === selector.slice(1));
        return children.filter(child => selector.toUpperCase().split(',').map(tag => tag.trim()).includes(child.tagName));
    }
}
async function withRows(callback) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new FakeElement(tag) } });
    const notices = [];
    const context = { model: {}, keyframeSeatOptions: () => undefined, attachRowMenu: () => {}, showFieldNotice: message => notices.push(message) };
    try {
        await callback((field, snapshot) => {
            const parent = new FakeElement('div');
            appendRow.call(context, parent, field, snapshot, snapshot.kind);
            return parent.children[0];
        }, notices);
    } finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
    }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('DOM の量 Y 入力 24 と範囲 始 20% が内部値で書き込まれる', () => withRows(async render => {
    const f = fixture([animator()]);
    for (const [name, inputValue] of [['a1-amount-y', '24'], ['a1-start', '20']]) {
        const row = render(f.row(name), f.snapshot());
        assert.equal(row.querySelectorAll('.akari-inspector-kf-controls').length, 0);
        const input = row.children[1].children[1];
        input.value = inputValue;
        input.emit('blur');
        await settle();
    }
    assert.deepEqual(f.writes.at(-1), { kind: 'item-field', id: 'visual-1', path: 'animator', value: [animator('a1', { start: 0.2, amount: { y: 24 } })] });
}));

test('DOM の seed は空欄と 0 を区別し、空欄で randomize ごと削除する', () => withRows(async render => {
    const f = fixture([animator()]);
    let input = render(f.row('a1-randomize-seed'), f.snapshot()).children[1];
    assert.equal(input.type, 'number');
    assert.equal(input.step, '1');
    assert.equal(input.value, '');
    input.value = '0';
    input.emit('blur');
    await settle();
    assert.deepEqual(f.value()[0].randomize, { seed: 0 });
    input = render(f.row('a1-randomize-seed'), f.snapshot()).children[1];
    assert.equal(input.value, '0');
    input.value = '';
    input.emit('blur');
    await settle();
    assert.deepEqual(f.value(), [animator()]);
}));

test('DOM の単位 option は segments 注記を持ち、選択すると id を保存する', () => withRows(async render => {
    const f = fixture([animator()]);
    const select = render(f.row('a1-basis'), f.snapshot()).children[1];
    assert.equal(select.children.find(option => option.value === '文節').title, 'v1 では words と同じ扱いです');
    select.value = '文節';
    select.emit('change');
    await settle();
    assert.equal(f.value()[0].basis, 'segments');
}));

test('DOM 小見出しは id と 3 ボタンを描画し、クリックで null を書く', () => withRows(async render => {
    const f = fixture([animator()]);
    const row = render(f.row('a1-heading'), f.snapshot());
    assert.equal(row.children[0].textContent, 'a1');
    assert.deepEqual(row.children[1].children.map(button => button.textContent), ['↑', '↓', '削除']);
    assert.deepEqual(row.children[1].children.map(button => button.disabled), [true, true, false]);
    row.children[1].children[2].emit('click');
    await settle();
    assert.equal(f.writes.at(-1).value, null);
}));
