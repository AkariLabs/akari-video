import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { partnerReviewTarget, insertReviewText } = require('../lib/browser/partner-review-target.js');
const catalog = [
    { form: 'cli', agent: 'claude', name: 'Claude Code CLI' },
    { form: 'cli', agent: 'codex', name: 'Codex CLI' },
    { form: 'extension', agent: 'claude', name: 'Claude Code 拡張', viewContainerIds: ['claude-sidebar'] }
];

test('右パネルの前面ウィジェットから渡し先を判定する', () => {
    assert.deepEqual(partnerReviewTarget({ id: 'pty-1', kind: 'akari-partner', agent: 'claude' }, catalog),
        { kind: 'terminal', name: 'Claude Code' });
    assert.deepEqual(partnerReviewTarget({ id: 'pty-2', kind: 'akari-partner', agent: 'codex' }, catalog),
        { kind: 'terminal', name: 'Codex' });
    assert.deepEqual(partnerReviewTarget({ id: 'akari-partner-web', caption: 'DeepSeek Harness' }, catalog),
        { kind: 'web', name: 'DeepSeek Harness' });
    assert.deepEqual(partnerReviewTarget({ id: 'plugin-view-container:claude-sidebar' }, catalog),
        { kind: 'extension', name: 'Claude Code 拡張' });
    assert.deepEqual(partnerReviewTarget({ id: 'akari-chat-widget' }, catalog), { kind: 'chat', name: 'AKARI' });
    assert.equal(partnerReviewTarget({ id: 'unrelated' }, catalog), undefined);
});

test('PTY へ文章を書くだけで Enter を押さない', () => {
    const writes = [];
    insertReviewText({ sendText: text => writes.push(text) }, '[レビュー] 確認してください\n');
    assert.deepEqual(writes, ['[レビュー] 確認してください\n']);
    assert.equal(writes[0].includes('\r'), false);
});
