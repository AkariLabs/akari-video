import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, buildDesignMd, defaultDesignValues, DESIGN_SECTION_HEADINGS, DESIGN_ASSET_ROLES,
    DESIGN_ASSET_ROLE_LABELS, isDesignAssetFileName, isDesignImageFile, safeDesignFileName, designAssetBadge } from '../lib/browser/channel/design-md-model.js';

test('front matter と本文を読む', () => {
    const parsed = parseDesignMd('---\ncolors: { main: "#aabbcc", sub: "", text: "#ffffff", background: "#111111" }\nfonts: { heading: "太字", body: "標準" }\n---\n# 料理 のデザイン\n\n## 雰囲気\n明るい\n');
    assert.equal(parsed.colors.main, '#aabbcc');
    assert.equal(parsed.fonts.body, '標準');
    assert.equal(parsed.sections[0].body, '明るい');
});

test('既定の書式と往復不変', () => {
    const values = defaultDesignValues();
    values.sections[0].body = 'やさしい';
    values.sections.push({ heading: '画面の余白', body: '広め' });
    values.rest = '元のメモを残す';
    const built = buildDesignMd(values, '料理の部屋');
    assert.match(built, /^---\ncolors: \{ main: "", sub: "", text: "#ffffff", background: "#111111" \}\nfonts: \{ heading: "", body: "" \}\n---\n# 料理の部屋 のデザイン/);
    assert.deepEqual(DESIGN_SECTION_HEADINGS, ['雰囲気', '色', '文字と字幕', 'ロゴ', '避けること']);
    const parsed = parseDesignMd(built);
    assert.equal(parsed.rest, '元のメモを残す');
    assert.equal(buildDesignMd(parsed, '料理の部屋'), built);
});

test('読めない行と見出し前の本文は rest に残す', () => {
    const parsed = parseDesignMd('---\ncustom: value\n---\n# デザイン\n\n前置き\n\n## 色\n赤');
    assert.match(parsed.rest, /custom: value/);
    assert.match(parsed.rest, /前置き/);
    assert.match(buildDesignMd(parsed, '見本'), /custom: value/);
});

test('assets を読み書きしてエスケープを含め往復する', () => {
    const values = defaultDesignValues();
    values.assets = [
        { role: 'logo', file: 'design/logo.png', note: '白地用 "表"' },
        { role: 'font', file: 'design/brand.woff2', note: 'A\\B' }
    ];
    const built = buildDesignMd(values, '見本');
    assert.match(built, /fonts: .*\nassets: \[\{ role: "logo", file: "design\/logo.png", note: "白地用 \\"表\\"" \}/);
    assert.deepEqual(parseDesignMd(built).assets, values.assets);
    assert.equal(buildDesignMd(parseDesignMd(built), '見本'), built);
    assert.deepEqual(DESIGN_ASSET_ROLES, ['logo', 'logo-mono', 'icon', 'font', 'reference', 'other']);
    assert.equal(DESIGN_ASSET_ROLE_LABELS.reference, '参考画像');
});

test('note のない asset とキーの順序が違う asset を読む', () => {
    const parsed = parseDesignMd('---\nassets: [{ role: "logo", file: "design/logo.png" }, { file: "design/icon.svg", role: "icon" }]\n---\n# 見本');
    assert.deepEqual(parsed.assets, [
        { role: 'logo', file: 'design/logo.png', note: '' },
        { role: 'icon', file: 'design/icon.svg', note: '' }
    ]);
    const duplicate = parseDesignMd('---\nassets: [{ role: "logo", file: "design/logo.png", role: "icon" }]\n---\n# 見本');
    assert.deepEqual(duplicate.assets, []);
    assert.match(duplicate.rest, /assets: \[/);
});

test('note にタブがあっても assets の build → parse → build は不変', () => {
    const values = defaultDesignValues();
    values.assets = [{ role: 'logo', file: 'design/logo.png', note: '白\t地用' }];
    const built = buildDesignMd(values, '見本');
    assert.deepEqual(parseDesignMd(built).assets, [{ role: 'logo', file: 'design/logo.png', note: '白 地用' }]);
    assert.equal(buildDesignMd(parseDesignMd(built), '見本'), built);
});

test('不正な asset は捨て、読めない assets 行は rest に残す', () => {
    const source = '---\nassets: [{ role: "unknown", file: "design/a.png", note: "" }, { role: "icon", file: "outside.png", note: "" }, { role: "icon", file: "design/../a.png", note: "" }, { role: "icon", file: "design/good.svg", note: "" }]\n---\n# 見本';
    assert.deepEqual(parseDesignMd(source).assets, [{ role: 'icon', file: 'design/good.svg', note: '' }]);
    const unreadable = parseDesignMd('---\nassets: [{ role: "logo" }]\n---\n# 見本');
    assert.deepEqual(unreadable.assets, []);
    assert.match(unreadable.rest, /assets: \[/);
});

test('assets が 0 件なら従来の書式を維持する', () => {
    const built = buildDesignMd(defaultDesignValues(), '見本');
    assert.match(built, /^---\ncolors: .*\nfonts: .*\n---\n# 見本 のデザイン/);
    assert.doesNotMatch(built, /assets:/);
});

test('素材の拡張子と安全な連番名を判定する', () => {
    for (const ext of ['PNG', 'jpg', 'jpeg', 'SVG', 'webp', 'TTF', 'otf', 'WOFF2']) assert.equal(isDesignAssetFileName(`a.${ext}`), true);
    assert.equal(isDesignAssetFileName('a.gif'), false);
    assert.equal(isDesignImageFile('design/a.SVG'), true);
    assert.equal(isDesignImageFile('design/a.ttf'), false);
    assert.equal(safeDesignFileName('.Logo:Main.PNG', ['Logo-Main.png', 'logo-main-2.PNG']), 'Logo-Main-3.png');
    assert.equal(safeDesignFileName('...', []), 'asset');
    assert.equal(safeDesignFileName('path/to/<a>?.JPG', []), 'path-to--a--.jpg');
});

test('素材バッジはロゴ、画像、フォントの順に出す', () => {
    const asset = (role, file = 'design/a.png') => ({ role, file, note: '' });
    assert.equal(designAssetBadge([]), undefined);
    assert.equal(designAssetBadge([asset('font', 'design/a.ttf')]), 'フォント 1');
    assert.equal(designAssetBadge([asset('icon'), asset('reference')]), '画像 2');
    assert.equal(designAssetBadge([asset('font'), asset('logo-mono')]), 'ロゴあり');
});
