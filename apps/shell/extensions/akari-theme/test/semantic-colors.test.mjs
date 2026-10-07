import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DARK, LIGHT } from '../lib/browser/akari-theme-tokens.js';

const variableSource = readFileSync(new URL('../src/browser/akari-css-variable-force-contribution.ts', import.meta.url), 'utf8');
const buttonSource = readFileSync(new URL('../src/browser/akari-button-style-contribution.ts', import.meta.url), 'utf8');

test('成功・注意・危険の役割色は両パレットにあり、危険は既存の赤と揃う', () => {
    for (const [palette, expected] of [
        [DARK, ['#4ade80', '#fbbf24', '#f87171']],
        [LIGHT, ['#15803d', '#b45309', '#b91c1c']]
    ]) {
        assert.deepEqual(['success', 'warning', 'danger'].map(role => palette[role]), expected);
        assert.equal(palette.danger, palette.placedTextRed);
    }
});

test('役割色を CSS 変数へ供給し、危険ボタンも同じ変数を使う', () => {
    for (const role of ['success', 'warning', 'danger']) {
        assert.ok(variableSource.includes(`root.setProperty('--akari-${role}', palette.${role})`));
    }
    assert.match(buttonSource, /\.theia-button\.danger\s*\{[^}]*color:\s*var\(--akari-danger\)/);
    assert.match(buttonSource, /\.theia-button\.danger:hover:not\(:disabled\)\s*\{[^}]*color-mix\(in srgb, var\(--akari-danger\) 12%, transparent\)/);
});
