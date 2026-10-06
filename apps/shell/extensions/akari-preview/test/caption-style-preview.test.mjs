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

test('複数選択の仮スタイルは source と output の両方へ同じフレームで届く', async () => {
    let paints = 0;
    const preview = createCaptionStylePreviewController(style => ({ '--caption-color': style.color }),
        async () => [], () => { paints++; });
    const ids = new Set(['spoken', 'placed']);
    await preview.receive({ captionId: 'spoken', captionIds: [...ids], textStyle: { color: '#ff0000' } });
    const source = preview.resolve({ id: 'part-1', sourceCueId: 'spoken', textStyle: {} }, ids);
    const output = preview.resolve({ id: 'placed', textStyle: {} }, ids);
    assert.equal(source.textStyleVars['--caption-color'], '#ff0000');
    assert.equal(output.textStyleVars['--caption-color'], '#ff0000');
    assert.equal(paints, 1);
    const stableSource = { id: 'part-2', sourceCueId: 'spoken', textStyle: {} };
    const stableOutput = { id: 'placed', textStyle: {} };
    const firstSource = preview.resolve(stableSource, ids);
    const firstOutput = preview.resolve(stableOutput, ids);
    assert.equal(preview.resolve(stableSource, ids), firstSource);
    assert.equal(preview.resolve(stableOutput, ids), firstOutput);
    await preview.receive({ captionId: 'spoken', textStyle: null, committed: true });
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, ids).textStyle.color, '#ff0000');
    preview.selectionChanged(new Set());
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.color, '#ff0000');
    preview.captionsUpdated([{ id: 'spoken', textStyle: {} }, { id: 'placed', textStyle: {} }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, ids).textStyle.color, '#ff0000');
    preview.captionsUpdated([{ id: 'spoken', textStyle: { color: '#ff0000' } },
        { id: 'placed', textStyle: { color: '#ff0000' } }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, ids).textStyle.color, undefined);
});

test('フォント待機中に確定しても仮スタイルを保存完了まで保つ', async () => {
    let release;
    const preview = createCaptionStylePreviewController(() => ({}),
        () => new Promise(resolve => { release = resolve; }), () => {});
    const pending = preview.receive({ captionId: 'placed',
        textStyle: { fontFamily: 'Example', color: '#ff0000' } });
    await preview.receive({ captionId: 'placed', textStyle: null, committed: true });
    release([]);
    await pending;
    preview.selectionChanged(new Set());
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.color, '#ff0000');
    preview.captionsUpdated([{ id: 'placed', textStyle: { font_family: 'Example', color: '#ff0000' } }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.color, undefined);
});

test('効果の削除指定は保存結果でプロパティが省略されたとき確定する', async () => {
    const preview = createCaptionStylePreviewController(() => ({}), async () => [], () => {});
    await preview.receive({ captionId: 'placed', textStyle: { color: '#ff0000', strokeInner: null } });
    await preview.receive({ captionId: 'placed', textStyle: null, committed: true });
    preview.captionsUpdated([{ id: 'placed', textStyle: { color: '#ff0000' } }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.color, undefined);
});

test('グラデーションの camelCase と保存後の snake_case が一致したら仮適用を外す', async () => {
    const preview = createCaptionStylePreviewController(() => ({}), async () => [], () => {});
    const gradient = { colors: ['#fb923c', '#f43f5e'], angleDeg: 90 };
    await preview.receive({ captionId: 'placed', textStyle: {
        fillGradient: gradient, fill_gradient: { colors: gradient.colors, angle_deg: 90 }
    } });
    await preview.receive({ captionId: 'placed', textStyle: null, committed: true });
    preview.captionsUpdated([{ id: 'placed', textStyle: {
        fill_gradient: { colors: [...gradient.colors], angle_deg: 90 }
    } }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.fill_gradient, undefined);
});

test('確定後の同じカードの再ホバーと leave は保存前の見た目を外さない', async () => {
    const preview = createCaptionStylePreviewController(() => ({}), async () => [], () => {});
    const style = { fill_gradient: { colors: ['#fb923c', '#f43f5e'], angle_deg: 90 } };
    await preview.receive({ captionId: 'placed', textStyle: style });
    await preview.receive({ captionId: 'placed', textStyle: null, committed: true });
    await preview.receive({ captionId: 'placed', textStyle: {
        fill_gradient: { colors: [...style.fill_gradient.colors], angle_deg: 90 }
    } });
    await preview.receive({ captionId: 'placed', textStyle: null });
    preview.captionsUpdated([{ id: 'placed', textStyle: {} }]);
    assert.deepEqual(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.fill_gradient,
        style.fill_gradient);
    preview.captionsUpdated([{ id: 'placed', textStyle: {
        fill_gradient: { colors: [...style.fill_gradient.colors], angle_deg: 90 }
    } }]);
    assert.equal(preview.resolve({ id: 'placed', textStyle: {} }, new Set()).textStyle.fill_gradient, undefined);
});

test('失敗通知、選択変更、二度の不一致更新、時間上限で確定後の仮適用を解除する', async () => {
    const make = async (timeout = 20) => {
        const preview = createCaptionStylePreviewController(() => ({}), async () => [], () => {}, undefined, timeout);
        await preview.receive({ captionId: 'placed', textStyle: { color: '#ff0000' } });
        await preview.receive({ captionId: 'placed', textStyle: null, committed: true });
        return preview;
    };
    const cue = { id: 'placed', textStyle: {} };
    const failure = await make();
    await failure.receive({ captionId: 'placed', textStyle: null, failed: true });
    assert.equal(failure.resolve(cue, new Set()).textStyle.color, undefined);
    const changed = await make();
    changed.selectionChanged(new Set(['other']));
    assert.equal(changed.resolve(cue, new Set()).textStyle.color, undefined);
    const deselected = await make(100);
    deselected.selectionChanged(new Set());
    await new Promise(resolve => setTimeout(resolve, 55));
    assert.equal(deselected.resolve(cue, new Set()).textStyle.color, undefined);
    const unmatched = await make();
    unmatched.captionsUpdated([{ id: 'placed', textStyle: {} }]);
    assert.equal(unmatched.resolve(cue, new Set()).textStyle.color, '#ff0000');
    unmatched.captionsUpdated([{ id: 'placed', textStyle: {} }]);
    assert.equal(unmatched.resolve(cue, new Set()).textStyle.color, undefined);
    const timeout = await make();
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(timeout.resolve(cue, new Set()).textStyle.color, undefined);
});

test('ホスト通知と webview の字幕再描画口が接続されている', () => {
    const source = readHandlerSource();
    assert.match(source, /listen\(window, 'akari-caption-panel-preview', onCaptionPanelPreview\)/u);
    assert.match(source, /type: 'akari-preview-caption-style-preview'/u);
    assert.match(source, /caption = captionStylePreview\.resolve\(caption, selectedCaptionIds\)/u);
    assert.match(source, /captionStylePreview\.captionsUpdated\(nextCaptions\);[\s\S]*?renderCaption\(\)/u);
    assert.equal(typeof vm.runInNewContext(`(${createCaptionStylePreviewController.toString()})`), 'function');
});
