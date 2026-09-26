import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionContextPreset, captionStyleWrite, contextCaptionId, runCaptionStyleWrite } from '../lib/common/caption-context-edit.js';
import { ContextBarController } from '../lib/browser/context-bar-controller.js';

test('字幕の各操作は既存の inspector write 種類へ写る', () => {
    const fields = {
        color: 'caption-style-color', strokeColor: 'caption-style-stroke-color',
        strokeWidth: 'caption-style-stroke-width', backgroundColor: 'caption-style-bg-color',
        backgroundOpacity: 'caption-style-bg-opacity', fontFamily: 'caption-style-font-family',
        sizePx: 'caption-style-size', lineHeight: 'caption-style-line-height',
        letterSpacingEm: 'caption-style-letter-spacing', weight: 'caption-style-font-weight'
    };
    for (const [field, kind] of Object.entries(fields)) {
        assert.equal(captionStyleWrite('cue-1', field, field.includes('Color') || field === 'color' ? '#ffffff' : 1).kind, kind);
    }
    assert.equal(captionStyleWrite('cue-1', 'unknown', 1), undefined);
    assert.deepEqual(captionStyleWrite('cue-1', 'sizePx', 48, ['cue-1', 'cue-2', 'cue-2']).targets,
        [{ kind: 'caption', id: 'cue-1' }, { kind: 'caption', id: 'cue-2' }]);
});

test('字幕 1 つでも複数でも 1 操作の書き込みは 1 回', async () => {
    for (const ids of [['cue-1'], ['cue-1', 'cue-2']]) {
        for (const field of ['color', 'strokeColor', 'strokeWidth', 'backgroundColor', 'backgroundOpacity',
            'fontFamily', 'sizePx', 'lineHeight', 'letterSpacingEm', 'weight']) {
            const calls = [];
            const value = ['color', 'strokeColor', 'backgroundColor'].includes(field) ? '#ffffff'
                : field === 'fontFamily' ? 'sans-serif' : 1;
            const result = await runCaptionStyleWrite('cue-1', field, value, ids,
                async operation => { calls.push(operation); return { ok: true }; });
            assert.equal(result.ok, true);
            assert.equal(calls.length, 1, field);
        }
    }
});

test('プリセットは既存の書き込み口を 1 回呼び、履歴 1 手で元へ戻る', async () => {
    let source = 'before';
    const calls = [];
    const history = [];
    const result = await applyCaptionContextPreset('cue-1', 'subtitle-standard', ['cue-1', 'cue-2'], {
        readSource: async () => source,
        setPreset: async (ids, presetId) => { calls.push({ ids, presetId }); source = 'after'; return { changed: 2 }; },
        writeSource: async value => { source = value; },
        recordHistory: entry => history.push(entry),
        reload: async () => undefined
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{ ids: ['cue-1', 'cue-2'], presetId: 'subtitle-standard' }]);
    assert.equal(history.length, 1);
    await history[0].undo();
    assert.equal(source, 'before');
    await history[0].redo();
    assert.equal(source, 'after');
});

test('字幕選択が state と書き込み指示の対象 id へ届く', async () => {
    const writes = [];
    const source = { editUri: 'file:///edit.json', doc: { version: 2, output: { width: 1920, height: 1080 }, tracks: [] },
        selectedId: undefined, caption: { id: 'cue-1', textStyle: { color: '#ffffff' } },
        multi: 0, fps: 30, playhead: 1, sourcePath: () => undefined };
    const controller = new ContextBarController({
        widget: () => ({ contextBarSource: () => source }),
        selectionModel: { selectedCaptionIds: ['cue-1'], requestWrite: async operation => {
            writes.push(operation); return { ok: true };
        } }
    });
    assert.equal(controller.state().kind, 'caption');
    assert.equal(controller.state().selectedId, 'cue-1');
    assert.deepEqual(controller.state().item, { textStyle: { color: '#ffffff' } });
    assert.equal((await controller.runOnce({ action: 'captionStyle', field: 'color', value: '#f26666' })).ok, true);
    assert.deepEqual(writes, [{ kind: 'caption-style-color', id: 'cue-1', value: '#f26666' }]);
    source.caption.textStyle = undefined;
    assert.deepEqual(controller.state().item, { textStyle: {} });
});

test('インスペクターの字幕スナップショットを優先し、文字の袋は字幕と誤認しない', () => {
    assert.equal(contextCaptionId({ kind: 'item', id: 'captions' }, { kind: 'caption', id: 'c-0001' }), 'c-0001');
    assert.equal(contextCaptionId({ kind: 'item', id: 'captions' }, { kind: 'item', id: 'captions' }), undefined);
});
