// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。
import { partitionPreviewMediaPlanes } from '../common/preview-media-planes';
import { withPreviewPosition } from '../common/preview-motion-write';
import { applyAdjustBypass } from '../common/adjust-bypass';
import { filterRenderableFrameEngineLayers } from '../common/frame-engine-layer-supply';
import {
    parseRenderScaleMode,
    resolveRenderScale,
    scaledOutputSize,
    scaleEvaluationPlan
} from '../common/frame-engine-render-scale';
import { clampPreviewPlaybackRate } from '../common/preview-playback-rate';

export function frameEngineBootstrapScript(): string {
        return `(() => {
            const initial = window.__akariPreview || {};
            const clampPreviewPlaybackRateFn = (${clampPreviewPlaybackRate.toString()});
            let engineSummary = initial.summary || {};
            const applyAdjustBypassFn = (${applyAdjustBypass.toString()});
            window.akari = window.akari || {};
            const adjustBypassIds = window.akari.adjustBypassIds || (window.akari.adjustBypassIds = new Set(initial.adjustBypassIds || []));
            const engine = window.AkariFrameEngine;
            const filterRenderableFrameEngineLayersFn = (${filterRenderableFrameEngineLayers.toString()});
            const parseRenderScaleModeFn = (${parseRenderScaleMode.toString()});
            const resolveRenderScaleFn = (${resolveRenderScale.toString()});
            const scaledOutputSizeFn = (${scaledOutputSize.toString()});
            const scaleEvaluationPlanFn = (${scaleEvaluationPlan.toString()});
            const stage = document.getElementById('preview-stage');
            const layersStage = document.getElementById('preview-layers');
            if (!engine || !stage || !layersStage) {
                console.warn('[frame-engine] 初期化に必要な runtime または stage がありません');
                return;
            }

            // v2 items keep absolute placement on every track, including the first video above HTML.
            // Legacy sequential cuts (and freeze mapping) still use their sequential adapter.
            // summary.cuts は表示用の派生配置を含む。最下段（renderTrack が最小）の visual トラックは
            // 逐次 cuts へ戻すことで freeze による尺の伸長と transition の重なりを frame-engine 自身に
            // 再計算させる。上段の visual トラックの cut は at / track（= renderTrack）を保持して絶対配置する。
            // 外すと最下段の後ろへ直列に連結され、出力尺の外へ押し出されて無言で消える（issue #31。
            // gpu / osr / preview-server の normalizedCuts と同じ規則。前後関係は frame-engine の既定 =
            // 番号が大きいトラックが前面で、buildTimelineMap 直呼びの trackZ: track => track と同じ向き）。
            const resolveSummaryItemAdjust = (item, summary) => {
                const adjust = item && item.adjust;
                if (!adjust || typeof adjust !== 'object' || adjust.lut == null
                    || adjust.sections && adjust.sections.lut === false) return item;
                if (typeof adjust.lut.lut !== 'string') return item;
                const cubeText = summary && summary.adjustLutCubeTexts
                    && summary.adjustLutCubeTexts[String(item.id)];
                try {
                    return {
                        ...item,
                        adjust: {
                            ...adjust,
                            lut: typeof cubeText === 'string'
                                ? { ...adjust.lut, lut: engine.parseCube(cubeText) }
                                : null
                        }
                    };
                } catch (reason) {
                    console.warn('[frame-engine] item adjust LUT parse failed for ' + String(item.id), reason);
                    return { ...item, adjust: { ...adjust, lut: null } };
                }
            };
            const normalizeSummaryCuts = value => {
                const summaryCuts = Array.isArray(value && value.cuts) ? value.cuts : [];
                const renderTracks = summaryCuts
                    .map(cut => cut.renderTrack)
                    .filter(track => Number.isInteger(track) && track >= 0);
                const baseRenderTrack = renderTracks.length > 0 ? Math.min(...renderTracks) : 0;
                return summaryCuts.map((cut, index) => {
                    const {
                        at: _derivedAt,
                        track: _derivedTrack,
                        trackId: _derivedTrackId,
                        renderTrack: _derivedRenderTrack,
                        ...sequential
                    } = cut;
                    const upperTrack = Number.isInteger(cut.renderTrack) && cut.renderTrack > baseRenderTrack;
                    const placement = (upperTrack || (Number(value.editVersion) === 2 && !cut.freeze))
                        ? {
                            track: cut.renderTrack,
                            ...(Number.isFinite(cut.at) && cut.at >= 0 ? { at: Number(cut.at) } : {})
                        }
                        : {};
                    return resolveSummaryItemAdjust({
                        ...sequential,
                        ...placement,
                        src: cut.src || 'default',
                        in: Number(cut.in || 0),
                        out: Number(cut.out == null ? cut.in || 0 : cut.out),
                        transition_out: cut.transition_out || cut.transitionOut,
                        id: cut.id || 'cut-' + index
                    }, value);
                });
            };
            let normalizedCuts = normalizeSummaryCuts(applyAdjustBypassFn(engineSummary, [...adjustBypassIds]));

            stage.dataset.frameEngineActive = 'true';
            for (const media of layersStage.querySelectorAll('video, img')) {
                if (typeof media.pause === 'function') media.pause();
                if ('muted' in media) media.muted = true;
            }
            if (window.akari && window.akari.previewAudio) {
                if (typeof window.akari.previewAudio.dispose === 'function') window.akari.previewAudio.dispose();
                else window.akari.previewAudio.pause();
                window.akari.previewAudio = null;
            }

            const root = document.createElement('div');
            root.id = 'frame-engine-preview';
            root.dataset.frameEngineReady = 'false';
            Object.assign(root.style, {
                position: 'absolute', inset: '0', background: '#000', pointerEvents: 'none'
            });

            const canvas = document.createElement('canvas');
            canvas.id = 'frame-engine-canvas';
            canvas.setAttribute('aria-label', 'Frame engine canvas preview');
            Object.assign(canvas.style, {
                width: '100%', height: '100%', display: 'block', objectFit: 'contain'
            });

            const metrics = document.createElement('div');
            metrics.id = 'frame-engine-metrics';
            metrics.hidden = initial.frameEngineMetricsEnabled !== true;
            Object.assign(metrics.style, {
                position: 'absolute', zIndex: '2080', right: '8px', top: '8px', minWidth: '250px', padding: '7px 9px',
                border: '1px solid rgba(116,192,252,.65)', borderRadius: '4px',
                background: 'rgba(4,12,20,.88)', color: '#d8efff',
                font: '11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace', whiteSpace: 'pre'
            });

            const error = document.createElement('div');
            error.id = 'frame-engine-error';
            error.hidden = true;
            Object.assign(error.style, {
                position: 'absolute', zIndex: '2090', inset: '40% 10% auto', padding: '12px', borderRadius: '6px',
                background: 'rgba(80,0,0,.9)', color: '#fff', textAlign: 'center'
            });

            const notice = document.createElement('div');
            notice.id = 'frame-engine-notice';
            notice.hidden = true;
            Object.assign(notice.style, {
                position: 'absolute', zIndex: '2085', inset: 'auto 10% 10%', padding: '10px 12px',
                border: '1px solid rgba(116,192,252,.65)', borderRadius: '6px',
                background: 'rgba(8,32,56,.92)', color: '#d8efff', textAlign: 'center'
            });
            const showNotice = message => {
                notice.hidden = false;
                notice.textContent = String(message);
                root.dataset.frameEngineNotice = String(message);
            };
            const clearNotice = () => {
                notice.hidden = true;
                notice.textContent = '';
                delete root.dataset.frameEngineNotice;
            };

            root.append(canvas, metrics, notice, error);
            layersStage.prepend(root);

            const measurements = {
                presentedAt: [], lateFrames: 0, renderErrors: 0, seekLatestMs: null,
                seekBeforeMs: [], seekAfterMs: [],
                boundaryBefore: { total: 0, late: 0 },
                boundaryAfter: { total: 0, late: 0 }, warmupMs: []
            };
            let scheduler = null;
            let audioSupply = null;
            let renderScaleDescription = '—';
            let rate = clampPreviewPlaybackRateFn(initial.initialPlaybackRate);
            const percentile = values => {
                if (values.length === 0) return null;
                const sorted = [...values].sort((left, right) => left - right);
                return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5))];
            };
            const formatMetric = value => value == null ? '—' : value.toFixed(1);
            const updateMetrics = () => {
                const before = percentile(measurements.seekBeforeMs);
                const after = percentile(measurements.seekAfterMs);
                const presentedFps = measurements.presentedAt.length;
                const schedulerState = scheduler ? scheduler.state() : {
                    leadInSeconds: 2.5, liveDecoders: 0, maxLiveDecoders: 8,
                    coverage: { warmed: 0, needed: 0 }
                };
                const audioState = audioSupply ? audioSupply.debug() : {
                    scheduled: { speech: 0 }, speechDecode: { totalMs: 0 },
                    prefetch: { items: 0, decodedBytes: 0, elapsedMs: 0, pending: 0 }
                };
                metrics.dataset.fps = String(presentedFps);
                metrics.dataset.lateFrames = String(measurements.lateFrames);
                metrics.dataset.renderErrors = String(measurements.renderErrors);
                metrics.dataset.seekMs = measurements.seekLatestMs == null
                    ? '' : measurements.seekLatestMs.toFixed(3);
                metrics.dataset.seekBeforeMs = before == null ? '' : before.toFixed(3);
                metrics.dataset.seekAfterMs = after == null ? '' : after.toFixed(3);
                metrics.dataset.boundaryLateBefore = measurements.boundaryBefore.late
                    + '/' + measurements.boundaryBefore.total;
                metrics.dataset.boundaryLateAfter = measurements.boundaryAfter.late
                    + '/' + measurements.boundaryAfter.total;
                metrics.dataset.warmupCoverage = schedulerState.coverage.warmed
                    + '/' + schedulerState.coverage.needed;
                metrics.dataset.liveDecoders = schedulerState.liveDecoders
                    + '/' + schedulerState.maxLiveDecoders;
                metrics.dataset.leadInSec = schedulerState.leadInSeconds.toFixed(2);
                metrics.dataset.audioSpeech = String(audioState.scheduled.speech);
                metrics.dataset.speechDecodeMs = audioState.speechDecode.totalMs.toFixed(3);
                metrics.dataset.audioPrefetchPending = String(audioState.prefetch.pending);
                metrics.dataset.audioPrefetchBytes = String(audioState.prefetch.decodedBytes);
                metrics.textContent = [
                    'fps (presented/1s)  ' + presentedFps,
                    'render scale        ' + renderScaleDescription,
                    'late frame          ' + measurements.lateFrames,
                    'seek reach latest   ' + formatMetric(measurements.seekLatestMs) + ' ms',
                    'seek before (cold)  ' + formatMetric(before) + ' ms',
                    'seek after (cache)  ' + formatMetric(after) + ' ms',
                    'boundary late       before ' + measurements.boundaryBefore.late
                        + '/' + measurements.boundaryBefore.total,
                    '                    after  ' + measurements.boundaryAfter.late
                        + '/' + measurements.boundaryAfter.total,
                    'warmup median       ' + formatMetric(percentile(measurements.warmupMs)) + ' ms',
                    'render error       ' + measurements.renderErrors,
                    'warmup coverage     ' + schedulerState.coverage.warmed
                        + '/' + schedulerState.coverage.needed,
                    'live decoders       ' + schedulerState.liveDecoders
                        + '/' + schedulerState.maxLiveDecoders,
                    'lead-in             ' + schedulerState.leadInSeconds.toFixed(2) + ' s',
                    'speech              ' + audioState.scheduled.speech
                        + '  decode ' + formatMetric(audioState.speechDecode.totalMs) + ' ms',
                    'audio prefetch      ' + (audioState.prefetch.items - audioState.prefetch.pending)
                        + '/' + audioState.prefetch.items + '  '
                        + formatMetric(audioState.prefetch.elapsedMs) + ' ms'
                ].join('\\n');
            };
            const showError = (value, fatal) => {
                const message = value instanceof Error ? value.message : String(value);
                if (fatal) {
                    measurements.renderErrors += 1;
                    updateMetrics();
                    error.hidden = false;
                    error.textContent = 'Frame engine: ' + message;
                } else {
                    console.warn('[frame-engine] ' + message);
                }
            };

            void (async () => {
                const fps = Number(engineSummary.output && engineSummary.output.fps) > 0
                    ? Number(engineSummary.output.fps) : 30;
                const sourceUrls = new Map(Object.entries(initial.videoSources || {}));
                const declaredSourceUrls = new Map(sourceUrls);
                const sourceOriginals = new Map(Object.entries(initial.videoSourceOriginals || {}));
                const sourceSupports = new Map();
                const sourceSelections = [];
                let disposed = false;
                let sourceGeneration = 0;
                let backgroundSources = null;
                // Invalidate probes even if the webview unloads during the first-stage await.
                window.addEventListener('beforeunload', () => {
                    disposed = true;
                    sourceGeneration += 1;
                }, { once: true });
                const mode = engine.parseSourceSelectionMode(initial.frameEngineSourceMode);
                if (initial.frameEngineForceSoftware === true) {
                    engine.setForceSoftwareDecode(true);
                }
                window.akariFrameEngineSources = sourceSelections;
                const pools = new Map();
                const lookahead = new Map();
                const images = new Map();
                let currentAccesses = null;
                for (const [id, url] of Object.entries(initial.imageSources || {})) {
                    if (typeof url !== 'string' || !url) continue;
                    images.set(id, new engine.CachedStillImageSource(url));
                }
                const engineLayersForSummary = value => filterRenderableFrameEngineLayersFn(
                    Array.isArray(value && value.layers) ? value.layers : [],
                    message => console.warn('[frame-engine] ' + message)
                ).map((rawLayer, index) => {
                    const { renderTrack, trackId: _trackId, ...renderLayer } = rawLayer;
                    const layer = resolveSummaryItemAdjust({ ...renderLayer,
                        ...(Number.isInteger(renderTrack) ? { track: renderTrack } : {}) }, value);
                    if (Array.isArray(layer?.regions)) layer.regions = layer.regions.map(region => ({
                        ...region,
                        filter: region?.filter?.cubeText ? { ...region.filter, lut: engine.parseCube(region.filter.cubeText) }
                            : region?.filter
                    }));
                    if (!layer || typeof layer.src !== 'string' || !layer.src) return layer;
                    if (layer.isImage === true) {
                        // frame-engine v0 recognizes a still layer from its registry key suffix.
                        // Shell asset URLs are extensionless, so keep fetching the original URL
                        // while giving the resolved timeline an explicitly typed key. incremental は
                        // layer src 不変の場合だけ許可されるため、この source は更新間で再利用できる。
                        const sourceId = 'akari-image-layer-' + index + '.png';
                        if (!images.has(sourceId)) {
                            images.set(sourceId, new engine.CachedStillImageSource(layer.src));
                        }
                        const maskId = layer.mask ? 'akari-image-mask-' + index + '.png' : null;
                        if (maskId && !images.has(maskId)) {
                            images.set(maskId, new engine.CachedStillImageSource(layer.mask));
                        }
                        const regions = Array.isArray(layer.regions) ? layer.regions.map((region, regionIndex) => {
                            const key = 'akari-image-region-' + index + '-' + regionIndex + '.png';
                            if (!images.has(key)) images.set(key, new engine.CachedStillImageSource(region.maskRef));
                            return { ...region, maskRef: key };
                        }) : undefined;
                        return { ...layer, src: sourceId, ...(maskId ? { mask: maskId } : {}),
                            ...(regions ? { regions } : {}) };
                    }
                    // A media item can move between cuts and layers after a transform. Reuse the
                    // declared source pool; stream IDs still keep each item's decode clock independent.
                    const sharedSource = [...declaredSourceUrls].find(([id, url]) =>
                        url === layer.src || sourceOriginals.get(id) === layer.src
                        || (layer.sourceUri && !layer.mask && !sourceOriginals.has(id)
                            && initial.videoSourceUris && initial.videoSourceUris[id] === layer.sourceUri));
                    if (sharedSource) return { ...layer, src: sharedSource[0] };
                    if (!sourceUrls.has(layer.src)) sourceUrls.set(layer.src, layer.src);
                    return layer;
                });
                const createVideoSource = (id, url) => {
                    const pool = new engine.ClipSessionPool(id, url, {
                        codecSupport: sourceSupports.get(id) || null,
                        onWarning: message => showError(message, false),
                        onSoftwareFallbackDenied: support => {
                            const known = sourceSupports.get(id);
                            if (!(known && (known.hw || known.any))) {
                                showNotice('ソフトウェアデコード非対応: ' + support.codec);
                            }
                        }
                    });
                    const source = new engine.LookaheadFrameSource(pool, {
                        fps,
                        // 先読み枚数 = デコーダの出力 surface を握る枚数。12 だと Windows の D3D11 HW デコーダ
                        // （4K HEVC）が surface 切れで黙り、入力を飲んだまま 1 枚も出さなくなる（issue #28 と同機構）。
                        // Web UI 側で実測（2026-09-05・90 秒再生）: 12 枚 = 凍結 11 回・作り直し 49 回・17fps /
                        // 6 枚 = 凍結 0・作り直し 0・30fps。preview-server/src/frame-engine-client.ts と同じ値に揃える。
                        capacity: 6,
                        onAccess: access => {
                            if (currentAccesses) currentAccesses.push(access);
                        }
                    });
                    pools.set(id, pool);
                    lookahead.set(id, source);
                    return source;
                };
                const sources = new Map([...lookahead, ...images]);
                window.akari.setStillCandidateSource = (sourceId, url) => {
                    const existing = images.get(sourceId);
                    if (existing) existing.destroy();
                    const replacement = new engine.CachedStillImageSource(url);
                    images.set(sourceId, replacement);
                    sources.set(sourceId, replacement);
                };

                const registerLayerMasks = layers => {
                    for (const layer of layers) {
                        const maskUrl = layer && layer.mask;
                        if (typeof maskUrl === 'string' && maskUrl && !images.has(maskUrl) && !sourceUrls.has(maskUrl)) {
                            sourceUrls.set(maskUrl, maskUrl);
                        }
                    }
                };
                const engineLayers = engineLayersForSummary(applyAdjustBypassFn(engineSummary, [...adjustBypassIds]));
                registerLayerMasks(engineLayers);
                let timeline = ((summary) => engine.buildResolvedTimelinePlan(normalizedCuts, {
                    fps,
                    layers: Array.isArray(summary.layers) ? summary.layers : [],
                    overlays: Array.isArray(summary.overlays) ? summary.overlays : []
                }))({ layers: engineLayers, overlays: engineSummary.overlays });
                let visualDuration = timeline.totalDuration;
                timeline = { ...timeline, totalDuration: window.akari.previewContentEnd(engineSummary,
                    window.akari.previewCaptions ?? initial.captions ?? [], visualDuration, window.akari.previewAudioEndSeconds ?? 0, window.akari.previewBgmEndSeconds ?? 0) };
                let totalDuration = timeline.totalDuration;
                const sourceRequirements = (value, atSeconds) => {
                    const initialIds = new Set();
                    const firstUses = new Map();
                    const note = (id, start, active) => {
                        if (typeof id !== 'string' || !id) return;
                        firstUses.set(id, Math.min(firstUses.get(id) ?? Infinity, start));
                        if (active) initialIds.add(id);
                    };
                    for (const placement of value.cuts) {
                        note(placement.cut.src || 'default', placement.at,
                            atSeconds >= placement.at && atSeconds < placement.end);
                    }
                    const frame = Math.floor(atSeconds * value.fps + 1e-9);
                    for (const layer of value.layers) {
                        if (!layer || layer.kind === 'filter') continue;
                        const start = Number(layer.t) || 0;
                        const end = start + Math.max(0, Number(layer.duration) || 0);
                        const active = frame >= Math.max(0, Math.ceil(start * value.fps - 1e-6))
                            && frame < Math.max(0, Math.ceil(end * value.fps - 1e-6));
                        note(layer.src, start, active);
                        note(layer.mask, start, active);
                    }
                    return { initialIds, firstUses };
                };
                const recordSourceSelection = selection => {
                    const index = sourceSelections.findIndex(value => value.id === selection.id);
                    if (index < 0) sourceSelections.push(selection);
                    else sourceSelections[index] = selection;
                    // Keep the array used by evidence readers alive as well as the scheduler's Maps.
                    window.akariFrameEngineSources = sourceSelections;
                };
                const sameCodecSupport = (left, right) => left === right || (left && right
                    && left.codec === right.codec && left.hw === right.hw
                    && left.sw === right.sw && left.any === right.any);
                const applySourceChoice = async (id, choice, generation) => {
                    if (disposed || generation !== sourceGeneration) return;
                    const pool = pools.get(id);
                    const support = choice.support || null;
                    const isUnchanged = () => sourceUrls.get(id) === choice.url && sameCodecSupport(
                        pool ? pool.codecSupport() : sourceSupports.get(id) || null, support);
                    let unchanged = isUnchanged();
                    if (pool && !unchanged) {
                        while (rendering && !disposed && generation === sourceGeneration) await waitForRender();
                        if (disposed || generation !== sourceGeneration) return;
                        // Header warmup or the completed render may already have learned this support.
                        unchanged = isUnchanged();
                    }
                    if (pool && !unchanged) {
                        lookahead.get(id).clear();
                        pools.get(id).destroy();
                    }
                    sourceUrls.set(id, choice.url);
                    if (support) sourceSupports.set(id, support);
                    else sourceSupports.delete(id);
                    recordSourceSelection(choice.selection);
                    if (pool && !unchanged) sources.set(id, createVideoSource(id, choice.url));
                };
                const resolveSource = async (target, generation) => {
                    const { id, originalUrl, selectedUrl, hasProxy, cutSource } = target;
                    const probe = engine.needsCodecProbe(mode, hasProxy)
                        ? await engine.probeSourceCodec(originalUrl) : null;
                    if (disposed || generation !== sourceGeneration) return;
                    const support = probe && probe.support;
                    const codec = probe && probe.info && probe.info.codec;
                    // Layers and masks keep their original URLs; declared proxies belong to cuts.
                    const decision = cutSource ? engine.chooseSource({ mode, hasProxy, support })
                        : { chosen: 'original', reason: 'not-a-cut-source' };
                    await applySourceChoice(id, {
                        url: decision.chosen === 'proxy' ? selectedUrl : originalUrl,
                        support: decision.chosen === 'proxy' ? null : support,
                        selection: { id, chosen: decision.chosen, reason: decision.reason,
                            ...(codec ? { codec } : {}) }
                    }, generation);
                    if (disposed || generation !== sourceGeneration) return;
                    if (decision.chosen === 'auto-proxy') {
                        showNotice('プロキシ生成中…（' + id + '）');
                        const videoUri = initial.videoSourceUris && initial.videoSourceUris[id];
                        if (window.akari && window.akari.engine && videoUri) {
                            void window.akari.engine.resolveHevcFallback(0, videoUri).catch(reason => {
                                if (disposed || generation !== sourceGeneration) return;
                                console.warn('[frame-engine] proxy request failed', reason);
                                showNotice('プロキシを生成できませんでした（' + id + '）');
                            });
                        }
                    } else if (!sourceSelections.some(selection => selection.chosen === 'auto-proxy')) clearNotice();
                };
                const prepareSources = async (value, atSeconds, generation) => {
                    const { initialIds, firstUses } = sourceRequirements(value, atSeconds);
                    const cutSourceIds = new Set(value.cuts.map(placement => String(placement.cut.src || 'default')));
                    for (const id of firstUses.keys()) {
                        if (!images.has(id) && !sourceUrls.has(id)) sourceUrls.set(id, id);
                    }
                    const targets = [];
                    for (const [id, url] of sourceUrls) {
                        if (images.has(id)) continue;
                        const selectedUrl = declaredSourceUrls.get(id) || url;
                        const originalUrl = sourceOriginals.get(id) || selectedUrl;
                        const selection = sourceSelections.find(entry => entry.id === id);
                        // Retain completed decisions across a model rebuild; retry unfinished probes.
                        if (selection && selection.reason !== 'pending-probe') continue;
                        sourceUrls.set(id, originalUrl);
                        sourceSupports.delete(id);
                        recordSourceSelection({ id, chosen: 'original', reason: 'pending-probe' });
                        targets.push({ id, originalUrl, selectedUrl, hasProxy: sourceOriginals.has(id),
                            cutSource: cutSourceIds.has(String(id)) });
                    }
                    const initialTargets = targets.filter(target => initialIds.has(target.id));
                    await Promise.all(initialTargets.map(target => resolveSource(target, generation)));
                    if (disposed || generation !== sourceGeneration) return;
                    for (const [id, url] of sourceUrls) {
                        if (!pools.has(id) && !images.has(id)) sources.set(id, createVideoSource(id, url));
                    }
                    for (const [id, image] of images) sources.set(id, image);
                    backgroundSources = { generation, started: false, remaining: targets
                        .filter(target => !initialIds.has(target.id))
                        .sort((left, right) => (firstUses.get(left.id) ?? Infinity)
                            - (firstUses.get(right.id) ?? Infinity)) };
                };
                const startBackgroundSources = () => {
                    const batch = backgroundSources;
                    if (!batch || batch.started || disposed || batch.generation !== sourceGeneration) return;
                    batch.started = true;
                    let cursor = 0;
                    const worker = async () => {
                        while (!disposed && batch.generation === sourceGeneration) {
                            const target = batch.remaining[cursor++];
                            if (!target) return;
                            try {
                                await resolveSource(target, batch.generation);
                            } catch (reason) {
                                if (!disposed && batch.generation === sourceGeneration) showError(reason, false);
                            }
                        }
                    };
                    // Two workers share the first-use ordered queue.
                    void worker();
                    void worker();
                };
                await prepareSources(timeline,
                    Number.isFinite(initial.initialSeekTime) ? initial.initialSeekTime : 0, sourceGeneration);
                if (disposed) return;
                const sharedAudioCache = engine.createPreviewAudioSharedCache();
                const audioDeclarationsForSummary = (value, cuts) => {
                    const declarations = [];
                    const appendAudio = (kind, raw, fallbackId, duckKey = false) => {
                        if (!raw || typeof raw !== 'object' || typeof raw.src !== 'string' || !raw.src) return;
                        const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
                        const sidecar = (raw.sidecarState === 'ready' || raw.sidecarState === undefined)
                            && raw.sidecar && raw.sidecar.path ? raw.sidecar : undefined;
                        const pendingSourceFallback = !duckKey
                            && (raw.sidecarState === 'queued' || raw.sidecarState === 'generating');
                        declarations.push({
                            kind,
                            ...(duckKey ? { duckKey: true } : {}),
                            id,
                            url: sidecar ? sidecar.path : raw.src,
                            ...(sidecar || pendingSourceFallback
                                ? { sourceUrl: raw.src } : {}),
                            ...(pendingSourceFallback
                                ? { fallbackWhileGenerating: true } : {}),
                            spec: { ...raw, sidecar, sidecarState: raw.sidecarState, id, durationSec: 0 }
                        });
                    };
                    const audio = value && value.audio;
                    if (audio && typeof audio === 'object') {
                        (audio.bgms || (audio.bgm ? [audio.bgm] : [])).forEach((item, index) =>
                            appendAudio('bgm', item, item.id || 'bgm-' + (index + 1)));
                        if (Array.isArray(audio.sfx)) {
                            audio.sfx.forEach((item, index) => appendAudio('sfx', item, 'sfx-' + (index + 1)));
                        }
                        if (Array.isArray(audio.narration)) {
                            audio.narration.forEach((item, index) => appendAudio(
                                'narration', item, 'narration-' + (index + 1)
                            ));
                        }
                    }
                    if (Array.isArray(audio?.speech)) {
                        audio.speech.filter(item => item.role === 'speech').forEach((item, index) => appendAudio(
                            'narration', item, 'speech-' + (index + 1), true
                        ));
                    }
                    const embedded = audio?.embeddedSpeech ?? (Array.isArray(audio?.speech)
                        && !audio.speech.some(item => item.role === 'speech') ? audio.speech : undefined);
                    const cutSpeech = cuts.length > 0 || !Array.isArray(embedded)
                        ? engine.projectSpeechDeclarations(cuts, { fps }) : [];
                    const projectedSpeech = Array.isArray(embedded)
                        ? embedded : cutSpeech;
                    // Layer fields are carried by embeddedSpeech, independently of the visual summary.
                    const audibleIds = cuts.length > 0
                        ? new Set([...cutSpeech.map(item => item.id),
                            ...projectedSpeech.filter(item => item.scope === 'layers').map(item => item.id)]) : undefined;
                    const speech = projectedSpeech.flatMap(declaration => {
                        if (audibleIds && !audibleIds.has(declaration.id)) return [];
                        const url = declaration.scope === 'layers' ? declaration.url || sourceUrls.get(declaration.src)
                            : sourceUrls.get(declaration.src);
                        const canUseSidecar = declaration.sidecarState === 'ready' || declaration.sidecarState === undefined;
                        return url ? [{
                            ...declaration, url, sidecarState: declaration.sidecarState,
                            sidecar: canUseSidecar && declaration.sidecar?.path ? declaration.sidecar : undefined,
                            atempo: canUseSidecar && !declaration.sidecar?.path ? declaration.atempo : undefined
                        }] : [];
                    });
                    return { declarations, speech };
                };
                const normalizedMutedTracks = muted => ({
                    cuts: Array.isArray(muted && muted.cuts) ? muted.cuts : [],
                    audio: Array.isArray(muted && muted.audio) ? muted.audio : [],
                    allCuts: typeof (muted && muted.allCuts) === 'boolean' ? muted.allCuts : false,
                    allAudio: typeof (muted && muted.allAudio) === 'boolean' ? muted.allAudio : false,
                    ...(window.akari.frameEngineLayerMutedTracks || {})
                });
                const createAudioSupplyForSummary = (value, cuts, duration) => {
                    if (value?.layers?.length && !window.akari.frameEngineLayerMutedTracks) {
                        window.akari.frameEngineLayerMutedTracks = {
                            layers: initial.mutedTracksByScope?.layers || [],
                            allLayers: (initial.allTracksMutedScopes || []).includes('layers')
                        };
                    }
                    const supply = engine.createPreviewAudioSupply({
                        timelineDurationSec: duration,
                        ...audioDeclarationsForSummary(value, cuts),
                        sharedCache: sharedAudioCache,
                        pauseWatchdogMs: false,
                        pitchShiftWorkletUrl: initial.previewAudioWorkletUrl || undefined
                    });
                    supply.setRate(rate);
                    const initialAllMuted = Array.isArray(initial.allTracksMutedScopes) ? initial.allTracksMutedScopes : [];
                    supply.setMutedTracks(normalizedMutedTracks(window.akari.frameEngineMutedTracks || {
                        cuts: initial.mutedTracksByScope && initial.mutedTracksByScope.cuts,
                        audio: initial.mutedTracksByScope && initial.mutedTracksByScope.audio,
                        allCuts: initialAllMuted.includes('cuts'),
                        allAudio: initialAllMuted.includes('audio')
                    }));
                    return supply;
                };
                audioSupply = createAudioSupplyForSummary(engineSummary, normalizedCuts, totalDuration);
                const audioStatus = document.getElementById('audio-status');
                let missingAudioSinceMs = null;
                let missingAudioKeys = '';
                const audioStatusPlaying = () => {
                    try {
                        return playing;
                    } catch (error) {
                        if (error instanceof ReferenceError) return false;
                        throw error;
                    }
                };
                const updateAudioStatus = () => {
                    if (!audioStatus || disposed) return;
                    const statusPlaying = audioStatusPlaying();
                    const audioState = audioSupply.debug();
                    const supply = audioState.supply;
                    const missing = supply.required.filter(key => !supply.ready.includes(key)
                        && !supply.failed.includes(key) && !supply.noAudio.includes(key));
                    const missingKeys = missing.join('|');
                    if (!statusPlaying || supply.gate.holding || missing.length === 0) {
                        missingAudioSinceMs = null;
                        missingAudioKeys = '';
                    } else if (missingAudioKeys !== missingKeys || missingAudioSinceMs === null) {
                        missingAudioSinceMs = performance.now();
                        missingAudioKeys = missingKeys;
                    }
                    let message = '';
                    if (supply?.phase === 'degraded') {
                        message = '一部の音声を再生できません: ' + supply.failed.join(', ');
                    } else if (supply?.gate?.holding && supply.gate.heldMs >= 300) {
                        message = '音声を待っています（' + (supply.gate.heldMs / 1000).toFixed(1) + ' 秒）';
                    } else if (statusPlaying && missingAudioSinceMs !== null
                        && performance.now() - missingAudioSinceMs >= 300) {
                        message = '音声を準備中 ' + (supply.required.length - missing.length) + '/' + supply.required.length;
                    }
                    if (audioStatus.textContent !== message) audioStatus.textContent = message;
                    audioStatus.hidden = !message;
                };
                const updateAudio = message => {
                    if (disposed) return;
                    engineSummary.audio = message.audio;
                    missingAudioSinceMs = null;
                    missingAudioKeys = '';
                    audioSupply.updateAudio(audioDeclarationsForSummary({ audio: message.audio }, normalizedCuts));
                    updateAudioStatus();
                };
                window.akari.frameEngineUpdateAudio = updateAudio;
                const setMutedTracks = muted => {
                    if (disposed) return;
                    audioSupply.setMutedTracks(normalizedMutedTracks(muted));
                    updateAudioStatus();
                };
                window.akari.frameEngineSetMutedTracks = setMutedTracks;
                const pendingAudio = window.akari.frameEnginePendingAudio;
                if (pendingAudio) {
                    delete window.akari.frameEnginePendingAudio;
                    updateAudio(pendingAudio);
                }
                // The legacy bridge publishes cuts/audio only. Consume layer messages here.
                const updateLayerMute = event => {
                    if (disposed || !event.data) return;
                    const state = engine.updatePreviewLayerMutedTracks(
                        window.akari.frameEngineLayerMutedTracks || { layers: [], allLayers: false }, event.data);
                    window.akari.frameEngineLayerMutedTracks = state;
                    audioSupply.setMutedTracks(state);
                };
                window.addEventListener('message', updateLayerMute);
                window.addEventListener('beforeunload', () => window.removeEventListener('message', updateLayerMute), { once: true });
                const audioStatusTimer = setInterval(updateAudioStatus, 250);
                const AUDIO_PRIORITY_DEBOUNCE_MS = 300;
                const AUDIO_PRIORITY_INTERVAL_MS = 10_000;
                let audioPriorityTimer;
                const requestAudioPriority = time => {
                    clearTimeout(audioPriorityTimer);
                    if (disposed || audioSupply.debug().supply?.phase !== 'preparing') return;
                    audioPriorityTimer = setTimeout(() => {
                        if (disposed || audioSupply.debug().supply?.phase !== 'preparing') return;
                        window.akari.requestAudioPriority(time);
                    }, AUDIO_PRIORITY_DEBOUNCE_MS);
                };
                const audioPriorityInterval = setInterval(() => {
                    if (playing) requestAudioPriority(position);
                }, AUDIO_PRIORITY_INTERVAL_MS);
                updateAudioStatus();
                window.akariFrameEngineAudioDebug = () => audioSupply.debug();
                window.akariFrameEngineAudioAnalyser = () => audioSupply.attachAnalyser();
                window.akari.attachAudioMeter(audioSupply.attachAnalyser(), 'frame-engine');
                const projectedLook = engineSummary.videoFx && engineSummary.videoFx.look;
                let look = null;
                if (projectedLook && typeof projectedLook.cubeText === 'string') {
                    try {
                        const intensity = Number(projectedLook.intensity ?? 1);
                        look = {
                            lut: engine.parseCube(projectedLook.cubeText),
                            intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1))
                        };
                    } catch (reason) {
                        console.warn('[frame-engine] LUT parse failed, continuing without look', reason);
                    }
                }
                const output = {
                    width: Number(engineSummary.output && engineSummary.output.width) > 0
                        ? Number(engineSummary.output.width) : 1280,
                    height: Number(engineSummary.output && engineSummary.output.height) > 0
                        ? Number(engineSummary.output.height) : 720,
                    colorSpace: 'bt709-limited',
                    look
                };
                const renderScaleMode = parseRenderScaleModeFn(initial.frameEngineRenderScaleMode);
                const readCanvasRenderScale = () => {
                    const rect = canvas.getBoundingClientRect();
                    return resolveRenderScaleFn({ mode: renderScaleMode,
                        outputWidth: output.width, outputHeight: output.height,
                        cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio });
                };
                let autoRenderScale = readCanvasRenderScale();
                const renderOutput = { ...output };
                let appliedRenderScale = 1;
                const applyRenderScale = scale => {
                    const size = scaledOutputSizeFn(output, scale);
                    const changed = renderOutput.width !== size.width || renderOutput.height !== size.height;
                    // Mutate the shared output in place so the scheduler keeps its warmed sessions.
                    renderOutput.width = size.width;
                    renderOutput.height = size.height;
                    appliedRenderScale = scale;
                    renderScaleDescription = scale + ' (' + size.width + 'x' + size.height
                        + ' of ' + output.width + 'x' + output.height + ', ' + renderScaleMode + ')';
                    return changed;
                };
                applyRenderScale(autoRenderScale);
                // 可視 canvas を WebGL2Compositor が直接所有する。毎フレームの 2D 読み戻しは行わない。
                const baseCompositor = new engine.WebGL2Compositor(canvas, { synchronization: 'flush' });
                const partitionMediaPlanes = (${partitionPreviewMediaPlanes.toString()});
                const withPreviewPositionFn = (${withPreviewPosition.toString()});
                const upperPlanes = new Map();
                let upperCompositor = null;
                // シーク中の描画は素材の準備（静止画の読み込みなど）を待つ間に古くなることがある。
                // 合成に入る前に打ち切れば、どの band も描き替えずに次の最新フレームへ進める。
                let activeRenderStale = null;
                const staleRenderAbort = new Error('stale preview frame');
                const compositor = {
                    kind: 'webgl2',
                    get uploadPath() { return upperCompositor?.uploadPath === 'copyTo' ? 'copyTo' : baseCompositor.uploadPath; },
                    async compose(baseFrames, layerFrames, outputSpec, metricsRecorder, plan) {
                        if (activeRenderStale && activeRenderStale()) throw staleRenderAbort;
                        const bands = partitionMediaPlanes(plan, engineSummary);
                        const used = new Set(bands.filter(band => band.key > 0).map(band => band.key));
                        for (const [key, plane] of upperPlanes) {
                            if (!used.has(key)) {
                                plane.compositor.dispose(); plane.element.remove(); upperPlanes.delete(key);
                            }
                        }
                        let surface;
                        for (const band of bands) {
                            const bandPlan = { ...plan,
                                base: band.baseIndices.map(index => plan.base[index]),
                                layers: band.entries.map(entry => entry.spec) };
                            const bandBase = band.baseIndices.map(index => baseFrames[index]);
                            const bandLayers = band.entries.map(entry => entry.baseIndex !== undefined
                                ? { color: baseFrames[entry.baseIndex] } : layerFrames[entry.layerIndex]);
                            if (band.key === 0) {
                                surface = await baseCompositor.compose(bandBase, bandLayers, renderOutput, metricsRecorder, bandPlan);
                                continue;
                            }
                            let plane = upperPlanes.get(band.key);
                            if (!plane) {
                                const element = document.createElement('canvas');
                                element.dataset.akariMediaPlane = String(band.key);
                                Object.assign(element.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
                                plane = { element, compositor: new engine.WebGL2Compositor(
                                    element, { synchronization: 'flush', transparent: true }) };
                                layersStage.appendChild(element);
                                upperPlanes.set(band.key, plane);
                            }
                            plane.element.style.zIndex = String(band.zIndex);
                            upperCompositor = plane.compositor;
                            const upper = await upperCompositor.compose(bandBase, bandLayers, renderOutput, metricsRecorder, bandPlan);
                            upper.close();
                        }
                        return surface;
                    },
                    dispose() {
                        baseCompositor.dispose();
                        for (const plane of upperPlanes.values()) {
                            plane.compositor.dispose(); plane.element.remove();
                        }
                        upperPlanes.clear();
                    }
                };
                const frameMetrics = new engine.FrameMetrics();
                const createSchedulerForTimeline = value => engine.createPreviewScheduler({
                    timeline: value,
                    sources,
                    output: renderOutput,
                    fps,
                    pools,
                    lookahead,
                    metrics: {
                        warmupMs: measurements.warmupMs,
                        onChanged: updateMetrics,
                        onWarning: message => showError(message, false)
                    }
                });
                scheduler = createSchedulerForTimeline(timeline);
                let rendering = null;
                let lastPlaybackFrame = -1;
                let lastPresentedSec = 0;
                let lastCutIndex = null;
                let scrub;

                const waitForRender = async () => {
                    if (rendering) await rendering;
                };
                let renderScaleTimer = null;
                let renderScaleRevision = 0;
                let resizeScaleAt = null;
                let idleScaleAt = null;
                let renderScaleSettled = false;
                // One timeout serves both the 100 ms display debounce and the 250 ms idle deadline.
                const armRenderScaleTimer = () => {
                    clearTimeout(renderScaleTimer);
                    renderScaleTimer = null;
                    const revision = ++renderScaleRevision;
                    const deadlines = [resizeScaleAt, idleScaleAt].filter(value => value !== null);
                    if (disposed || deadlines.length === 0) return;
                    renderScaleTimer = setTimeout(() => {
                        renderScaleTimer = null;
                        void flushRenderScale(revision).catch(reason => showError(reason, true));
                    }, Math.max(0, Math.min(...deadlines) - performance.now()));
                };
                const flushRenderScale = async revision => {
                    await waitForRender();
                    if (runtimeUpdating) await modelUpdateTail;
                    if (disposed || revision !== renderScaleRevision) return;
                    const now = performance.now();
                    if (resizeScaleAt !== null && now >= resizeScaleAt) {
                        resizeScaleAt = null;
                        autoRenderScale = readCanvasRenderScale();
                    }
                    let idleRedraw = false;
                    if (idleScaleAt !== null && now >= idleScaleAt) {
                        idleScaleAt = null;
                        renderScaleSettled = !playing;
                        idleRedraw = renderScaleSettled;
                    }
                    const changed = applyRenderScale(renderScaleSettled ? 1 : autoRenderScale);
                    armRenderScaleTimer();
                    if (!playing && (changed || idleRedraw)) {
                        const operation = renderFrame(position, 'seek', performance.now(), true)
                            .catch(reason => showError(reason, true));
                        rendering = operation;
                        try { await operation; }
                        finally { if (rendering === operation) rendering = null; }
                    }
                    updateMetrics();
                };
                const noteRenderScaleActivity = reason => {
                    if (renderScaleMode !== 'auto') return;
                    renderScaleSettled = false;
                    idleScaleAt = reason === 'seek' && !playing ? performance.now() + 250 : null;
                    armRenderScaleTimer();
                };
                const renderFrame = async (seconds, reason, requestedAt = performance.now(), scaleOnly = false, isStale = null) => {
                    if (disposed) return;
                    if (!scaleOnly) {
                        noteRenderScaleActivity(reason);
                        applyRenderScale(autoRenderScale);
                    }
                    const timeUs = Math.round(Math.max(0, Math.min(seconds, totalDuration)) * 1e6);
                    const resolvedPlan = engine.evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, renderOutput);
                    // Engine layer geometry uses output pixels; project those transforms in the shell
                    // to preserve composition at reduced resolution while keeping the engine unchanged.
                    const plan = scaleEvaluationPlanFn(resolvedPlan, appliedRenderScale);
                    const accesses = [];
                    currentAccesses = accesses;
                    const started = performance.now();
                    let frame;
                    activeRenderStale = isStale;
                    try {
                        frame = await engine.evaluateFrame(plan, { compositor, metrics: frameMetrics });
                    } catch (reason) {
                        // 打ち切った古いフレームは提示していないので、提示時刻・計測・エラー面を動かさない。
                        if (reason === staleRenderAbort) {
                            if (currentAccesses === accesses) currentAccesses = null;
                            return;
                        }
                        throw reason;
                    } finally {
                        activeRenderStale = null;
                        if (frame) frame.close();
                    }
                    const late = performance.now() - started > 1000 / fps;
                    if (late) measurements.lateFrames += 1;
                    const cutIndex = Number(plan.base[0] && plan.base[0].id.replace('cut-', ''));
                    if (Number.isInteger(cutIndex) && cutIndex !== lastCutIndex) {
                        const streamId = 'cut-' + cutIndex;
                        const bucket = scheduler.isWarmed(streamId)
                            ? measurements.boundaryAfter : measurements.boundaryBefore;
                        bucket.total += 1;
                        if (late) bucket.late += 1;
                        lastCutIndex = cutIndex;
                    }
                    if (reason === 'seek' && !scaleOnly) {
                        const reached = performance.now() - requestedAt;
                        measurements.seekLatestMs = reached;
                        const allHit = accesses.length > 0
                            && accesses.every(access => access.hit);
                        (allHit ? measurements.seekAfterMs : measurements.seekBeforeMs).push(reached);
                    }
                    const presented = performance.now();
                    lastPresentedSec = timeUs / 1e6;
                    measurements.presentedAt.push(presented);
                    measurements.presentedAt = measurements.presentedAt
                        .filter(value => value >= presented - 1000);
                    scheduler.notePresented(timeUs, { reason });
                    if (currentAccesses === accesses) currentAccesses = null;
                    audioSupply.noteRendered(timeUs / 1e6);
                    updateMetrics();
                    // エラー面は履歴ではなく現在の描画状態を表す。次のフレームが成功したら消し、
                    // 過去に回復したエラーの事実は metrics の累計だけへ残す。
                    error.hidden = true;
                    error.textContent = '';
                };

                scrub = new engine.ScrubController(Math.min(24, 1000 / fps), async (frameNumber, generation) => {
                    const started = performance.now();
                    await waitForRender();
                    if (scrub.isStale(generation) || disposed) return;
                    const operation = renderFrame(frameNumber / fps, 'seek', started, false, () => scrub.isStale(generation))
                        .catch(reason => showError(reason, true));
                    rendering = operation;
                    try {
                        await operation;
                    } finally {
                        if (rendering === operation) rendering = null;
                    }
                });
                // 追加映像の表示判定は frame-engine の isLayerActiveAt が半開区間（frame < endFrame）
                // なので、総尺ぶんのフレーム番号（= 最後の有効フレームの次）を要求すると、ベース映像の
                // 最後の画だけが残って追加レイヤーが消える（不具合メモ 第16項）。要求側を最後の有効
                // フレームへ揃える。尺（totalDuration・停止判定・時刻表示）は 1 フレームも変えない。
                // フレーム数の数え方は可視判定と同じ切り上げ規律 ceil(sec * fps - 1e-6)。
                // preview-server 側の renderableSeconds / engineRenderTime と同一の規律。
                // 注: ここは webview へ注入されるテンプレートリテラル内なので、コメントでも
                // バックティックとテンプレート置換の記法は使えない（文字列が終端する）。
                const renderableFrame = () => Math.max(0, Math.ceil(totalDuration * fps - 1e-6) - 1);
                const renderableSeconds = seconds => {
                    const clamped = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, totalDuration));
                    if (!(fps > 0) || !(totalDuration > 0)) return clamped;
                    return Math.min(clamped, renderableFrame() / fps);
                };
                const requestSeek = seconds => {
                    const frameNumber = Math.round(renderableSeconds(seconds) * fps);
                    scrub.requestScrub(frameNumber);
                    return frameNumber / fps;
                };
                const renderPlayback = seconds => {
                    const frameNumber = Math.round(renderableSeconds(seconds) * fps);
                    if (frameNumber === lastPlaybackFrame) return lastPresentedSec;
                    lastPlaybackFrame = frameNumber;
                    if (rendering) {
                        measurements.lateFrames += 1;
                        updateMetrics();
                        return lastPresentedSec;
                    }
                    const operation = renderFrame(frameNumber / fps, 'playback')
                        .catch(reason => showError(reason, true));
                    rendering = operation;
                    void operation.finally(() => {
                        if (rendering === operation) rendering = null;
                    });
                    return lastPresentedSec;
                };
                let position = 0;
                let playing = false;
                let playAnchorMs = 0;
                let playAnchorPosition = 0;
                let runtimeUpdating = false;
                let modelUpdateTail = Promise.resolve();
                const setPlaying = (next, requestedPosition = position) => {
                    position = Math.max(0, Math.min(Number(requestedPosition) || 0, totalDuration));
                    if (!next && playing) {
                        position = audioSupply.position(position);
                        audioSupply.pause();
                    }
                    playing = next && position < totalDuration;
                    noteRenderScaleActivity(playing ? 'playback' : 'seek');
                    playAnchorMs = performance.now();
                    playAnchorPosition = position;
                    if (playing) audioSupply.playFrom(position);
                    updateAudioStatus();
                };
                const clock = {
                    get totalDuration() {
                        return totalDuration;
                    },
                    refreshContentDuration() {
                        const end = window.akari.previewContentEnd(engineSummary, window.akari.previewCaptions ?? [],
                            visualDuration, window.akari.previewAudioEndSeconds ?? 0, window.akari.previewBgmEndSeconds ?? 0);
                        if (Math.abs(end - totalDuration) > 0.000001) return queueEngineSummaryUpdate(current => current, true);
                    },
                    get rate() {
                        return rate;
                    },
                    setRate(value) {
                        const nextRate = clampPreviewPlaybackRateFn(value);
                        if (nextRate === rate) return position;
                        if (playing) position = audioSupply.position(position);
                        rate = nextRate;
                        playAnchorMs = performance.now();
                        playAnchorPosition = position;
                        audioSupply.setRate(rate);
                        return position;
                    },
                    seek(seconds, continuePlaying = playing) {
                        position = requestSeek(seconds);
                        audioSupply.seek(position, continuePlaying);
                        updateAudioStatus();
                        requestAudioPriority(position);
                        playing = continuePlaying && position < totalDuration;
                        playAnchorMs = performance.now();
                        playAnchorPosition = position;
                        // 停止中は preview の rAF が無い。clock を直接 seek した場合も
                        // DOM 字幕へ output 時計を通知して同じ位置を描く。
                        window.dispatchEvent(new CustomEvent('akari-frame-engine-seek', { detail: { time: position } }));
                        return position;
                    },
                    play(seconds) {
                        setPlaying(true, seconds);
                    },
                    pause(seconds) {
                        setPlaying(false, seconds);
                    },
                    tick(legacyPosition, legacyPlaying) {
                        if (runtimeUpdating) return position;
                        if (legacyPlaying !== playing) setPlaying(legacyPlaying, legacyPosition);
                        if (!playing) return position;
                        const fallbackPosition = Math.min(
                            totalDuration,
                            playAnchorPosition + (performance.now() - playAnchorMs) / 1000 * rate
                        );
                        // playbackTime() は position() と同じ値を返すが、音声が止まっていれば
                        // startFrom を張り直す（空の予定表 / 失敗の直後は 500 ms 空ける）。以前は
                        // 読むだけの position() だったため、startFrom が黙って降りた後は映像だけ
                        // 進み、タブを作り直すまで無音だった。watchdog は pauseWatchdogMs:false で無効のまま。
                        position = audioSupply.playbackTime(fallbackPosition);
                        // ゲートで据え置かれている間は壁時計のアンカーを今の位置に張り直し、
                        // hold が解けた瞬間から開始位置基準で進むようにする。
                        if (audioSupply.debug().supply.gate.holding) {
                            playAnchorPosition = position;
                            playAnchorMs = performance.now();
                        }
                        // 停止判定は「時計が末尾へ達したか」なので**要求時刻**で見る。提示時刻
                        // （renderPlayback の戻り値）は第16項のクランプで必ず totalDuration 未満に
                        // なるため、そちらで判定すると再生が止まらなくなる。
                        const requestedPosition = position;
                        position = renderPlayback(position);
                        if (requestedPosition >= totalDuration) setPlaying(false, totalDuration);
                        return position;
                    },
                    updateModel(nextSummary) {
                        return queueEngineSummaryUpdate(() => nextSummary, true);
                    },
                    refreshAdjustBypass() {
                        return queueEngineSummaryUpdate(current => current, false);
                    },
                    applyTransformPreview(target, transform, playheadSeconds) {
                        const key = 'transform:' + liveTargetKey(target) + ':' + Object.keys(transform).sort().join(',');
                        return queueLiveEngineSummaryUpdate(key, current => {
                            if (Number.isFinite(playheadSeconds) && Object.keys(transform).length > 0
                                && Object.keys(transform).every(key => key === 'x' || key === 'y')) {
                                return withPreviewPositionFn(current, target, transform, playheadSeconds);
                            }
                            const cut = target.kind === 'cut' ? current.cuts?.[target.index] : undefined;
                            if (cut && Array.isArray(cut.keyframes) && cut.keyframes.length >= 2
                                && Number.isFinite(playheadSeconds)) {
                                const local = Math.max(0, playheadSeconds - (Number(cut.at) || 0));
                                const points = cut.keyframes.map(point => ({ ...point }));
                                const tolerance = 0.5 / (Number(current.output?.fps) || 30);
                                let point = points.find(value => Math.abs(Number(value.t) - local) <= tolerance);
                                if (!point) { point = { t: local }; points.push(point); }
                                point.transform = { ...transform };
                                points.sort((a, b) => Number(a.t) - Number(b.t));
                                const cuts = [...current.cuts];
                                cuts[target.index] = { ...cut, keyframes: points };
                                return { ...current, cuts };
                            }
                            return Object.entries(transform).reduce(
                                (next, [field, value]) => summaryWithLivePreview(next, { target, field, value }), current);
                        });
                    },
                    applyLivePreview(message) {
                        if (message?.clear || typeof message?.field !== 'string') {
                            return queueEngineSummaryUpdate(
                                current => summaryWithLivePreview(current, message),
                                false
                            );
                        }
                        return queueLiveEngineSummaryUpdate('live:' + liveTargetKey(message.target) + ':' + message.field,
                            current => summaryWithLivePreview(current, message));
                    },
                    applyCropPreview(target, crop, transform) {
                        return queueLiveEngineSummaryUpdate('crop:' + liveTargetKey(target), current => {
                            const collection = target.kind === 'cut' ? 'cuts' : 'layers';
                            const entries = Array.isArray(current[collection]) ? current[collection] : [];
                            const index = target.kind === 'cut' ? target.index
                                : entries.findIndex(entry => String(entry?.id) === String(target.id));
                            if (!Number.isInteger(index) || index < 0 || index >= entries.length) return current;
                            const next = [...entries];
                            next[index] = { ...next[index], crop: { ...crop }, transform: { ...transform } };
                            return { ...current, [collection]: next };
                        });
                    }
                };

                const summaryWithLivePreview = (current, message) => {
                    const target = message && message.target;
                    if (!target || !Number.isFinite(message.value) || typeof message.field !== 'string') {
                        return current;
                    }
                    const applyTransformField = original => {
                        const transform = { ...(original || {}) };
                        const base = Number.isFinite(transform.scale) ? transform.scale : 1;
                        const x = Number.isFinite(transform.scaleX) ? transform.scaleX : base;
                        const y = Number.isFinite(transform.scaleY) ? transform.scaleY : base;
                        if (message.field === 'scale') {
                            const previous = Math.sqrt(x * y);
                            const ratio = previous > 0 ? message.value / previous : 1;
                            transform.scaleX = x * ratio;
                            transform.scaleY = y * ratio;
                            transform.scale = message.value;
                        } else transform[message.field] = message.value;
                        return transform;
                    };
                    if (target.kind === 'item' && Array.isArray(current.tree)
                        && current.tree.some(node => String(node.id) === String(target.id))) {
                        if (['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'].includes(message.field)) {
                            const nodes = current.tree;
                            const selected = nodes.find(node => String(node.id) === String(target.id));
                            const committedNodes = typeof window === 'undefined'
                                ? [] : window.akari?.state?.summary?.tree || [];
                            let ancestorId = selected.parentId;
                            let parent = {};
                            const seen = new Set();
                            while (ancestorId != null && !seen.has(String(ancestorId))) {
                                seen.add(String(ancestorId));
                                const ancestor = nodes.find(node => String(node.id) === String(ancestorId));
                                if (!ancestor) break;
                                if (ancestor.kind === 'group') {
                                    parent = committedNodes.find(node => String(node.id) === String(ancestor.id))?.transform
                                        || ancestor.transform || {};
                                    break;
                                }
                                ancestorId = ancestor.parentId;
                            }
                            // The frame engine keeps its own summary object. Preview gestures update
                            // state.summary.tree after persistence, so use that committed world pose.
                            const committed = committedNodes.find(node => String(node.id) === String(target.id));
                            const world = committed?.transform || selected.transform || {};
                            const parentScale = parent.scale ?? 1;
                            const radians = (parent.rotate ?? 0) * Math.PI / 180;
                            const cosine = Math.cos(radians), sine = Math.sin(radians);
                            const dx = (world.x ?? 0) - (parent.x ?? 0);
                            const dy = (world.y ?? 0) - (parent.y ?? 0);
                            const local = {
                                x: (cosine * dx + sine * dy) / parentScale,
                                y: (-sine * dx + cosine * dy) / parentScale,
                                scale: (world.scale ?? 1) / parentScale,
                                scaleX: (world.scaleX ?? world.scale ?? 1) / parentScale,
                                scaleY: (world.scaleY ?? world.scale ?? 1) / parentScale,
                                rotate: (world.rotate ?? 0) - (parent.rotate ?? 0)
                            };
                            const next = applyTransformField(local);
                            const sx = parentScale * (next.scaleX ?? next.scale ?? 1);
                            const sy = parentScale * (next.scaleY ?? next.scale ?? 1);
                            const transformed = {
                                x: (parent.x ?? 0) + parentScale * (cosine * next.x - sine * next.y),
                                y: (parent.y ?? 0) + parentScale * (sine * next.x + cosine * next.y),
                                ...(sx === sy ? { scale: sx } : {
                                    scale: parentScale * (next.scale ?? 1), scaleX: sx, scaleY: sy
                                }),
                                rotate: (parent.rotate ?? 0) + next.rotate
                            };
                            return { ...current, tree: nodes.map(node => node === selected
                                ? { ...node, transform: transformed } : node) };
                        }
                    }
                    if (target.kind === 'item' && Array.isArray(current.overlays)) {
                        const index = current.overlays.findIndex(entry => String(entry?.id) === String(target.id));
                        if (index >= 0 && (['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity'].includes(message.field))) {
                            const overlays = [...current.overlays];
                            const entry = { ...overlays[index] };
                            if (message.field === 'opacity') entry.opacity = message.value;
                            else entry.transform = applyTransformField(entry.transform);
                            if (Array.isArray(entry.keyframes) && entry.keyframes.length > 0
                                && message.field !== 'opacity') {
                                const frame = Math.max(0, Math.round((outputTime - (Number(entry.start) || 0))
                                    * (Number(current.output?.fps) || 30)));
                                const points = entry.keyframes.map(point => ({ ...point }));
                                let point = points.find(value => Number(value.t) === frame);
                                if (!point) { point = { t: frame }; points.push(point); }
                                point.transform = { ...(point.transform || {}), [message.field]: message.value };
                                points.sort((a, b) => Number(a.t) - Number(b.t));
                                entry.keyframes = points;
                            }
                            overlays[index] = entry;
                            return { ...current, overlays };
                        }
                    }
                    const collection = target.kind === 'cut' ? 'cuts'
                        : target.kind === 'item'
                            ? (Array.isArray(current.cuts) && current.cuts.some(entry =>
                                String(entry && entry.id) === String(target.id)) ? 'cuts' : 'layers')
                            : target.kind === 'layer' ? 'layers' : null;
                    if (!collection) return current;
                    const entries = Array.isArray(current[collection]) ? current[collection] : [];
                    const index = target.kind === 'cut'
                        ? target.index
                        : entries.findIndex(entry => String(entry && entry.id) === String(target.id));
                    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return current;
                    const entry = { ...entries[index] };
                    if (message.field.startsWith('crop.')) {
                        const axis = message.field.slice('crop.'.length);
                        if (!['x', 'y', 'w', 'h'].includes(axis)) return current;
                        entry.crop = { x: 0, y: 0, w: 1, h: 1, ...(entry.crop || {}), [axis]: message.value };
                    } else if (message.field.startsWith('perspective.')) {
                        const parts = message.field.split('.');
                        const corner = ['tl', 'tr', 'bl', 'br'].indexOf(parts[1]);
                        const axis = ['x', 'y'].indexOf(parts[2]);
                        if (parts.length !== 3 || corner < 0 || axis < 0) return current;
                        const identity = [[0, 0], [1, 0], [0, 1], [1, 1]];
                        const existing = entry.perspective && entry.perspective.corners;
                        const corners = identity.map((fallback, index) =>
                            Array.isArray(existing) && Array.isArray(existing[index])
                                ? [...existing[index]] : [...fallback]);
                        corners[corner][axis] = message.value;
                        entry.perspective = { corners };
                    } else if (message.field === 'opacity') {
                        entry.opacity = message.value;
                    } else if (message.field.startsWith('adjust.basic.')
                        && message.field.length > 'adjust.basic.'.length) {
                        const key = message.field.slice('adjust.basic.'.length);
                        entry.adjust = { ...(entry.adjust || {}), basic: {
                            ...(entry.adjust?.basic || {}), [key]: message.value
                        } };
                    } else if (['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'].includes(message.field)) {
                        entry.transform = applyTransformField(entry.transform);
                    } else {
                        return current;
                    }
                    const nextEntries = [...entries];
                    nextEntries[index] = entry;
                    return { ...current, [collection]: nextEntries };
                };
                const applyEngineSummary = async (nextSummary, rebuildServices) => {
                    if (!nextSummary || typeof nextSummary !== 'object' || disposed) return;
                    const audioChanged = JSON.stringify(engineSummary.audio || null)
                        !== JSON.stringify(nextSummary.audio || null);
                    if (rebuildServices) {
                        sourceGeneration += 1;
                        backgroundSources = null;
                    }
                    runtimeUpdating = true;
                    try {
                        await waitForRender();
                        if (disposed) return;
                        const effectiveSummary = applyAdjustBypassFn(nextSummary, [...adjustBypassIds]);
                        const nextCuts = normalizeSummaryCuts(effectiveSummary);
                        const nextLayers = engineLayersForSummary(effectiveSummary);
                        registerLayerMasks(nextLayers);
                        let nextTimeline = engine.buildResolvedTimelinePlan(nextCuts, {
                            fps,
                            layers: nextLayers,
                            overlays: nextSummary.overlays
                        });
                        const nextVisualDuration = nextTimeline.totalDuration;
                        nextTimeline = { ...nextTimeline, totalDuration: window.akari.previewContentEnd(nextSummary,
                            window.akari.previewCaptions ?? [], nextVisualDuration, window.akari.previewAudioEndSeconds ?? 0, window.akari.previewBgmEndSeconds ?? 0) };
                        const nextDuration = nextTimeline.totalDuration;
                        const retainAudioSupply = !audioChanged && nextDuration === totalDuration
                            && JSON.stringify(nextCuts) === JSON.stringify(normalizedCuts);
                        const resume = playing;
                        if (rebuildServices) {
                            if (resume) position = audioSupply.position(position);
                            playing = false;
                            audioSupply.pause();
                            await prepareSources(nextTimeline,
                                Math.round(Math.max(0, Math.min(position, nextDuration)) * fps) / fps,
                                sourceGeneration);
                            if (disposed) return;
                            const previousLayerIds = new Set((engineSummary.layers || []).map(layer => String(layer.id)));
                            await Promise.all(nextLayers.filter(layer => !previousLayerIds.has(String(layer.id)))
                                .flatMap(layer => [layer.src, layer.mask, ...((layer.regions || []).map(region => region.maskRef))])
                                .map(id => images.get(id)).filter(Boolean).map(source => source.load()));
                            if (disposed) return;
                            const previousScheduler = scheduler;
                            const previousAudioSupply = audioSupply;
                            scheduler = createSchedulerForTimeline(nextTimeline);
                            if (!retainAudioSupply) audioSupply = createAudioSupplyForSummary(nextSummary, nextCuts, nextDuration);
                            missingAudioSinceMs = null;
                            missingAudioKeys = '';
                            if (!retainAudioSupply) window.akari.attachAudioMeter(audioSupply.attachAnalyser(), 'frame-engine');
                            previousScheduler.dispose();
                            if (!retainAudioSupply) previousAudioSupply.dispose();
                        }
                        engineSummary = nextSummary;
                        normalizedCuts = nextCuts;
                        timeline = nextTimeline;
                        visualDuration = nextVisualDuration;
                        totalDuration = nextDuration;
                        // 尺が縮む編集のあとに終端フレームへ寄せると、復元描画が「追加映像だけ欠けた
                        // 絵」を 1 枚出す（第16項と同じ半開区間の縁）。最後の有効フレームへ揃える。
                        position = Math.round(renderableSeconds(position) * fps) / fps;
                        playAnchorMs = performance.now();
                        playAnchorPosition = position;
                        lastPlaybackFrame = -1;
                        lastCutIndex = null;
                        if (rebuildServices) {
                            audioSupply.seek(position, false);
                            scheduler.primeHeaders();
                            audioSupply.prime();
                            scheduler.warmupNextBoundary(position);
                        }
                        const operation = renderFrame(position, 'seek', performance.now())
                            .catch(reason => showError(reason, true));
                        rendering = operation;
                        try {
                            await operation;
                        } finally {
                            if (rendering === operation) rendering = null;
                        }
                        if (rebuildServices) {
                            setPlaying(resume, position);
                            if (root.dataset.frameEngineReady === 'true') startBackgroundSources();
                        }
                        root.dataset.frameEngineModelUpdates = String(
                            Number(root.dataset.frameEngineModelUpdates || 0) + 1
                        );
                        updateMetrics();
                    } finally {
                        runtimeUpdating = false;
                    }
                };
                let openLiveSlot = null;
                const queueEngineSummaryUpdate = (resolveNext, rebuildServices) => {
                    // 後から来たライブ更新が、これより前に積んだ合流枠へ入って順序が入れ替わらないよう閉じる。
                    openLiveSlot = null;
                    const apply = () => applyEngineSummary(resolveNext(engineSummary), rebuildServices);
                    modelUpdateTail = modelUpdateTail.then(apply, apply).catch(reason => {
                        showError(reason, false);
                    });
                    return modelUpdateTail;
                };
                // ドラッグ・つまみのライブ更新は 1 回ごとに timeline の組み直しと全 band の再描画を伴う。
                // 重い案件では 1 回が 1 フレームより長く、RAF ごとの更新が直列キューへ積み上がって
                // 選択枠（DOM は即時）と画像（このキュー）の世代がずれ、離した後も遅れが残っていた。
                // まだ始まっていない合流枠へは同じ対象の最新値だけを上書きで入れる（値はどれも絶対値）。
                const queueLiveEngineSummaryUpdate = (key, resolveNext) => {
                    if (openLiveSlot) {
                        openLiveSlot.resolvers.set(key, resolveNext);
                        return openLiveSlot.promise;
                    }
                    const slot = { resolvers: new Map([[key, resolveNext]]), promise: null };
                    slot.promise = queueEngineSummaryUpdate(current => {
                        if (openLiveSlot === slot) openLiveSlot = null;
                        let next = current;
                        for (const resolve of slot.resolvers.values()) next = resolve(next);
                        return next;
                    }, false);
                    openLiveSlot = slot;
                    return slot.promise;
                };
                const liveTargetKey = target => String(target?.kind) + ':' + String(target?.kind === 'cut' ? target.index : target?.id);
                window.akari = window.akari || {};
                window.akari.frameEngineClock = clock;

                const scheduleRenderScaleResize = () => {
                    if (renderScaleMode !== 'auto' || disposed) return;
                    resizeScaleAt = performance.now() + 100;
                    armRenderScaleTimer();
                };
                const renderScaleObserver = new ResizeObserver(scheduleRenderScaleResize);
                let renderScaleDprQuery = null;
                const watchRenderScaleDpr = () => {
                    if (renderScaleDprQuery) renderScaleDprQuery.removeEventListener('change', onRenderScaleDprChange);
                    const dpr = window.devicePixelRatio;
                    renderScaleDprQuery = window.matchMedia('(resolution: ' + dpr + 'dppx)');
                    renderScaleDprQuery.addEventListener('change', onRenderScaleDprChange);
                };
                const onRenderScaleDprChange = () => {
                    watchRenderScaleDpr();
                    scheduleRenderScaleResize();
                };
                if (renderScaleMode === 'auto') {
                    renderScaleObserver.observe(canvas);
                    watchRenderScaleDpr();
                }
                window.addEventListener('beforeunload', () => {
                    clearTimeout(renderScaleTimer);
                    renderScaleRevision += 1;
                    renderScaleObserver.disconnect();
                    if (renderScaleDprQuery) renderScaleDprQuery.removeEventListener('change', onRenderScaleDprChange);
                }, { once: true });

                // 非同期 mount 中に受け取った A/B も初回描画へ反映する。
                if (adjustBypassIds.size > 0) await clock.refreshAdjustBypass();
                updateMetrics();
                audioSupply.prime();
                const restoredPosition = clock.seek(
                    Number.isFinite(initial.initialSeekTime) ? initial.initialSeekTime : 0,
                    false
                );
                // 再構築後の play は、この位置のフレームが実際に描画されてから preview bootstrap が
                // akari-frame-engine-ready を受けて開始する。seek request を投げただけで ready にすると、
                // 0 秒の初期フレームを表示したまま音声と時計だけが先に進み得る。
                await waitForRender();
                const operation = renderFrame(restoredPosition, 'seek', performance.now());
                rendering = operation;
                try {
                    await operation;
                } finally {
                    if (rendering === operation) rendering = null;
                }
                const pendingSummary = window.akari && window.akari.frameEnginePendingSummary;
                if (pendingSummary && typeof pendingSummary === 'object') {
                    delete window.akari.frameEnginePendingSummary;
                    await clock.updateModel(pendingSummary);
                }
                root.dataset.frameEngineReady = 'true';
                window.dispatchEvent(new Event('akari-frame-engine-ready'));
                scheduler.primeHeaders();
                scheduler.warmupNextBoundary(restoredPosition);
                startBackgroundSources();

                window.addEventListener('beforeunload', () => {
                    if (window.akari && window.akari.frameEngineClock === clock) {
                        delete window.akari.frameEngineClock;
                    }
                    delete window.akariFrameEngineAudioAnalyser;
                    if (window.akari.frameEngineUpdateAudio === updateAudio) delete window.akari.frameEngineUpdateAudio;
                    if (window.akari.frameEngineSetMutedTracks === setMutedTracks) delete window.akari.frameEngineSetMutedTracks;
                    clearInterval(audioStatusTimer);
                    window.akari.attachAudioMeter(null, 'frame-engine');
                    clearInterval(audioPriorityInterval);
                    clearTimeout(audioPriorityTimer);
                    disposed = true;
                    sourceGeneration += 1;
                    scrub.dispose();
                    scheduler.dispose();
                    for (const source of lookahead.values()) source.clear();
                    for (const image of images.values()) image.destroy();
                    for (const pool of pools.values()) pool.destroy();
                    audioSupply.dispose();
                    sharedAudioCache.dispose();
                    compositor.dispose();
                }, { once: true });
            })().catch(reason => showError(reason, true));
        })();`;
}
