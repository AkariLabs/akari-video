import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-shell-inner-chrome.ts', import.meta.url), 'utf8');
const css = source.match(/export const SHELL_INNER_CHROME_CSS = `([\s\S]*?)`;/)?.[1] ?? '';

test('Theia ダイアログの帯と通常の外枠をテーマ化し、独自ポップアップの枠を除外する', () => {
    assert.match(css, /#theia-dialog-shell \.dialogTitle\s*\{[^}]*background-color: var\(--akari-card\);[^}]*color: var\(--akari-ink\);[^}]*border-bottom: 1px solid var\(--akari-line-inner\);/s);
    const blockRule = css.match(/(#theia-dialog-shell[^\n]*\.dialogBlock)\s*\{([^}]*)\}/);
    assert.ok(blockRule);
    assert.match(blockRule[2], /border: 1px solid var\(--akari-line\);/);
    for (const host of ['akari-export-dialog-host', 'akari-voice-record-dialog-host', 'akari-lint-results-dialog',
        'akari-rough-canvas-host', 'akari-voice-dict-dialog']) {
        assert.ok(blockRule[1].includes(`:not(.${host})`), host);
    }
    assert.doesNotMatch(blockRule[2], /!important/);
});

test('下ドックの行と追加ボタンを 20px に収め、11px の文字とアイコンを保つ', () => {
    const bottom = '#theia-app-shell #theia-bottom-content-panel .lm-TabBar.theia-app-centers';
    const rowStart = css.indexOf(bottom + ' .theia-tabBar-tab-row,');
    assert.ok(rowStart >= 0);
    const rowOpen = css.indexOf('{', rowStart);
    const rowSelectors = css.slice(rowStart, rowOpen);
    const rowBody = css.slice(rowOpen + 1, css.indexOf('}', rowOpen));
    for (const selector of ['.theia-tabBar-tab-row', '.lm-TabBar-content-container', '.lm-TabBar-addButton']) {
        assert.ok(rowSelectors.includes(bottom + ' ' + selector), selector);
    }
    for (const declaration of ['height: 20px;', 'min-height: 20px;', 'max-height: 20px;']) {
        assert.ok(rowBody.includes(declaration), declaration);
    }
    const addStart = css.indexOf(bottom + ' .lm-TabBar-addButton {', rowOpen);
    assert.ok(addStart > rowOpen);
    assert.ok(css.slice(addStart, css.indexOf('}', addStart)).includes('line-height: 20px;'));
    for (const label of ['.theia-tab-icon-label', '.lm-TabBar-tabLabel']) {
        assert.match(css, new RegExp(`${bottom.replaceAll('.', '\\.')}[^{}]*${label.replaceAll('.', '\\.')}[^{}]*\\{\\s*line-height: 16px;`));
    }
    const closeSelector = bottom + ' .lm-TabBar-tab > .lm-TabBar-tabCloseIcon {';
    const closeStart = css.indexOf(closeSelector);
    assert.ok(closeStart >= 0);
    const closeBody = css.slice(closeStart + closeSelector.length, css.indexOf('}', closeStart));
    for (const declaration of ['line-height: 14px;', 'width: 14px;', 'height: 14px;', 'padding: 0;']) {
        assert.ok(closeBody.includes(declaration), declaration);
    }
    assert.equal(closeBody.includes('font:'), false);
    assert.equal(closeBody.includes('font-size:'), false);
    const sharedStart = css.indexOf(bottom + ' .lm-TabBar-tabCloseIcon {');
    assert.ok(sharedStart >= 0);
    assert.ok(css.slice(sharedStart, css.indexOf('}', sharedStart)).includes('font-size: 11px;'));
});

test('shell chrome blocks UI text selection and restores content areas', () => {
    assert.match(css, /(?:body|#theia-app-shell)\s*\{[^}]*user-select:\s*none/s);
    for (const selector of ['input', 'textarea', '[contenteditable', '.xterm', '.monaco-editor', '.akari-daihon-', '#akari-partner-onboarding']) {
        assert.ok(css.includes(selector), `${selector} must remain selectable`);
    }
    assert.match(css, /user-select:\s*text/);
});

test('Ctrl/Cmd+A suppresses only the browser page selection', () => {
    assert.match(source, /reachedState\('ready'\)\.then\([\s\S]*?addEventListener\('keydown', this\.onSelectAllKeyDown, true\)/);
    const match = source.match(/export function shouldSuppressShellSelectAll\([\s\S]*?\n\}/);
    assert.ok(match, 'focus and key decision is exported for isolated testing');
    const selector = source.match(/export const SELECTABLE_TEXT_FOCUS_SELECTOR = .*;/)?.[0];
    const focusCheck = source.match(/export function isSelectableTextFocus\([\s\S]*?\n\}/)?.[0];
    assert.ok(selector && focusCheck);
    const js = ts.transpileModule(`${selector}\n${focusCheck}\n${match[0]}\nexports.check = shouldSuppressShellSelectAll;`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const context = { exports: {} };
    vm.runInNewContext(js, context);
    const check = context.exports.check;
    const focus = selector => ({ closest: query => query.includes(selector) ? {} : null });
    const key = (overrides = {}) => ({ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false,
        altKey: false, defaultPrevented: false, isComposing: false, ...overrides });
    assert.equal(check(key(), null), true);
    assert.equal(check(key({ metaKey: true, ctrlKey: false }), null), true);
    assert.equal(check(key({ defaultPrevented: true }), null), false, 'Theia handled its command first');
    assert.equal(check(key({ shiftKey: true }), null), false);
    assert.equal(check(key({ isComposing: true }), null), false);
    for (const selector of ['input', 'textarea', '[contenteditable', '.xterm', '.monaco-editor',
        '#akari-partner-onboarding', '.markdown-body', '.theia-markdown']) {
        assert.equal(check(key(), focus(selector)), false, selector);
    }
});
