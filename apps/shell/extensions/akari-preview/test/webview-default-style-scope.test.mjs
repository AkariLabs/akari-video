import assert from 'node:assert/strict';
import test from 'node:test';

import {
    neutralizeWebviewDefaultStylesForOverlays,
    scopeSelectorOutsideOverlays
} from '../lib/common/webview-default-style-scope.js';

const guard = ':where(:not(#overlay-stage [data-overlay-id] *))';

test('セレクタリストと括弧・属性・引用符内のカンマを分ける', () => {
    assert.equal(scopeSelectorOutsideOverlays('img'), `img${guard}`);
    assert.equal(scopeSelectorOutsideOverlays('a:focus, input:focus'), `a:focus${guard}, input:focus${guard}`);
    assert.equal(scopeSelectorOutsideOverlays(':is(a, b) img, [data-name="a,b"] img'),
        `:is(a, b) img${guard}, [data-name="a,b"] img${guard}`);
    assert.equal(scopeSelectorOutsideOverlays('.vscode-light kbd'), `.vscode-light kbd${guard}`);
    assert.equal(scopeSelectorOutsideOverlays('a:hover'), `a:hover${guard}`);
});

test('疑似要素の前に挿入し、2 回目は変更しない', () => {
    for (const [before, after] of [
        ['::-webkit-scrollbar', `${guard}::-webkit-scrollbar`],
        ['::-webkit-scrollbar-thumb:hover', `${guard}::-webkit-scrollbar-thumb:hover`],
        ['a:after', `a${guard}:after`],
        ['a::before', `a${guard}::before`],
        ['input:focus', `input:focus${guard}`]
    ]) {
        assert.equal(scopeSelectorOutsideOverlays(before), after);
        assert.equal(scopeSelectorOutsideOverlays(after), after);
    }
});

// この入力群では :where() の中身を除いた id/class/属性・型・疑似クラスを数える。
function specificity(selector) {
    const stripped = selector.replaceAll(guard, '').replace(/::[\w-]+|:(?:before|after|first-line|first-letter)\b/g, '');
    const ids = (stripped.match(/#[\w-]+/g) ?? []).length;
    const classes = (stripped.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const types = (stripped.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g, '')
        .match(/(?:^|[\s>+~,])(?:[a-z][\w-]*)/gi) ?? []).length;
    return [ids, classes, types];
}

test('Theia defaultCssRules の全セレクタを変換し詳細度を保つ', () => {
    const selectors = [
        'body', 'img', 'a', 'a:hover',
        'a:focus, input:focus, select:focus, textarea:focus',
        'code', 'blockquote', 'kbd', '.vscode-light kbd',
        '::-webkit-scrollbar', '::-webkit-scrollbar-thumb',
        '::-webkit-scrollbar-thumb:hover', '::-webkit-scrollbar-thumb:active'
    ];
    for (const selector of selectors) {
        const scoped = scopeSelectorOutsideOverlays(selector);
        assert.equal(scoped.split(guard).length - 1, selector.split(',').length, selector);
        assert.deepEqual(specificity(scoped), specificity(selector), selector);
        assert.equal(scopeSelectorOutsideOverlays(scoped), scoped, selector);
    }
});

function styleRule(selectorText, accepts = true) {
    let value = selectorText;
    return {
        get selectorText() { return value; },
        set selectorText(next) { if (accepts) value = next; }
    };
}

test('CSSOM の通常規則・@media 入れ子・代入拒否を数え、冪等に処理する', () => {
    const img = styleRule('img');
    const kbd = styleRule('kbd');
    const rejected = styleRule('code', false);
    const doc = { getElementById: id => id === '_defaultStyles'
        ? { sheet: { cssRules: [img, { cssRules: [kbd, rejected] }] } }
        : null };
    assert.deepEqual(neutralizeWebviewDefaultStylesForOverlays(doc), { rewritten: 2, failed: 1 });
    assert.equal(img.selectorText, `img${guard}`);
    assert.equal(kbd.selectorText, `kbd${guard}`);
    assert.deepEqual(neutralizeWebviewDefaultStylesForOverlays(doc), { rewritten: 0, failed: 1 });
    assert.deepEqual(neutralizeWebviewDefaultStylesForOverlays({ getElementById: () => null }),
        { rewritten: 0, failed: 0 });
});

test('webview に埋め込んだ関数もモジュール状態に依存せず動く', () => {
    const embeddedScope = (0, eval)(`(${scopeSelectorOutsideOverlays.toString()})`);
    assert.equal(embeddedScope('img'), `img${guard}`);
    const embedded = (0, eval)(`(${neutralizeWebviewDefaultStylesForOverlays.toString()})`);
    const rule = styleRule('a:hover');
    assert.deepEqual(embedded(
        { getElementById: () => ({ sheet: { cssRules: [rule] } }) },
        embeddedScope
    ),
        { rewritten: 1, failed: 0 });
    assert.equal(rule.selectorText, `a:hover${guard}`);
});
