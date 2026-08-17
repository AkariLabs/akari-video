import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_UI } from '../../lib/common/tool-guidance.js';

const ALL_TOOL_IDS = ['ffmpeg', 'whisper', 'chrome', 'yt-dlp', 'voicevox', 'blender', 'xcode-clt'];

test('CLT 未導入向けに推奨表示・非必須説明を持つ', () => {
    const clt = TOOL_UI['xcode-clt'];
    assert.equal(clt.badge, '推奨');
    assert.match(clt.note, /入れなくても動画は作れます/);
    assert.match(clt.note, /導入後に自動で有効/);
    assert.match(`${clt.purpose} ${clt.note}`, /履歴/);
    assert.match(`${clt.purpose} ${clt.note}`, /AI 分析/);
    assert.match(clt.purpose, /文字起こし/);
    assert.match(clt.purpose, /人物マット/);
});

test('VOICEVOX はクレジット表記義務を明示する', () => {
    assert.match(TOOL_UI.voicevox.note, /クレジット表記が必要/);
});

test('FFmpeg はほぼ必須、yt-dlp は既定 ON と明示する', () => {
    assert.match(TOOL_UI.ffmpeg.badge, /ほぼ必須/);
    assert.match(TOOL_UI['yt-dlp'].badge, /既定 ON/);
});

test('install フィールドは廃止されている（コマンド文字列を UI から全廃 — 裁定 A1）', () => {
    for (const id of ALL_TOOL_IDS) {
        assert.equal('install' in TOOL_UI[id], false, `${id} に install フィールドが残っています`);
    }
});

test('全道具に容量目安（sizeLabel）が付与されている（裁定 A4）', () => {
    for (const id of ALL_TOOL_IDS) {
        assert.match(TOOL_UI[id].sizeLabel, /^約 [0-9.]+(MB|GB)/, `${id} の sizeLabel が「約 ...」形式ではありません`);
    }
});

test('sizeLabel にコマンド文字列や URL が紛れ込んでいない', () => {
    for (const id of ALL_TOOL_IDS) {
        const info = TOOL_UI[id];
        assert.doesNotMatch(info.sizeLabel, /brew|winget|xcode-select|https?:\/\//);
        assert.doesNotMatch(info.purpose, /brew|winget|xcode-select|https?:\/\//);
        if (info.note) {
            assert.doesNotMatch(info.note, /brew|winget|xcode-select|https?:\/\//);
        }
    }
});
