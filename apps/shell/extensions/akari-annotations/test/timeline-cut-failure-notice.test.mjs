import { setLanguage, t } from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('再生ヘッド分割の失敗は日本語の理由を表示する', async () => {
    const source = await readFile(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const start = source.indexOf('protected async commitTimelineRipple(');
    const end = source.indexOf('protected async performSplitAtPlayhead(', start);
    const method = source.slice(start, end);
    assert.match(method, /this\.showNotice\(t\('annotations\.annotationsWidget\.ui\.couldNotRunError'/);
    try {
        setLanguage('ja');
        assert.equal(t('annotations.annotationsWidget.ui.couldNotRunError', { label: '分割', message: '理由' }), '分割を実行できません: 理由');
    } finally { setLanguage(undefined); }
    assert.match(method, /TypeError\|ReferenceError\|Error/);
});
