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

test('配列ルートを従来どおり読み text_style 不在なら追加キーを持たない', () => {
    const [parsed] = parsePreviewCaptions(JSON.stringify([caption]));
    assert.deepEqual(parsed, { start: 0, end: 2, text: '字幕' });
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
