import assert from 'node:assert/strict';
import test from 'node:test';

import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';

function historyEntry(label, calls = []) {
    return {
        label,
        undo: async () => { calls.push(`undo:${label}`); },
        redo: async () => { calls.push(`redo:${label}`); }
    };
}

function keydownEvent(overrides = {}) {
    let prevented = false;
    let stopped = false;
    return {
        key: 'z',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        target: null,
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; },
        get prevented() { return prevented; },
        get stopped() { return stopped; },
        ...overrides
    };
}

async function flushPromises() {
    await new Promise(resolve => setImmediate(resolve));
}

test('push すると履歴が積まれ canUndo が true になる', () => {
    const service = new AkariEditHistoryService();
    const entry = historyEntry('字幕編集');

    assert.equal(service.push(entry), entry);
    assert.equal(service.canUndo, true);
    assert.equal(service.canRedo, false);
});

test('undo は最新の履歴から LIFO 順で実行する', async () => {
    const service = new AkariEditHistoryService();
    const calls = [];
    service.push(historyEntry('古い編集', calls));
    service.push(historyEntry('新しい編集', calls));

    await service.undo();

    assert.deepEqual(calls, ['undo:新しい編集']);
});

test('redo は undo 直後の履歴をやり直す', async () => {
    const service = new AkariEditHistoryService();
    const calls = [];
    service.push(historyEntry('クリップ移動', calls));

    await service.undo();
    await service.redo();

    assert.deepEqual(calls, ['undo:クリップ移動', 'redo:クリップ移動']);
});

test('undo 後の新しい push は redo 履歴を破棄する', async () => {
    const service = new AkariEditHistoryService();
    service.push(historyEntry('最初の編集'));
    await service.undo();
    assert.equal(service.canRedo, true);

    service.push(historyEntry('別の編集'));

    assert.equal(service.canRedo, false);
});

test('履歴が 50 件を超えると最古の entry が落ちる', async () => {
    const service = new AkariEditHistoryService();
    const calls = [];
    for (let index = 0; index < 51; index += 1) {
        service.push(historyEntry(String(index), calls));
    }

    for (let index = 0; index < 50; index += 1) {
        await service.undo();
    }

    assert.equal(calls.length, 50);
    assert.equal(calls.includes('undo:0'), false);
    assert.equal(calls[49], 'undo:1');
    assert.equal(service.canUndo, false);
});

test('isTop は最新 entry の同一参照だけを true にする', async () => {
    const service = new AkariEditHistoryService();
    const older = historyEntry('古い編集');
    const latest = historyEntry('新しい編集');

    assert.equal(service.isTop(latest), false);
    service.push(older);
    service.push(latest);
    assert.equal(service.isTop(older), false);
    assert.equal(service.isTop(latest), true);
    await service.undo();
    assert.equal(service.isTop(latest), false);
    assert.equal(service.isTop(older), true);
});

test('undo 対象がないときは何もせず完了する', async () => {
    const service = new AkariEditHistoryService();

    await assert.doesNotReject(() => service.undo());
    assert.equal(service.canUndo, false);
    assert.equal(service.canRedo, false);
});

test('redo 対象がないときは何もせず完了する', async () => {
    const service = new AkariEditHistoryService();

    await assert.doesNotReject(() => service.redo());
    assert.equal(service.canUndo, false);
    assert.equal(service.canRedo, false);
});

test('canUndo と canRedo は push・undo・redo に追従する', async () => {
    const service = new AkariEditHistoryService();
    assert.deepEqual([service.canUndo, service.canRedo], [false, false]);

    service.push(historyEntry('編集'));
    assert.deepEqual([service.canUndo, service.canRedo], [true, false]);
    await service.undo();
    assert.deepEqual([service.canUndo, service.canRedo], [false, true]);
    await service.redo();
    assert.deepEqual([service.canUndo, service.canRedo], [true, false]);
});

test('onDidChange は push の完了時に発火する', () => {
    const service = new AkariEditHistoryService();
    let changes = 0;
    service.onDidChange(() => { changes += 1; });

    service.push(historyEntry('編集'));

    assert.equal(changes, 1);
});

