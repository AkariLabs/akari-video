import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
const timeline = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

test('注釈の重複見出しを空のスロットにし、フィルタとボードボタンの位置を維持する', () => {
    const heading = panel.slice(panel.indexOf('const heading ='), panel.indexOf("this.filterSelect.setAttribute('aria-label'"));
    assert.match(heading, /document\.createElement\('span'\)/);
    assert.doesNotMatch(heading, /textContent|innerHTML/);
    assert.match(heading, /heading\.style\.width = '2em'/);
    assert.match(heading, /heading\.style\.flexShrink = '0'/);
    assert.match(heading, /heading\.style\.marginRight = 'auto'/);
    assert.match(heading, /setAttribute\('aria-hidden', 'true'\)/);
    assert.match(panel, /this\.toolbar\.append\(heading, this\.filterSelect, this\.openBoardButton\)/);
    assert.match(panel, /this\.title\.label = '注釈'/);
    assert.match(panel, /this\.filterSelect\.addEventListener\('change'/);
    assert.match(panel, /this\.openBoardButton\.addEventListener\('click'/);
});

test('タイムラインの注釈・録音帯ボタンは DOM に追加しない', () => {
    const insertions = [...timeline.matchAll(/\.(?:append|appendChild|prepend|insertBefore|replaceChildren)\([\s\S]*?\);/g)]
        .map(match => match[0]).join('\n');
    assert.doesNotMatch(insertions, /this\.reviewButton\b|this\.reviewSessionRangesButton\b/);
    assert.match(timeline, /this\.toolbar\.append\(this\.zoomHud\)/);
    assert.doesNotMatch(insertions, /this\.placeTextButton/);
});

test('録音帯は保存済み true を読まず非表示で初期化し、描画とパネル連携は維持する', () => {
    assert.match(timeline, /protected recordingRangesVisible = false;/);
    assert.doesNotMatch(timeline, /this\.readReviewSessionRangesVisible\(\)/);
    assert.match(timeline, /if \(!this\.recordingRangesVisible\) return;/);
    assert.match(timeline, /this\.recordingRangesVisible && this\.reviewSessionBandsCache\.length > 0/);
    assert.match(timeline, /protected focusReviewSession\(/);
    assert.match(panel, /recordingTitle\.textContent = '録音セッション'/);
});
