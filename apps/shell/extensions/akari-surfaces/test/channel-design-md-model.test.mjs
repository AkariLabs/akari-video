import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, buildDesignMd, defaultDesignValues, DESIGN_SECTION_HEADINGS } from '../lib/browser/channel/design-md-model.js';

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
