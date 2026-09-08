import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveToolRowState, describeToolAvailabilityLabel, shouldShowToolNote, SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE, TOOL_UI } from '../../lib/common/tool-guidance.js';

test('SpeechAnalyzer の準備案内は利用可能なら隠し、未準備なら表示する', () => {
    assert.equal(shouldShowToolNote({ id: 'speech-analyzer', available: true }), false);
    assert.equal(shouldShowToolNote({ id: 'speech-analyzer', available: false }), true);
});

test('Command Line Tools の案内は導入済みなら隠し、未導入なら表示する', () => {
    assert.equal(shouldShowToolNote({ id: 'xcode-clt', available: true }), false);
    assert.equal(shouldShowToolNote({ id: 'xcode-clt', available: false }), true);
});

test('VOICEVOX のクレジット表記は導入済みでも表示する', () => {
    assert.equal(shouldShowToolNote({ id: 'voicevox', available: true }), true);
    assert.equal(shouldShowToolNote({ id: 'voicevox', available: false }), true);
});

test('note のない FFmpeg は導入状態にかかわらず note を表示しない', () => {
    assert.equal(shouldShowToolNote({ id: 'ffmpeg', available: true }), false);
    assert.equal(shouldShowToolNote({ id: 'ffmpeg', available: false }), false);
});

test('unsupported 行: OS の札、チェックボックスなし（needs や available より優先）', () => {
    for (const available of [false, true]) {
        const tool = { available, unsupported: true, needs: ['Command Line Tools が無い'] };
        assert.deepEqual(deriveToolRowState(tool), { label: 'この OS では使えない', showCheckbox: false });
        assert.equal(describeToolAvailabilityLabel(tool), 'この OS では使えない');
    }
});

test('サポート内で needs がある行: 中黒で連結した準備の札、チェックボックスあり', () => {
    assert.deepEqual(deriveToolRowState({ available: false, needs: ['本体が無い', 'モデルが無い'] }), {
        label: '準備が要る（本体が無い・モデルが無い）', showCheckbox: true
    });
});

test('通常行: 既存の導入済み・未導入文言とチェックボックス有無を保つ', () => {
    assert.deepEqual(deriveToolRowState({ available: true, needs: [] }), { label: 'インストール済み', showCheckbox: false });
    assert.deepEqual(deriveToolRowState({ available: false }), { label: '未インストール', showCheckbox: true });
});

test('macOS 実機と同じ利用可能な SpeechAnalyzer は「使える」でチェックボックスなし', () => {
    const tool = { id: 'speech-analyzer', available: true };
    assert.equal(describeToolAvailabilityLabel(tool), '使える');
    assert.deepEqual(deriveToolRowState(tool), { label: '使える', showCheckbox: false });
});

test('非対応の SpeechAnalyzer は OS の札でチェックボックスなし', () => {
    const tool = { id: 'speech-analyzer', available: false, unsupported: true };
    assert.equal(describeToolAvailabilityLabel(tool), 'この OS では使えない');
    assert.deepEqual(deriveToolRowState(tool), { label: 'この OS では使えない', showCheckbox: false });
});

test('サポート内の未準備な SpeechAnalyzer は準備の札でチェックボックスを維持する', () => {
    const tool = { id: 'speech-analyzer', available: false };
    assert.deepEqual(deriveToolRowState(tool), { label: '準備が要る', showCheckbox: true });
    assert.deepEqual(deriveToolRowState({ ...tool, needs: ['Command Line Tools が無い', '準備の確認が必要'] }), {
        label: '準備が要る（Command Line Tools が無い・準備の確認が必要）', showCheckbox: true
    });
});

test('OS 付属以外の道具は id があっても既存の札を維持する', () => {
    const tool = { id: 'whisper', available: false };
    assert.equal(describeToolAvailabilityLabel(tool), '未インストール');
    assert.equal(describeToolAvailabilityLabel({ ...tool, available: true }), 'インストール済み');
    assert.equal(describeToolAvailabilityLabel({ ...tool, needs: ['本体が無い', 'モデルが無い'] }), '準備が要る（本体が無い・モデルが無い）');
    assert.equal(describeToolAvailabilityLabel({ ...tool, unsupported: true }), 'この OS では使えない');
});

test('SpeechAnalyzer の手動案内は UI と導入処理で共有する正本を持つ', () => {
    assert.equal(TOOL_UI['speech-analyzer'].note, SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE);
    assert.match(SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE, /macOS 26 以上/);
    assert.match(SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE, /Command Line Tools.*xcode-select --install/);
});

const ALL_TOOL_IDS = ['ffmpeg', 'whisper', 'yt-dlp', 'voicevox', 'blender', 'xcode-clt'];

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

test('SpeechAnalyzer guidance points to the existing macOS CLT installer', () => {
    assert.equal(TOOL_UI['speech-analyzer'].name, 'SpeechAnalyzer');
    assert.equal(TOOL_UI['speech-analyzer'].badge, '推奨');
    assert.match(TOOL_UI['speech-analyzer'].note, /macOS 26/);
    assert.match(TOOL_UI['speech-analyzer'].note, /Command Line Tools/);
});
