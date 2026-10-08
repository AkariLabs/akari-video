import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { railNameForPartner } = require('../lib/common/partner-rail-name.js');

test('パートナーの名前を右レール用に短くする', () => {
    assert.equal(railNameForPartner('terminal-1', 'チャット', 'Claude Code CLI'), 'Claude');
    assert.equal(railNameForPartner('terminal-2', 'チャット · Codex CLI', 'Codex CLI'), 'Codex');
    assert.equal(railNameForPartner('terminal-3', 'チャット', 'opencode CLI'), 'opencode');
    assert.equal(railNameForPartner('akari-partner-web', 'チャット（DeepSeek）', 'DeepSeek Harness'), 'DeepSeek');
    assert.equal(railNameForPartner('akari-partner-onboarding', 'パートナーを追加'), 'パートナー');
    assert.equal(railNameForPartner('terminal-4', 'チャット'), 'チャット');
    // 実機の端末の caption は「<名前>（<起動モード>）」
    assert.equal(railNameForPartner('terminal-5', 'チャット', 'Claude Code CLI（自動モードで起動）'), 'Claude');
    assert.equal(railNameForPartner('terminal-6', 'チャット', 'Codex CLI（毎回確認）'), 'Codex');
});

test('カタログの CLI と Web の名前はすべて表示できる', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../akari-partner/src/common/partner-catalog.json', import.meta.url), 'utf8'));
    for (const entry of catalog.filter(item => item.form === 'cli' || item.form === 'web')) {
        const name = railNameForPartner(entry.form === 'web' ? 'akari-partner-web' : 'terminal-1', 'チャット', entry.name);
        assert.ok(name, entry.name);
        assert.doesNotMatch(name, /CLI|Harness/, entry.name);
    }
});
