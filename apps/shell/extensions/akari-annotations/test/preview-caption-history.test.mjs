import assert from 'node:assert/strict';
import test from 'node:test';

import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';
import { previewCaptionWrite } from '../../akari-preview/lib/common/preview-caption-write.js';

function fixture() {
    const before = '{"captions":[]}\r\n';
    const after = '{"captions":[{"id":"c1"}]}\n';
    const change = previewCaptionWrite('file:///project/edit.json', 'file:///project/captions.json', before, after, '字幕を移動');
    const history = new AkariEditHistoryService();
    let disk = after;
    const writes = [];
    const entry = history.pushPreviewCaptionWrite(change, {
        read: async () => disk,
        write: async (entry, content) => {
            assert.equal(entry, change);
            disk = content;
            writes.push(content);
        }
    });
    return { before, after, entry, history, writes, get disk() { return disk; }, set disk(value) { disk = value; } };
}

test('one preview operation is one history entry with byte-exact undo and redo', async () => {
    const f = fixture();
    assert.equal(f.history.canUndo, true);
    await f.history.undo();
    assert.equal(f.disk, f.before);
    await f.history.redo();
    assert.equal(f.disk, f.after);
    assert.deepEqual(f.writes, [f.before, f.after]);
});

test('an intervening write rejects undo, reports one failed execution, and consumes the entry', async () => {
    const f = fixture();
    const executions = [];
    f.history.onDidExecute(execution => executions.push(execution));
    f.disk = 'external edit\n';
    await assert.rejects(f.history.undo(), /字幕ファイルが後から変更されています/);
    assert.equal(f.disk, 'external edit\n');
    assert.deepEqual(f.writes, []);
    assert.equal(f.history.canUndo, false);
    assert.equal(f.history.canRedo, false);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].kind, 'undo');
    assert.equal(executions[0].entry, f.entry);
    assert.match(executions[0].error.message, /字幕ファイルが後から変更されています/);
});

test('an intervening write rejects redo, reports one failed execution, and consumes the entry', async () => {
    const f = fixture();
    await f.history.undo();
    const executions = [];
    f.history.onDidExecute(execution => executions.push(execution));
    f.disk = 'external edit\n';
    await assert.rejects(f.history.redo(), /字幕ファイルが後から変更されています/);
    assert.equal(f.disk, 'external edit\n');
    assert.deepEqual(f.writes, [f.before]);
    assert.equal(f.history.canUndo, false);
    assert.equal(f.history.canRedo, false);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].kind, 'redo');
    assert.equal(executions[0].entry, f.entry);
    assert.match(executions[0].error.message, /字幕ファイルが後から変更されています/);
});
