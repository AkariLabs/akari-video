import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    addGradientStop, alphaOf, applyGradientStyle, captionPathsFromEdit, collectDesignColors, DEFAULT_GRADIENT_COLLAPSED,
    DEFAULT_GRADIENTS, DEFAULT_SOLID_COLLAPSED, DEFAULT_SOLID_COLORS, extractPalette, findEditItem, GRADIENT_STYLES,
    gradientFrom, gradientStyleIndex, historyRow, hexToHsv, hsvToHex, itemPathPatch, normalizeHex, paintToCss,
    parseColorHistory, parseColorPanelOpenRequest, parsePaint, photoSourcesFromEdit, pushColorHistory, readItemPath,
    removeGradientStop, samePaint, searchColors, setGradientStopColor, withAlpha
} from '../lib/browser/inspector/color-model.js';

test('色番号: 3 / 6 / 8 桁を大文字の #RRGGBB(AA) にそろえ、不透明の FF は落とす', () => {
    assert.equal(normalizeHex('#abc'), '#AABBCC');
    assert.equal(normalizeHex('00c4cc'), '#00C4CC');
    assert.equal(normalizeHex('#00c4cc80'), '#00C4CC80');
    assert.equal(normalizeHex('#00c4ccff'), '#00C4CC');
    for (const bad of ['', '#12', 'blue', '#GGGGGG', 42, null]) assert.equal(normalizeHex(bad), undefined, String(bad));
    assert.equal(withAlpha('#FF0000', 0.5), '#FF000080');
    assert.equal(withAlpha('#FF0000', 1), '#FF0000');
    assert.equal(Math.round(alphaOf('#FF000080') * 100), 50);
});

test('値の形: 単色・透明・linear（角度）・radial を読み、stops は 2〜5 色', () => {
    assert.equal(parsePaint('none'), 'none');
    assert.equal(parsePaint('#ff3131'), '#FF3131');
    const linear = parsePaint({ type: 'linear', angle: 450, stops: [{ color: '#000', offset: 0 }, { color: '#fff', offset: 1 }] });
    assert.deepEqual(linear, { type: 'linear', angle: 90, stops: [{ color: '#000000', offset: 0 }, { color: '#FFFFFF', offset: 1 }] });
    const radial = parsePaint({ type: 'radial', stops: ['#ff0000', '#00ff00', '#0000ff'] });
    assert.deepEqual(radial.stops.map(stop => stop.offset), [0, 0.5, 1]);
    assert.equal(parsePaint({ type: 'linear', angle: 0, stops: [{ color: '#000', offset: 0 }] }), undefined);
    assert.equal(parsePaint({ type: 'conic', stops: ['#000', '#fff'] }), undefined);
    assert.equal(paintToCss(radial), 'radial-gradient(circle, #FF0000 0%, #00FF00 50%, #0000FF 100%)');
    assert.equal(paintToCss('none'), 'transparent');
    assert.ok(samePaint('#ff3131', '#FF3131FF'));
});

test('既定の色: 単色 4 段 28 色（すべて表示で 6 段 42 色）/ グラデーション 3 段 21 種（5 段 35 種）', () => {
    assert.equal(DEFAULT_SOLID_COLLAPSED, 28);
    assert.equal(DEFAULT_SOLID_COLORS.length, 42);
    assert.equal(DEFAULT_GRADIENT_COLLAPSED, 21);
    assert.equal(DEFAULT_GRADIENTS.length, 35);
    for (const entry of DEFAULT_SOLID_COLORS) assert.equal(normalizeHex(entry.color), entry.color);
    for (const gradient of DEFAULT_GRADIENTS) assert.ok(samePaint(parsePaint(gradient), gradient));
    assert.equal(new Set(DEFAULT_SOLID_COLORS.map(entry => entry.color)).size, 42);
});

test('検索:「青」で青系が出る /「#00c4cc」はその色 / ひらがなでも引ける / 無ければ空', () => {
    const blue = searchColors('青');
    assert.ok(blue.hits.length >= 6, String(blue.hits.length));
    assert.ok(blue.hits.every(hit => hit.names.includes('青')));
    assert.ok(blue.hits.some(hit => hit.color === '#5271FF'));
    const hex = searchColors('#00c4cc');
    assert.equal(hex.exact, '#00C4CC');
    assert.ok(searchColors('あお').hits.length >= 6);
    assert.deepEqual(searchColors('ぬぬぬ'), { exact: undefined, hits: [] });
    assert.ok(searchColors('#ff').hits.some(hit => hit.color === '#FF3131'), 'hex prefix');
});

