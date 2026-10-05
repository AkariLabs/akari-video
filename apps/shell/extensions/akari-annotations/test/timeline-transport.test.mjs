import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

function load(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const exports = {};
    new Function('exports', ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
    }).outputText)(exports);
    return exports;
}

const { nextShuttleRate, advanceShuttle, shuttleCancelEffect } = load('../src/common/timeline-shuttle.ts');
const { timelineEditPoints, adjacentEditPoint } = load('../src/common/timeline-edit-points.ts');
const { AKARI_SHORTCUTS } = load('../src/browser/akari-shortcuts.ts');
const { AKARI_SHORTCUT_ORDER, shortcutGroup } = load('../../akari-surfaces/src/common/shortcuts-settings.ts');
const require = createRequire(import.meta.url);
const { TimelineShuttleController } = require('../lib/browser/timeline/timeline-shuttle-controller.js');

test('J/K/L rates step through stop, normal playback, and capped shuttle speeds', () => {
    assert.deepEqual([1, 2, 4, 8, 8], Array.from({ length: 5 }, (_, index) => index)
        .reduce((rates, _) => [...rates, nextShuttleRate(rates.at(-1) ?? 0, 1)], []));
    assert.deepEqual([4, 2, 1, 0, -1, -2, -4, -8, -8], Array.from({ length: 9 }, (_, index) => index)
        .reduce((rates, _) => [...rates, nextShuttleRate(rates.at(-1) ?? 8, -1)], []));
    for (const reason of ['space', 'stop']) {
        assert.deepEqual(shuttleCancelEffect(1, reason), { pausePlayback: true, nextRate: 0 });
        assert.deepEqual(shuttleCancelEffect(0, reason, true), { pausePlayback: true, nextRate: 0 });
    }
    for (const reason of ['pointer', 'drag', 'edit', 'dispose']) {
        assert.deepEqual(shuttleCancelEffect(1, reason, true), { pausePlayback: false, nextRate: 0 });
        assert.deepEqual(shuttleCancelEffect(-2, reason), { pausePlayback: false, nextRate: 0 });
    }
    assert.deepEqual(shuttleCancelEffect(1, 'edge'), { pausePlayback: false, nextRate: 0 });
});

test('shuttle advances by elapsed time and stops at both ends', () => {
    assert.deepEqual(advanceShuttle(3, 2, 0.5, 10), { time: 4, rate: 2 });
    assert.deepEqual(advanceShuttle(0.25, -1, 1, 10), { time: 0, rate: 0 });
    assert.deepEqual(advanceShuttle(9.5, 4, 1, 10), { time: 10, rate: 0 });
});

test('controller clears normal playback on click without pausing, while Space pauses it', () => {
    const originalFrame = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let nextFrame = 0;
    let cancelled = 0;
    globalThis.requestAnimationFrame = () => ++nextFrame;
    globalThis.cancelAnimationFrame = () => { cancelled++; };
    const events = [];
    const controller = new TimelineShuttleController({
        time: () => 3, duration: () => 24, seek: () => undefined,
        play: () => events.push('play'), pause: () => events.push('pause'),
        display: rate => events.push(`rate:${rate}`)
    });
    try {
        controller.direction(1, false);
        controller.stop('pointer');
        assert.equal(controller.rate, 0);
        assert.deepEqual(events, ['rate:1', 'play', 'rate:0']);
        controller.direction(1, false);
        controller.stop('space');
        assert.deepEqual(events.slice(-4), ['rate:1', 'play', 'pause', 'rate:0']);
        controller.direction(-1, false);
        controller.stop('drag');
        assert.equal(cancelled, 1);
        assert.equal(controller.rate, 0);
    } finally {
        globalThis.requestAnimationFrame = originalFrame;
        globalThis.cancelAnimationFrame = originalCancel;
    }
});

test('edit points deduplicate frame edges and omit locked tracks', () => {
    const tracks = [
        { items: [{ at: 0, duration: 30 }, { at: 30, duration: 30 }] },
        { items: [{ at: 30, duration: 15 }] },
        { locked: true, items: [{ at: 8, duration: 9 }] }
    ];
    const points = timelineEditPoints(tracks, 3, 30);
    assert.deepEqual(points, [0, 1, 1.5, 2, 3]);
    assert.equal(adjacentEditPoint(points, 1, -1, 30), 0);
    assert.equal(adjacentEditPoint(points, 1, 1, 30), 1.5);
    assert.equal(adjacentEditPoint(points, 3, 1, 30), undefined);
});

test('transport keys are registered with Japanese labels and inspector exclusive edit points', () => {
    const expected = [
        ['shuttleReverse', 'j'], ['shuttleStop', 'k'], ['shuttleForward', 'l'],
        ['previousEditPoint', 'up'], ['nextEditPoint', 'down']
    ];
    for (const [name, key] of expected) {
        const shortcut = AKARI_SHORTCUTS.find(item => item.command.id === `akari.timeline.${name}`);
        assert.deepEqual(shortcut.keys, [key]);
        assert.match(shortcut.command.label, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
        assert.equal(shortcut.command.category, '再生');
        assert.ok(AKARI_SHORTCUT_ORDER.includes(shortcut.command.id));
        assert.equal(shortcutGroup(shortcut.command.id), 'playback');
        assert.match(shortcut.when, /!akariModalOpen && !akariEditableFocus && !akariImeComposing/);
        if (key === 'up' || key === 'down') {
            assert.match(shortcut.when, /!akariFocusOutsideTimeline && !akariNumberFieldFocus && !akariInspectorFocus/);
        }
    }
});
