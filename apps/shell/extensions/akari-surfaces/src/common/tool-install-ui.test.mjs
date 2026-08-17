import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deriveToolSelection,
    describeToolInstallOutcome,
    formatInstallProgressLabel,
    shortenHomePath
} from '../../lib/common/tool-install-ui.js';

test('初回チェック（previous 無し）は未導入の道具を全部 既定 ON にする', () => {
    const tools = [
        { id: 'ffmpeg', available: false },
        { id: 'chrome', available: true },
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
    assert.match(describeToolInstallOutcome({ id: 'chrome', outcome: 'external-installer-opened' }, 'Chrome'), /開きました/);
    assert.match(describeToolInstallOutcome({ id: 'blender', outcome: 'failed' }, 'Blender'), /失敗/);
});

test('作成先パスはホーム配下のとき ~/ に短縮される', () => {
    assert.equal(shortenHomePath('/Users/ryoma/Akari', '/Users/ryoma'), '~/Akari');
    assert.equal(shortenHomePath('/Users/ryoma', '/Users/ryoma'), '~');
    assert.equal(shortenHomePath('/opt/data/Akari', '/Users/ryoma'), '/opt/data/Akari');
});

test('作成先パスは homeDir 不明のときそのまま返す', () => {
    assert.equal(shortenHomePath('/Users/ryoma/Akari', undefined), '/Users/ryoma/Akari');
});
