import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parsePreviewCaptions } = require('../lib/browser/akari-preview-captions.js');

const caption = {
    id: 'c-0001',
    start: 0,
    end: 2,
    text: '字幕',
    speaker: null,
    sourceRef: { segment: 0 },
    edited: false
};

test('配列ルートを従来どおり読み text_style 不在なら id 以外の追加キーを持たない', () => {
    // ㉓ 字幕クリック選択+移動の書き戻し（captions.json text_style.zone）に caption を
    // 一意に特定する id が必要になったため、id は複製対象へ追加された
    // （akari-preview-captions.ts PreviewCaption）。他のフィールドは変更なし。
    const [parsed] = parsePreviewCaptions(JSON.stringify([caption]));
    assert.deepEqual(parsed, { id: 'c-0001', start: 0, end: 2, text: '字幕' });
});

test('object ルートを読み default と caption をネストもフィールド単位で合成する', () => {
    const [parsed] = parsePreviewCaptions(JSON.stringify({
        default_text_style: {
            color: '#112233',
            size_px: 38,
            stroke: { color: '#000000', width_px: 1 },
            background: { color: '#44556680', opacity: 0.25, radius_px: 6 },
            zone: 'bottom'
        },
        captions: [{
            ...caption,
            text_style: {
                color: '#AABBCC',
                stroke: { width_px: 3 },
                background: { radius_px: 12 },
                zone: 'top-right'
            }
        }]
    }));

    assert.deepEqual(parsed.textStyle, {
        color: '#AABBCC',
        sizePx: 38,
        stroke: { color: '#000000', widthPx: 3 },
        background: { color: '#44556680', opacity: 0.25, radiusPx: 12 },
        zone: 'top-right'
    });
    assert.equal(parsed.textStyleVars['--caption-color'], '#AABBCC');
    assert.equal(parsed.textStyleVars['--caption-font-size'], '38px');
    assert.match(parsed.textStyleVars['--caption-text-shadow'], /3px 3px 0 #000000/);
    assert.equal(parsed.textStyleVars['--plate-bg'], 'rgba(68,85,102,0.25)');
    assert.equal(parsed.textStyleVars['--plate-radius'], '12px');
    assert.equal(parsed.textStyleVars['--caption-top'], '7%');
    assert.equal(parsed.textStyleVars['--caption-bottom'], 'auto');
    assert.equal(parsed.textStyleVars['--caption-align-items'], 'flex-end');
    assert.equal(parsed.textStyleVars['--caption-text-align'], 'right');
});

test('8桁hexのアルファは opacity 未指定時だけ使う', () => {
    const [hexAlpha] = parsePreviewCaptions(JSON.stringify({
        default_text_style: { background: { color: '#FF000080' } },
        captions: [caption]
    }));
    assert.equal(hexAlpha.textStyleVars['--plate-bg'], 'rgba(255,0,0,0.502)');

    const [explicitOpacity] = parsePreviewCaptions(JSON.stringify({
        default_text_style: { background: { color: '#FF000080', opacity: 0.2 } },
        captions: [caption]
    }));
    assert.equal(explicitOpacity.textStyleVars['--plate-bg'], 'rgba(255,0,0,0.2)');
});

test('block mode は block 専用 var を使い per-line の既存 var と分離する', () => {
    const [block] = parsePreviewCaptions(JSON.stringify({
        default_text_style: {
            background: { color: '#FF000080', radius_px: 12, mode: 'block' }
        },
        captions: [caption]
    }));
    assert.equal(block.textStyle.background.mode, 'block');
    assert.equal(block.textStyleVars['--plate-block-bg'], 'rgba(255,0,0,0.502)');
    assert.equal(block.textStyleVars['--plate-block-radius'], '12px');
    assert.equal(block.textStyleVars['--plate-bg'], undefined);
    assert.equal(block.textStyleVars['--plate-radius'], undefined);
});

test('text_style: null の字幕を捨てない（指定なし = 既定スタイルで表示する）', () => {
    // captions.schema の検証も共有カーネル mergeCaptionTextStyles も render-cut も Web UI も
    // null を「指定なし」として扱う。旧実装だけが caption ごと破棄しており、実プロジェクトの
    // カラオケ字幕 2 本が無言で消えていた（fieldtest 2026-08-03-preview-feature-matrix）。
    const parsed = parsePreviewCaptions(JSON.stringify([
        { ...caption, id: 'c-0001', text_style: null },
        { ...caption, id: 'c-0002', start: 3, end: 5, text_style: undefined },
        { ...caption, id: 'c-0003', start: 6, end: 8 }
    ]));
    assert.deepEqual(parsed.map(c => c.id), ['c-0001', 'c-0002', 'c-0003']);
});

test('読めない text_style でも字幕本体は残す（既定スタイルへフォールバック）', () => {
    const parsed = parsePreviewCaptions(JSON.stringify([
        { ...caption, id: 'c-0001', text_style: 'これは物ではない' },
        { ...caption, id: 'c-0002', start: 3, end: 5, text_style: 42 }
    ]));
    assert.deepEqual(parsed.map(c => c.id), ['c-0001', 'c-0002']);
    assert.deepEqual(parsed.map(c => c.text), ['字幕', '字幕']);
});

test('words[] 付きカラオケ字幕が text_style: null でも保持される', () => {
    const parsed = parsePreviewCaptions(JSON.stringify([{
        ...caption, id: 'c-0001', style: 'karaoke', text_style: null,
        words: [{ start: 0, end: 1, text: '文字' }, { start: 1, end: 2, text: 'ごと' }]
    }]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].style, 'karaoke');
    assert.equal(parsed[0].words.length, 2);
});
