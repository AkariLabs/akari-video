import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    resolvePreviewRefreshRestore,
    shouldCapturePreviewPlaybackTick
} from '../lib/common/preview-refresh-state.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const seekStart = source.indexOf('            const seekTimelineTime = timelineValue => {');
const start = source.indexOf('            const applyInitialPosition = () => {');
const end = source.indexOf('            const zoomToSlider =', start);
assert.ok(seekStart >= 0 && start > seekStart && end > start);
const runInitialPosition = new Function('input', `
    let initialPositionApplied = false;
    let initialSeekTarget = input.seek;
    let outputTime = 7;
    const segments = input.segments ?? [];
    const totalTimelineDuration = input.duration ?? 0;
    const playbackMountReady = input.mountReady ?? false;
    const initial = { kind: input.kind ?? 'output', frameEngineEnabled: input.frameEngineEnabled ?? false };
    const summary = input.summary ?? { cuts: [], layers: [], overlays: [] };
    const captions = input.captions ?? [];
    const video = { getAttribute: () => input.videoSource ?? null };
    const document = { getElementById: () => ({ dataset: { frameEngineReady: input.clockReady ? 'true' : 'false' } }) };
    const seeks = [];
    const entered = [];
    const clock = input.clockDuration === undefined ? undefined : {
        totalDuration: input.clockDuration,
        seek(time) { seeks.push(time); return time; }
    };
    const window = { akari: { frameEngineClock: clock, reviewTransport() {}, updateEmptyCanvasHint() {} } };
    const isPlaying = false;
    const fps = 30;
    const frameEngineMediaIdle = initial.frameEngineEnabled;
    const videoDuration = () => input.videoDuration ?? totalTimelineDuration;
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const timelineToSource = () => ({ index: 0, kind: 'gap' });
    const isStillSegment = () => false;
    const enterSegment = index => entered.push(index);
    ${source.slice(seekStart, end)}
    applyInitialPosition();
    return { applied: initialPositionApplied, ready: window.akari.previewPositionReady === true,
        outputTime, seeks, entered };
`);

test('旧ページと初期位置反映前の 0 を捨て、復元値 5 秒を保持する', () => {
    const currentPageId = 'page-2';
    const transport = { timelineT: 5, playing: false };
    for (const tick of [
        { pageId: 'page-1', positionReady: true, time: 0, playing: false },
        { pageId: currentPageId, positionReady: false, time: 0, playing: false }
    ]) {
        assert.equal(shouldCapturePreviewPlaybackTick(tick, currentPageId), false);
        assert.equal(resolvePreviewRefreshRestore({ transport }).seekTime, 5);
    }
    assert.equal(shouldCapturePreviewPlaybackTick({ pageId: currentPageId, positionReady: true }, currentPageId), true);
});

test('空の出力はマウント後に 0 秒を確定し、読み込み待ちの素材は確定しない', () => {
    assert.equal(runInitialPosition({ mountReady: false }).ready, false);
    assert.deepEqual(runInitialPosition({ mountReady: true, seek: 5 }), {
        applied: true, ready: true, outputTime: 0, seeks: [], entered: []
    });
    assert.equal(runInitialPosition({ mountReady: true, kind: 'raw' }).ready, false);
    assert.equal(runInitialPosition({ mountReady: true, videoSource: '/media/clip' }).ready, false);
    assert.equal(runInitialPosition({ mountReady: true, summary: { cuts: [{}] } }).ready, false);
    assert.equal(runInitialPosition({ mountReady: true, captions: [{}] }).ready, false);
});

test('尺が未確定の正の初期シークは保留し、0 とシーク無しは確定できる', () => {
    const segment = { outStart: 0 };
    assert.equal(runInitialPosition({ segments: [segment], seek: 5, duration: 0 }).ready, false);
    assert.equal(runInitialPosition({ segments: [segment], seek: 5, duration: 12,
        frameEngineEnabled: true }).ready, false);
    assert.equal(runInitialPosition({ segments: [segment], seek: 0, duration: 12,
        frameEngineEnabled: true }).ready, false);
    assert.equal(runInitialPosition({ segments: [segment], seek: 5, duration: 12,
        frameEngineEnabled: true, clockDuration: 0, clockReady: true }).ready, false);
    assert.equal(runInitialPosition({ segments: [segment], seek: 5, duration: 12,
        frameEngineEnabled: true, clockDuration: 12, clockReady: false }).ready, false);
    assert.deepEqual(runInitialPosition({ segments: [segment], seek: 5, duration: 12,
        frameEngineEnabled: true, clockDuration: 12, clockReady: true }), {
        applied: true, ready: true, outputTime: 5, seeks: [5], entered: []
    });
    assert.deepEqual(runInitialPosition({ segments: [segment], seek: 5, duration: 12 }), {
        applied: true, ready: true, outputTime: 5, seeks: [], entered: [0]
    });
    assert.equal(runInitialPosition({ segments: [segment], seek: 0 }).ready, true);
    assert.equal(runInitialPosition({ segments: [segment], seek: null }).ready, true);
});

test('確定後に clock が差し替わっても初回 tick の 0 を採用しない', () => {
    const tickStart = source.indexOf('            const tick = (immediatePlaybackTick = false) => {');
    const syncStart = source.indexOf('                const frameEngineClock = window.akari && window.akari.frameEngineClock;', tickStart);
    const syncEnd = source.indexOf('                    if (isPlaying && loopRange', syncStart);
    assert.ok(tickStart >= 0 && syncStart > tickStart && syncEnd > syncStart);
    const runClockTick = new Function('input', `
        let outputTime = input.outputTime;
        let position = 0;
        const seeks = [];
        const clock = { totalDuration: 12,
            seek(time) { seeks.push(time); position = time; return position; },
            tick() { return position; }
        };
        const window = { akari: { frameEngineClock: clock, previewPositionReady: input.ready,
            previewSyncedFrameEngineClock: input.sameClock ? clock : undefined } };
        const isPlaying = false;
        ${source.slice(syncStart, syncEnd)}
        }
        return { outputTime, seeks };
    `);
    assert.deepEqual(runClockTick({ outputTime: 5, ready: true }), { outputTime: 5, seeks: [5] });
    assert.deepEqual(runClockTick({ outputTime: 5, ready: false }), { outputTime: 0, seeks: [] });
});

test('ページ間の準備状態と更新後のドロップ座標を現在値で送る', () => {
    assert.match(source, /positionReady: window\.akari\.previewPositionReady === true/);
    assert.match(source, /if \(!initialPositionApplied\) \{\s*initialSeekTarget = target;\s*return;/);
    assert.match(source, /canvasDropTargets: summary\?\.canvasDropTargets \|\| \[\]/);
});
