import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as visual from '../lib/common/caption-visual-contract.js';
import { captionEntryAnimationsSettled } from '../lib/common/caption-hit-region.js';
import { outputTimeForSourceClock } from '../lib/common/preview-playback-clock.js';

export const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

// 司令塔補正（2026-09-06 合流時）: 評価器はコミット済みの generated バンドルから読む。
// packages/frame-engine/dist は CI の shell レーンでは作られないため、そこへの直 import は
// ERR_MODULE_NOT_FOUND になる（webview が実際に読むのもこのバンドル）。
export const frameEngine = vm.runInNewContext(
    readFileSync(new URL('../generated/frame-engine.js', import.meta.url), 'utf8') + ';AkariFrameEngine',
    { console }
);

function section(text, from, to) {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `missing webview section: ${from}`);
    // Evaluate the host template first, exactly as previewBootstrapScript does. The second VM
    // has only browser globals/stubs, so accidental references to host module names fail.
    return vm.runInNewContext('`' + text.slice(start, end) + '`', visual);
}

export function harness({ text = source, cues = [], engine = true, available = true, emphasisWords = [], applyAnimator, output } = {}) {
    const calls = [];
    const warnings = [];
    let html = '';
    let writes = 0;
    let nodes = [];
    const listeners = new Map();
    const animations = [{ pause() {}, currentTime: 0, effect: { getComputedTiming: () => ({ endTime: 0 }) } }];
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const plate = {
        id: 'caption-plate',
        style: { removeProperty() {}, setProperty() {} },
        classList: { toggle() {} },
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; nodes = []; writes++; },
        set textContent(value) { html = escape(value); nodes = []; writes++; },
        getAnimations: () => animations,
        querySelectorAll(selector) {
            assert.equal(selector, '.akari-caption__char');
            if (!nodes.length) nodes = [...html.matchAll(/<span class="akari-caption__char" data-akari-char="(\d+)">([\s\S]*?)<\/span>/g)]
                .map(match => {
                    const node = { index: Number(match[1]), html: match[2] };
                    if (applyAnimator) {
                        const values = {};
                        node.style = new Proxy(values, { get: (target, key) => {
                            if (key === 'getPropertyPriority') return () => '';
                            if (key === 'setProperty') return (name, value) => { target[name] = value; };
                            if (key === 'removeProperty') return name => { delete target[name]; };
                            return target[key] ?? '';
                        } });
                        node.tagName = 'span';
                        node.parentElement = plate;
                        node.closest = selector => selector === '.akari-caption__char' ? node : null;
                        node.ownerDocument = { defaultView: { getComputedStyle: () => ({ opacity: node.style.opacity || '1' }) } };
                    }
                    return node;
                });
            return nodes;
        }
    };
    const noop = () => {};
    const summary = { output: output ?? { width: 1920, height: 1080, fps: 30 } };
    const clock = { tick: time => time, seek: time => time, totalDuration: 60 };
    const context = vm.createContext({
        console: { warn: (...values) => warnings.push(values) },
        document: { getElementById: id => id === 'caption-plate' ? plate : null },
        window: {
            addEventListener: (type, listener) => listeners.set(type, listener),
            dispatchEvent: event => { listeners.get(event.type)?.(event); },
            AkariEditKernel: { findActiveCaption: (values, time) => values.find(cue => time >= cue.start && time < cue.end) },
            ...(available ? { AkariFrameEngine: { applyCaptionAnimatorDom: (root, declaration) => {
                calls.push({ root, declaration, animationTime: animations[0].currentTime });
                applyAnimator?.(root, declaration);
            } } } : {}),
            akari: { ...(engine ? { frameEngineClock: clock } : {}), runtime: { tick: noop },
                playbackTick: noop, audioMeterTick: noop, reviewTransport: noop }
        },
        initial: { summary }, summary, captions: cues, outputTime: 0, isPlaying: false,
        activeCaption: null, activeCaptionEdit: null, styledCaptionActive: false, captionHitRegionPending: false,
        captionEntryAnimationsSettledFn: captionEntryAnimationsSettled, emphasisWords,
        clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
        renderLayers: noop, updateLayerSelectBox: noop, updateTransport: noop, updateWaveformPlayhead: noop,
        loopRange: null, freezeHoldUntilMs: 0, activeSegmentIndex: 0,
        segments: [{ kind: 'src', in: 0, out: 60, outStart: 0, outEnd: 60 }],
        video: { currentTime: 0 }, isStillSegment: () => false, sourceSwapPending: false,
        outputTimeForSourceClockFn: outputTimeForSourceClock, applyKeepRangeBoundary: noop,
        renderCutLayerStyleVisual: noop, applyCutFramingVisual: noop, preloadUpcomingTransition: noop,
        preloadUpcomingCut: noop, renderTransitionComposite: noop, applyCutsMuteState: noop, renderVideoFx: noop,
        fps: 30, totalTimelineDuration: 60, videoDuration: () => 60,
        timelineToSource: time => ({ index: 0, kind: 'src', time }), enterSegment: noop, frameEngineMediaIdle: false
    });
    vm.runInContext("const captionPlate = document.getElementById('caption-plate');", context);
    vm.runInContext(section(text, 'const escapeCaptionHtml =', 'const renderTransitionPlate ='), context);
    vm.runInContext('const renderTransitionPlate = () => {};', context);
    vm.runInContext(section(text, 'const tick = (immediatePlaybackTick', 'const runTickGuarded ='), context);
    vm.runInContext(section(text, 'const seekTimelineTime =', 'const applyInitialPosition ='), context);
    return {
        plate, calls, warnings, context,
        get writes() { return writes; },
        run: code => vm.runInContext(code, context),
        // Execute the real low-level seek body, without seekTimelineTime's extra tick.
        installEngineSeek() {
            const start = text.indexOf('seek(seconds, continuePlaying = playing) {');
            const end = text.indexOf('play(seconds) {', start);
            assert.ok(start >= 0 && end > start);
            Object.assign(context, {
                position: 0, playing: false, totalDuration: 60, playAnchorMs: 0, playAnchorPosition: 0,
                performance: { now: () => 0 }, requestSeek: seconds => seconds,
                audioSupply: { seek: noop }, updateAudioStatus: noop, requestAudioPriority: noop,
                CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
            });
            clock.seek = vm.runInContext('({' + text.slice(start, end) + '}).seek', context);
            clock.tick = () => context.position;
            return clock;
        },
        tick(time) { context.outputTime = time; context.video.currentTime = time; vm.runInContext('tick();', context); },
        seek(time) { context.seekTarget = time; vm.runInContext('seekTimelineTime(seekTarget); tick(true);', context); }
    };
}
