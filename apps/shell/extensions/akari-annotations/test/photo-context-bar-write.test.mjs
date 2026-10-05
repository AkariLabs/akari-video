import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextBarController } from '../lib/browser/context-bar-controller.js';

test('photo frame fields use the inspector item-field writer once per change', async () => {
    const writes = [];
    const source = { editUri: 'file:///edit.json', selectedId: 'photo-1',
        doc: { version: 2, output: { width: 1920, height: 1080 }, tracks: [
            { id: 'v', lane: 'visual', items: [{ id: 'photo-1', source: { kind: 'media', src: 'photo' } }] }
        ] }, sourcePath: () => 'photo.png', fps: 30, playhead: 0, multi: 0 };
    const controller = new ContextBarController({
        widget: () => ({ contextBarSource: () => source }),
        selectionModel: { requestWrite: async operation => { writes.push(operation); return { ok: true }; } }
    });
    for (const [path, value] of [['frame.cornerRadius', 40], ['frame.stroke.width', 8], ['frame.stroke.color', '#123456']]) {
        assert.equal((await controller.runOnce({ action: 'write', path, value })).ok, true, path);
    }
    assert.deepEqual(writes, [
        { kind: 'item-field', id: 'photo-1', path: 'frame.cornerRadius', value: 40 },
        { kind: 'item-field', id: 'photo-1', path: 'frame.stroke.width', value: 8 },
        { kind: 'item-field', id: 'photo-1', path: 'frame.stroke.color', value: '#123456' }
    ]);
});
