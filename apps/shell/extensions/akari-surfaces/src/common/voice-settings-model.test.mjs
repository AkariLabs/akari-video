import assert from 'node:assert/strict';
import test from 'node:test';
import { falKeyAvailable, settingsVoiceEngineValue, voiceAvatarLabel, voiceMigrationAvatar, voiceSettingsActions } from '../../lib/common/voice-settings-model.js';

test('fal needs は鍵あり、移行先は meta → 唯一 → me → ウィザード既定順', () => {
    assert.equal(falKeyAvailable({ id: 'fal-qwen3', availability: { state: 'needs' } }), true);
    assert.equal(falKeyAvailable({ id: 'fal-qwen3', availability: { state: 'unconfigured' } }), false);
    const single = [{ id: 'sample', displayName: 'サンプル' }];
    assert.equal(voiceMigrationAvatar('recorded', single), 'recorded');
    assert.equal(voiceMigrationAvatar(null, single), 'sample');
    assert.equal(voiceMigrationAvatar(null, []), 'me');
    assert.equal(voiceMigrationAvatar(null, [{ id: 'z' }, { id: 'ryoma' }]), 'ryoma');
    assert.equal(voiceMigrationAvatar(null, [{ id: 'z' }, { id: 'a' }]), 'a');
    assert.equal(voiceAvatarLabel('sample', single), 'サンプル');
    assert.equal(settingsVoiceEngineValue('voice:gone', []), 'voicevox');
    assert.equal(settingsVoiceEngineValue('voice:owner-ja', [], false), 'voice:owner-ja');
    assert.equal(settingsVoiceEngineValue('voice:sample', [{ id: 'sample' }]), 'voice:sample');
});

test('設定の行は旧い声を移行だけに絞り、同意・照合・stale で写し操作を出す', () => {
    const base = { id: 'p', label: '私', avatar: 'me', engines: [], consent: { self_voice: true, cloud_upload: true },
        verification: { score: .9 }, copies: {} };
    const empty = voiceSettingsActions(base, true, true);
    assert.deepEqual([empty.addIrodori, empty.addFal, empty.remove], [true, true, true]);
    const old = voiceSettingsActions({ ...base, legacy: true }, true, true);
    assert.deepEqual([old.migrate, old.rename, old.remove, old.addFal], [true, false, false, false]);
    const stale = voiceSettingsActions({ ...base, engines: ['irodori', 'fal-qwen3'],
        copies: { irodori: { stale: true }, 'fal-qwen3': { stale: true } } }, true, true);
    assert.deepEqual([stale.addIrodori, stale.addFal, stale.remakeIrodori, stale.remakeFal], [false, false, true, true]);
    assert.equal(voiceSettingsActions({ ...base, verification: { status: 'unavailable' } }, true, true).addFal, false);
    assert.equal(voiceSettingsActions({ ...base, duration_s: 20 }, true, true, true).addGemini, true);
    assert.equal(voiceSettingsActions({ ...base, duration_s: 40 }, true, true, true).addGemini, true);
    assert.equal(voiceSettingsActions({ ...base, duration_s: 9 }, true, true, true).addGemini, false);
    assert.equal(voiceSettingsActions({ ...base, duration_s: 20 }, true, true, false).addGemini, false);
    const geminiStale = { ...base, engines: ['gemini-3.8-flash-tts'], copies: { 'gemini-3.8-flash-tts': { stale: true } } };
    assert.equal(voiceSettingsActions({ ...geminiStale, duration_s: 40 }, true, true, true).remakeGemini, true);
    assert.equal(voiceSettingsActions({ ...geminiStale, duration_s: 9 }, true, true, true).remakeGemini, false);
});
