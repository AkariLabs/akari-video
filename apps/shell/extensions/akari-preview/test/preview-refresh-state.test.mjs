import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    capturePreviewPlaybackTick,
    resolvePreviewRefreshRestore
} from '../lib/common/preview-refresh-state.js';

const handlerSource = readFileSync(fileURLToPath(new URL(
    '../src/browser/akari-preview-open-handler.ts', import.meta.url
)), 'utf8');

test('一時停止中の手動シーク tick も最新位置として保持する', () => {
    assert.deepEqual(capturePreviewPlaybackTick({
        time: 2.375,
        playing: false,
        rate: 1.25
    }), {
        timelineT: 2.375,
        playing: false,
        rate: 1.25
    });
});

test('tick の負位置と不正 rate を正規化する', () => {
    assert.deepEqual(capturePreviewPlaybackTick({
        time: -0.5,
        playing: true,
        rate: Number.NaN
    }, 0.75), {
        timelineT: 0,
        playing: true,
        rate: 0.75
    });
    assert.deepEqual(capturePreviewPlaybackTick({
        time: Number.NaN,
        playing: false,
        rate: Number.NaN
    }, Number.NaN), {
        timelineT: 0,
        playing: false,
        rate: 1
    });
});

test('再構築位置は override → transport → lastKnown の順で復元する', () => {
    const common = {
        transport: { timelineT: 4, playing: true },
        lastKnownTime: 6,
        lastKnownPlaying: false
    };
    assert.deepEqual(resolvePreviewRefreshRestore({ ...common, seekTimeOverride: 2 }), {
        seekTime: 2,
        playing: true
    });
    assert.deepEqual(resolvePreviewRefreshRestore(common), {
        seekTime: 4,
        playing: true
    });
    assert.deepEqual(resolvePreviewRefreshRestore({
        lastKnownTime: 6,
        lastKnownPlaying: true
    }), {
        seekTime: 6,
        playing: true
    });
    assert.deepEqual(resolvePreviewRefreshRestore({}), {
        seekTime: undefined,
        playing: false
    });
});

test('host は正規化した tick を last-known と transport の両方へ保存する', () => {
    assert.match(handlerSource, /const captured = capturePreviewPlaybackTick\(message,/);
    assert.match(handlerSource, /widget\.akariPreviewLastKnownTime = captured\.timelineT;/);
    assert.match(handlerSource, /widget\.akariPreviewLastKnownPlaying = captured\.playing;/);
    assert.match(handlerSource, /this\.reviewTransportByEdit\.set\(normalizedEditUri!, captured\);/);
});

test('webview は pause・seeked・一時停止中の手動シークを強制 tick する', () => {
    assert.match(handlerSource, /const onMainVideoPause = event => \{[\s\S]*?playbackTick\(outputTime, isPlaying, true\);/);
    assert.match(handlerSource, /const onMainVideoSeeked = event => \{[\s\S]*?tick\(true\);/);
    assert.match(handlerSource, /const scrubThrottle = createRafThrottleFn\([\s\S]*?seekTimelineTime\(target\);[\s\S]*?tick\(true\);/);
});