test('色を作る窓: 3 色・放射にすると 3 色の radial / 5 色まで / 2 色は外せない / 透明度は色ごとの AA', () => {
    let paint = gradientFrom('#FF3131');
    assert.deepEqual(paint.stops.map(stop => stop.color), ['#FF3131', '#545454']);
    paint = addGradientStop(paint);
    paint = setGradientStopColor(paint, 2, '#38B6FF');
    paint = applyGradientStyle(paint, GRADIENT_STYLES.findIndex(style => style.id === 'radial'));
    assert.deepEqual(paint, { type: 'radial', stops: [
        { color: '#FF3131', offset: 0 }, { color: '#545454', offset: 0.5 }, { color: '#38B6FF', offset: 1 }] });
    assert.equal(gradientStyleIndex(paint), 3);
    for (let i = 0; i < 5; i++) paint = addGradientStop(paint);
    assert.equal(paint.stops.length, 5);
    paint = setGradientStopColor(paint, 1, '#545454', 0.25);
    assert.equal(paint.stops[1].color, '#54545440');
    let two = gradientFrom('#000000');
    two = removeGradientStop(two, 0);
    assert.equal(two.stops.length, 2);
    assert.equal(removeGradientStop(paint, 4).stops.length, 4);
    assert.deepEqual(GRADIENT_STYLES.map(style => [style.label, style.type, style.angle]),
        [['横', 'linear', 90], ['縦', 'linear', 180], ['斜め ↘', 'linear', 135], ['放射', 'radial', undefined], ['斜め ↗', 'linear', 45]]);
});

test('色相 × 鮮やかさ × 明るさ: 往復で色が保たれる', () => {
    for (const hex of ['#FF3131', '#00C4CC', '#5E17EB', '#000000', '#FFFFFF', '#737373']) assert.equal(hsvToHex(hexToHsv(hex)), hex);
    assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), '#FF0000');
    assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), '#0000FF');
});

test('履歴: 新しい順に 8 個・同じ色は前へ・透明は積まない・グラデーションも 1 つ・今の色が無ければ先頭に', () => {
    let history = [];
    for (const color of ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888']) {
        history = pushColorHistory(history, color);
    }
    assert.equal(history.length, 8);
    assert.equal(history[0], '#888888');
    history = pushColorHistory(history, '#333333');
    assert.equal(history[0], '#333333');
    assert.equal(history.filter(entry => entry === '#333333').length, 1);
    assert.equal(pushColorHistory(history, 'none')[0], '#333333');
    const gradient = gradientFrom('#FF3131');
    history = pushColorHistory(history, gradient);
    assert.ok(samePaint(history[0], gradient));
    assert.equal(historyRow(history, '#ABCDEF', true)[0], '#ABCDEF');
    assert.ok(historyRow(history, '#ABCDEF', false).every(entry => typeof entry === 'string'), 'no gradient for text');
    assert.deepEqual(parseColorHistory(['#abc', 'bogus', '#ABC', { type: 'radial', stops: ['#000', '#fff'] }]).length, 2);
});

test('このデザインの色: edit.json / captions.json の色らしい鍵から多い順に集める', () => {
    const edit = { output: { width: 1920 }, tracks: [{ lane: 'visual', items: [
        { id: 's1', source: { kind: 'shape', shape: 'rect', params: { fill: '#ff3131', stroke: '#000000' } } },
        { id: 's2', source: { kind: 'shape', shape: 'rect', params: { fill: { type: 'linear', angle: 90, stops: ['#000', '#fff'] } } } },
        { id: 's3', source: { kind: 'shape', shape: 'rect', params: { fill: '#FF3131', label: '#123456' } } }
    ] }] };
    const captions = { captions: [{ textStyle: { color: '#FFFFFF', stroke: { color: '#000000' }, background: { color: '#000000' } } }] };
    const colors = collectDesignColors([edit, captions]);
    assert.equal(colors[0], '#000000');
    assert.equal(colors[1], '#FF3131');
    assert.ok(colors.some(color => typeof color === 'object' && color.type === 'linear'));
    assert.ok(!colors.includes('#123456'), 'not a color key');
    assert.ok(colors.includes('#FFFFFF'));
});

