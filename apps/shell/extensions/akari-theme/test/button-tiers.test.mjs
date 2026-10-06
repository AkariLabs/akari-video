import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-button-style-contribution.ts', import.meta.url), 'utf8');
const css = source.match(/const CSS = `([\s\S]*?)`;/)?.[1].replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(css, '注入する CSS がある');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));
const ruleFor = (selector) => rules.find(rule => rule.selector.includes(selector));
const scope = ':where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host)';

test('4 段・小サイズ・共通状態を生成 CSS に持つ', () => {
    for (const [selector, variable] of [
        ['.theia-button', '--akari-accent'],
        ['.theia-button.secondary', '--akari-button-secondary'],
        ['.theia-button.quiet', '--akari-button-quiet-ink'],
        ['.theia-button.danger', '--akari-button-danger']
    ]) {
        const rule = selector === '.theia-button'
            ? rules.find(item => item.selector === '.theia-button' && item.declarations.includes('background-color'))
            : ruleFor(selector);
        assert.ok(rule, selector);
        assert.ok(rule.declarations.includes(`var(${variable})`), variable);
    }
    assert.match(ruleFor('.theia-button.small').declarations, /height:\s*24px/);
    assert.match(ruleFor('.theia-button.small').declarations, /padding:\s*0 9px/);
    const common = rules.find(rule => rule.selector === '.theia-button' && rule.declarations.includes('height:'));
    assert.match(common.declarations, /height:\s*28px/);
    assert.match(common.declarations, /border-radius:\s*6px/);
    assert.match(common.declarations, /padding:\s*0 12px/);
    assert.match(ruleFor('.theia-button:focus-visible').declarations, /outline:\s*2px solid/);
    assert.match(ruleFor('.theia-button:disabled').declarations, /opacity:\s*\.42/);
});

test('素のボタンは AKARI 範囲の無装飾要素だけに詳細度 0 で当てる', () => {
    const fallback = rules.filter(rule => rule.selector.includes('button:not([class])'));
    const states = ['', ':hover:not(:disabled)', ':focus-visible', ':disabled'];
    assert.equal(fallback.length, states.length);
    for (const state of states) {
        const selector = `${scope} :where(button:not([class]):not([style])${state})`;
        const rule = fallback.find(item => item.selector === selector);
        assert.ok(rule, selector);
        assert.ok(rule.selector.startsWith(`${scope} :where(`));
        assert.doesNotMatch(rule.selector, /\.theia-button|\.monaco-/);
        assert.doesNotMatch(rule.declarations, /!important/);
    }
    const base = fallback.find(rule => rule.selector === `${scope} :where(button:not([class]):not([style]))`);
    assert.match(base.declarations, /background-color:\s*var\(--akari-button-secondary\)/);
    assert.match(base.declarations, /border:\s*1px solid var\(--akari-button-secondary-line\)/);
    assert.match(base.declarations, /height:\s*28px/);
    assert.match(base.declarations, /padding:\s*0 12px/);
    assert.match(base.declarations, /font-size:\s*12\.5px/);
    assert.match(base.declarations, /font-weight:\s*500/);
    assert.match(base.declarations, /border-radius:\s*6px/);
    assert.match(fallback.find(rule => rule.selector.endsWith(':focus-visible)')).declarations, /outline:\s*2px solid var\(--akari-accent\)/);
    assert.match(fallback.find(rule => rule.selector.endsWith(':disabled)')).declarations, /opacity:\s*\.42/);
    const separator = rules.find(rule => rule.selector === `${scope} :where(hr)`);
    assert.match(separator.declarations, /border-top:\s*1px solid var\(--akari-line-inner\)/);
});

test('切り替えは面で選び、押下とタブの両属性を受ける', () => {
    assert.match(rules.find(rule => rule.selector === '.akari-seg').declarations, /background-color:\s*var\(--akari-card\)/);
    const selected = rules.find(rule => rule.selector.includes('.akari-seg >') && rule.selector.includes('[aria-selected="true"]'));
    assert.ok(selected.selector.includes('[aria-pressed="true"]'));
    assert.match(selected.declarations, /background-color:\s*var\(--akari-selected\)/);
    assert.match(selected.declarations, /color:\s*var\(--akari-selected-ink\)/);
    assert.doesNotMatch(selected.declarations, /border-color/);
});

test('今回のボタン規則の important は色だけ、色の直値は変数のフォールバックだけに置く', () => {
    const tierRules = rules.filter(rule =>
        rule.selector.startsWith('.theia-button')
        || rule.selector.startsWith(`${scope} :where(`)
        || rule.selector.startsWith('.akari-seg')
    );
    for (const rule of tierRules) {
        for (const [, property] of rule.declarations.matchAll(/([\w-]+):[^;{}]*!important/g)) {
            assert.ok(property.endsWith('color'), `${rule.selector}: ${property}`);
        }
    }
    const withoutFallbacks = css.replace(/var\(--[\w-]+,\s*#[\da-fA-F]+\)/g, '');
    assert.doesNotMatch(withoutFallbacks, /#[\da-fA-F]{3,8}\b/);
});

test('新しい役割色は両パレットと CSS 変数供給に揃う', () => {
    const tokens = readFileSync(new URL('../src/browser/akari-theme-tokens.ts', import.meta.url), 'utf8');
    const force = readFileSync(new URL('../src/browser/akari-css-variable-force-contribution.ts', import.meta.url), 'utf8');
    for (const [name, variable] of [
        ['buttonSecondary', 'button-secondary'],
        ['buttonSecondaryLine', 'button-secondary-line'],
        ['buttonSecondaryHover', 'button-secondary-hover'],
        ['buttonSecondaryHoverLine', 'button-secondary-hover-line'],
        ['buttonQuietInk', 'button-quiet-ink'],
        ['selected', 'selected'],
        ['selectedInk', 'selected-ink']
    ]) {
        assert.equal([...tokens.matchAll(new RegExp(`\\b${name}:`, 'g'))].length, 2, name);
        assert.ok(force.includes(`root.setProperty('--akari-${variable}', palette.${name})`), variable);
    }
});
