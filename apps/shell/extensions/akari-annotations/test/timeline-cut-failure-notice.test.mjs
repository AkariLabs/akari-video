import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('再生ヘッド分割の失敗は日本語の理由を表示する', async () => {
    const source = await readFile(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const start = source.indexOf('protected async commitTimelineRipple(');
    const end = source.indexOf('protected async performSplitAtPlayhead(', start);
    const method = source.slice(start, end);
    assert.match(method, /this\.showNotice\(`\$\{label\}を実行できません:/);
    assert.match(method, /TypeError\|ReferenceError\|Error/);
});
