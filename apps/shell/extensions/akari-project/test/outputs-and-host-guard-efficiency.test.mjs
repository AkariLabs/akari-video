import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = async name => readFile(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');

test('できたもの一覧は関係ないファイルと字幕・編集本文の更新を無視する', async () => {
    const text = await source('akari-outputs-pane.tsx');
    assert.match(text, /change\.type === FileChangeType\.UPDATED && listed\.has\(key\)/);
    assert.match(text, /this\.pendingMetadataUris\.add\(key\)/);
    assert.match(text, /this\.outputsWatchTimer = setTimeout\(/);
    assert.match(text, /this\.metadataTimer = setTimeout\(/);
    assert.match(text, /refreshOutputMetadata\(root, uris\)/);
});

test('一覧の子 metadata はフォルダ解決一回で取得する', async () => {
    const text = await source('akari-outputs-pane.tsx');
    assert.match(text, /this\.host\.files\.resolve\(dirUri, \{ resolveMetadata: true \}\)/);
    assert.doesNotMatch(text, /for \(const child of stat\.children[^]*?this\.host\.files\.resolve\(child\.resource/);
});

test('ホスト監視は対象を含む DOM の変化だけを調べ、対象なしでは寸法を読まない', async () => {
    const text = await source('browser-host-guard-contribution.ts');
    assert.match(text, /if \(relevant\) this\.schedule\(\)/);
    assert.match(text, /if \(this\.timer !== undefined\) return/);
    assert.match(text, /HOST_OVERLAY_SELECTORS\.flatMap[\s\S]*?\.map\(element => \{ const rect = element\.getBoundingClientRect\(\)/);
    const begin = text.indexOf('private check(): void {');
    const end = text.indexOf('\n    }', begin) + 6;
    let layouts = 0;
    const code = ts.transpileModule(`class Guard { ${text.slice(begin, end)} } return Guard;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Guard = new Function('HOST_OVERLAY_SELECTORS', 'shouldHide', 'document', 'getComputedStyle', 'window', code)(
        ['.overlay'], () => false, { querySelectorAll: () => [] }, () => { layouts++; return { display: 'block' }; },
        { dispatchEvent: () => undefined });
    const guard = new Guard();
    guard.hidden = false;
    guard.check();
    assert.equal(layouts, 0);
});
