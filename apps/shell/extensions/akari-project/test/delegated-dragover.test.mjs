import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LIBRARY_DRAG_MIME,
    MATERIAL_DRAG_MIME,
    isDelegatedDragOverInput,
    isDelegatedDropInput,
    isOsFileDropInput
} from '../lib/common/delegated-drop.js';

// task 2026-09-23-finder-drop-frame: dragover だけ素材パネルへ Files を通し、
// drop の委譲規約と内部 MIME の取り込み除外は維持する。
test('Files だけを OS ファイル受け口の内側へドラッグすると委譲する', () => {
    const input = { insideDropzone: true, insideOsFileDropTarget: true, types: ['Files'] };
    assert.equal(isDelegatedDragOverInput(input), true);
    assert.equal(isDelegatedDropInput(input), false, '動画の drop はグローバル経路に残す');
});

test('内部 MIME と Files が同乗しても OS ファイルとしては委譲しない', () => {
    for (const mime of [MATERIAL_DRAG_MIME, LIBRARY_DRAG_MIME]) {
        const input = { insideDropzone: true, insideOsFileDropTarget: true, types: ['Files', mime] };
        assert.equal(isOsFileDropInput(input.types), false, mime);
        assert.equal(isDelegatedDragOverInput(input), isDelegatedDropInput(input), mime);
    }
});

test('内部 MIME だけなら従来の委譲判定に従う', () => {
    for (const mime of [MATERIAL_DRAG_MIME, LIBRARY_DRAG_MIME]) {
        const input = { insideDropzone: true, insideOsFileDropTarget: false, types: [mime] };
        assert.equal(isDelegatedDragOverInput(input), isDelegatedDropInput(input), mime);
        assert.equal(isDelegatedDragOverInput(input), true, mime);
    }
});

test('タイムラインなど OS ファイルを受けない dropzone は Files だけを委譲しない', () => {
    assert.equal(isDelegatedDragOverInput({
        insideDropzone: true, insideOsFileDropTarget: false, types: ['Files']
    }), false);
});

test('dropzone の外は Files だけを委譲しない', () => {
    assert.equal(isDelegatedDragOverInput({
        insideDropzone: false, insideOsFileDropTarget: false, types: ['Files']
    }), false);
    assert.equal(isDelegatedDragOverInput({
        insideDropzone: false, insideOsFileDropTarget: true, types: ['Files']
    }), false);
});
