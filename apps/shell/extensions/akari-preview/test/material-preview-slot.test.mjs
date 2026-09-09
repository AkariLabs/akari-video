import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as slotRules from '../lib/common/material-preview-slot.js';
import {
    chooseRestoredMaterialPreviewSurvivor,
    decideMaterialSlotAction,
    isMaterialPreviewWidgetId,
    isSameMaterialUri
} from '../lib/common/material-preview-slot.js';

const occupant = (id, overrides = {}) => ({ id, disposed: false, attached: true, ...overrides });

test('初回は席に追加する', () => {
    assert.deepEqual(decideMaterialSlotAction(undefined, { id: 'akari-image-a' }), { kind: 'add' });
});

test('同一 URI の同じ widget を再オープンすると reveal', () => {
    const current = occupant('akari-image-a', { uri: 'file:///a.png' });
    assert.deepEqual(decideMaterialSlotAction(current, { id: current.id }), { kind: 'reveal' });
});

test('別 URI の同種素材は旧 widget を置き換える', () => {
    assert.deepEqual(decideMaterialSlotAction(occupant('akari-image-a'), { id: 'akari-image-b' }),
        { kind: 'replace', closeId: 'akari-image-a' });
});

test('別種別の素材も同じ席を置き換える', () => {
    assert.deepEqual(decideMaterialSlotAction(occupant('akari-image-a'), { id: 'akari-audio-b' }),
        { kind: 'replace', closeId: 'akari-image-a' });
});

test('dispose 済みの席には追加する', () => {
    assert.deepEqual(decideMaterialSlotAction(occupant('akari-image-a', { disposed: true }),
        { id: 'akari-image-a' }), { kind: 'add' });
});

test('未 attach の席には追加する', () => {
    assert.deepEqual(decideMaterialSlotAction(occupant('akari-image-a', { attached: false }),
        { id: 'akari-audio-b' }), { kind: 'add' });
});

test('複数復元した場合は登録順の最後だけを残す', () => {
    const registered = ['akari-preview-a', 'akari-image-b', 'akari-audio-c'].map(id => occupant(id));
    assert.deepEqual(chooseRestoredMaterialPreviewSurvivor(registered), {
        keepId: 'akari-audio-c', closeIds: ['akari-preview-a', 'akari-image-b']
    });
});

test('復元対象の dispose 済みと未 attach は除外する', () => {
    assert.deepEqual(chooseRestoredMaterialPreviewSurvivor([
        occupant('akari-image-a'), occupant('akari-image-b', { disposed: true }),
        occupant('akari-audio-c', { attached: false })
    ]), { keepId: 'akari-image-a', closeIds: [] });
    assert.deepEqual(chooseRestoredMaterialPreviewSurvivor([]), { closeIds: [] });
    assert.deepEqual(chooseRestoredMaterialPreviewSurvivor([
        occupant('akari-image-a', { disposed: true })
    ]), { closeIds: [] });
});

test('素材の 5 接頭辞だけを受け付け、出力とエディタは除外する', () => {
    for (const prefix of ['akari-preview-', 'akari-image-', 'akari-audio-',
        'akari-fragment-preview-', 'akari-font-specimen-']) {
        assert.equal(isMaterialPreviewWidgetId(`${prefix}abc`), true);
    }
    for (const id of ['akari-output-preview-abc', 'monaco-editor-abc', 'code-editor-opener:file:///a.ts', '']) {
        assert.equal(isMaterialPreviewWidgetId(id), false);
    }
});

test('URI は両方が文字列で厳密一致の場合のみ同一', () => {
    assert.equal(isSameMaterialUri('file:///a.png', 'file:///a.png'), true);
    assert.equal(isSameMaterialUri('file:///a.png', 'file:///b.png'), false);
    assert.equal(isSameMaterialUri('file:///a.png', 'file:///A.png'), false);
    assert.equal(isSameMaterialUri(undefined, undefined), false);
    assert.equal(isSameMaterialUri('file:///a.png', undefined), false);
    assert.equal(isSameMaterialUri(undefined, 'file:///a.png'), false);
});

