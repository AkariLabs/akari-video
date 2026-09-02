import test from 'node:test';
import assert from 'node:assert/strict';
import {
    describeOutput,
    EXPORT_QUALITY_CHOICES,
    EXPORT_SETTING_SEATS,
    isMasterSelectable,
    qualityChoiceForCli
} from '../lib/common/export-settings.js';

test('3 択は標準 / 高画質 / 軽量を CLI 値へ対応させる', () => {
    assert.deepEqual(EXPORT_QUALITY_CHOICES.map(choice => [choice.label, choice.id]), [
        ['標準', 'standard'], ['高画質', 'high'], ['軽量', 'light']
    ]);
    assert.equal(qualityChoiceForCli('high')?.label, '高画質');
    assert.equal(qualityChoiceForCli('master'), undefined);
});

test('マスターは x264 のときだけ選べる', () => {
    assert.equal(isMasterSelectable('x264'), true);
    assert.equal(isMasterSelectable('auto'), false);
    assert.equal(isMasterSelectable('videotoolbox'), false);
});

test('近日の席を 12 個以上、tooltip つきで保持する', () => {
    const unavailable = EXPORT_SETTING_SEATS.filter(seat => !seat.available);
    assert.ok(unavailable.length >= 12);
    assert.ok(unavailable.every(seat => seat.tooltip));
});

test('describeOutput: 現在の固定出力を 4 行で返す', () => {
    const lines = describeOutput({
        quality: 'standard', engine: 'auto', encoder: 'auto', fps: undefined,
        outputDirectoryUri: undefined, rerunLint: true, saveAsDefault: false
    }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map(line => line.label), ['形式', '画素数', '音', '色']);
    assert.match(lines[1].value, /1920 × 1080/);
});
