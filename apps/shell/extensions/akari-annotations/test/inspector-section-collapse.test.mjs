import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');

test('section-body の hidden 規則は grid の後で詳細度により非表示にする', () => {
    const style = source.match(/style\.textContent\s*=\s*`([^`]+)`/u)?.[1];
    assert.ok(style, 'インライン <style> テンプレートがある');
    const grid = /\.akari-inspector-widget\s+\.akari-inspector-section-body\s*\{([^}]+)\}/u.exec(style);
    const hidden = /\.akari-inspector-widget\s+\.akari-inspector-section-body\[hidden\]\s*\{([^}]+)\}/u.exec(style);
    assert.ok(grid, '通常の section-body 規則がある');
    assert.ok(hidden, '同じクラスに [hidden] を加えた規則がある');
    assert.match(grid[1], /\bdisplay\s*:\s*grid\s*;/u);
    assert.match(hidden[1], /\bdisplay\s*:\s*none\s*;/u);
    assert.ok(hidden.index > grid.index, '[hidden] 規則を grid 規則の後に置く');
    assert.doesNotMatch(grid[1] + hidden[1], /!\s*important/iu);
});
