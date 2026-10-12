import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldResumeChat, shouldShowChatCard, visibleReviewKind, visibleLastPartner } = require('../lib/browser/partner-chat-visibility.js');

test('オフでは前回のチャットを再開せずカードも添付先の chat も出さない', () => {
    assert.equal(shouldResumeChat('akari-chat', false), false);
    assert.equal(visibleLastPartner('akari-chat', false), false);
    assert.equal(visibleLastPartner('claude', false), true);
    assert.equal(shouldShowChatCard(false), false);
    assert.equal(visibleReviewKind('chat', false), false);
    assert.equal(visibleReviewKind('terminal', false), true);
    assert.equal(shouldResumeChat('akari-chat', true), true);
    assert.equal(shouldShowChatCard(true), true);
    assert.equal(visibleReviewKind('chat', true), true);
    assert.equal(shouldResumeChat('claude', true), false);
});
