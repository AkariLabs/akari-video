import test from 'node:test';
import assert from 'node:assert/strict';
import { HELPER_KINDS, buildHelperConsent, helperPrompt, parseHelperConsent } from '../lib/browser/channel/channel-helper.js';

test('ヘルパーの 5 種類は別の頼み文を作る', () => {
    assert.equal(HELPER_KINDS.length, 5);
    const prompts = HELPER_KINDS.map(kind => helperPrompt(kind, 'テスト'));
    assert.equal(new Set(prompts).size, 5);
    assert.ok(prompts[0].includes('テスト'));
    assert.ok(prompts[0].includes('edit.json'));
    assert.ok(prompts.every(prompt => prompt.includes('勝手に書き換えないで')));
});

test('同意は version 0 のみ読める', () => {
    assert.equal(parseHelperConsent(undefined), undefined);
    assert.equal(parseHelperConsent('{'), undefined);
    assert.equal(parseHelperConsent('{"version":1,"allowed_at":"now"}'), undefined);
    assert.deepEqual(parseHelperConsent(buildHelperConsent('now')), { version: 0, allowed_at: 'now' });
});
