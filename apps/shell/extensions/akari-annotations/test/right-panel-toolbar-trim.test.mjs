import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readAllSourceText } from './helpers/widget-source.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';

setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });
const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/annotations.json', import.meta.url), 'utf8'));

const panel = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
const timeline = readAllSourceText();

test('見出し、件数、メニューと 4 件数フィルタを並べる', () => {
    assert.match(panel, /this\.toolbar\.append\(heading, this\.countLabel, this\.openBoardButton, menu\)/);
    assert.match(panel, /heading\.textContent = t\('annotations\.reviewPanelWidget\.text\.annotation'\)/);
    assert.equal(ja['annotations.reviewPanelWidget.text.annotation'], '注釈');
    assert.match(panel, /this\.filterButtons\.appendChild\(button\)/);
    assert.doesNotMatch(panel, /this\.filterSelect/);
    assert.match(panel, /this\.openBoardButton\.addEventListener\('click'/);
});

test('選択中の絞り込みはテーマの secondary 規則より優先して表示し、録音道具は出さない', () => {
    assert.match(panel, /\[data-review-filter\]\[aria-pressed="true"\]/);
    assert.doesNotMatch(panel, /data-review-tool-mode-button|requestToolMode/);
    assert.match(panel, /border-color: var\(--theia-focusBorder\) !important/);
    assert.match(panel, /background-color: var\(--theia-list-activeSelectionBackground\) !important/);
    assert.match(panel, /color: var\(--theia-list-activeSelectionForeground, var\(--theia-foreground\)\) !important/);
    assert.match(panel, /font-weight: 650 !important/);
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
    assert.match(panel, /recordingTitle\.textContent = t\('annotations\.reviewPanelWidget\.text\.recordingSession'\)/);
    assert.equal(ja['annotations.reviewPanelWidget.text.recordingSession'], '録音');
});
