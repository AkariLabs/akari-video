import assert from 'node:assert/strict';
import test from 'node:test';
import { isVibePreviewEnabled, VIBE_PREVIEW_KEY } from '../lib/common/vibe-preview.js';
import { readFileSync } from 'node:fs';

test('設定の写しは 1 だけを on とし、欠落・壊れた値・読み取り失敗は off', () => {
    for (const value of [null, '0', 'true', 'broken']) {
        assert.equal(isVibePreviewEnabled({ getItem: () => value }), false);
    }
    assert.equal(isVibePreviewEnabled({ getItem: () => '1' }), true);
    assert.equal(isVibePreviewEnabled(undefined), false);
    assert.equal(isVibePreviewEnabled({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('設定宣言と各拡張の文字列ミラーは同じキーを使う', () => {
    const root = new URL('../../', import.meta.url);
    for (const relative of [
        'akari-surfaces/src/browser/akari-preferences.ts',
        'akari-surfaces/src/common/settings-sections.ts',
        'akari-shell-strip/src/browser/akari-right-panel-handler.ts',
        'akari-annotations/src/browser/rough-canvas-commands.ts',
        'akari-annotations/src/browser/akari-annotations-contribution.ts',
        'akari-annotations/src/browser/tasks/task-commands.ts',
        'akari-annotations/src/browser/tasks/task-board-widget.ts',
        'akari-project/src/browser/akari-import-fab.tsx',
        'akari-project/src/browser/browser-commands.ts',
        'akari-project/src/browser/browser-open-listener.ts'
    ]) {
        assert.ok(readFileSync(new URL(relative, root), 'utf8').includes(`'${VIBE_PREVIEW_KEY}'`), relative);
    }
});

test('公開コマンドの isEnabled と isVisible は同じプレビュー判定を使う', () => {
    const root = new URL('../../', import.meta.url);
    for (const relative of [
        'akari-vibe-dock/src/browser/voice-dictionary-frontend-module.ts',
        'akari-annotations/src/browser/rough-canvas-commands.ts',
        'akari-annotations/src/browser/tasks/task-commands.ts',
        'akari-project/src/browser/browser-commands.ts'
    ]) {
        const source = readFileSync(new URL(relative, root), 'utf8');
        assert.match(source, /isEnabled:.*(?:previewEnabled|isVibePreviewEnabled)/);
        assert.match(source, /isVisible:.*(?:previewEnabled|isVibePreviewEnabled)/);
    }
});
