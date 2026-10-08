import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { channelFromRelativePath, savedChip, shouldRerenderOnContextKeys, stageDots, stageDotTitles, titleBarCenter, titleBarGeometry, windowButtons, windowButtonGlyphs } from '../lib/browser/title-bar/title-bar-model.js';

test('中央は未オープン、チャンネル内、単体で並びが変わる', () => {
    assert.deepEqual(titleBarCenter({ scope: 'channel', channel: '旅' }), ['旅']);
    assert.deepEqual(titleBarCenter({ scope: 'channel' }), ['AKARI Video']);
    assert.deepEqual(titleBarCenter({ scope: 'project', channel: '旅', project: '夏の記録' }), ['旅', '夏の記録']);
    assert.deepEqual(titleBarCenter({ scope: 'project', standalone: true, project: '試作' }), ['単体', '試作']);
    assert.equal(channelFromRelativePath('channels/旅/videos/夏の記録'), '旅');
    assert.equal(channelFromRelativePath('channels/旅/other/夏の記録'), undefined);
});

test('保存表示はパートナー作業中を優先する', () => {
    assert.equal(savedChip({ pending: 0, busy: false }), '保存済み');
    assert.equal(savedChip({ pending: 2, busy: false }), '保存中…');
    assert.equal(savedChip({ pending: 2, busy: true }), 'パートナー作業中');
});

test('busy 以外の context key 変更では中央を再描画しない', () => {
    const affects = changed => keys => [...keys].some(key => changed.has(key));
    assert.equal(shouldRerenderOnContextKeys(affects(new Set(['editorFocus']))), false);
    assert.equal(shouldRerenderOnContextKeys(affects(new Set(['akari.partner.busy']))), true);
});

test('進み具合は常に五点', () => {
    assert.deepEqual(stageDots([{ done: true }, { current: true }, {}, {}, {}]), ['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    assert.equal(stageDots([{ done: true, current: true }])[0], 'current');
    assert.equal(stageDots(undefined).length, 5);
});

test('帯の五点は段名を持ち、ラベルがなければ既定名を使う', () => {
    assert.deepEqual(stageDotTitles([{ label: '準備' }]), ['準備', '素材', '編集', '確認', '書き出し']);
});

test('窓ボタンは最大化状態に合うグリフと SVG を返す', () => {
    assert.deepEqual(windowButtonGlyphs(false).map(button => button.label), windowButtons('windows', false));
    assert.equal(windowButtonGlyphs(false)[1].glyph, '\uE922');
    assert.equal(windowButtonGlyphs(true)[1].glyph, '\uE923');
    assert.match(windowButtonGlyphs(true)[1].svg, /<svg viewBox="0 0 10 10"/);
});

test('窓ボタンと Mac の全画面寸法', () => {
    assert.deepEqual(windowButtons('windows', false), ['最小化', '最大化', '閉じる']);
    assert.deepEqual(windowButtons('windows', true), ['最小化', '元に戻す', '閉じる']);
    assert.deepEqual(windowButtons('mac', false), []);
    assert.deepEqual(titleBarGeometry('mac', false), { height: 40, leadingSpace: 78, opacity: 1 });
    assert.deepEqual(titleBarGeometry('mac', true), { height: 30, leadingSpace: 0, opacity: .88 });
});

test('窓オプションに Mac の帯が宣言されている', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const options = pkg.theia.frontend.config.electron.windowOptions;
    assert.equal(options.titleBarStyle, 'hiddenInset');
    assert.deepEqual(options.trafficLightPosition, { x: 12, y: 12 });
});
