import assert from 'node:assert/strict';
import { readSourceFile } from './helpers/widget-source.mjs';
import test from 'node:test';

const source = readSourceFile('widget').text;

test('a later successful lint clears only the stale lint failure banner', () => {
    const start = source.indexOf('protected showDeferredLintResult');
    const end = source.indexOf('protected async reloadAll', start);
    const method = source.slice(start, end);
    assert.match(method, /if \(pass\)[\s\S]*deferredLintFooterMessage\?\.parentElement === this\.footer[\s\S]*replaceChildren\(\)[\s\S]*deferredLintFooterMessage = undefined/);
    assert.match(method, /this\.deferredLintFooterMessage = message/);
});

test('pass verdict でも対象 transition warning は、古い失敗表示を片付けてからフッターへ出す', () => {
    const start = source.indexOf('protected showDeferredLintResult');
    const end = source.indexOf('protected async reloadAll', start);
    const method = source.slice(start, end);
    const cleanup = method.indexOf('this.deferredLintFooterMessage = undefined');
    const summarize = method.indexOf('japaneseLintWarningSummary(findings)');
    assert.ok(cleanup >= 0 && summarize > cleanup, method);
    assert.match(method, /if \(pass\)[\s\S]*deferredLintFooterMessage\?\.parentElement === this\.footer[\s\S]*replaceChildren\(\)/u);
    assert.match(method, /this\.footer\.textContent = warningSummary/u);
    assert.match(method, /this\.messages\.warn\(warningSummary\)/u);
});
