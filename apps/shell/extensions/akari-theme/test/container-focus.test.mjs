import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-button-style-contribution.ts', import.meta.url), 'utf8');
const css = source.match(/const CSS = `([\s\S]*?)`;/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));

test('outline 抑制はシェル内のコンテナ自身の :focus だけに限定する', () => {
    const suppression = rules.filter(rule => /outline:\s*none/.test(rule.declarations));
    assert.equal(suppression.length, 1);
    const { selector, declarations } = suppression[0];
    assert.ok(selector.startsWith('#theia-app-shell .lm-Widget:is('));
    assert.ok(selector.endsWith(':focus'));
    assert.match(selector, /:is\(:not\(\[role\]\), \[role="tabpanel"\], \[role="region"\], \[role="group"\]\)/);
    assert.doesNotMatch(selector, /\)\s+(?:\*|:focus)/, '子孫全体のリングを消さない');
    assert.match(declarations, /outline:\s*none\s*!important/);
    assert.doesNotMatch(declarations, /border|overflow|box-shadow/, 'カード本来の外周は保持する');
});

test('ボタン・入力・リンク・編集領域を除外し、可視フォーカスの色を保持する', () => {
    const { selector } = rules.find(rule => /outline:\s*none/.test(rule.declarations));
    for (const control of ['button', 'input', 'select', 'textarea', 'a[href]']) {
        assert.ok(selector.includes(`:not(${control})`), control);
    }
    assert.ok(selector.includes(':not([contenteditable]:not([contenteditable="false"]))'));
    for (const role of ['button', 'slider', 'tab', 'textbox', 'tree', 'grid']) {
        assert.ok(!selector.includes(`[role="${role}"]`), `操作用 role=${role} は抑制対象外`);
    }
    const visibleFocus = rules.find(rule => rule.selector === ':focus-visible');
    assert.match(visibleFocus.declarations, /outline-color:\s*var\(--akari-accent-light,/);
    assert.doesNotMatch(visibleFocus.declarations, /outline:\s*none/);
});
