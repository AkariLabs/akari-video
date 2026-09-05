import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
    clampPreviewPlaybackRate,
    effectiveMediaRate,
    formatPreviewRateLabel,
    freezeHoldMs,
    PREVIEW_RATE_PRESETS,
    wallClockOutputTime
} from '../lib/common/preview-playback-rate.js';

const here = dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const compiledHandler = readFileSync(join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'), 'utf8');

function extractMethod(name) {
    const start = compiledHandler.indexOf(`    ${name}(`);
    assert.notEqual(start, -1, `${name} が compiled lib に見つからない`);
    const bodyStart = compiledHandler.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < compiledHandler.length; index += 1) {
        if (compiledHandler[index] === '{') depth += 1;
        if (compiledHandler[index] === '}' && --depth === 0) {
            return compiledHandler.slice(start, index + 1).trim();
        }
    }
    assert.fail(`${name} の終端が見つからない`);
}

test('p1 preview rate をクランプし、プリセットと表示ラベルを固定する', () => {
    assert.equal(clampPreviewPlaybackRate(0.1), 0.5);
    assert.equal(clampPreviewPlaybackRate(9), 3);
    assert.equal(clampPreviewPlaybackRate(Number.NaN), 1);
    assert.equal(clampPreviewPlaybackRate(0), 1);
    assert.equal(clampPreviewPlaybackRate(-1), 1);
    assert.deepEqual([...PREVIEW_RATE_PRESETS], [0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
    assert.equal(formatPreviewRateLabel(1), '1×');
    assert.equal(formatPreviewRateLabel(1.25), '1.25×');
    assert.equal(formatPreviewRateLabel(3), '3×');
});

test('p2 media の実効速度は segment speed と preview rate の積になる', () => {
    assert.equal(effectiveMediaRate(1.25, 2), 2.5);
    assert.equal(effectiveMediaRate(Number.NaN, 2), 2);
    assert.equal(effectiveMediaRate(2, 0), 2);
    assert.equal(effectiveMediaRate(-1, '2'), 1);
});

test('p3 freeze と壁時計を preview rate で出力タイムライン秒へ写す', () => {
    assert.equal(freezeHoldMs(3, 2), 1500);
    assert.equal(freezeHoldMs(3, 0.5), 6000);
    assert.equal(wallClockOutputTime(4, 1000, 2500, 2), 7);
    assert.equal(wallClockOutputTime(4, 1000, 2500, 0.5), 4.75);
});

test('p4 host は有効な playback-rate message だけ widget に保持し initialState へ戻す', () => {
    const isPlaybackRateRequest = vm.runInNewContext(
        `(function ${extractMethod('isPlaybackRateRequest')})`
    );
    const widget = {};
    const apply = message => {
        if (isPlaybackRateRequest(message)) widget.akariPreviewPlaybackRate = message.rate;
    };
    apply({ type: 'akari-preview-playback-rate', rate: 2 });
    assert.equal(widget.akariPreviewPlaybackRate, 2);
    for (const rate of [0, Number.NaN, 9, '2']) {
        apply({ type: 'akari-preview-playback-rate', rate });
        assert.equal(widget.akariPreviewPlaybackRate, 2);
    }
    assert.match(handlerSource,
        /if \(this\.isPlaybackRateRequest\(message\)\) \{\s*widget\.akariPreviewPlaybackRate = message\.rate;/u);
    assert.match(handlerSource, /initialPlaybackRate: clampPreviewPlaybackRate\(initialPlaybackRate\)/u);
    assert.match(handlerSource, /widget\.akariPreviewPlaybackRate \?\? 1/u);
});

test('p5 rate UI は zoom の直前にあり、契約どおりの 7 プリセットと UI target を持つ', () => {
    const start = handlerSource.indexOf('<div class="transport-right">');
    const end = handlerSource.indexOf('<script>window.__akariPreview', start);
    assert.ok(start >= 0 && end > start, 'transport-right HTML が見つからない');
    const transport = handlerSource.slice(start, end);
    const ids = ['pen-toggle', 'rate-toggle', 'zoom-toggle', 'fullscreen-toggle'];
    const positions = ids.map(id => transport.indexOf(`id="${id}"`));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual([...positions].sort((left, right) => left - right), positions);
    assert.match(transport,
        /id="rate-toggle"[^>]*data-akari-ui="preview:rate"[^>]*>1×<\/button>/u);

    const values = [...transport.matchAll(
        /<button class="rate-preset"[^>]*data-rate="([^"]+)"[^>]*data-akari-ui="preview:rate:[^"]+"/gu
    )].map(match => Number(match[1]));
    assert.deepEqual(values, [...PREVIEW_RATE_PRESETS]);
});

test('p7 webview 埋め込み関数は素のコンテキストで自己完結して動く', () => {
    const isolatedClamp = vm.runInNewContext('(' + clampPreviewPlaybackRate.toString() + ')', {});
    const isolatedFormat = vm.runInNewContext('(' + formatPreviewRateLabel.toString() + ')', {});
    const isolatedEffectiveRate = vm.runInNewContext('(' + effectiveMediaRate.toString() + ')', {});
    const isolatedFreezeHold = vm.runInNewContext('(' + freezeHoldMs.toString() + ')', {});
    const isolatedWallClock = vm.runInNewContext('(' + wallClockOutputTime.toString() + ')', {});

    assert.equal(isolatedClamp(5), 3);
    assert.equal(isolatedClamp(0), 1);
    assert.equal(isolatedClamp(Number.NaN), 1);
    assert.equal(isolatedFormat(1.25), '1.25×');
    assert.equal(isolatedEffectiveRate(2, 1.5), 3);
    assert.equal(isolatedFreezeHold(1, 2), 500);
    assert.equal(isolatedWallClock(10, 0, 2000, 2), 14);
});
