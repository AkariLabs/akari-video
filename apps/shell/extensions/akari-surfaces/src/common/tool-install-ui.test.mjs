import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deriveToolSelection,
    describeToolInstallOutcome,
    filterInstallableSelection,
    formatInstallProgressLabel,
    shortenHomePath
} from '../../lib/common/tool-install-ui.js';

test('unsupported は初回にも previous に残っていても選択しない', () => {
    const tools = [
        { id: 'speech-analyzer', available: false, unsupported: true },
        { id: 'whisper', available: false, needs: ['モデルが無い'] }
    ];
    assert.deepEqual([...deriveToolSelection(tools)], ['whisper']);
    const previous = {
        selectedIds: new Set(['speech-analyzer', 'whisper']),
        unavailableIds: new Set(['speech-analyzer', 'whisper'])
    };
    assert.deepEqual([...deriveToolSelection(tools, previous)], ['whisper']);
});

test('手動で選ばれた unsupported・導入済み・現在の票にない id も導入件数と対象から除外する', () => {
    const selected = new Set(['speech-analyzer', 'ffmpeg', 'whisper', 'blender']);
    const tools = [
        { id: 'speech-analyzer', available: false, unsupported: true },
        { id: 'ffmpeg', available: true },
        { id: 'whisper', available: false }
    ];
    const filtered = filterInstallableSelection(tools, selected);
    assert.deepEqual([...filtered], ['whisper']);
    assert.equal(filtered.size, 1);
    assert.equal(filterInstallableSelection(tools, new Set(['speech-analyzer'])).size, 0);
    assert.equal(selected.size, 4, '元の選択は変更しない');
});

test('skipped は手動導入の 1 行、message があればその案内を表示する', () => {
    const result = { id: 'speech-analyzer', outcome: 'skipped' };
    const label = describeToolInstallOutcome(result, 'SpeechAnalyzer');
    assert.match(label, /手動で入れる/);
    assert.doesNotMatch(label, /\n|失敗/);
    assert.equal(describeToolInstallOutcome({ ...result, message: '手動の案内' }, 'SpeechAnalyzer'), '手動の案内');
});

test('初回チェック（previous 無し）は未導入の道具を全部 既定 ON にする', () => {
    const tools = [
        { id: 'ffmpeg', available: false },
        { id: 'blender', available: true },
        { id: 'yt-dlp', available: false }
    ];
    const selection = deriveToolSelection(tools);
    assert.deepEqual([...selection].sort(), ['ffmpeg', 'yt-dlp']);
});

test('再チェックでもユーザーが外したチェックは尊重される（同じ道具が引き続き未導入のとき）', () => {
    const tools = [{ id: 'ffmpeg', available: false }, { id: 'yt-dlp', available: false }];
    const previous = {
        selectedIds: new Set(['yt-dlp']), // ffmpeg のチェックをユーザーが外していた
        unavailableIds: new Set(['ffmpeg', 'yt-dlp'])
    };
    const selection = deriveToolSelection(tools, previous);
    assert.deepEqual([...selection].sort(), ['yt-dlp']);
});

test('新たに未導入と判明した道具は既定 ONに戻る（前回は無かった/導入済みだった）', () => {
    const tools = [
        { id: 'ffmpeg', available: false }, // 前回は available だった
        { id: 'blender', available: false } // 前回は結果に無かった
    ];
    const previous = { selectedIds: new Set(), unavailableIds: new Set() };
    const selection = deriveToolSelection(tools, previous);
    assert.deepEqual([...selection].sort(), ['blender', 'ffmpeg']);
});

test('導入済みになった道具は選択集合から外れる', () => {
    const tools = [{ id: 'ffmpeg', available: true }];
    const previous = { selectedIds: new Set(['ffmpeg']), unavailableIds: new Set(['ffmpeg']) };
    const selection = deriveToolSelection(tools, previous);
    assert.equal(selection.size, 0);
});

test('進捗表示文字列は「インストール中: 名前 (i/total)…」形式', () => {
    assert.equal(formatInstallProgressLabel('FFmpeg', 1, 3), 'インストール中: FFmpeg (1/3)…');
});

test('結果 3 値のマッピング: message があればそのまま使う', () => {
    assert.equal(
        describeToolInstallOutcome({ id: 'ffmpeg', outcome: 'failed', message: 'ネットワークエラーです。' }, 'FFmpeg'),
        'ネットワークエラーです。'
    );
});

test('結果 3 値のマッピング: message 無しは outcome からフォールバック文言を組み立てる', () => {
    assert.match(describeToolInstallOutcome({ id: 'ffmpeg', outcome: 'installed' }, 'FFmpeg'), /導入しました/);
    assert.match(describeToolInstallOutcome({ id: 'blender', outcome: 'external-installer-opened' }, 'Blender'), /開きました/);
    assert.match(describeToolInstallOutcome({ id: 'blender', outcome: 'failed' }, 'Blender'), /失敗/);
});

test('作成先パスはホーム配下のとき ~/ に短縮される', () => {
    assert.equal(shortenHomePath('/Users/fixture/Akari', '/Users/fixture'), '~/Akari');
    assert.equal(shortenHomePath('/Users/fixture', '/Users/fixture'), '~');
    assert.equal(shortenHomePath('/opt/data/Akari', '/Users/fixture'), '/opt/data/Akari');
});

test('作成先パスは homeDir 不明のときそのまま返す', () => {
    assert.equal(shortenHomePath('/Users/fixture/Akari', undefined), '/Users/fixture/Akari');
});