function restoreFixture() {
    const timers = new Map();
    let timerId = 0;
    const exports = {};
    // コンパイル済みの席管理を実行し、Theia の DI と時間だけを置き換える。
    vm.runInNewContext(readFileSync(new URL('../lib/browser/material-preview-slot.js', import.meta.url), 'utf8'), {
        exports,
        require: name => {
            if (name === '@theia/core/lib/browser') return { ApplicationShell: class {} };
            if (name === '@theia/core/shared/inversify') return { inject: () => () => {}, injectable: () => () => {} };
            if (name === '../common/material-preview-slot') return slotRules;
            throw new Error(`Unexpected dependency: ${name}`);
        },
        setTimeout: (callback, delay) => {
            assert.equal(delay, 300);
            timers.set(++timerId, callback);
            return timerId;
        },
        clearTimeout: id => timers.delete(id)
    });
    const slot = new exports.MaterialPreviewSlot();
    slot.shell = { async addWidget(widget) { widget.isAttached = true; } };
    const widget = id => {
        const hooks = [];
        return {
            id, isAttached: false, isDisposed: false, closeCount: 0,
            disposed: { connect: hook => hooks.push(hook) },
            close() {
                this.closeCount++;
                this.isDisposed = true;
                this.isAttached = false;
                hooks.forEach(hook => hook());
            }
        };
    };
    const tick = () => {
        assert.equal(timers.size, 1, '保留するスイープは常に 1 回');
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        callback();
    };
    return { slot, widget, tick, timers };
}

test('復元 attach が遅れても再試行で登録順の最後だけを残す', () => {
    const { slot, widget, tick, timers } = restoreFixture();
    const first = widget('akari-image-a'), last = widget('akari-audio-b');
    slot.register(first);
    slot.register(last);
    tick();
    assert.equal(slot.registered.length, 2);
    first.isAttached = true;
    tick();
    assert.equal(first.closeCount, 0);
    last.isAttached = true;
    tick();
    assert.equal(first.closeCount, 1);
    assert.equal(last.closeCount, 0);
    assert.equal(slot.current, last);
    assert.equal(slot.registered.length, 0);
    assert.equal(slot.restoreAttempts, 0);
    assert.equal(timers.size, 0);
});

test('生存 1 件は 10 回目で確定し、未 attach の登録も破棄する', () => {
    const { slot, widget, tick, timers } = restoreFixture();
    const live = widget('akari-image-a'), pending = widget('akari-audio-b');
    live.isAttached = true;
    slot.register(live);
    slot.register(pending);
    for (let attempt = 1; attempt < 10; attempt++) {
        tick();
        assert.equal(slot.current, undefined);
        assert.equal(slot.registered.length, 2);
    }
    tick();
    assert.equal(slot.current, live);
    assert.equal(live.closeCount, 0);
    assert.equal(pending.closeCount, 0);
    assert.equal(slot.registered.length, 0);
    assert.equal(slot.restoreAttempts, 0);
    assert.equal(timers.size, 0);
});

test('全件未 attach でも 10 回で停止する', () => {
    const { slot, widget, tick, timers } = restoreFixture();
    slot.register(widget('akari-image-a'));
    for (let attempt = 0; attempt < 10; attempt++) tick();
    assert.equal(timers.size, 0);
    assert.equal(slot.current, undefined);
    assert.equal(slot.registered.length, 0);
    assert.equal(slot.restoreAttempts, 0);
});

test('全件 dispose 済みなら再試行せず終了する', () => {
    const { slot, widget, tick, timers } = restoreFixture();
    const item = widget('akari-image-a');
    slot.register(item);
    item.close();
    tick();
    assert.equal(timers.size, 0);
    assert.equal(slot.restoreAttempts, 0);
});

test('claim は再試行と登録を捨て、次の復元は新しい回数で始まる', async () => {
    const { slot, widget, tick, timers } = restoreFixture();
    const restored = widget('akari-image-a');
    slot.register(restored);
    for (let attempt = 0; attempt < 9; attempt++) tick();
    const selected = widget('akari-audio-b');
    await slot.claim(selected, 'file:///b.wav');
    assert.equal(timers.size, 0);
    assert.equal(slot.current, selected);
    assert.equal(slot.registered.length, 0);
    assert.equal(slot.restoreAttempts, 0);
    assert.equal(restored.closeCount, 0);
    slot.register(widget('akari-image-c'));
    tick();
    assert.equal(timers.size, 1);
    assert.equal(slot.restoreAttempts, 1);
    await slot.claim(selected, 'file:///b.wav');
    assert.equal(timers.size, 0);
});
