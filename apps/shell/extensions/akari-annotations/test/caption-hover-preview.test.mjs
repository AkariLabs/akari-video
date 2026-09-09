import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptionHoverPreview } from '../lib/common/caption-hover-preview.js';

class Element {
    children = [];
    className = '';
    textContent = '';
    style = {
        setProperty(name, value) { this[name] = value; }
    };
    constructor(tagName) { this.tagName = tagName; }
    append(...children) { this.children.push(...children); }
}

const document = { createElement: tagName => new Element(tagName) };
const base = {
    text: '字幕の見た目', width: 1920, height: 1080,
    bounds: { left: 600, right: 800, top: 700, bottom: 750 },
    innerWidth: 1600, innerHeight: 1000
};
function render(input = {}) {
    const frame = createCaptionHoverPreview(document, { ...base, ...input });
    const [css, stage] = frame.children;
    const [caption] = stage.children;
    const [plate] = caption.children;
    return { frame, css, stage, caption, plate };
}

test('本文を HTML として解釈せず、プレビューと同じ字幕 DOM に置く', () => {
    const text = '<b>字幕</b>\n次の行';
    const { frame, stage, caption, plate } = render({ text });
    assert.equal(frame.className, 'akari-caption-hover-preview');
    assert.equal(frame.style.background, '#000');
    assert.equal(caption.className, 'akari-caption');
    assert.equal(plate.className, 'akari-caption__plate');
    assert.deepEqual(plate.children.map(line => [line.tagName, line.className, line.textContent]), [
        ['p', 'akari-caption__line', '<b>字幕</b>'], ['p', 'akari-caption__line', '次の行']
    ]);
    assert.equal(stage.style.width, '1920px');
    assert.equal(stage.style.height, '1080px');
    assert.equal(stage.style.transform, `scale(${1 / 6})`);
    assert.equal(frame.style.width, '320px');
    assert.equal(frame.style.height, '180px');
});

test('フォント・色・縁取り・背景を入力を変えずに反映する', () => {
    const textStyle = Object.freeze({
        color: '#ff8800', sizePx: 72, fontFamily: 'serif', fontWeight: 900,
        stroke: Object.freeze({ color: '#112233', widthPx: 3 }),
        background: Object.freeze({ color: '#000000', opacity: 0.5, radiusPx: 8 })
    });
    const { caption, plate } = render({ textStyle });
    assert.equal(caption.style['--caption-color'], '#ff8800');
    assert.equal(caption.style['--caption-font-size'], '72px');
    assert.equal(caption.style['--caption-text-shadow'],
        '-3px -3px 0 #112233, 3px -3px 0 #112233, -3px 3px 0 #112233, 3px 3px 0 #112233, 0 0 8px rgba(0,0,0,.6)');
    assert.equal(caption.style['--plate-bg'], 'rgba(0,0,0,0.5)');
    assert.equal(caption.style['--plate-radius'], '8px');
    assert.equal(caption.style.fontFamily, 'serif');
    assert.equal(caption.style.fontWeight, '900');
    assert.equal(plate.children[0].className, 'akari-caption__line');
    assert.equal(JSON.stringify(render({ textStyle }).caption.style), JSON.stringify(caption.style));
});

for (const [zone, top, bottom, align, justify, textAlign] of [
    ['top-left', '7%', 'auto', 'flex-start', 'flex-start', 'left'],
    ['top', '7%', 'auto', 'center', 'flex-start', 'center'],
    ['top-right', '7%', 'auto', 'flex-end', 'flex-start', 'right'],
    ['left', '0', '0', 'flex-start', 'center', 'left'],
    ['center', '0', '0', 'center', 'center', 'center'],
    ['right', '0', '0', 'flex-end', 'center', 'right'],
    ['bottom-left', 'auto', '7%', 'flex-start', 'flex-start', 'left'],
    ['bottom-right', 'auto', '7%', 'flex-end', 'flex-start', 'right']
]) {
    test(`ゾーン ${zone} を枠内の位置へ反映する`, () => {
        const { caption } = render({ textStyle: { zone } });
        assert.equal(caption.style['--caption-top'], top);
        assert.equal(caption.style['--caption-bottom'], bottom);
        assert.equal(caption.style['--caption-left'], '4%');
        assert.equal(caption.style['--caption-right'], '4%');
        assert.equal(caption.style['--caption-align-items'], align);
        assert.equal(caption.style['--caption-justify-content'], justify);
        assert.equal(caption.style['--caption-text-align'], textAlign);
    });
}

test('下ゾーンと未指定は CSS の既定位置・フォントを使う', () => {
    for (const textStyle of [undefined, { zone: 'bottom' }]) {
        const { caption, css } = render({ textStyle });
        assert.equal(caption.style['--caption-top'], undefined);
        assert.equal(caption.style['--caption-bottom'], undefined);
        assert.equal(caption.style['--caption-font-size'], '38px');
        assert.match(css.textContent, /bottom:var\(--caption-bottom,7%\)/);
        assert.match(css.textContent, /align-items:var\(--caption-align-items,stretch\)/);
    }
});

test('ブロック背景は複数行を一つの背景にまとめる', () => {
    const { caption, plate } = render({ text: '一行目\n二行目',
        textStyle: { background: { mode: 'block', color: '#fff', radiusPx: 12 } } });
    assert.equal(caption.style['--plate-block-bg'], 'rgba(255,255,255,1)');
    assert.equal(caption.style['--plate-block-radius'], '12px');
    assert.equal(caption.style['--plate-bg'], undefined);
    assert.equal(plate.children.length, 1);
    assert.equal(plate.children[0].className, 'akari-caption__block');
    assert.deepEqual(plate.children[0].children.map(line => line.textContent), ['一行目', '二行目']);
});

for (const [width, height, innerWidth, innerHeight, expectedWidth, expectedHeight, fontSize] of [
    [1080, 1920, 1600, 1000, 180, 320, 65],
    [1000, 1000, 1600, 1000, 320, 320, 38],
    [1920, 1080, 800, 1000, 216, 121.5, 38],
    [1920, 1080, 800, 300, 120, 67.5, 38],
    [undefined, undefined, 1600, 1000, 320, 180, 38],
    [0, Infinity, 1600, 1000, 320, 180, 38]
]) {
    test(`出力 ${width}×${height}・画面 ${innerWidth}×${innerHeight} の比率と上限`, () => {
        const { frame, caption } = render({ width, height, innerWidth, innerHeight });
        assert.equal(frame.style.width, `${expectedWidth}px`);
        assert.equal(frame.style.height, `${expectedHeight}px`);
        assert.equal(caption.style['--caption-font-size'], `${fontSize}px`);
    });
}

test('改行・句読点・縦横の文字数上限で本文を折り返す', () => {
    const text = 'ABCDEFGHIJABCDEFGHIJABCDE';
    assert.deepEqual(render({ text }).plate.children.map(line => line.textContent), ['ABCDEFGHIJABCDEFGHIJ', 'ABCDE']);
    assert.deepEqual(render({ text, width: 1080, height: 1920 }).plate.children.map(line => line.textContent),
        ['ABCDEFGHIJ', 'ABCDEFGHIJ', 'ABCDE']);
    assert.deepEqual(render({ text: 'はい、次です。\r\n\n末尾' }).plate.children.map(line => line.textContent),
        ['はい、', '次です。', '', '末尾']);
});
