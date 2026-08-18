import assert from 'node:assert/strict';
import test from 'node:test';
import {
    computeDownloadPercent,
    formatBytes,
    formatDownloadProgressLabel,
    summarizeCommandInstallPhase
} from '../../lib/common/tool-install-progress.js';

test('formatBytes: 1MB 以上は整数MBに丸める', () => {
    assert.equal(formatBytes(12 * 1024 * 1024), '12MB');
    assert.equal(formatBytes(574 * 1024 * 1024), '574MB');
});

test('formatBytes: 1MB 未満は小数第1位まで', () => {
    assert.equal(formatBytes(512 * 1024), '0.5MB');
    assert.equal(formatBytes(0), '0MB');
});

test('formatDownloadProgressLabel: totalBytes ありは "12MB / 574MB" 形式', () => {
    assert.equal(
        formatDownloadProgressLabel(12 * 1024 * 1024, 574 * 1024 * 1024),
        '12MB / 574MB'
    );
});

test('formatDownloadProgressLabel: totalBytes 不明（不定形）は既知バイト数のみ', () => {
    assert.equal(formatDownloadProgressLabel(3 * 1024 * 1024), '3MB');
    assert.equal(formatDownloadProgressLabel(3 * 1024 * 1024, 0), '3MB');
});

test('computeDownloadPercent: 通常の割合は0〜100に丸められる', () => {
    assert.equal(computeDownloadPercent(50, 200), 25);
    assert.equal(computeDownloadPercent(200, 200), 100);
    assert.equal(computeDownloadPercent(0, 200), 0);
});

test('computeDownloadPercent: totalBytes 不明・0 は undefined（indeterminate）', () => {
    assert.equal(computeDownloadPercent(50), undefined);
    assert.equal(computeDownloadPercent(50, 0), undefined);
});

test('summarizeCommandInstallPhase: 取得系の文言はパッケージ取得フェーズ', () => {
    assert.equal(summarizeCommandInstallPhase('==> Fetching ffmpeg'), 'パッケージを取得しています…');
    assert.equal(summarizeCommandInstallPhase('Downloading https://...'), 'パッケージを取得しています…');
});

test('summarizeCommandInstallPhase: 展開/導入系の文言は展開フェーズ', () => {
    assert.equal(summarizeCommandInstallPhase('==> Pouring ffmpeg--8.1.2.arm64_sequoia.bottle.tar.gz'), '展開しています…');
    assert.equal(summarizeCommandInstallPhase('==> Installing ffmpeg'), '展開しています…');
});

test('summarizeCommandInstallPhase: 完了系の文言は "Installing" を含んでいても仕上げフェーズを優先する', () => {
    assert.equal(summarizeCommandInstallPhase('Successfully installed ffmpeg'), '仕上げています…');
    assert.equal(summarizeCommandInstallPhase('==> Summary'), '仕上げています…');
    assert.equal(summarizeCommandInstallPhase('ffmpeg 8.1.2 is already installed'), '仕上げています…');
});

test('summarizeCommandInstallPhase: 空文字は準備中、未知の文言は既定フェーズ', () => {
    assert.equal(summarizeCommandInstallPhase(''), '準備しています…');
    assert.equal(summarizeCommandInstallPhase('   '), '準備しています…');
    assert.equal(summarizeCommandInstallPhase('some unrelated line'), '処理しています…');
});