test('写真の色: 置いた画像はどこでも・動画は本編（一番上の visual）以外 / 画像が先', () => {
    const edit = {
        sources: [{ id: 'main', path: 'assets/take.mp4' }, { id: 'photo', path: 'assets/still/photo.png' },
            { id: 'broll', path: 'assets/broll/city.mov' }],
        tracks: [
            { lane: 'visual', items: [{ id: 'c1', source: { kind: 'media', src: 'main' } }, { id: 'p0', source: { kind: 'media', src: 'photo' } }] },
            { lane: 'visual', items: [{ id: 'b1', source: { kind: 'media', src: 'broll' } }, { id: 'g', source: { kind: 'group' },
                items: [{ id: 'p1', source: { kind: 'media', path: 'assets/still/inner.jpg' } }] }] },
            { lane: 'visual', items: [{ id: 'cap', source: { kind: 'captions', path: 'captions.json' } }] }
        ]
    };
    assert.deepEqual(photoSourcesFromEdit(edit), [
        { path: 'assets/still/photo.png', kind: 'image' }, { path: 'assets/still/inner.jpg', kind: 'image' },
        { path: 'assets/broll/city.mov', kind: 'video' }
    ]);
    assert.deepEqual(captionPathsFromEdit(edit), ['captions.json']);
    assert.deepEqual(photoSourcesFromEdit(null), []);
});

test('写真の色: 画素から 5 色（多い順・近すぎる色は重ねない・決定論）', () => {
    const pixels = [];
    const push = (r, g, b, n) => { for (let i = 0; i < n; i++) pixels.push(r, g, b, 255); };
    push(250, 20, 20, 400); push(245, 25, 22, 50); push(20, 20, 240, 300); push(20, 200, 40, 200);
    push(240, 240, 240, 100); push(10, 10, 10, 80); push(128, 0, 128, 10);
    for (let i = 0; i < 50; i++) pixels.push(0, 255, 0, 0); // 透明は数えない
    const palette = extractPalette(pixels, 5);
    assert.equal(palette.length, 5);
    assert.match(palette[0], /^#F[0-9A-F]1[0-9A-F]1[0-9A-F]$/u);
    assert.deepEqual(extractPalette(pixels, 5), palette);
    assert.equal(extractPalette([255, 0, 0, 255], 5).length, 1);
});

test('対象: openColorPanel の引数を読み、item の path は入れ子を丸ごと作り直す', () => {
    assert.deepEqual(parseColorPanelOpenRequest({ target: { kind: 'field', field: 'caption-color' } }),
        { target: { kind: 'field', field: 'caption-color' }, allowGradient: false, allowTransparent: false, title: undefined, toggle: false });
    assert.equal(parseColorPanelOpenRequest({ target: { kind: 'item', itemId: 'x', path: '../x' } }), undefined);
    assert.equal(parseColorPanelOpenRequest({ target: { kind: 'bogus' } }), undefined);
    const request = parseColorPanelOpenRequest({ target: { kind: 'item', itemId: 's1', path: 'source.params.fill' },
        allowGradient: true, allowTransparent: true, title: '塗りの色', toggle: true });
    assert.equal(request.allowGradient, true);
    assert.equal(request.title, '塗りの色');
    const item = { id: 's1', source: { kind: 'shape', shape: 'rect', params: { fill: { type: 'linear', angle: 90, stops: [] }, width: 10 } } };
    const patch = itemPathPatch(item, 'source.params.fill', { type: 'radial', stops: [{ color: '#000000', offset: 0 }] });
    assert.deepEqual(patch, { source: { kind: 'shape', shape: 'rect', params: { fill: { type: 'radial', stops: [{ color: '#000000', offset: 0 }] }, width: 10 } } });
    assert.equal(item.source.params.fill.type, 'linear', 'input untouched');
    assert.equal(readItemPath(item, 'source.params.width'), 10);
    assert.deepEqual(itemPathPatch(item, 'opacity', 0.5), { opacity: 0.5 });
    const edit = { tracks: [{ items: [{ id: 'g', items: [item] }] }] };
    assert.equal(findEditItem(edit, 's1'), item);
    assert.equal(findEditItem(edit, 'none'), undefined);
});

test('インスペクター: 色の行は色パネルを開く丸になり、コマンドが登録されている', async () => {
    const widget = await readFile(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const contribution = await readFile(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
    const commands = await readFile(new URL('../src/browser/akari-annotations-commands.ts', import.meta.url), 'utf8');
    assert.match(widget, /createColorRowSwatch\(editValue, label,\s*\(\) => this\.openColorPanel\(\{ target: \{ kind: 'field', field: fieldName \} \}\)\)/u);
    assert.doesNotMatch(widget, /picker\.type = 'color'/u, 'native color input is gone');
    assert.match(widget, /if \(this\.colorPanelHostInstance\?\.isOpen && this\.renderColorPanelMode\(sections, rowSnapshot\)\) return;/u);
    assert.match(commands, /id: 'akari\.inspector\.openColorPanel'/u);
    assert.match(contribution, /registerCommand\(OPEN_AKARI_INSPECTOR_COLOR_PANEL/u);
});
