import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readVibeMode, effectiveVibeMode, migrateVibeMode, resolveEarEngine } = require('../lib/common/vibe-mode.js');
const preferences = (globalValue, workspaceValue) => ({ inspect: () => ({ globalValue, workspaceValue }) });

test('モードは利用者の値だけを読み、未設定と不正値はメモのみ', () => {
    for (const value of [undefined, null, 'invalid', 1]) {
        assert.equal(readVibeMode(preferences(value, 'full')), 'off');
    }
    for (const value of ['off', 'screen', 'full']) {
        assert.equal(readVibeMode(preferences(value, 'off')), value);
    }
});

test('つながりとライブの状態で実効値を制限し、保存値には触れない', () => {
    const source = { mode: 'full', companionEnabled: true, liveAvailable: true };
    assert.deepEqual(effectiveVibeMode(source), { mode: 'full', locked: false });
    assert.match(effectiveVibeMode({ ...source, companionEnabled: false }).reason, /つながりがオフ/);
    assert.match(effectiveVibeMode({ ...source, liveAvailable: false }).reason, /未対応/);
    assert.equal(effectiveVibeMode({ ...source, companionEnabled: false }).mode, 'off');
    assert.equal(source.mode, 'full');
});

test('既に使った人だけを初回移行し、保存済みの値には触れない', () => {
    assert.equal(migrateVibeMode({ stored: undefined, privacyNoticeSeen: true }), 'full');
    assert.equal(migrateVibeMode({ stored: undefined, privacyNoticeSeen: false }), undefined);
    assert.equal(migrateVibeMode({ stored: 'off', privacyNoticeSeen: true }), undefined);
});

test('エンジンは利用可能な選択肢へ解決する', () => {
    const caps = { engines: [
        { id: 'speechanalyzer-live', available: false },
        { id: 'record-then-transcribe', available: true }
    ] };
    const selected = value => ({ inspect: () => ({ globalValue: value }) });
    assert.equal(resolveEarEngine(selected('auto'), caps), 'record-then-transcribe');
    assert.equal(resolveEarEngine(selected('speechanalyzer-live'), caps), 'record-then-transcribe');
    assert.equal(resolveEarEngine(selected('record-then-transcribe'), caps), 'record-then-transcribe');
    assert.equal(resolveEarEngine(selected('auto'), { engines: [] }), undefined);
});
