import assert from 'node:assert/strict';
import { readAllSourceText, readSourceFile } from './helpers/widget-source.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseCaptions } from '@akari-video/edit-store';
import { computeCaptionSubrowLayout } from '../lib/common/caption-subrow-layout.js';
import { shouldReloadCaptions } from '../lib/common/caption-track-layout.js';

const caption = (id, start, end, text) => ({
    id, start, end, text, speaker: null, sourceRef: null, edited: true
});

test('captions.json の分割本文を検知して字幕帯ブロックが 1 から 2 へ変わる', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'akari-caption-fragments-'));
    const path = join(directory, 'captions.json');
    const before = JSON.stringify({ captions: [caption('old', 0, 4, 'abcd')] });
    const after = JSON.stringify({ captions: [
        caption('left', 0, 2, 'ab'),
        caption('right', 2, 4, 'cd')
    ] });
    const blockCount = source => computeCaptionSubrowLayout(
        parseCaptions(source).captions,
        0.15,
        (start, end) => [[start, end]]
    ).size;
    try {
        await writeFile(path, before);
        const firstSource = await readFile(path, 'utf8');
        assert.equal(blockCount(firstSource), 1);

        await writeFile(path, after);
        const splitSource = await readFile(path, 'utf8');
        assert.equal(shouldReloadCaptions(firstSource, splitSource), true);
        assert.equal(blockCount(splitSource), 2);

        await writeFile(path, splitSource);
        const sameSource = await readFile(path, 'utf8');
        assert.equal(shouldReloadCaptions(splitSource, sameSource), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

const widget = readAllSourceText();

function between(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} が見つかりません`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `${endNeedle} が見つかりません`);
    return source.slice(start, end);
}

test('captions watcher は recent-write 時刻ゲートを使わず内容差分を確認する', () => {
    const watcher = between(widget, 'this.fileService.onDidFilesChange(event => {', 'protected showDeferredLintResult(');
    assert.match(watcher, /this\.watchedCaptionsReload\.request\(\)/);
    assert.match(widget, /shouldReloadCaptions\(this\.lastAppliedCaptionsSource, nextSource\)/);
    assert.doesNotMatch(watcher, /isRecentWrite|captionEchoVerifier/);
    assert.match(watcher, /this\.watchedEditReload\.request\(\)/);
});

test('書き込み完了通知は captionsUri の本文を即時 reload へ渡す', () => {
    assert.match(widget, /annotationsClient\.onDidWriteEvent\(detail => \{[\s\S]*?detail\.uri === this\.location\?\.captionsUri\.toString\(\)[\s\S]*?reloadCaptionsIfChanged\(detail\.content\)/);
});

test('インスペクターの途中保存は通知済みなら二度目の reload を省く', () => {
    const write = between(widget, "case 'caption-text':", "case 'bgm-duck-db':");
    assert.match(write, /const reloadGeneration = this\.captionReloadGeneration;[\s\S]*?setCaptionFields\([\s\S]*?if \(reloadGeneration === this\.captionReloadGeneration\)/);
});

test('字幕チップの signature は解決 cue を含み、非操作サブブロックを append する', () => {
    const branch = between(widget, 'this.captions.forEach(caption => {', 'this.overlays.forEach(overlay => {');
    assert.match(branch, /JSON\.stringify\(\{ caption, captionFragmentBreaksVisible, captionDisplayCues \}\)/);
    assert.match(branch, /fragment\.className = 'akari-annotations-caption-fragment'/);
    assert.match(branch, /fragment\.dataset\.akariCaptionFragment = String\(block\.index\)/);
    assert.match(branch, /element\.appendChild\(fragment\)/);
    assert.doesNotMatch(branch, /resolveCaptionDisplay/);
});

test('字幕トラックヘッダの signature は区切り表示の現在値を含む', () => {
    const headers = between(widget, 'protected renderTrackHeaders(', 'protected decorateTreeTrackHeader(');
    assert.match(headers, /track\.kind === 'captions' \? \[this\.captionFragmentBreaksVisible\(\)\] : \[\]/);
});

test('字幕と edit は状態の反映直後に描画を予約する', () => {
    const captionsReload = between(widget, 'protected async reloadCaptionsFromSource(', 'protected remapCaptionSelections(');
    assert.match(captionsReload, /renderAfterCaptionStateChange\(/);
    assert.match(captionsReload, /styleOnly \? undefined : \(\) => this\.reloadResolvedCaptionDisplay\(\)/);
    assert.match(captionsReload, /this\.scheduleStripRender\(\)/);
    const editReload = between(widget, 'protected async reloadEdit(', 'protected async resolveLegacyEditForOpen(');
    assert.match(editReload, /renderAfterCaptionStateChange\(/);
    assert.match(editReload, /\(\) => this\.reloadResolvedCaptionDisplay\(\)/);
    assert.match(editReload, /this\.scheduleStripRender\(\)/);
});

test('字幕サブブロックは最小幅を持ち、親帯からはみ出さない', () => {
    const css = readSourceFile('fragmentCss').text;
    assert.match(css, /\.akari-annotations-caption-fragmented\s*\{[^}]*overflow:\s*hidden;/s);
    assert.match(css, /\.akari-annotations-caption-fragment\s*\{[^}]*min-width:\s*3px;/s);
});
