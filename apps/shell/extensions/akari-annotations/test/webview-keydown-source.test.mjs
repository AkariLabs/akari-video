import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { webviewKeydownSource } from '../lib/browser/webview-keydown-source.js';

const frame = (name) => ({ tagName: 'IFRAME', name });
const owner = (viewType, ...frames) => ({ viewType, node: { contains: other => frames.includes(other) } });

test('Akari の webview（プレビュー）からの再送だけをタイムラインのキーにする', () => {
    const preview = frame('preview');
    const codex = frame('codex');
    const webviews = [owner('akari.preview', preview), owner('chatgpt.sidebarView', codex)];
    assert.equal(webviewKeydownSource(preview, preview, webviews), 'akari');
    assert.equal(webviewKeydownSource(null, preview, webviews), 'akari');
    // Claude Code / Codex の拡張の入力欄で打ったキー（Space・T など）はタイムラインに渡さない
    assert.equal(webviewKeydownSource(codex, codex, webviews), 'foreign');
    assert.equal(webviewKeydownSource(owner('x').node, codex, webviews), 'foreign');
});

test('持ち主の分からない iframe は打鍵とみなし、iframe でなければ対象外', () => {
    assert.equal(webviewKeydownSource(frame('stray'), null, []), 'foreign');
    assert.equal(webviewKeydownSource({ tagName: 'DIV' }, { tagName: 'TEXTAREA' }, []), 'none');
    assert.equal(webviewKeydownSource(null, null, []), 'none');
    assert.equal(webviewKeydownSource(frame('untyped'), null, [owner(undefined, frame('other'))]), 'foreign');
});

test('ショートカットの文脈とタイムラインの受け口が同じ判定を使う', () => {
    const keybindings = readFileSync(new URL('../src/browser/akari-shortcut-keybindings.ts', import.meta.url), 'utf8');
    assert.match(keybindings, /setContext\('akariEditableFocus', foreignWebview \|\|/u);
    assert.match(keybindings, /setContext\('akariHistoryEditableFocus',\s+foreignWebview \|\|/u);
    const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    assert.match(widget, /if \(webviewSource === 'foreign'\) return;/u);
});
