import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { normalizePreviewEmphasisWords } from '../lib/browser/preview-emphasis-words.js';
import { harness } from './caption-animator-webview-harness.mjs';

const require = createRequire(import.meta.url);
const { resolveCaptionStylePreset, resolveCaptionWordStyleVars, TEXTSTYLE_CATALOG } =
    require('../../../../../packages/edit-store/lib/index.js');
const output = { width: 1920, height: 1080 };
const emphasis = {
    id: 'e-0001', src: 'camera-a', t_start: 0, t_end: 1,
    word: '最高', emotion: 'neutral', style_preset: 'neon'
};

test('通常プレビューの正規化はプリセット ID と書き出しと同じ語 CSS 変数を保持する', () => {
    const [word] = normalizePreviewEmphasisWords([emphasis], output);
    const resolved = resolveCaptionStylePreset({ style_preset: 'neon' }, TEXTSTYLE_CATALOG);
    assert.equal(word.src, 'camera-a');
    assert.equal(word.style_preset, 'neon');
    assert.deepEqual(word._presetStyleVars, resolveCaptionWordStyleVars(resolved.record.text_style, output));
    assert.equal(word._presetStyleVars['--caption-tok-font-size'], '120px');
    assert.equal(word._presetStyleVars['--caption-tok-color'], '#aefcff');
    assert.ok(word._presetStyleVars['--caption-tok-text-shadow'].includes('rgba(0,229,255,'));
});

test('字幕の大きさを継ぐ強調は語の固定 px を運ばず効果を比で運ぶ', () => {
    const [word] = normalizePreviewEmphasisWords([{
        ...emphasis, emotion: undefined, inherit_caption_size: true
    }], output);
    const resolved = resolveCaptionStylePreset({ style_preset: 'neon' }, TEXTSTYLE_CATALOG);
    assert.equal(word.emotion, 'emphasis');
    assert.equal(word.inherit_caption_size, true);
    assert.equal(word._presetStyleVars['--caption-tok-font-size'], undefined);
    assert.deepEqual(word._presetStyleVars,
        resolveCaptionWordStyleVars(resolved.record.text_style, output, true));
});

test('通常プレビューは解決済みのネオンを語に当て、未知の ID は従来の強調へ戻す', () => {
    const cue = { id: 'c-0001', start: 0, end: 2, text: '最高', style: 'pop',
        words: [{ text: '最高', start: 0, end: 1 }] };
    const words = normalizePreviewEmphasisWords([emphasis], output);
    const view = harness({ cues: [cue], emphasisWords: words, output });
    view.tick(0.5);
    assert.match(view.plate.innerHTML, /akari-caption__tok--preset/u);
    assert.match(view.plate.innerHTML, /data-emphasis-preset="neon"/u);
    assert.match(view.plate.innerHTML, /--caption-tok-font-size:120px/u);
    assert.match(view.plate.innerHTML, /--caption-tok-text-shadow:/u);

    const [unknown] = normalizePreviewEmphasisWords([{ ...emphasis, style_preset: 'missing' }], output);
    assert.equal(unknown.style_preset, 'missing');
    assert.equal(unknown._presetStyleVars, undefined);
    const fallback = harness({ cues: [cue], emphasisWords: [unknown], output });
    fallback.tick(0.5);
    assert.match(fallback.plate.innerHTML, /akari-caption__tok--color-accent/u);
});

test('プリセットのない強調だけでは語プリセット CSS を追加しない', () => {
    const cue = { id: 'c-0001', start: 0, end: 2, text: '最高', style: 'pop',
        words: [{ text: '最高', start: 0, end: 1 }] };
    const [word] = normalizePreviewEmphasisWords([{ ...emphasis, style_preset: undefined }], output);
    assert.equal(word._presetStyleVars, undefined);
    const view = harness({ cues: [cue], emphasisWords: [word], output });
    view.tick(0.5);
    assert.match(view.plate.innerHTML, /akari-caption__tok--color-accent/u);
    assert.doesNotMatch(view.plate.innerHTML, /\.akari-caption__tok--preset\{/u);
});