test('onDidChange は undo と redo の完了時に 1 回ずつ発火する', async () => {
    const service = new AkariEditHistoryService();
    service.push(historyEntry('編集'));
    let changes = 0;
    service.onDidChange(() => { changes += 1; });

    await service.undo();
    await service.redo();

    assert.equal(changes, 2);
});

test('entry.undo が reject すると undo も reject し future へ積まない', async () => {
    const service = new AkariEditHistoryService();
    const error = new Error('undo failed');
    service.push({
        label: '失敗する編集',
        undo: async () => { throw error; },
        redo: async () => undefined
    });
    let changes = 0;
    service.onDidChange(() => { changes += 1; });

    await assert.rejects(service.undo(), error);

    assert.equal(service.canUndo, false);
    assert.equal(service.canRedo, false);
    assert.equal(changes, 1);
});

test('entry.redo が reject すると redo も reject し past へ積まない', async () => {
    const service = new AkariEditHistoryService();
    const error = new Error('redo failed');
    service.push({
        label: '失敗する編集',
        undo: async () => undefined,
        redo: async () => { throw error; }
    });
    await service.undo();

    await assert.rejects(service.redo(), error);

    assert.equal(service.canUndo, false);
    assert.equal(service.canRedo, false);
});

test('onDidExecute は成功時に kind と entry を通知する', async () => {
    const service = new AkariEditHistoryService();
    const entry = historyEntry('編集');
    const executions = [];
    const order = [];
    service.onDidExecute(execution => {
        executions.push(execution);
        order.push('execute');
    });
    service.onDidChange(() => order.push('change'));
    service.push(entry);
    order.length = 0;

    await service.undo();
    await service.redo();

    assert.deepEqual(executions, [
        { kind: 'undo', entry },
        { kind: 'redo', entry }
    ]);
    assert.deepEqual(order, ['execute', 'change', 'execute', 'change']);
});

test('onDidExecute は失敗時に error を付けて通知する', async () => {
    const service = new AkariEditHistoryService();
    const error = new Error('undo failed');
    const entry = {
        label: '編集',
        undo: async () => { throw error; },
        redo: async () => undefined
    };
    const executions = [];
    service.onDidExecute(execution => executions.push(execution));
    service.push(entry);

    await assert.rejects(service.undo(), error);

    assert.deepEqual(executions, [{ kind: 'undo', entry, error }]);
});

test('keydown は ⌘Z・⌘⇧Z を処理し、編集中の要素では何もしない', async () => {
    const service = new AkariEditHistoryService();
    const calls = [];
    service.undo = async () => { calls.push('undo'); };
    service.redo = async () => { calls.push('redo'); };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

    try {
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { activeElement: null }
        });
        const undoEvent = keydownEvent();
        service.handleKeydown(undoEvent);
        const redoEvent = keydownEvent({ shiftKey: true });
        service.handleKeydown(redoEvent);
        await flushPromises();

        assert.deepEqual(calls, ['undo', 'redo']);
        assert.deepEqual(
            [undoEvent.prevented, undoEvent.stopped, redoEvent.prevented, redoEvent.stopped],
            [true, true, true, true]
        );

        for (const target of [
            { tagName: 'INPUT', type: 'text' },
            { tagName: 'TEXTAREA' },
            { tagName: 'DIV', isContentEditable: true }
        ]) {
            const editableEvent = keydownEvent({ target });
            service.handleKeydown(editableEvent);
            assert.equal(editableEvent.prevented, false);
        }
        globalThis.document.activeElement = { tagName: 'INPUT', type: 'text' };
        const focusedInputEvent = keydownEvent();
        service.handleKeydown(focusedInputEvent);
        await flushPromises();

        assert.equal(focusedInputEvent.prevented, false);
        assert.deepEqual(calls, ['undo', 'redo']);
    } finally {
        if (originalDocument) {
            Object.defineProperty(globalThis, 'document', originalDocument);
        } else {
            delete globalThis.document;
        }
    }
});
