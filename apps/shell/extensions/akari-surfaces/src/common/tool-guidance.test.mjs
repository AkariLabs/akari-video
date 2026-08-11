import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_UI } from '../../lib/common/tool-guidance.js';

test('CLT 未導入向けに推奨表示・非必須説明・xcode-select --install 手順を持つ', () => {
    const clt = TOOL_UI['xcode-clt'];
    assert.equal(clt.badge, '推奨');
    assert.match(clt.note, /入れなくても動画は作れます/);
    assert.match(clt.note, /導入後に自動で有効/);
    assert.match(clt.install, /xcode-select --install/);
});

test('VOICEVOX はクレジット表記義務を明示する', () => {
    assert.match(TOOL_UI.voicevox.note, /クレジット表記が必要/);
});

test('FFmpeg はほぼ必須、yt-dlp は既定 ON と明示する', () => {
    assert.match(TOOL_UI.ffmpeg.badge, /ほぼ必須/);
    assert.match(TOOL_UI['yt-dlp'].badge, /既定 ON/);
});
