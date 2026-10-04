import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createCaptionStylePreviewController } from '../lib/common/caption-style-preview.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const cue = { id: 'fragment-1', sourceCueId: 'c-0001', textStyle: {
    color: '#ffffff', background: { color: '#000000', opacity: 0.6 },
    stroke: { color: '#222222', width_px: 2 }
}, textStyleVars: { '--caption-color': '#ffffff' } };

test('一時スタイルは選択中の 1 cue にマージして同じ描画口へ渡す', async () => {
    const resolved = [];
    let paints = 0;
    const preview = createCaptionStylePreviewController((style, output) => {
        resolved.push({ style, output });
        return { '--caption-color': style.color, '--plate-bg': style.background.color };
    }, async () => [], () => { paints++; }, { width: 1920, height: 1080 });
    await preview.receive({ captionId: 'c-0001', textStyle: { color: '#ff0000',
        background: { color: '#ffee00' }, stroke: { widthPx: 4 } } });
    const result = preview.resolve(cue, 'c-0001');
    assert.equal(result.textStyle.background.opacity, 0.6);
    assert.equal(result.textStyle.stroke.color, '#222222');
    assert.equal(result.textStyle.stroke.width_px, 4);
    assert.equal(result.textStyleVars['--plate-bg'], '#ffee00');
    assert.equal(preview.resolve(cue, 'c-0001'), result);
    assert.equal(preview.resolve(cue, 'other'), cue);
    assert.equal(preview.resolve({ ...cue, sourceCueId: 'c-0002' }, 'c-0001').sourceCueId, 'c-0002');
    assert.equal(resolved.length, 1);
    assert.equal(paints, 1);
});

test('フォント読み込みを待ち、離脱・選択変更・閉じる・確定更新で解除する', async () => {
    let release;
    let paints = 0;
    const preview = createCaptionStylePreviewController(() => ({}), () => new Promise(resolve => { release = resolve; }),
        () => { paints++; });
    const pending = preview.receive({ captionId: 'c-0001', textStyle: { fontFamily: 'Klee One' } });
    assert.equal(preview.resolve(cue, 'c-0001'), cue);
    preview.selectionChanged('c-0002');
    release([]);
    await pending;
    assert.equal(preview.resolve(cue, 'c-0001'), cue);
    await preview.receive({ captionId: 'c-0001', textStyle: { color: '#ff0000' } });
    await preview.receive({ captionId: 'c-0001', textStyle: null });
    assert.equal(preview.resolve(cue, 'c-0001'), cue);
    await preview.receive({ captionId: 'c-0001', textStyle: { color: '#00ff00' } });
    await preview.receive({ captionId: '', textStyle: null });
    assert.equal(preview.resolve(cue, 'c-0001'), cue);
    await preview.receive({ captionId: 'c-0001', textStyle: { color: '#0000ff' } });
    await preview.receive({ captionId: 'c-0001', textStyle: null, committed: true });
    assert.notEqual(preview.resolve(cue, 'c-0001'), cue);
    const beforeUpdatePaints = paints;
    preview.captionsUpdated();
    assert.equal(paints, beforeUpdatePaints);
    assert.equal(preview.resolve(cue, 'c-0001'), cue);
});

test('ホスト通知と webview の字幕再描画口が接続されている', () => {
    const source = readHandlerSource();
    assert.match(source, /listen\(window, 'akari-caption-panel-preview', onCaptionPanelPreview\)/u);
    assert.match(source, /type: 'akari-preview-caption-style-preview'/u);
    assert.match(source, /caption = captionStylePreview\.resolve\(caption, selectedCaptionId\)/u);
    assert.match(source, /captionStylePreview\.captionsUpdated\(\);[\s\S]*?renderCaption\(\)/u);
    assert.equal(typeof vm.runInNewContext(`(${createCaptionStylePreviewController.toString()})`), 'function');
});
