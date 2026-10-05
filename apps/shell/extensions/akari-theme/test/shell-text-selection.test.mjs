import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-shell-inner-chrome.ts', import.meta.url), 'utf8');
const css = source.match(/export const SHELL_INNER_CHROME_CSS = `([\s\S]*?)`;/)?.[1] ?? '';

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
