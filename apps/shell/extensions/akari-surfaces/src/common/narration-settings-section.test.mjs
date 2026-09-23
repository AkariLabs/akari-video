import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_SECTIONS, SECTION_PREFERENCE_KEYS, sectionForPreferenceKey } from '../../lib/common/settings-sections.js';

test('読み上げ節は文字起こしの直後にあり、narration の設定キーを所有する', () => {
    const ids = SETTINGS_SECTIONS.map(section => section.id);
    assert.equal(ids[ids.indexOf('transcribe') + 1], 'narration');
    assert.deepEqual(SECTION_PREFERENCE_KEYS.narration, ['akari.narration.engine', 'akari.narration.voice']);
    assert.equal(sectionForPreferenceKey('akari.narration.engine'), 'narration');
    assert.equal(sectionForPreferenceKey('akari.narration.voice'), 'narration');
    assert.equal(sectionForPreferenceKey('akari.narration.future'), 'narration');
});
