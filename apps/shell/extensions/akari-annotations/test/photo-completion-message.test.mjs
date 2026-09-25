import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('photo completion notice conjugates the action and keeps other labels intact', () => {
    const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const expression = source.match(/this\.footer\.textContent = (label === '背景を消す'[^;]+);/u)?.[1];
    assert.ok(expression);
    const message = new Function('label', `return ${expression};`);
    assert.equal(message('背景を消す'), '背景を消しました。');
    assert.equal(message('エリアを追加'), 'エリアを追加しました。');
    assert.equal(message('クリップの変形を変更'), 'クリップの変形を変更しました。');
});
