import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELPER_KINDS, HELPER_ROW_DESCRIPTION, HELPER_NO_PARTNER_TEXT,
    buildHelperConsent, helperPrompt, parseHelperConsent } from '../lib/browser/channel/channel-helper.js';

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

test('ヘルパーの説明と同意見出しを AI の文言に揃える', () => {
    assert.equal(HELPER_ROW_DESCRIPTION, '過去の動画と会話から、設計・デザイン・辞書・人とモノに足す候補を出します');
    assert.match(HELPER_NO_PARTNER_TEXT, /AI に整えてもらえます/);
    const source = readFileSync(new URL('../src/browser/channel/channel-helper.ts', import.meta.url), 'utf8');
    assert.match(source, /React\.createElement\('h3', null, 'AI に整えてもらう'\)/);
});
