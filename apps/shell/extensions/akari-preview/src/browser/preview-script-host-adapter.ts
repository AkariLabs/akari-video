// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。
import { measureBlock, linearToDbfs, latchClip } from '../common/audio-meter-model';
import { computeDuckEnvelope, evaluateEnvelopeDb } from '@akari-video/edit-store';
import {
    bgmLoopOffsetSeconds,
    resolveBgmSourceOffset,
    resolveSfxTrimWindow,
    resolveTimedScheduleWindow,
    sfxFadeGainSchedule
} from '../common/audio-schedule';
import { previewContentEnd } from '../common/preview-content-end';
import { computeLayerPerspectiveVisual } from '../common/layer-perspective-visual';
import { photoCropClipPolygon } from '../common/photo-crop-tools';
import { photoFrameVisual } from '../common/photo-frame-visual';
import { composePhotoPreviewMask } from '../common/photo-preview-mask';
import { resolveLayerHitRegionClip } from '../common/layer-hit-region';
import { buildPreviewContextMenuMessage } from '../common/preview-context-menu';
import { fitPreviewCompositeRect } from '../common/preview-composite-layout';
import { clampPreviewPlaybackRate } from '../common/preview-playback-rate';

export function hostAdapterScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const clampPreviewPlaybackRateFn = (${clampPreviewPlaybackRate.toString()});
            const buildPreviewContextMenuMessageFn = (${buildPreviewContextMenuMessage.toString()});
            const vscode = acquireVsCodeApi();
            const audioMeterOpen = document.getElementById('audio-meter-open');
            audioMeterOpen.addEventListener('click', () => {
                vscode.postMessage({ type: 'akari-preview-open-audio-meter' });
            });
            // 診断（第11・12項）: acquireVsCodeApi は 1 ページ 1 回きりなので、head のガード
            // スクリプトはここで取得したものを借りる（貯めてあった報告もここで流れる）。
            if (window.__akariPreviewDiag) window.__akariPreviewDiag.attachHost(vscode);
            const pending = new Map();
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）: updateStageScale
            // (below, in this same IIFE) needs this at layout time, which runs before
            // previewBootstrapScript's own copy of this function is ever reached -- so this script
            // block injects its own copy rather than relying on cross-<script>-tag scope.
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            const resolveLayerHitRegionClipFn = (${resolveLayerHitRegionClip.toString()});
            let perspectiveVisualWarned = false;
            let sequence = 0;
            let displayScale = 1;
            // frameScale: 出力キャンバス(output.width/height)を output 比そのものの preview-stage へ
            // 写像する CSS px / 出力 px 比。base/layers/captions/overlays は同じキャンバス矩形、
            // #pen-layer はその中の実映像矩形へ写像する。
            let frameScale = 1;
            let lastPlaybackTickAt = -Infinity;
            const wrapper = document.getElementById('preview-wrapper');
            const previewStage = document.getElementById('preview-stage');
            let video = document.getElementById('preview-video');
            let standbyVideo = document.getElementById('standby-video');
            const transitionVideo = document.getElementById('transition-video');
            for (const media of [video, standbyVideo, transitionVideo]) media.preservesPitch = true;
            const stillImage = document.getElementById('preview-still');
            const transitionStill = document.getElementById('transition-still');
            const outputPreviewLink = document.getElementById('output-preview-link');
            const reloadToast = document.getElementById('reload-toast');
            const compositeErrorBanner = document.getElementById('composite-error-banner');
            const compositeErrorDetail = document.getElementById('composite-error-detail');
            const reloadErrorCard = document.getElementById('reload-error-card');
            const reloadErrorDetail = document.getElementById('reload-error-detail');
            const reloadErrorRetry = document.getElementById('reload-error-retry');
            const writeErrorBanner = document.getElementById('write-error-banner');
            const writeErrorMessage = document.getElementById('write-error-message');
            const writeErrorDismiss = document.getElementById('write-error-dismiss');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const penLayer = document.getElementById('pen-layer');
            const output = initial.summary.output;
            let contextMenuTimelineT = Number.isFinite(initial.initialSeekTime)
                ? Math.max(0, initial.initialSeekTime) : 0;
            let selectedPrimary = null;

            document.addEventListener('contextmenu', event => {
                event.preventDefault();
                const message = buildPreviewContextMenuMessageFn(
                    event.clientX,
                    event.clientY,
                    previewStage.getBoundingClientRect(),
                    contextMenuTimelineT,
                    selectedPrimary?.id,
                    window.akari.interaction?.hasSelectionTree ? {
                        selectedIds: window.akari.interaction.selectedIds,
                        selectionKind: window.akari.interaction.selectionKind,
                        selectedNodeKind: window.akari.state?.summary?.tree?.find(
                            node => node.id === window.akari.interaction.selectedId)?.kind,
                        scopeNodeKind: window.akari.state?.summary?.tree?.find(
                            node => node.id === window.akari.interaction.scopeId)?.kind,
                        scopeId: window.akari.interaction.scopeId
                    } : undefined
                );
                vscode.postMessage(message);
            }, true);

            let reloadToastTimer;
            function showReloadToast() {
                if (reloadToastTimer !== undefined) window.clearTimeout(reloadToastTimer);
                reloadToast.hidden = false;
                reloadToastTimer = window.setTimeout(() => {
                    reloadToast.hidden = true;
                    reloadToastTimer = undefined;
                }, 4000);
            }
            function showReloadError(message) {
                reloadErrorDetail.textContent = String(message || '原因不明のエラーです。');
                reloadErrorCard.hidden = false;
            }
            function hideReloadError() {
                reloadErrorCard.hidden = true;
            }
            function applyCompositeError(message) {
                compositeErrorDetail.textContent = typeof message === 'string' ? message : '';
                compositeErrorBanner.hidden = !message;
            }
            reloadErrorRetry.addEventListener('click', () => {
                vscode.postMessage({ type: 'akari-preview-reload-retry' });
            });
            applyCompositeError(initial.compositeError);
            if (initial.reloadNotice) showReloadToast();

            window.akari = window.akari || {};
            // Raw material video only: the bundled Electron decodes its picture but can omit
            // AAC audio. The backend extracts the embedded track as a FLAC sidecar; this
            // element follows the video transport without changing output-preview audio.
            if (initial.kind === 'raw' && initial.hasSourceAudio === true) {
                let rawAudio = null;
                let rawAudioUrl = null;
                let rawAudioActive = false;
                const stopRawAudio = () => {
                    rawAudioActive = false;
                    window.akari.rawAudioActive = false;
                    rawAudio?.pause();
                    const wantMuted = video.dataset.akariGlobalMuted === 'true';
                    if (video.muted !== wantMuted) video.muted = wantMuted;
                };
                const syncRawAudio = () => {
                    if (!rawAudio || !rawAudioActive) return;
                    const wantMuted = video.dataset.akariGlobalMuted === 'true';
                    if (rawAudio.muted !== wantMuted) rawAudio.muted = wantMuted;
                    if (rawAudio.volume !== video.volume) rawAudio.volume = video.volume;
                    if (rawAudio.playbackRate !== video.playbackRate) rawAudio.playbackRate = video.playbackRate;
                    if (!rawAudio.seeking && rawAudio.readyState >= 1 && Number.isFinite(video.currentTime)
                        && Math.abs(rawAudio.currentTime - video.currentTime) > 0.09) {
                        try { rawAudio.currentTime = Math.min(video.currentTime,
                            Number.isFinite(rawAudio.duration) ? Math.max(0, rawAudio.duration - 0.005) : video.currentTime); }
                        catch (_error) { /* metadata is changing; the next tick will retry */ }
                    }
                    if (video.paused || video.ended) {
                        if (!rawAudio.paused) rawAudio.pause();
                    } else if (rawAudio.paused) {
                        void rawAudio.play().catch(stopRawAudio);
                    }
                };
                window.akari.rawAudioActive = false;
                window.akari.rawAudioSync = syncRawAudio;
                for (const eventName of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'volumechange', 'timeupdate']) {
                    video.addEventListener(eventName, syncRawAudio);
                }
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message?.type !== 'akari-preview-raw-audio-ready'
                        || message.pageId !== initial.playbackPageId || typeof message.url !== 'string') return;
                    if (rawAudio && rawAudioUrl === message.url) return;
                    stopRawAudio();
                    rawAudio?.remove();
                    rawAudioUrl = message.url;
                    rawAudio = document.createElement('audio');
                    rawAudio.dataset.akariRawSidecar = 'true';
                    rawAudio.crossOrigin = 'anonymous';
                    rawAudio.preload = 'auto';
                    rawAudio.hidden = true;
                    rawAudio.addEventListener('canplay', () => {
                        rawAudioActive = true;
                        window.akari.rawAudioActive = true;
                        if (!video.muted) video.muted = true;
                        syncRawAudio();
                    }, { once: true });
                    rawAudio.addEventListener('error', stopRawAudio, { once: true });
                    document.body.append(rawAudio);
                    rawAudio.src = message.url;
                    rawAudio.load();
                });
                window.addEventListener('pagehide', stopRawAudio, { once: true });
                vscode.postMessage({ type: 'akari-preview-raw-audio-request', pageId: initial.playbackPageId });
            }
            window.akari.previewPlaybackRate = clampPreviewPlaybackRateFn(initial.initialPlaybackRate);
            window.akari.state = { editPath: initial.editPath, summary: initial.summary, selectionFloor: initial.selectionFloor };
            window.akari.showWriteError = error => {
                const reason = error instanceof Error ? error.message : String(error || '書き込みに失敗しました');
                writeErrorMessage.textContent = reason;
                writeErrorBanner.hidden = false;
            };
            writeErrorDismiss.addEventListener('click', () => {
                writeErrorBanner.hidden = true;
            });
            window.akari.engine = {
                overlayWriteBatch: writes => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'overlay-write-batch', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write-batch', requestId, writes });
                }),
                overlayWrite: (_editPath, overlayId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'overlay-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write', requestId, overlayId, patch });
                }),
                layerWrite: (layerId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'layer-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-layer-write', requestId, layerId, patch });
                }),
                photoAnalyze: (itemId, kind) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'photo-analyze', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-photo-analyze', requestId, itemId, kind });
                }),
                cutWrite: (cutIndex, cutId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'cut-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-cut-write', requestId, cutIndex, cutId, patch });
                }),
                captionWrite: (captionId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'caption-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-caption-write', requestId, captionId, patch });
                }),
                mixedMove: (writes, cuePositions) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'mixed-move', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-mixed-move', requestId, writes, cuePositions });
                }),
                // task/2026-08-09-drop-hevc-proxy: <video> が実際に再生失敗したときだけ呼ぶ
                // フォールバック要求。成功時はホスト側が widget を丸ごとリロードするので、呼び出し側
                // (previewBootstrapScript) は resolve を特に処理しない — 失敗時だけ通常のエラー表示に
                // 戻す。
                resolveHevcFallback: (errorCode, videoUri) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-hevc-fallback-' + (++sequence);
                    pending.set(requestId, { kind: 'hevc-fallback', resolve, reject });
                    vscode.postMessage({
                        type: 'akari-preview-hevc-fallback-request', requestId, errorCode,
                        ...(typeof videoUri === 'string' && videoUri ? { videoUri } : {})
                    });
                })
            };
            let sharedPreviewAudioContext = null;
            let sharedPreviewAudioContextFailed = false;
            window.akari.ensurePreviewAudioContext = () => {
                if (sharedPreviewAudioContext && sharedPreviewAudioContext.state !== 'closed') {
                    return sharedPreviewAudioContext;
                }
                if (sharedPreviewAudioContextFailed) return null;
                try {
                    sharedPreviewAudioContext = new AudioContext();
                } catch (error) {
                    sharedPreviewAudioContextFailed = true;
                    console.warn('[akari-preview] audio graph unavailable; continuing with video only', error);
                    return null;
                }
                window.addEventListener('pagehide', () => {
                    void sharedPreviewAudioContext.close().catch(() => undefined);
                }, { once: true });
                return sharedPreviewAudioContext;
            };
            const createPreviewAudio = () => {
                let config = initial.summary && initial.summary.audio;
                const hasAudio = config && ((Array.isArray(config.bgms) && config.bgms.length > 0) || config.bgm
                    || (Array.isArray(config.sfx) && config.sfx.length > 0)
                    || (Array.isArray(config.narration) && config.narration.length > 0)
                    || (Array.isArray(config.speech) && config.speech.some(item => item.role === 'speech')));
                if (!hasAudio) return null;

                const context = window.akari.ensurePreviewAudioContext();
                if (!context) return null;
                const masterGain = context.createGain();
                let playbackRate = clampPreviewPlaybackRateFn(initial.initialPlaybackRate);
                let pitchShiftNode = null;
                let pitchShiftReady = false;
                let stretcher = 'none';
                let pitchShiftWarningEmitted = false;
                const warnPitchShiftUnavailable = error => {
                    if (pitchShiftWarningEmitted) return;
                    pitchShiftWarningEmitted = true;
                    console.warn('[akari-preview] pitch-preserving playback unavailable; using native playback rate', error);
                };
                const meterAnalyser = context.createAnalyser();
                meterAnalyser.connect(context.destination);
                window.akari.legacyAudioMeterAnalyser = meterAnalyser;
                const routeMasterBus = () => {
                    try { masterGain.disconnect(); } catch (_error) { /* already detached */ }
                    if (pitchShiftNode) {
                        try { pitchShiftNode.disconnect(); } catch (_error) { /* already detached */ }
                    }
                    stretcher = 'none';
                    if (playbackRate !== 1 && pitchShiftReady) {
                        try {
                            pitchShiftNode = pitchShiftNode || new AudioWorkletNode(context, 'akari-pitch-shift', {
                                parameterData: { ratio: 1 / playbackRate }
                            });
                            const ratio = pitchShiftNode.parameters.get('ratio');
                            if (ratio) ratio.value = 1 / playbackRate;
                            masterGain.connect(pitchShiftNode);
                            pitchShiftNode.connect(meterAnalyser);
                            stretcher = 'worklet';
                            return;
                        } catch (error) {
                            warnPitchShiftUnavailable(error);
                        }
                    }
                    masterGain.connect(meterAnalyser);
                };
                routeMasterBus();
                if (initial.previewAudioWorkletUrl) {
                    if (context.audioWorklet && typeof context.audioWorklet.addModule === 'function') {
                        void context.audioWorklet.addModule(initial.previewAudioWorkletUrl).then(() => {
                            pitchShiftReady = true;
                            routeMasterBus();
                        }, warnPitchShiftUnavailable);
                    } else {
                        warnPitchShiftUnavailable(new Error('AudioContext.audioWorklet is unavailable'));
                    }
                }
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx/bgm trim + schedule
                // math, shared with this same module's node:test unit tests
                // (test/audio-schedule.test.mjs) via src/common/audio-schedule.ts -- see that file's
                // header comment (same pattern as preview-composite-layout.ts's fitCompositeRect
                // below).
                const resolveSfxTrimWindowFn = (${resolveSfxTrimWindow.toString()});
                const resolveBgmSourceOffsetFn = (${resolveBgmSourceOffset.toString()});
                const bgmLoopOffsetSecondsFn = (${bgmLoopOffsetSeconds.toString()});
                const resolveTimedScheduleWindowFn = (${resolveTimedScheduleWindow.toString()});
                const sfxFadeGainScheduleFn = (${sfxFadeGainSchedule.toString()});
                // 音声エンベロープの正本は packages/edit-store/src/envelope.ts。
                const computeDuckEnvelopeFn = (${computeDuckEnvelope.toString()});
                const evaluateEnvelopeDbFn = (${evaluateEnvelopeDb.toString()});
                const decoded = { bgm: null, bgms: [], sfx: [], narration: [] };
                let timelineDuration = 0;
                let loadPromise = null;
                let generation = 0;
                let active = [];
                let bgmGain = null;
                let bgmEnvelopeGain = null;
                let scrubBgmGain = null;
                let lastDuckGainDb = null;
                let mutedAudioTracks = new Set();
                let allAudioMuted = false;

                const dbToLinear = gainDb => Math.pow(10, gainDb / 20);
                // クリップ全体ミュート（akariGlobalMuted。クリップ帯のスピーカートグルが送る旧 setMuted
                // イベント由来）は video.muted のみに効かせる。BGM/SFX/narration の audibility は
                // audio scope の個別ミュート（allAudioMuted/mutedAudioTracks）で独立制御する
                // （クリップのスピーカーを OFF にしても BGM/SFX は継続する契約要求のため）。
                const syncMasterGain = () => {
                    if (video.dataset.akariTransitionAudioActive === 'true') return;
                    const volume = Number.isFinite(video.volume) ? Math.max(0, Math.min(1, video.volume)) : 1;
                    masterGain.gain.value = volume;
                };
                const warnUnavailable = (kind, id, error) => {
                    console.warn('[akari-preview] ' + kind + ' ' + id
                        + ' unavailable (fetch/decode failed); skipping element', error);
                };
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (consumption side): 実尺
                // (the real decoded duration) is only known post-decode, so in/out clamping happens
                // here, via the shared resolveSfxTrimWindowFn/resolveBgmSourceOffsetFn -- mirrors
                // packages/render-cut/src/plan.mjs's resolveSfxTrim/resolveBgmInSeconds.
                // 2026-09-02 preview-perf: 同じ URL の fetch + decodeAudioData は load() ごとに 1 回だけ
                // （159 挿入 / 37 ユニークなら 37 回）。AudioBuffer は不変なので spec 間で共有できる。
                // in/out の切り出し（resolveSfxTrimWindowFn）は従来どおり spec ごと。updateConfig の
                // 再読込では load() が Map を作り直すので、差し替わった素材を古い buffer で鳴らさない。
                let decodedBufferBySrc = new Map();
                const fetchDecodedBuffer = src => {
                    const shared = decodedBufferBySrc.get(src);
                    if (shared) return shared;
                    const pending = (async () => {
                        const response = await fetch(src);
                        if (!response.ok) throw new Error('fetch status=' + response.status);
                        const buffer = await context.decodeAudioData(await response.arrayBuffer());
                        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
                            throw new Error('decoded audio duration is invalid');
                        }
                        return buffer;
                    })();
                    decodedBufferBySrc.set(src, pending);
                    return pending;
                };
                const decodeOne = async (kind, spec) => {
                    try {
                        const buffer = await fetchDecodedBuffer(spec.src);
                        if (kind !== 'bgm' && (spec.in !== undefined || spec.out !== undefined)) {
                            const trimWindow = resolveSfxTrimWindowFn(spec.in, spec.out, buffer.duration, kind + ' ' + spec.id);
                            if (trimWindow.warning) console.warn('[akari-preview] ' + trimWindow.warning);
                            if (trimWindow.skip) return null;
                            return { ...spec, buffer, durationSec: trimWindow.durationSec, sourceOffset: trimWindow.sourceOffset };
                        }
                        if (kind === 'bgm' && spec.in !== undefined) {
                            const resolved = resolveBgmSourceOffsetFn(spec.in, buffer.duration);
                            if (resolved.warning) console.warn('[akari-preview] ' + resolved.warning);
                            return { ...spec, buffer, durationSec: buffer.duration, sourceOffset: resolved.sourceOffset };
                        }
                        return { ...spec, buffer, durationSec: buffer.duration };
                    } catch (error) {
                        if (context.state !== 'closed') {
                            warnUnavailable(kind, spec.id || kind, error);
                        }
                        return null;
                    }
                };
                const load = duration => {
                    if (Number.isFinite(duration) && duration > 0) timelineDuration = duration;
                    if (loadPromise || timelineDuration <= 0) return loadPromise || Promise.resolve();
                    loadPromise = (async () => {
                        decodedBufferBySrc = new Map();
                        const timed = async (kind, specs) => {
                            const valid = [];
                            for (const spec of Array.isArray(specs) ? specs : []) {
                                if (!Number.isFinite(spec.t) || spec.t < 0 || spec.t >= timelineDuration) {
                                    console.warn('[akari-preview] ' + kind + ' ' + spec.id
                                        + ' skipped: t is outside timeline duration');
                                    continue;
                                }
                                valid.push(spec);
                            }
                            return (await Promise.all(valid.map(spec => decodeOne(kind, spec)))).filter(Boolean);
                        };
                        const [bgm, sfx, narration] = await Promise.all([
                            Promise.all((config.bgms || (config.bgm ? [config.bgm] : [])).map((item, index) =>
                                decodeOne('bgm', { ...item, id: item.id || ('bgm-' + index) }))),
                            timed('sfx', config.sfx),
                            timed('narration', [
                                ...(config.narration || []),
                                ...(config.speech || []).filter(item => item.role === 'speech')
                            ])
                        ]);
                        decoded.bgms = bgm.filter(Boolean);
                        decoded.bgm = decoded.bgms[0] || null;
                        decoded.sfx = sfx;
                        decoded.narration = narration;
                        if (context.state !== 'closed') {
                            console.info('[akari-preview] audio graph ready', {
                                contextState: context.state,
                                timelineDuration,
                                decoded: {
                                    bgm: decoded.bgms.length,
                                    sfx: decoded.sfx.map(item => item.id),
                                    narration: decoded.narration.map(item => item.id)
                                }
                            });
                        }
                    })();
                    return loadPromise;
                };
                const detachActive = item => {
                    active = active.filter(candidate => candidate !== item);
                    try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                    try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                    try { item.envelopeGain.disconnect(); } catch (_error) { /* already detached */ }
                };
                const stopSources = () => {
                    const sources = active;
                    active = [];
                    bgmGain = null;
                    bgmEnvelopeGain = null;
                    lastDuckGainDb = null;
                    for (const item of sources) {
                        item.source.onended = null;
                        try { item.source.stop(); } catch (_error) { /* already stopped */ }
                        try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                        try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                        try { item.envelopeGain.disconnect(); } catch (_error) { /* already detached */ }
                    }
                };
                const registerSource = (
                    source, gain, envelopeGain, kind, id, track, spec, baseGainLinear, hasFade = false
                ) => {
                    const item = { source, gain, envelopeGain, kind, id, track, spec, baseGainLinear, hasFade };
                    active.push(item);
                    source.onended = () => detachActive(item);
                    return item;
                };
                const narrationDuckIntervals = () => decoded.narration.map(item => ({
                    startSec: item.t,
                    endSec: item.t + item.durationSec
                }));
                const envelopeDbAt = (item, timelineTime, clipStartSec, clipDurationSec) => {
                    const localSec = Math.max(0, timelineTime - clipStartSec);
                    const keyframeGainDb = evaluateEnvelopeDbFn(item.keyframes || [], localSec);
                    if (item.ducking !== true) return { keyframeGainDb, duckGainDb: 0 };
                    const duckEnvelope = computeDuckEnvelopeFn(narrationDuckIntervals(), {
                        duckDb: item.duckDb,
                        attackSec: item.duckAttack,
                        releaseSec: item.duckRelease,
                        clipStartSec,
                        clipDurationSec
                    });
                    return {
                        keyframeGainDb,
                        duckGainDb: evaluateEnvelopeDbFn(duckEnvelope, localSec)
                    };
                };
                const fadeMultiplierAt = (item, timelineTime) => {
                    const total = Number(item.duration) > 0 ? item.duration : timelineDuration;
                    const local = timelineTime - (Number(item.t) || 0);
                    const rawIn = item.fadeIn;
                    const rawOut = item.fadeOut;
                    const fadeIn = Number.isFinite(rawIn) && rawIn > 0 ? Math.min(rawIn, total / 2) : 0;
                    const fadeOut = Number.isFinite(rawOut) && rawOut > 0 ? Math.min(rawOut, total / 2) : 0;
                    let multiplier = 1;
                    if (fadeIn > 0 && local < fadeIn) multiplier = Math.min(multiplier, local / fadeIn);
                    if (fadeOut > 0 && local > total - fadeOut) multiplier = Math.min(multiplier, (total - local) / fadeOut);
                    return Math.max(0, Math.min(1, multiplier));
                };
                const applyBgmEnvelope = timelineTime => {
                    for (const node of active.filter(candidate => candidate.kind === 'bgm')) {
                        const item = node.spec;
                        const clipStart = Number(item.t) || 0;
                        const clipDuration = Number(item.duration) > 0 ? item.duration : timelineDuration - clipStart;
                        const { keyframeGainDb, duckGainDb } = envelopeDbAt(item, timelineTime, clipStart, clipDuration);
                        const fadeMultiplier = fadeMultiplierAt(item, timelineTime);
                        node.gain.gain.value = allAudioMuted || mutedAudioTracks.has(item.track ?? 0)
                            ? 0 : dbToLinear(item.gainDb) * fadeMultiplier;
                        node.envelopeGain.gain.value = dbToLinear(keyframeGainDb + duckGainDb);
                        if (duckGainDb !== lastDuckGainDb) {
                            lastDuckGainDb = duckGainDb;
                            console.info('[akari-preview] bgm duck gain', {
                                timelineTime, id: item.id, duckGainDb, keyframeGainDb,
                                appliedGainDb: item.gainDb + keyframeGainDb + duckGainDb
                            });
                        }
                    }
                };
                const scheduleFrom = async timelineTime => {
                    const scheduleGeneration = ++generation;
                    stopSources();
                    await load(timelineDuration);
                    if (scheduleGeneration !== generation || timelineDuration <= 0) return;
                    const startAt = Math.max(0, Math.min(timelineDuration, timelineTime));
                    const contextStart = context.currentTime + 0.015;
                    const remaining = timelineDuration - startAt;
                    let scheduledBgm = false;
                    let scheduledSfx = 0;
                    let scheduledNarration = 0;
                    for (const item of decoded.bgms) {
                        const clipStart = Number(item.t) || 0;
                        const clipEnd = Math.min(timelineDuration, clipStart + (Number(item.duration) > 0 ? item.duration : timelineDuration - clipStart));
                        if (clipEnd <= startAt || clipEnd <= clipStart) continue;
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            const envelopeGain = context.createGain();
                            source.buffer = item.buffer;
                            source.loop = true;
                            source.playbackRate.value = playbackRate;
                            source.connect(gain);
                            gain.connect(envelopeGain);
                            envelopeGain.connect(masterGain);
                            if (!bgmGain) { bgmGain = gain; bgmEnvelopeGain = envelopeGain; }
                            registerSource(source, gain, envelopeGain, 'bgm', item.id, item.track ?? 0, item,
                                dbToLinear(item.gainDb));
                            const timelineSourceStart = Math.max(startAt, clipStart);
                            const delay = timelineSourceStart - startAt;
                            const sourceElapsed = timelineSourceStart - clipStart;
                            const bgmOffset = bgmLoopOffsetSecondsFn(item.sourceOffset || 0, sourceElapsed, item.durationSec);
                            source.start(contextStart + delay / playbackRate, bgmOffset);
                            source.stop(contextStart + (clipEnd - startAt) / playbackRate);
                            scheduledBgm = true;
                        } catch (error) {
                            warnUnavailable('bgm', item.id, error);
                        }
                    }
                    applyBgmEnvelope(startAt);
                    const scheduleTimed = (kind, item) => {
                        // audio.sfx.in: material source offset, composed via resolveTimedScheduleWindowFn
                        // with the existing resume-from-mid-playback offset -- when item.sourceOffset is
                        // absent (narration; sfx without in/out) this reduces to the original schedule math.
                        const scheduleWindow = resolveTimedScheduleWindowFn(item.t, item.durationSec, item.sourceOffset || 0, startAt, timelineDuration, remaining);
                        if (!scheduleWindow.shouldSchedule) return false;
                        const delay = scheduleWindow.delaySec;
                        const offset = scheduleWindow.sourceOffsetSec;
                        const available = scheduleWindow.availableSec;
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            const envelopeGain = context.createGain();
                            const baseGainLinear = dbToLinear(item.gainDb);
                            source.buffer = item.buffer;
                            source.playbackRate.value = playbackRate;
                            gain.gain.value = baseGainLinear;
                            source.connect(gain);
                            gain.connect(envelopeGain);
                            envelopeGain.connect(masterGain);
                            const envelope = envelopeDbAt(
                                item, Math.max(startAt, item.t), item.t, item.durationSec
                            );
                            envelopeGain.gain.value = dbToLinear(envelope.keyframeGainDb + envelope.duckGainDb);
                            // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum
                            // (audio-clip-fades, 2026-08-18; sfx only): fade_in/fade_out, applied as
                            // AudioParam automation over the clip's own scheduled window (not a
                            // per-tick poll like bgm's fadeMultiplierAt -- this source is a one-shot
                            // BufferSourceNode, not a continuously re-evaluated loop). hasFade tells
                            // tick()'s mute-sync loop to leave gain.value alone so it doesn't clobber
                            // the in-flight ramp on its next 30Hz pass.
                            let hasFade = false;
                            if (kind === 'sfx' && (item.fadeIn !== undefined || item.fadeOut !== undefined)) {
                                const fadeSchedule = sfxFadeGainScheduleFn(item.fadeIn, item.fadeOut, item.durationSec, scheduleWindow.elapsedIntoItemSec, available);
                                if (fadeSchedule.length > 0) {
                                    hasFade = true;
                                    const startTime = contextStart + delay / playbackRate;
                                    gain.gain.cancelScheduledValues(startTime);
                                    gain.gain.setValueAtTime(baseGainLinear * fadeSchedule[0].gainMultiplier, startTime);
                                    for (let i = 1; i < fadeSchedule.length; i += 1) {
                                        gain.gain.linearRampToValueAtTime(
                                            baseGainLinear * fadeSchedule[i].gainMultiplier,
                                            startTime + fadeSchedule[i].offsetSec / playbackRate
                                        );
                                    }
                                }
                            }
                            registerSource(
                                source, gain, envelopeGain, kind, item.id, item.track, item,
                                baseGainLinear, hasFade
                            );
                            source.start(contextStart + delay / playbackRate, offset, available);
                            return true;
                        } catch (error) {
                            warnUnavailable(kind, item.id, error);
                            return false;
                        }
                    };
                    for (const item of decoded.sfx) {
                        if (scheduleTimed('sfx', item)) scheduledSfx += 1;
                    }
                    for (const item of decoded.narration) {
                        if (scheduleTimed('narration', item)) scheduledNarration += 1;
                    }
                    console.info('[akari-preview] audio scheduled', {
                        timelineTime: startAt,
                        bgm: scheduledBgm,
                        sfx: scheduledSfx,
                        narration: scheduledNarration
                    });
                };
                const controller = {
                    setTimelineDuration: duration => load(duration),
                    setMutedTracks: (trackSet, allMuted) => {
                        mutedAudioTracks = new Set(trackSet);
                        allAudioMuted = allMuted === true;
                    },
                    resume: () => context.resume().catch(error => {
                        console.warn('[akari-preview] AudioContext resume failed; continuing with video only', error);
                    }),
                    playFrom: timelineTime => controller.resume().then(() => scheduleFrom(timelineTime)),
                    setRate: (value, timelineTime, playing) => {
                        const nextRate = clampPreviewPlaybackRateFn(value);
                        if (nextRate === playbackRate) return Promise.resolve();
                        playbackRate = nextRate;
                        routeMasterBus();
                        return playing ? scheduleFrom(timelineTime) : Promise.resolve();
                    },
                    pause: () => {
                        generation += 1;
                        stopSources();
                    },
                    scrubBgm: timelineTime => {
                        const bgm = decoded.bgms.find(item => timelineTime >= (Number(item.t) || 0)
                            && timelineTime < (Number(item.t) || 0) + (Number(item.duration) > 0 ? item.duration : timelineDuration));
                        if (!bgm || !bgm.buffer) return undefined;
                        if (!scrubBgmGain) {
                            scrubBgmGain = context.createGain();
                            scrubBgmGain.gain.value = 0;
                            scrubBgmGain.connect(masterGain);
                        }
                        const muted = allAudioMuted || mutedAudioTracks.has(bgm.track ?? 0);
                        // 既存の envelope 埋め込みはモジュール内 helper を toString() で持ち込めず
                        // webview で参照エラーになることがある。スクラブ断片は envelope 無しでも
                        // 本編と BGM を鳴らし続けることを優先する。
                        let envelopeDb = 0;
                        try {
                            const { keyframeGainDb, duckGainDb } = envelopeDbAt(
                                bgm, timelineTime, Number(bgm.t) || 0, Number(bgm.duration) > 0 ? bgm.duration : timelineDuration
                            );
                            if (Number.isFinite(keyframeGainDb + duckGainDb)) {
                                envelopeDb = keyframeGainDb + duckGainDb;
                            }
                        } catch (_error) {
                            envelopeDb = 0;
                        }
                        scrubBgmGain.gain.value = muted ? 0
                            : dbToLinear(bgm.gainDb + envelopeDb)
                                * fadeMultiplierAt(bgm, timelineTime);
                        scrubBgmGain._buffer = bgm.buffer;
                        return {
                            node: scrubBgmGain,
                            spec: { t: Number(bgm.t) || 0, in: bgm.sourceOffset || 0, loop: true }
                        };
                    },
                    updateConfig: async (nextConfig, timelineTime, playing) => {
                        generation += 1;
                        stopSources();
                        config = nextConfig || { sfx: [], narration: [] };
                        decoded.bgm = null;
                        decoded.bgms = [];
                        decoded.sfx = [];
                        decoded.narration = [];
                        loadPromise = null;
                        await load(timelineDuration);
                        if (playing) await scheduleFrom(timelineTime);
                    },
                    tick: (timelineTime, playing) => {
                        syncMasterGain();
                        for (const item of active.filter(candidate =>
                            candidate.kind === 'sfx' || candidate.kind === 'narration')) {
                            const muted = allAudioMuted || mutedAudioTracks.has(item.track);
                            if (muted) {
                                item.gain.gain.value = 0;
                            } else if (!item.hasFade) {
                                item.gain.gain.value = item.baseGainLinear;
                            }
                            const envelope = envelopeDbAt(
                                item.spec, timelineTime, item.spec.t, item.spec.durationSec
                            );
                            item.envelopeGain.gain.value = dbToLinear(
                                envelope.keyframeGainDb + envelope.duckGainDb
                            );
                            // else: fade_in/fade_out already drives gain.gain via the scheduled
                            // AudioParam ramp (audio-clip-fades) -- writing item.gain.gain.value here
                            // (even to its own current value) would insert a new automation event
                            // and cut the ramp short, so this 30Hz poll leaves it alone while unmuted.
                        }
                        if (playing) applyBgmEnvelope(timelineTime);
                    },
                    debugState: () => ({
                        contextState: context.state,
                        timelineDuration,
                        decoded: {
                            bgm: decoded.bgms.length,
                            bgmSourceOffset: decoded.bgm ? decoded.bgm.sourceOffset || 0 : null,
                            sfx: decoded.sfx.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec, sourceOffset: item.sourceOffset || 0 })),
                            narration: decoded.narration.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec }))
                        },
                        mutedTracks: [...mutedAudioTracks],
                        allMuted: allAudioMuted,
                        active: active.map(item => ({
                            kind: item.kind,
                            id: item.id,
                            track: item.track,
                            gainLinear: item.gain.gain.value
                        })),
                        activeCounts: {
                            bgm: active.filter(item => item.kind === 'bgm').length,
                            sfx: active.filter(item => item.kind === 'sfx').length,
                            narration: active.filter(item => item.kind === 'narration').length
                        },
                        rate: playbackRate,
                        pitchPreserved: playbackRate === 1 || stretcher === 'worklet',
                        stretcher,
                        masterGainLinear: masterGain.gain.value,
                        bgmGainLinear: bgmGain ? bgmGain.gain.value : null,
                        duckGainDb: lastDuckGainDb
                    })
                };
                syncMasterGain();
                video.addEventListener('volumechange', syncMasterGain);
                standbyVideo.addEventListener('volumechange', syncMasterGain);
                window.addEventListener('pagehide', () => {
                    controller.pause();
                    void context.close().catch(() => undefined);
                }, { once: true });
                controller.dispose = () => {
                    controller.pause();
                    void context.close().catch(() => undefined);
                };
                return controller;
            };
            // frame-engine 経路の音は engine 側の AudioContext が持つ。legacy の音声グラフ
            //（AudioContext + 素材ごとの decode）を作ってすぐ捨てるのをやめる
            //（task/2026-09-02-preview-perf）。frame-engine が起動できないときは host が legacy で
            // webview を作り直すので、この文書内で legacy の音が要ることはない。
            window.akari.previewAudio = initial.frameEngineEnabled === true ? null : createPreviewAudio();
            window.akari.previewAudioDebug = () => window.akari.previewAudio
                ? window.akari.previewAudio.debugState()
                : { disabled: true };
            window.akari.requestFrameEngineFallback = () => vscode.postMessage({ type: 'akari-preview-frame-engine-fallback' });
            window.akari.requestAudioPriority = time => vscode.postMessage({ type: 'akari-preview-audio-priority', time });
            window.akari.stageScale = () => frameScale;
            const measureAudioMeterBlock = (${measureBlock.toString()});
            const audioMeterDb = (${linearToDbfs.toString()});
            const audioMeterClip = (${latchClip.toString()});
            let audioMeterTap = null;
            let lastAudioMeterAt = -Infinity;
            let audioMeterWasPlaying = false;
            let lastAudioMeterZeroTime = null;
            window.akari.attachAudioMeter = (analyser, engine) => {
                if (audioMeterTap) audioMeterTap.dispose();
                audioMeterTap = null;
                if (!analyser) return;
                const context = analyser.context;
                const splitter = context.createChannelSplitter(2);
                const left = context.createAnalyser();
                const right = context.createAnalyser();
                left.fftSize = right.fftSize = 2048;
                // Only the extra analysis branch is detached. The analyser's existing
                // destination connection belongs to the audio supply and stays intact.
                const dispose = () => {
                    try { analyser.disconnect(splitter); } catch (_error) { /* detached */ }
                    splitter.disconnect();
                    left.disconnect();
                    right.disconnect();
                };
                try {
                    analyser.connect(splitter);
                    splitter.connect(left, 0);
                    splitter.connect(right, 1);
                    // L/R outputs intentionally remain unconnected (no audible second path).
                    audioMeterTap = {
                        analyser, left, right, engine, dispose,
                        leftSamples: new Float32Array(2048), rightSamples: new Float32Array(2048)
                    };
                } catch (_error) {
                    dispose();
                }
            };
            window.akari.audioMeterTick = (time, playing, immediate = false) => {
                const now = performance.now();
                const tap = audioMeterTap;
                const channels = tap && tap.analyser.channelCount === 1 ? 1 : 2;
                const engine = tap ? tap.engine : initial.frameEngineEnabled === true ? 'frame-engine' : 'legacy';
                const t = Number.isFinite(time) ? Math.max(0, time) : 0;
                const clock = engine === 'frame-engine' && window.akari.frameEngineClock;
                const ended = clock && t >= clock.totalDuration;
                if (!playing || ended || immediate) {
                    if (!audioMeterWasPlaying && lastAudioMeterZeroTime === t) return;
                    audioMeterWasPlaying = false;
                    lastAudioMeterZeroTime = t;
                    lastAudioMeterAt = now;
                    vscode.postMessage({ type: 'akari-preview-audio-meter', peak: [0, 0], rms: [0, 0],
                        clip: false, playing: false, channels, engine, t });
                    return;
                }
                audioMeterWasPlaying = true;
                lastAudioMeterZeroTime = null;
                let left = { peak: 0, rms: 0 };
                let right = left;
                if (tap && tap.analyser.context.state === 'running') {
                    tap.left.getFloatTimeDomainData(tap.leftSamples);
                    left = measureAudioMeterBlock(tap.leftSamples);
                    if (channels === 1) right = left;
                    else {
                        tap.right.getFloatTimeDomainData(tap.rightSamples);
                        right = measureAudioMeterBlock(tap.rightSamples);
                    }
                }
                if (now - lastAudioMeterAt < 33) return;
                lastAudioMeterAt = now;
                vscode.postMessage({ type: 'akari-preview-audio-meter',
                    peak: [left.peak, right.peak], rms: [left.rms, right.rms],
                    clip: audioMeterClip(false, audioMeterDb(Math.max(left.peak, right.peak))),
                    playing: true, channels, engine, t });
            };
            if (window.akari.legacyAudioMeterAnalyser) {
                window.akari.attachAudioMeter(window.akari.legacyAudioMeterAnalyser, 'legacy');
            }
            window.addEventListener('pagehide', () => {
                if (audioMeterTap) audioMeterTap.dispose();
                audioMeterTap = null;
            }, { once: true });
            window.akari.playbackTick = (time, playing, immediate = false) => {
                window.akari.expirePreviewSelections?.(time);
                if (Number.isFinite(time)) contextMenuTimelineT = Math.max(0, time);
                window.akari.updateEmptyCanvasHint?.(time);
                const now = performance.now();
                if (!immediate && now - lastPlaybackTickAt < 50) return;
                lastPlaybackTickAt = now;
                vscode.postMessage({
                    type: 'akari-preview-playback-tick', time, playing, pageId: initial.playbackPageId,
                    positionReady: window.akari.previewPositionReady === true,
                    trialToken: window.akari.swapTrialPlaybackToken,
                    rate: clampPreviewPlaybackRateFn(window.akari.previewPlaybackRate)
                });
            };
            window.akari.persistPlaybackRate = rate => {
                vscode.postMessage({ type: 'akari-preview-playback-rate', rate });
            };
            window.akari.reviewTransport = event => {
                vscode.postMessage({ type: 'akari-preview-review-transport-event', event });
            };
            window.akari.reviewStrokeStart = frame => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-start', frame });
            };
            window.akari.reviewStrokeEnd = points => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-end', points });
            };
            // window.akari 経由で公開する -- previewBootstrapScript は別 IIFE（hostAdapterScript
            // とスコープを共有しない）ため、window.akari.reviewStrokeStart 等と同じく window 越しに
            // 呼ぶ必要がある。
            window.akari.reviewSetToolMode = mode => {
                vscode.postMessage({ type: 'akari-preview-review-tool-mode-request', mode });
            };
            window.akari.reviewRectStart = frame => {
                vscode.postMessage({ type: 'akari-preview-review-rect-start', frame });
            };
            window.akari.reviewRectEnd = box => {
                vscode.postMessage({ type: 'akari-preview-review-rect-end', box });
            };
            window.akari.previewContentEnd = ${previewContentEnd.toString()};
            window.akari.previewCaptions = Array.isArray(initial.captions) ? initial.captions : [];
            window.akari.reportPreviewFrameCapture = message => vscode.postMessage(message);
            window.akari.reportReadySeek = message => vscode.postMessage(message);
            window.akari.reportSwapPlayback = message => vscode.postMessage({ ...message, pageId: initial.playbackPageId });
            window.akari.reportPrimarySelectionReady = () => {
                vscode.postMessage({ type: 'akari-preview-primary-selection-ready', pageId: initial.playbackPageId });
                vscode.postMessage({ type: 'akari-preview-generation-request' });
            };
            window.akari.requestGenerationUpdate = () => {
                vscode.postMessage({ type: 'akari-preview-generation-request' });
            };
            // Several drags may be waiting for their writes at once. Keep the host guard
            // raised until the last response, even if another pointer gesture has begun.
            let pendingGestureWrites = 0;
            window.akari.reportGesture = phase => {
                if (phase === 'begin') {
                    if (pendingGestureWrites++ !== 0) return;
                } else if (phase === 'end') {
                    if (pendingGestureWrites === 0 || --pendingGestureWrites !== 0) return;
                }
                vscode.postMessage({ type: 'akari-preview-gesture', phase });
            };
            let pendingLiveValues = null;
            let pendingLiveValuesFrame = null;
            window.akari.reportLiveValues = detail => {
                pendingLiveValues = detail;
                if (pendingLiveValuesFrame !== null) return;
                pendingLiveValuesFrame = requestAnimationFrame(() => {
                    pendingLiveValuesFrame = null;
                    if (pendingLiveValues) vscode.postMessage({ type: 'akari-preview-live-values', ...pendingLiveValues });
                    pendingLiveValues = null;
                });
            };
            let bagExpansionRequest = 0;
            window.akari.requestBagExpansion = bagId => {
                vscode.postMessage({ type: 'akari-preview-expand-bag', bagId, requestId: ++bagExpansionRequest });
            };
            window.akari.isCurrentBagExpansion = requestId => requestId === bagExpansionRequest;
            window.akari.reportOverlaySelection = (overlayId, scopeId, overlayIds) => {
                if (overlayId) selectedPrimary = null;
                vscode.postMessage({ type: 'akari-preview-overlay-selected', overlayId,
                    ...(scopeId !== undefined ? { scopeId } : {}),
                    ...(overlayIds !== undefined ? { overlayIds } : {}) });
            };
            window.akari.reportLayerSelection = layerId => {
                if (layerId) selectedPrimary = null;
                vscode.postMessage({ type: 'akari-preview-layer-selected', layerId });
            };
            window.akari.reportPhotoStroke = (itemId, stroke) => {
                vscode.postMessage({ type: 'akari-preview-photo-stroke', itemId, stroke });
            };
            window.akari.reportPhotoBrushEnd = () => vscode.postMessage({ type: 'akari-preview-photo-brush-end' });
            window.akari.reportPhotoClick = (itemId, point) => {
                vscode.postMessage({ type: 'akari-preview-photo-click', itemId, point });
            };
            window.akari.reportPhotoHover = (itemId, point) => {
                vscode.postMessage({ type: 'akari-preview-photo-hover', itemId, point });
            };
            window.akari.reportPhotoSelectEnd = itemId => {
                vscode.postMessage({ type: 'akari-preview-photo-select-end', itemId });
            };
            window.akari.reportCutSelection = cutId => {
                if (cutId) selectedPrimary = { kind: 'cut', id: cutId };
                else if (selectedPrimary?.kind === 'cut') selectedPrimary = null;
                vscode.postMessage({ type: 'akari-preview-cut-selected', cutId });
            };
            window.akari.reportCaptionSelection = captionId => {
                if (captionId) selectedPrimary = { kind: 'caption', id: captionId };
                else if (selectedPrimary?.kind === 'caption') selectedPrimary = null;
                vscode.postMessage({ type: 'akari-preview-caption-selected', captionId });
            };
            window.akari.reportMixedSelection = selection => {
                vscode.postMessage({ type: 'akari-preview-mixed-selected', selection });
            };
            window.akari.reportCaptionEditFocus = focused =>
                vscode.postMessage({ type: 'akari-preview-caption-edit-focus', focused });
            window.akari.requestCaptionInspector = field => {
                vscode.postMessage({ type: 'akari-preview-caption-inspector', field });
            };
            window.akari.reportLibraryDropGeometry = detail => {
                vscode.postMessage({ type: 'akari-preview-library-drop-geometry', ...detail });
            };
            window.akari.reportLibraryApplyHit = detail => {
                vscode.postMessage({ type: 'akari-preview-hit-test-response', ...detail });
            };
            window.akari.reportOverlayBox = detail => {
                vscode.postMessage({ type: 'akari-preview-overlay-box', ...detail });
            };
            window.akari.requestMyStyleSave = captionId => {
                vscode.postMessage({ type: 'akari-preview-my-style-save', captionId });
            };
            window.akari.requestRunStyles = captionId => {
                vscode.postMessage({ type: 'akari-preview-run-styles-request', captionId });
            };
            window.akari.reportRunStyleOmitted = notice => {
                vscode.postMessage({ type: 'akari-preview-run-style-omitted', notice });
            };
            window.akari.reportAltAll = on => vscode.postMessage({ type: 'akari-preview-alt-all', on });
            window.akari.reportContextBox = message => vscode.postMessage({ ...message, type: 'akari-preview-context-box' });
            if (outputPreviewLink && initial.relatedEditUri) {
                outputPreviewLink.addEventListener('click', () => {
                    vscode.postMessage({ type: 'akari-preview-open-output-request' });
                });
            }
            // 全画面はホスト側（togglePreviewFullscreen）の固定オーバーレイ実装に一本化する。
            // この webview の iframe（Theia webview / その内側の content iframe とも）は sandbox に
            // allowfullscreen が無く Element.requestFullscreen() は常に reject するため、
            // Fullscreen API はここでは使わない。旧実装はその失敗時に shell.toggleMaximized へ
            // 落ちていたが、タブバーが残る + 全画面中にタブを閉じると解除不能になるバグがあった。
            window.akari.toggleFullscreen = () => {
                vscode.postMessage({ type: 'akari-preview-fullscreen-toggle' });
                return Promise.resolve();
            };
            // Escape 解除経路（previewBootstrapScript は別 IIFE で vscode を持たないため window 越し）
            window.akari.exitFullscreen = () => {
                vscode.postMessage({ type: 'akari-preview-fullscreen-exit' });
            };
            // 全画面のまま setHTML 再描画（edit.json 変更など）されると webview 側の状態が
            // 初期値 false に戻るため、起動時にホストへ現在状態を問い合わせる。応答
            // （akari-preview-fullscreen-state）は非同期に届くので、後続の
            // previewBootstrapScript がリスナーを張り終えた後に処理される。
            vscode.postMessage({ type: 'akari-preview-fullscreen-sync-request' });

            const PENDING_RESPONSE_TYPES = {
                'overlay-write': 'akari-preview-overlay-write-response',
                'overlay-write-batch': 'akari-preview-overlay-write-batch-response',
                'layer-write': 'akari-preview-layer-write-response',
                'cut-write': 'akari-preview-cut-write-response',
                'caption-write': 'akari-preview-caption-write-response',
                'mixed-move': 'akari-preview-mixed-move-response',
                'hevc-fallback': 'akari-preview-hevc-fallback-response',
                'photo-analyze': 'akari-preview-photo-analyze-response'
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-refresh-error') {
                    showReloadError(message.message);
                    return;
                }
                if (message && message.type === 'akari-preview-refresh-ok') {
                    hideReloadError();
                    applyCompositeError(message.compositeError);
                    return;
                }
                if (!message || !Object.values(PENDING_RESPONSE_TYPES).includes(message.type)) return;
                const request = pending.get(message.requestId);
                if (!request) return;
                const expectedType = PENDING_RESPONSE_TYPES[request.kind];
                if (message.type !== expectedType) return;
                pending.delete(message.requestId);
                if (!message.ok) {
                    const fallback = request.kind === 'caption-write'
                        ? 'captions.json の書き込みに失敗しました'
                        : request.kind === 'hevc-fallback'
                            ? '動画の互換変換に失敗しました'
                            : 'edit.json の書き込みに失敗しました';
                    const reason = message.error || fallback;
                    window.akari.showWriteError(reason);
                    request.reject(new Error(reason));
                    return;
                }
                writeErrorBanner.hidden = true;
                request.resolve(request.kind === 'photo-analyze' ? message.result : undefined);
            });

            const fitCompositeRect = (${fitPreviewCompositeRect.toString()});
            const computeOutputFrameRect = () => {
                // #preview-stage 自身が output 比のキャンバス箱。getBoundingClientRect() の
                // sub-pixel 寸法を使い、内側へ二重の letterbox を作らない。
                const stageRect = previewStage.getBoundingClientRect();
                const zoomLayerRect = document.getElementById('zoom-layer').getBoundingClientRect();
                const zoomScaleX = zoomLayerRect.width > 0 && wrapper.clientWidth > 0
                    ? zoomLayerRect.width / wrapper.clientWidth : 1;
                const zoomScaleY = zoomLayerRect.height > 0 && wrapper.clientHeight > 0
                    ? zoomLayerRect.height / wrapper.clientHeight : 1;
                return {
                    x: 0,
                    y: 0,
                    width: stageRect.width / (zoomScaleX || 1),
                    height: stageRect.height / (zoomScaleY || 1)
                };
            };
            const computeContentRect = () => {
                const frameRect = computeOutputFrameRect();
                const boxWidth = frameRect.width;
                const boxHeight = frameRect.height;
                const videoWidth = video.videoWidth;
                const videoHeight = video.videoHeight;
                if (!(boxWidth > 0) || !(boxHeight > 0) || !(videoWidth > 0) || !(videoHeight > 0)) {
                    return frameRect;
                }
                const contentRect = fitCompositeRect(frameRect.width, frameRect.height, videoWidth, videoHeight);
                return {
                    x: frameRect.x + contentRect.x,
                    y: frameRect.y + contentRect.y,
                    width: contentRect.width,
                    height: contentRect.height
                };
            };
            // crop / perspective / keyframes を持つ media item は render-cut でも layer-style
            // （ソース実寸基準、crop 中心を錨に配置）へ入る。layer DOM と cut DOM が同じ描画式を
            // 必ず通るよう、既存 layer loop の本体をこの 1 関数へ寄せる。perspective と clip は
            // layer 側の既存純関数をそのまま使い、cut 用の計算は持たない。
            const mediaNaturalSize = media => ({
                width: media.tagName === 'IMG' ? media.naturalWidth : media.videoWidth,
                height: media.tagName === 'IMG' ? media.naturalHeight : media.videoHeight
            });
            const photoCropClipPolygonFn = (${photoCropClipPolygon.toString()});
            const photoFrameVisualFn = (${photoFrameVisual.toString()});
            const composePhotoPreviewMaskFn = (${composePhotoPreviewMask.toString()});
            const preparePhotoMask = media => {
                if (media.tagName !== 'IMG' || !(media.naturalWidth > 0) || !(media.naturalHeight > 0)) return;
                const key = media.src + ':' + media.dataset.akariPhotoMaskUrl + ':' + media.dataset.akariPhotoErase;
                if (media.akariPhotoMaskKey === key) return;
                media.akariPhotoMaskKey = key;
                media.akariPhotoHitAlpha = null;
                void (async () => {
                    const width = media.naturalWidth, height = media.naturalHeight;
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (!ctx) return;
                    let base = null;
                    if (media.dataset.akariPhotoMaskUrl) {
                        const maskImage = new Image();
                        maskImage.crossOrigin = 'anonymous';
                        maskImage.src = media.dataset.akariPhotoMaskUrl;
                        await maskImage.decode();
                        if (maskImage.naturalWidth !== width || maskImage.naturalHeight !== height) return;
                        ctx.drawImage(maskImage, 0, 0);
                        const pixels = ctx.getImageData(0, 0, width, height).data;
                        base = new Uint8Array(width * height);
                        for (let i = 0; i < base.length; i++) base[i] = pixels[i * 4];
                        ctx.clearRect(0, 0, width, height);
                    }
                    ctx.drawImage(media, 0, 0);
                    const rgba = ctx.getImageData(0, 0, width, height).data;
                    const alpha = new Uint8Array(width * height);
                    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
                    const strokes = JSON.parse(media.dataset.akariPhotoErase || '[]');
                    const gray = composePhotoPreviewMaskFn(base, width, height, strokes, alpha);
                    if (media.akariPhotoMaskKey !== key) return;
                    const visible = ctx.createImageData(width, height);
                    const borderMask = ctx.createImageData(width, height);
                    let hasDeclarationMask = false, hasBorderMask = false;
                    for (let i = 0; i < gray.length; i++) {
                        const offset = i * 4;
                        visible.data[offset] = visible.data[offset + 1] = visible.data[offset + 2] = 255;
                        visible.data[offset + 3] = gray[i];
                        borderMask.data[offset] = borderMask.data[offset + 1] = borderMask.data[offset + 2] = 255;
                        borderMask.data[offset + 3] = Math.floor((gray[i] * alpha[i] + 127) / 255);
                        if (gray[i] !== 255) hasDeclarationMask = true;
                        if (borderMask.data[offset + 3] !== 255) hasBorderMask = true;
                    }
                    media.akariPhotoHitAlpha = new Uint8Array(width * height);
                    for (let i = 0; i < gray.length; i++) media.akariPhotoHitAlpha[i] = borderMask.data[i * 4 + 3];
                    if (hasDeclarationMask) {
                        ctx.putImageData(visible, 0, 0);
                        const url = 'url("' + canvas.toDataURL('image/png') + '")';
                        media.style.maskImage = url;
                        media.style.webkitMaskImage = url;
                        media.style.maskSize = media.style.webkitMaskSize = '100% 100%';
                        media.style.maskRepeat = media.style.webkitMaskRepeat = 'no-repeat';
                    } else {
                        media.style.maskImage = media.style.webkitMaskImage = 'none';
                    }
                    if (hasBorderMask) {
                        ctx.putImageData(borderMask, 0, 0);
                        media.akariBorderSourceMask = canvas;
                    } else media.akariBorderSourceMask = null;
                    media.akariPhotoMaskRevision = (media.akariPhotoMaskRevision || 0) + 1;
                    if (window.akari?.updateLayerLayout) window.akari.updateLayerLayout();
                })().catch(error => console.warn('[akari-preview] photo mask preview unavailable', error));
            };
            const applyLayerStyleMediaLayout = (media, outputWidth, outputHeight, cut = false) => {
                const natural = mediaNaturalSize(media);
                if (!(natural.width > 0) || !(natural.height > 0)) return false;
                const x = Number(media.dataset.akariTransformX) || 0;
                const y = Number(media.dataset.akariTransformY) || 0;
                const scale = Number(media.dataset.akariTransformScale) || 1;
                const scaleX = Number(media.dataset.akariTransformScaleX) || scale;
                const scaleY = Number(media.dataset.akariTransformScaleY) || scale;
                const rotate = Number(media.dataset.akariTransformRotate) || 0;
                const cropX = Number(media.dataset.akariCropX) || 0;
                const cropY = Number(media.dataset.akariCropY) || 0;
                const cropWRaw = Number(media.dataset.akariCropW);
                const cropHRaw = Number(media.dataset.akariCropH);
                const cropW = Number.isFinite(cropWRaw) && cropWRaw > 0 ? cropWRaw : 1;
                const cropH = Number.isFinite(cropHRaw) && cropHRaw > 0 ? cropHRaw : 1;
                const cropRotate = Number(media.dataset.akariCropRotate) || 0;
                const flip = { h: media.dataset.akariFlipH === 'true', v: media.dataset.akariFlipV === 'true' };
                let frame = null;
                try { frame = media.dataset.akariPhotoFrame ? JSON.parse(media.dataset.akariPhotoFrame) : null; }
                catch (_error) { frame = null; }
                const photoVisual = media.tagName === 'IMG' && (frame || cropRotate || flip.h || flip.v)
                    ? photoFrameVisualFn({ crop: { x: cropX, y: cropY, w: cropW, h: cropH, rotate: cropRotate },
                        frame, sourceWidth: natural.width, sourceHeight: natural.height, scaleX, scaleY,
                        outputWidth, outputHeight, x, y, rotate, flip }) : null;
                if (media.tagName === 'IMG' && (frame || media.dataset.akariPhotoMaskUrl
                    || media.dataset.akariPhotoErase !== '[]')) preparePhotoMask(media);
                const pivotXPct = (cropX + cropW / 2) * 100;
                const pivotYPct = (cropY + cropH / 2) * 100;
                media.style.objectFit = 'fill';
                media.style.width = (natural.width * scaleX) + 'px';
                media.style.height = (natural.height * scaleY) + 'px';
                media.style.left = (outputWidth / 2 + x) + 'px';
                media.style.top = (outputHeight / 2 + y) + 'px';
                media.style.transformOrigin = pivotXPct + '% ' + pivotYPct + '%';
                let perspectiveFn = '';
                const perspectiveRaw = media.dataset.akariPerspectiveCorners;
                if (perspectiveRaw) {
                    let corners = null;
                    try { corners = JSON.parse(perspectiveRaw); } catch (_error) { corners = null; }
                    const boxWidthPx = natural.width * cropW * scaleX;
                    const boxHeightPx = natural.height * cropH * scaleY;
                    try {
                        const visual = corners
                            ? computeLayerPerspectiveVisualFn({ corners }, boxWidthPx, boxHeightPx) : null;
                        if (visual) perspectiveFn = ' ' + visual.transformFunction;
                    } catch (error) {
                        if (!perspectiveVisualWarned) {
                            perspectiveVisualWarned = true;
                            console.warn('[akari-preview] layer perspective visual failed; rendering without perspective', error);
                        }
                    }
                }
                media.style.transform = 'translate(-' + pivotXPct + '%, -' + pivotYPct + '%) rotate('
                    + (rotate + cropRotate) + 'deg)' + perspectiveFn;
                if (photoVisual) media.style.transform = 'translate(-' + pivotXPct + '%, -' + pivotYPct
                    + '%) ' + photoVisual.mediaMatrix + perspectiveFn;
                const opaqueX = Number(media.dataset.akariOpaqueX);
                const opaqueY = Number(media.dataset.akariOpaqueY);
                const opaqueW = Number(media.dataset.akariOpaqueW);
                const opaqueH = Number(media.dataset.akariOpaqueH);
                const opaqueBox = [opaqueX, opaqueY, opaqueW, opaqueH].every(Number.isFinite)
                    && opaqueW > 0 && opaqueH > 0
                    ? { x: opaqueX, y: opaqueY, w: opaqueW, h: opaqueH }
                    : undefined;
                media.style.clipPath = resolveLayerHitRegionClipFn(natural.width, natural.height,
                    { x: cropX, y: cropY, w: cropW, h: cropH }, opaqueBox);
                if (photoVisual) media.style.clipPath = photoVisual.clipPath;
                else if (cropRotate) media.style.clipPath = photoCropClipPolygonFn(
                    { x: cropX, y: cropY, w: cropW, h: cropH, rotate: cropRotate },
                    natural.width, natural.height);
                media.dataset.akariCropClipPath = media.style.clipPath || 'none';
                let border = media.akariPhotoFrameBorder;
                if (photoVisual && photoVisual.strokePx > 0) {
                    if (!border) {
                        border = document.createElement('div');
                        border.className = 'akari-photo-frame-overlay';
                        document.getElementById('preview-layers').appendChild(border);
                        media.akariPhotoFrameBorder = border;
                    }
                    border.style.left = photoVisual.box.left + 'px';
                    border.style.top = photoVisual.box.top + 'px';
                    border.style.width = photoVisual.box.width + 'px';
                    border.style.height = photoVisual.box.height + 'px';
                    border.style.border = photoVisual.strokePx + 'px solid ' + photoVisual.color;
                    border.style.borderRadius = photoVisual.radiusPx + 'px';
                    border.style.transform = 'rotate(' + photoVisual.box.rotate + 'deg)';
                    border.style.opacity = media.style.opacity || '1';
                    border.style.mixBlendMode = media.style.mixBlendMode || 'normal';
                    border.style.zIndex = media.style.zIndex || '1';
                    border.style.display = media.style.display === 'none' ? 'none' : 'block';
                    if (media.akariBorderSourceMask) {
                        const maskKey = [media.akariPhotoMaskRevision, cropX, cropY, cropW, cropH,
                            cropRotate, scaleX, scaleY, flip.h, flip.v, photoVisual.box.width,
                            photoVisual.box.height].join(':');
                        if (border.akariPhotoMaskKey !== maskKey) {
                            const maskCanvas = document.createElement('canvas');
                            maskCanvas.width = Math.max(1, Math.round(photoVisual.box.width));
                            maskCanvas.height = Math.max(1, Math.round(photoVisual.box.height));
                            const maskContext = maskCanvas.getContext('2d');
                            if (maskContext) {
                                maskContext.scale(maskCanvas.width / photoVisual.box.width,
                                    maskCanvas.height / photoVisual.box.height);
                                maskContext.translate(photoVisual.box.width / 2, photoVisual.box.height / 2);
                                maskContext.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
                                maskContext.scale(scaleX, scaleY);
                                maskContext.rotate(cropRotate * Math.PI / 180);
                                maskContext.translate(-(cropX + cropW / 2) * natural.width,
                                    -(cropY + cropH / 2) * natural.height);
                                maskContext.drawImage(media.akariBorderSourceMask, 0, 0);
                                border.style.maskImage = border.style.webkitMaskImage
                                    = 'url("' + maskCanvas.toDataURL('image/png') + '")';
                                border.style.maskSize = border.style.webkitMaskSize = '100% 100%';
                                border.style.maskRepeat = border.style.webkitMaskRepeat = 'no-repeat';
                            }
                            border.akariPhotoMaskKey = maskKey;
                        }
                    } else {
                        border.style.maskImage = border.style.webkitMaskImage = 'none';
                        border.akariPhotoMaskKey = null;
                    }
                } else if (border) border.style.display = 'none';
                return true;
            };
            const applyCutLayerStyleLayout = media => {
                if (!media || media.dataset.akariCutLayerStyleActive !== 'true') return false;
                const outputWidth = Number(output.width || 1280);
                const outputHeight = Number(output.height || 720);
                if (media.dataset.akariCutCropDeclared !== 'true') {
                    const x = Number(media.dataset.akariTransformX) || 0;
                    const y = Number(media.dataset.akariTransformY) || 0;
                    const scale = Number(media.dataset.akariTransformScale) || 1;
                    const scaleX = Number(media.dataset.akariTransformScaleX) || scale;
                    const scaleY = Number(media.dataset.akariTransformScaleY) || scale;
                    const rotate = Number(media.dataset.akariTransformRotate) || 0;
                    media.style.objectFit = 'contain';
                    media.style.width = outputWidth + 'px';
                    media.style.height = outputHeight + 'px';
                    media.style.left = (outputWidth / 2 + x) + 'px';
                    media.style.top = (outputHeight / 2 + y) + 'px';
                    media.style.transformOrigin = '50% 50%';
                    media.style.transform = 'translate(-50%, -50%) rotate(' + rotate + 'deg) scale(' + scaleX + ', ' + scaleY + ')';
                    media.style.clipPath = '';
                    return true;
                }
                return applyLayerStyleMediaLayout(media, outputWidth, outputHeight, true);
            };
            window.akari.applyCutLayerStyleLayout = applyCutLayerStyleLayout;
            const updateStageScale = () => {
                const frameRect = computeOutputFrameRect();
                const rect = computeContentRect();
                const next = rect.width / Number(output.width || 1280);
                displayScale = Number.isFinite(next) && next > 0 ? next : 1;
                const outputWidth = Number(output.width || 1280);
                const outputHeight = Number(output.height || 720);
                const nextFrameScale = frameRect.width / outputWidth;
                frameScale = Number.isFinite(nextFrameScale) && nextFrameScale > 0 ? nextFrameScale : 1;
                const stageTransform = 'translate(0px, 0px) scale(' + frameScale + ')';
                video.style.left = '0px';
                video.style.top = '0px';
                video.style.width = outputWidth + 'px';
                video.style.height = outputHeight + 'px';
                video.style.objectFit = 'contain';
                video.style.clipPath = '';
                standbyVideo.style.left = '0px';
                standbyVideo.style.top = '0px';
                standbyVideo.style.width = outputWidth + 'px';
                standbyVideo.style.height = outputHeight + 'px';
                standbyVideo.style.objectFit = 'contain';
                transitionVideo.style.left = '0px';
                transitionVideo.style.top = '0px';
                transitionVideo.style.width = outputWidth + 'px';
                transitionVideo.style.height = outputHeight + 'px';
                transitionVideo.style.objectFit = 'contain';
                transitionStill.style.left = '0px';
                transitionStill.style.top = '0px';
                transitionStill.style.width = outputWidth + 'px';
                transitionStill.style.height = outputHeight + 'px';
                transitionStill.style.objectFit = 'contain';
                layersStage.style.left = frameRect.x + 'px';
                layersStage.style.top = frameRect.y + 'px';
                layersStage.style.width = outputWidth + 'px';
                layersStage.style.height = outputHeight + 'px';
                layersStage.style.transform = stageTransform;
                window.akari.updateGenerationOverlayLayout?.();
                for (const layerVideo of layersStage.querySelectorAll('[data-akari-layer-id]')) {
                    applyLayerStyleMediaLayout(layerVideo, outputWidth, outputHeight);
                }
                // ㉕ cuts[].framing（contract-2026-08-02-preview-parity.md §2.4.2）: この cut.transform
                // 部分（PIP 位置決め）は video.style.transform の一部にすぎず、時間で変化する framing
                // ズームは previewBootstrapScript 側（tick() 毎フレーム）が別途書き込む。二つの書き手が
                // 競合しないよう、ここでは「cut.transform だけの文字列」を dataset に置くに留め、実際の
                // video.style.transform への反映は window.akari.applyCutFramingVisual に委譲する
                // （bootstrap 未初期化の最初の呼び出しだけ、フォールバックとして自分で直接書く）。
                const cutLayerStyleApplied = applyCutLayerStyleLayout(video);
                const baseTransform = video.dataset.akariCutTransformActive === 'true'
                    ? (() => {
                        const x = Number(video.dataset.akariTransformX) || 0;
                        const y = Number(video.dataset.akariTransformY) || 0;
                        const scale = Number(video.dataset.akariTransformScale) || 1;
                        const rotate = Number(video.dataset.akariTransformRotate) || 0;
                        return 'translate(' + x + 'px, '
                            + y + 'px) scale(' + scale + ') rotate(' + rotate + 'deg)';
                    })()
                    : '';
                video.dataset.akariBaseTransform = baseTransform;
                if (window.akari.applyCutFramingVisual) {
                    window.akari.applyCutFramingVisual();
                } else if (!cutLayerStyleApplied) {
                    video.style.transform = baseTransform;
                }
                if (transitionVideo.style.display !== 'none') applyCutLayerStyleLayout(transitionVideo);
                if (transitionStill.style.display !== 'none') applyCutLayerStyleLayout(transitionStill);
                if (stillImage.style.display !== 'none') applyCutLayerStyleLayout(stillImage);
                stage.style.left = '0px';
                stage.style.top = '0px';
                penLayer.style.left = rect.x + 'px';
                penLayer.style.top = rect.y + 'px';
                penLayer.style.width = rect.width + 'px';
                penLayer.style.height = rect.height + 'px';
            };
            window.akari.computeOutputFrameRect = computeOutputFrameRect;
            window.akari.computeContentRect = computeContentRect;
            window.akari.updateLayerLayout = updateStageScale;
            window.akari.activateStandbyVideoElement = (active, standby) => {
                video = active;
                standbyVideo = standby;
                updateStageScale();
            };
            new ResizeObserver(updateStageScale).observe(previewStage);
            video.addEventListener('loadedmetadata', updateStageScale);
            standbyVideo.addEventListener('loadedmetadata', updateStageScale);
            if (initial.kind === 'raw') {
                // raw（素材単体）プレビューに出力キャンバスは無い。summary.output は
                // EMPTY_SUMMARY の 1280x720 のままなので、そのまま使うと縦長素材の左右に
                // 16:9 レターボックスの黒帯が出る（wrapper の aspect-ratio と
                // computeOutputFrameRect の両方が output 寸法を参照するため）。素材の
                // 実寸法が分かった時点で output を実寸法へ差し替え、wrapper と
                // preview-stage をペインへ収まる素材アスペクトの矩形に張り直す。
                const previewPane = document.querySelector('.preview-pane');
                const syncRawStageToVideo = () => {
                    if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return;
                    output.width = video.videoWidth;
                    output.height = video.videoHeight;
                    const paneStyle = getComputedStyle(previewPane);
                    const availWidth = previewPane.clientWidth
                        - parseFloat(paneStyle.paddingLeft) - parseFloat(paneStyle.paddingRight);
                    const availHeight = previewPane.clientHeight
                        - parseFloat(paneStyle.paddingTop) - parseFloat(paneStyle.paddingBottom);
                    const fit = fitCompositeRect(availWidth, availHeight, video.videoWidth, video.videoHeight);
                    if (!(fit.width > 0) || !(fit.height > 0)) return;
                    wrapper.style.aspectRatio = 'auto';
                    wrapper.style.position = 'absolute';
                    wrapper.style.inset = '0';
                    wrapper.style.margin = 'auto';
                    wrapper.style.width = fit.width + 'px';
                    wrapper.style.height = fit.height + 'px';
                    previewStage.style.aspectRatio = video.videoWidth + ' / ' + video.videoHeight;
                    previewStage.style.width = 'min(100cqw, calc(100cqh * '
                        + video.videoWidth + ' / ' + video.videoHeight + '))';
                    updateStageScale();
                };
                new ResizeObserver(syncRawStageToVideo).observe(previewPane);
                video.addEventListener('loadedmetadata', syncRawStageToVideo);
                standbyVideo.addEventListener('loadedmetadata', syncRawStageToVideo);
                syncRawStageToVideo();
            }
            updateStageScale();
        })();`;
}
