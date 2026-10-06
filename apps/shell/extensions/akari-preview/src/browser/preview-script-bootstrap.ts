// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。
import { createCaptionStylePreviewController } from '../common/caption-style-preview';
import { nextPreviewLiveOverride } from '../common/preview-live-override';
import { createPreviewLiveDomController } from '../common/preview-live-dom';
import { cutResizeCorners, cutResizeScale } from '../common/cut-resize-anchor';
import { captionControlScale } from '../common/caption-control-scale';
import { captionEdgeHandleLayout } from '../common/caption-edge-handle-layout';
import { canvasCaptionZPlan } from '../common/canvas-caption-z';
import { installPreviewFrameCapture } from '../common/preview-frame-controller';
import { createReadySeekResponder } from '../common/preview-ready-seek';
import { videoCandidatePreviewTime } from '../common/video-candidate-preview';
import { installOverlayBoxRequestListener, measureOverlayBoxInStage } from '../common/preview-overlay-measure';
import { previewDomOpacity } from '../common/preview-motion-opacity';
import {
    previewMotionGeometryTransform,
    previewMotionBoxHitAt,
    previewMotionLiveItem
} from '../common/preview-motion-geometry';
import {
    previewChromeMenuOffset,
    previewChromeLocalPoint,
    previewChromeRectClear,
    placePreviewChromeToolbar,
    refreshPreviewChromeOnGeometryChange
} from '../common/preview-chrome-placement';
import { motionDrawFinishTransition } from '../common/preview-motion-draw-finish';
import { createMotionDrawPointerOwnership } from '../common/preview-motion-pointer-owner';
import {
    applyCaptionRunsToHtml,
    CAPTION_RICH_LAYER_CSS,
    captionStyleFitsFrame,
    alignCaptionRichFillPhase,
    isAudioItemAudible,
    resolveInternalTrackZ,
    TRANSITION_VOCABULARY
} from '@akari-video/edit-store';
import { captionRunSelectionRange, captionRunToolbarPlacement } from '../common/caption-run-selection';
import { captionEntryAnimationsSettled } from '../common/caption-hit-region';
import { captionRowWrapRect } from '../common/caption-row-box';
import { captionPositionFromVisualRect, placedCaptionPositionFromRects } from '../common/caption-zone-write';
import { captionWrapWidthDrag, captionWrapHeightDrag, captionCornerTransform } from '../common/caption-plate-handles';
import {
    captionOrientedFrame,
    captionWrapAnchorDelta,
    captionWrapResize,
    captionEditorLines,
    captionEditorWrapWidth,
    captionLineCountFromMetrics,
    captionEditorFitWidth,
    captionEditorValue,
    captionEditKeyAction,
    captionEditingNavigationKey
} from '../common/caption-edit-geometry';
import { captionWrapPosition } from '../common/caption-wrap-position';
import { captionAxisPlacement, captionZonePlacement } from '../common/caption-position-preset';
import { roundedCaptionStrokeShadows } from '../common/caption-rounded-stroke';
import { captionWrapFitPosition, captionWrapFitWidth } from '../common/caption-wrap-fit';
import { clearCaptionSideActions } from '../common/caption-action-clearance';
import {
    RESOLVED_CAPTION_STYLE_VARIABLE_NAMES,
    RESOLVED_SINGLE_LINE_CAPTION_CSS,
    RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE,
    RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE,
    RESOLVED_SINGLE_LINE_FRAGMENT_OPEN
} from '../common/caption-visual-contract';
import { PREVIEW_CAPTION_ANIMATION_RECIPES, PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS } from '../common/caption-text-animation-recipes';
import { decorateTypewriterHtml, isTypewriterOnlyAnimation } from '../../../../../../packages/render-cut/src/caption-typewriter.mjs';
import { captionPlaybackStallMs } from '../common/caption-playback-watchdog';
import { computeCutFramingVisual } from '../common/cut-framing-visual';
import { computeAdjustCssVisual } from '../common/adjust-css-visual';
import { checkCutFreezeCrossing } from '../common/cut-freeze-visual';
import { computeLayerPerspectiveVisual } from '../common/layer-perspective-visual';
import { resolveDeferredTelopPlayback } from '../common/deferred-telop-playback';
import { resolveScrubSeek } from '../common/scrub-audio-wiring';
import { computeTransitionVisual } from '../common/transition-visual';
import { cropAnchorCorrectedTransform } from '../common/layer-crop-anchor';
import { cropRectAfterEdgeDrag } from '../common/crop-edge-drag';
import {
    photoCropForRatio,
    photoCropAfterPan,
    photoCropConstrainRatioAfterEdge,
    photoCropTransformPatch,
    smartPhotoCrop
} from '../common/photo-crop-tools';
import { photoFrameVisual } from '../common/photo-frame-visual';
import { cutLayerStyleBoxPx, cutLayerStyleEntryTransform } from '../common/cut-layer-style-entry';
import { layerDeclaredGeometryHitAt, resolveLayerDeclaredSize } from '../common/layer-declared-geometry';
import { previewPhotoSourcePoint, frontmostPreviewHit } from '../common/preview-photo-hit';
import { placePreviewLayerActions } from '../common/preview-layer-action-placement';
import { computeLayerKeyframesVisual } from '../common/layer-keyframes-visual';
import { layerResizeCornerPoint } from '../common/layer-resize-anchor';
import { normalizePersistentStrokeItems, PEN_TUNING, resolveStrokeLifetimeAlpha } from '../common/pen-canvas-visuals';
import { computeZoomMinimapLayout } from '../common/zoom-minimap-layout';
import {
    computePreviewStageClearance,
    computePreviewPanLimits,
    pinchPreviewPan
} from '../common/preview-stage-clearance';
import { outputTimeForSourceClock, resolveSourceClockPosition } from '../common/preview-playback-clock';
import {
    clampPreviewPlaybackRate,
    effectiveMediaRate,
    formatPreviewRateLabel,
    freezeHoldMs,
    PREVIEW_RATE_PRESETS,
    wallClockOutputTime
} from '../common/preview-playback-rate';
import { createRafThrottle } from '../common/raf-throttle';
import { createSharedDurationProbe } from '../common/sfx-duration-probe';
import { normalizeRectFromPoints } from '../common/rect-tool-visual';
import {
    isEditableEventTarget,
    isImeCompositionKeydown,
    shouldStopEditableDeletionKeydown
} from '../common/review-tool-mode';
import {
    describeOverlay,
    generationOverlaysAtTime,
    generationStateHelperV1,
    generationNextDraftHelperV1,
    resolveGenerationState
} from '../common/generation-overlay-model';

export function previewBootstrapScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const captionRowWrapRectFn = (${captionRowWrapRect.toString()});
            const canvasCaptionZPlanFn = (${canvasCaptionZPlan.toString()});
            const renderCaptionRuns = (${applyCaptionRunsToHtml.toString()});
            const captionRunSelectionRangeFn = (${captionRunSelectionRange.toString()});
            const captionRunToolbarPlacementFn = (${captionRunToolbarPlacement.toString()});
            const isAudioItemAudibleFn = (${isAudioItemAudible.toString()});
            // Match edit-store's cut rule here: toString() cannot preserve mangled helper references.
            const isCutAudioAudibleFn = (cut, track) => cut.audio !== false && isAudioItemAudibleFn(track, cut);
            const clampPreviewPlaybackRate = (${clampPreviewPlaybackRate.toString()});
            const effectiveMediaRateFn = (${effectiveMediaRate.toString()});
            const formatPreviewRateLabelFn = (${formatPreviewRateLabel.toString()});
            const freezeHoldMsFn = (${freezeHoldMs.toString()});
            const wallClockOutputTimeFn = (${wallClockOutputTime.toString()});
            // production minify 後の外部識別子は復元できないため、helper は呼び出し時に引数で渡す。
            const resolveGenerationStateV1 = (${generationStateHelperV1.toString()});
            const resolveGenerationStateFn = (${resolveGenerationState.toString()});
            const describeNextDraftV1 = (${generationNextDraftHelperV1.toString()});
            const describeOverlayFn = (${describeOverlay.toString()});
            const generationOverlaysAtTimeFn = (${generationOverlaysAtTime.toString()});
            const previewDomOpacityFn = (${previewDomOpacity.toString()});
            const videoCandidatePreviewTimeFn = (${videoCandidatePreviewTime.toString()});
            const previewRatePresets = ${JSON.stringify(PREVIEW_RATE_PRESETS)};
            const frameEngineMediaIdle = initial.frameEngineEnabled === true;
            const previewLayerActionsFn = (${placePreviewLayerActions.toString()});
            const previewPhotoSourcePointFn = (${previewPhotoSourcePoint.toString()});
            const frontmostPreviewHitFn = (${frontmostPreviewHit.toString()});
            let playbackMountReady = false;
            let playbackModelUpdate;
            let summary = initial.summary;
            window.akari = window.akari || {};
            const adjustBypassIds = window.akari.adjustBypassIds || (window.akari.adjustBypassIds = new Set(initial.adjustBypassIds || []));
            const adjustOfItem = item => item && adjustBypassIds.has(String(item.id)) ? undefined : item && item.adjust;
            let video = document.getElementById('preview-video');
            let standbyVideo = document.getElementById('standby-video');
            const transitionVideo = document.getElementById('transition-video');
            const stillImage = document.getElementById('preview-still');
            const transitionStill = document.getElementById('transition-still');
            const playToggle = document.getElementById('play-toggle');
            const frameBack = document.getElementById('frame-back');
            const frameForward = document.getElementById('frame-forward');
            const skipBack = document.getElementById('skip-back');
            const skipForward = document.getElementById('skip-forward');
            const indicatorToggle = document.getElementById('indicator-toggle');
            const indicatorPopup = document.getElementById('indicator-popup');
            const videoFxFailedIndicators = new Set();
            let adjustCssApproximationActive = false;
            const INDICATOR_GLOSSARY = {
                'LUT': '色調フィルタ',
                'クロマキー': '背景透過',
                '音声マスター処理': 'ノイズ除去・音量正規化',
                'ディゾルブ切り替え': 'カットの溶け込み切替',
                '色調整は近似表示': 'CSS で表現できない調整は最終結果と異なります',
                'clip LUT はグローバル LUT を置換': '両方の合成は frame engine 側で確認'
            };
            const refreshIndicators = () => {
                const declared = Array.isArray(summary.indicators) ? summary.indicators : [];
                const approximation = document.getElementById('preview-stage')?.dataset.frameEngineActive === 'true'
                    ? ['プレビューは近似・最終音声は書き出しで確認'] : [];
                const adjustApproximation = !frameEngineMediaIdle && adjustCssApproximationActive
                    ? ['色調整は近似表示'] : [];
                const clipLutReplacement = !frameEngineMediaIdle && summary.videoFx?.look
                    && (Array.isArray(summary.cuts) ? summary.cuts : []).some(cut =>
                        typeof (summary.adjustLutCubeTexts || {})[String(cut && cut.id)] === 'string')
                    ? ['clip LUT はグローバル LUT を置換'] : [];
                const indicators = [...new Set([
                    ...declared,
                    ...videoFxFailedIndicators,
                    ...approximation,
                    ...adjustApproximation,
                    ...clipLutReplacement
                ])];
                indicatorToggle.hidden = indicators.length === 0;
                if (indicators.length === 0) {
                    indicatorPopup.hidden = true;
                    indicatorPopup.textContent = '';
                    return;
                }
                indicatorToggle.textContent = 'ⓘ 未対応 ' + indicators.length;
                const items = indicators.map(item => INDICATOR_GLOSSARY[item]
                    ? item + ' = ' + INDICATOR_GLOSSARY[item]
                    : item).join(' / ');
                indicatorPopup.textContent = 'プレビュー未対応: ' + items;
            };
            window.addEventListener('akari-frame-engine-ready', () => {
                refreshIndicators();
                if (window.akari.frameEngineClock) window.akari.frameEngineClock.setRate(previewRate);
                applyInitialPosition();
                restoreInitialPlayback();
                tick(true);
            });
            const penToggle = document.getElementById('pen-toggle');
            const rateToggle = document.getElementById('rate-toggle');
            const zoomToggle = document.getElementById('zoom-toggle');
            const fullscreenToggle = document.getElementById('fullscreen-toggle');
            const seek = document.getElementById('seek');
            const timeLabel = document.getElementById('time-label');
            const previewPane = document.querySelector('.preview-pane');
            const wrapper = document.getElementById('preview-wrapper');
            const zoomLayer = document.getElementById('zoom-layer');
            const previewStage = document.getElementById('preview-stage');
            const zoomPopup = document.getElementById('zoom-popup');
            const ratePopup = document.getElementById('rate-popup');
            const rateValue = document.getElementById('rate-value');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            const zoomMinimap = document.getElementById('zoom-minimap');
            const zoomMinimapViewport = document.getElementById('zoom-minimap-viewport');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const emptyCanvasHint = document.createElement('div');
            emptyCanvasHint.dataset.akariUi = 'preview-empty-canvas';
            Object.assign(emptyCanvasHint.style, {
                position: 'absolute', inset: '0', boxSizing: 'border-box', border: '4px dashed var(--theia-focusBorder, #89a7d4)',
                display: 'none', alignItems: 'center', justifyContent: 'center', padding: '36px',
                color: 'var(--theia-foreground, #fff)', background: 'rgba(16,24,40,.18)',
                fontSize: '48px', fontWeight: '600', lineHeight: '1.3', textShadow: '0 2px 8px rgba(0,0,0,.9)',
                textAlign: 'center', pointerEvents: 'none', zIndex: '9999'
            });
            const updateEmptyCanvasHint = time => {
                if (!Number.isFinite(time)) return;
                const active = (summary.tree || []).find(node => node.emptyCanvas
                    && time >= node.emptyCanvas.at && time < node.emptyCanvas.at + node.emptyCanvas.duration);
                emptyCanvasHint.style.fontSize = Math.max(36, Math.round(Math.min(
                    Number(summary.output?.width) || 1280, Number(summary.output?.height) || 720
                ) * 0.065)) + 'px';
                emptyCanvasHint.style.display = active ? 'flex' : 'none';
                if (active) {
                    emptyCanvasHint.dataset.akariCanvasId = active.id;
                    emptyCanvasHint.textContent = active.emptyCanvas.intent || active.label;
                } else delete emptyCanvasHint.dataset.akariCanvasId;
            };
            window.akari.updateEmptyCanvasHint = updateEmptyCanvasHint;
            const penLayer = document.getElementById('pen-layer');
            const transitionPlate = document.getElementById('transition-plate');
            const transitionFallbackLabel = document.getElementById('transition-fallback-label');
            const captionLayer = document.getElementById('caption-plate');
            const captionRows = new Map();
            const selectedCaptionPlate = () => [...captionRows.values()].find(row =>
                (row.caption.sourceCueId || row.caption.id) === selectedCaptionId)?.plate || captionLayer;
            const captionForEvent = event => {
                const plate = event.target.closest?.('.caption-row-plate');
                return plate ? captionRows.get(plate.dataset.captionKey)?.caption : undefined;
            };
            const previewMessage = document.getElementById('preview-message');
            const previewMessageText = document.getElementById('preview-message-text');
            const previewMessageReload = document.getElementById('preview-message-reload');
            const audioNotice = document.getElementById('audio-notice');
            const audioNoticeDismiss = document.getElementById('audio-notice-dismiss');
            const fps = Number(summary.output && summary.output.fps) > 0 ? Number(summary.output.fps) : 30;
            const ZOOM_MIN = 0.25;
            const ZOOM_MAX = 8;
            const SNAP_TOLERANCE = 0.025;
            const CLICK_THRESHOLD_PX = 4;
            // ペン描画のチューニング定数（密度・グロー・フェード等）。画像注釈ポップアップ
            // （akari-annotations）の静的プラチナ描画と単一の正本（../common/pen-canvas-visuals.ts
            // の PEN_TUNING）を共有する — webview はサンドボックスのためモジュール import が
            // できず、値を JSON として埋め込む形でのみ共有できる（統合点調査・report.md 参照）。
            // 実際の描画ロジック（グロー/スパークル/フェード）はここに残したまま無変更。
            const PEN_TUNING = ${JSON.stringify(PEN_TUNING)};
            const normalizePersistentStrokeItemsFn = (${normalizePersistentStrokeItems.toString()});
            const resolveStrokeLifetimeAlphaFn = (${resolveStrokeLifetimeAlpha.toString()});
            // task.md 指示4 (rect tool): normalized drag -> [x,y,w,h] box, same shape as
            // review.json's region.box (../common/rect-tool-visual.ts).
            const normalizeRectFromPointsFn = (${normalizeRectFromPoints.toString()});
            const layerResizeCornerPointFn = (${layerResizeCornerPoint.toString()});
            const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
            const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>';
            const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"></path></svg>';
            const restoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm16 0v2h-3v3h-2v-5z"></path></svg>';
            let captions = Array.isArray(initial.captions) ? initial.captions : [];
            const emphasisWords = Array.isArray(initial.emphasisWords) ? initial.emphasisWords : [];
            let hiddenTracks = new Set(Array.isArray(initial.hiddenTracks) ? initial.hiddenTracks : []);
            const initialHiddenTracksByScope = initial.hiddenTracksByScope || {};
            const initialMutedTracksByScope = initial.mutedTracksByScope || {};
            const initialAllTracksHiddenScopes = Array.isArray(initial.allTracksHiddenScopes)
                ? initial.allTracksHiddenScopes : [];
            const initialAllTracksMutedScopes = Array.isArray(initial.allTracksMutedScopes)
                ? initial.allTracksMutedScopes : [];
            const hiddenTracksByScope = {
                cuts: new Set(Array.isArray(initialHiddenTracksByScope.cuts) ? initialHiddenTracksByScope.cuts : []),
                layers: new Set(Array.isArray(initialHiddenTracksByScope.layers) ? initialHiddenTracksByScope.layers : []),
                audio: new Set(Array.isArray(initialHiddenTracksByScope.audio) ? initialHiddenTracksByScope.audio : [])
            };
            const mutedTracksByScope = {
                cuts: new Set(Array.isArray(initialMutedTracksByScope.cuts) ? initialMutedTracksByScope.cuts : []),
                audio: new Set(Array.isArray(initialMutedTracksByScope.audio) ? initialMutedTracksByScope.audio : []),
                layers: new Set(Array.isArray(initialMutedTracksByScope.layers) ? initialMutedTracksByScope.layers : [])
            };
            const allTracksHiddenByScope = {
                cuts: initialAllTracksHiddenScopes.includes('cuts'),
                layers: initialAllTracksHiddenScopes.includes('layers'),
                audio: initialAllTracksHiddenScopes.includes('audio')
            };
            const allTracksMutedByScope = {
                cuts: initialAllTracksMutedScopes.includes('cuts'),
                audio: initialAllTracksMutedScopes.includes('audio'),
                layers: initialAllTracksMutedScopes.includes('layers')
            };
            const frameEngineMutedTracksPayload = () => ({
                cuts: [...mutedTracksByScope.cuts],
                audio: [...mutedTracksByScope.audio],
                allCuts: allTracksMutedByScope.cuts,
                allAudio: allTracksMutedByScope.audio
            });
            const syncFrameEngineMutedTracks = () => {
                // 後から起動する frame-engine と、summary 更新時の supply 再作成にも同じ状態を渡す。
                const muted = frameEngineMutedTracksPayload();
                window.akari.frameEngineMutedTracks = muted;
                if (window.akari.frameEngineSetMutedTracks) window.akari.frameEngineSetMutedTracks(muted);
            };
            syncFrameEngineMutedTracks();
            let globalMuted = initial.muted === true;
            let previewRate = 1;
            previewRate = clampPreviewPlaybackRate(initial.initialPlaybackRate);
            window.akari.previewPlaybackRate = previewRate;
            for (const media of [video, standbyVideo, transitionVideo]) {
                media.preservesPitch = true;
                media.playbackRate = previewRate;
            }
            video.dataset.akariGlobalMuted = String(globalMuted);
            video.muted = globalMuted;
            standbyVideo.muted = true;
            captionLayer.style.visibility = initial.captionsVisible === false ? 'hidden' : 'visible';
            let animationFrame = 0;
            let animationWatchdogTimer = 0;
            let lastTickAtMs = 0;
            let transitionWindows = [];
            let preloadedTransitionWindowKey = null;
            let preloadUpcomingTransition = () => undefined;
            let preloadUpcomingCut = () => undefined;
            let totalTimelineDuration = 0;
            let segments = [];
            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md §2.4.2/2.4.3）。
            const computeCutFramingVisualFn = (${computeCutFramingVisual.toString()});
            // items[].adjust.basic の DOM CSS 近似。直列化されるため common 側は自己完結関数に保つ。
            const computeAdjustCssVisualFn = (${computeAdjustCssVisual.toString()});
            const refreshAdjustCssApproximation = () => {
                adjustCssApproximationActive = !frameEngineMediaIdle && [
                    ...(Array.isArray(summary.cuts) ? summary.cuts : []),
                    ...(Array.isArray(summary.layers) ? summary.layers : []),
                    ...(Array.isArray(summary.filters) ? summary.filters : [])
                ].some(item => computeAdjustCssVisualFn(adjustOfItem(item))?.hasApproximation === true);
            };
            refreshAdjustCssApproximation();
            refreshIndicators();
            const checkCutFreezeCrossingFn = (${checkCutFreezeCrossing.toString()});
            const computeTransitionVisualFn = (${computeTransitionVisual.toString()});
            const transitionVocabulary = ${JSON.stringify(TRANSITION_VOCABULARY)};
            const transitionById = Object.fromEntries(transitionVocabulary.map(entry => [entry.id, entry]));
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            // ㉗ layers[].crop の錨補正（contract-2026-08-02-preview-parity.md §2.4.1・
            // 2026-08-06 crop-handle-anchor-fix）。
            const cropAnchorCorrectedTransformFn = (${cropAnchorCorrectedTransform.toString()});
            // 辺バー / ⛶ の 8 方向ハンドルが共有する「掴んだ辺だけ動かす」規則（cut / layer 共通）。
            const cropRectAfterEdgeDragFn = (${cropRectAfterEdgeDrag.toString()});
            // 本編 cut の contain fit 基準 → layer-style（ソース実寸基準）の等価変換と box 寸法。
            const cutLayerStyleEntryTransformFn = (${cutLayerStyleEntryTransform.toString()});
            const cutLayerStyleBoxPxFn = (${cutLayerStyleBoxPx.toString()});
            // ㉘ layers[].keyframes（contract-2026-08-09-transform-keyframes-v0.md）。renderLayers
            // が毎フレーム呼び、layer.keyframes があれば dataset.akariTransformX/Y/Scale/Rotate・
            // akariCropX/Y/W/H・akariPerspectiveCorners を上書きしてから updateLayerLayout を叩く
            // （既存の crop pivot / clip-path / matrix3d 描画コードを丸ごと再利用するため）。
            const computeLayerKeyframesVisualFn = (${computeLayerKeyframesVisual.toString()});
            const outputTimeForSourceClockFn = (${outputTimeForSourceClock.toString()});
            const resolveSourceClockPositionFn = (${resolveSourceClockPosition.toString()});
            const resolveDeferredTelopPlaybackFn = (${resolveDeferredTelopPlayback.toString()});
            const captionEntryAnimationsSettledFn = (${captionEntryAnimationsSettled.toString()});
            // RAF スロットリング（2026-08-09 raf-throttle）: ハンドルドラッグ中の pointermove は
            // 毎回来るが、フル layout 再計算（updateStageScale）は1フレームに1回で十分。
            const createRafThrottleFn = (${createRafThrottle.toString()});
            // SFX 尺プローブの共有（2026-09-02 preview-perf）: URL 単位で 1 本・同時 4 本・8 s で打ち切り。
            const createSharedDurationProbeFn = (${createSharedDurationProbe.toString()});
            // freeze の一時停止ホールド（近似実装。尺は伸ばさない — 詳細はコメント参照）。
            let freezeHoldUntilMs = 0;
            let freezeHoldConsumedForSegmentIndex = null;
            const probeMediaDurationSeconds = src => new Promise(resolve => {
                const probe = new Audio();
                probe.preload = 'metadata';
                const cleanup = () => {
                    probe.removeEventListener('loadedmetadata', onLoaded);
                    probe.removeEventListener('error', onError);
                };
                const onLoaded = () => {
                    cleanup();
                    resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
                };
                const onError = () => { cleanup(); resolve(null); };
                probe.addEventListener('loadedmetadata', onLoaded, { once: true });
                probe.addEventListener('error', onError, { once: true });
                probe.src = src;
            });
            let resolvedSfxTails = [];
            // 2026-09-02 preview-perf: 尺プローブは URL 単位で共有（159 挿入 / 37 ユニークなら 37 本）・
            // 同時 4 本まで・1 本 8 s で打ち切り（null = 尺不明として従来どおり無視）。挿入ごとに
            // new Audio() を作っていたうえ、loadedmetadata が永久に来ないプローブが 1 本あるだけで
            // 初回描画（下の Promise.all の sfxDurationsReady）が永久に待たされていた。共有するのは
            // 素材の実尺だけで、挿入ごとの [in, out) 切り出し計算は従来どおり item ごとに行う。
            const SFX_PROBE_TIMEOUT_MS = 8000;
            let sfxProbeTimeoutWarned = false;
            // 打ち切られた素材の URL（重複なし・上限 12）。診断の「メディア供給」段に添える。
            const sfxProbeTimeouts = [];
            let audioDurationProbeRevision = 0;
            const probeSfxDurations = async () => {
                const revision = ++audioDurationProbeRevision;
                let bgmEnd = 0;
                const audio = summary.audio ?? {};
                const items = [...(audio.bgms ?? (audio.bgm ? [audio.bgm] : [])), ...(audio.sfx ?? []), ...(audio.narration ?? []),
                    ...(audio.speech ?? []).filter(item => item.role === 'speech')].filter(Boolean);
                const probeSharedDuration = createSharedDurationProbeFn(probeMediaDurationSeconds, {
                    maxInFlight: 4,
                    timeoutMs: SFX_PROBE_TIMEOUT_MS,
                    onTimeout: src => {
                        // 打ち切った素材は全件を診断へ残す（Console の警告は 1 回だけ）。
                        // 2026-09-19: 灰色プレビューの調査で、打ち切りが起きているのに「どの素材か」が
                        // 1 件ぶんしか分からず切り分けが止まった。上の 2026-09-02 の注記のとおり、
                        // loadedmetadata が返らないプローブは初回描画を待たせる側の要因なので、
                        // 止まった段が「メディア供給」のときに素材名が並んでいる必要がある。
                        if (sfxProbeTimeouts.length < 12 && !sfxProbeTimeouts.includes(src)) {
                            sfxProbeTimeouts.push(src);
                            if (window.__akariPreviewDiag) {
                                window.__akariPreviewDiag.note('尺プローブ打ち切り（' + (SFX_PROBE_TIMEOUT_MS / 1000)
                                    + ' s 超）: ' + src);
                            }
                        }
                        if (sfxProbeTimeoutWarned) return;
                        sfxProbeTimeoutWarned = true;
                        console.warn('[akari-preview] sfx の尺プローブが ' + (SFX_PROBE_TIMEOUT_MS / 1000)
                            + ' s 以内に終わらないため尺不明として続行します（以降は診断ログへ記録）', src);
                    }
                });
                const results = await Promise.all(items.map(async item => {
                    const at = Number(item.t ?? 0);
                    if (!Number.isFinite(at) || at < 0) return null;
                    if (typeof item.src !== 'string' || !item.src) return null;
                    const materialDuration = await probeSharedDuration(item.src);
                    if (materialDuration === null) return null;
                    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: the audible span is
                    // [in, out), not the whole material -- mirrors createPreviewAudio's decodeOne /
                    // render-cut's content-duration.mjs so a trimmed sfx only extends the predicted
                    // content duration by what actually plays.
                    const inSeconds = typeof item.in === 'number' && item.in >= 0 ? item.in : 0;
                    const rawOut = typeof item.out === 'number' && item.out > 0 ? item.out : materialDuration;
                    const outSeconds = Math.min(rawOut, materialDuration);
                    if (inSeconds >= materialDuration || outSeconds <= inSeconds) return null;
                    const duration = (outSeconds - inSeconds) / (Number(item.speed) > 0 ? Number(item.speed) : 1);
                    const end = at + (Number(item.durationSec) > 0 ? Math.min(duration, Number(item.durationSec)) : duration);
                    if ((audio.bgms ?? (audio.bgm ? [audio.bgm] : [])).includes(item)) { bgmEnd = Math.max(bgmEnd, end); return null; }
                    return end;
                }));
                if (revision !== audioDurationProbeRevision) return;
                window.akari.previewBgmEndSeconds = bgmEnd;
                resolvedSfxTails = results.filter(value => typeof value === 'number');
                window.akari.previewAudioEndSeconds = Math.max(0, ...resolvedSfxTails);
                void window.akari.frameEngineClock?.refreshContentDuration?.();
            };
            const sfxDurationsReady = probeSfxDurations();
            const computeContentDurationSeconds = cutsEndSeconds => {
                let sfxEnd = 0;
                for (const tail of resolvedSfxTails) sfxEnd = Math.max(sfxEnd, tail);
                let layersEnd = 0;
                for (const layer of Array.isArray(summary.layers) ? summary.layers : []) {
                    const t = Number(layer && layer.t);
                    const duration = Number(layer && layer.duration);
                    if (Number.isFinite(t) && Number.isFinite(duration)) layersEnd = Math.max(layersEnd, t + duration);
                }
                const overlaysEnd = (Array.isArray(summary.overlays) ? summary.overlays : []).reduce(
                    (end, overlay) => Math.max(end, (Number(overlay.start) || 0) + (Number(overlay.duration) || 0)), 0
                );
                return window.akari.previewContentEnd(summary, captions,
                    Math.max(cutsEndSeconds, sfxEnd, layersEnd, overlaysEnd), window.akari.previewAudioEndSeconds ?? 0, window.akari.previewBgmEndSeconds ?? 0);
            };
            let activeSegmentIndex = 0;
            let sourceSwapPending = false;
            let gapWallClockOriginMs = 0;
            let gapOutputOrigin = 0;
            let outputTime = 0;
            window.addEventListener('message', event => {
                const request = event.data;
                if (request?.type !== 'akari-preview-library-drop-geometry-request') return;
                const rect = previewStage.getBoundingClientRect();
                let contentFrame;
                try {
                    const frame = window.frameElement?.getBoundingClientRect();
                    if (frame) contentFrame = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
                } catch (_error) { /* 内側の枠が読めない場合は外側と同じ原点を使う。 */ }
                window.akari.reportLibraryDropGeometry({ requestId: request.requestId,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    viewport: { width: window.innerWidth, height: window.innerHeight }, contentFrame, time: outputTime,
                    fps: summary?.output?.fps, canvasDropTargets: summary?.canvasDropTargets || [] });
            });
            let libraryApplyHighlight;
            let libraryMediaHitAt = () => null;
            window.addEventListener('message', event => {
                const request = event.data;
                if (request?.type !== 'akari-preview-hit-test' && request?.type !== 'akari-preview-hit-test-clear') return;
                libraryApplyHighlight?.remove();
                libraryApplyHighlight = undefined;
                if (request.type === 'akari-preview-hit-test-clear') return;
                const stageRect = previewStage.getBoundingClientRect();
                const x = stageRect.left + Number(request.x) * stageRect.width;
                const y = stageRect.top + Number(request.y) * stageRect.height;
                const media = libraryMediaHitAt({ clientX: x, clientY: y });
                const fallback = media?.dataset?.akariLayerId
                    ? { kind: 'layer', id: media.dataset.akariLayerId, rect: media.getBoundingClientRect() }
                    : media && (media.dataset?.akariCutId || (media === stillImage && video.dataset.akariCutId))
                        ? { kind: 'cut', id: media.dataset?.akariCutId || video.dataset.akariCutId, rect: stageRect } : undefined;
                const hit = Number.isFinite(x) && Number.isFinite(y) && x >= stageRect.left && x <= stageRect.right
                    && y >= stageRect.top && y <= stageRect.bottom
                    ? window.akari.interaction?.libraryApplyHitTest?.(x, y, fallback, request.kind) : null;
                const accepted = !!hit && (request.kind === 'lut' ? hit.kind !== 'caption' : hit.kind === 'caption');
                if (accepted && request.highlight) {
                    libraryApplyHighlight = document.createElement('div');
                    libraryApplyHighlight.className = 'akari-preview-apply-target';
                    libraryApplyHighlight.dataset.akariPreviewApplyTarget = hit.kind;
                    Object.assign(libraryApplyHighlight.style, { position: 'fixed', left: hit.rect.left + 'px', top: hit.rect.top + 'px',
                        width: hit.rect.width + 'px', height: hit.rect.height + 'px', boxSizing: 'border-box',
                        border: '2px solid var(--akari-caption-select-color, var(--theia-focusBorder))',
                        background: 'color-mix(in srgb, var(--akari-caption-select-color, var(--theia-focusBorder)) 12%, transparent)',
                        borderRadius: 'var(--theia-borderRadius, 6px)', pointerEvents: 'none', zIndex: '2147483646' });
                    document.body.appendChild(libraryApplyHighlight);
                }
                window.akari.reportLibraryApplyHit({ requestId: request.requestId,
                    hit: accepted ? { kind: hit.kind, id: hit.id } : null });
            });
            const measureOverlayBoxFn = (${measureOverlayBoxInStage.toString()});
            const installOverlayBoxRequestListenerFn = (${installOverlayBoxRequestListener.toString()});
            installOverlayBoxRequestListenerFn(window, document, measureOverlayBoxFn,
                message => window.akari.reportOverlayBox(message));
            let loopRange = null;
            let isPlaying = false;
            let playToggleRenderedIsPlaying = null;
            let pausedForGapEntry = false;
            let initialPositionApplied = false;
            let initialSeekTarget = initial.initialSeekTime;
            let initialPlaybackRestorePending = initial.initialPlaying === true;
            let restoreInitialPlayback = () => undefined;
            let zoom = 1;
            let pan = { x: 0, y: 0 };
            let drag = null;
            let selectionDragActive = false;
            let pendingSelectionModel = null;
            const pendingSelectionValues = new Map();
            // 入力は pointerup で解放する。DOM と host refresh は未完了の保存ごとに保護する。
            const selectionGestures = new Set();
            let captionGestureCount = 0;
            let pendingCaptionUpdate = null;
            const replayPendingCaptionUpdate = () => {
                if (captionGestureCount || !pendingCaptionUpdate) return;
                const next = pendingCaptionUpdate;
                pendingCaptionUpdate = null;
                window.postMessage?.({ type: 'akari-preview-captions-update', captions: next }, '*');
            };
            const captionPositionOverrides = new Map();
            const latestCaptionMove = new Map();
            const rememberCaptionPosition = (id, value) => {
                const pending = { value, saved: false };
                captionPositionOverrides.set(id, pending);
                return pending;
            };
            const captionPositionMatches = (actual, expected) => !!actual
                && Math.abs(Number(actual.x ?? 0) - Number(expected.x ?? 0)) < 0.000001
                && Math.abs(Number(actual.y ?? 0) - Number(expected.y ?? 0)) < 0.000001;
            const captionUpdateIsStale = incoming => {
                for (const [id, pending] of captionPositionOverrides) {
                    const cue = incoming.find(item => (item.sourceCueId || item.id) === id);
                    if (!cue || !captionPositionMatches(cue.textStyle?.position, pending.value.position)) {
                        return true;
                    }
                }
                return false;
            };
            const protectCaptionUpdate = incoming => incoming.map(cue => {
                const id = cue.sourceCueId || cue.id;
                const pending = captionPositionOverrides.get(id);
                if (!pending) return cue;
                const position = cue.textStyle?.position;
                const expected = pending.value.position;
                if (pending.saved && captionPositionMatches(position, expected)) {
                    captionPositionOverrides.delete(id);
                    return cue;
                }
                return { ...cue, textStyle: { ...cue.textStyle, text_anchor: pending.value.anchor,
                    position: expected } };
            });
            const latestSelectionGesture = new WeakMap();
            const beginSelectionGesture = target => {
                const gesture = { target, key: target.entry || target.media || target };
                if (!selectionGestures.size) window.akari.reportGesture('begin');
                selectionGestures.add(gesture);
                latestSelectionGesture.set(gesture.key, gesture);
                return gesture;
            };
            const flushPendingSelectionModel = () => {
                if (selectionGestures.size || captionGestureCount || !pendingSelectionModel) return;
                const next = { ...pendingSelectionModel };
                for (const [kind, entries] of [['layer', 'layers'], ['cut', 'cuts']]) {
                    if (!Array.isArray(next[entries])) continue;
                    next[entries] = next[entries].map(entry => {
                        const values = pendingSelectionValues.get(kind + ':' + entry.id);
                        return values ? { ...entry, transform: values.transform, crop: values.crop } : entry;
                    });
                }
                pendingSelectionModel = null;
                pendingSelectionValues.clear();
                clearLiveOverride();
                applyIncrementalModel(next);
            };
            window.akari.flushPendingGestureModel = flushPendingSelectionModel;
            const endSelectionGesture = gesture => {
                if (!selectionGestures.delete(gesture)) return;
                if (pendingSelectionModel) {
                    const target = gesture.target;
                    const id = target.kind === 'layer' ? target.entry?.spec?.id : target.media?.dataset?.akariCutId;
                    if (id) pendingSelectionValues.set(target.kind + ':' + id, {
                        transform: target.transformNow(), crop: target.cropNow()
                    });
                }
                if (!selectionGestures.size) {
                    window.akari.reportGesture('end');
                    flushPendingSelectionModel();
                }
            };
            const selectionGestureIsLatest = gesture => latestSelectionGesture.get(gesture.key) === gesture;
            const selectionGestureProtects = (kind, entry) => {
                for (const gesture of selectionGestures) {
                    if (gesture.target.kind === kind && (kind === 'cut' || gesture.target.entry === entry)) return true;
                }
                return false;
            };
            let suppressClick = false;
            let playbackErrored = false;
            // Decode-failure fallback is tracked per original source. This covers the primary
            // video, source-swapped cuts, and v2 media items rendered as video layers.
            const hevcFallbackRequested = new Set();
            const hevcFallbackQueue = [];
            let hevcFallbackInFlight = false;
            let audioNoticeShown = false;

            let selectedCaptionIds = new Set();
            let selectedMixedGroup = [];
            let applyingMixedSelection = false;
            let captionAltAll = false;


            let activeCaptionEdit = null;
            let reviewRecordingActive = false;
            let reviewRecordingStartedAt = 0;
            // host の recT と原点は厳密一致しないが、表示規則は経過秒の相対差しか使わないため十分。
            // ディスクへ書く recT は host（ReviewSessionRecorder）が唯一の正本で、ここでは一切書かない。
            const reviewRecNow = () => (performance.now() - reviewRecordingStartedAt) / 1000;
            // docs/contract-2026-08-11-review-session-ui-events.md #1 / internal
            // annotation-everywhere §3 (M2): neutral/pen/rect/select, mirrored from
            // ReviewSessionRecorder's toolModeState (host is authoritative -- see
            // window.addEventListener('message', ...)'s akari-preview-set-review-recording case).
            let reviewToolMode = 'neutral';
            let penModeActive = false;
            let rectModeActive = false;
            let currentStroke = null;
            let currentRect = null;
            let fadingStrokes = [];
            let sparkles = [];
            let annotationStrokeItems = [];
            let persistentStrokeItems = [];
            let localStrokeSequence = 0;
            const nextLocalStrokeId = () => 'local-st-' + String(++localStrokeSequence).padStart(4, '0');
            let persistentStrokesVisible = true;
            let activeDrawRect = null;
            let penCanvasWidth = 0;
            let penCanvasHeight = 0;
            let penCanvasDpr = 1;
            let penAnimationHandle = 0;
            let platinumGradient = null;
            let staticBitmap = null;
            let lastStrokeLifetimeSignature = '';
            let strokeLifetimeWasAnimating = false;

            const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
            const penCtx = penLayer.getContext('2d');
            const createGlowSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
                gradient.addColorStop(0.4, 'rgba(226,234,255,0.55)');
                gradient.addColorStop(1, 'rgba(226,234,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                return canvas;
            };
            const createSparkleSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const center = size / 2;
                const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
                gradient.addColorStop(0, 'rgba(255,255,255,1)');
                gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
                gradient.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = Math.max(1, size * 0.06);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(center, center - size * 0.42);
                ctx.lineTo(center, center + size * 0.42);
                ctx.moveTo(center - size * 0.42, center);
                ctx.lineTo(center + size * 0.42, center);
                ctx.stroke();
                return canvas;
            };
            const glowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
            const sparkleSprite = createSparkleSprite(Math.max(48, PEN_TUNING.sparkleSpritePx * 3));
            const allocPenCanvas = () => {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                const ctx = canvas.getContext('2d');
                ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                return { canvas, ctx };
            };
            const rebuildPlatinumGradient = () => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) { platinumGradient = null; return; }
                const gradient = penCtx.createLinearGradient(0, 0, penCanvasWidth, penCanvasHeight);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.48, '#d9deea');
                gradient.addColorStop(0.72, '#ffffff');
                gradient.addColorStop(1, '#c8cfdd');
                platinumGradient = gradient;
            };
            const drawSegment = (ctx, from, to, options) => {
                const width = (options && options.coreWidthPx) || PEN_TUNING.coreWidthPx;
                const fromPx = [from[0] * penCanvasWidth, from[1] * penCanvasHeight];
                const toPx = [to[0] * penCanvasWidth, to[1] * penCanvasHeight];
                const glowSize = PEN_TUNING.glowSizePx;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha *= PEN_TUNING.glowAlpha;
                ctx.drawImage(glowSprite, toPx[0] - glowSize / 2, toPx[1] - glowSize / 2, glowSize, glowSize);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha *= PEN_TUNING.coreAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(fromPx[0], fromPx[1]);
                ctx.lineTo(toPx[0], toPx[1]);
                ctx.stroke();
                ctx.restore();
            };
            const paintStaticStroke = points => {
                if (!staticBitmap) return;
                for (let index = 0; index < points.length - 1; index += 1) {
                    drawSegment(staticBitmap.ctx, points[index], points[index + 1], { coreWidthPx: PEN_TUNING.staticCoreWidthPx });
                }
            };
            const redrawStrokeFull = stroke => {
                stroke.canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                stroke.canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                stroke.ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                for (let index = 0; index < stroke.points.length - 1; index += 1) {
                    drawSegment(stroke.ctx, stroke.points[index], stroke.points[index + 1]);
                }
                stroke.drawnIndex = Math.max(0, stroke.points.length - 1);
            };
            // task.md 指示4: rect ツールの描画。pen と同じ platinum グラデーション/グロー質感を
            // 矩形の輪郭に適用する（drawSegment の 4 辺版ではなく単純な strokeRect 2 パス -- pen ほど
            // の視覚精度は不要で、コード量と回帰リスクを抑える判断。report.md に記載）。
            const drawRectShape = (ctx, box) => {
                const x = box[0] * penCanvasWidth;
                const y = box[1] * penCanvasHeight;
                const w = box[2] * penCanvasWidth;
                const h = box[3] * penCanvasHeight;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha *= PEN_TUNING.glowAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = PEN_TUNING.coreWidthPx * 2.5;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha *= PEN_TUNING.coreAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = PEN_TUNING.coreWidthPx;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
            };
            const paintStaticItem = item => {
                if (!staticBitmap) return;
                if (item.tool === 'rect') drawRectShape(staticBitmap.ctx, item.box);
                else paintStaticStroke(item.points);
            };
            const strokeLifetimeContext = () => ({
                recording: reviewRecordingActive === true,
                visible: persistentStrokesVisible === true,
                recT: reviewRecNow(),
                playheadT: outputTime
            });
            const strokeLifetimeSignature = () => {
                const context = strokeLifetimeContext();
                return [...persistentStrokeItems, ...annotationStrokeItems]
                    .map(item => resolveStrokeLifetimeAlphaFn(item, context, PEN_TUNING).toFixed(2))
                    .join(',');
            };
            const redrawStaticBitmap = () => {
                if (!staticBitmap) return;
                staticBitmap.ctx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                const context = strokeLifetimeContext();
                if (persistentStrokesVisible) {
                    for (const item of [...persistentStrokeItems, ...annotationStrokeItems]) {
                        const alpha = resolveStrokeLifetimeAlphaFn(item, context, PEN_TUNING);
                        if (alpha <= 0) continue;
                        staticBitmap.ctx.save();
                        staticBitmap.ctx.globalAlpha = alpha;
                        paintStaticItem(item);
                        staticBitmap.ctx.restore();
                    }
                }
                lastStrokeLifetimeSignature = strokeLifetimeSignature();
            };
            const syncStrokeLifetime = () => {
                const next = strokeLifetimeSignature();
                if (next === lastStrokeLifetimeSignature) return;
                lastStrokeLifetimeSignature = next;
                redrawStaticBitmap();
                recomposite();
            };
            const redrawRectFull = rect => {
                rect.canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                rect.canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                rect.ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                drawRectShape(rect.ctx, rect.box);
            };
            // fadingStrokes は完了済みの pen ストローク・rect の両方を保持する共有プール
            // （フェードアウト演出を共通化するため）。kind タグで再描画方法だけ出し分ける。
            const redrawFadingFull = item => (item.kind === 'rect' ? redrawRectFull(item) : redrawStrokeFull(item));
            const resizePenCanvases = () => {
                const cssWidth = Math.max(1, Math.round(penLayer.clientWidth || 1));
                const cssHeight = Math.max(1, Math.round(penLayer.clientHeight || 1));
                const dpr = Math.min(PEN_TUNING.maxDevicePixelRatio, window.devicePixelRatio || 1);
                if (cssWidth === penCanvasWidth && cssHeight === penCanvasHeight && dpr === penCanvasDpr) return;
                penCanvasWidth = cssWidth;
                penCanvasHeight = cssHeight;
                penCanvasDpr = dpr;
                penLayer.width = Math.round(cssWidth * dpr);
                penLayer.height = Math.round(cssHeight * dpr);
                penCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                rebuildPlatinumGradient();
                staticBitmap = allocPenCanvas();
                redrawStaticBitmap();
                if (currentStroke) redrawStrokeFull(currentStroke);
                if (currentRect) redrawRectFull(currentRect);
                for (const fading of fadingStrokes) redrawFadingFull(fading);
                recomposite();
            };
            const penFadeAlpha = (fading, timestamp) => {
                const now = timestamp || performance.now();
                return clamp(1 - (now - fading.fadeStartedAt) / PEN_TUNING.fadeDurationMs, 0, 1);
            };
            const updateAndDrawSparkles = (ctx, timestamp) => {
                if (sparkles.length === 0) return;
                const alive = [];
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (const sparkle of sparkles) {
                    const age = timestamp - sparkle.bornAt;
                    if (age >= sparkle.lifetimeMs) continue;
                    const fade = 1 - age / sparkle.lifetimeMs;
                    const twinkle = 0.6 + 0.4 * Math.sin((timestamp / 1000) * PEN_TUNING.sparkleTwinkleHz * Math.PI * 2 + sparkle.phase);
                    ctx.globalAlpha = clamp(fade * twinkle, 0, 1);
                    const size = sparkle.size * (0.7 + 0.3 * fade);
                    ctx.drawImage(sparkleSprite, sparkle.x - size / 2, sparkle.y - size / 2, size, size);
                    alive.push(sparkle);
                }
                ctx.restore();
                sparkles = alive;
            };
            const maybeSpawnSparkle = point => {
                for (let index = 0; index < PEN_TUNING.sparklesPerSegment; index += 1) {
                    if (sparkles.length >= PEN_TUNING.sparkleMaxPoolSize) sparkles.shift();
                    const angle = Math.random() * Math.PI * 2;
                    const jitter = Math.random() * PEN_TUNING.sparkleJitterPx;
                    sparkles.push({
                        x: point[0] * penCanvasWidth + Math.cos(angle) * jitter,
                        y: point[1] * penCanvasHeight + Math.sin(angle) * jitter,
                        bornAt: performance.now(),
                        lifetimeMs: PEN_TUNING.sparkleLifetimeMs * (0.6 + Math.random() * 0.8),
                        size: PEN_TUNING.sparkleMinSizePx + Math.random() * (PEN_TUNING.sparkleMaxSizePx - PEN_TUNING.sparkleMinSizePx),
                        phase: Math.random() * Math.PI * 2
                    });
                }
            };
            const recomposite = timestamp => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) return;
                penCtx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                if (staticBitmap) penCtx.drawImage(staticBitmap.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                for (const fading of fadingStrokes) {
                    penCtx.globalAlpha = penFadeAlpha(fading, timestamp);
                    penCtx.drawImage(fading.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                }
                penCtx.globalAlpha = 1;
                if (currentStroke) penCtx.drawImage(currentStroke.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                if (currentRect) penCtx.drawImage(currentRect.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                updateAndDrawSparkles(penCtx, timestamp || performance.now());
            };
            const drawPendingSegments = stroke => {
                const points = stroke.points;
                while (stroke.drawnIndex < points.length - 1) {
                    const from = points[stroke.drawnIndex];
                    const to = points[stroke.drawnIndex + 1];
                    drawSegment(stroke.ctx, from, to);
                    maybeSpawnSparkle(to);
                    stroke.drawnIndex += 1;
                }
            };
            const strokeLifetimeAnimating = () => reviewRecordingActive && persistentStrokeItems.some(item => {
                const base = Number.isFinite(item.recTEnd) ? item.recTEnd : item.recTStart;
                return Number.isFinite(base)
                    && (reviewRecNow() - base) < PEN_TUNING.visibleWindowSec + PEN_TUNING.fadeOutMs / 1000;
            });
            const penTick = timestamp => {
                if (currentStroke) drawPendingSegments(currentStroke);
                fadingStrokes = fadingStrokes.filter(fading => penFadeAlpha(fading, timestamp) > 0);
                syncStrokeLifetime();
                const lifetimeAnimating = strokeLifetimeAnimating();
                // 2 桁 signature が 0.00 へ丸まった後も、窓 + フェード終端で最後の透明化を確定する。
                if (strokeLifetimeWasAnimating && !lifetimeAnimating) redrawStaticBitmap();
                strokeLifetimeWasAnimating = lifetimeAnimating;
                recomposite(timestamp);
                const stillActive = currentStroke !== null || currentRect !== null
                    || fadingStrokes.length > 0 || sparkles.length > 0 || lifetimeAnimating;
                penAnimationHandle = stillActive ? requestAnimationFrame(penTick) : 0;
            };
            const ensurePenLoopRunning = () => {
                if (!penAnimationHandle) penAnimationHandle = requestAnimationFrame(penTick);
            };
            new ResizeObserver(resizePenCanvases).observe(penLayer);
            resizePenCanvases();
            const clearStaticAnnotationStrokes = () => {
                annotationStrokeItems = [];
                redrawStaticBitmap();
                recomposite();
            };
            const setPenModeActive = active => {
                penModeActive = active === true && reviewRecordingActive && !isPlaying;
                penToggle.setAttribute('aria-pressed', String(penModeActive));
                penLayer.classList.toggle('is-active', penModeActive || rectModeActive);
            };
            const setRectModeActive = active => {
                rectModeActive = active === true && reviewRecordingActive && !isPlaying;
                penLayer.classList.toggle('is-active', penModeActive || rectModeActive);
            };
            // ReviewSessionRecorder（host）が唯一の正本。ここはブロードキャストの反映と、
            // 既存入口（pen-toggle）からの request の両方が通る単一の適用点。
            const applyReviewToolMode = mode => {
                reviewToolMode = mode;
                setPenModeActive(mode === 'pen');
                setRectModeActive(mode === 'rect');
            };
            const abortCurrentStroke = () => {
                if (!currentStroke) return;
                const pointerId = currentStroke.pointerId;
                currentStroke = null;
                if (penLayer.hasPointerCapture(pointerId)) {
                    penLayer.releasePointerCapture(pointerId);
                }
            };
            const abortCurrentRect = () => {
                if (!currentRect) return;
                const pointerId = currentRect.pointerId;
                currentRect = null;
                if (penLayer.hasPointerCapture(pointerId)) {
                    penLayer.releasePointerCapture(pointerId);
                }
            };
            const captureDrawRect = () => {
                const contentRect = penLayer.getBoundingClientRect();
                activeDrawRect = {
                    left: contentRect.left,
                    top: contentRect.top,
                    width: Math.max(contentRect.width, 1),
                    height: Math.max(contentRect.height, 1)
                };
            };
            const normalizedPenPoint = event => {
                const rect = activeDrawRect || (captureDrawRect(), activeDrawRect);
                return [
                    clamp((event.clientX - rect.left) / rect.width, 0, 1),
                    clamp((event.clientY - rect.top) / rect.height, 0, 1)
                ];
            };
            const createActiveStroke = (pointerId, firstPoint) => {
                const bitmap = allocPenCanvas();
                return { kind: 'pen', pointerId, points: [firstPoint], drawnIndex: 0, canvas: bitmap.canvas, ctx: bitmap.ctx };
            };
            const showStaticAnnotationStrokes = strokes => {
                annotationStrokeItems = normalizePersistentStrokeItemsFn(strokes);
                redrawStaticBitmap();
                recomposite();
            };
            const showPersistentSessionStrokes = message => {
                persistentStrokeItems = normalizePersistentStrokeItemsFn(message.strokes);
                penLayer.dataset.akariStrokeSession = typeof message.sessionId === 'string' ? message.sessionId : '';
                penLayer.dataset.akariStrokeTargetTab = typeof message.target?.tab === 'string' ? message.target.tab : '';
                penLayer.dataset.akariStrokeTargetRecT = Number.isFinite(message.target?.recT)
                    ? String(message.target.recT) : '';
                redrawStaticBitmap();
                recomposite();
            };
            const canDraw = () => penModeActive && reviewRecordingActive && !isPlaying;
            const canDrawRect = () => rectModeActive && reviewRecordingActive && !isPlaying;
            const currentFrame = () => {
                const mapped = timelineToSource(outputTime);
                const segment = segments[mapped.index];
                return {
                    timelineT: outputTime,
                    sourceT: mapped.kind === 'src' && Number.isFinite(mapped.time)
                        ? mapped.time : video.currentTime,
                    cutIndex: segment && segment.kind === 'src' && Number.isInteger(segment.cutIndex)
                        ? segment.cutIndex : null,
                    ...(segment && typeof segment.id === 'string' ? { itemId: segment.id } : {}),
                    ...(segment && typeof segment.trackId === 'string' ? { trackId: segment.trackId } : {})
                };
            };
            // task.md 指示3: pen-toggle は既存の入口として残しつつ、実体は共有 toolMode への
            // request に載せ替える（host が唯一の正本 -- 右パネルの選択/ペン/四角ボタンと同じ経路）。
            // 楽観的にローカルへも即時反映し、host からのブロードキャストで再確認される。
            penToggle.addEventListener('click', () => {
                if (!reviewRecordingActive || isPlaying) return;
                const nextMode = reviewToolMode === 'pen' ? 'neutral' : 'pen';
                applyReviewToolMode(nextMode);
                window.akari.reviewSetToolMode(nextMode);
            });
            penLayer.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                if (canDraw() && !currentStroke) {
                    event.preventDefault();
                    clearStaticAnnotationStrokes();
                    penLayer.setPointerCapture(event.pointerId);
                    captureDrawRect();
                    const point = normalizedPenPoint(event);
                    currentStroke = createActiveStroke(event.pointerId, point);
                    const frameAtStart = currentFrame();
                    const recTStart = reviewRecNow();
                    currentStroke.recTStart = recTStart;
                    currentStroke.frameAtStart = frameAtStart;
                    window.akari.reviewStrokeStart(frameAtStart);
                    ensurePenLoopRunning();
                } else if (canDrawRect() && !currentRect) {
                    event.preventDefault();
                    clearStaticAnnotationStrokes();
                    penLayer.setPointerCapture(event.pointerId);
                    captureDrawRect();
                    const point = normalizedPenPoint(event);
                    const bitmap = allocPenCanvas();
                    currentRect = {
                        kind: 'rect', pointerId: event.pointerId, start: point,
                        box: [point[0], point[1], 0, 0], canvas: bitmap.canvas, ctx: bitmap.ctx
                    };
                    const frameAtStart = currentFrame();
                    const recTStart = reviewRecNow();
                    currentRect.recTStart = recTStart;
                    currentRect.frameAtStart = frameAtStart;
                    window.akari.reviewRectStart(frameAtStart);
                    ensurePenLoopRunning();
                }
            });
            penLayer.addEventListener('pointermove', event => {
                if (currentStroke && currentStroke.pointerId === event.pointerId && canDraw()) {
                    event.preventDefault();
                    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
                    const events = coalesced && coalesced.length > 0 ? coalesced : [event];
                    for (const raw of events) {
                        currentStroke.points.push(normalizedPenPoint(raw));
                    }
                    return;
                }
                if (currentRect && currentRect.pointerId === event.pointerId && canDrawRect()) {
                    event.preventDefault();
                    const point = normalizedPenPoint(event);
                    currentRect.box = normalizeRectFromPointsFn(currentRect.start, point);
                    currentRect.ctx.clearRect(0, 0, currentRect.canvas.width, currentRect.canvas.height);
                    drawRectShape(currentRect.ctx, currentRect.box);
                }
            });
            const finishPenStroke = event => {
                if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
                event.preventDefault();
                const completed = currentStroke;
                currentStroke = null;
                if (penLayer.hasPointerCapture(event.pointerId)) {
                    penLayer.releasePointerCapture(event.pointerId);
                }
                if (completed.points.length < 2) return;
                window.akari.reviewStrokeEnd(completed.points);
                persistentStrokeItems.push({ tool: 'pen', points: completed.points,
                    id: nextLocalStrokeId(),
                    recTStart: completed.recTStart,
                    recTEnd: reviewRecNow(),
                    ...(Number.isFinite(completed.frameAtStart?.timelineT)
                        ? { frame: { timelineT: completed.frameAtStart.timelineT } } : {})
                });
                redrawStaticBitmap();
                completed.fadeStartedAt = performance.now();
                fadingStrokes.push(completed);
                ensurePenLoopRunning();
            };
            const finishRect = event => {
                if (!currentRect || currentRect.pointerId !== event.pointerId) return;
                event.preventDefault();
                const completed = currentRect;
                currentRect = null;
                if (penLayer.hasPointerCapture(event.pointerId)) {
                    penLayer.releasePointerCapture(event.pointerId);
                }
                if (completed.box[2] <= 0 || completed.box[3] <= 0) return;
                window.akari.reviewRectEnd(completed.box);
                persistentStrokeItems.push({ tool: 'rect', box: completed.box,
                    id: nextLocalStrokeId(),
                    recTStart: completed.recTStart,
                    recTEnd: reviewRecNow(),
                    ...(Number.isFinite(completed.frameAtStart?.timelineT)
                        ? { frame: { timelineT: completed.frameAtStart.timelineT } } : {})
                });
                redrawStaticBitmap();
                completed.fadeStartedAt = performance.now();
                fadingStrokes.push(completed);
                ensurePenLoopRunning();
            };
            // 既存のペン挙動どおり、pointercancel も pointerup と同じ finish 経路を通す
            // （中断イベントでも 2 点以上あれば確定させる -- 元の finishPenStroke の挙動を維持）。
            penLayer.addEventListener('pointerup', event => {
                finishPenStroke(event);
                finishRect(event);
            });
            penLayer.addEventListener('pointercancel', event => {
                finishPenStroke(event);
                finishRect(event);
            });
            // timeline.tracks → z の純関数は preview / render-cut 共通の edit-store 正本。
            // webview sandbox では package import ができないため、関数本体そのものを注入する。
            const resolveInternalTrackZFn = (${resolveInternalTrackZ.toString()});
            let resolvedTracks = [];
            const rebuildVisualTrackZ = () => {
                resolvedTracks = Array.isArray(summary.timelineTracks) ? summary.timelineTracks : [];
            };
            rebuildVisualTrackZ();
            const zForTrack = trackId => {
                if (Number.isInteger(summary.trackStackZ?.[trackId])) {
                    return summary.trackStackZ[trackId];
                }
                return resolveInternalTrackZFn(resolvedTracks, trackId);
            };
            const zForItem = (itemId, trackZ) => Number.isInteger(summary.itemStackZ?.[itemId])
                ? summary.itemStackZ[itemId] : trackZ;
            const applyCutsZIndex = segment => {
                if (segment && segment.kind === 'src') {
                    const z = typeof zForItem === 'function'
                        ? zForItem(segment.id, zForTrack(segment.trackId)) : zForTrack(segment.trackId);
                    // renderTransitionComposite が同じ tick の前段で確定した zSwap を、
                    // applyCutsMuteState の通常 z 同期で巻き戻さない。合成終了時の reset が
                    // video / stillImage を正準 track z へ戻す。
                    if (activeTransitionWindowKey === null) {
                        video.style.zIndex = String(z);
                        stillImage.style.zIndex = String(z);
                    }
                    transitionPlate.style.zIndex = String(z);
                    transitionFallbackLabel.style.zIndex = String(z + 2);
                }
            };
            const cutHasLayerStyleVisual = segment => Boolean(segment && segment.kind === 'src'
                && (segment.crop || segment.frame || segment.perspective
                    || (Array.isArray(segment.keyframes) && segment.keyframes.length >= 2)));
            const writeCutLayerStyleBase = (media, segment) => {
                const active = cutHasLayerStyleVisual(segment);
                media.dataset.akariCutLayerStyleActive = String(active);
                if (!active) {
                    delete media.dataset.akariCropX;
                    delete media.dataset.akariCropY;
                    delete media.dataset.akariCropW;
                    delete media.dataset.akariCropH;
                    delete media.dataset.akariCropRotate;
                    delete media.dataset.akariPhotoFrame;
                    delete media.dataset.akariPerspectiveCorners;
                    delete media.dataset.akariCropClipPath;
                    delete media.dataset.akariCutCropDeclared;
                    return false;
                }
                const transform = segment.transform || {};
                media.dataset.akariCutCropDeclared = String(Boolean(segment.crop || segment.frame || segment.perspective
                    || segment.keyframes?.some(point => point?.crop || point?.perspective)
                    || segment.motion?.in?.preset === 'wipe' || segment.motion?.out?.preset === 'wipe'));
                media.dataset.akariTransformX = String(Number.isFinite(transform.x) ? transform.x : 0);
                media.dataset.akariTransformY = String(Number.isFinite(transform.y) ? transform.y : 0);
                media.dataset.akariTransformScale = String(
                    Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1
                );
                media.dataset.akariTransformScaleX = String(transform.scaleX ?? transform.scale ?? 1);
                media.dataset.akariTransformScaleY = String(transform.scaleY ?? transform.scale ?? 1);
                media.dataset.akariTransformRotate = String(Number.isFinite(transform.rotate) ? transform.rotate : 0);
                const crop = segment.crop;
                media.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                media.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                media.dataset.akariCropW = String(crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1);
                media.dataset.akariCropH = String(crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1);
                media.dataset.akariCropRotate = String(Number.isFinite(crop?.rotate) ? crop.rotate : 0);
                media.dataset.akariPhotoFrame = segment.frame ? JSON.stringify(segment.frame) : '';
                const corners = segment.perspective && Array.isArray(segment.perspective.corners)
                    ? segment.perspective.corners : null;
                if (corners) media.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete media.dataset.akariPerspectiveCorners;
                return true;
            };
            const applyCutKeyframesToMedia = (media, segment, localTime) => {
                if (!cutHasLayerStyleVisual(segment)) return false;
                if (selectionGestureProtects('cut')) return true;
                if (Array.isArray(segment.keyframes) && segment.keyframes.length >= 2) {
                    try {
                        // layer と同じ純関数を同じ cut-local/output 秒で評価する。outputTime 由来なので
                        // media の seeked 待ちに依存せず、再生とシークの双方で同じ値へ着地する。
                        const resolved = computeLayerKeyframesVisualFn(segment.keyframes, localTime, segment.transform || {}, true);
                        if (resolved?.transform) {
                            media.dataset.akariTransformX = String(resolved.transform.x);
                            media.dataset.akariTransformY = String(resolved.transform.y);
                            media.dataset.akariTransformScale = String(resolved.transform.scale);
                            media.dataset.akariTransformScaleX = String(resolved.transform.scaleX ?? resolved.transform.scale);
                            media.dataset.akariTransformScaleY = String(resolved.transform.scaleY ?? resolved.transform.scale);
                            media.dataset.akariTransformRotate = String(resolved.transform.rotate);
                        }
                        if (resolved?.crop) {
                            media.dataset.akariCropX = String(resolved.crop.x);
                            media.dataset.akariCropY = String(resolved.crop.y);
                            media.dataset.akariCropW = String(resolved.crop.w);
                            media.dataset.akariCropH = String(resolved.crop.h);
                        }
                        if (resolved?.perspective) {
                            media.dataset.akariPerspectiveCorners = JSON.stringify(resolved.perspective.corners);
                        }
                    } catch (error) {
                        console.warn('[akari-preview] cut keyframes visual failed; rendering static values', segment.id, error);
                    }
                }
                if (window.akari.applyCutLayerStyleLayout) window.akari.applyCutLayerStyleLayout(media);
                return true;
            };
            const clearAdjustBaseFilter = element => {
                if (frameEngineMediaIdle || !element) return;
                if (Object.prototype.hasOwnProperty.call(element.dataset, 'akariAdjustFilter')) {
                    delete element.dataset.akariAdjustFilter;
                    element.style.filter = '';
                }
            };
            const setAdjustBaseFilter = (element, item) => {
                if (frameEngineMediaIdle || !element) return;
                // stage の CSS 幅 = output.width、filter は transform 前に効くため blurScale = 1。
                const visual = computeAdjustCssVisualFn(adjustOfItem(item), undefined, 1);
                if (!visual) return;
                element.dataset.akariAdjustFilter = visual.filter;
                element.style.filter = visual.filter;
            };
            const setAdjustTransitionFilter = (element, item, transitionFilter) => {
                if (frameEngineMediaIdle || !element) return;
                // stage の CSS 幅 = output.width、filter は transform 前に効くため blurScale = 1。
                const visual = computeAdjustCssVisualFn(adjustOfItem(item), transitionFilter, 1);
                if (visual) element.style.filter = visual.filter;
            };
            const applyCutVisual = segment => {
                if (selectionGestureProtects('cut')) return;
                if (!segment || segment.kind !== 'src') {
                    video.dataset.akariCutTransformActive = 'false';
                    for (const media of [video, stillImage]) {
                        writeCutLayerStyleBase(media, null);
                        clearAdjustBaseFilter(media);
                    }
                    video.style.transform = '';
                    video.style.opacity = '';
                    video.dataset.akariCutIndex = '';
                    video.dataset.akariCutId = '';
                    video.dataset.akariCutFraming = '';
                    // ㉓ ギャップ等クリック選択の対象外へ移った場合は選択を外す
                    // （deselectCut は後段で定義される const だが、実際の呼び出しは
                    // 常にトップレベルスクリプト完了後の非同期経路のため安全）。
                    if (typeof deselectCut === 'function') deselectCut({ report: requestedCutId === undefined });
                    return;
                }
                const transform = segment.transform;
                if (transform) {
                    const x = Number.isFinite(transform.x) ? transform.x : 0;
                    const y = Number.isFinite(transform.y) ? transform.y : 0;
                    const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                    const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                    video.dataset.akariCutTransformActive = 'true';
                    video.dataset.akariTransformX = String(x);
                    video.dataset.akariTransformY = String(y);
                    video.dataset.akariTransformScale = String(scale);
                    video.dataset.akariTransformRotate = String(rotate);
                } else {
                    video.dataset.akariCutTransformActive = String(cutHasLayerStyleVisual(segment));
                }
                for (const media of [video, stillImage]) {
                    clearAdjustBaseFilter(media);
                    if (writeCutLayerStyleBase(media, segment)) {
                        applyCutKeyframesToMedia(media, segment, Math.max(0, outputTime - segment.outStart));
                    }
                    setAdjustBaseFilter(media, segment);
                }
                video.style.opacity = previewDomOpacityFn('media', segment.opacity, frameEngineMediaIdle, false);
                stillImage.style.opacity = video.style.opacity;
                video.dataset.akariCutIndex = Number.isInteger(segment.cutIndex) ? String(segment.cutIndex) : '';
                video.dataset.akariCutId = typeof segment.id === 'string' ? segment.id : '';
                if (requestedCutId !== undefined) cutSelected = requestedCutId === video.dataset.akariCutId;
                // ㉕ cuts[].framing は layer-style（crop）と共存できない（layerStyleVisualAt が
                // framing を捨てる）ため、framing 持ちの cut では辺バーを出さない（裁定 6）。
                video.dataset.akariCutFraming = segment.framing && typeof segment.framing === 'object'
                    && !Array.isArray(segment.framing) ? 'true' : '';
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (typeof updateCutSelectBox === 'function') updateCutSelectBox();
            };
            const createLayerEntry = (layer, index, initialEntry = false) => {
                // task 2026-08-10-image-layer-parity: layer.isImage はサーバ側（loadPreviewModel /
                // isImageLayerSrc）が拡張子で確定済み（webview から見える src はストリーム URL で
                // 元の拡張子を持たないことがあるため、ここで拡張子を再判定はしない）。
                const layerIsImage = Boolean(layer.isImage);
                const layerVideo = document.createElement(layerIsImage ? 'img' : 'video');
                const deferredTelop = layer.deferredTelop === true;
                const deferredPlaceholder = deferredTelop ? document.createElement('div') : null;
                const entry = {
                    spec: layer,
                    video: layerVideo,
                    deferredTelop,
                    deferredPlaceholder,
                    deferredSeekPending: false,
                    deferredSeekTarget: null,
                    deferredMediaLoading: deferredTelop,
                    deferredHasPresentedFrame: false
                };
                if (deferredPlaceholder) {
                    deferredPlaceholder.dataset.akariDeferredTelopId = String(layer.id);
                    deferredPlaceholder.setAttribute('role', 'status');
                    deferredPlaceholder.setAttribute('aria-label', 'テロップ（ATF）は退役しました');
                    const label = document.createElement('span');
                    label.className = 'akari-deferred-telop-placeholder__label';
                    label.textContent = 'テロップ（ATF）は退役しました。Lab の HTML 素材版へ差し替えてください。';
                    deferredPlaceholder.appendChild(label);
                    deferredPlaceholder.style.zIndex = String(zForItem(layer.id, zForTrack(layer.trackId)));
                    layersStage.appendChild(deferredPlaceholder);
                }
                if (layerIsImage) {
                    // ㉚ 画像レイヤー（司令塔裁定3）: <video> 固有の
                    // videoWidth/videoHeight/readyState/paused/play/pause を <img> インスタンス自身に
                    // 薄いファサードとして生やし、以降の配置・crop・アルファ実測・click 選択などの
                    // 既存コード（video 用に書かれたレール）を無改修のまま乗せる。videoWidth/
                    // videoHeight/readyState は都度評価する getter にする（ロード完了前後で値が
                    // 変わる、video の同名プロパティと同じ性質）。
                    Object.defineProperty(layerVideo, 'videoWidth', { get: () => layerVideo.naturalWidth });
                    Object.defineProperty(layerVideo, 'videoHeight', { get: () => layerVideo.naturalHeight });
                    Object.defineProperty(layerVideo, 'readyState', {
                        get: () => (layerVideo.complete && layerVideo.naturalWidth > 0) ? 4 : 0
                    });
                    // 静止画に「再生中」は無い: renderLayers() の play()/pause() 呼び出しを無害な
                    // no-op として吸収する（呼び出し側 = video 用の tick ロジックには手を入れない）。
                    layerVideo.paused = true;
                    layerVideo.play = () => Promise.resolve();
                    layerVideo.pause = () => {};
                    // video の 'loadedmetadata'（サイズ確定）と 'loadeddata'
                    // （updateLayerSelectBox の再試行リスナー）を img の 'load' 1本から合成発火する。
                    layerVideo.addEventListener('load', () => {
                        layerVideo.dispatchEvent(new Event('loadedmetadata'));
                        layerVideo.dispatchEvent(new Event('loadeddata'));
                    });
                } else {
                    layerVideo.muted = true;
                    layerVideo.preservesPitch = true;
                    layerVideo.playsInline = true;
                    // engine 面は配置・選択に必要な媒体実寸だけを取得する。src より先に
                    // metadata を宣言し、既定の auto として本体を読み始める競合を避ける。
                    layerVideo.preload = frameEngineMediaIdle ? 'metadata' : 'auto';
                    layerVideo.disablePictureInPicture = true;
                }
                layerVideo.tabIndex = -1;
                // アルファ実測（選択枠のコンテンツフィット・透明素通し）で canvas に描くため。
                // ストリームサーバは Access-Control-Allow-Origin: * を返す
                layerVideo.crossOrigin = 'anonymous';
                layerVideo.dataset.akariLayerId = String(layer.id);
                layerVideo.dataset.akariLayerIndex = String(index);
                layerVideo.dataset.akariLayerKind = String(layer.kind);
                if (layer.kind === 'baked') layerVideo.style.pointerEvents = 'none';
                layerVideo.style.opacity = previewDomOpacityFn('media', layer.opacity, frameEngineMediaIdle, false);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                setAdjustBaseFilter(layerVideo, layer);
                layerVideo.style.zIndex = String(zForItem(layer.id, zForTrack(layer.trackId)));
                const transform = layer.transform || {};
                const x = Number.isFinite(transform.x) ? transform.x : 0;
                const y = Number.isFinite(transform.y) ? transform.y : 0;
                const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                layerVideo.dataset.akariTransformX = String(x);
                layerVideo.dataset.akariTransformY = String(y);
                layerVideo.dataset.akariTransformScale = String(scale);
                layerVideo.dataset.akariTransformScaleX = String(transform.scaleX ?? scale);
                layerVideo.dataset.akariTransformScaleY = String(transform.scaleY ?? scale);
                layerVideo.dataset.akariTransformRotate = String(rotate);
                const crop = layer.crop;
                const cropW = crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1;
                const cropH = crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1;
                layerVideo.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                layerVideo.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                layerVideo.dataset.akariCropW = String(cropW);
                layerVideo.dataset.akariCropH = String(cropH);
                layerVideo.dataset.akariCropRotate = String(Number.isFinite(crop?.rotate) ? crop.rotate : 0);
                layerVideo.dataset.akariPhotoFrame = layer.frame ? JSON.stringify(layer.frame) : '';
                layerVideo.dataset.akariPhotoMaskUrl = layer.mask || '';
                layerVideo.dataset.akariPhotoErase = JSON.stringify(layer.erase || []);
                layerVideo.dataset.akariFlipH = layer.flip?.h ? 'true' : 'false';
                layerVideo.dataset.akariFlipV = layer.flip?.v ? 'true' : 'false';
                // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。absent/invalid
                // (schema-invalid corners, etc.) is represented as an empty dataset value --
                // updateStageScale's computeLayerPerspectiveVisualFn call already treats a falsy/
                // unparseable value as "no perspective", so no separate validity flag is needed here.
                const perspectiveCorners = layer.perspective && Array.isArray(layer.perspective.corners) ? layer.perspective.corners : null;
                if (perspectiveCorners) layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(perspectiveCorners);
                else delete layerVideo.dataset.akariPerspectiveCorners;
                const position = () => {
                    if (!(layerVideo.videoWidth > 0) || !(layerVideo.videoHeight > 0)) return;
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                };
                layerVideo.addEventListener('loadedmetadata', () => {
                    position();
                    tick(true);
                });
                for (const eventName of ['loadeddata', 'canplay']) {
                    layerVideo.addEventListener(eventName, () => {
                        if (entry.deferredTelop) entry.deferredMediaLoading = false;
                        tick(true);
                    });
                }
                layerVideo.addEventListener('seeked', () => {
                    if (entry.deferredTelop) {
                        entry.deferredSeekPending = false;
                        entry.deferredSeekTarget = null;
                    }
                    tick(true);
                });
                layerVideo.addEventListener('error', () => {
                    layerVideo.style.display = 'none';
                    console.warn('[akari-preview] layer media failed to load', layer.id);
                    const errorCode = layerVideo.error ? layerVideo.error.code : 0;
                    if ((errorCode === 3 || errorCode === 4) && typeof layer.sourceUri === 'string') {
                        showPlaybackError();
                        attemptHevcFallback(errorCode, layer.sourceUri);
                    }
                });
                if (typeof layer.src === 'string' && layer.src) {
                    if (!layerIsImage && frameEngineMediaIdle) layerVideo.preload = 'metadata';
                    layerVideo.src = layer.src;
                }
                if (initialEntry && index === summary.layers.length - 1) {
                    const reportInitialPaint = () => window.requestAnimationFrame(() =>
                        window.requestAnimationFrame(() => window.akari.reportReadySeek({
                            type: 'akari-preview-model-painted', pageId: initial.playbackPageId,
                            initialPaint: true, layerIds: summary.layers.map(item => item.id)
                        })));
                    if (initial.frameEngineEnabled) {
                        window.addEventListener('akari-frame-engine-ready', reportInitialPaint, { once: true });
                    } else if (layerIsImage) {
                        layerVideo.addEventListener('load', () => {
                            void layerVideo.decode().then(reportInitialPaint).catch(() => undefined);
                        }, { once: true });
                    } else {
                        layerVideo.addEventListener('loadeddata', reportInitialPaint, { once: true });
                    }
                }
                layersStage.appendChild(layerVideo);
                return entry;
            };
            const layerEntries = (Array.isArray(summary.layers) ? summary.layers : [])
                .map((layer, index) => createLayerEntry(layer, index, true));
            const optimisticallyRemovedIds = new Set();
            window.akari.optimisticallyRemovedIds = optimisticallyRemovedIds;
            let videoCandidatePreview = null;
            const clearVideoCandidatePreview = () => {
                if (!videoCandidatePreview) return;
                videoCandidatePreview.video.pause();
                videoCandidatePreview.audio?.pause();
                videoCandidatePreview.video.remove();
                videoCandidatePreview.audio?.remove();
                videoCandidatePreview = null;
                delete document.documentElement.dataset.akariVideoCandidatePreview;
                delete document.documentElement.dataset.akariVideoCandidateRelativePath;
                updateGenerationOverlay(outputTime);
            };
            const syncVideoCandidatePreview = timelineTime => {
                const candidate = videoCandidatePreview;
                if (!candidate) return;
                const entry = layerEntries.find(row => String(row.spec.id) === candidate.itemId);
                const layer = entry?.spec;
                const cut = !entry ? segments.find(row => String(row.id) === candidate.itemId
                    && timelineTime >= row.outStart && timelineTime < row.outEnd) : null;
                const active = entry ? timelineTime >= layer.t && timelineTime < layer.t + layer.duration
                    && entry.video.style.display !== 'none' : !!cut;
                const media = candidate.video;
                const original = entry?.video ?? (cut ? (isStillSegment(cut) ? stillImage : video) : null);
                if (original) {
                    media.style.cssText = original.style.cssText;
                    media.style.pointerEvents = 'none';
                    media.style.objectFit = 'contain';
                    media.style.visibility = 'visible';
                }
                media.style.display = active ? 'block' : 'none';
                const local = active ? timelineTime - (layer?.t ?? cut.outStart) : 0;
                const target = videoCandidatePreviewTimeFn(local, candidate.outSeconds,
                    layer?.duration ?? (cut ? cut.outEnd - cut.outStart : candidate.outSeconds),
                    Number(summary.output?.fps) || 30);
                if (active && media.readyState >= HTMLMediaElement.HAVE_METADATA
                    && Math.abs(media.currentTime - target) > (isPlaying ? 0.12 : 0.02)) {
                    try { media.currentTime = target; } catch (_error) { /* metadata changed */ }
                }
                const playing = active && isPlaying && local < candidate.outSeconds - 1 / (Number(summary.output?.fps) || 30);
                media.playbackRate = previewRate;
                if (playing && media.paused) void media.play().catch(() => undefined);
                if (!playing && !media.paused) media.pause();
                const audio = candidate.audio;
                if (audio) {
                    audio.playbackRate = previewRate;
                    audio.muted = !active || (entry
                        ? allTracksMutedByScope.layers || mutedTracksByScope.layers.has(layer.track)
                        : allTracksMutedByScope.cuts || mutedTracksByScope.cuts.has(cut?.track));
                    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA
                        && Math.abs(audio.currentTime - target) > 0.09) {
                        try { audio.currentTime = target; } catch (_error) { /* retry on next tick */ }
                    }
                    if (playing && audio.paused && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                        void audio.play().catch(() => undefined);
                    }
                    if (!playing && !audio.paused) audio.pause();
                }
            };
            // video FX rail is structurally absent when no LUT/chroma declaration exists. This is
            // the inert guarantee: no canvas, WebGL context, or per-tick work for ordinary projects.
            const videoFxConfig = summary.videoFx || null;
            const clipLookForSegment = segment => {
                const adjust = adjustOfItem(segment);
                if (!adjust || adjust.sections?.lut === false || !adjust.lut
                    || typeof adjust.lut.lut !== 'string') return null;
                const cubeText = (summary.adjustLutCubeTexts || {})[String(segment.id)];
                if (typeof cubeText !== 'string') return null;
                const intensity = Number.isFinite(adjust.lut.intensity)
                    ? Math.max(0, Math.min(1, adjust.lut.intensity)) : 1;
                return { cubeText, intensity };
            };
            const videoFxRails = [];
            const railMeta = new Map();
            const noteVideoFxFailure = effects => {
                if (effects && effects.look) videoFxFailedIndicators.add('LUT');
                if (effects && effects.chromaKey) videoFxFailedIndicators.add('クロマキー');
                refreshIndicators();
            };
            const mountVideoFxRail = (media, role, initialEffects) => {
                try {
                    const rail = window.AkariVideoFx.createRail({
                        media,
                        role,
                        onStateChange: event => {
                            if (event.status === 'failed') noteVideoFxFailure(railMeta.get(event.rail)?.effects || initialEffects);
                        }
                    });
                    const meta = { effects: initialEffects || {}, key: null };
                    railMeta.set(rail, meta);
                    videoFxRails.push(rail);
                    return rail;
                } catch (error) {
                    console.warn('[akari-preview] video FX rail unavailable; continuing native playback', role, error);
                    noteVideoFxFailure(initialEffects);
                    return null;
                }
            };
            const configureVideoFxRail = (rail, key, effects) => {
                if (!rail) return;
                const meta = railMeta.get(rail);
                if (meta.key === key) return;
                meta.key = key;
                meta.effects = effects;
                void rail.configure(effects);
            };
            const cutHasChroma = (Array.isArray(summary.cuts) ? summary.cuts : []).some(cut => cut.chromaKey);
            const firstClipLook = (Array.isArray(summary.cuts) ? summary.cuts : [])
                .map(cut => clipLookForSegment(cut)).find(Boolean) || null;
            const hasBaseVideoFx = Boolean(videoFxConfig && (videoFxConfig.look
                || Object.keys(videoFxConfig.sources || {}).length > 0 || cutHasChroma) || firstClipLook)
                && !frameEngineMediaIdle;
            const representativeChroma = hasBaseVideoFx && (
                Object.values(videoFxConfig && videoFxConfig.sources || {})[0]
                || (Array.isArray(summary.cuts) ? summary.cuts.find(cut => cut.chromaKey)?.chromaKey : null)
            );
            const baseInitialEffects = hasBaseVideoFx ? {
                ...(firstClipLook || (videoFxConfig && videoFxConfig.look)
                    ? { look: firstClipLook || videoFxConfig.look } : {}),
                ...(representativeChroma ? { chromaKey: representativeChroma } : {})
            } : null;
            let baseVideoFxRail = hasBaseVideoFx ? mountVideoFxRail(video, 'source', baseInitialEffects) : null;
            let standbyVideoFxRail = hasBaseVideoFx
                ? mountVideoFxRail(standbyVideo, 'standby', baseInitialEffects) : null;
            const transitionVideoFxRail = hasBaseVideoFx
                ? mountVideoFxRail(transitionVideo, 'transition', baseInitialEffects) : null;
            const stillVideoFxRail = hasBaseVideoFx ? mountVideoFxRail(stillImage, 'still', baseInitialEffects) : null;
            // createRail の canvas style 同期は render() 内だけで行われる。ダブルバッファの退避側は
            // render 対象から外れるため、最後の不透明フレームを残さないよう主映像 2 レールだけは
            // media の可視性を明示的に同期する（transition / still の既存レールには触れない）。
            const syncDoubleBufferVideoFxVisibility = () => {
                if (baseVideoFxRail && baseVideoFxRail.canvas) {
                    baseVideoFxRail.canvas.style.display = video.style.display || '';
                    baseVideoFxRail.canvas.style.visibility = video.style.visibility || '';
                    baseVideoFxRail.canvas.style.zIndex = video.style.zIndex || '';
                }
                if (standbyVideoFxRail && standbyVideoFxRail.canvas) {
                    standbyVideoFxRail.canvas.style.display = standbyVideo.style.display || '';
                    standbyVideoFxRail.canvas.style.visibility = standbyVideo.style.visibility || '';
                    standbyVideoFxRail.canvas.style.zIndex = standbyVideo.style.zIndex || '';
                }
            };
            syncDoubleBufferVideoFxVisibility();
            for (const entry of layerEntries) {
                entry.fxRail = !frameEngineMediaIdle && entry.spec.chromaKey
                    ? mountVideoFxRail(entry.video, 'layer:' + entry.spec.id, { chromaKey: entry.spec.chromaKey })
                    : null;
                if (entry.fxRail) configureVideoFxRail(
                    entry.fxRail,
                    'layer:' + entry.spec.id,
                    { chromaKey: entry.spec.chromaKey }
                );
            }
            const effectsForSegment = (segment, allowClipLut = true) => {
                const chromaKey = segment && (segment.chromaKey
                    || (videoFxConfig && videoFxConfig.sources && videoFxConfig.sources[segment.src]));
                const clipLook = allowClipLut ? clipLookForSegment(segment) : null;
                const look = clipLook || (videoFxConfig && videoFxConfig.look);
                return {
                    ...(look ? { look } : {}),
                    ...(chromaKey ? { chromaKey } : {})
                };
            };
            const renderVideoFx = timelineTime => {
                if (frameEngineMediaIdle) return;
                if (!hasBaseVideoFx && !layerEntries.some(entry => entry.fxRail)) return;
                syncDoubleBufferVideoFxVisibility();
                const segment = segments[activeSegmentIndex];
                const baseEffects = effectsForSegment(segment);
                const baseKey = 'base:' + String(segment && segment.cutIndex) + ':' + String(segment && segment.src);
                configureVideoFxRail(baseVideoFxRail, baseKey, baseEffects);
                configureVideoFxRail(stillVideoFxRail, baseKey + ':still', effectsForSegment(segment, false));
                if (baseVideoFxRail) baseVideoFxRail.render(timelineTime);
                if (stillVideoFxRail && stillImage.style.display !== 'none') stillVideoFxRail.render(timelineTime);

                const transitionWindow = transitionWindows.find(candidate =>
                    timelineTime >= candidate.start && timelineTime < candidate.end);
                const transitionEffects = effectsForSegment(transitionWindow && transitionWindow.incoming);
                const transitionKey = 'transition:' + String(transitionWindow && transitionWindow.incoming.cutIndex)
                    + ':' + String(transitionWindow && transitionWindow.incoming.src);
                configureVideoFxRail(transitionVideoFxRail, transitionKey, transitionEffects);
                if (transitionVideoFxRail && transitionVideo.style.display !== 'none') {
                    transitionVideoFxRail.render(timelineTime);
                }
                for (const entry of layerEntries) {
                    if (entry.fxRail && entry.video.style.display !== 'none') entry.fxRail.render(timelineTime);
                }
            };
            window.akari.videoFx = Object.freeze({
                rails: videoFxRails,
                inspect: () => videoFxRails.map(rail => rail.inspect())
            });
            const cssFilterFor = spec => {
                if (spec && spec.type === 'invert') return 'invert(1)';
                if (spec && spec.type === 'saturation' && Number.isFinite(spec.value)) {
                    return 'saturate(' + Math.max(0, Number(spec.value)) + ')';
                }
                return 'none';
            };
            const filterEntries = (Array.isArray(summary.filters) ? summary.filters : []).map(filter => {
                const element = document.createElement('div');
                element.dataset.akariFilterId = String(filter.id);
                element.style.zIndex = String(zForItem(filter.id, zForTrack(filter.trackId)));
                element.style.backdropFilter = cssFilterFor(filter.filter);
                element.style.webkitBackdropFilter = cssFilterFor(filter.filter);
                setAdjustBaseFilter(element, filter);
                layersStage.appendChild(element);
                return { spec: filter, element };
            });
            const applyIncrementalLayerSpec = (entry, layer) => {
                if (selectionGestureProtects('layer', entry)) return;
                // 非同期 telop の ready 後に通常のファイル更新が来ても、次の bake 待ちを示す
                // proxyMissing モデルで既に表示中の src を巻き戻さない。
                if (layer.proxyMissing && !layer.src && entry.spec.src && !entry.spec.proxyMissing) {
                    layer = { ...layer, src: entry.spec.src, proxyMissing: false };
                }
                entry.spec = layer;
                const layerVideo = entry.video;
                if (entry.fxRail && layer.chromaKey) {
                    configureVideoFxRail(entry.fxRail, 'layer:' + layer.id + ':' + JSON.stringify(layer.chromaKey), {
                        chromaKey: layer.chromaKey
                    });
                }
                if (typeof layer.src === 'string' && layer.src
                    && layerVideo.getAttribute('src') !== layer.src) {
                    if (entry.deferredTelop) {
                        entry.deferredMediaLoading = true;
                        entry.deferredSeekPending = false;
                        entry.deferredSeekTarget = null;
                    }
                    if (layerVideo.tagName === 'VIDEO' && frameEngineMediaIdle) {
                        layerVideo.preload = 'metadata';
                    }
                    layerVideo.src = layer.src;
                    entry.opaqueBox = undefined;
                }
                layerVideo.style.opacity = previewDomOpacityFn('media', layer.opacity, frameEngineMediaIdle, false);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                clearAdjustBaseFilter(layerVideo);
                setAdjustBaseFilter(layerVideo, layer);
                layerVideo.style.zIndex = String(zForItem(layer.id, zForTrack(layer.trackId)));
                if (entry.deferredPlaceholder) {
                    entry.deferredPlaceholder.style.zIndex = String(zForItem(layer.id, zForTrack(layer.trackId)));
                }
                const transform = layer.transform || {};
                layerVideo.dataset.akariTransformX = String(Number.isFinite(transform.x) ? transform.x : 0);
                layerVideo.dataset.akariTransformY = String(Number.isFinite(transform.y) ? transform.y : 0);
                layerVideo.dataset.akariTransformScale = String(
                    Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1
                );
                layerVideo.dataset.akariTransformScaleX = String(transform.scaleX ?? transform.scale ?? 1);
                layerVideo.dataset.akariTransformScaleY = String(transform.scaleY ?? transform.scale ?? 1);
                layerVideo.dataset.akariTransformRotate = String(Number.isFinite(transform.rotate) ? transform.rotate : 0);
                const crop = layer.crop;
                layerVideo.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                layerVideo.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                layerVideo.dataset.akariCropW = String(crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1);
                layerVideo.dataset.akariCropH = String(crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1);
                layerVideo.dataset.akariCropRotate = String(Number.isFinite(crop?.rotate) ? crop.rotate : 0);
                layerVideo.dataset.akariPhotoFrame = layer.frame ? JSON.stringify(layer.frame) : '';
                layerVideo.dataset.akariPhotoMaskUrl = layer.mask || '';
                layerVideo.dataset.akariPhotoErase = JSON.stringify(layer.erase || []);
                layerVideo.dataset.akariFlipH = layer.flip?.h ? 'true' : 'false';
                layerVideo.dataset.akariFlipV = layer.flip?.v ? 'true' : 'false';
                const corners = layer.perspective && Array.isArray(layer.perspective.corners)
                    ? layer.perspective.corners : null;
                if (corners) layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete layerVideo.dataset.akariPerspectiveCorners;
            };
            // CF-select + transform ハンドル: レイヤー実体のクリック選択・タイムラインとの双方向同期・
            // プレビュー内ドラッグ移動/リサイズ(=scale)/回転。確定(pointerup)時のみ layerWrite で
            // 書き戻す（既存 overlay ドラッグ編集と同じ確定タイミング）。
            let selectedLayerId = null;
            // ㉔ クロップモード（2026-08-06 オーナー裁定: shell/Web 両面）。移動/リサイズ/回転と
            // 操作が衝突しないための排他モード切替。選択が変わったら自動的に抜ける。
            let cropModeActive = false;
            let photoCropTarget = null;
            let photoCropSnapshot = null;
            let photoCropDirty = false;
            let photoCropItemId = null;
            let cropModeCancelRequested = false;
            const photoCropPanel = document.getElementById('photo-crop-controls');
            const photoCropRatio = photoCropPanel.querySelector('[data-photo-crop-ratio]');
            const photoCropRotate = photoCropPanel.querySelector('[data-photo-crop-rotate]');
            const photoCropStatus = photoCropPanel.querySelector('[data-photo-crop-status]');
            const photoCropForRatioFn = (${photoCropForRatio.toString()});
            const photoCropAfterPanFn = (${photoCropAfterPan.toString()});
            const photoCropConstrainRatioAfterEdgeFn = (${photoCropConstrainRatioAfterEdge.toString()});
            const smartPhotoCropFn = (${smartPhotoCrop.toString()});
            const photoCropTransformPatchFn = (${photoCropTransformPatch.toString()});
            const photoFrameVisualFn = (${photoFrameVisual.toString()});
            // 裁定 3: 辺バーのドラッグ中だけ #layer-crop-box（全面の破線外枠 + 窓外の暗転）を
            // ゴーストとして出す。⛶ モードと違い、離せば元の選択枠だけに戻る。
            let edgeCropDragActive = false;
            let edgeCropDragTarget = null;
            const layerCropBox = document.getElementById('layer-crop-box');
            const layerCropRect = layerCropBox.querySelector('.akari-layer-crop-rect');
            const layerCropHandleElements = Array.from(layerCropBox.querySelectorAll('[data-akari-crop-handle]'));
            const layerCropToggle = document.getElementById('layer-crop-toggle');
            // ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ。4隅の
            // 直接ドラッグハンドルは次段のため、クロップのようなハンドル/モードの仕組みは持たない。
            let perspectivePanelOpen = false;
            let activePerspectivePreset = null;
            let perspectiveSliderOriginal = null;
            const layerPerspectiveToggle = document.getElementById('layer-perspective-toggle');
            const layerPerspectivePanel = document.getElementById('layer-perspective-panel');
            const layerPerspectivePresetButtons = Array.from(layerPerspectivePanel.querySelectorAll('[data-akari-perspective-preset]'));
            const layerPerspectiveAngleInput = layerPerspectivePanel.querySelector('[data-akari-perspective-angle]');
            const layerPerspectiveAngleValueEl = layerPerspectivePanel.querySelector('[data-akari-perspective-angle-value]');
            const layerPerspectiveClearButton = layerPerspectivePanel.querySelector('[data-akari-perspective-clear]');
            const layerSelectBox = document.getElementById('layer-select-box');
            const layerHandleElements = Array.from(layerSelectBox.querySelectorAll('[data-akari-handle]'));
            // The object-tree selection frame is created by overlay-runtime. A canvas group
            // has uniform scale only; its axis-only edge handles cannot represent that model.
            const groupEdgeStyle = document.createElement('style');
            groupEdgeStyle.textContent = '.akari-interaction-selection-frame[data-akari-selection-kind="group"]'
                + ' .akari-interaction-handle.is-edge { display: none !important; }';
            document.head.appendChild(groupEdgeStyle);
            let floatingMenuRect = null;
            let hostMenuRect = null;
            let floatingBarRect = null;
            const updateFloatingMenuRect = () => {
                if (!hostMenuRect || !floatingBarRect) {
                    floatingMenuRect = hostMenuRect || floatingBarRect;
                    return;
                }
                const left = Math.min(hostMenuRect.left, floatingBarRect.left);
                const top = Math.min(hostMenuRect.top, floatingBarRect.top);
                floatingMenuRect = { left, top,
                    width: Math.max(hostMenuRect.left + hostMenuRect.width,
                        floatingBarRect.left + floatingBarRect.width) - left,
                    height: Math.max(hostMenuRect.top + hostMenuRect.height,
                        floatingBarRect.top + floatingBarRect.height) - top };
            };
            const previewMotionGeometryTransformFn = (${previewMotionGeometryTransform.toString()});
            const previewMotionBoxHitAtFn = (${previewMotionBoxHitAt.toString()});
            const previewMotionLiveItemFn = (${previewMotionLiveItem.toString()});
            const findLayerEntry = id => layerEntries.find(entry => String(entry.spec.id) === String(id));
            const layerTransformNow = entry => {
                const scale = Number(entry.video.dataset.akariTransformScale) || 1;
                const scaleX = Number(entry.video.dataset.akariTransformScaleX) || scale;
                const scaleY = Number(entry.video.dataset.akariTransformScaleY) || scale;
                return {
                    x: Number(entry.video.dataset.akariTransformX) || 0,
                    y: Number(entry.video.dataset.akariTransformY) || 0,
                    scale,
                    ...(scaleX !== scale || scaleY !== scale ? { scaleX, scaleY } : {}),
                    rotate: Number(entry.video.dataset.akariTransformRotate) || 0
                };
            };
            // RAF スロットリング（2026-08-09 raf-throttle・オーナー実機フィードバック「サイズ変更が
            // すごくもたつく」）: dataset への書き込みは常に同期（pointerup の確定読み取りが最新値を
            // 読めるように）。重い方（updateLayerLayout = 全レイヤー + stage 再配置、と選択枠の再描画）
            // だけを 1 フレーム 1 回へ間引く。ドラッグ終了直後は各 finish() 側で flush() して
            // 最終値の反映を RAF 待ちにしない。
            const layerTransformVisualThrottle = createRafThrottleFn(() => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : null;
                if (entry) void window.akari.frameEngineClock?.applyTransformPreview?.({ kind: 'layer', id: entry.spec.id },
                    entry.previewPositionPatch ?? layerTransformNow(entry), outputTime);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                updateLayerSelectBox();
            });
            const applyLayerTransformNow = (entry, transform, previewPatch = transform, visiblePosition = null) => {
                entry.previewPositionPatch = previewPatch;
                entry.previewVisiblePosition = visiblePosition;
                entry.video.dataset.akariTransformX = String(transform.x);
                entry.video.dataset.akariTransformY = String(transform.y);
                entry.video.dataset.akariTransformScale = String(transform.scale);
                entry.video.dataset.akariTransformScaleX = String(transform.scaleX ?? transform.scale);
                entry.video.dataset.akariTransformScaleY = String(transform.scaleY ?? transform.scale);
                entry.video.dataset.akariTransformRotate = String(transform.rotate);
                window.akari.reportLiveValues?.({ id: String(entry.spec.id), values: transform });
                layerTransformVisualThrottle.call();
            };
            // ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的）。CROP_MIN は空クロップ化を防ぐ
            // 下限（ハンドルが操作不能になる縮退を避ける）。clampCrop は render-cut/src/layers.mjs の
            // クランプと同じ意味論をプレビュー側で独立実装したもの（パリティ契約が明記する意図的な
            // コード重複の方針に倣う — 2.2 節の描画既定などと同型）。
            const CROP_MIN = 0.02;
            // 辺バーの当たり幅は維持し、小さい選択でも当該軸が 24px 以上なら表示する。
            // allowed=false は「この対象では辺バーそのものを出さない」（v2 でない cut / framing 持ち）。
            const CROP_EDGE_MIN_BOX_PX = 24;
            const applyCropEdgeVisibility = (box, widthPx, heightPx, allowed) => {
                box.classList.toggle('akari-crop-edges-off', !allowed);
                box.classList.toggle('akari-crop-edges-hide-x', !(widthPx >= CROP_EDGE_MIN_BOX_PX));
                box.classList.toggle('akari-crop-edges-hide-y', !(heightPx >= CROP_EDGE_MIN_BOX_PX));
            };
            const clampCrop = (x, y, w, h) => {
                const cw = Math.min(1, Math.max(CROP_MIN, Number.isFinite(w) ? w : 1));
                const ch = Math.min(1, Math.max(CROP_MIN, Number.isFinite(h) ? h : 1));
                const cx = Math.min(1 - cw, Math.max(0, Number.isFinite(x) ? x : 0));
                const cy = Math.min(1 - ch, Math.max(0, Number.isFinite(y) ? y : 0));
                return { x: cx, y: cy, w: cw, h: ch };
            };
            const layerCropNow = entry => ({ ...clampCrop(
                Number(entry.video.dataset.akariCropX),
                Number(entry.video.dataset.akariCropY),
                Number(entry.video.dataset.akariCropW),
                Number(entry.video.dataset.akariCropH)
            ), ...(Number(entry.video.dataset.akariCropRotate) ? { rotate: Number(entry.video.dataset.akariCropRotate) } : {}) });
            // RAF スロットリング（2026-08-09 raf-throttle）: applyLayerTransformNow と同じ規律
            // （dataset は同期・重い方だけ1フレーム1回）。crop 単独/crop+transform 一括のどちらも
            // 同じ「レイヤーの見た目を測り直す」作業なので throttle インスタンスを共有する
            // （同時に両方から呼ばれることはない = ドラッグは常に単一ジェスチャー）。
            const layerCropVisualThrottle = createRafThrottleFn(() => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : null;
                if (entry && (cropModeActive || edgeCropDragActive)) {
                    void window.akari.frameEngineClock?.applyCropPreview?.(
                        { kind: 'layer', id: entry.spec.id }, layerCropNow(entry), layerTransformNow(entry));
                }
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (cropModeActive || edgeCropDragActive) updateLayerCropBox();
                if (!cropModeActive) updateLayerSelectBox();
            });
            const applyLayerCropNow = (entry, crop) => {
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                entry.video.dataset.akariCropX = String(c.x);
                entry.video.dataset.akariCropY = String(c.y);
                entry.video.dataset.akariCropW = String(c.w);
                entry.video.dataset.akariCropH = String(c.h);
                entry.video.dataset.akariCropRotate = String(crop.rotate || 0);
                layerCropVisualThrottle.call();
            };
            // ㉗ クロップハンドル操作の錨補正（2026-08-06 crop-handle-anchor-fix）: crop と
            // transform.x/y を同一フレームで一括更新する。crop 単独 → transform 単独の2段更新だと
            // 中間フレームで一瞬だけ錨補正前の crop が画面に出てしまう（updateLayerLayout が
            // 前者の呼び出し時点でまだ古い transform を使って描く）ため、必ずこちらを使う。
            const applyLayerCropAndTransformNow = (entry, crop, transform) => {
                // 移動ドラッグの可視位置と engine 用 patch は crop の錨補正前の値。
                // 以後は同時に書く dataset の transform を唯一のライブ位置にする。
                entry.previewVisiblePosition = null;
                entry.previewPositionPatch = null;
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                entry.video.dataset.akariCropX = String(c.x);
                entry.video.dataset.akariCropY = String(c.y);
                entry.video.dataset.akariCropW = String(c.w);
                entry.video.dataset.akariCropH = String(c.h);
                entry.video.dataset.akariCropRotate = String(crop.rotate || 0);
                entry.video.dataset.akariTransformX = String(transform.x);
                entry.video.dataset.akariTransformY = String(transform.y);
                entry.video.dataset.akariTransformScale = String(transform.scale);
                entry.video.dataset.akariTransformScaleX = String(transform.scaleX ?? transform.scale);
                entry.video.dataset.akariTransformScaleY = String(transform.scaleY ?? transform.scale);
                entry.video.dataset.akariTransformRotate = String(transform.rotate);
                layerCropVisualThrottle.call();
            };
            // 裁定 0（cut と layer の操作系を統一）: 選択枠の幾何計算・角点 / 回転 / 辺バーの
            // ドラッグ・確定書き戻しを 1 組の関数へ寄せ、対象の違いだけをこの記述子で渡す。
            // layer は entry（media 実体 + spec）、cut は #preview-video / #preview-still。
            const motionAtForSpec = (spec, start, duration, liveTransform) => {
                if (!spec || !window.akari.itemMotion) return null;
                const fps = Number(summary.output?.fps) || 30;
                const item = spec.motionSource ? { ...spec.motionSource, fps }
                    : { at: Number(start) || 0, duration: Number(duration) || 0, fps,
                        keyframeUnit: 'seconds', transform: spec.transform, opacity: spec.opacity,
                        keyframes: spec.keyframes, motion: spec.motion };
                const parents = (spec.motionParents ?? []).map(parent => ({ ...parent, fps }));
                return { item, parents, time: outputTime,
                    visible: window.akari.itemMotion.evaluateItemMotion(
                        liveTransform ? previewMotionLiveItemFn(item, liveTransform) : item, outputTime, parents) };
            };
            const layerVisualTransformNow = entry => previewMotionGeometryTransformFn(
                layerTransformNow(entry), motionAtForSpec(entry.spec, entry.spec.t, entry.spec.duration,
                    layerTransformNow(entry))?.visible,
                entry.previewVisiblePosition);
            const layerDragTarget = entry => ({
                kind: 'layer',
                entry,
                media: entry.video,
                visible: () => entry.video.style.display !== 'none',
                naturalSize: () => ({ width: entry.video.videoWidth || entry.video.naturalWidth || entry.spec.width || 0,
                    height: entry.video.videoHeight || entry.video.naturalHeight || entry.spec.height || 0 }),
                transformNow: () => layerTransformNow(entry),
                visualNow: () => layerVisualTransformNow(entry),
                motionAt: () => motionAtForSpec(entry.spec, entry.spec.t, entry.spec.duration),
                cropNow: () => layerCropNow(entry),
                // layers[] は最初からソース実寸基準（layer-style）なので fit の焼き込みは無い。
                cropEntryTransform: transform => ({ ...transform }),
                applyTransform: (transform, previewPatch, visiblePosition) =>
                    applyLayerTransformNow(entry, transform, previewPatch, visiblePosition),
                applyCropAndTransform: (crop, transform) => applyLayerCropAndTransformNow(entry, crop, transform),
                cropRestorePoint: () => ({ crop: layerCropNow(entry), transform: layerTransformNow(entry) }),
                restoreCrop: point => applyLayerCropAndTransformNow(entry, point.crop, point.transform),
                flushTransform: () => layerTransformVisualThrottle.flush(),
                flushCrop: () => layerCropVisualThrottle.flush(),
                canWrite: () => true,
                write: patch => window.akari.engine.layerWrite(entry.spec.id, patch)
            });
            // ベイクテロップは全面サイズの透明動画なので、要素の箱で選択枠を描くと画面いっぱいに
            // なり分かりにくい。現フレームのアルファを実測し、不透明領域（コンテンツ）へ枠を
            // フィットさせ、透明部分のクリックは下へ素通しする。計測不能（CORS 等）時は従来挙動
            const layerAlphaCanvasEl = document.createElement('canvas');
            // 画面クライアント座標 → ソース動画のネイティブ px 座標への逆写像。pivot（回転・平行移動の
            // 基準点、ソース px 空間）を外から渡せるようにし、通常のヒットテスト（pivot=クロップ中心 =
            // 実際の合成基準点）とクロップモードの編集（pivot=全面中心 = 常に自分の中心で回る素直な
            // 参照系）の両方から共有する。
            const layerVideoPointForPivot = (transform, pivotPx, clientX, clientY) => {
                const p = window.akari.interaction && window.akari.interaction.stageLocalPoint
                    ? window.akari.interaction.stageLocalPoint(clientX, clientY) : null;
                if (!p) return null;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const dx = p.x - (outputWidth / 2 + transform.x);
                const dy = p.y - (outputHeight / 2 + transform.y);
                const rad = -transform.rotate * Math.PI / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                return { x: rx / (transform.scaleX ?? transform.scale ?? 1) + pivotPx.x,
                    y: ry / (transform.scaleY ?? transform.scale ?? 1) + pivotPx.y };
            };
            const layerVideoPointFor = (entry, clientX, clientY) => {
                const t = typeof layerVisualTransformNow === 'function'
                    ? layerVisualTransformNow(entry) : layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * entry.video.videoWidth,
                    y: (crop.y + crop.h / 2) * entry.video.videoHeight
                };
                const point = layerVideoPointForPivot(t, pivotPx, clientX, clientY);
                if (!point) return null;
                const { x: vx, y: vy } = point;
                if (!(vx >= 0) || !(vy >= 0) || vx >= entry.video.videoWidth || vy >= entry.video.videoHeight) return null;
                return { x: Math.floor(vx), y: Math.floor(vy) };
            };
            const layerGeometryHitAt = (entry, clientX, clientY, dimensions) => {
                if (dimensions || frameEngineMediaIdle || window.akari.frameEngineClock) {
                    const resolveDeclaredSize = (${resolveLayerDeclaredSize.toString()});
                    const declaredHitAt = (${layerDeclaredGeometryHitAt.toString()});
                    const size = resolveDeclaredSize(entry.video.videoWidth || entry.video.naturalWidth,
                        entry.video.videoHeight || entry.video.naturalHeight, dimensions || summary.output);
                    const point = window.akari.interaction?.stageLocalPoint?.(clientX, clientY) || null;
                    const transform = typeof layerVisualTransformNow === 'function'
                        ? layerVisualTransformNow(entry) : layerTransformNow(entry);
                    return declaredHitAt(size, summary.output, transform, layerCropNow(entry), point);
                }
                const width = Number(entry.video.videoWidth) || 0;
                const height = Number(entry.video.videoHeight) || 0;
                if (!(width > 0) || !(height > 0)) return false;
                const transform = typeof layerVisualTransformNow === 'function'
                    ? layerVisualTransformNow(entry) : layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * width,
                    y: (crop.y + crop.h / 2) * height
                };
                const point = layerVideoPointForPivot(transform, pivotPx, clientX, clientY);
                if (!point) return false;
                return point.x >= crop.x * width
                    && point.x < (crop.x + crop.w) * width
                    && point.y >= crop.y * height
                    && point.y < (crop.y + crop.h) * height;
            };
            // 画面座標への正写像（layerVideoPointForPivot の逆）。videoRect はソース px 空間の矩形
            // （全面フレーム or クロップ矩形）、pivotPx は回転・平行移動の基準点（同じくソース px）。
            // updateLayerSelectBox（pivot=クロップ中心）とクロップモードの外枠/内枠描画
            // （pivot=全面中心）の両方から共有する。
            const layerScreenRectForVideoRect = (transform, videoRect, pivotPx) => {
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const scaleX = transform.scaleX ?? transform.scale;
                const scaleY = transform.scaleY ?? transform.scale;
                const outputW = videoRect.w * scaleX;
                const outputH = videoRect.h * scaleY;
                const offX = (videoRect.x + videoRect.w / 2 - pivotPx.x) * scaleX;
                const offY = (videoRect.y + videoRect.h / 2 - pivotPx.y) * scaleY;
                const rad = transform.rotate * Math.PI / 180;
                const rotOffX = offX * Math.cos(rad) - offY * Math.sin(rad);
                const rotOffY = offX * Math.sin(rad) + offY * Math.cos(rad);
                const outputCenterX = outputWidth / 2 + transform.x + rotOffX;
                const outputCenterY = outputHeight / 2 + transform.y + rotOffY;
                const screenW = outputW * frameScale;
                const screenH = outputH * frameScale;
                const screenCenterX = frameRect.x + outputCenterX * frameScale;
                const screenCenterY = frameRect.y + outputCenterY * frameScale;
                return { left: screenCenterX - screenW / 2, top: screenCenterY - screenH / 2, width: screenW, height: screenH, rotOffX, rotOffY };
            };
            const layerAlphaAtPoint = (entry, clientX, clientY) => {
                try {
                    if (!(entry.video.videoWidth > 0) || entry.video.readyState < 2) return 255;
                    const vp = layerVideoPointFor(entry, clientX, clientY);
                    if (!vp) return 0;
                    layerAlphaCanvasEl.width = 1;
                    layerAlphaCanvasEl.height = 1;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, 1, 1);
                    ctx.drawImage(entry.video, vp.x, vp.y, 1, 1, 0, 0, 1, 1);
                    return ctx.getImageData(0, 0, 1, 1).data[3];
                } catch (_error) {
                    return 255;
                }
            };
            const layerAlphaAtSourcePoint = (entry, point) => {
                try {
                    if (entry.video.readyState < 2) return 255;
                    layerAlphaCanvasEl.width = 1;
                    layerAlphaCanvasEl.height = 1;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, 1, 1);
                    ctx.drawImage(entry.video, point.x, point.y, 1, 1, 0, 0, 1, 1);
                    return ctx.getImageData(0, 0, 1, 1).data[3];
                } catch (_error) { return 255; }
            };
            const measureLayerOpaqueBox = entry => {
                try {
                    const vw = entry.video.videoWidth;
                    const vh = entry.video.videoHeight;
                    if (!(vw > 0) || !(vh > 0) || entry.video.readyState < 2) return null;
                    const shrink = Math.min(1, 320 / Math.max(vw, vh));
                    const w = Math.max(1, Math.round(vw * shrink));
                    const h = Math.max(1, Math.round(vh * shrink));
                    layerAlphaCanvasEl.width = w;
                    layerAlphaCanvasEl.height = h;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(entry.video, 0, 0, w, h);
                    const data = ctx.getImageData(0, 0, w, h).data;
                    let minX = w, minY = h, maxX = -1, maxY = -1;
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            if (data[(y * w + x) * 4 + 3] > 16) {
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    if (maxX < 0) return null;
                    const sx = vw / w;
                    const sy = vh / h;
                    const pad = Math.max(4, sx * 1.5);
                    return {
                        x: Math.max(0, minX * sx - pad),
                        y: Math.max(0, minY * sy - pad),
                        w: Math.min(vw, (maxX - minX + 1) * sx + pad * 2),
                        h: Math.min(vh, (maxY - minY + 1) * sy + pad * 2)
                    };
                } catch (_error) {
                    return null;
                }
            };
            const syncLayerHitRegion = (entry, forceMeasure = false) => {
                if (frameEngineMediaIdle) {
                    entry.opaqueBox = null;
                    delete entry.video.dataset.akariOpaqueX;
                    delete entry.video.dataset.akariOpaqueY;
                    delete entry.video.dataset.akariOpaqueW;
                    delete entry.video.dataset.akariOpaqueH;
                    entry.video.style.pointerEvents = entry.spec.kind === 'baked' ? 'none' : 'auto';
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                    return null;
                }
                if (forceMeasure) entry.opaqueBox = undefined;
                if (entry.opaqueBox === undefined) entry.opaqueBox = measureLayerOpaqueBox(entry);
                const box = entry.opaqueBox;
                if (box) {
                    entry.video.dataset.akariOpaqueX = String(box.x);
                    entry.video.dataset.akariOpaqueY = String(box.y);
                    entry.video.dataset.akariOpaqueW = String(box.w);
                    entry.video.dataset.akariOpaqueH = String(box.h);
                    entry.video.style.pointerEvents = 'auto';
                } else {
                    delete entry.video.dataset.akariOpaqueX;
                    delete entry.video.dataset.akariOpaqueY;
                    delete entry.video.dataset.akariOpaqueW;
                    delete entry.video.dataset.akariOpaqueH;
                    if (entry.spec.kind === 'baked') entry.video.style.pointerEvents = 'none';
                }
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                return box;
            };
            for (const entry of layerEntries) {
                entry.video.addEventListener('loadeddata', () => syncLayerHitRegion(entry, true));
                entry.video.addEventListener('seeked', () => syncLayerHitRegion(entry, true));
            }
            const updateLayerSelectBox = () => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                const engineGeometry = Boolean(frameEngineMediaIdle || window.akari.frameEngineClock);
                const resolveDeclaredSize = (${resolveLayerDeclaredSize.toString()});
                const size = entry && resolveDeclaredSize(entry.video.videoWidth || entry.video.naturalWidth,
                    entry.video.videoHeight || entry.video.naturalHeight, summary.output);
                if (entry && engineGeometry && !entry.selectBoxMetadataBound) {
                    entry.selectBoxMetadataBound = true;
                    entry.video.addEventListener('loadedmetadata', () => {
                        entry.opaqueBox = undefined;
                        updateLayerSelectBox();
                    });
                }
                if (!entry || entry.spec?.proxyMissing || entry.spec?.retiredTelop
                    || !(size.width > 0) || !(size.height > 0)
                    || (typeof allTracksHiddenByScope !== 'undefined'
                        && (allTracksHiddenByScope.layers
                            || hiddenTracksByScope.layers?.has(entry.spec.track)))
                    || (!engineGeometry && !Number.isFinite(entry.spec?.t)
                        && !(entry.video.videoWidth > 0 && entry.video.videoHeight > 0))) {
                    layerSelectBox.classList.remove('is-active');
                    layerSelectBox.classList.remove('akari-selected-invisible');
                    positionLayerCropToggle(null);
                    positionLayerPerspectiveToggle(null);
                    return;
                }
                const inWindow = !Number.isFinite(entry.spec?.t)
                    || outputTime >= entry.spec.t && outputTime < entry.spec.t + entry.spec.duration;
                const motionOpacity = typeof motionAtForSpec === 'function'
                    ? motionAtForSpec(entry.spec, entry.spec.t, entry.spec.duration)?.visible?.opacity : undefined;
                const invisible = !inWindow || (entry.spec.opacity ?? 1) <= 0
                    || (Number.isFinite(motionOpacity) && motionOpacity <= 0);
                const declaredTransform = entry.spec.transform || {};
                const baseScale = Number(declaredTransform.scale) || 1;
                const plainTransform = { x: Number(declaredTransform.x) || 0,
                    y: Number(declaredTransform.y) || 0, scale: baseScale,
                    scaleX: Number(declaredTransform.scaleX) || baseScale,
                    scaleY: Number(declaredTransform.scaleY) || baseScale,
                    rotate: Number(declaredTransform.rotate) || 0 };
                const transform = invisible ? plainTransform
                    : typeof layerVisualTransformNow === 'function'
                        ? layerVisualTransformNow(entry) : layerTransformNow(entry);
                const crop = layerCropNow(entry);
                if (engineGeometry && entry.video.readyState < 2) entry.opaqueBox = undefined;
                if (frameEngineMediaIdle) {
                    // legacy 媒体の画素は読まず、クロップ窓そのものを選択枠にする。
                    entry.opaqueBox = null;
                }
                // 枠は要素の箱ではなく不透明領域（コンテンツ）にフィットさせる（未計測なら計測）。
                // Engine media can remain undecoded: use the crop window until pixels arrive.
                // Legacy media still waits for loadeddata before displaying its alpha bounds.
                if (!invisible && entry.opaqueBox === undefined) {
                    if (entry.video.readyState >= 2) {
                        syncLayerHitRegion(entry);
                    } else if (!engineGeometry && !Number.isFinite(entry.spec?.t)) {
                        layerSelectBox.classList.remove('is-active');
                        entry.video.addEventListener('loadeddata', () => updateLayerSelectBox(), { once: true });
                        return;
                    }
                }
                const naturalBox = entry.opaqueBox || { x: 0, y: 0, w: size.width, h: size.height };
                const boxSource = invisible ? { x: 0, y: 0, w: size.width, h: size.height } : naturalBox;
                // ㉔ クロップ窓（ソース px 空間）と不透明領域の交差 = 実際に見えている範囲。交差が無い
                // （クロップが不透明領域を完全に外した）場合はクロップ窓そのものへフォールバックする。
                const cropBoxPx = {
                    x: crop.x * size.width,
                    y: crop.y * size.height,
                    w: crop.w * size.width,
                    h: crop.h * size.height
                };
                const ix0 = Math.max(boxSource.x, cropBoxPx.x);
                const iy0 = Math.max(boxSource.y, cropBoxPx.y);
                const ix1 = Math.min(boxSource.x + boxSource.w, cropBoxPx.x + cropBoxPx.w);
                const iy1 = Math.min(boxSource.y + boxSource.h, cropBoxPx.y + cropBoxPx.h);
                const cb = (ix1 > ix0 && iy1 > iy0) ? { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 } : cropBoxPx;
                // ピボット（拡縮・回転の基準点）は実際の合成と同じくクロップ矩形の中心
                // （render-cut は crop→scale→rotate→overlay の順で合成し、overlay の中心合わせは
                // crop 後の frame 基準になるため — layers.mjs 参照）。
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * size.width,
                    y: (crop.y + crop.h / 2) * size.height
                };
                const box = layerScreenRectForVideoRect(transform, cb, pivotPx);
                layerSelectBox.style.left = box.left + 'px';
                layerSelectBox.style.top = box.top + 'px';
                layerSelectBox.style.width = box.width + 'px';
                layerSelectBox.style.height = box.height + 'px';
                layerSelectBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                // ハンドルの拡縮・回転ピボット（= クロップ矩形の中心）を箱から逆算するためのオフセット
                layerSelectBox.dataset.akariPivotOffX = String(box.rotOffX);
                layerSelectBox.dataset.akariPivotOffY = String(box.rotOffY);
                layerSelectBox.classList.add('is-active');
                layerSelectBox.classList.toggle('akari-selected-invisible', invisible);
                if (invisible) {
                    positionLayerCropToggle(null);
                    positionLayerPerspectiveToggle(null);
                    return;
                }
                // ホストの浮いたメニューと段の外を避けて、写真の回転・移動ボタンを置く。
                if (typeof previewStage !== 'undefined' && previewStage?.getBoundingClientRect
                    && layerSelectBox.getBoundingClientRect
                    && typeof previewLayerActionsFn === 'function') {
                    const zoomScale = previewStage.getBoundingClientRect().width / previewStage.offsetWidth || 1;
                    const place = previewLayerActionsFn(previewPane.getBoundingClientRect(),
                        layerSelectBox.getBoundingClientRect(), floatingMenuRect, zoomScale);
                    for (const handle of layerHandleElements) {
                        const kind = handle.getAttribute('data-akari-handle');
                        if (kind !== 'rotate' && kind !== 'move') continue;
                        if (!place) continue;
                        const rect = kind === 'rotate' ? place.rotate : place.move;
                        const center = previewChromeLocalPointFn(layerSelectBox.getBoundingClientRect(),
                            { width: layerSelectBox.offsetWidth, height: layerSelectBox.offsetHeight },
                            transform.rotate, zoomScale,
                            { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                        handle.style.top = center.y + 'px';
                        handle.style.left = center.x + 'px';
                    }
                }
                applyCropEdgeVisibility(layerSelectBox, box.width, box.height, true);
                if (!cropModeActive) positionLayerCropToggle(box);
                if (!cropModeActive) positionLayerPerspectiveToggle(box);
                layerPerspectiveToggle.classList.toggle('is-declared', !!layerPerspectiveNow(entry));
            };
            window.addEventListener('message', event => {
                if (event.data?.type !== 'akari-preview-context-menu-rect') return;
                hostMenuRect = event.data.rect;
                updateFloatingMenuRect();
                updateLayerSelectBox();
                updateCutSelectBox();
            });
            window.addEventListener('message', event => {
                if (event.data?.type !== 'akari-preview-context-bar-rect') return;
                floatingBarRect = event.data.rect;
                updateFloatingMenuRect();
                updateLayerSelectBox();
                updateCutSelectBox();
            });
            // クロップトグルボタンは通常枠/クロップ枠のどちらが出ていても常に同じ場所（右上角の外側）
            // に留まり続ける（モード切替のたびに探し直させない）。box=null でレイヤー未選択として隠す。
            const positionLayerCropToggle = box => {
                if (!box) {
                    layerCropToggle.classList.remove('is-target-active');
                    return;
                }
                // 箱の上端が画面上端に近いと「箱の外側・上」が画面外へはみ出す。0 未満にはせず、
                // 収まらないときは箱の内側上端へフォールバックする。
                layerCropToggle.style.left = (box.left + box.width + 4) + 'px';
                layerCropToggle.style.top = Math.max(4, box.top - 26) + 'px';
                layerCropToggle.classList.add('is-target-active');
            };
            // クロップモードのオーバーレイ: 外枠はソースフレーム全体（クロップ無しなら見えていたはずの
            // 範囲）、内枠が現在のクロップ窓。pivot は実合成と同じ「現在のクロップ矩形の中心」を使う
            // （2026-08-06 crop-handle-anchor-fix 以前は全面中心固定の近似だったが、それだと錨補正
            // 後の transform.x/y と噛み合わず外枠が編集中にドリフトして見えるため、実際の合成 pivot
            // と統一した — layerScreenRectForVideoRect の呼び手（updateLayerSelectBox）と同型）。
            const cropGhostTarget = () => {
                if (edgeCropDragActive && edgeCropDragTarget) return edgeCropDragTarget;
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                return entry ? layerDragTarget(entry) : cutSelected ? cutDragTarget() : null;
            };
            const updateLayerCropBox = () => {
                const target = cropGhostTarget();
                const natural = target ? target.naturalSize() : null;
                if ((!cropModeActive && !edgeCropDragActive) || !target || !target.visible()
                    || !(natural.width > 0) || !(natural.height > 0)) {
                    layerCropBox.classList.remove('is-active');
                    return;
                }
                const transform = target.visualNow ? target.visualNow() : target.transformNow();
                const crop = target.cropNow();
                const vw = natural.width;
                const vh = natural.height;
                const pivotPx = { x: (crop.x + crop.w / 2) * vw, y: (crop.y + crop.h / 2) * vh };
                const outer = layerScreenRectForVideoRect(transform, { x: 0, y: 0, w: vw, h: vh }, pivotPx);
                const inner = layerScreenRectForVideoRect(transform, { x: crop.x * vw, y: crop.y * vh, w: crop.w * vw, h: crop.h * vh }, pivotPx);
                layerCropBox.style.left = outer.left + 'px';
                layerCropBox.style.top = outer.top + 'px';
                layerCropBox.style.width = outer.width + 'px';
                layerCropBox.style.height = outer.height + 'px';
                layerCropBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                if (photoCropTarget) {
                    const ghost = document.getElementById('photo-crop-ghost');
                    const frame = photoFrameVisualFn({ crop, sourceWidth: vw, sourceHeight: vh,
                        scaleX: transform.scaleX ?? transform.scale, scaleY: transform.scaleY ?? transform.scale,
                        outputWidth: Number(summary.output?.width) || 1280,
                        outputHeight: Number(summary.output?.height) || 720,
                        x: 0, y: 0, rotate: 0, flip: target.entry?.spec.flip });
                    ghost.style.transformOrigin = ((crop.x + crop.w / 2) * 100) + '% '
                        + ((crop.y + crop.h / 2) * 100) + '%';
                    ghost.style.transform = frame.ghostMatrix;
                }
                layerCropRect.style.left = (inner.left - outer.left) + 'px';
                layerCropRect.style.top = (inner.top - outer.top) + 'px';
                layerCropRect.style.width = inner.width + 'px';
                layerCropRect.style.height = inner.height + 'px';
                layerCropBox.classList.add('is-active');
                if (photoCropTarget) {
                    photoCropPanel.style.left = Math.max(4, Math.min(outer.left,
                        previewStage.clientWidth - photoCropPanel.offsetWidth - 4)) + 'px';
                    photoCropPanel.style.top = Math.max(4, Math.min(outer.top + outer.height + 10,
                        previewStage.clientHeight - photoCropPanel.offsetHeight - 4)) + 'px';
                }
                // ⛶ トグルは layers[] 専用（cut には出さない）。
                if (target.kind === 'layer') positionLayerCropToggle(outer);
            };
            const setCropMode = active => {
                const cancel = cropModeCancelRequested;
                cropModeCancelRequested = false;
                if (cropModeActive && !active && photoCropTarget) {
                    const target = photoCropTarget;
                    const snapshot = photoCropSnapshot;
                    const changed = photoCropDirty;
                    photoCropTarget = null;
                    photoCropSnapshot = null;
                    photoCropDirty = false;
                    photoCropItemId = null;
                    photoCropPanel.classList.remove('is-active');
                    if (cancel) {
                        target.restoreCrop(snapshot.restore);
                        target.flushCrop();
                    } else if (!changed) {
                        target.restoreCrop(snapshot.restore);
                        target.flushCrop();
                    } else if (changed && target.canWrite()) {
                        const finalTransform = target.transformNow();
                        const before = snapshot.transform;
                        const transformPatch = photoCropTransformPatchFn(before, finalTransform);
                        const gesture = beginSelectionGesture(target);
                        void target.write({ crop: target.cropNow(),
                            ...(Object.keys(transformPatch).length ? { transform: transformPatch } : {}) })
                            .then(() => window.akari.reportGesture('saved'))
                            .catch(error => {
                                window.akari.showWriteError(error);
                                if (selectionGestureIsLatest(gesture)) {
                                    target.restoreCrop(snapshot.restore);
                                    target.flushCrop();
                                }
                            }).finally(() => endSelectionGesture(gesture));
                    } else if (changed) {
                        target.restoreCrop(snapshot.restore);
                        target.flushCrop();
                        window.akari.showWriteError('切り抜きを保存できませんでした。対象を選び直してください。');
                    }
                }
                cropModeActive = !!(active && (selectedLayerId || cutSelected));
                if (cropModeActive && !selectedLayerId && !cutCropEditable()) cropModeActive = false;
                if (cropModeActive && !photoCropTarget) {
                    const entry = findLayerEntry(selectedLayerId);
                    const src = String(entry?.spec.src || '');
                    const cutSourceId = !entry && cutSelected ? cutInteractionSegment()?.src : null;
                    const cutImageUrl = cutSourceId ? (initial.imageSources || {})[cutSourceId] : null;
                    if (entry?.spec.isImage === true || (cutImageUrl && cutCropEditable())) {
                        photoCropTarget = entry ? layerDragTarget(entry) : cutDragTarget();
                        photoCropItemId = entry ? entry.spec.id : cutSelectionVideo().dataset.akariCutId;
                        photoCropSnapshot = { restore: photoCropTarget.cropRestorePoint(),
                            transform: photoCropTarget.transformNow() };
                        photoCropDirty = false;
                        photoCropRotate.value = String(photoCropTarget.cropNow().rotate || 0);
                        document.getElementById('photo-crop-ghost').src = src || cutImageUrl;
                        photoCropRatio.value = 'free';
                        photoCropStatus.textContent = '';
                        photoCropPanel.classList.add('is-active');
                        if (photoCropTarget.kind === 'cut') {
                            const natural = photoCropTarget.naturalSize();
                            if (natural.width > 0 && natural.height > 0) {
                                photoCropTarget.applyCropAndTransform(photoCropTarget.cropNow(),
                                    photoCropTarget.cropEntryTransform(photoCropTarget.transformNow(), natural));
                                photoCropTarget.flushCrop();
                            }
                        }
                    }
                }
                // ㉖ クロップモードとパースパネルは排他（ハンドル/操作の衝突を避ける）。
                if (cropModeActive && perspectivePanelOpen) setPerspectivePanelOpen(false);
                layerCropToggle.classList.toggle('is-crop-mode', cropModeActive);
                layerCropBox.classList.toggle('is-photo-crop', Boolean(photoCropTarget));
                layerSelectBox.classList.toggle('akari-crop-mode-hide-handles', cropModeActive);
                cutSelectBox.classList.toggle('akari-crop-mode-hide-handles', cropModeActive && !selectedLayerId);
                if (cropModeActive) {
                    updateLayerCropBox();
                } else {
                    layerCropBox.classList.remove('is-active');
                    updateLayerSelectBox();
                }
            };
            const cancelCropMode = () => { cropModeCancelRequested = true; setCropMode(false); };
            // click ではなく pointerdown+pointerup（setPointerCapture 付き）で拾う — 再生中は毎フレーム
            // positionLayerCropToggle が呼ばれてボタンが数 px 動くため、down/up の間にボタンが動くと
            // click イベントの合成対象がズレて発火しなくなることがある（実マウス操作で再現・
            // 実測確認済み）。ドラッグハンドルと同じ pointer capture 方式にして確実に拾う。
            layerCropToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerCropToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerCropToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setCropMode(!cropModeActive);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && cropModeActive) cancelCropMode();
                if (event.key === 'Enter' && cropModeActive && photoCropTarget) {
                    if (document.activeElement === photoCropRotate
                        && Number(photoCropRotate.value) !== (photoCropTarget.cropNow().rotate || 0)) {
                        photoCropRotate.dispatchEvent(new Event('change'));
                    }
                    setCropMode(false);
                }
            });
            // ㉖ layers[].perspective（v0）: 常に同じ場所（クロップトグルの下）に留まるトグル + パネル。
            // box=null でレイヤー未選択として隠す（クロップトグルと同じ規律）。
            const positionLayerPerspectiveToggle = box => {
                if (!box) {
                    layerPerspectiveToggle.classList.remove('is-target-active');
                    if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                    return;
                }
                layerPerspectiveToggle.style.left = (box.left + box.width + 4) + 'px';
                layerPerspectiveToggle.style.top = Math.max(4, box.top - 26) + 26 + 4 + 'px';
                layerPerspectiveToggle.classList.add('is-target-active');
                if (perspectivePanelOpen) {
                    layerPerspectivePanel.style.left = layerPerspectiveToggle.style.left;
                    layerPerspectivePanel.style.top = (parseFloat(layerPerspectiveToggle.style.top) + 26 + 4) + 'px';
                }
            };
            const layerPerspectiveNow = entry => {
                const raw = entry.video.dataset.akariPerspectiveCorners;
                if (!raw) return null;
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
                } catch (_error) {
                    return null;
                }
            };
            const applyLayerPerspectiveNow = (entry, corners) => {
                if (corners) entry.video.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete entry.video.dataset.akariPerspectiveCorners;
                layerPerspectiveToggle.classList.toggle('is-declared', !!corners);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                const previewCorners = corners || [[0, 0], [1, 0], [0, 1], [1, 1]];
                for (const [index, corner] of ['tl', 'tr', 'bl', 'br'].entries()) {
                    for (const [axisIndex, axis] of ['x', 'y'].entries()) {
                        window.akari.frameEngineClock?.applyLivePreview?.({
                            target: { kind: 'layer', id: entry.spec.id },
                            field: 'perspective.' + corner + '.' + axis,
                            value: previewCorners[index][axisIndex]
                        });
                    }
                }
            };
            // プリセット→4隅の展開（v0）。SSOT は保存される4隅のみ — このツマミはオーサリング側の
            // 便宜であり、schema には「プリセット」「角度」という概念自体は存在しない
            // (contract-2026-08-02-preview-parity.md §2.4.4)。奥行き感は sin(角度) で圧縮量を決め、
            // 該当する辺の中点方向へ両端点を寄せる（角度0=無変形、角度が大きいほど強い台形）。
            const perspectivePresetCorners = (preset, angleDeg) => {
                const compression = Math.max(0, Math.min(0.9, Math.sin((Number(angleDeg) || 0) * Math.PI / 180)));
                const half = compression / 2;
                if (preset === 'right') return [[0, 0], [1, half], [0, 1], [1, 1 - half]];
                if (preset === 'left') return [[0, half], [1, 0], [0, 1 - half], [1, 1]];
                if (preset === 'top') return [[half, 0], [1 - half, 0], [0, 1], [1, 1]];
                if (preset === 'bottom') return [[0, 0], [1, 0], [half, 1], [1 - half, 1]];
                return null;
            };
            const commitLayerPerspective = async (entry, corners, original = layerPerspectiveNow(entry)) => {
                applyLayerPerspectiveNow(entry, corners);
                try {
                    await window.akari.engine.layerWrite(entry.spec.id, { perspective: corners ? { corners } : null });
                } catch (error) {
                    window.akari.showWriteError(error);
                    applyLayerPerspectiveNow(entry, original);
                }
            };
            const setPerspectivePanelOpen = open => {
                perspectivePanelOpen = !!(open && selectedLayerId);
                layerPerspectiveToggle.classList.toggle('is-panel-open', perspectivePanelOpen);
                layerPerspectivePanel.classList.toggle('is-open', perspectivePanelOpen);
                if (perspectivePanelOpen) {
                    if (cropModeActive) setCropMode(false);
                    updateLayerSelectBox();
                }
            };
            layerPerspectiveToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setPerspectivePanelOpen(!perspectivePanelOpen);
            });
            for (const button of layerPerspectivePresetButtons) {
                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try { button.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
                });
                button.addEventListener('pointerup', event => {
                    event.stopPropagation();
                    if (!selectedLayerId) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const preset = button.getAttribute('data-akari-perspective-preset');
                    perspectiveSliderOriginal = null;
                    activePerspectivePreset = preset;
                    for (const other of layerPerspectivePresetButtons) other.classList.toggle('is-active', other === button);
                    const corners = perspectivePresetCorners(preset, layerPerspectiveAngleInput.value);
                    void commitLayerPerspective(entry, corners);
                });
            }
            layerPerspectiveAngleInput.addEventListener('input', () => {
                layerPerspectiveAngleValueEl.textContent = layerPerspectiveAngleInput.value + '°';
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                if (!perspectiveSliderOriginal || perspectiveSliderOriginal.id !== entry.spec.id) {
                    perspectiveSliderOriginal = { id: entry.spec.id, corners: layerPerspectiveNow(entry) };
                }
                // ライブプレビューのみ（書き戻しはしない） -- ドラッグ中に毎回 lint/書き込みを
                // 往復させないため、既存の crop ハンドルと同じ「確定時のみ書き戻す」規律に倣う。
                applyLayerPerspectiveNow(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
            });
            layerPerspectiveAngleInput.addEventListener('change', () => {
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                const original = perspectiveSliderOriginal?.id === entry.spec.id
                    ? perspectiveSliderOriginal.corners : layerPerspectiveNow(entry);
                perspectiveSliderOriginal = null;
                void commitLayerPerspective(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value), original);
            });
            layerPerspectiveClearButton.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveClearButton.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveClearButton.addEventListener('pointerup', event => {
                event.stopPropagation();
                if (!selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                perspectiveSliderOriginal = null;
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                void commitLayerPerspective(entry, null);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && perspectivePanelOpen) setPerspectivePanelOpen(false);
            });
            const selectLayer = (layerId, options) => {
                const report = !options || options.report !== false;
                if (report && typeof selectedMixedGroup !== 'undefined') selectedMixedGroup = [];
                const nextId = layerId && findLayerEntry(layerId) ? layerId : null;
                if (nextId && cropModeActive && photoCropTarget?.kind === 'cut') setCropMode(false);
                if (nextId && !(typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection)) { requestedCutId = undefined; requestedOverlayId = null; window.akari.interaction?.clearSelection?.(); }
                if (nextId === selectedLayerId) {
                    updateLayerSelectBox();
                    if (report) window.akari.reportLayerSelection(selectedLayerId);
                    return;
                }
                if (cropModeActive) setCropMode(false);
                if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                selectedLayerId = nextId;
                // ㉓ 選択の排他制御: layer を選ぶと cut/caption 選択は外れる（逆方向はそれぞれの select 側）。
                if (nextId && typeof deselectCut === 'function') deselectCut({ report: false });
                if (nextId && !(typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection) && typeof deselectCaption === 'function') deselectCaption({ report: false });
                if (nextId) {
                    const measured = findLayerEntry(nextId);
                    // 選択時点のフレームで測り直す（updateLayerSelectBox が遅延計測する）
                    if (measured) measured.opaqueBox = undefined;
                }
                updateLayerSelectBox();
                if (report) window.akari.reportLayerSelection(selectedLayerId);
            };
            const photoBrushMapPoint = (stage, geometry) => {
                const { output, image, crop, transform, flip } = geometry;
                if (!(image.width > 0 && image.height > 0 && crop.w > 0 && crop.h > 0)) return null;
                const dx = stage.x - output.width / 2 - (transform.x || 0);
                const dy = stage.y - output.height / 2 - (transform.y || 0);
                const rad = -(transform.rotate || 0) * Math.PI / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                const sx = transform.scaleX || transform.scale || 1;
                const sy = transform.scaleY || transform.scale || 1;
                if (!(sx > 0 && sy > 0)) return null;
                const localX = rx / sx / image.width;
                const localY = ry / sy / image.height;
                if (Math.abs(localX) > crop.w / 2 || Math.abs(localY) > crop.h / 2) return null;
                const px = (flip?.h ? -localX : localX) * image.width;
                const py = (flip?.v ? -localY : localY) * image.height;
                const angle = (crop.rotate || 0) * Math.PI / 180;
                const sourceX = crop.x + crop.w / 2 + (Math.cos(angle) * px + Math.sin(angle) * py) / image.width;
                const sourceY = crop.y + crop.h / 2 + (-Math.sin(angle) * px + Math.cos(angle) * py) / image.height;
                if (sourceX < 0 || sourceX > 1 || sourceY < 0 || sourceY > 1) return null;
                return [sourceX, sourceY];
            };
            let photoBrush = null;
            let photoSelect = null;
            let photoHoverLastMs = 0;
            let photoHighlightCanvas = null;
            let photoStroke = null;
            let photoBrushStatus = null;
            let photoBrushCursor = null;
            const ensurePhotoBrushUi = () => {
                if (photoBrushStatus || typeof document === 'undefined' || typeof previewStage === 'undefined') return;
                photoBrushStatus = document.createElement('div');
                photoBrushStatus.className = 'akari-photo-brush-status';
                photoBrushStatus.textContent = '消しゴム中 — Esc で終わる';
                photoBrushStatus.hidden = true;
                previewStage.appendChild(photoBrushStatus);
                photoBrushCursor = document.createElement('div');
                photoBrushCursor.className = 'akari-photo-brush-cursor';
                photoBrushCursor.hidden = true;
                document.body.appendChild(photoBrushCursor);
            };
            const hidePhotoBrushUi = () => {
                if (photoBrushStatus) photoBrushStatus.hidden = true;
                if (photoBrushCursor) photoBrushCursor.hidden = true;
            };
            const updatePhotoBrushCursor = event => {
                if (!photoBrushCursor) return;
                const entry = photoBrush && findLayerEntry(photoBrush.itemId);
                const point = photoBrush && photoBrushPoint(event);
                photoBrushCursor.hidden = !point;
                if (!point || !entry) return;
                const width = entry.video.naturalWidth || entry.video.videoWidth;
                const height = entry.video.naturalHeight || entry.video.videoHeight;
                const transform = layerTransformNow(entry);
                const scale = Math.max(transform.scaleX ?? transform.scale ?? 1,
                    transform.scaleY ?? transform.scale ?? 1);
                const diameter = Math.max(2, photoBrush.size * Math.min(width, height)
                    * scale * (window.akari.stageScale() || 1) * zoom);
                photoBrushCursor.style.width = diameter + 'px';
                photoBrushCursor.style.height = diameter + 'px';
                photoBrushCursor.style.left = event.clientX + 'px';
                photoBrushCursor.style.top = event.clientY + 'px';
            };
            const photoBrushPoint = event => {
                const entry = (photoBrush || photoSelect) && findLayerEntry((photoBrush || photoSelect).itemId);
                const stagePoint = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                if (!entry || !stagePoint) return null;
                const width = entry.video.naturalWidth || entry.video.videoWidth;
                const height = entry.video.naturalHeight || entry.video.videoHeight;
                if (!(width > 0 && height > 0)) return null;
                return photoBrushMapPoint(stagePoint, {
                    output: summary.output, image: { width, height },
                    crop: layerCropNow(entry),
                    transform: {
                        x: Number(entry.video.dataset.akariTransformX) || 0,
                        y: Number(entry.video.dataset.akariTransformY) || 0,
                        scaleX: Number(entry.video.dataset.akariTransformScaleX) || 1,
                        scaleY: Number(entry.video.dataset.akariTransformScaleY) || 1,
                        rotate: Number(entry.video.dataset.akariTransformRotate) || 0
                    },
                    flip: entry.spec.flip
                });
            };
            if (typeof window.addEventListener === 'function' && typeof layerSelectBox !== 'undefined' && layerSelectBox?.addEventListener) {
            window.addEventListener('message', event => {
                const message = event.data;
                if (message?.type === 'akari-preview-photo-highlight') {
                    photoHighlightCanvas?.remove(); photoHighlightCanvas = null;
                    const layerEntry = findLayerEntry(message.itemId);
                    if (!message.png || (!layerEntry
                        && cutSelectionVideo().dataset.akariCutId !== message.itemId)) return;
                    const targetBox = layerEntry ? layerSelectBox : cutSelectBox;
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(targetBox.clientWidth));
                    canvas.height = Math.max(1, Math.round(targetBox.clientHeight));
                    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.5';
                    targetBox.appendChild(canvas); photoHighlightCanvas = canvas;
                    const image = new Image(); image.onload = () => {
                        if (photoHighlightCanvas !== canvas) return;
                        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return;
                        const crop = layerEntry ? layerCropNow(layerEntry) : cutCropNow();
                        const flip = layerEntry?.spec.flip;
                        context.save();
                        if (flip?.h || flip?.v) {
                            context.translate(flip.h ? canvas.width : 0, flip.v ? canvas.height : 0);
                            context.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
                        }
                        context.drawImage(image, crop.x * image.width, crop.y * image.height,
                            crop.w * image.width, crop.h * image.height, 0, 0, canvas.width, canvas.height);
                        context.restore();
                        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
                        for (let i = 0; i < pixels.data.length; i += 4) {
                            const coverage = pixels.data[i];
                            pixels.data[i] = 255; pixels.data[i + 1] = 196; pixels.data[i + 2] = 64;
                            pixels.data[i + 3] = Math.round(coverage * .6);
                        }
                        context.putImageData(pixels, 0, 0);
                    };
                    image.src = 'data:image/png;base64,' + message.png;
                    return;
                }
                if (message?.type === 'akari-preview-photo-select') {
                    const layer = findLayerEntry(message.itemId);
                    const cut = cutSelectionVideo().dataset.akariCutId === message.itemId;
                    if (photoBrush) window.akari.reportPhotoBrushEnd?.();
                    photoBrush = null;
                    hidePhotoBrushUi();
                    layerSelectBox.classList.remove('akari-photo-pointer-mode');
                    cutSelectBox.classList.remove('akari-photo-pointer-mode');
                    photoSelect = layer || cut ? { itemId: message.itemId } : null;
                    if (photoSelect) {
                        if (layer) selectLayer(message.itemId); else selectCut();
                        const targetBox = layer ? layerSelectBox : cutSelectBox;
                        targetBox.classList.add('akari-photo-pointer-mode');
                        targetBox.style.cursor = 'crosshair';
                        targetBox.title = '残したいものを押してください。Esc で終わります';
                    }
                    return;
                }
                if (message?.type === 'akari-preview-photo-select-stop') {
                    if (photoSelect?.itemId === message.itemId) photoSelect = null;
                    layerSelectBox.classList.toggle('akari-photo-pointer-mode', Boolean(photoBrush));
                    cutSelectBox.classList.remove('akari-photo-pointer-mode');
                    layerSelectBox.style.cursor = photoBrush ? 'crosshair' : '';
                    layerSelectBox.title = photoBrush ? 'なぞって編集します。Esc で終わります' : '';
                    cutSelectBox.style.cursor = ''; cutSelectBox.title = '';
                    photoHighlightCanvas?.remove(); photoHighlightCanvas = null;
                    return;
                }
                if (message?.type !== 'akari-preview-photo-brush') return;
                if (!message.settings) {
                    photoBrush = null;
                    photoStroke = null;
                    hidePhotoBrushUi();
                    layerSelectBox.classList.remove('akari-photo-pointer-mode');
                    layerSelectBox.style.cursor = '';
                    layerSelectBox.title = '';
                    return;
                }
                if (!findLayerEntry(message.itemId)) return;
                ensurePhotoBrushUi();
                selectLayer(message.itemId);
                photoSelect = null;
                cutSelectBox.classList.remove('akari-photo-pointer-mode');
                photoBrush = { itemId: message.itemId, ...message.settings };
                if (photoBrushStatus) photoBrushStatus.hidden = false;
                layerSelectBox.classList.add('akari-photo-pointer-mode');
                layerSelectBox.style.cursor = 'none';
                layerSelectBox.title = '';
            });
            window.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || (!photoBrush && !photoSelect)) return;
                const selectedId = photoSelect?.itemId;
                photoBrush = null;
                photoSelect = null;
                photoStroke = null;
                hidePhotoBrushUi();
                layerSelectBox.classList.remove('akari-photo-pointer-mode');
                cutSelectBox.classList.remove('akari-photo-pointer-mode');
                layerSelectBox.style.cursor = '';
                layerSelectBox.title = '';
                cutSelectBox.style.cursor = '';
                cutSelectBox.title = '';
                if (selectedId) window.akari.reportPhotoSelectEnd(selectedId);
                window.akari.reportPhotoBrushEnd?.();
            });
            layerSelectBox.addEventListener('pointerdown', event => {
                if (photoSelect && event.button === 0) {
                    const point = photoBrushPoint(event);
                    if (point) {
                        event.preventDefault(); event.stopImmediatePropagation();
                        window.akari.reportPhotoClick(photoSelect.itemId, point);
                    }
                    return;
                }
                if (!photoBrush || event.button !== 0) return;
                const point = photoBrushPoint(event);
                if (!point) return;
                event.preventDefault(); event.stopImmediatePropagation();
                layerSelectBox.setPointerCapture(event.pointerId);
                photoStroke = { pointerId: event.pointerId, points: [point] };
            }, true);
            layerSelectBox.addEventListener('pointermove', event => {
                if (photoBrush) updatePhotoBrushCursor(event);
                if (photoSelect && findLayerEntry(photoSelect.itemId) && performance.now() - photoHoverLastMs >= 32) {
                    photoHoverLastMs = performance.now();
                    window.akari.reportPhotoHover(photoSelect.itemId, photoBrushPoint(event));
                }
                if (!photoStroke || event.pointerId !== photoStroke.pointerId) return;
                event.preventDefault(); event.stopImmediatePropagation();
                const point = photoBrushPoint(event);
                if (point) photoStroke.points.push(point);
            }, true);
            layerSelectBox.addEventListener('pointerup', event => {
                if (!photoStroke || event.pointerId !== photoStroke.pointerId || !photoBrush) return;
                event.preventDefault(); event.stopImmediatePropagation();
                const point = photoBrushPoint(event);
                if (point) photoStroke.points.push(point);
                const points = photoStroke.points;
                const reduced = points.length <= 100 ? points : Array.from({ length: 100 }, (_unused, index) =>
                    points[Math.round(index * (points.length - 1) / 99)]);
                window.akari.reportPhotoStroke(photoBrush.itemId, { mode: photoBrush.mode, points: reduced,
                    size: photoBrush.size, hardness: photoBrush.hardness });
                photoStroke = null;
            }, true);
            layerSelectBox.addEventListener('pointercancel', () => { photoStroke = null; }, true);
            layerSelectBox.addEventListener('pointerleave', () => {
                if (photoBrushCursor) photoBrushCursor.hidden = true;
                if (photoSelect && findLayerEntry(photoSelect.itemId)) window.akari.reportPhotoHover(photoSelect.itemId, null);
            });
            }
            // ㉒ スナップ統一: layers[]（この後 cut/caption も同型）の移動・拡縮を、
            // interaction.js（overlay-runtime、overlays[] 用スナップの単一正本）が公開する
            // computeSnapCorrection/stageLocalPoint/showSnapGuides/hideSnapGuides へ委譲する。
            // 出力px（video座標）系の bounds を渡すだけで、キャンバス外周+5%セーフマージン+
            // センター縦横・8px吸着/12px解除（表示px基準=ズーム下でも見た目8px相当）・
            // ガイド線が overlays[] と完全に同一挙動になる（旧実装は resize/layers[] とも
            // スナップ皆無だった）。
            const outputBoundsForCenteredBox = (centerX, centerY, boxWidth, boxHeight) => ({
                left: centerX - boxWidth / 2,
                right: centerX + boxWidth / 2,
                top: centerY - boxHeight / 2,
                bottom: centerY + boxHeight / 2,
                centerX,
                centerY
            });
            const cutResizeCornersFn = (${cutResizeCorners.toString()});
            const cutResizeScaleFn = (${cutResizeScale.toString()});
            const layerOutputBoundsForTransform = (entry, transform) => {
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const videoWidth = entry.video.videoWidth || entry.video.naturalWidth;
                const videoHeight = entry.video.videoHeight || entry.video.naturalHeight;
                const width = videoWidth > 0 && videoHeight > 0 ? videoWidth : outputWidth;
                const height = videoWidth > 0 && videoHeight > 0 ? videoHeight : outputHeight;
                const crop = layerCropNow(entry);
                // 選択枠と同じソース矩形を使う。透明余白を含む素材でも、枠の辺が吸着点になる。
                const naturalBox = entry.opaqueBox || { x: 0, y: 0, w: width, h: height };
                const cropBoxPx = { x: crop.x * width, y: crop.y * height,
                    w: crop.w * width, h: crop.h * height };
                const ix0 = Math.max(naturalBox.x, cropBoxPx.x);
                const iy0 = Math.max(naturalBox.y, cropBoxPx.y);
                const ix1 = Math.min(naturalBox.x + naturalBox.w, cropBoxPx.x + cropBoxPx.w);
                const iy1 = Math.min(naturalBox.y + naturalBox.h, cropBoxPx.y + cropBoxPx.h);
                if (!(ix1 > ix0 && iy1 > iy0)) return null;
                const cb = { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 };
                const pivotPx = { x: (crop.x + crop.w / 2) * width,
                    y: (crop.y + crop.h / 2) * height };
                const box = layerScreenRectForVideoRect(transform, cb, pivotPx);
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const left = (box.left - frameRect.x) / frameScale;
                const top = (box.top - frameRect.y) / frameScale;
                const boxWidth = box.width / frameScale;
                const boxHeight = box.height / frameScale;
                return { left, right: left + boxWidth, top, bottom: top + boxHeight,
                    centerX: left + boxWidth / 2, centerY: top + boxHeight / 2 };
            };
            // 裁定 0: 移動 / 角点 / 回転の確定書き戻しは cut と layer で 1 本。対象の違い
            // （dataset の読み書き先・layerWrite / cutWrite・RAF throttle）は記述子が持つ。
            // CF-write: 確定 → 失敗時は元の値へ視覚的に巻き戻す（既存 overlay 編集と同じ規約）。
            const beginMediaTransformDrag = (target, startEvent, computeTransform) => {
                if (selectionDragActive) return;
                // ロック中（edit.json の locked）は動かさない（preview-context-bar-page.ts が id を持つ）
                if (target.kind === 'layer' ? window.akari.lockedIds?.has(String(target.entry?.spec?.id))
                    : window.akari.contextSelectedLocked) return;
                if (isPlaying) togglePlayback();
                startEvent.preventDefault();
                startEvent.stopPropagation();
                const gesture = beginSelectionGesture(target);
                selectionDragActive = true;
                document.body.classList.add('akari-selection-gesture-active');
                const pointerId = startEvent.pointerId;
                const original = target.transformNow();
                let latestTransform = original;
                const captureTarget = startEvent.currentTarget;
                const handleKind = captureTarget?.getAttribute?.('data-akari-handle')
                    || captureTarget?.getAttribute?.('data-akari-crop-edge');
                const duplicating = startEvent.altKey && (!handleKind || handleKind === 'move');
                const rotating = handleKind === 'rotate';
                const positionOnly = !rotating && (handleKind === 'move' || !handleKind);
                let motion = positionOnly && typeof target.motionAt === 'function' ? target.motionAt() : null;
                if (motion && !motion.item.keyframes?.length) {
                    // 保存済みモデルの到着前でも、次のドラッグは表示中の位置から始める。
                    const liveItem = previewMotionLiveItemFn(motion.item, original);
                    motion = { ...motion, item: liveItem, visible: window.akari.itemMotion.evaluateItemMotion(
                        liveItem, motion.time, motion.parents) };
                } else if (motion && positionOnly && target.visualNow) {
                    // Keyframed items use the pose currently on screen as the next grab's
                    // origin; their cached spec can lag behind a previous pending write.
                    const live = target.visualNow();
                    motion = { ...motion, visible: { ...motion.visible, x: live.x, y: live.y } };
                }
                const movingControls = rotating || handleKind === 'move' || !handleKind;
                const gestureLabel = document.createElement('div');
                gestureLabel.className = rotating ? 'akari-interaction-angle' : 'akari-interaction-hint';
                gestureLabel.setAttribute('data-akari-interaction', rotating ? 'rotation-angle' : 'handle-hint');
                gestureLabel.textContent = rotating ? '回転'
                    : ['n', 'e', 's', 'w'].includes(handleKind) ? '切り取る'
                    : ['nw', 'ne', 'sw', 'se'].includes(handleKind) ? '大きさ' : '移動';
                gestureLabel.style.left = startEvent.clientX + 12 + 'px';
                gestureLabel.style.top = startEvent.clientY + 12 + 'px';
                document.body.appendChild(gestureLabel);
                document.body.classList.add('akari-media-transforming');
                if (movingControls) document.body.classList.add('akari-media-moving');
                let moved = false;
                let cancelled = false;
                let finished = false;
                let settleTimer = null;
                const clearSettleTimer = () => {
                    if (settleTimer !== null && typeof clearTimeout === 'function') clearTimeout(settleTimer);
                    settleTimer = null;
                };
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const cleanup = () => {
                    selectionDragActive = false;
                    document.body.classList.remove('akari-selection-gesture-active');
                    clearSettleTimer();
                    document.body.classList.remove('akari-media-transforming');
                    document.body.classList.remove('akari-media-moving');
                    gestureLabel.remove();
                    document.body.style.cursor = '';
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    window.akari.interaction?.hideSnapGuides?.();
                };
                const onMove = (moveEvent, settled = false) => {
                    if (finished || moveEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    const dx = moveEvent.clientX - startEvent.clientX;
                    const dy = moveEvent.clientY - startEvent.clientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    latestTransform = computeTransform(moveEvent, original);
                    let previewPatch;
                    let visiblePosition;
                    if (positionOnly && motion) {
                        const movedPosition = window.akari.itemMotion.dragItemMotionPosition(motion.item, motion.time,
                            motion.parents, motion.visible, latestTransform.x - original.x, latestTransform.y - original.y);
                        latestTransform = { ...original, x: movedPosition.base.x, y: movedPosition.base.y };
                        previewPatch = movedPosition.base;
                        visiblePosition = movedPosition.visible;
                    }
                    if (rotating) {
                        gestureLabel.textContent = Math.round(window.akariHandleGeometry?.normalizeAngle(
                            latestTransform.rotate) ?? latestTransform.rotate) + '°';
                        gestureLabel.style.left = moveEvent.clientX + 15 + 'px';
                        gestureLabel.style.top = moveEvent.clientY + 17 + 'px';
                        const box = captureTarget.closest('#layer-select-box, #cut-select-box')?.getBoundingClientRect();
                        const tangent = box ? Math.atan2(moveEvent.clientY - (box.top + box.height / 2),
                            moveEvent.clientX - (box.left + box.width / 2)) * 180 / Math.PI + 90 : 0;
                        const cursor = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
                            + '<g transform="rotate(' + Math.round(tangent) + ' 16 16)" fill="none" stroke="white" stroke-width="2">'
                            + '<path d="M5 16a11 11 0 0 1 19-7m3 7a11 11 0 0 1-19 7"/>'
                            + '<path d="m21 8 4 1-1-4M11 24l-4-1 1 4"/></g></svg>';
                        document.body.style.cursor = 'url("data:image/svg+xml,' + encodeURIComponent(cursor)
                            + '") 16 16, crosshair';
                    }
                    target.applyTransform(latestTransform, previewPatch, visiblePosition);
                    if (positionOnly && !settled && typeof setTimeout === 'function') {
                        // 停止後は pointermove が来ないため、同じ座標を再評価して速度だけ減衰させる。
                        settleTimer = setTimeout(() => {
                            settleTimer = null;
                            if (!finished && !cancelled) onMove(moveEvent, true);
                        }, 96);
                    }
                };
                const finish = async () => {
                    if (finished) return;
                    finished = true;
                    try {
                        cleanup();
                        if (cancelled) {
                            target.applyTransform(original, positionOnly ? { x: original.x, y: original.y } : undefined);
                            // ドラッグ終了時に最終値が必ず反映されるよう、次の RAF を待たず今すぐ描画する。
                            target.flushTransform();
                            return;
                        }
                        if (!moved) return;
                        target.flushTransform();
                        // 書き戻し先を特定できない場合は理由を示して元へ戻す。
                        if (!target.canWrite()) {
                            window.akari.showWriteError('変更を保存できませんでした。対象を選択し直してください。');
                            target.applyTransform(original, positionOnly ? { x: original.x, y: original.y } : undefined);
                            target.flushTransform();
                            return;
                        }
                        const finalTransform = latestTransform;
                        try {
                            if (duplicating) {
                                const itemId = target.kind === 'layer' ? target.entry.spec.id
                                    : cutSelectionVideo().dataset.akariCutId;
                                if (!itemId) throw new Error('複製する要素が見つかりません');
                                await window.akari.engine.overlayWrite(null, itemId,
                                    { transform: finalTransform, duplicate: true });
                                target.applyTransform(original, positionOnly ? { x: original.x, y: original.y } : undefined);
                                target.flushTransform();
                            } else if (positionOnly && motion) await target.write({ transform: {
                                x: finalTransform.x, y: finalTransform.y } });
                            else await target.write({ transform: finalTransform });
                            window.akari.reportGesture('saved');
                        } catch (error) {
                            window.akari.showWriteError(error);
                            if (selectionGestureIsLatest(gesture)) {
                                target.applyTransform(original, positionOnly ? { x: original.x, y: original.y } : undefined);
                                target.flushTransform();
                            }
                        }
                    } finally {
                        // 保存応答（または巻き戻し）まで DOM と refresh の保護を維持する。
                        endSelectionGesture(gesture);
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    onMove(upEvent, true);
                    void finish();
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    cancelled = true;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
            };
            const pointerTranslationFrom = startEvent => {
                let lastX = startEvent.clientX, lastY = startEvent.clientY, x = 0, y = 0;
                return event => {
                    // 前回点と今回点を同じフレームの実測（stageLocalPoint）で出力座標へ直して差を取る。
                    // キャッシュした倍率はズーム・全画面・ステージのアニメーション中に古く、素材が跳ぶ。
                    const toStage = window.akari.interaction?.stageLocalPoint;
                    const current = toStage?.(event.clientX, event.clientY);
                    const previous = toStage?.(lastX, lastY);
                    if (current && previous) {
                        x += current.x - previous.x;
                        y += current.y - previous.y;
                    } else {
                        const scale = (window.akari.stageScale() || 1) * zoom;
                        x += (event.clientX - lastX) / scale;
                        y += (event.clientY - lastY) / scale;
                    }
                    lastX = event.clientX; lastY = event.clientY;
                    return { x, y };
                };
            };
            const beginLayerMoveDrag = (entry, startEvent) => {
                const translate = pointerTranslationFrom(startEvent);
                let dragSnap = { x: null, y: null };
                beginMediaTransformDrag(layerDragTarget(entry), startEvent, (moveEvent, original) => {
                    const movement = translate(moveEvent);
                    if (moveEvent.shiftKey) {
                        if (Math.abs(movement.x) >= Math.abs(movement.y)) movement.y = 0;
                        else movement.x = 0;
                    }
                    let nextX = original.x + movement.x;
                    let nextY = original.y + movement.y;
                    if (moveEvent.metaKey || moveEvent.ctrlKey || !window.akari.interaction) {
                        dragSnap = { x: null, y: null };
                        window.akari.interaction?.hideSnapGuides?.();
                    } else {
                        const visual = previewMotionGeometryTransformFn(original,
                            motionAtForSpec(entry.spec, entry.spec.t, entry.spec.duration, original)?.visible);
                        const bounds = layerOutputBoundsForTransform(entry, { ...visual,
                            x: visual.x + nextX - original.x, y: visual.y + nextY - original.y });
                        const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap,
                            { kind: 'layer', id: entry.spec.id });
                        dragSnap = snap;
                        if (snap.x) nextX += snap.x.correction;
                        if (snap.y) nextY += snap.y.correction;
                        window.akari.interaction.showSnapGuides(snap.x, snap.y);
                    }
                    return { ...original, x: nextX, y: nextY };
                });
            };
            // 選択済みレイヤーは描画画素ではなく選択枠を操作面にする。枠が非表示の未選択時は
            // 従来どおり media 要素の clip-path / alpha hit test だけが選択を決める。
            layerSelectBox.addEventListener('pointerdown', event => {
                if ((typeof motionDraw !== 'undefined' && motionDraw) || event.button !== 0 || event.target !== layerSelectBox || !selectedLayerId
                    || cropModeActive) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                beginLayerMoveDrag(entry, event);
            });
            const cutSegmentAtOutputTime = () => frontmostPreviewHitFn(segments
                .filter(segment => segment.kind === 'src' && Number.isInteger(segment.cutIndex)
                    && outputTime >= segment.outStart && outputTime < segment.outEnd)
                .map((segment, order) => ({ element: segment,
                    z: zForItem(segment.id, zForTrack(segment.trackId)), order })));
            const findVisualMediaHitAt = event => {
                const sourcePoint = typeof previewPhotoSourcePointFn === 'function' ? previewPhotoSourcePointFn : null;
                const stagePoint = sourcePoint
                    ? window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY) || null : null;
                if (frameEngineMediaIdle || window.akari.frameEngineClock) {
                    // Media and DOM overlays share the same track z order, including hit testing.
                    const hits = [];
                    const declaredSize = typeof summary === 'undefined' ? null : summary.output;
                    let order = 0;
                    for (const entry of layerEntries) {
                        if (entry.spec?.proxyMissing || entry.spec?.retiredTelop
                            || entry.video.style.visibility === 'hidden'
                            || (entry.video.style.display === 'none' && !Number.isFinite(entry.spec?.t))
                            || (entry.spec && typeof outputTime === 'number' && Number.isFinite(entry.spec.t)
                                && (outputTime < entry.spec.t || outputTime >= entry.spec.t + entry.spec.duration))
                            || (entry.spec && (allTracksHiddenByScope.layers
                                || hiddenTracksByScope.layers?.has(entry.spec.track)
                                || (typeof hiddenTracks !== 'undefined' && hiddenTracks.has(entry.spec.track))))) continue;
                        const motionOpacity = entry.spec && typeof motionAtForSpec === 'function'
                            ? motionAtForSpec(entry.spec, entry.spec.t, entry.spec.duration)?.visible?.opacity : undefined;
                        if ((entry.spec?.opacity ?? 1) <= 0
                            || (Number.isFinite(motionOpacity) && motionOpacity <= 0)) continue;
                        const hasSourceSize = (entry.video.videoWidth || entry.video.naturalWidth) > 0
                            && (entry.video.videoHeight || entry.video.naturalHeight) > 0;
                        const size = hasSourceSize
                            ? { width: entry.video.videoWidth || entry.video.naturalWidth,
                                height: entry.video.videoHeight || entry.video.naturalHeight }
                            : declaredSize;
                        if (!size) continue;
                        if (sourcePoint) {
                            const pixel = sourcePoint(size, summary.output, layerVisualTransformNow(entry), layerCropNow(entry), stagePoint,
                                entry.spec?.isImage ? entry.spec.flip : undefined,
                                entry.spec?.isImage ? entry.spec.frame?.cornerRadius : 0);
                            if (!pixel) continue;
                            const alpha = entry.video.akariPhotoHitAlpha;
                            if (alpha && hasSourceSize && alpha[pixel.y * size.width + pixel.x] <= 16) continue;
                            if (!alpha && hasSourceSize && layerAlphaAtSourcePoint(entry, pixel) <= 16) continue;
                        } else if (!layerGeometryHitAt(entry, event.clientX, event.clientY, hasSourceSize ? undefined : size)) continue;
                        hits.push({ element: entry.video, z: Number(entry.video.style.zIndex) || 0, order: order++ });
                    }
                    const segment = typeof cutSegmentAtOutputTime === 'function'
                        ? cutSegmentAtOutputTime() : segments[activeSegmentIndex];
                    const hasCut = Number.isInteger(segment?.cutIndex)
                        || (video.dataset.akariCutIndex !== '' && video.dataset.akariCutIndex !== undefined);
                    if (segment?.kind === 'src' && hasCut
                        && !allTracksHiddenByScope.cuts
                        && !hiddenTracksByScope.cuts.has(segment.track)) {
                        const cutHitZ = typeof zForItem === 'function' && typeof zForTrack === 'function'
                            ? zForItem(segment.id, zForTrack(segment.trackId)) : Number(video.style.zIndex) || 0;
                        if (Number.isInteger(segment.cutIndex)
                            && (video.dataset.akariCutIndex !== String(segment.cutIndex)
                                || video.dataset.akariCutId !== (segment.id || ''))) {
                            video.dataset.akariCutIndex = String(segment.cutIndex);
                            video.dataset.akariCutId = typeof segment.id === 'string' ? segment.id : '';
                            const transform = segment.transform || {};
                            video.dataset.akariTransformX = String(transform.x ?? 0);
                            video.dataset.akariTransformY = String(transform.y ?? 0);
                            video.dataset.akariTransformScale = String(transform.scale ?? 1);
                            video.dataset.akariTransformRotate = String(transform.rotate ?? 0);
                        }
                        const point = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                        if (typeof cutSelectBoxGeometry === 'function'
                            && typeof previewMotionBoxHitAtFn === 'function' && point) {
                            if (previewMotionBoxHitAtFn(cutSelectBoxGeometry(), point))
                                hits.push({ element: video, z: cutHitZ, order: -1 });
                        } else {
                            const bounds = video.getBoundingClientRect();
                            if (event.clientX >= bounds.left && event.clientX <= bounds.right
                                && event.clientY >= bounds.top && event.clientY <= bounds.bottom)
                                hits.push({ element: video, z: cutHitZ, order: -1 });
                        }
                    }
                    return typeof frontmostPreviewHitFn === 'function' ? frontmostPreviewHitFn(hits)
                        : hits.sort((a, b) => b.z - a.z || b.order - a.order)[0]?.element || null;
                }
                return document.elementsFromPoint(event.clientX, event.clientY)
                    .find(candidate => {
                        if (candidate === video) return true;
                        if (candidate === stillImage) return true;
                        if (!((candidate.tagName === 'VIDEO' || candidate.tagName === 'IMG') && candidate.dataset
                            && candidate.dataset.akariLayerId && candidate.style.display !== 'none'
                            && candidate.style.visibility !== 'hidden')) return false;
                        const candidateEntry = findLayerEntry(candidate.dataset.akariLayerId);
                        if (!candidateEntry) return true;
                        if (candidateEntry.spec && typeof outputTime === 'number' && Number.isFinite(candidateEntry.spec.t)
                            && (outputTime < candidateEntry.spec.t
                                || outputTime >= candidateEntry.spec.t + candidateEntry.spec.duration)) return false;
                        if (candidateEntry.spec && (allTracksHiddenByScope.layers
                            || hiddenTracksByScope.layers?.has(candidateEntry.spec.track)
                            || (typeof hiddenTracks !== 'undefined' && hiddenTracks.has(candidateEntry.spec.track)))) return false;
                        const motionOpacity = candidateEntry.spec && typeof motionAtForSpec === 'function'
                            ? motionAtForSpec(candidateEntry.spec, candidateEntry.spec.t,
                                candidateEntry.spec.duration)?.visible?.opacity : undefined;
                        if ((candidateEntry.spec?.opacity ?? 1) <= 0
                            || (Number.isFinite(motionOpacity) && motionOpacity <= 0)) return false;
                        const size = { width: candidate.videoWidth || candidate.naturalWidth,
                            height: candidate.videoHeight || candidate.naturalHeight };
                        if (!(size.width > 0 && size.height > 0)) {
                            return layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                        }
                        if (!sourcePoint) return layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                        const pixel = sourcePoint(size, summary.output, layerVisualTransformNow(candidateEntry),
                            layerCropNow(candidateEntry), stagePoint,
                            candidateEntry.spec.isImage ? candidateEntry.spec.flip : undefined,
                            candidateEntry.spec.isImage ? candidateEntry.spec.frame?.cornerRadius : 0);
                        if (!pixel) return false;
                        const alpha = candidate.akariPhotoHitAlpha;
                        return (alpha ? alpha[pixel.y * size.width + pixel.x]
                            : layerAlphaAtSourcePoint(candidateEntry, pixel)) > 16;
                    }) || null;
            };
            libraryMediaHitAt = findVisualMediaHitAt;
            const shouldRegrabSelectedLayerFrame = ({ x, y, bounds, selectedZ, hitZ, hitIsSelected, hasHit, domZ }) => {
                if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
                if (domZ !== null && (!hasHit || hitZ <= domZ)) return false;
                // Alpha holes may reveal a lower cut or layer without putting it above the selection.
                return !hasHit || hitIsSelected || hitZ < selectedZ;
            };
            const selectedLayerFrameRegrabAt = (event, mediaHit) => {
                if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey
                    || penModeActive || rectModeActive || cropModeActive || perspectivePanelOpen
                    || selectionDragActive || activeCaptionEdit || photoSelect || photoBrush
                    || window.akari.interaction?.activeEdit || !selectedLayerId
                    || !layerSelectBox.classList.contains('is-active')
                    || layerSelectBox.classList.contains('akari-selected-invisible')
                    || !previewPane.contains(event.target)) return null;
                const target = event.target;
                if (!(target instanceof Element) || target.closest('button, [role="button"], input, textarea, select, a[href], '
                    + '[contenteditable="true"], [data-akari-interaction], #pen-layer, #layer-select-box, '
                    + '#layer-crop-box, #layer-crop-toggle, #layer-perspective-toggle, #layer-perspective-panel, '
                    + '#cut-select-box, #caption-select-box')) return null;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return null;
                const bounds = layerSelectBox.getBoundingClientRect();
                const hit = mediaHit;
                const domItem = target.closest('[data-overlay-id], #caption-plate');
                const captionRow = domItem && target.closest('.caption-row-plate');
                const domZ = !domItem ? null : captionRow
                    ? Number(captionRow.style.zIndex || captionLayer.style.zIndex)
                    : Number(domItem.style.zIndex);
                return shouldRegrabSelectedLayerFrame({
                    x: event.clientX, y: event.clientY, bounds,
                    selectedZ: Number(entry.video.style.zIndex),
                    hitZ: hit ? Number(hit.style.zIndex) : null,
                    hitIsSelected: hit === entry.video, hasHit: Boolean(hit), domZ
                }) ? entry : null;
            };
            // The interaction layer asks once at pointerdown. The media and pan handlers
            // reuse this answer so all three paths agree for the same pointer.
            const marqueeStartDecisions = new WeakMap();
            window.akari.shouldStartPreviewMarquee = event => {
                if (marqueeStartDecisions.has(event)) return marqueeStartDecisions.get(event);
                const target = event.target;
                const blocked = (typeof motionDraw !== 'undefined' && motionDraw) || event.button !== 0 || event.altKey || penModeActive || rectModeActive
                    || selectionDragActive || cropModeActive || perspectivePanelOpen || activeCaptionEdit
                    || window.akari.interaction?.activeEdit || !previewPane.contains(target)
                    || !(target instanceof Element)
                    || !!target.closest('button, [role="button"], input, textarea, select, a[href], '
                        + '[contenteditable="true"], [data-overlay-id], [data-akari-interaction], '
                        + '.caption-row-plate, #pen-layer, #layer-select-box, #layer-crop-box, '
                        + '#layer-crop-toggle, #layer-perspective-toggle, #layer-perspective-panel, '
                        + '#cut-select-box, #caption-select-box');
                const mediaHit = blocked ? null : findVisualMediaHitAt(event);
                const frameRegrab = typeof selectedLayerFrameRegrabAt === 'function'
                    && selectedLayerFrameRegrabAt(event, mediaHit);
                const allow = !blocked && !frameRegrab
                    && (zoom > 1.05 ? event.shiftKey : !mediaHit || event.shiftKey);
                marqueeStartDecisions.set(event, allow);
                return allow;
            };
            // cuts / layers / overlays / captions は同じ #preview-layers 内で z を競う。
            // 箱は pointer-events:none、実体だけ auto なので、共通祖先から委譲しつつ
            // 全面透明 mov のアルファ実測だけは elementsFromPoint で下へ素通しする。
            const handledVisualPointerDownEvents = new WeakSet();
            let lastPhotoPointerDown = null;
            const handleVisualMediaPointerDown = event => {
                if (typeof motionDraw !== 'undefined' && motionDraw) return;
                if (window.akari.shouldStartPreviewMarquee?.(event)) return;
                // ㉔ クロップモード中は移動/選択切り替えと操作が衝突しないよう、選択中レイヤーの
                // ボディドラッグを含め本編ステージの通常操作を止める（ハンドルは別要素なので
                // このガードの影響を受けない）。
                const target = event.target;
                let coveredDomHit = null;
                if (frameEngineMediaIdle) {
                    if (handledVisualPointerDownEvents.has(event)) return;
                    handledVisualPointerDownEvents.add(event);
                    const interactiveTarget = target?.closest?.(
                        '[data-akari-interaction], [data-overlay-id], #overlay-stage, #caption-plate, '
                        + '#layer-select-box, #layer-crop-box, #layer-crop-toggle, '
                        + '#layer-perspective-toggle, #layer-perspective-panel, #cut-select-box, #pen-layer'
                    );
                    if (penModeActive || rectModeActive) return;
                    if (interactiveTarget) {
                        const domItem = target?.closest?.('[data-overlay-id], #caption-plate');
                        const captionRow = target?.closest?.('.caption-row-plate');
                        const mediaHit = domItem ? findVisualMediaHitAt(event) : null;
                        const domZ = captionRow
                            ? Number(captionRow.style.zIndex || captionLayer.style.zIndex)
                            : Number(domItem?.style.zIndex);
                        if (!mediaHit || Number(mediaHit.style.zIndex) <= domZ) return;
                        coveredDomHit = mediaHit;
                        event.stopPropagation();
                    }
                }
                const targetIsVisualMedia = target === video || target === stillImage
                    || Boolean(target?.dataset?.akariLayerId);
                const targetIsEngineStage = coveredDomHit
                    || (typeof previewStage !== 'undefined' && typeof selectedLayerId !== 'undefined'
                        && target === previewStage && !!selectedLayerId)
                    || frameEngineMediaIdle && (target === previewStage || target?.id === 'frame-engine-canvas');
                // オーバーレイ / 字幕の実体をクリックした場合は各ランタイムの操作を優先する。
                if (event.button !== 0 || cropModeActive
                    || (!targetIsVisualMedia && target !== layersStage && target !== stage
                        && !targetIsEngineStage)) return;
                const hit = coveredDomHit || findVisualMediaHitAt(event);
                const regrabEntry = typeof selectedLayerFrameRegrabAt === 'function'
                    ? selectedLayerFrameRegrabAt(event, hit) : null;
                if (regrabEntry) {
                    beginLayerMoveDrag(regrabEntry, event);
                    return;
                }
                if (!hit) return;
                if (activeCaptionEdit) void commitCaptionEdit();
                if (selectedCaptionId) deselectCaption();
                if (hit === video || hit === stillImage) {
                    if (video.dataset.akariCutIndex === '' || video.dataset.akariCutIndex === undefined) return;
                    selectCut({ visibleHit: true });
                    const segment = typeof cutInteractionSegment === 'function' ? cutInteractionSegment() : null;
                    const cutImage = segment?.src && (initial.imageSources || {})[segment.src];
                    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    const key = 'cut:' + (segment?.id || video.dataset.akariCutId);
                    const twice = cutImage && typeof lastPhotoPointerDown !== 'undefined'
                        && lastPhotoPointerDown?.id === key
                        && now - lastPhotoPointerDown.time < 400
                        && Math.hypot(event.clientX - lastPhotoPointerDown.x, event.clientY - lastPhotoPointerDown.y) < 8;
                    if (typeof lastPhotoPointerDown !== 'undefined') {
                        lastPhotoPointerDown = { id: key, time: now, x: event.clientX, y: event.clientY };
                    }
                    if (twice) {
                        event.preventDefault();
                        event.stopPropagation();
                        setCropMode(true);
                        return;
                    }
                    const translate = pointerTranslationFrom(event);
                    let dragSnap = { x: null, y: null };
                    beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {
                        const movement = translate(moveEvent);
                        if (moveEvent.shiftKey) {
                            if (Math.abs(movement.x) >= Math.abs(movement.y)) movement.y = 0;
                            else movement.x = 0;
                        }
                        let nextX = original.x + movement.x;
                        let nextY = original.y + movement.y;
                        if (moveEvent.metaKey || moveEvent.ctrlKey || !window.akari.interaction) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const outputWidth = Number(summary.output && summary.output.width) || 1280;
                            const outputHeight = Number(summary.output && summary.output.height) || 720;
                            const segment = cutInteractionSegment();
                            const visual = previewMotionGeometryTransformFn(original,
                                motionAtForSpec(segment, segment?.outStart,
                                    Number(segment?.outEnd) - Number(segment?.outStart), original)?.visible);
                            const bounds = typeof cutOutputBoundsForTransform === 'function'
                                ? cutOutputBoundsForTransform({ ...visual,
                                    x: visual.x + nextX - original.x, y: visual.y + nextY - original.y })
                                : outputBoundsForCenteredBox(outputWidth / 2 + visual.x + nextX - original.x,
                                    outputHeight / 2 + visual.y + nextY - original.y,
                                    outputWidth * visual.scale, outputHeight * visual.scale);
                            const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap,
                                { kind: 'cut' });
                            dragSnap = snap;
                            if (snap.x) nextX += snap.x.correction;
                            if (snap.y) nextY += snap.y.correction;
                            window.akari.interaction.showSnapGuides(snap.x, snap.y);
                        }
                        return { ...original, x: nextX, y: nextY };
                    });
                    return;
                }
                const entry = findLayerEntry(hit.dataset.akariLayerId);
                if (!entry) return;
                selectLayer(entry.spec.id, { visibleHit: true });
                const photo = entry.spec.isImage === true;
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const twice = photo && typeof lastPhotoPointerDown !== 'undefined'
                    && lastPhotoPointerDown?.id === entry.spec.id
                    && now - lastPhotoPointerDown.time < 400
                    && Math.hypot(event.clientX - lastPhotoPointerDown.x, event.clientY - lastPhotoPointerDown.y) < 8;
                if (typeof lastPhotoPointerDown !== 'undefined') {
                    lastPhotoPointerDown = { id: entry.spec.id, time: now, x: event.clientX, y: event.clientY };
                }
                if (twice) {
                    event.preventDefault();
                    event.stopPropagation();
                    setCropMode(true);
                    return;
                }
                // stageLocalPoint は親の frameScale と #zoom-layer の scale を実測して変換する。
                beginLayerMoveDrag(entry, event);
            };
            layersStage.addEventListener('pointerdown', handleVisualMediaPointerDown, true);
            if (frameEngineMediaIdle) {
                previewStage.addEventListener('pointerdown', handleVisualMediaPointerDown, true);
            }
            for (const handle of layerHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !selectedLayerId || cropModeActive) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const kind = handle.getAttribute('data-akari-handle');
                    const boxRect = layerSelectBox.getBoundingClientRect();
                    const boxCenter = {
                        x: boxRect.left + boxRect.width / 2,
                        y: boxRect.top + boxRect.height / 2
                    };
                    // 枠はコンテンツにフィットしているが、拡縮・回転のピボットは transform モデルの
                    // 中心 = ビデオ中心のまま。箱中心からピボットオフセット（出力 px）を引き戻す
                    const pivotPerOutput = (window.akari.stageScale() || 1) * (typeof zoom === 'number' && zoom > 0 ? zoom : 1);
                    const pivotOffX = (Number(layerSelectBox.dataset.akariPivotOffX) || 0) * pivotPerOutput;
                    const pivotOffY = (Number(layerSelectBox.dataset.akariPivotOffY) || 0) * pivotPerOutput;
                    const center = {
                        x: boxRect.left + boxRect.width / 2 - pivotOffX,
                        y: boxRect.top + boxRect.height / 2 - pivotOffY
                    };
                    if (kind === 'move') { beginLayerMoveDrag(entry, event); return; }
                    if (kind === 'rotate') {
                        const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
                        beginMediaTransformDrag(layerDragTarget(entry), event, (moveEvent, original) => {
                            const angle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180 / Math.PI;
                            const rotate = original.rotate + (angle - startAngle);
                            return { ...original, rotate: window.akariHandleGeometry?.snapAngle(rotate,
                                moveEvent.metaKey || moveEvent.ctrlKey) ?? rotate };
                        });
                    } else {
                        const oppositeKind = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[kind];
                        const boxZoom = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
                        const boxWidth = (Number.parseFloat(layerSelectBox.style.width) || 0) * boxZoom;
                        const boxHeight = (Number.parseFloat(layerSelectBox.style.height) || 0) * boxZoom;
                        const rotate = layerVisualTransformNow(entry).rotate;
                        const anchorClient = layerResizeCornerPointFn(
                            boxCenter.x, boxCenter.y, boxWidth, boxHeight, rotate, oppositeKind
                        );
                        const draggedClient = layerResizeCornerPointFn(
                            boxCenter.x, boxCenter.y, boxWidth, boxHeight, rotate, kind
                        );
                        const anchor = window.akari.interaction?.stageLocalPoint?.(anchorClient.x, anchorClient.y);
                        const dragged = window.akari.interaction?.stageLocalPoint?.(draggedClient.x, draggedClient.y);
                        if (!anchor || !dragged || !window.akari.interaction?.anchorPreservingTranslate) return;
                        const startDistance = Math.max(1, Math.hypot(dragged.x - anchor.x, dragged.y - anchor.y));
                        let dragSnap = { x: null, y: null };
                        beginMediaTransformDrag(layerDragTarget(entry), event, (moveEvent, original) => {
                            const point = window.akari.interaction.stageLocalPoint(moveEvent.clientX, moveEvent.clientY);
                            if (!point) return original;
                            const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
                            const factor = distance / startDistance;
                            let nextScale = Math.max(0.01, original.scale * factor);
                            if (moveEvent.metaKey || moveEvent.ctrlKey || !window.akari.interaction.computeAnchorResizeSnap) {
                                dragSnap = { x: null, y: null };
                                window.akari.interaction?.hideSnapGuides?.();
                            } else {
                                const solved = window.akari.interaction.computeAnchorResizeSnap({
                                    anchorStageX: anchor.x,
                                    anchorStageY: anchor.y,
                                    draggedStageX: dragged.x,
                                    draggedStageY: dragged.y,
                                    startScale: original.scale,
                                    scale: nextScale,
                                    snapX: dragSnap.x,
                                    snapY: dragSnap.y
                                });
                                if (!solved) return original;
                                nextScale = solved.scale;
                                dragSnap = { x: solved.snapX, y: solved.snapY };
                            }
                            const translated = window.akari.interaction.anchorPreservingTranslate({
                                startX: original.x,
                                startY: original.y,
                                startScale: original.scale,
                                scale: nextScale,
                                anchorStageX: anchor.x,
                                anchorStageY: anchor.y
                            });
                            return translated ? { ...original, ...translated, scale: nextScale,
                                ...(entry.spec.isImage === true ? {
                                    scaleX: (original.scaleX ?? original.scale) * nextScale / original.scale,
                                    scaleY: (original.scaleY ?? original.scale) * nextScale / original.scale
                                } : {}) } : original;
                        });
                    }
                });
            }
            // 裁定 2: クロップのドラッグ本体（⛶ モードの 8 方向ハンドルと四辺中央の辺バー、
            // cut と layer の両方）は 1 本の関数に寄せる。対辺（動かさない側）をアンカーに固定し、
            // ドラッグ中の点（ソースフレーム正規化座標）で動かした側の辺だけを更新する —
            // CapCut / Canva 等の切り抜きハンドルと同型の挙動。確定(pointerup)時のみ
            // {crop, transform} を 1 回書き戻す（既存 transform ハンドルと同じ確定タイミング）。
            // ㉗ 錨補正（2026-08-06 crop-handle-anchor-fix）: crop の中心が実際の配置基準点
            // （layerScreenRectForVideoRect 参照）なので、crop 変更だけを書き戻すと基準点自体が
            // 動いて絵全体がずれる。cropAnchorCorrectedTransformFn が「ドラッグした辺以外は画面上
            // 不動」になる transform.x/y を返し、crop と同一 patch で書く（ドラッグ中のライブ表示も
            // 同じ補正を適用 — 確定時だけだと commit 瞬間にジャンプする）。pointer→ソース座標の
            // マッピングはドラッグ開始時点の startTransform を最後まで使い続ける（ライブ補正で
            // 変わる transform.x/y を混ぜない）ため、この錨補正はハンドル自体の追従性に影響しない。
            const beginMediaCropDrag = (target, dir, event) => {
                if (selectionDragActive) return;
                const natural = target.naturalSize();
                if (!(natural.width > 0) || !(natural.height > 0)) return;
                const restorePoint = target.cropRestorePoint();
                // 裁定 5: crop の無い cut は出力キャンバスへ contain fit されてから transform が
                // 掛かる。初めて crop を書く瞬間に fit を scale へ焼き込み、layer-style（ソース
                // 実寸 × scale）へ移っても画面上の位置・大きさが変わらないようにする。
                const startTransform = target.cropEntryTransform(target.transformNow(), natural);
                const original = target.cropNow();
                const pivotPx = { x: (original.x + original.w / 2) * natural.width,
                    y: (original.y + original.h / 2) * natural.height };
                event.preventDefault();
                event.stopPropagation();
                const gesture = beginSelectionGesture(target);
                selectionDragActive = true;
                document.body.classList.add('akari-selection-gesture-active');
                const pointerId = event.pointerId;
                const captureTarget = event.currentTarget;
                let moved = false;
                let cancelled = false;
                let finished = false;
                let lastClientX = event.clientX;
                let lastClientY = event.clientY;
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                // 裁定 3: ⛶ モード外（= 辺バー）のときだけ、ドラッグ中の間だけゴースト枠を出す。
                const ghosted = !cropModeActive;
                if (ghosted) {
                    edgeCropDragActive = true;
                    edgeCropDragTarget = target;
                    updateLayerCropBox();
                }
                const cleanup = () => {
                    selectionDragActive = false;
                    document.body.classList.remove('akari-selection-gesture-active');
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    if (ghosted) {
                        edgeCropDragActive = false;
                        edgeCropDragTarget = null;
                        layerCropBox.classList.remove('is-active');
                    }
                };
                const computeNext = moveEvent => {
                    const point = layerVideoPointForPivot(startTransform, pivotPx, moveEvent.clientX, moveEvent.clientY);
                    if (!point) return original;
                    const movedCrop = cropRectAfterEdgeDragFn(
                        original,
                        dir,
                        { x: point.x / natural.width, y: point.y / natural.height },
                        CROP_MIN
                    );
                    const ratioName = typeof photoCropTarget !== 'undefined' && photoCropTarget?.entry === target.entry
                        ? photoCropRatio.value : 'free';
                    const ratio = ratioName === 'original' ? natural.width / natural.height
                        : ratioName === 'free' ? null : Number(ratioName.split(':')[0]) / Number(ratioName.split(':')[1]);
                    const constrained = ratio ? photoCropConstrainRatioAfterEdgeFn(original, movedCrop, dir,
                        natural.width, natural.height, ratio) : movedCrop;
                    return { ...constrained, ...(original.rotate ? { rotate: original.rotate } : {}) };
                };
                // cropAnchorCorrectedTransformFn は x/y のみを返す（scale/rotate は補正で
                // 動かさない）ため、書き戻し用の完全な transform には startTransform の
                // scale/rotate を必ずマージする（欠けると dataset に "undefined" が書かれ
                // NaN → 既定値 1/0 へフォールバックし、スケール/回転が消し飛ぶ）。
                const correctedTransformFor = nextCrop => {
                    const corrected = cropAnchorCorrectedTransformFn(
                        original, nextCrop, startTransform, natural.width, natural.height
                    );
                    const dx = (nextCrop.x + nextCrop.w / 2 - original.x - original.w / 2)
                        * natural.width * ((startTransform.scaleX ?? startTransform.scale) - startTransform.scale);
                    const dy = (nextCrop.y + nextCrop.h / 2 - original.y - original.h / 2)
                        * natural.height * ((startTransform.scaleY ?? startTransform.scale) - startTransform.scale);
                    const radians = startTransform.rotate * Math.PI / 180;
                    return { ...startTransform,
                        x: corrected.x + dx * Math.cos(radians) - dy * Math.sin(radians),
                        y: corrected.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
                };
                const onMove = moveEvent => {
                    if (finished || moveEvent.pointerId !== pointerId) return;
                    if (moveEvent.clientX === lastClientX && moveEvent.clientY === lastClientY) return;
                    lastClientX = moveEvent.clientX;
                    lastClientY = moveEvent.clientY;
                    moved = true;
                    const nextCrop = computeNext(moveEvent);
                    target.applyCropAndTransform(nextCrop, correctedTransformFor(nextCrop));
                };
                const finish = async () => {
                    if (finished) return;
                    finished = true;
                    try {
                        cleanup();
                        if (cancelled || !moved) {
                            if (moved) {
                                target.restoreCrop(restorePoint);
                                // ドラッグ終了時に最終値が必ず反映されるよう、次の RAF を待たず今すぐ描画する。
                                target.flushCrop();
                            }
                            return;
                        }
                        target.flushCrop();
                        const finalCrop = target.cropNow();
                        const finalTransform = target.transformNow();
                        if (cropModeActive && typeof photoCropTarget !== 'undefined'
                            && photoCropTarget?.entry === target.entry) {
                            photoCropDirty = true;
                            return;
                        }
                        if (!target.canWrite()) {
                            window.akari.showWriteError('クロップを保存できませんでした。対象を選択し直してください。');
                            target.restoreCrop(restorePoint);
                            target.flushCrop();
                            return;
                        }
                        try {
                            await target.write({ crop: finalCrop, transform: finalTransform });
                            window.akari.reportGesture('saved');
                        } catch (error) {
                            window.akari.showWriteError(error);
                            if (selectionGestureIsLatest(gesture)) {
                                target.restoreCrop(restorePoint);
                                target.flushCrop();
                            }
                        }
                    } finally {
                        // 保存応答（または巻き戻し）まで DOM と refresh の保護を維持する。
                        endSelectionGesture(gesture);
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    onMove(upEvent);
                    void finish();
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== pointerId) return;
                    cancelled = true;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
            };
            // ㉔ ⛶ クロップモードの 8 方向ハンドル（n/ne/e/se/s/sw/w/nw）。辺バーと同じ
            // beginMediaCropDrag へ入る（挙動は従来どおり）。
            for (const handle of layerCropHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !cropModeActive) return;
                    const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : null;
                    const target = entry ? layerDragTarget(entry) : cutSelected ? cutDragTarget() : null;
                    if (!target) return;
                    beginMediaCropDrag(
                        target,
                        handle.getAttribute('data-akari-crop-handle'),
                        event
                    );
                });
            }
            const photoCropApply = nextCrop => {
                const target = photoCropTarget;
                if (!target) return;
                const natural = target.naturalSize();
                if (!(natural.width > 0 && natural.height > 0)) return;
                const transform = target.transformNow();
                target.applyCropAndTransform(nextCrop,
                    target.cropEntryTransform(transform, natural));
                target.flushCrop();
                photoCropDirty = true;
            };
            const requestPhotoAnalysis = kind => photoCropItemId
                ? window.akari.engine.photoAnalyze(photoCropItemId, kind).catch(() => null)
                : Promise.resolve(null);
            photoCropRatio.addEventListener('change', () => {
                if (!photoCropTarget || photoCropRatio.value === 'free') return;
                const natural = photoCropTarget.naturalSize();
                if (!(natural.width > 0 && natural.height > 0)) return;
                const aspect = photoCropRatio.value === 'original' ? natural.width / natural.height
                    : Number(photoCropRatio.value.split(':')[0]) / Number(photoCropRatio.value.split(':')[1]);
                photoCropApply(photoCropForRatioFn(photoCropTarget.cropNow(), natural.width, natural.height, aspect));
            });
            photoCropRotate.addEventListener('change', () => {
                if (!photoCropTarget) return;
                const rotate = Math.max(-45, Math.min(45, Number(photoCropRotate.value) || 0));
                photoCropRotate.value = String(rotate);
                const natural = photoCropTarget.naturalSize();
                const crop = { ...photoCropTarget.cropNow(), rotate };
                photoCropApply(photoCropForRatioFn(crop, natural.width, natural.height,
                    crop.w * natural.width / (crop.h * natural.height)));
            });
            photoCropPanel.querySelector('[data-photo-crop-done]').addEventListener('click', () => setCropMode(false));
            photoCropPanel.querySelector('[data-photo-crop-cancel]').addEventListener('click', cancelCropMode);
            photoCropPanel.querySelector('[data-photo-crop-auto]').addEventListener('click', () => {
                if (!photoCropTarget) return;
                const itemId = photoCropItemId;
                photoCropStatus.textContent = '水平を調べています…';
                // Unsupported Vision requests return 0°, leaving the current crop intact.
                requestPhotoAnalysis('horizon').then(result => {
                    if (!photoCropTarget || photoCropItemId !== itemId) return;
                    photoCropRotate.value = String(result?.degrees || 0);
                    photoCropRotate.dispatchEvent(new Event('change'));
                    photoCropStatus.textContent = result?.available ? '水平に合わせました' : '水平を見つけられませんでした';
                });
            });
            photoCropPanel.querySelector('[data-photo-crop-smart]').addEventListener('click', () => {
                if (!photoCropTarget) return;
                const itemId = photoCropItemId;
                photoCropStatus.textContent = '写真を調べています…';
                requestPhotoAnalysis('saliency').then(result => {
                    if (!photoCropTarget || photoCropItemId !== itemId) return;
                    if (result?.focus) {
                        const natural = photoCropTarget.naturalSize();
                        photoCropApply(smartPhotoCropFn(photoCropTarget.cropNow(), result.focus,
                            natural.width, natural.height));
                    }
                    photoCropStatus.textContent = result?.focus
                        ? result.basis === 'saliency' ? '注目領域を基準にしました。構図を確認してください'
                            : '主役を三分割に合わせました'
                        : '主役を見つけられませんでした';
                });
            });
            layerCropRect.addEventListener('pointerdown', event => {
                if (!photoCropTarget || event.button !== 0 || event.target !== layerCropRect) return;
                event.preventDefault();
                event.stopPropagation();
                const target = photoCropTarget, start = target.cropNow(), natural = target.naturalSize();
                const scale = window.akari.stageScale() || 1;
                const transform = target.transformNow();
                const pointerId = event.pointerId, x = event.clientX, y = event.clientY;
                layerCropRect.setPointerCapture(pointerId);
                const move = current => {
                    if (current.pointerId !== pointerId) return;
                    const a = -(transform.rotate || 0) * Math.PI / 180;
                    const dx = current.clientX - x, dy = current.clientY - y;
                    const localX = (dx * Math.cos(a) - dy * Math.sin(a))
                        / (scale * (transform.scaleX || transform.scale) * natural.width);
                    const localY = (dx * Math.sin(a) + dy * Math.cos(a))
                        / (scale * (transform.scaleY || transform.scale) * natural.height);
                    photoCropApply(photoCropAfterPanFn(start, localX, localY, natural.width, natural.height));
                };
                const end = current => {
                    if (current.pointerId !== pointerId) return;
                    layerCropRect.removeEventListener('pointermove', move);
                    layerCropRect.removeEventListener('pointerup', end);
                    layerCropRect.removeEventListener('pointercancel', end);
                };
                layerCropRect.addEventListener('pointermove', move);
                layerCropRect.addEventListener('pointerup', end);
                layerCropRect.addEventListener('pointercancel', end);
            });
            new ResizeObserver(() => updateLayerCropBox()).observe(wrapper);
            const isSelectionReleaseTarget = event => {
                if (event.target.closest?.('#layer-select-box, #cut-select-box, #caption-select-box, '
                    + '#layer-crop-box, #photo-crop-controls, #layer-crop-toggle, #layer-perspective-toggle, '
                    + '#layer-perspective-panel, .caption-row-plate, [data-overlay-id], [data-akari-interaction], '
                    + 'button, [role="button"], input, textarea, select, a[href]')) return false;
                // 全面透明 mov の可視画素判定を含め、実際の z 順を elementsFromPoint で再確認する。
                return !!event.target.closest?.('#caption-plate') || !findVisualMediaHitAt(event);
            };
            const releasePreviewSelection = () => {
                if (activeCaptionEdit) void commitCaptionEdit();
                if (selectedCaptionId) deselectCaption();
                if (selectedLayerId) selectLayer(null);
                if (cutSelected) deselectCut();
            };
            // パンが capture 段で pointerdown を止めても、click 合成に依存せず押下〜解放を追う。
            // 移動後に元の位置へ戻っても解除しない。選択面・操作ボタン上の押下は候補にしない。
            let selectionReleasePointer = null;
            previewPane.addEventListener('pointerdown', event => {
                suppressClick = false;
                selectionReleasePointer = null;
                if ((typeof motionDraw !== 'undefined' && motionDraw) || event.button !== 0 || penModeActive || rectModeActive || selectionDragActive
                    || !isSelectionReleaseTarget(event)) return;
                selectionReleasePointer = {
                    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false
                };
            }, true);
            const trackSelectionReleasePointer = event => {
                const pointer = selectionReleasePointer;
                if (!pointer || pointer.pointerId !== event.pointerId) return;
                if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > CLICK_THRESHOLD_PX) {
                    pointer.moved = true;
                }
            };
            window.addEventListener('pointermove', trackSelectionReleasePointer, true);
            const finishSelectionReleasePointer = event => {
                const pointer = selectionReleasePointer;
                if (!pointer || pointer.pointerId !== event.pointerId) return;
                trackSelectionReleasePointer(event);
                selectionReleasePointer = null;
                if (event.type === 'pointercancel' || pointer.moved || drag?.didMove) {
                    suppressClick = true;
                    return;
                }
                const paneRect = previewPane.getBoundingClientRect();
                if (event.clientX < paneRect.left || event.clientX > paneRect.right
                    || event.clientY < paneRect.top || event.clientY > paneRect.bottom) return;
                if (isSelectionReleaseTarget(event)) releasePreviewSelection();
            };
            window.addEventListener('pointerup', finishSelectionReleasePointer, true);
            window.addEventListener('pointercancel', finishSelectionReleasePointer, true);
            wrapper.addEventListener('click', event => {
                if (!suppressClick && isSelectionReleaseTarget(event)) releasePreviewSelection();
            });
            new ResizeObserver(() => updateLayerSelectBox()).observe(wrapper);

            // ㉓ 本編ビデオ（#preview-video = 現在再生中のカット）のクリック選択 + transform。
            // layers[] と同型（4隅ハンドルで移動/拡縮・center-pivot scale・確定時のみ
            // cutWrite）。box の基準サイズは layers[] の natural media size ではなく
            // 出力フレーム（outputWidth/outputHeight）— #preview-video 自身が
            // updateStageScale() で frameRect サイズに敷かれ、その上へ cut transform の
            // translate/scale/rotate がそのままかかる実装（既存 transform 消費経路）と
            // 一致させるため。
            let requestedCutId;
            let cutSelected = false;
            const cutSelectBox = document.getElementById('cut-select-box');
            const cutHandleElements = Array.from(cutSelectBox.querySelectorAll('[data-akari-handle]'));
            window.addEventListener('pointerdown', event => {
                if ((typeof motionDraw !== 'undefined' && motionDraw) || event.button !== 0 || !cutSelected) return;
                if (event.target instanceof Element
                    && event.target.closest('[data-overlay-id], [data-akari-interaction], .caption-row-plate')) return;
                const onCutHandle = event.target instanceof Element && Boolean(event.target.closest('#cut-select-box'));
                const hit = findVisualMediaHitAt(event);
                if (!onCutHandle && hit !== video && hit !== stillImage) return;
                const interaction = window.akari.interaction;
                interaction?.setEnabled?.(false);
                queueMicrotask(() => interaction?.setEnabled?.(true));
            }, true);
            let selectionCutSource;
            let selectionCutSegment;
            let selectionProxySource;
            const selectionCutProxy = document.createElement('video');
            const cutInteractionSegment = () => {
                if (requestedCutId === undefined) return frameEngineMediaIdle
                    ? cutSegmentAtOutputTime() : segments[activeSegmentIndex];
                const index = summary.cuts.findIndex(cut => cut.id === requestedCutId);
                const cut = summary.cuts[index];
                if (!cut) return undefined;
                if (selectionCutSource !== cut) {
                    const map = window.AkariEditKernel.buildTimelineMap([{ ...cut, track: 0 }], { fps: summary.output.fps });
                    const span = map.segments.find(segment => segment.kind === 'src');
                    selectionCutSegment = span ? { ...cut, ...span, id: cut.id, cutIndex: index, track: cut.track ?? 0 } : undefined;
                    selectionCutSource = cut;
                }
                return selectionCutSegment;
            };
            const cutSelectionVideo = () => {
                if (!frameEngineMediaIdle || requestedCutId === undefined) return video;
                const segment = cutInteractionSegment();
                if (!segment) return selectionCutProxy;
                if (selectionProxySource !== selectionCutSource) {
                    const transform = segment.transform ?? {};
                    Object.assign(selectionCutProxy.dataset, {
                        akariCutId: segment.id, akariCutIndex: String(segment.cutIndex),
                        akariTransformX: String(transform.x ?? 0), akariTransformY: String(transform.y ?? 0),
                        akariTransformScale: String(transform.scale ?? 1), akariTransformRotate: String(transform.rotate ?? 0),
                        akariCutFraming: segment.framing && typeof segment.framing === 'object' && !Array.isArray(segment.framing) ? 'true' : ''
                    });
                    writeCutLayerStyleBase(selectionCutProxy, segment);
                    selectionProxySource = selectionCutSource;
                }
                if (!selectionGestureProtects('cut')) applyCutKeyframesToMedia(selectionCutProxy, segment, Math.max(0, outputTime - segment.outStart));
                return selectionCutProxy;
            };
            const cutInteractionMedia = () => frameEngineMediaIdle ? [cutSelectionVideo()] : [video, stillImage];
            const cutTransformNow = () => ({
                x: Number(cutSelectionVideo().dataset.akariTransformX) || 0,
                y: Number(cutSelectionVideo().dataset.akariTransformY) || 0,
                scale: Number(cutSelectionVideo().dataset.akariTransformScale) || 1,
                rotate: Number(cutSelectionVideo().dataset.akariTransformRotate) || 0
            });
            let cutPreviewPositionPatch = null;
            let cutPreviewVisiblePosition = null;
            const cutVisualTransformNow = () => {
                const segment = cutInteractionSegment();
                return previewMotionGeometryTransformFn(cutTransformNow(), motionAtForSpec(segment,
                    segment?.outStart, Number(segment?.outEnd) - Number(segment?.outStart), cutTransformNow())?.visible,
                    cutPreviewVisiblePosition);
            };
            // RAF スロットリング（2026-08-09 raf-throttle）: layer 側と同じ規律。
            // 裁定 3: 辺バードラッグ中はゴースト枠（#layer-crop-box）も同じフレームで測り直す。
            const cutTransformVisualThrottle = createRafThrottleFn(() => {
                const index = Number(cutSelectionVideo().dataset.akariCutIndex);
                if (cutSelectionVideo().dataset.akariCutIndex !== '' && Number.isInteger(index)) {
                    if (cropModeActive || edgeCropDragActive) {
                        void window.akari.frameEngineClock?.applyCropPreview?.(
                            { kind: 'cut', index }, cutCropNow(), cutTransformNow());
                    } else {
                        void window.akari.frameEngineClock?.applyTransformPreview?.({ kind: 'cut', index },
                            cutPreviewPositionPatch ?? cutTransformNow(), outputTime);
                    }
                }
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (cropModeActive || edgeCropDragActive) updateLayerCropBox();
                updateCutSelectBox();
            });
            const applyCutTransformNow = (transform, previewPatch = transform, visiblePosition = null) => {
                cutPreviewPositionPatch = previewPatch;
                cutPreviewVisiblePosition = visiblePosition;
                cutSelectionVideo().dataset.akariCutTransformActive = 'true';
                cutSelectionVideo().dataset.akariTransformX = String(transform.x);
                cutSelectionVideo().dataset.akariTransformY = String(transform.y);
                cutSelectionVideo().dataset.akariTransformScale = String(transform.scale);
                cutSelectionVideo().dataset.akariTransformRotate = String(transform.rotate);
                const cutIndex = Number(cutSelectionVideo().dataset.akariCutIndex);
                if (cutSelectionVideo().dataset.akariCutIndex !== '' && Number.isInteger(cutIndex)) {
                    window.akari.reportLiveValues?.({ id: 'cut:' + cutIndex, values: transform });
                }
                cutTransformVisualThrottle.call();
            };
            const mediaNaturalSizeOf = media => ({
                width: (media && media.tagName === 'IMG' ? media.naturalWidth : media && media.videoWidth) || 0,
                height: (media && media.tagName === 'IMG' ? media.naturalHeight : media && media.videoHeight) || 0
            });
            // 静止画セグメント中は #preview-still が本編の見た目を担う（video は hidden のまま）。
            const cutMediaNow = () => frameEngineMediaIdle ? cutSelectionVideo()
                : (stillImage.style.display !== 'none' ? stillImage : video);
            const cutInteractionVisible = () => {
                if (!frameEngineMediaIdle) return !(video.style.visibility === 'hidden' && stillImage.style.display === 'none');
                const segment = cutInteractionSegment();
                return segment?.kind === 'src' && !allTracksHiddenByScope.cuts
                    && !hiddenTracksByScope.cuts.has(segment.track);
            };
            // frame-engine 面では本編の legacy media が idle（src 無し）なので要素からソース実寸を
            // 取れない。crop はソースフレーム相対なので、cut を選んだときだけ metadata を 1 度読んで
            // 実寸を測る（source id 単位でキャッシュ。再生には一切関与しない計測専用の要素）。
            const cutSourceNaturalSizes = new Map();
            const ensureCutSourceNaturalSize = () => {
                const segment = cutInteractionSegment();
                const sourceId = segment && segment.kind === 'src' && typeof segment.src === 'string'
                    ? segment.src : null;
                if (!sourceId) return null;
                if (cutSourceNaturalSizes.has(sourceId)) return cutSourceNaturalSizes.get(sourceId);
                const imageUrl = (initial.imageSources || {})[sourceId];
                const videoUrl = (initial.videoSources || {})[sourceId];
                const url = typeof imageUrl === 'string' && imageUrl ? imageUrl : videoUrl;
                if (typeof url !== 'string' || !url) return null;
                cutSourceNaturalSizes.set(sourceId, null);
                const isImage = typeof imageUrl === 'string' && Boolean(imageUrl);
                const probe = document.createElement(isImage ? 'img' : 'video');
                if (!isImage) {
                    probe.preload = 'metadata';
                    probe.muted = true;
                }
                probe.crossOrigin = 'anonymous';
                const settle = () => {
                    const width = isImage ? probe.naturalWidth : probe.videoWidth;
                    const height = isImage ? probe.naturalHeight : probe.videoHeight;
                    if (width > 0 && height > 0) {
                        cutSourceNaturalSizes.set(sourceId, { width, height });
                        updateCutSelectBox();
                        if (cropModeActive && photoCropTarget?.kind === 'cut'
                            && cutSelectionVideo().dataset.akariCutCropDeclared !== 'true') {
                            photoCropTarget.applyCropAndTransform(photoCropTarget.cropNow(),
                                photoCropTarget.cropEntryTransform(photoCropTarget.transformNow(), { width, height }));
                            photoCropTarget.flushCrop();
                        }
                        if (cropModeActive) updateLayerCropBox();
                    }
                    probe.removeAttribute('src');
                    if (!isImage) probe.load();
                };
                probe.addEventListener(isImage ? 'load' : 'loadedmetadata', settle, { once: true });
                probe.addEventListener('error', () => {
                    console.warn('[akari-preview] cut source size probe failed', sourceId);
                }, { once: true });
                probe.src = url;
                return null;
            };
            const cutNaturalSizeNow = () => {
                const measured = mediaNaturalSizeOf(cutMediaNow());
                if (measured.width > 0 && measured.height > 0) return measured;
                return ensureCutSourceNaturalSize() || { width: 0, height: 0 };
            };
            const cutCropNow = () => ({ ...clampCrop(
                Number(cutSelectionVideo().dataset.akariCropX),
                Number(cutSelectionVideo().dataset.akariCropY),
                Number(cutSelectionVideo().dataset.akariCropW),
                Number(cutSelectionVideo().dataset.akariCropH)
            ), ...(Number(cutSelectionVideo().dataset.akariCropRotate) ? { rotate: Number(cutSelectionVideo().dataset.akariCropRotate) } : {}) });
            // 幾何統一（別票）の移行済みマーカー。'source' = cut も最初からソース実寸基準なので、
            // fit の焼き込み（裁定 5）も framing 除外（裁定 6）も要らなくなる。未宣言なら従来どおり。
            const outputGeometry = summary.output && typeof summary.output.geometry === 'string'
                ? summary.output.geometry : undefined;
            const outputGeometryIsSource = outputGeometry === 'source';
            // crop / perspective / wipe の cut は素材実寸の箱を保つ。
            // transform-only の点はキーフレーム無しと同じ出力枠を使う。
            const cutUsesLayerStyleBox = () => cutSelectionVideo().dataset.akariCutLayerStyleActive === 'true'
                || outputGeometryIsSource;
            const cutSelectBoxGeometry = () => {
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const transform = typeof cutVisualTransformNow === 'function'
                    ? cutVisualTransformNow() : cutTransformNow();
                const natural = cutNaturalSizeNow();
                const scaleX = transform.scaleX ?? transform.scale;
                const scaleY = transform.scaleY ?? transform.scale;
                const useLayerStyle = cutUsesLayerStyleBox() && natural.width > 0 && natural.height > 0
                    && cutSelectionVideo().dataset.akariCutCropDeclared === 'true';
                const size = useLayerStyle
                    ? cutLayerStyleBoxPxFn(natural, cutCropNow(), scaleX, scaleY)
                    : { width: outputWidth * scaleX, height: outputHeight * scaleY };
                return {
                    width: size.width,
                    height: size.height,
                    centerX: outputWidth / 2 + transform.x,
                    centerY: outputHeight / 2 + transform.y,
                    rotate: transform.rotate
                };
            };
            const cutOutputBoundsForTransform = transform => {
                const box = cutSelectBoxGeometry();
                const current = cutVisualTransformNow();
                const radians = (box.rotate || 0) * Math.PI / 180;
                const width = Math.abs(box.width * Math.cos(radians)) + Math.abs(box.height * Math.sin(radians));
                const height = Math.abs(box.width * Math.sin(radians)) + Math.abs(box.height * Math.cos(radians));
                return outputBoundsForCenteredBox(box.centerX + transform.x - current.x,
                    box.centerY + transform.y - current.y, width, height);
            };
            // 裁定 4・6: cut の crop 書き戻しは v2 の item id を持つ cut だけ（legacy schema に
            // cuts[].crop の席が無い）。framing を持つ cut は layer-style が framing を捨てるので
            // 辺バーを出さない（幾何統一済みの文書では両立するため除外しない）。
            let cutCropNoticeKey = null;
            const cutCropEditable = () => {
                const media = cutSelectionVideo();
                const isV2 = Number(summary.editVersion) === 2;
                const editable = Boolean(media.dataset.akariCutId) && isV2
                    && (outputGeometryIsSource || media.dataset.akariCutFraming !== 'true');
                const noticeKey = !editable && cutSelected
                    ? String(summary.editVersion) + ':' + (media.dataset.akariCutId || media.dataset.akariCutIndex)
                    : null;
                if (noticeKey !== null && noticeKey !== cutCropNoticeKey) {
                    window.akari.showWriteError(!isV2
                        ? 'この編集データ（v1）ではクロップできません。v2 へ移行してください'
                        : 'この素材ではクロップできません。素材の ID とフレーミング設定を確認してください。');
                }
                cutCropNoticeKey = noticeKey;
                return editable;
            };
            const applyCutCropAndTransformNow = (crop, transform) => {
                cutPreviewPositionPatch = null;
                cutPreviewVisiblePosition = null;
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                // cutHasLayerStyleVisual は segment を見るので、ドラッグ中のモデルにも同じ crop を
                // 置いて描画レール（applyCutFramingVisual / applyCutLayerStyleLayout）を揃える。
                const segment = cutInteractionSegment();
                if (segment && segment.kind === 'src') segment.crop = { x: c.x, y: c.y, w: c.w, h: c.h,
                    ...(crop.rotate ? { rotate: crop.rotate } : {}) };
                cutSelectionVideo().dataset.akariCutTransformActive = 'true';
                for (const media of cutInteractionMedia()) {
                    media.dataset.akariCutLayerStyleActive = 'true';
                    media.dataset.akariCutCropDeclared = 'true';
                    media.dataset.akariCropX = String(c.x);
                    media.dataset.akariCropY = String(c.y);
                    media.dataset.akariCropW = String(c.w);
                    media.dataset.akariCropH = String(c.h);
                    media.dataset.akariCropRotate = String(crop.rotate || 0);
                    media.dataset.akariTransformX = String(transform.x);
                    media.dataset.akariTransformY = String(transform.y);
                    media.dataset.akariTransformScale = String(transform.scale);
                    media.dataset.akariTransformRotate = String(transform.rotate);
                }
                cutTransformVisualThrottle.call();
            };
            // Esc / 書き込み失敗の巻き戻しは、ドラッグ開始時点の segment.crop と両 media の
            // dataset をまるごと戻す（fit 焼き込みで layer-style へ移った分も含めて元に戻す）。
            const cutVisualSnapshot = () => {
                const segment = cutInteractionSegment();
                return {
                    segment,
                    crop: segment && segment.crop ? { ...segment.crop } : null,
                    media: cutInteractionMedia().map(media => ({ media, dataset: { ...media.dataset } }))
                };
            };
            const restoreCutVisual = snapshot => {
                if (!snapshot) return;
                cutPreviewPositionPatch = null;
                cutPreviewVisiblePosition = null;
                const segment = snapshot.segment;
                if (segment && segment.kind === 'src') {
                    if (snapshot.crop) segment.crop = { ...snapshot.crop };
                    else delete segment.crop;
                }
                for (const record of snapshot.media) {
                    for (const key of Object.keys(record.media.dataset)) {
                        if (!(key in record.dataset)) delete record.media.dataset[key];
                    }
                    for (const key of Object.keys(record.dataset)) {
                        record.media.dataset[key] = record.dataset[key];
                    }
                }
                cutTransformVisualThrottle.call();
            };
            // 裁定 0: layerDragTarget と同型の cut 版。角点 / 回転 / 辺バーの全てがこれを通る。
            const cutDragTarget = () => {
                const media = cutMediaNow();
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                return {
                    kind: 'cut',
                    entry: null,
                    media,
                    visible: cutInteractionVisible,
                    naturalSize: cutNaturalSizeNow,
                    transformNow: cutTransformNow,
                    visualNow: cutVisualTransformNow,
                    motionAt: () => {
                        const segment = cutInteractionSegment();
                        return motionAtForSpec(segment, segment?.outStart,
                            Number(segment?.outEnd) - Number(segment?.outStart));
                    },
                    cropNow: cutCropNow,
                    // 素材実寸の箱へ初めて入るときは、従来どおり fit を scale へ焼く。
                    cropEntryTransform: (transform, natural) => (
                        cutSelectionVideo().dataset.akariCutCropDeclared !== 'true'
                            ? cutLayerStyleEntryTransformFn(
                                transform, natural.width, natural.height, outputWidth, outputHeight, outputGeometry
                            )
                            : { ...transform }
                    ),
                    applyTransform: applyCutTransformNow,
                    applyCropAndTransform: applyCutCropAndTransformNow,
                    cropRestorePoint: cutVisualSnapshot,
                    restoreCrop: restoreCutVisual,
                    flushTransform: () => cutTransformVisualThrottle.flush(),
                    flushCrop: () => cutTransformVisualThrottle.flush(),
                    canWrite: () => {
                        const cutIndex = Number(cutSelectionVideo().dataset.akariCutIndex);
                        return Number.isInteger(cutIndex) && cutIndex >= 0;
                    },
                    write: patch => window.akari.engine.cutWrite(
                        Number(cutSelectionVideo().dataset.akariCutIndex),
                        cutSelectionVideo().dataset.akariCutId || undefined,
                        patch
                    )
                };
            };
            const updateCutSelectBox = () => {
                if (requestedCutId !== undefined) {
                    const requested = cutInteractionSegment();
                    cutSelected = !!requested && outputTime >= requested.outStart && outputTime < requested.outEnd;
                }
                const hasCut = cutSelectionVideo().dataset.akariCutIndex !== '' && cutSelectionVideo().dataset.akariCutIndex !== undefined;
                // 静止画セグメント中は video が hidden のまま #preview-still が本編の見た目を
                // 担っているため、「本編が見えているか」は両方で判定する。
                if (!cutSelected || !hasCut || !cutInteractionVisible()) {
                    cutSelectBox.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const box = cutSelectBoxGeometry();
                const screenW = box.width * frameScale;
                const screenH = box.height * frameScale;
                const screenCenterX = frameRect.x + box.centerX * frameScale;
                const screenCenterY = frameRect.y + box.centerY * frameScale;
                cutSelectBox.style.left = (screenCenterX - screenW / 2) + 'px';
                cutSelectBox.style.top = (screenCenterY - screenH / 2) + 'px';
                cutSelectBox.style.width = screenW + 'px';
                cutSelectBox.style.height = screenH + 'px';
                cutSelectBox.style.transform = 'rotate(' + box.rotate + 'deg)';
                cutSelectBox.classList.add('is-active');
                const selectionRect = cutSelectBox.getBoundingClientRect();
                const stageScale = previewStage.getBoundingClientRect().width / previewStage.offsetWidth || 1;
                const actions = previewLayerActionsFn(previewPane.getBoundingClientRect(),
                    selectionRect, floatingMenuRect, stageScale);
                if (actions) for (const handle of cutHandleElements) {
                    const kind = handle.dataset.akariHandle;
                    if (kind !== 'rotate' && kind !== 'move') continue;
                    const rect = kind === 'rotate' ? actions.rotate : actions.move;
                    const center = previewChromeLocalPointFn(selectionRect,
                        { width: cutSelectBox.offsetWidth, height: cutSelectBox.offsetHeight },
                        box.rotate, stageScale,
                        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                    handle.style.left = center.x + 'px';
                    handle.style.top = center.y + 'px';
                }
                applyCropEdgeVisibility(cutSelectBox, screenW, screenH, cutCropEditable());
            };
            const selectCut = options => {
                const report = !options || options.report !== false;
                requestedOverlayId = null;
                window.akari.interaction?.clearSelection?.();
                if (report) requestedCutId = video.dataset.akariCutId;
                if (cutSelected) {
                    updateCutSelectBox();
                    if (report) window.akari.reportCutSelection(cutSelectionVideo().dataset.akariCutId || null);
                    return;
                }
                cutSelected = true;
                ensureCutSourceNaturalSize();
                selectLayer(null, { report: false });
                if (typeof deselectCaption === 'function') deselectCaption({ report: false });
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(cutSelectionVideo().dataset.akariCutId || null);
            };
            const deselectCut = options => {
                const report = !options || options.report !== false;
                if (cropModeActive && !selectedLayerId) setCropMode(false);
                if (report) requestedCutId = undefined;
                if (!cutSelected) {
                    updateCutSelectBox();
                    return;
                }
                cutSelected = false;
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(null);
            };
            for (const handle of cutHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !cutSelected) return;
                    const corner = handle.dataset.akariHandle;
                    const boxRect = cutSelectBox.getBoundingClientRect();
                    const center = { x: boxRect.left + boxRect.width / 2, y: boxRect.top + boxRect.height / 2 };
                    // 裁定 0: cut の枠にも layer と同じ回転ハンドル + ステムを出す。cut は箱の中心
                    // （出力中心 + transform.x/y）がそのまま回転ピボットなのでオフセット補正は要らない。
                    if (corner === 'rotate') {
                        const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
                        beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {
                            const angle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180 / Math.PI;
                            const rotate = original.rotate + (angle - startAngle);
                            return { ...original, rotate: window.akariHandleGeometry?.snapAngle(rotate,
                                moveEvent.metaKey || moveEvent.ctrlKey) ?? rotate };
                        });
                        return;
                    }
                    if (corner === 'move') {
                        const translate = pointerTranslationFrom(event);
                        let dragSnap = { x: null, y: null };
                        beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {
                            const movement = translate(moveEvent);
                            if (moveEvent.shiftKey) {
                                if (Math.abs(movement.x) >= Math.abs(movement.y)) movement.y = 0;
                                else movement.x = 0;
                            }
                            let x = original.x + movement.x, y = original.y + movement.y;
                            if (!moveEvent.metaKey && !moveEvent.ctrlKey && window.akari.interaction) {
                                const outputWidth = Number(summary.output?.width) || 1280;
                                const outputHeight = Number(summary.output?.height) || 720;
                                const snap = window.akari.interaction.computeSnapCorrection(
                                    cutOutputBoundsForTransform({ ...cutVisualTransformNow(), x, y }), dragSnap,
                                    { kind: 'cut' });
                                dragSnap = snap;
                                x += snap.x?.correction ?? 0; y += snap.y?.correction ?? 0;
                                window.akari.interaction.showSnapGuides(snap.x, snap.y);
                            } else { dragSnap = { x: null, y: null }; window.akari.interaction?.hideSnapGuides?.(); }
                            return { ...original, x, y };
                        });
                        return;
                    }
                    if (!['nw', 'ne', 'se', 'sw'].includes(corner)) return;
                    // 裁定 7: crop を持つ cut は「ソース実寸 × crop × scale」の箱で描かれる。
                    // 角ドラッグの基準 box も選択枠と同じ cutSelectBoxGeometry から取る。
                    const startBox = cutSelectBoxGeometry();
                    const { anchor, dragged } = cutResizeCornersFn(startBox, corner);
                    const pointerStart = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                    if (!pointerStart) return;
                    let dragSnap = { x: null, y: null };
                    beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {
                        const pointer = window.akari.interaction?.stageLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
                        if (!pointer) return original;
                        let nextScale = cutResizeScaleFn(original.scale, anchor, dragged, pointerStart, pointer);
                        if (moveEvent.metaKey || moveEvent.ctrlKey || !window.akari.interaction?.computeAnchorResizeSnap) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const solved = window.akari.interaction.computeAnchorResizeSnap({
                                anchorStageX: anchor.x,
                                anchorStageY: anchor.y,
                                draggedStageX: dragged.x,
                                draggedStageY: dragged.y,
                                startScale: original.scale,
                                scale: nextScale,
                                snapX: dragSnap.x,
                                snapY: dragSnap.y
                            });
                            if (solved) {
                                nextScale = solved.scale;
                                dragSnap = { x: solved.snapX, y: solved.snapY };
                            }
                        }
                        const translated = window.akari.interaction.anchorPreservingTranslate({
                            startX: original.x, startY: original.y, startScale: original.scale,
                            scale: nextScale, anchorStageX: anchor.x, anchorStageY: anchor.y
                        });
                        return translated ? { ...original, ...translated, scale: nextScale } : original;
                    });
                });
            }
            const photoCutPoint = event => {
                const stage = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                if (!stage) return null;
                const box = cutSelectBoxGeometry();
                if (!(box.width > 0 && box.height > 0)) return null;
                const rad = -box.rotate * Math.PI / 180;
                const dx = stage.x - box.centerX, dy = stage.y - box.centerY;
                const x = (dx * Math.cos(rad) - dy * Math.sin(rad)) / box.width + .5;
                const y = (dx * Math.sin(rad) + dy * Math.cos(rad)) / box.height + .5;
                if (x < 0 || x > 1 || y < 0 || y > 1) return null;
                const crop = cutCropNow();
                return [crop.x + x * crop.w, crop.y + y * crop.h];
            };
            cutSelectBox.addEventListener('pointerdown', event => {
                if (!photoSelect || photoSelect.itemId !== cutSelectionVideo().dataset.akariCutId || event.button !== 0) return;
                const point = photoCutPoint(event);
                if (!point) return;
                event.preventDefault(); event.stopImmediatePropagation();
                window.akari.reportPhotoClick(photoSelect.itemId, point);
            }, true);
            cutSelectBox.addEventListener('pointermove', event => {
                if (!photoSelect || photoSelect.itemId !== cutSelectionVideo().dataset.akariCutId
                    || performance.now() - photoHoverLastMs < 32) return;
                photoHoverLastMs = performance.now();
                window.akari.reportPhotoHover(photoSelect.itemId, photoCutPoint(event));
            }, true);
            cutSelectBox.addEventListener('pointerleave', () => {
                if (photoSelect?.itemId === cutSelectionVideo().dataset.akariCutId)
                    window.akari.reportPhotoHover(photoSelect.itemId, null);
            });
            new ResizeObserver(() => updateCutSelectBox()).observe(wrapper);
            // 裁定 1・2: 四辺中央の辺バー。cut と layer の両方が同じ beginMediaCropDrag へ入る
            // （モード切替は無く、選択直後からそのまま掴める）。
            const cropEdgeHandleElements = [
                ...Array.from(layerSelectBox.querySelectorAll('[data-akari-crop-edge]'))
                    .map(element => ({ element, kind: 'layer' })),
                ...Array.from(cutSelectBox.querySelectorAll('[data-akari-crop-edge]'))
                    .map(element => ({ element, kind: 'cut' }))
            ];
            for (const edge of cropEdgeHandleElements) {
                edge.element.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                let target = null;
                if (edge.kind === 'cut') {
                    if (!cutSelected || !cutCropEditable()) return;
                    target = cutDragTarget();
                } else {
                    if (!selectedLayerId || cropModeActive || layerSelectBox.classList.contains('akari-selected-invisible')) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    target = layerDragTarget(entry);
                }
                beginMediaCropDrag(target, edge.element.getAttribute('data-akari-crop-edge'), event);
                });
            }

            // 通常ドラッグは cue 固有位置、Alt ドラッグは default_text_style のグループ位置を書く。
            // positionFromRects は common/caption-zone-write.ts の純関数と同じ規則を webview 内へ
            // 最小複製する（既存の caption style 変数ミラーと同じ方式）。
            let selectedCaptionId = null;
            const captionStylePreview = (${createCaptionStylePreviewController.toString()})(
                (style, output) => window.AkariEditKernel.resolveCaptionLineStyleVars(style, output),
                family => document.fonts.load('400 19px ' + JSON.stringify(family), 'あ字'),
                () => renderCaption(), summary.output);
            let pendingCaptionDragReload = false;
            // 表示系の切り替えはプレビューのセッション中だけ保持する。
            const captionClampOverrides = new Map();
            const captionClampEnabled = caption => captionClampOverrides.get(caption?.sourceCueId || caption?.id)
                ?? false;
            let captionSnapEnabled = true;
            let captionGroupToolEnabled = false;
            let captionDragGroupActive = false;
            let captionRowBoxEnabled = false;
            let captionPaletteTab = 'text';
            const captionRecentColors = [];
            const captionCushionOpacity = new Map();
            // textStyle は default_text_style とマージ済みなので、初期表示だけは cue 固有位置を推定する。
            // 書き込み後はこの Map を正としてグループ既定と cue 固有位置を区別する。
            const captionCuePositionKnown = new Map();
            const captionSelectBox = document.getElementById('caption-select-box');
            const captionMultiSelectBoxes = document.createElement('div');
            captionMultiSelectBoxes.id = 'caption-multi-select-boxes';
            captionSelectBox.parentElement.appendChild(captionMultiSelectBoxes);
            const previewChrome = document.createElement('div');
            previewChrome.id = 'preview-chrome-layer';
            document.body.appendChild(previewChrome);
            for (const id of ['layer-select-box', 'layer-crop-box', 'photo-crop-controls',
                'layer-crop-toggle', 'layer-perspective-toggle', 'layer-perspective-panel',
                'cut-select-box', 'caption-zone-highlight', 'zone-hint-layer', 'caption-row-box',
                'caption-select-box', 'caption-multi-select-boxes']) {
                const element = document.getElementById(id);
                if (element) previewChrome.appendChild(element);
            }
            let previousChromeGeometry = null;
            const chromeRefreshers = {
                layer: () => updateLayerSelectBox(),
                cut: () => updateCutSelectBox(),
                crop: () => updateLayerCropBox(),
                caption: () => updateCaptionSelectBox()
            };
            const syncPreviewChrome = () => {
                const rect = previewStage.getBoundingClientRect();
                const scaleX = rect.width / previewStage.offsetWidth || 1;
                const scaleY = rect.height / previewStage.offsetHeight || 1;
                previewChrome.style.left = rect.left + 'px';
                previewChrome.style.top = rect.top + 'px';
                previewChrome.style.width = previewStage.offsetWidth + 'px';
                previewChrome.style.height = previewStage.offsetHeight + 'px';
                previewChrome.style.transform = 'scale(' + scaleX + ',' + scaleY + ')';
                previewChrome.dataset.frameEngineActive = previewStage.dataset.frameEngineActive || '';
                const viewport = previewPane.getBoundingClientRect();
                previousChromeGeometry = refreshPreviewChromeOnGeometryChangeFn(
                    previousChromeGeometry, rect, viewport, chromeRefreshers);
                const cropControls = previewChrome.querySelector('#photo-crop-controls');
                if (cropControls) cropControls.style.maxWidth = Math.max(80, (viewport.width - 8) / scaleX) + 'px';
                for (const selector of ['#layer-crop-toggle.is-target-active',
                    '#layer-perspective-toggle.is-target-active', '#layer-perspective-panel.is-open',
                    '#photo-crop-controls.is-active', '#caption-select-box [data-akari-run-menu]:not([hidden])',
                    '#caption-select-box [data-caption-palette]:not([hidden])']) {
                    const control = previewChrome.querySelector(selector);
                    if (!control) continue;
                    control.style.translate = '';
                    const menuRect = control.getBoundingClientRect();
                    const captionMenu = control.matches('[data-akari-run-menu], [data-caption-palette]');
                    const offset = captionMenu ? (() => {
                        const toolbar = captionSelectBox.querySelector('.akari-caption-select-tools');
                        const actions = [...captionSelectBox.querySelectorAll('.akari-caption-handle[data-h="rot"], .akari-caption-handle[data-h="move"]')]
                            .map(handle => handle.getBoundingClientRect());
                        const avoid = [toolbar.getBoundingClientRect(), captionSelectBox.getBoundingClientRect(), ...actions];
                        if (previewChromeRectClearFn(viewport, menuRect, avoid)) return { x: 0, y: 0 };
                        const placed = placePreviewChromeToolbarFn(viewport, toolbar.getBoundingClientRect(),
                            menuRect, [captionSelectBox.getBoundingClientRect(), ...actions]);
                        return { x: placed.left - menuRect.left, y: placed.top - menuRect.top };
                    })() : previewChromeMenuOffsetFn(viewport,
                        control.closest('#layer-select-box')?.getBoundingClientRect()
                            || previewStage.getBoundingClientRect(), menuRect);
                    if (captionMenu) {
                        const angle = (Number.parseFloat(captionSelectBox.style.getPropertyValue('--caption-box-rotate')) || 0)
                            * Math.PI / 180;
                        control.style.translate = ((offset.x * Math.cos(angle) + offset.y * Math.sin(angle)) / scaleX)
                            + 'px ' + ((-offset.x * Math.sin(angle) + offset.y * Math.cos(angle)) / scaleY) + 'px';
                    } else {
                        control.style.translate = (offset.x / scaleX) + 'px ' + (offset.y / scaleY) + 'px';
                    }
                }
                requestAnimationFrame(syncPreviewChrome);
            };
            requestAnimationFrame(syncPreviewChrome);
            const previewChromeMenuOffsetFn = (${previewChromeMenuOffset.toString()});
            const previewChromeLocalPointFn = (${previewChromeLocalPoint.toString()});
            const previewChromeRectClearFn = (${previewChromeRectClear.toString()});
            const placePreviewChromeToolbarFn = (${placePreviewChromeToolbar.toString()});
            const refreshPreviewChromeOnGeometryChangeFn = (${refreshPreviewChromeOnGeometryChange.toString()});
            const captionTool = name => captionSelectBox.querySelector('[data-caption-tool="' + name + '"]');
            const setCaptionToolTip = (name, message) => {
                captionTool(name).querySelector('.akari-caption-tool-tip').textContent = message;
            };
            const captionClampChip = captionTool('clamp');
            const captionPositionReset = captionTool('reset');
            const captionPalette = captionSelectBox.querySelector('[data-caption-palette]');
            const captionRunMenu = captionSelectBox.querySelector('[data-akari-run-menu]');
            const runSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            const currentRunSelection = () => {
                if (!activeCaptionEdit || activeCaptionEdit.captionId !== selectedCaptionId) return null;
                const selection = window.getSelection();
                if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
                const range = selection.getRangeAt(0);
                const element = activeCaptionEdit.element;
                if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
                const prefix = range.cloneRange();
                prefix.selectNodeContents(element);
                prefix.setEnd(range.startContainer, range.startOffset);
                return captionRunSelectionRangeFn(prefix.toString(), range.toString()) || null;
            };
            const layoutCaptionRunTools = () => {
                const tools = captionSelectBox.querySelector('.akari-caption-select-tools');
                if (!currentRunSelection() || !captionSelectBox.classList.contains('is-active')) {
                    tools.style.left = '';
                    tools.style.top = '';
                    tools.style.bottom = '';
                    captionSelectBox.style.removeProperty('--akari-run-toolbar-max');
                    return;
                }
                captionSelectBox.style.setProperty('--akari-run-toolbar-max',
                    Math.max(120, stage.clientWidth - 16) + 'px');
                tools.style.left = '50%';
                tools.style.top = '';
                tools.style.bottom = '';
                const frame = stage.getBoundingClientRect();
                const anchor = captionSelectBox.getBoundingClientRect();
                const tool = tools.getBoundingClientRect();
                const placed = captionRunToolbarPlacementFn(frame, anchor, tool);
                const scaleX = anchor.width / captionSelectBox.offsetWidth || 1;
                const scaleY = anchor.height / captionSelectBox.offsetHeight || 1;
                tools.style.left = ((placed.centerX - anchor.left) / scaleX) + 'px';
                tools.style.top = ((placed.top - anchor.top) / scaleY) + 'px';
                tools.style.bottom = 'auto';
            };
            window.akari.layoutCaptionRunTools = layoutCaptionRunTools;
            const fitCaptionSelectTools = () => {
                const tools = captionSelectBox.querySelector('.akari-caption-select-tools');
                const viewport = previewPane.getBoundingClientRect();
                const stageScale = previewStage.getBoundingClientRect().width / previewStage.offsetWidth || 1;
                captionSelectBox.style.setProperty('--akari-chrome-tools-max',
                    Math.max(1, (viewport.width - 8) / stageScale) + 'px');
                if (!currentRunSelection()) {
                    tools.style.left = '';
                    tools.style.top = '';
                    tools.style.bottom = '';
                }
                const rect = tools.getBoundingClientRect();
                const anchor = captionSelectBox.getBoundingClientRect();
                const actions = [...captionSelectBox.querySelectorAll('.akari-caption-handle[data-h="rot"], .akari-caption-handle[data-h="move"]')]
                    .map(handle => handle.getBoundingClientRect());
                const placed = placePreviewChromeToolbarFn(viewport, anchor, rect, actions);
                const dx = placed.left - rect.left;
                const dy = placed.top - rect.top;
                if (dx || dy) {
                    const angle = (Number.parseFloat(captionSelectBox.style.getPropertyValue('--caption-box-rotate')) || 0)
                        * Math.PI / 180;
                    tools.style.left = (tools.offsetLeft + (dx * Math.cos(angle) + dy * Math.sin(angle)) / stageScale) + 'px';
                    tools.style.top = (tools.offsetTop + (-dx * Math.sin(angle) + dy * Math.cos(angle)) / stageScale) + 'px';
                    tools.style.bottom = 'auto';
                }
            };
            const syncRunSelection = () => {
                const selected = currentRunSelection();
                captionSelectBox.dataset.akariRunFrom = selected ? String(selected.from) : '';
                captionSelectBox.dataset.akariRunTo = selected ? String(selected.to) : '';
                for (const tool of captionSelectBox.querySelectorAll('[data-akari-run-tool]')) tool.hidden = !selected;
                if (!selected) captionRunMenu.hidden = true;
                layoutCaptionRunTools();
            };
            window.akari.syncRunSelection = syncRunSelection;
            document.addEventListener('selectionchange', syncRunSelection);
            const writeCaptionRun = edit => {
                const selected = currentRunSelection();
                if (!activeCaptionEdit || !selected) return;
                const captionId = activeCaptionEdit.captionId;
                void window.akari.engine.captionWrite(captionId, { run: { ...selected, ...edit } })
                    .catch(error => window.akari.showWriteError(error));
            };
            const selectedRunStyle = () => {
                const selected = currentRunSelection();
                const caption = selectedCaption();
                return caption?.runs?.filter(run => selected && run.from === selected.from && run.to === selected.to)
                    .at(-1)?.style || {};
            };
            const selectEditorGraphemes = (element, from, to) => {
                if (!element || !Number.isInteger(from) || !Number.isInteger(to)
                    || from < 0 || to < from
                    || to > Array.from(runSegmenter.segment(element.textContent || '')).length) return false;
                const nodes = [];
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) nodes.push(walker.currentNode);
                const pointAt = index => {
                    let cursor = 0;
                    for (const node of nodes) {
                        const parts = Array.from(runSegmenter.segment(node.textContent || ''));
                        if (index <= cursor + parts.length) {
                            const local = index - cursor;
                            return { node, offset: local < parts.length
                                ? parts[local].index : (node.textContent || '').length };
                        }
                        cursor += parts.length;
                    }
                    const node = nodes[nodes.length - 1];
                    return node ? { node, offset: (node.textContent || '').length } : null;
                };
                const start = pointAt(from);
                const end = pointAt(to);
                const selection = window.getSelection();
                if (!start || !end || !selection) return false;
                const range = document.createRange();
                range.setStart(start.node, start.offset);
                range.setEnd(end.node, end.offset);
                selection.removeAllRanges();
                selection.addRange(range);
                return true;
            };
            const refreshActiveCaptionRuns = () => {
                const edit = activeCaptionEdit;
                if (!edit) return;
                const caption = captions.find(item => (item.sourceCueId || item.id) === edit.captionId);
                if (!caption) return;
                const element = edit.element;
                const text = element.innerText || '';
                // Leave in-progress typing and IME composition alone until the text is committed.
                if (text !== caption.text) return;
                const selection = window.getSelection();
                const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
                const inside = range && element.contains(range.startContainer) && element.contains(range.endContainer);
                const offsetAt = (node, offset) => {
                    const prefix = document.createRange();
                    prefix.selectNodeContents(element);
                    prefix.setEnd(node, offset);
                    return Array.from(runSegmenter.segment(prefix.toString())).length;
                };
                const from = inside ? offsetAt(range.startContainer, range.startOffset) : null;
                const to = inside ? offsetAt(range.endContainer, range.endOffset) : null;
                if (caption.runs?.length) {
                    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    const holder = document.createElement('div');
                    holder.innerHTML = renderCaptionRuns('<p class="akari-caption__line">' + escaped + '</p>',
                        text, caption.runs);
                    const line = holder.querySelector('.akari-caption__line');
                    const content = line?.querySelector('.akari-caption__tok') || line;
                    if (!content) return;
                    element.replaceChildren(...Array.from(content.childNodes));
                } else if (element.querySelector('.akari-caption__run')) {
                    element.textContent = text;
                } else return;
                if (from !== null && to !== null) selectEditorGraphemes(element, from, to);
                window.akari.syncRunSelection?.();
            };
            window.akari.refreshActiveCaptionRuns = refreshActiveCaptionRuns;
            const captionRowBox = document.getElementById('caption-row-box');
            const captionRowBoxToggle = document.getElementById('caption-row-box-toggle');
            const captionZoneHighlight = document.getElementById('caption-zone-highlight');
            const ZONE_ROW_RANGES = { top: [0, 1 / 3], middle: [1 / 3, 2 / 3], bottom: [2 / 3, 1] };
            const ZONE_COL_RANGES = { left: [0, 1 / 3], center: [1 / 3, 2 / 3], right: [2 / 3, 1] };
            const zoneParts = zone => {
                if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
                if (zone === 'center') return { row: 'middle', col: 'center' };
                if (zone === 'top') return { row: 'top', col: 'center' };
                if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
                const [row, col] = zone.split('-');
                return { row, col };
            };
            const zoneHintLayer = document.getElementById('zone-hint-layer');
            let zoneHintTimeoutId;
            const clearZoneHints = () => { zoneHintLayer.replaceChildren(); };
            const showZoneHints = (zones, durationMs) => {
                clearZoneHints();
                const frameRect = window.akari.computeOutputFrameRect();
                for (const zone of zones) {
                    const { row, col } = zoneParts(zone);
                    const rowRange = ZONE_ROW_RANGES[row] || ZONE_ROW_RANGES.bottom;
                    const colRange = ZONE_COL_RANGES[col] || ZONE_COL_RANGES.center;
                    const box = document.createElement('div');
                    box.className = 'zone-hint-box';
                    Object.assign(box.style, {
                        left: (frameRect.x + frameRect.width * colRange[0]) + 'px',
                        top: (frameRect.y + frameRect.height * rowRange[0]) + 'px',
                        width: (frameRect.width * (colRange[1] - colRange[0])) + 'px',
                        height: (frameRect.height * (rowRange[1] - rowRange[0])) + 'px'
                    });
                    zoneHintLayer.appendChild(box);
                }
                clearTimeout(zoneHintTimeoutId);
                zoneHintTimeoutId = setTimeout(clearZoneHints, durationMs);
            };
            layersStage.addEventListener('animationend', event => {
                if (event.animationName === 'akari-focus-pulse-anim') {
                    event.target.classList.remove('akari-focus-pulse');
                }
            });
            const captionOutputFrame = () => ({
                x: 0,
                y: 0,
                width: Number(summary.output && summary.output.width) || 1280,
                height: Number(summary.output && summary.output.height) || 720
            });
            const captionAxisPlacementFn = (${captionAxisPlacement.toString()});
            const captionZonePlacementFn = (${captionZonePlacement.toString()});
            const roundedCaptionStrokeShadowsFn = (${roundedCaptionStrokeShadows.toString()});
            const captionWrapFitWidthFn = (${captionWrapFitWidth.toString()});
            const captionWrapFitPositionFn = (${captionWrapFitPosition.toString()});
            const clearCaptionSideActionsFn = (${clearCaptionSideActions.toString()});
            const captionOutputPoint = (clientX, clientY) => {
                const point = window.akari.interaction?.stageLocalPoint?.(clientX, clientY);
                if (point) return point;
                const stageRect = stage.getBoundingClientRect();
                const displayScale = (window.akari.stageScale() || 1) * zoom;
                return {
                    x: (clientX - stageRect.left) / displayScale,
                    y: (clientY - stageRect.top) / displayScale
                };
            };
            const captionVisualRect = (captionPlate = selectedCaptionPlate()) => {
                const block = captionPlate.querySelector('.akari-caption__block');
                const elements = block ? [block] : [...captionPlate.querySelectorAll('.akari-caption__line')];
                const rects = (elements.length > 0 ? elements : [captionPlate])
                    .concat([...captionPlate.querySelectorAll('.akari-caption__run')])
                    .map(element => element.getBoundingClientRect());
                const clientRect = {
                    left: Math.min(...rects.map(rect => rect.left)),
                    right: Math.max(...rects.map(rect => rect.right)),
                    top: Math.min(...rects.map(rect => rect.top)),
                    bottom: Math.max(...rects.map(rect => rect.bottom))
                };
                const topLeft = captionOutputPoint(clientRect.left, clientRect.top);
                const bottomRight = captionOutputPoint(clientRect.right, clientRect.bottom);
                return {
                    left: topLeft.x,
                    right: bottomRight.x,
                    top: topLeft.y,
                    bottom: bottomRight.y
                };
            };
            const frameCaptionPosition = (candidate, value) => candidate?.textStyle?.background?.fit === 'frame'
                || candidate?.textStyleVars?.['--caption-plate-fit'] === 'frame'
                ? { ...value, anchor: value.anchor[0] + 'c', position: { y: value.position.y } } : value;
            const captionLayoutRect = (captionPlate = selectedCaptionPlate()) => {
                const plate = captionPlate.querySelector('.akari-caption__plate') || captionPlate;
                const previousTransform = plate.style.transform;
                const previousRotate = plate.style.rotate;
                const previousScale = plate.style.scale;
                plate.style.transform = 'none';
                plate.style.rotate = 'none';
                plate.style.scale = 'none';
                try {
                    const ink = captionVisualRect(captionPlate);
                    const bounds = plate.getBoundingClientRect();
                    const a = captionOutputPoint(bounds.left, bounds.top);
                    const b = captionOutputPoint(bounds.right, bounds.bottom);
                    return { ...ink, pivot: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
                }
                finally {
                    plate.style.transform = previousTransform;
                    plate.style.rotate = previousRotate;
                    plate.style.scale = previousScale;
                }
            };
            // overlay-runtime の stage 外にある写真と caption も、表示中の選択枠と同じ座標で渡す。
            window.akari.interaction?.setExtraSnapTargets?.(moving => {
                const targets = [];
                for (const entry of layerEntries) {
                    if (moving?.kind === 'layer' && moving.id === entry.spec.id) continue;
                    if (!entry.video.isConnected || entry.video.style.display === 'none'
                        || entry.video.hidden || entry.spec?.proxyMissing || entry.spec?.retiredTelop) continue;
                    const bounds = layerOutputBoundsForTransform(entry, layerVisualTransformNow(entry));
                    if (bounds) targets.push(bounds);
                }
                if (moving?.kind !== 'cut' && cutInteractionSegment()
                    && cutSelectionVideo().style.display !== 'none' && !cutSelectionVideo().hidden) {
                    targets.push(cutOutputBoundsForTransform(cutVisualTransformNow()));
                }
                for (const row of captionRows.values()) {
                    const id = row.caption.sourceCueId || row.caption.id;
                    if (moving?.kind === 'caption' && (moving.id === id || moving.ids?.includes(id))) continue;
                    if (!row.plate.isConnected || row.plate.hidden || row.plate.style.display === 'none') continue;
                    const rect = captionVisualRect(row.plate);
                    if ([rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)
                        && rect.right > rect.left && rect.bottom > rect.top) {
                        targets.push({ ...rect, centerX: (rect.left + rect.right) / 2,
                            centerY: (rect.top + rect.bottom) / 2 });
                    }
                }
                return targets;
            });
            const captionTransformValues = captionPlate => {
                const style = getComputedStyle(captionPlate);
                const scale = Number.parseFloat(style.getPropertyValue('--caption-scale'));
                const rotate = Number.parseFloat(style.getPropertyValue('--caption-rotate'));
                return {
                    scale: Number.isFinite(scale) ? scale : 1,
                    rotate: Number.isFinite(rotate) ? rotate : 0
                };
            };
            const captionControlScaleFn = (${captionControlScale.toString()});
            const captionEdgeHandleLayoutFn = (${captionEdgeHandleLayout.toString()});
            const captionOrientedFrameFn = (${captionOrientedFrame.toString()});
            const captionWrapAnchorDeltaFn = (${captionWrapAnchorDelta.toString()});
            const captionWrapResizeFn = (${captionWrapResize.toString()});
            const captionEditorLinesFn = (${captionEditorLines.toString()});
            const captionEditorWrapWidthFn = (${captionEditorWrapWidth.toString()});
            const captionLineCountFromMetricsFn = (${captionLineCountFromMetrics.toString()});
            const captionEditorFitWidthFn = (${captionEditorFitWidth.toString()});
            const captionEditorValueFn = (${captionEditorValue.toString()});
            const captionEditKeyActionFn = (${captionEditKeyAction.toString()});
            const captionEditingNavigationKeyFn = (${captionEditingNavigationKey.toString()});
            const syncCaptionHandleBox = () => {
                const box = captionSelectBox.querySelector('.akari-caption-handle-box');
                if (!box) return;
                const display = previewStage.getBoundingClientRect();
                const vars = captionControlScaleFn(previewStage.offsetWidth, display.width,
                    previewStage.offsetHeight, display.height);
                for (const [name, value] of Object.entries(vars)) box.style.setProperty(name, value);
            };
            const setRectStyle = (element, rect) => {
                element.style.left = rect.left + 'px';
                element.style.top = rect.top + 'px';
                element.style.width = Math.max(0, rect.right - rect.left) + 'px';
                element.style.height = Math.max(0, rect.bottom - rect.top) + 'px';
            };
            const selectedCaption = () => captions.find(
                candidate => (candidate.sourceCueId || candidate.id) === selectedCaptionId
            );
            const captionHasCuePosition = caption => {
                if (!caption) return false;
                const id = caption.sourceCueId || caption.id;
                if (!id) return false;
                if (captionCuePositionKnown.has(id)) return captionCuePositionKnown.get(id);
                const style = caption.textStyle;
                return !!(style && (style.text_anchor || style.position));
            };
            const updateCaptionSelectTools = () => {
                const caption = selectedCaption();
                const clampOn = !!selectedCaptionId && captionClampEnabled(caption);
                const groupOn = captionGroupToolEnabled || captionDragGroupActive;
                captionClampChip.classList.toggle('on', clampOn);
                captionTool('snap').classList.toggle('on', captionSnapEnabled);
                captionTool('snap').setAttribute?.('aria-pressed', String(captionSnapEnabled));
                captionTool('group').classList.toggle('on', groupOn);
                captionTool('bold').classList.toggle('on',
                    (caption?.textStyle?.weight ?? caption?.textStyle?.font_weight) === 900);
                const background = caption?.textStyle?.background;
                const cushionOn = !!background && (background.opacity ?? (background.color ? 1 : 0)) > 0;
                captionTool('cushion').classList.toggle('on', cushionOn);
                setCaptionToolTip('group', groupOn
                    ? '全字幕が動く — もう一度押すと「この字幕だけ」'
                    : 'この字幕だけ動く — 押すと全字幕をまとめて動かす（⌥ドラッグでも可）');
                setCaptionToolTip('snap', '吸着 ' + (captionSnapEnabled ? 'ON' : 'OFF')
                    + ' — 近づくと中央・端に吸い付く。⌥ドラッグで一時的に無効');
                setCaptionToolTip('clamp', 'はみ出し防止 ' + (clampOn ? 'ON' : 'OFF')
                    + ' — ON で画面の内側に押し戻す');
                setCaptionToolTip('cushion', '座布団 ' + (cushionOn ? 'ON' : 'OFF')
                    + ' — 形・余白・角丸はインスペクターで');
                captionTool('color').style.setProperty('--caption-tool-color', caption?.textStyle?.color || '#ffffff');
                captionPositionReset.hidden = !captionHasCuePosition(caption)
                    && !(Number.isFinite(caption?.textStyle?.scale) && caption.textStyle.scale !== 1)
                    && !(Number.isFinite(caption?.textStyle?.rotate) && caption.textStyle.rotate !== 0);
            };
            const setCaptionGroupMode = groupMode => {
                captionDragGroupActive = groupMode;
                captionSelectBox.toggleAttribute('data-alt-all', captionGroupToolEnabled || captionDragGroupActive);
                updateCaptionSelectTools();
            };
            const updateCaptionSelectBoxForRect = rect => {
                syncCaptionHandleBox();
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    captionSelectBox.style.transform = '';
                    captionPalette.hidden = true;
                    captionRowBox.classList.remove('is-active');
                    updateCaptionSelectTools();
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const selectedPlate = selectedCaptionPlate();
                const captionTransform = captionTransformValues(selectedPlate);
                const oriented = captionOrientedFrameFn(captionLayoutRect(selectedPlate),
                    captionTransform.scale, captionTransform.rotate);
                setRectStyle(captionSelectBox, {
                    left: frameRect.x + (oriented.center.x - oriented.width / 2) * frameScale,
                    right: frameRect.x + (oriented.center.x + oriented.width / 2) * frameScale,
                    top: frameRect.y + (oriented.center.y - oriented.height / 2) * frameScale,
                    bottom: frameRect.y + (oriented.center.y + oriented.height / 2) * frameScale
                });
                const chromeScaleY = previewStage.offsetHeight > 0
                    && previewStage.getBoundingClientRect().height > 0
                    ? previewStage.getBoundingClientRect().height / previewStage.offsetHeight : 1;
                const chromeScaleX = previewStage.offsetWidth > 0
                    && previewStage.getBoundingClientRect().width > 0
                    ? previewStage.getBoundingClientRect().width / previewStage.offsetWidth : 1;
                if (typeof captionEdgeHandleLayoutFn === 'function') {
                    const edgeLayout = captionEdgeHandleLayoutFn(captionSelectBox.offsetHeight * chromeScaleY);
                    captionSelectBox.style.setProperty('--akari-caption-edge-outset',
                        edgeLayout.edgeOutset / chromeScaleX + 'px');
                    const verticalEdgeLayout = captionEdgeHandleLayoutFn(captionSelectBox.offsetWidth * chromeScaleX);
                    captionSelectBox.style.setProperty('--akari-caption-vertical-edge-outset',
                        verticalEdgeLayout.edgeOutset / chromeScaleY + 'px');
                }
                captionSelectBox.style.transform = 'rotate(' + captionTransform.rotate + 'deg)';
                captionSelectBox.style.setProperty('--caption-box-rotate', captionTransform.rotate + 'deg');
                captionSelectBox.classList.add('is-active');
                const selectionRect = captionSelectBox.getBoundingClientRect();
                const stageScale = previewStage.getBoundingClientRect().width / previewStage.offsetWidth || 1;
                const actions = clearCaptionSideActionsFn(previewLayerActionsFn(
                    previewPane.getBoundingClientRect(), selectionRect, null, stageScale),
                    previewPane.getBoundingClientRect());
                for (const handle of captionSelectBox.querySelectorAll('.akari-caption-handle[data-h="rot"], .akari-caption-handle[data-h="move"]')) {
                    if (!actions) continue;
                    const rect = handle.dataset.h === 'rot' ? actions.rotate : actions.move;
                    const center = previewChromeLocalPointFn(selectionRect,
                        { width: captionSelectBox.offsetWidth, height: captionSelectBox.offsetHeight },
                        captionTransform.rotate, stageScale,
                        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                    handle.style.left = center.x + 'px';
                    handle.style.top = center.y + 'px';
                }
                updateCaptionSelectTools();
                window.akari.layoutCaptionRunTools?.();
                fitCaptionSelectTools();
                updateCaptionRowBox();
            };
            const updateCaptionMultiSelectBoxes = () => {
                captionMultiSelectBoxes.replaceChildren();
                if (selectedCaptionIds.size < 2) return;
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                for (const row of captionRows.values()) {
                    const id = row.caption.sourceCueId || row.caption.id;
                    if (!selectedCaptionIds.has(id) || id === selectedCaptionId) continue;
                    const rect = captionVisualRect(row.plate);
                    const box = document.createElement('div');
                    box.className = 'caption-multi-select-box';
                    box.dataset.captionId = id;
                    setRectStyle(box, {
                        left: frameRect.x + rect.left * frameScale,
                        right: frameRect.x + rect.right * frameScale,
                        top: frameRect.y + rect.top * frameScale,
                        bottom: frameRect.y + rect.bottom * frameScale
                    });
                    captionMultiSelectBoxes.appendChild(box);
                }
            };
            const updateCaptionZoneHighlight = zone => {
                if (!zone) {
                    captionZoneHighlight.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const { row, col } = zoneParts(zone);
                const rowRange = ZONE_ROW_RANGES[row] || ZONE_ROW_RANGES.bottom;
                const colRange = ZONE_COL_RANGES[col] || ZONE_COL_RANGES.center;
                setRectStyle(captionZoneHighlight, {
                    left: frameRect.x + frameRect.width * colRange[0],
                    right: frameRect.x + frameRect.width * colRange[1],
                    top: frameRect.y + frameRect.height * rowRange[0],
                    bottom: frameRect.y + frameRect.height * rowRange[1]
                });
                captionZoneHighlight.classList.add('is-active');
            };
            const updateCaptionRowBox = () => {
                const plate = selectedCaptionId ? selectedCaptionPlate()?.querySelector('.akari-caption__plate') : null;
                if (!captionRowBoxEnabled || !plate || !captionSelectBox.classList.contains('is-active')) {
                    captionRowBox.classList.remove('is-active');
                    return;
                }
                const plateRect = plate.getBoundingClientRect();
                const line = plate.querySelector('.akari-caption__block')
                    || plate.querySelector('.akari-caption__line');
                const plateStyle = getComputedStyle(plate);
                const lineStyle = line ? getComputedStyle(line) : null;
                const cssPixelScale = plate.offsetWidth > 0
                    ? plateRect.width / plate.offsetWidth : window.akari.stageScale() || 1;
                const rect = captionRowWrapRectFn(
                    plateRect, lineStyle?.maxWidth || 'none', cssPixelScale,
                    plateStyle.alignItems, lineStyle?.textAlign || plateStyle.textAlign
                );
                const a = captionOutputPoint(rect.left, rect.top);
                const b = captionOutputPoint(rect.right, rect.bottom);
                const frame = window.akari.computeOutputFrameRect();
                const scale = window.akari.stageScale() || 1;
                setRectStyle(captionRowBox, {
                    left: frame.x + a.x * scale, right: frame.x + b.x * scale,
                    top: frame.y + a.y * scale, bottom: frame.y + b.y * scale
                });
                captionRowBox.classList.add('is-active');
            };
            const roundCaptionRatioUnclamped = value => {
                if (!Number.isFinite(value)) throw new Error('字幕位置は有限数である必要があります');
                return Math.round(value * 10000) / 10000;
            };
            // common/caption-plate-handles.ts の純関数と同じ式を webview 内へ複製する。
            const captionHandleScaleFactor = (center, start, now) => {
                const startDistance = Math.hypot(start.x - center.x, start.y - center.y);
                if (startDistance === 0 || !Number.isFinite(startDistance)) return 1;
                return Math.hypot(now.x - center.x, now.y - center.y) / startDistance;
            };
            const captionHandleScaleValue = (baseScale, center, start, now) => {
                const base = Number.isFinite(baseScale) ? baseScale : 1;
                const value = Math.min(3, Math.max(
                    0.4,
                    base * captionHandleScaleFactor(center, start, now)
                ));
                return Math.round(value * 1000) / 1000;
            };
            const captionHandleRotateDelta = (center, start, now) => (
                Math.atan2(now.y - center.y, now.x - center.x)
                - Math.atan2(start.y - center.y, start.x - center.x)
            ) * 180 / Math.PI;
            const captionHandleRotateValue = (baseRotate, center, start, now) => {
                const base = Number.isFinite(baseRotate) ? baseRotate : 0;
                const value = base + captionHandleRotateDelta(center, start, now);
                const normalized = ((value + 180) % 360 + 360) % 360 - 180;
                return Math.round(normalized * 100) / 100;
            };
            const captionHandleTargets = (selectedIds, activeId, allIds, altAll) => {
                const orderedIds = [...new Set(allIds.filter(Boolean))];
                if (altAll) return orderedIds;
                const selected = new Set(selectedIds.filter(Boolean));
                if (activeId && selected.has(activeId)) {
                    return orderedIds.filter(id => selected.has(id));
                }
                return activeId ? [activeId] : [];
            };
            const captionWrapWidthDragFn = (${captionWrapWidthDrag.toString()});
            const captionWrapPositionFn = (${captionWrapPosition.toString()});
            const captionCornerTransformFn = (${captionCornerTransform.toString()});
            const captionPositionFromVisualRect = (${captionPositionFromVisualRect.toString()});
            const captionGroupPositionFromRects = (plateRect, layoutRect, frameRect, anchor, transform) =>
                captionPositionFromVisualRect(plateRect, layoutRect, frameRect,
                    { anchor, clamp: false, ...transform });
            const placedCaptionPositionFromRects = (${placedCaptionPositionFromRects.toString()});
            const captionCuePositionFromRects = (plateRect, frameRect, options) => {
                if (!(frameRect.width > 0) || !(frameRect.height > 0)) {
                    throw new Error('出力フレームの幅と高さは正数である必要があります');
                }
                const topRatio = (plateRect.top - frameRect.y) / frameRect.height;
                const anchor = options.anchor ?? (topRatio < 1 / 3 ? 'tc' : 'bc');
                let x = (plateRect.left - frameRect.x) / frameRect.width;
                const plateH = plateRect.bottom - plateRect.top;
                let y = topRatio + (anchor[0] === 'b' ? plateH / frameRect.height
                    : anchor[0] === 'm' ? plateH / frameRect.height / 2 : 0);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    throw new Error('字幕位置は有限数である必要があります');
                }
                if (options.clamp) {
                    const plateW = plateRect.right - plateRect.left;
                    const maxX = 1 - plateW / frameRect.width;
                    if (maxX < 0) {
                        x = 0;
                    } else {
                        x = Math.min(maxX, Math.max(0, x));
                    }
                    if (anchor[0] === 'b') {
                        const minY = plateH / frameRect.height;
                        y = minY > 1 ? 1 : Math.min(1, Math.max(minY, y));
                    } else if (anchor[0] === 't') {
                        const maxY = 1 - plateH / frameRect.height;
                        y = maxY < 0 ? 0 : Math.min(maxY, Math.max(0, y));
                    } else {
                        const half = plateH / frameRect.height / 2;
                        y = Math.min(1 - half, Math.max(half, y));
                    }
                }
                return { anchor, position: { x: roundCaptionRatioUnclamped(x), y: roundCaptionRatioUnclamped(y) } };
            };
            const updateCaptionSelectBox = () => {
                syncCaptionHandleBox();
                updateCaptionMultiSelectBoxes();
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    captionPalette.hidden = true;
                    captionRowBox.classList.remove('is-active');
                    updateCaptionSelectTools();
                    return;
                }
                const caption = selectedCaption();
                const active = window.AkariEditKernel.findActiveCaptions(captions, outputTime)
                    .find(row => (row.sourceCueId || row.id) === selectedCaptionId);
                if (!caption || !active || (active.sourceCueId || active.id) !== selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    captionPalette.hidden = true;
                    captionRowBox.classList.remove('is-active');
                    updateCaptionSelectTools();
                    return;
                }
                const handleBox = captionSelectBox.querySelector('.akari-caption-handle-box');
                if (!handleBox && !captionGestureCount && !selectionDragActive) {
                    applyCaptionSelectionAttrs();
                }
                if (handleBox && !captionGestureCount && !selectionDragActive) {
                    const vertical = Boolean(caption.textStyle?.vertical);
                    const verticalHandles = Boolean(handleBox.querySelector('[data-h="n"]'))
                        && Boolean(handleBox.querySelector('[data-h="s"]'));
                    const horizontalHandles = Boolean(handleBox.querySelector('[data-h="e"]'))
                        && Boolean(handleBox.querySelector('[data-h="w"]'));
                    if (vertical ? !verticalHandles || horizontalHandles : !horizontalHandles || verticalHandles) {
                        applyCaptionSelectionAttrs();
                    }
                }
                const rect = captionVisualRect();
                updateCaptionSelectBoxForRect(rect);
            };
            const selectCaption = (captionId, options) => {
                const report = !options || options.report !== false;
                if (report && typeof selectedMixedGroup !== 'undefined') selectedMixedGroup = [];
                // Keep a host-selected group when one of its cues becomes primary.
                if (!options?.preserveGroup && !(selectedCaptionIds.size > 1 && selectedCaptionIds.has(captionId))) {
                    selectedCaptionIds = captionId ? new Set([captionId]) : new Set();
                }
                applyCaptionSelectionAttrs();
                if (captionId && !(typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection)) { requestedCutId = undefined; requestedOverlayId = null; window.akari.interaction?.clearSelection?.(); }
                if (captionId === selectedCaptionId) {
                    updateCaptionSelectBox();
                    if (report) window.akari.reportCaptionSelection(selectedCaptionId);
                    return;
                }
                selectedCaptionId = captionId;
                captionStylePreview.selectionChanged(selectedCaptionIds);
                window.akari.syncRunSelection?.();
                if (captionId && !(typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection)) {
                    selectLayer(null, { report: false });
                    deselectCut({ report: false });
                }
                updateCaptionSelectBox();
                if (report) window.akari.reportCaptionSelection(selectedCaptionId);
            };
            const deselectCaption = options => selectCaption(null, options);
            const captionToolTargets = () => captionHandleTargets(
                [...selectedCaptionIds], selectedCaptionId,
                captions.map(item => item.sourceCueId || item.id), false
            );
            const writeCaptionToolStyle = change => {
                const ids = captionToolTargets();
                if (!ids.length) return;
                void window.akari.engine.captionWrite(selectedCaptionId, {
                    toolStyle: { captionIds: ids, change }
                }).catch(error => window.akari.showWriteError(error));
            };
            const requestCaptionInspector = field => {
                window.akari.requestCaptionInspector(field);
            };
            const paletteColors = ['#ffffff', '#000000', '#f5c451', '#ff8b2c', '#f26666', '#e85fa1', '#ac78ed',
                '#4da3ff', '#53d1bc', '#75d368', '#a8de5f', '#e6c78c', '#8a93a5', '#283447'];
            const renderCaptionPalette = () => {
                for (const tab of captionPalette.querySelectorAll('[data-palette-tab]')) {
                    tab.classList.toggle('on', tab.dataset.paletteTab === captionPaletteTab);
                }
                for (const [selector, colors] of [
                    ['[data-palette-colors]', paletteColors], ['[data-palette-recent]', captionRecentColors]
                ]) {
                    const grid = captionPalette.querySelector(selector);
                    grid.replaceChildren();
                    for (const color of colors) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.dataset.color = color;
                        button.style.background = color;
                        button.setAttribute('aria-label', color);
                        grid.appendChild(button);
                    }
                }
            };
            captionSelectBox.querySelector('.akari-caption-select-tools').addEventListener('pointerdown', event => {
                event.stopPropagation();
                if (currentRunSelection()) event.preventDefault();
            });
            captionPalette.addEventListener('pointerdown', event => {
                event.stopPropagation();
                if (currentRunSelection()) event.preventDefault();
            });
            captionRunMenu.addEventListener('pointerdown', event => {
                event.stopPropagation();
                event.preventDefault();
            });
            captionTool('group').addEventListener('click', () => {
                captionGroupToolEnabled = !captionGroupToolEnabled;
                setCaptionGroupMode(false);
            });
            captionTool('snap').addEventListener('click', () => {
                captionSnapEnabled = !captionSnapEnabled;
                if (!captionSnapEnabled) window.akari.interaction?.hideSnapGuides?.();
                updateCaptionSelectTools();
            });
            captionClampChip.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (!selectedCaptionId) return;
                captionClampOverrides.set(selectedCaptionId, !captionClampEnabled(selectedCaption()));
                updateCaptionSelectTools();
            });
            captionTool('bold').addEventListener('click', () => {
                if (currentRunSelection()) {
                    writeCaptionRun({ kind: 'style', style: { font_weight:
                        (selectedRunStyle().font_weight ?? selectedCaption()?.textStyle?.weight
                            ?? selectedCaption()?.textStyle?.font_weight) === 900 ? 400 : 900 } });
                    return;
                }
                writeCaptionToolStyle({ field: 'font_weight', value:
                    (selectedCaption()?.textStyle?.weight ?? selectedCaption()?.textStyle?.font_weight) === 900 ? null : 900 });
            });
            captionTool('cushion').addEventListener('click', () => {
                const style = selectedCaption()?.textStyle?.background;
                const id = selectedCaptionId;
                const current = style?.opacity ?? (style?.color ? 1 : 0);
                if (current > 0) captionCushionOpacity.set(id, current);
                writeCaptionToolStyle({ field: 'background.opacity', value: current > 0 ? 0 : (captionCushionOpacity.get(id) || 0.75) });
            });
            captionTool('color').addEventListener('click', () => {
                captionPalette.hidden = !captionPalette.hidden;
                if (!captionPalette.hidden) {
                    captionRunMenu.hidden = true;
                    renderCaptionPalette();
                }
            });
            captionPalette.addEventListener('click', event => {
                const tab = event.target.closest('[data-palette-tab]');
                if (tab) {
                    captionPaletteTab = tab.dataset.paletteTab;
                    renderCaptionPalette();
                    return;
                }
                const sample = event.target.closest('[data-color]');
                if (sample) {
                    const color = sample.dataset.color;
                    if (currentRunSelection()) {
                        if (captionPaletteTab === 'text') writeCaptionRun({ kind: 'style', style: { color } });
                        else if (captionPaletteTab === 'stroke') writeCaptionRun({ kind: 'style', style: { stroke: { color } } });
                        else window.akari.reportRunStyleOmitted('文字範囲には座布団の色を適用できません');
                    } else {
                        const field = captionPaletteTab === 'text' ? 'color'
                            : captionPaletteTab === 'stroke' ? 'stroke.color' : 'background.color';
                        writeCaptionToolStyle({ field, value: color });
                    }
                    captionRecentColors.splice(captionRecentColors.indexOf(color), captionRecentColors.includes(color) ? 1 : 0);
                    captionRecentColors.unshift(color);
                    captionRecentColors.length = Math.min(captionRecentColors.length, 7);
                    renderCaptionPalette();
                    return;
                }
                if (event.target.closest('[data-palette-more]')) {
                    if (currentRunSelection()) {
                        window.akari.reportRunStyleOmitted('文字範囲の色はパレットから選んでください');
                        return;
                    }
                    requestCaptionInspector(captionPaletteTab === 'text' ? 'caption-style-color'
                        : captionPaletteTab === 'stroke' ? 'caption-style-stroke-color' : 'caption-style-bg-color');
                    captionPalette.hidden = true;
                }
            });
            captionTool('inspector').addEventListener('click', () => requestCaptionInspector('caption-style'));
            for (const [tool, field, delta, initial] of [
                ['bigger', 'scale', 0.1, 1], ['smaller', 'scale', -0.1, 1],
                ['up', 'baseline_shift_em', -0.1, 0], ['down', 'baseline_shift_em', 0.1, 0],
                ['rotate-run', 'rotate_deg', 8, 0], ['spacing-run', 'letter_spacing_em', 0.05, 0]
            ]) {
                captionTool(tool).addEventListener('click', () => {
                    const prior = selectedRunStyle()[field];
                    const value = Math.round(((typeof prior === 'number' ? prior : initial) + delta) * 100) / 100;
                    writeCaptionRun({ kind: 'style', style: { [field]: field === 'scale' ? Math.max(0.1, value) : value } });
                });
            }
            captionTool('run-role').addEventListener('click', () => {
                captionPalette.hidden = true;
                const roleWasOpen = !captionRunMenu.hidden && captionRunMenu.dataset.kind === 'role';
                captionRunMenu.replaceChildren();
                captionRunMenu.dataset.kind = 'role';
                for (const [role, label] of [['emphasis', '強調'], ['keyword', 'キーワード'], ['aside', '補足']]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = label;
                    button.dataset.akariRunRole = role;
                    button.addEventListener('click', () => {
                        writeCaptionRun({ kind: 'role', role });
                        captionRunMenu.hidden = true;
                    });
                    captionRunMenu.appendChild(button);
                }
                captionRunMenu.hidden = roleWasOpen;
            });
            captionTool('run-style').addEventListener('click', () => {
                if (!activeCaptionEdit) return;
                captionPalette.hidden = true;
                captionRunMenu.replaceChildren();
                captionRunMenu.dataset.kind = 'style';
                captionRunMenu.textContent = 'スタイルを読み込み中…';
                captionRunMenu.hidden = false;
                window.akari.requestRunStyles(activeCaptionEdit.captionId);
            });
            captionTool('my-style-save').addEventListener('click', () => {
                if (selectedCaptionId) window.akari.requestMyStyleSave(selectedCaptionId);
            });
            captionRowBoxToggle.addEventListener('click', () => {
                captionRowBoxEnabled = !captionRowBoxEnabled;
                captionRowBoxToggle.setAttribute('aria-pressed', String(captionRowBoxEnabled));
                updateCaptionRowBox();
            });
            captionPositionReset.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const cueId = selectedCaptionId;
                if (!cueId) return;
                const ids = captionToolTargets();
                void window.akari.engine.captionWrite(cueId, { cueGeometryReset: { captionIds: ids } }).then(() => {
                    for (const id of ids) captionCuePositionKnown.set(id, false);
                    updateCaptionSelectBox();
                }).catch(error => {
                    console.warn('[akari-preview] caption cue position reset rejected', error);
                    window.akari.showWriteError(error);
                });
            });
            const restoreCaptionEditAttribute = (element, name, value) => {
                if (value === null) element.removeAttribute(name);
                else element.setAttribute(name, value);
            };
            const restoreCaptionEditElement = edit => {
                edit.hint?.remove();
                restoreCaptionEditAttribute(edit.element, 'contenteditable', edit.contentEditable);
                restoreCaptionEditAttribute(edit.element, 'spellcheck', edit.spellcheck);
                restoreCaptionEditAttribute(edit.element, 'style', edit.style);
                edit.element.removeAttribute('data-akari-caption-editing');
                edit.element.closest('.caption-row-plate')?.classList.remove('akari-caption-host--editing');
            };
            const rerenderCaptionAfterEdit = () => {
                for (const row of captionRows.values()) row.renderedCaption = null;
                renderCaption();
            };
            const cancelCaptionEdit = () => {
                if (!activeCaptionEdit) return;
                const edit = activeCaptionEdit;
                activeCaptionEdit = null;
                window.akari.reportCaptionEditFocus?.(false);
                window.akari.syncRunSelection?.();
                restoreCaptionEditElement(edit);
                rerenderCaptionAfterEdit();
            };
            const commitCaptionEdit = async () => {
                if (!activeCaptionEdit) return;
                const edit = activeCaptionEdit;
                const nextText = captionEditorValueFn(edit.element.innerText || '', edit.element.lastChild?.nodeName === 'BR');
                activeCaptionEdit = null;
                window.akari.reportCaptionEditFocus?.(false);
                window.akari.syncRunSelection?.();
                restoreCaptionEditElement(edit);
                // Restore styled lines/tokens immediately, including while the write is pending.
                // Subsequent dragging must measure the rendered plate, not the temporary editor.
                rerenderCaptionAfterEdit();
                if (nextText === edit.originalText) return;
                try {
                    await window.akari.engine.captionWrite(edit.captionId, { text: nextText });
                    if (nextText.trim().length === 0) {
                        captions = captions.filter(caption => (caption.sourceCueId || caption.id) !== edit.captionId);
                        if (selectedCaptionId === edit.captionId) deselectCaption();
                    } else {
                        for (const caption of captions) {
                            if ((caption.sourceCueId || caption.id) === edit.captionId) {
                                caption.text = nextText;
                                delete caption.words;
                            }
                        }
                    }
                } catch (error) {
                    console.warn('[akari-preview] caption text write rejected; reverting', error);
                    window.akari.showWriteError(error);
                }
                rerenderCaptionAfterEdit();
            };
            const placeCaptionCaretAtEnd = element => {
                const selection = window.getSelection();
                if (!selection) return;
                const range = document.createRange();
                range.selectNodeContents(element);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            };
            const beginCaptionEdit = caption => {
                const captionPlate = captionRows.get(caption.id)?.plate;
                if (!captionPlate) return;
                const captionId = caption && (caption.sourceCueId || caption.id);
                if (!captionId) return;
                if (activeCaptionEdit) {
                    activeCaptionEdit.element.focus({ preventScroll: true });
                    return;
                }
                if (isPlaying) togglePlayback();
                selectCaption(captionId);
                const displayLines = [...captionPlate.querySelectorAll('.akari-caption__line')];
                const lineCount = line => {
                    const style = getComputedStyle(line);
                    return captionLineCountFromMetricsFn(line.offsetHeight, parseFloat(style.lineHeight),
                        parseFloat(style.paddingTop) || 0, parseFloat(style.paddingBottom) || 0);
                };
                const targetLines = displayLines.reduce((count, line) => count + lineCount(line), 0);
                const editorWidth = captionEditorWrapWidthFn(displayLines.map(line => line.offsetWidth));
                const layoutPlate = captionPlate.querySelector('.akari-caption__plate');
                // Keep the full-width layout wrapper pointer-transparent. Editing only the ink
                // line lets a click beside the text blur/commit and release the selection.
                if (layoutPlate) {
                    const line = document.createElement('div');
                    line.className = 'akari-caption__line';
                    layoutPlate.replaceChildren(line);
                }
                const element = layoutPlate?.firstElementChild || captionPlate;
                activeCaptionEdit = {
                    captionId,
                    originalText: caption.text || '',
                    element,
                    contentEditable: element.getAttribute('contenteditable'),
                    spellcheck: element.getAttribute('spellcheck'),
                    style: element.getAttribute('style')
                };
                element.setAttribute('contenteditable', 'true');
                element.setAttribute('spellcheck', 'false');
                element.setAttribute('data-akari-caption-editing', 'true');
                // styled 字幕の token/行ラッパーは編集開始時だけプレーンな本文へ畳み、
                // CSS やアニメーション断片を textContent に混入させない。
                element.replaceChildren(...captionEditorLinesFn(caption.text || '').flatMap((line, index) =>
                    index ? line ? [document.createElement('br'), document.createTextNode(line)]
                        : [document.createElement('br')] : [document.createTextNode(line)]));
                if (layoutPlate && editorWidth) {
                    element.style.width = editorWidth + 'px';
                    element.style.maxWidth = 'none';
                    element.style.boxSizing = 'border-box';
                    element.style.whiteSpace = 'pre-wrap';
                    element.style.overflowWrap = 'anywhere';
                    element.style.width = captionEditorFitWidthFn(editorWidth, targetLines, width => {
                        element.style.width = width + 'px';
                        return lineCount(element);
                    }) + 'px';
                }
                element.style.pointerEvents = 'auto';
                element.style.userSelect = 'text';
                captionPlate.classList.add('akari-caption-host--editing');
                element.focus({ preventScroll: true });
                if (document.body) {
                    const hint = document.createElement('div');
                    const mac = /Mac|iPhone|iPad|iPod/.test(window.navigator?.platform);
                    hint.setAttribute('data-akari-caption-edit-hint', '');
                    hint.textContent = (mac ? '⌘Enter' : 'Ctrl+Enter') + ' で確定・Esc で取り消し';
                    const bounds = element.getBoundingClientRect();
                    Object.assign(hint.style, {
                        position: 'fixed', left: Math.max(8, bounds.left) + 'px',
                        top: Math.min(window.innerHeight - 24, bounds.bottom + 44) + 'px',
                        zIndex: '1000', pointerEvents: 'none', padding: '2px 6px',
                        borderRadius: '3px', background: 'rgba(0,0,0,.72)', color: '#fff',
                        font: '11px sans-serif', whiteSpace: 'nowrap'
                    });
                    document.body.appendChild(hint);
                    activeCaptionEdit.hint = hint;
                }
                window.akari.reportCaptionEditFocus?.(true);
                placeCaptionCaretAtEnd(element);
                window.akari.refreshActiveCaptionRuns?.();
                if (layoutPlate && editorWidth && caption?.runs?.some(run =>
                    Number.isFinite(run?.style?.scale) && run.style.scale !== 1)
                    && lineCount(element) > targetLines) {
                    // offsetWidth rounds away the subpixel width reserved by font-size runs.
                    element.style.width = Math.max(parseFloat(element.style.width) || 0, editorWidth + 1) + 'px';
                }
                window.akari.syncRunSelection?.();
            };
            captionLayer.addEventListener('dblclick', event => {
                const caption = captionForEvent(event);
                if (!caption || !(caption.sourceCueId || caption.id)) return;
                event.preventDefault();
                event.stopPropagation();
                beginCaptionEdit(caption);
            });
            captionLayer.addEventListener('blur', event => {
                if (activeCaptionEdit && event.target === activeCaptionEdit.element) {
                    void commitCaptionEdit();
                }
            }, true);
            captionLayer.addEventListener('keydown', event => {
                if (!activeCaptionEdit || event.target !== activeCaptionEdit.element) return;
                const action = captionEditKeyActionFn(event, /Mac|iPhone|iPad|iPod/.test(window.navigator?.platform));
                if (action === 'line-break') {
                    event.preventDefault();
                    event.stopPropagation();
                    document.execCommand('insertLineBreak');
                } else if (action === 'commit') {
                    event.preventDefault();
                    event.stopPropagation();
                    void commitCaptionEdit();
                } else if (action === 'cancel') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelCaptionEdit();
                } else if (captionEditingNavigationKeyFn(true, event.key)) {
                    event.stopPropagation();
                }
            });
            const captionWrapHeightDragFn = (${captionWrapHeightDrag.toString()});
            const beginCaptionHandleDrag = (event, handle, caption, cueId) => {
                const frameCaptionPosition = (candidate, value) => candidate?.textStyle?.background?.fit === 'frame'
                    || candidate?.textStyleVars?.['--caption-plate-fit'] === 'frame'
                    ? { ...value, anchor: value.anchor[0] + 'c', position: { y: value.position.y } } : value;
                const captionPlate = handle.closest('.caption-row-plate') || selectedCaptionPlate();
                const kind = handle.getAttribute('data-h');
                if (!['nw', 'ne', 'sw', 'se', 'rot', 'e', 'w', 'n', 's', 'move'].includes(kind)) return false;
                if (kind === 'move') return false;
                event.preventDefault();
                event.stopPropagation();
                if (selectedCaptionId !== cueId) selectCaption(cueId);
                const altAll = event.altKey || captionAltAll;
                setCaptionGroupMode(altAll);
                const targets = captionHandleTargets(
                    [...selectedCaptionIds],
                    cueId,
                    captions.map(candidate => candidate.sourceCueId || candidate.id),
                    altAll
                );
                const rect = captionVisualRect();
                const layoutRect = captionLayoutRect(captionPlate);
                const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
                const start = captionOutputPoint(event.clientX, event.clientY);
                const currentStyle = getComputedStyle(captionPlate);
                const currentScale = parseFloat(currentStyle.getPropertyValue('--caption-scale'));
                const currentRotate = parseFloat(currentStyle.getPropertyValue('--caption-rotate'));
                const baseScale = Number.isFinite(currentScale) ? currentScale : 1;
                const baseRotate = Number.isFinite(currentRotate) ? currentRotate : 0;
                const fixedSide = kind === 'e' ? 'w' : 'e';
                const startCorners = ['e', 'w', 'n', 's'].includes(kind)
                    ? captionOrientedFrameFn(layoutRect, baseScale, baseRotate).corners : null;
                const originalWrap = captionPlate.style.getPropertyValue('--caption-wrap-width');
                const originalVerticalWrap = captionPlate.style.getPropertyValue('--caption-vertical-wrap-height');
                const originalVerticalMax = captionPlate.style.getPropertyValue('--caption-vertical-max-height');
                const originalPlateMargin = captionPlate.style.getPropertyValue('--caption-plate-margin');
                const originalLeft = captionPlate.style.getPropertyValue('--caption-left');
                const originalTop = captionPlate.style.getPropertyValue('--caption-top');
                const originalBottom = captionPlate.style.getPropertyValue('--caption-bottom');
                const originalTranslate = captionPlate.style.getPropertyValue('--caption-translate');
                const originalCornerVars = ['--caption-width', '--caption-right', '--caption-align-items',
                    '--caption-line-margin', '--caption-line-max-width'].map(name =>
                    [name, captionPlate.style.getPropertyValue(name)]);
                const pointerId = event.pointerId;
                let moved = false;
                selectionDragActive = true;
                document.body.classList.add('akari-caption-transforming');
                if (kind === 'rot') document.body.classList.add('akari-caption-rotating');
                const gestureLabel = document.createElement('div');
                gestureLabel.className = kind === 'rot' ? 'akari-interaction-angle' : 'akari-interaction-hint';
                gestureLabel.setAttribute('data-akari-interaction', kind === 'rot' ? 'rotation-angle' : 'handle-hint');
                gestureLabel.textContent = ['e', 'w', 'n', 's'].includes(kind) ? '折り返し幅'
                    : kind === 'rot' ? '回転' : '大きさ';
                gestureLabel.style.left = event.clientX + 12 + 'px';
                gestureLabel.style.top = event.clientY + 12 + 'px';
                document.body.appendChild(gestureLabel);
                try { handle.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const restoreLocalTransform = () => {
                    if (baseScale === 1) captionPlate.style.removeProperty('--caption-scale');
                    else captionPlate.style.setProperty('--caption-scale', String(baseScale));
                    if (baseRotate === 0) captionPlate.style.removeProperty('--caption-rotate');
                    else captionPlate.style.setProperty('--caption-rotate', baseRotate + 'deg');
                    if (originalWrap) captionPlate.style.setProperty('--caption-wrap-width', originalWrap);
                    else captionPlate.style.removeProperty('--caption-wrap-width');
                    if (originalVerticalWrap) captionPlate.style.setProperty('--caption-vertical-wrap-height', originalVerticalWrap);
                    else captionPlate.style.removeProperty('--caption-vertical-wrap-height');
                    if (originalVerticalMax) captionPlate.style.setProperty('--caption-vertical-max-height', originalVerticalMax);
                    else captionPlate.style.removeProperty('--caption-vertical-max-height');
                    if (originalPlateMargin) captionPlate.style.setProperty('--caption-plate-margin', originalPlateMargin);
                    else captionPlate.style.removeProperty('--caption-plate-margin');
                    if (originalLeft) captionPlate.style.setProperty('--caption-left', originalLeft);
                    else captionPlate.style.removeProperty('--caption-left');
                    for (const [name, value] of [['--caption-top', originalTop],
                        ['--caption-bottom', originalBottom], ['--caption-translate', originalTranslate],
                        ...originalCornerVars]) {
                        if (value) captionPlate.style.setProperty(name, value);
                        else captionPlate.style.removeProperty(name);
                    }
                };
                const cleanup = () => {
                    selectionDragActive = false;
                    document.body.classList.remove('akari-caption-transforming');
                    document.body.classList.remove('akari-caption-rotating');
                    gestureLabel.remove();
                    document.body.style.cursor = '';
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    setCaptionGroupMode(false);
                    if (handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
                        handle.releasePointerCapture(pointerId);
                    }
                };
                // Persist the same patch displayed by the latest pointermove,
                // including Shift pressed/released after the drag began.
                let lastPatch;
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const now = captionOutputPoint(moveEvent.clientX, moveEvent.clientY);
                    if (!moved && Math.hypot(now.x - start.x, now.y - start.y) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    let patch;
                    if (kind === 'rot') {
                        let angle = captionHandleRotateValue(baseRotate, center, start, now);
                        if (!moveEvent.metaKey && !moveEvent.ctrlKey) {
                            const target = Math.round(angle / 45) * 45;
                            if (Math.abs(angle - target) <= 4) angle = target;
                        }
                        patch = { rotate: angle };
                    } else if (kind === 'n' || kind === 's') {
                        const outputWidth = Number(summary.output?.width) || 1280;
                        const outputHeight = Number(summary.output?.height) || 720;
                        const wrap = captionWrapHeightDragFn(kind, layoutRect,
                            { x: now.x - start.x, y: now.y - start.y }, baseRotate, baseScale, outputHeight);
                        const wrapHeight = wrap.heightPct / 100 * outputHeight + 'px';
                        captionPlate.style.setProperty('--caption-vertical-wrap-height', wrapHeight);
                        captionPlate.style.setProperty('--caption-vertical-max-height', wrapHeight);
                        captionPlate.style.setProperty('--caption-left', layoutRect.left / outputWidth * 100 + '%');
                        captionPlate.style.setProperty('--caption-top', wrap.top / outputHeight * 100 + '%');
                        captionPlate.style.setProperty('--caption-bottom', 'auto');
                        captionPlate.style.setProperty('--caption-translate', 'none');
                        const nextLayout = captionLayoutRect(captionPlate);
                        const candidateLeft = layoutRect.right - (nextLayout.right - nextLayout.left);
                        captionPlate.style.setProperty('--caption-left', candidateLeft / outputWidth * 100 + '%');
                        const movedCorners = captionOrientedFrameFn(
                            captionLayoutRect(captionPlate), baseScale, baseRotate).corners;
                        const fixedCorner = kind === 's' ? 1 : 2;
                        const anchorDelta = {
                            x: startCorners[fixedCorner].x - movedCorners[fixedCorner].x,
                            y: startCorners[fixedCorner].y - movedCorners[fixedCorner].y
                        };
                        const placement = captionWrapPositionFn(candidateLeft + anchorDelta.x,
                            wrap.top + anchorDelta.y,
                            outputWidth, outputHeight);
                        patch = { wrapWidthPct: wrap.heightPct,
                            cuePosition: { captionId: cueId, value: frameCaptionPosition(caption, placement) } };
                        captionPlate.style.setProperty('--caption-left', placement.position.x * 100 + '%');
                        captionPlate.style.setProperty('--caption-top', placement.position.y * 100 + '%');
                    } else if (kind === 'e' || kind === 'w') {
                        const outputWidth = Number(summary.output?.width) || 1280;
                        const outputHeight = Number(summary.output?.height) || 720;
                        const wrap = captionWrapResizeFn(kind, layoutRect,
                            { x: now.x - start.x, y: now.y - start.y }, baseRotate, baseScale, outputWidth);
                        captionPlate.style.setProperty('--caption-wrap-width', wrap.widthPct + '%');
                        captionPlate.style.setProperty('--caption-plate-margin', '0');
                        captionPlate.style.setProperty('--caption-left', wrap.left / outputWidth * 100 + '%');
                        captionPlate.style.setProperty('--caption-top', layoutRect.top / outputHeight * 100 + '%');
                        captionPlate.style.setProperty('--caption-bottom', 'auto');
                        captionPlate.style.setProperty('--caption-translate', 'none');
                        const movedCorners = captionOrientedFrameFn(
                            captionLayoutRect(captionPlate), baseScale, baseRotate).corners;
                        const anchorDelta = captionWrapAnchorDeltaFn(startCorners, movedCorners, fixedSide);
                        const placement = captionWrapPositionFn(wrap.left + anchorDelta.x,
                            layoutRect.top + anchorDelta.y,
                            outputWidth, outputHeight);
                        patch = { wrapWidthPct: wrap.widthPct,
                            cuePosition: { captionId: cueId, value: frameCaptionPosition(caption, placement) } };
                        captionPlate.style.setProperty('--caption-left', placement.position.x * 100 + '%');
                        captionPlate.style.setProperty('--caption-top', placement.position.y * 100 + '%');
                    } else {
                        const next = captionCornerTransformFn(kind, layoutRect, baseScale, baseRotate, now, start);
                        const outputWidth = Number(summary.output?.width) || 1280;
                        const outputHeight = Number(summary.output?.height) || 720;
                        patch = { scale: next.scale, cuePosition: { captionId: cueId,
                            value: frameCaptionPosition(caption, { anchor: 'tl', position: { x: next.left / outputWidth,
                                y: next.top / outputHeight } }) } };
                        if (caption.textStyle?.text_anchor === 'tc'
                            && !Number.isFinite(caption.textStyle?.position?.x) && !caption.textStyle?.vertical
                            && caption.textStyle?.background?.fit !== 'frame'
                            && caption.textStyleVars?.['--caption-plate-fit'] !== 'frame') {
                            captionPlate.style.setProperty('--caption-width', next.width + 'px');
                            captionPlate.style.setProperty('--caption-right', 'auto');
                            captionPlate.style.setProperty('--caption-align-items', 'flex-start');
                            captionPlate.style.setProperty('--caption-line-margin', '0');
                            captionPlate.style.setProperty('--caption-line-max-width', '100%');
                        }
                        captionPlate.style.setProperty('--caption-left', next.left / outputWidth * 100 + '%');
                        captionPlate.style.setProperty('--caption-top', next.top / outputHeight * 100 + '%');
                        captionPlate.style.setProperty('--caption-bottom', 'auto');
                        captionPlate.style.setProperty('--caption-translate', 'none');
                    }
                    lastPatch = patch;
                    if (patch.scale !== undefined) {
                        captionPlate.style.setProperty('--caption-scale', String(patch.scale));
                    }
                    if (patch.rotate !== undefined) {
                        captionPlate.style.setProperty('--caption-rotate', patch.rotate + 'deg');
                        gestureLabel.textContent = Math.round(patch.rotate) + '°';
                        gestureLabel.style.left = moveEvent.clientX + 15 + 'px';
                        gestureLabel.style.top = moveEvent.clientY + 17 + 'px';
                        const box = captionPlate.getBoundingClientRect();
                        const tangent = Math.atan2(moveEvent.clientY - (box.top + box.height / 2),
                            moveEvent.clientX - (box.left + box.width / 2)) * 180 / Math.PI + 90;
                        const cursor = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
                            + '<g transform="rotate(' + Math.round(tangent) + ' 16 16)" fill="none" stroke="white" stroke-width="2">'
                            + '<path d="M5 16a11 11 0 0 1 19-7m3 7a11 11 0 0 1-19 7"/>'
                            + '<path d="m21 8 4 1-1-4M11 24l-4-1 1 4"/></g></svg>';
                        document.body.style.cursor = 'url("data:image/svg+xml,' + encodeURIComponent(cursor)
                            + '") 16 16, crosshair';
                    }
                    updateCaptionSelectBoxForRect(captionVisualRect());
                };
                const finish = async cancelled => {
                    cleanup();
                    if (cancelled || !moved) {
                        restoreLocalTransform();
                        updateCaptionSelectBox();
                        return;
                    }
                    const patch = lastPatch;
                    pendingCaptionDragReload = true;
                    try {
                        await window.akari.engine.captionWrite(cueId, {
                            plateTransform: { captionIds: targets, ...patch }
                        });
                    } catch (error) {
                        pendingCaptionDragReload = false;
                        restoreLocalTransform();
                        console.warn('[akari-preview] caption plate transform write rejected; reverting', error);
                        window.akari.showWriteError(error);
                    }
                    updateCaptionSelectBox();
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish(false);
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId) return;
                    void finish(true);
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key === 'Escape') void finish(true);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
                return true;
            };
            const onCaptionPointerDown = event => {
                const frameCaptionPosition = (candidate, value) => candidate?.textStyle?.background?.fit === 'frame'
                    || candidate?.textStyleVars?.['--caption-plate-fit'] === 'frame'
                    ? { ...value, anchor: value.anchor[0] + 'c', position: { y: value.position.y } } : value;
                if (typeof selectedMixedGroup !== 'undefined' && selectedMixedGroup.length > 1
                    && selectedMixedGroup.some(item => item.kind !== 'caption')
                    && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    const plate = event.target.closest?.('.caption-row-plate');
                    const row = plate && captionRows.get(plate.dataset.captionKey);
                    if (row && selectedMixedGroup.some(item => item.kind === 'caption'
                        && item.id === (row.caption.sourceCueId || row.caption.id))) return;
                }
                if (activeCaptionEdit) return;
                if (event.button !== 0) return;
                // 字幕ウィンドウ判定は共有カーネル（webview-kernel.js / caption-window.ts）
                const handle = event.target.closest?.('.akari-caption-handle');
                const caption = handle && captionSelectBox.contains(handle)
                    ? selectedCaption() : captionForEvent(event);
                if (!caption || !caption.id) return;
                const cueId = caption.sourceCueId || caption.id;
                const captionPlate = handle && captionSelectBox.contains(handle)
                    ? selectedCaptionPlate() : event.target.closest('.caption-row-plate');
                if (handle && beginCaptionHandleDrag(event, handle, caption, cueId)) return;
                const captionMoveToken = {};
                if (typeof latestCaptionMove !== 'undefined') latestCaptionMove.set(cueId, captionMoveToken);
                if (typeof captionGestureCount !== 'undefined') captionGestureCount += 1;
                window.akari.reportGesture?.('begin');
                event.preventDefault();
                event.stopPropagation();
                const placedText = caption.timeDomain === 'output';
                const duplicatePlacedText = placedText && event.altKey;
                const groupMode = (event.altKey || captionGroupToolEnabled) && !placedText;
                const clampOn = captionClampEnabled(caption);
                const startAnchor = caption.textStyle?.text_anchor || 'bc';
                selectCaption(cueId);
                setCaptionGroupMode(groupMode);
                const pointerId = event.pointerId;
                const startClientX = event.clientX;
                const startClientY = event.clientY;
                const startPlateRect = captionVisualRect();
                const startLayoutRect = captionLayoutRect();
                const startTransform = captionTransformValues(captionPlate);
                // The previous drag can still be waiting for captions.json. Its live
                // displacement is on the plate, while captions still has the old base.
                const captionTranslateNow = plate => {
                    const [x, y] = String(plate.style.translate || '').trim().split(' ');
                    return { x: parseFloat(x) || 0, y: parseFloat(y) || 0 };
                };
                const startPlateTranslate = captionTranslateNow(captionPlate);
                const startRowTranslates = new Map();
                const startOutputPoint = captionOutputPoint(startClientX, startClientY);
                const moveIds = !groupMode && selectedCaptionIds.has(cueId)
                    ? [...selectedCaptionIds].filter(id => captions.some(item => (item.sourceCueId || item.id) === id))
                    : [];
                const multiMove = moveIds.length > 1;
                if (typeof latestCaptionMove !== 'undefined') {
                    for (const id of moveIds) latestCaptionMove.set(id, captionMoveToken);
                }
                const startRects = new Map();
                const startLayoutRects = new Map();
                const startTransforms = new Map();
                if (multiMove) {
                    for (const id of moveIds) {
                        if (id === cueId) {
                            startRects.set(id, startPlateRect);
                            startLayoutRects.set(id, startLayoutRect);
                            startTransforms.set(id, startTransform);
                            continue;
                        }
                        const visible = [...captionRows.values()].find(row =>
                            (row.caption.sourceCueId || row.caption.id) === id);
                        if (visible) {
                            startRowTranslates.set(id, captionTranslateNow(visible.plate));
                            startRects.set(id, captionVisualRect(visible.plate));
                            startLayoutRects.set(id, captionLayoutRect(visible.plate));
                            startTransforms.set(id, captionTransformValues(visible.plate));
                            continue;
                        }
                        const candidate = captions.find(item => (item.sourceCueId || item.id) === id);
                        const measuringPlate = document.createElement('div');
                        measuringPlate.className = 'caption-row-plate akari-caption-host--styled';
                        measuringPlate.style.visibility = 'hidden';
                        if (candidate.timeDomain === 'output') measuringPlate.dataset.outputCaption = '';
                        applyCaptionStyleVars(candidate, measuringPlate);
                        const hasWords = Array.isArray(candidate.words) && candidate.words.length > 0;
                        const hasEmphasis = hasWords && candidate.words.some(word => findMatchingEmphasis(word));
                        const reveal = hasWords && (candidate.style === 'reveal'
                            || (!candidate.style && !candidate.textStyle?.vertical && captionPortrait
                                && splitCaptionLines(candidate.text || '', captionLineBudget).length > 1));
                        const usesWords = hasWords && (candidate.style === 'karaoke'
                            || candidate.style === 'pop' || candidate.style === 'reveal-word'
                            || hasEmphasis || reveal);
                        const measuredHtml = usesWords
                            ? renderStyledCaptionFragment(candidate) : renderPlainCaptionFragment(candidate);
                        measuringPlate.innerHTML = candidate.runs?.length
                            ? renderCaptionRuns(measuredHtml, candidate.text, candidate.runs) : measuredHtml;
                        captionLayer.appendChild(measuringPlate);
                        startRects.set(id, captionVisualRect(measuringPlate));
                        startLayoutRects.set(id, captionLayoutRect(measuringPlate));
                        startTransforms.set(id, captionTransformValues(measuringPlate));
                        measuringPlate.remove();
                    }
                }
                let moved = false;
                let lastOutputDelta = { x: 0, y: 0 };
                selectionDragActive = true;
                document.body.classList.add('akari-caption-moving');
                try { captionPlate.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const outputFrame = captionOutputFrame();
                let dragSnap = { x: null, y: null };
                let settleTimer = null;
                const clearSettleTimer = () => {
                    if (settleTimer !== null && typeof clearTimeout === 'function') clearTimeout(settleTimer);
                    settleTimer = null;
                };
                const cleanup = () => {
                    selectionDragActive = false;
                    clearSettleTimer();
                    document.body.classList.remove('akari-caption-moving');
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    setCaptionGroupMode(false);
                    window.akari.interaction?.hideSnapGuides?.();
                    if (captionPlate.hasPointerCapture && captionPlate.hasPointerCapture(pointerId)) {
                        captionPlate.releasePointerCapture(pointerId);
                    }
                };
                const onMove = (moveEvent, settled = false) => {
                    if (moveEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    const dx = moveEvent.clientX - startClientX;
                    const dy = moveEvent.clientY - startClientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved || !(outputFrame.width > 0) || !(outputFrame.height > 0)) return;
                    const nowOutputPoint = captionOutputPoint(moveEvent.clientX, moveEvent.clientY);
                    let outputDx = nowOutputPoint.x - startOutputPoint.x;
                    let outputDy = nowOutputPoint.y - startOutputPoint.y;
                    if (moveEvent.shiftKey) {
                        if (Math.abs(outputDx) >= Math.abs(outputDy)) outputDy = 0;
                        else outputDx = 0;
                    }
                    if (!groupMode && clampOn) {
                        const plateW = startPlateRect.right - startPlateRect.left;
                        const plateH = startPlateRect.bottom - startPlateRect.top;
                        const minDx = outputFrame.x - startPlateRect.left;
                        const maxDx = outputFrame.x + outputFrame.width - plateW - startPlateRect.left;
                        outputDx = maxDx < minDx
                            ? minDx : Math.min(maxDx, Math.max(minDx, outputDx));
                        const minDy = outputFrame.y - startPlateRect.top;
                        const maxDy = outputFrame.y + outputFrame.height - plateH - startPlateRect.top;
                        outputDy = maxDy < minDy
                            ? maxDy : Math.min(maxDy, Math.max(minDy, outputDy));
                    }
                    if (!captionSnapEnabled || moveEvent.metaKey || moveEvent.ctrlKey
                        || !window.akari.interaction?.computeSnapCorrection) {
                        dragSnap = { x: null, y: null };
                        window.akari.interaction?.hideSnapGuides?.();
                    } else {
                        const left = startPlateRect.left + outputDx;
                        const right = startPlateRect.right + outputDx;
                        const top = startPlateRect.top + outputDy;
                        const bottom = startPlateRect.bottom + outputDy;
                        const snap = window.akari.interaction.computeSnapCorrection({
                            left, right, top, bottom,
                            centerX: (left + right) / 2, centerY: (top + bottom) / 2
                        }, dragSnap, { kind: 'caption', id: cueId,
                            ids: multiMove ? [...selectedCaptionIds] : undefined });
                        dragSnap = snap;
                        if (snap.x) outputDx += snap.x.correction;
                        if (snap.y) outputDy += snap.y.correction;
                        window.akari.interaction.showSnapGuides(snap.x, snap.y);
                    }
                    lastOutputDelta = { x: outputDx, y: outputDy };
                    if (multiMove) {
                        for (const row of captionRows.values()) {
                            const id = row.caption.sourceCueId || row.caption.id;
                            if (selectedCaptionIds.has(id)) {
                                const start = startRowTranslates.get(id)
                                    ?? (id === cueId ? startPlateTranslate : { x: 0, y: 0 });
                                row.plate.style.translate = (start.x + outputDx) + 'px '
                                    + (start.y + outputDy) + 'px';
                            }
                        }
                        updateCaptionSelectBox();
                    } else {
                        outputDx += startPlateTranslate.x;
                        outputDy += startPlateTranslate.y;
                        captionPlate.style.translate = outputDx + 'px ' + outputDy + 'px';
                        updateCaptionSelectBoxForRect(captionVisualRect());
                    }
                    if (!settled && typeof setTimeout === 'function') {
                        settleTimer = setTimeout(() => {
                            settleTimer = null;
                            if (!captionFinished) onMove(moveEvent, true);
                        }, 96);
                    }
                };
                let captionFinished = false;
                const writtenPositions = new Map();
                const rememberThisCaptionPosition = (id, value) => {
                    if (typeof rememberCaptionPosition !== 'undefined') {
                        writtenPositions.set(id, rememberCaptionPosition(id, value));
                    }
                };
                const finish = async cancelled => {
                    if (captionFinished) return;
                    captionFinished = true;
                    cleanup();
                    if (cancelled || !moved) {
                        for (const row of captionRows.values()) {
                            if (multiMove && selectedCaptionIds.has(row.caption.sourceCueId || row.caption.id)) {
                                const id = row.caption.sourceCueId || row.caption.id;
                                const start = startRowTranslates.get(id)
                                    ?? (id === cueId ? startPlateTranslate : { x: 0, y: 0 });
                                row.plate.style.translate = start.x || start.y
                                    ? start.x + 'px ' + start.y + 'px' : '';
                            }
                        }
                        captionPlate.style.translate = startPlateTranslate.x || startPlateTranslate.y
                            ? startPlateTranslate.x + 'px ' + startPlateTranslate.y + 'px' : '';
                        updateCaptionSelectBox();
                        if (typeof captionGestureCount !== 'undefined') captionGestureCount -= 1;
                        window.akari.reportGesture?.('end');
                        if (typeof replayPendingCaptionUpdate !== 'undefined') replayPendingCaptionUpdate();
                        return;
                    }
                    pendingCaptionDragReload = true;
                    try {
                        if (groupMode) {
                            const groupPosition = frameCaptionPosition(caption, captionGroupPositionFromRects(
                                captionVisualRect(),
                                captionLayoutRect(),
                                outputFrame,
                                startAnchor,
                                startTransform
                            ));
                            await window.akari.engine.captionWrite(cueId, { groupPosition });
                        } else if (duplicatePlacedText) {
                            const cuePosition = frameCaptionPosition(caption, captionPositionFromVisualRect(
                                captionVisualRect(), captionLayoutRect(), outputFrame,
                                { anchor: startAnchor, clamp: clampOn,
                                    timeDomain: caption.timeDomain, ...startTransform }
                            ));
                            await window.akari.engine.captionWrite(cueId, { duplicate: cuePosition });
                            captionPlate.style.translate = '';
                        } else if (multiMove) {
                            const cuePositions = moveIds.map(id => {
                                const target = captions.find(item => (item.sourceCueId || item.id) === id);
                                const rect = startRects.get(id);
                                const movedRect = {
                                    left: rect.left + lastOutputDelta.x,
                                    right: rect.right + lastOutputDelta.x,
                                    top: rect.top + lastOutputDelta.y,
                                    bottom: rect.bottom + lastOutputDelta.y
                                };
                                const anchor = target.textStyle?.text_anchor || 'bc';
                                const clamp = captionClampEnabled(target);
                                const value = frameCaptionPosition(target, captionPositionFromVisualRect(
                                    movedRect, startLayoutRects.get(id), outputFrame,
                                    { anchor, clamp, timeDomain: target.timeDomain, ...startTransforms.get(id) }
                                ));
                                return { captionId: id, value };
                            });
                            for (const { captionId, value } of cuePositions) {
                                rememberThisCaptionPosition(captionId, value);
                            }
                            await window.akari.engine.captionWrite(cueId, { cuePositions });
                            for (const id of moveIds) captionCuePositionKnown.set(id, true);
                        } else {
                            const cuePosition = captionPositionFromVisualRect(
                                captionVisualRect(), captionLayoutRect(), outputFrame,
                                { anchor: startAnchor, clamp: clampOn,
                                    timeDomain: caption.timeDomain, ...startTransform }
                            );
                            Object.assign(cuePosition, frameCaptionPosition(caption, cuePosition));
                            rememberThisCaptionPosition(cueId, cuePosition);
                            await window.akari.engine.captionWrite(cueId, {
                                cuePosition
                            });
                            captionCuePositionKnown.set(cueId, true);
                        }
                        window.akari.reportGesture?.('saved');
                    } catch (error) {
                        for (const [id, pending] of writtenPositions) {
                            if (captionPositionOverrides.get(id) === pending) captionPositionOverrides.delete(id);
                        }
                        if (typeof latestCaptionMove === 'undefined'
                            || latestCaptionMove.get(cueId) === captionMoveToken) {
                            pendingCaptionDragReload = false;
                            if (multiMove) for (const row of captionRows.values()) row.plate.style.translate = '';
                            captionPlate.style.translate = '';
                        }
                        console.warn('[akari-preview] caption position write rejected; reverting', error);
                        window.akari.showWriteError(error);
                    }
                    for (const [id, pending] of writtenPositions) {
                        if (captionPositionOverrides.get(id) === pending) pending.saved = true;
                    }
                    if (typeof captionGestureCount !== 'undefined') captionGestureCount -= 1;
                    window.akari.reportGesture?.('end');
                    if (typeof replayPendingCaptionUpdate !== 'undefined') replayPendingCaptionUpdate();
                    if (typeof selectionGestures !== 'undefined') {
                        if (!captionGestureCount && !selectionGestures.size) pendingSelectionModel = null;
                        else {
                            const flush = flushPendingSelectionModel;
                            flush();
                        }
                    }
                    updateCaptionSelectBox();
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    if (Number.isFinite(upEvent.clientX) && Number.isFinite(upEvent.clientY)) onMove(upEvent, true);
                    void finish(false);
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId) return;
                    clearSettleTimer();
                    void finish(true);
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    void finish(true);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
            };
            captionLayer.addEventListener('pointerdown', onCaptionPointerDown);
            captionSelectBox.addEventListener('pointerdown', event => {
                if (event.target.closest?.('.akari-caption-handle')) onCaptionPointerDown(event);
            }, true);
            captionSelectBox.addEventListener('dblclick', event => {
                const handle = event.target.closest?.('.akari-caption-handle[data-h="e"], .akari-caption-handle[data-h="w"]');
                if (!handle) return;
                const caption = selectedCaption();
                const plate = selectedCaptionPlate();
                if (!caption || caption.timeDomain !== 'output' || !plate) return;
                event.preventDefault();
                event.stopPropagation();
                const lines = [...plate.querySelectorAll('.akari-caption__line')];
                if (!lines.length) return;
                const outputWidth = Number(summary.output?.width) || 1280;
                const outputHeight = Number(summary.output?.height) || 720;
                const scale = parseFloat(getComputedStyle(plate).getPropertyValue('--caption-scale')) || 1;
                const inkRect = line => {
                    const range = document.createRange();
                    range.selectNodeContents(line);
                    return range.getBoundingClientRect();
                };
                const beforeRect = inkRect(lines[0]);
                const beforeInk = captionOutputPoint(beforeRect.left, beforeRect.top);
                const longest = Math.max(...lines.map(line => {
                    const rect = inkRect(line);
                    return (captionOutputPoint(rect.right, rect.top).x
                        - captionOutputPoint(rect.left, rect.top).x) / scale;
                }));
                const lineStyle = getComputedStyle(lines[0]);
                const noBackground = !caption.textStyle?.background;
                const padding = noBackground ? 0 : (parseFloat(lineStyle.paddingLeft) || 0)
                    + (parseFloat(lineStyle.paddingRight) || 0);
                const fit = captionWrapFitWidthFn(longest, padding, outputWidth);
                const originalStyle = plate.getAttribute('style');
                const layout = captionLayoutRect(plate);
                if (noBackground) {
                    plate.style.setProperty('--plate-pad-x', '0px');
                    plate.style.setProperty('--plate-pad-y', '0px');
                }
                plate.style.setProperty('--caption-wrap-width', fit.widthPct + '%');
                plate.style.setProperty('--caption-plate-margin', '0');
                plate.style.setProperty('--caption-left', layout.left / outputWidth * 100 + '%');
                plate.style.setProperty('--caption-top', layout.top / outputHeight * 100 + '%');
                plate.style.setProperty('--caption-bottom', 'auto');
                plate.style.setProperty('--caption-translate', 'none');
                const afterRect = inkRect(lines[0]);
                const afterInk = captionOutputPoint(afterRect.left, afterRect.top);
                const fitted = captionWrapFitPositionFn(captionLayoutRect(plate), beforeInk, afterInk);
                const position = captionWrapPositionFn(fitted.left, fitted.top, outputWidth, outputHeight);
                plate.style.setProperty('--caption-left', position.position.x * 100 + '%');
                plate.style.setProperty('--caption-top', position.position.y * 100 + '%');
                updateCaptionSelectBox();
                const cueId = caption.sourceCueId || caption.id;
                void window.akari.engine.captionWrite(cueId, { plateTransform: {
                    captionIds: [cueId], wrapWidthPct: fit.widthPct,
                    ...(noBackground ? { backgroundPaddingPx: 0 } : {}),
                    cuePosition: { captionId: cueId, value: position }
                } }).catch(error => {
                    if (originalStyle === null) plate.removeAttribute('style');
                    else plate.setAttribute('style', originalStyle);
                    updateCaptionSelectBox();
                    window.akari.showWriteError(error);
                });
            });
            new ResizeObserver(() => updateCaptionSelectBox()).observe(wrapper);

            const applyTrackVisibility = track => {
                for (const container of stage.querySelectorAll('[data-akari-track]')) {
                    if (Number(container.getAttribute('data-akari-track')) === track) {
                        container.style.display = hiddenTracks.has(track) ? 'none' : '';
                    }
                }
            };
            const applyOverlayTracks = () => {
                for (const container of stage.querySelectorAll('[data-overlay-id]')) {
                    const id = container.getAttribute('data-overlay-id') || '';
                    const overlay = summary.overlays.find(candidate => String(candidate.id) === id);
                    const track = Number.isInteger(overlay?.track) && overlay.track >= 0 ? overlay.track : 0;
                    container.setAttribute('data-akari-track', String(track));
                    container.style.zIndex = String(zForItem(overlay?.id, zForTrack(overlay?.trackId)));
                    // Blend the whole HTML item against lower items and the preview image.
                    container.style.mixBlendMode = overlay?.blend || 'normal';
                    const domOpacity = previewDomOpacityFn('overlay', overlay?.opacity, frameEngineMediaIdle,
                        Array.isArray(overlay?.keyframes) || Boolean(overlay?.motion || overlay?.motionSource));
                    if (domOpacity !== null) container.style.opacity = domOpacity;
                    container.style.display = hiddenTracks.has(track) ? 'none' : '';
                }
                const captionZ = typeof summary.captionTrackId === 'string' && summary.captionTrackId
                    ? zForTrack(summary.captionTrackId) : -1;
                captionLayer.style.zIndex = summary.itemStackZ ? '' : captionZ >= 0 ? String(captionZ) : '';
            };
            window.akari.updateCanvasCaptionLayer = () => {
                if (summary.itemStackZ) return;
                const plan = canvasCaptionZPlanFn([...captionRows.values()].map(row => ({ ...row.caption,
                    canvasTrackId: summary.captionItemTrackIds?.[row.caption.id] || row.caption.canvasTrackId })),
                    summary.captionTrackId, zForTrack);
                captionLayer.style.zIndex = plan.split ? 'auto' : plan.layerZ >= 0 ? String(plan.layerZ) : '';
                for (const row of captionRows.values()) {
                    const z = plan.plateZ.get(row.caption.id);
                    row.plate.style.zIndex = plan.split && z !== undefined && z >= 0 ? String(z) : '';
                }
            };
            // source↔output 写像の正本は packages/edit-store/src/timeline-map.ts。webview は
            // sandbox 制約で import できないため、共有カーネル webview-kernel.js（IIFE バンドル、
            // global: AkariEditKernel）をインライン注入して共有する（overlay-runtime と同経路）。
            // 旧インライン複製（rebuildKeepRanges / computeVideoRuns 等）は撤去済み。旧複製との
            // 意味論差: gaps/tracks モードの暗黙 at にもトランジション重なりが載る（書き込み側
            // computeCutTrackSegments と同じ = 正本挙動へ収斂）。
            const rebuildSegments = () => {
                preloadedTransitionWindowKey = null;
                standbyPreloadKey = null;
                standbyPreloadReadyKey = null;
                delete transitionVideo.dataset.akariPreloadedWindow;
                delete transitionStill.dataset.akariPreloadedWindow;
                const rawCuts = Array.isArray(summary.cuts) ? summary.cuts : [];
                const timelineCuts = rawCuts.map(cut => ({ ...cut, track: cut.renderTrack }));
                // shell summary は item.declaration 由来なので通常は internal-model が合成した
                // 実重なりを既存窓として読む。handleRoom は webview-kernel を生 cuts で使う消費者にも
                // 静止画の無限 head/tail room を伝えるための経路で、両経路の等価性は edit-store の
                // transition-window-path-equivalence.test.mjs が固定する。
                const map = window.AkariEditKernel.buildTimelineMap(timelineCuts, {
                    trackZ: track => track,
                    fps,
                    handleRoom: cutIndex => imageSources[String(timelineCuts[cutIndex]?.src)]
                        ? { tailSeconds: Number.POSITIVE_INFINITY, headSeconds: Number.POSITIVE_INFINITY }
                        : undefined
                });
                if (map.segments.length > 0) {
                    // transform / opacity / crop / perspective / keyframes は再生時の見た目情報で
                    // 写像には関与しないため、共有カーネルの segment には無い。元 cuts から補う。
                    const decorateSegment = segment => {
                        if (segment.kind !== 'src' || !Number.isInteger(segment.cutIndex)) {
                            return segment;
                        }
                        const cut = rawCuts[segment.cutIndex];
                        return {
                            ...segment,
                            id: cut ? cut.id : undefined,
                            audio: cut ? cut.audio : undefined,
                            mute: cut ? cut.mute : undefined,
                            trackId: cut ? cut.trackId : undefined,
                            transform: cut ? cut.transform : undefined,
                            opacity: cut ? cut.opacity : undefined,
                            crop: cut ? cut.crop : undefined,
                            perspective: cut ? cut.perspective : undefined,
                            keyframes: cut ? cut.keyframes : undefined,
                            motion: cut ? cut.motion : undefined,
                            adjust: cut ? cut.adjust : undefined,
                            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md）:
                            // 同じ理由（写像には関与しない見た目/再生情報）で元 cuts から補う。
                            framing: cut ? cut.framing : undefined,
                            freeze: cut ? cut.freeze : undefined
                        };
                    };
                    segments = map.segments.map(decorateSegment);
                    transitionWindows = (map.transitionWindows || []).map(window => ({
                        ...window,
                        outgoing: decorateSegment(window.outgoing),
                        incoming: decorateSegment(window.incoming)
                    }));
                    totalTimelineDuration = map.totalDuration;
                } else {
                    // cuts 無し（または全て不正）: 全編を 1 セグメントとして扱う（従来挙動）
                    const duration = videoDuration();
                    segments = duration > 0
                        ? [{
                            kind: 'src', outStart: 0, outEnd: duration, cutIndex: null,
                            in: 0, out: duration, speed: 1, track: 0, transitionOut: null
                        }]
                        : [];
                    transitionWindows = [];
                    totalTimelineDuration = duration > 0 ? duration : 0;
                }
                const cutsEndSeconds = totalTimelineDuration;
                const contentDurationSeconds = computeContentDurationSeconds(cutsEndSeconds);
                if (contentDurationSeconds > cutsEndSeconds + 0.001) {
                    segments.push({ outStart: cutsEndSeconds, outEnd: contentDurationSeconds, kind: 'gap' });
                    totalTimelineDuration = contentDurationSeconds;
                }
                if (window.akari.previewAudio && totalTimelineDuration > 0) {
                    void window.akari.previewAudio.setTimelineDuration(totalTimelineDuration);
                }
                if (activeSegmentIndex >= segments.length) {
                    activeSegmentIndex = Math.max(0, segments.length - 1);
                }
                outputTime = clamp(outputTime, 0, totalTimelineDuration);
                syncSegmentPlaybackRate();
                preloadUpcomingTransition(outputTime);
                preloadUpcomingCut(outputTime);
                prepareScrubAudioSources();
            };
            const syncSegmentPlaybackRate = () => {
                if (frameEngineMediaIdle) return;
                const segment = segments[activeSegmentIndex];
                const speed = segment && segment.kind === 'src'
                    && Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                const effectiveRate = effectiveMediaRateFn(speed, previewRate);
                if (video.playbackRate !== effectiveRate) {
                    video.playbackRate = effectiveRate;
                }
            };
            // v1 マルチソース（edit.json sources[] + cuts[].src）。id → ストリーム URL の表を
            // ホストから受け取り、カットの継ぎ目でソースが変わるときだけ <video> を差し替える。
            // v0 / 単一ソースの案件は表が 1 件なので一度も差し替えが起きない。
            const videoSources = initial.videoSources || {};
            let currentVideoSourceId = null;
            for (const [id, url] of Object.entries(videoSources)) {
                if (url === video.getAttribute('src')) currentVideoSourceId = id;
            }
            let currentStandbyVideoSourceId = null;
            let standbyPreloadKey = null;
            let standbyPreloadReadyKey = null;
            const CUT_PRELOAD_LEAD_SECONDS = 0.75;
            // 実素材では +0.35s の同一ソース境界は warm cache で 68-76ms だった一方、
            // +0.58/+0.63s から 160-265ms の停止が観測された。連続カットを現行経路に残しつつ、
            // 体感停止へ入る側を前倒しする境界として 0.5s 超をプリシーク対象にする。
            const SAME_SOURCE_PRESEEK_THRESHOLD_SECONDS = 0.5;
            const standbyKeyForSegment = (index, segment) => index + ':'
                + String(segment && segment.src) + ':' + String(segment && segment.in);
            // 差し替えたときだけ true を返す（呼び出し側は false なら即座に続行する）
            const applySegmentSource = (segment, onReady) => {
                if (frameEngineMediaIdle) return false;
                const nextId = segment && segment.src;
                if (!nextId || nextId === currentVideoSourceId) return false;
                const nextUrl = videoSources[nextId];
                if (!nextUrl) return false;
                currentVideoSourceId = nextId;
                sourceSwapPending = true;
                video.addEventListener('loadedmetadata', () => {
                    try {
                        onReady();
                    } finally {
                        sourceSwapPending = false;
                        tick(true);
                    }
                }, { once: true });
                video.src = nextUrl;
                video.load();
                return true;
            };
            const primeStandbySegment = (index, segment) => {
                if (frameEngineMediaIdle) return;
                const nextId = segment && segment.kind === 'src' ? segment.src : null;
                const nextUrl = nextId && videoSources[nextId];
                if (!nextId || !nextUrl || isStillSegment(segment)) return;
                const key = standbyKeyForSegment(index, segment);
                // rAF ごとの呼び出しで同じ load/seek を積み増さない。未完了のまま境界へ着いた場合は
                // 再試行で現在のデコードを潰さず、そのまま現行フォールバックへ渡す。
                if (standbyPreloadKey === key) return;
                standbyPreloadKey = key;
                standbyPreloadReadyKey = null;
                clearAdjustBaseFilter(standbyVideo);
                setAdjustBaseFilter(standbyVideo, segment);
                const target = Number.isFinite(segment.in) ? segment.in : 0;
                const markReady = () => {
                    if (standbyPreloadKey !== key || currentStandbyVideoSourceId !== nextId) return;
                    if (standbyVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
                    if (Math.abs((standbyVideo.currentTime || 0) - target) > 0.05) return;
                    standbyVideo.pause();
                    standbyPreloadReadyKey = key;
                };
                const seekStandby = () => {
                    if (standbyPreloadKey !== key || currentStandbyVideoSourceId !== nextId) return;
                    const speed = Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                    standbyVideo.playbackRate = effectiveMediaRateFn(speed, previewRate);
                    standbyVideo.muted = true;
                    standbyVideo.pause();
                    if (Math.abs((standbyVideo.currentTime || 0) - target) <= 0.001) {
                        if (standbyVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markReady();
                        else standbyVideo.addEventListener('loadeddata', markReady, { once: true });
                        return;
                    }
                    standbyVideo.addEventListener('seeked', markReady, { once: true });
                    try {
                        standbyVideo.currentTime = target;
                    } catch (_error) {
                        // loadedmetadata 後でも Chromium が一時的に seek を拒む場合は未完了のままにし、
                        // 境界側を従来フォールバックへ落とす。
                    }
                };
                if (currentStandbyVideoSourceId === nextId
                    && standbyVideo.getAttribute('src') === nextUrl
                    && standbyVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
                    seekStandby();
                    return;
                }
                currentStandbyVideoSourceId = nextId;
                standbyVideo.addEventListener('loadedmetadata', seekStandby, { once: true });
                standbyVideo.src = nextUrl;
                standbyVideo.load();
            };
            preloadUpcomingCut = timelineTime => {
                if (frameEngineMediaIdle) return;
                const current = segments[activeSegmentIndex];
                const nextIndex = activeSegmentIndex + 1;
                const next = segments[nextIndex];
                if (!current || !next || next.kind !== 'src' || isStillSegment(next)) return;
                const secondsToBoundary = next.outStart - timelineTime;
                if (secondsToBoundary < 0 || secondsToBoundary > CUT_PRELOAD_LEAD_SECONDS) return;
                const sourceChanges = String(next.src) !== String(currentVideoSourceId);
                const sourceDiscontinuity = current.kind === 'src' && String(current.src) === String(next.src)
                    ? Math.abs((Number(next.in) || 0) - (Number(current.out) || 0)) : Number.POSITIVE_INFINITY;
                if (!sourceChanges && sourceDiscontinuity <= SAME_SOURCE_PRESEEK_THRESHOLD_SECONDS) return;
                primeStandbySegment(nextIndex, next);
            };
            const activatePreloadedSegment = (index, segment, target) => {
                const key = standbyKeyForSegment(index, segment);
                if (standbyPreloadKey !== key || standbyPreloadReadyKey !== key) return false;
                if (String(currentStandbyVideoSourceId) !== String(segment.src)
                    || Math.abs((standbyVideo.currentTime || 0) - target) > 0.05) return false;
                const outgoingVideo = video;
                const outgoingSourceId = currentVideoSourceId;
                outgoingVideo.pause();
                video = standbyVideo;
                standbyVideo = outgoingVideo;
                currentVideoSourceId = currentStandbyVideoSourceId;
                currentStandbyVideoSourceId = outgoingSourceId;
                standbyVideo.id = 'standby-video-buffer';
                video.id = 'preview-video';
                standbyVideo.id = 'standby-video';
                video.dataset.akariTransitionRole = 'outgoing';
                delete video.dataset.akariPlaybackRole;
                delete standbyVideo.dataset.akariTransitionRole;
                standbyVideo.dataset.akariPlaybackRole = 'standby';
                video.style.display = '';
                standbyVideo.style.display = 'none';
                standbyVideo.muted = true;
                const outgoingFxRail = baseVideoFxRail;
                baseVideoFxRail = standbyVideoFxRail;
                standbyVideoFxRail = outgoingFxRail;
                syncDoubleBufferVideoFxVisibility();
                if (window.akari.activateStandbyVideoElement) {
                    window.akari.activateStandbyVideoElement(video, standbyVideo);
                }
                standbyPreloadKey = null;
                standbyPreloadReadyKey = null;
                return true;
            };
            let currentTransitionVideoSourceId = null;
            const applyTransitionSegmentSource = (segment, onReady) => {
                if (frameEngineMediaIdle) return false;
                const nextId = segment && segment.src;
                if (!nextId) return false;
                const nextUrl = videoSources[nextId];
                if (!nextUrl) return false;
                if (nextId === currentTransitionVideoSourceId
                    && transitionVideo.getAttribute('src') === nextUrl) return false;
                currentTransitionVideoSourceId = nextId;
                transitionVideo.addEventListener('loadedmetadata', onReady, { once: true });
                transitionVideo.src = nextUrl;
                transitionVideo.load();
                return true;
            };
            // 静止画 cut ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル
            // 対応）。id → asset ストリーム URL の表にあるセグメントは <video> ではなく
            // #preview-still で表示し、クロックは gap セグメントと同じ壁時計
            // （gapWallClockOriginMs / gapOutputOrigin をそのまま共用）で進める。
            const imageSources = initial.imageSources || {};
            preloadUpcomingTransition = timelineTime => {
                if (frameEngineMediaIdle) return;
                const upcoming = transitionWindows.find(candidate => timelineTime < candidate.end);
                if (!upcoming) return;
                const key = upcoming.start + ':' + upcoming.end + ':' + upcoming.incoming.cutIndex;
                if (preloadedTransitionWindowKey === key) return;
                preloadedTransitionWindowKey = key;
                const upcomingStillUrl = stillUrlForSegment(upcoming.incoming);
                if (upcomingStillUrl) {
                    transitionStill.dataset.akariPreloadedWindow = key;
                    if (transitionStill.getAttribute('src') !== upcomingStillUrl) {
                        transitionStill.setAttribute('src', upcomingStillUrl);
                    }
                    transitionStill.style.display = 'none';
                    if (typeof transitionStill.decode === 'function') {
                        void transitionStill.decode().catch(() => undefined);
                    }
                    return;
                }
                transitionVideo.dataset.akariPreloadedWindow = key;
                const primeIncomingFrame = () => {
                    if (transitionVideo.readyState < HTMLMediaElement.HAVE_METADATA) return;
                    const speed = Number.isFinite(upcoming.incoming.speed) && upcoming.incoming.speed > 0
                        ? upcoming.incoming.speed : 1;
                    transitionVideo.playbackRate = effectiveMediaRateFn(speed, previewRate);
                    if (outputTime < upcoming.start) {
                        const target = upcoming.incoming.in;
                        if (Math.abs((transitionVideo.currentTime || 0) - target) > 0.001) {
                            try { transitionVideo.currentTime = target; } catch (_error) { /* metadata pending */ }
                        }
                        transitionVideo.pause();
                    } else if (outputTime < upcoming.end) {
                        tick(true);
                    }
                };
                if (!applyTransitionSegmentSource(upcoming.incoming, primeIncomingFrame)) {
                    primeIncomingFrame();
                }
            };
            const stillUrlForSegment = segment => (segment && segment.kind === 'src'
                && segment.src !== undefined && imageSources[String(segment.src)]) || null;
            const isStillSegment = segment => Boolean(stillUrlForSegment(segment));
            const resolveScrubSeekFn = (${resolveScrubSeek.toString()});
            // globalMuted と cut track の可聴規則をその場で評価する。frame-engine 経路でも
            // legacy <video> の muted 状態に依存せず、同じ規則でスクラブ音を止める。
            const scrubAudioMedia = {
                get muted() {
                    const segment = segments[activeSegmentIndex];
                    const cutsTrackMuted = Boolean(segment && segment.kind === 'src'
                        && (allTracksMutedByScope.cuts || mutedTracksByScope.cuts.has(segment.track)));
                    return globalMuted || !isCutAudioAudibleFn(segment || {}, { muted: cutsTrackMuted });
                },
                get volume() { return Number.isFinite(video.volume) ? video.volume : 1; }
            };
            let scrubAudio = null;
            const ensureScrubAudio = () => {
                if (scrubAudio) return scrubAudio;
                const api = window.AkariScrubAudio;
                if (!api || typeof api.createScrubAudioController !== 'function') return null;
                const audioContext = window.akari.ensurePreviewAudioContext();
                if (!audioContext) return null;
                scrubAudio = api.createScrubAudioController({
                    audioContext,
                    video: scrubAudioMedia,
                    getBgm: () => window.akari.previewAudio && window.akari.previewAudio.scrubBgm
                        ? window.akari.previewAudio.scrubBgm(outputTime) : undefined,
                    enabled: true
                });
                window.akari.scrubAudio = scrubAudio;
                return scrubAudio;
            };
            let scrubAudioEnabled = initial.scrubAudioEnabled !== false;
            const scrubSrcForSegment = segment => {
                if (!segment || segment.kind !== 'src' || isStillSegment(segment)) return null;
                const srcId = segment.src;
                return (srcId && ((initial.videoSourceOriginals || {})[srcId] || videoSources[srcId]))
                    || video.currentSrc || video.getAttribute('src') || null;
            };
            const prepareScrubAudioSources = () => {
                if (!scrubAudioEnabled) return;
                const controller = ensureScrubAudio();
                if (!controller) return;
                const srcs = [...new Set(segments.map(scrubSrcForSegment).filter(Boolean))];
                if (srcs.length) void controller.prepare(srcs);
            };
            const setScrubAudioEnabled = enabled => {
                scrubAudioEnabled = enabled === true;
                if (scrubAudioEnabled) {
                    const controller = ensureScrubAudio();
                    if (controller) {
                        controller.enabled = true;
                        prepareScrubAudioSources();
                    }
                } else if (scrubAudio) {
                    scrubAudio.enabled = false;
                }
            };
            const notifyScrubSeek = () => {
                if (!scrubAudioEnabled) return;
                const controller = ensureScrubAudio();
                if (!controller) return;
                const mapped = timelineToSource(outputTime);
                const segment = segments[mapped.index];
                const input = resolveScrubSeekFn({
                    outputTime,
                    isPlaying,
                    mapped,
                    segment,
                    isStill: isStillSegment(segment),
                    videoSources,
                    videoSourceOriginals: initial.videoSourceOriginals || {},
                    fallbackSrc: video.currentSrc || ''
                });
                if (input) {
                    controller.onSeek(input);
                }
            };
            window.akari.scrubAudioDebug = () => ({
                enabled: scrubAudioEnabled,
                controller: Boolean(scrubAudio),
                controllerEnabled: scrubAudio ? scrubAudio.enabled : null,
                lastError: scrubAudio ? scrubAudio.lastError : null,
                contextState: scrubAudio ? scrubAudio.context.state : null,
                inFlightFetches: scrubAudio ? scrubAudio.inFlightFetches : null
            });
            const hideStillImage = () => { stillImage.style.display = 'none'; };
            const syncStillImageVisual = () => {
                if (stillImage.style.display === 'none') return;
                if (stillImage.dataset.akariCutLayerStyleActive === 'true'
                    && window.akari.applyCutLayerStyleLayout) {
                    window.akari.applyCutLayerStyleLayout(stillImage);
                    stillImage.style.opacity = video.style.opacity;
                    stillImage.style.zIndex = video.style.zIndex;
                    return;
                }
                // #preview-video のインラインスタイルを鏡写しにする。updateStageScale /
                // applyCutVisual / applyCutFramingVisual は video が hidden の間も video の
                // style を書き続けるので、静止画はそれを写すだけで配置・cut transform・
                // framing の既存レールに乗る。visibility だけは写さない（video 側は静止画
                // セグメント中つねに hidden のため）。
                stillImage.style.left = video.style.left;
                stillImage.style.top = video.style.top;
                stillImage.style.width = video.style.width;
                stillImage.style.height = video.style.height;
                stillImage.style.transform = video.style.transform;
                stillImage.style.transformOrigin = video.style.transformOrigin;
                stillImage.style.opacity = video.style.opacity;
                stillImage.style.zIndex = video.style.zIndex;
            };
            const showStillImage = url => {
                if (frameEngineMediaIdle) {
                    hideStillImage();
                    return;
                }
                if (stillImage.getAttribute('src') !== url) stillImage.setAttribute('src', url);
                stillImage.style.display = 'block';
                syncStillImageVisual();
            };
            stillImage.addEventListener('load', () => {
                const segment = segments[activeSegmentIndex];
                if (segment && cutHasLayerStyleVisual(segment)) {
                    applyCutKeyframesToMedia(stillImage, segment, Math.max(0, outputTime - segment.outStart));
                }
                syncStillImageVisual();
            });
            const clampSourceTime = (sourceTime, preferredIndex) =>
                resolveSourceClockPositionFn(segments, sourceTime, preferredIndex);
            // segment.freeze / framing.keyframes[].t の座標系（カット内・速度適用後の再生秒）に
            // 合わせる。gap セグメントには意味がないため 0 を返す（呼び出し側はどのみち framing/freeze
            // が無いことを先にガードするが、defensive に安全な既定値を返しておく）。
            const playedCutLocalSeconds = segment => {
                if (!segment || segment.kind !== 'src') return 0;
                // 静止画セグメントは video.currentTime が動かないため、マスタークロック
                // outputTime から直接算出する（preview-server public/app.js の同名処理と同じ裁定）。
                if (isStillSegment(segment)) return Math.max(0, outputTime - segment.outStart);
                const speed = Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                return ((video.currentTime || 0) - segment.in) / speed;
            };
            // ㉕ cuts[].framing の毎フレーム反映。hostAdapterScript 側の updateStageScale が書く
            // cut.transform（PIP 位置決め）部分を dataset.akariBaseTransform 経由で受け取り、その
            // 手前（内側）に framing のズーム/クロップを合成する。framing 無しの既存プロジェクトは
            // baseTransform をそのまま書くだけなので見た目・回帰は無い。
            const captureCutTransitionBaseTransform = () => {
                video.dataset.akariTransitionBaseTransform = video.style.transform || '';
                stillImage.dataset.akariTransitionBaseTransform = stillImage.style.transform || '';
            };
            const applyCutFramingVisual = () => {
                const segment = segments[activeSegmentIndex];
                if (segment && cutHasLayerStyleVisual(segment)) {
                    // layer-style の crop pivot / perspective を書く同一レール。framing は従来の
                    // canvas-fit cut 専用レールなので、plain cut の既存分岐には触れない。
                    if (window.akari.applyCutLayerStyleLayout) window.akari.applyCutLayerStyleLayout(video);
                    syncStillImageVisual();
                    captureCutTransitionBaseTransform();
                    return;
                }
                const framing = segment && segment.kind === 'src' ? segment.framing : null;
                const visual = computeCutFramingVisualFn(framing, playedCutLocalSeconds(segment));
                const baseTransform = video.dataset.akariBaseTransform || '';
                if (visual) {
                    video.style.transformOrigin = visual.transformOrigin;
                    video.style.transform = (baseTransform ? baseTransform + ' ' : '') + visual.transform;
                } else {
                    video.style.transformOrigin = '';
                    video.style.transform = baseTransform;
                }
                // 静止画セグメント表示中は、ここで確定した video の最終スタイルを鏡写しにする
                //（updateStageScale 経由のリサイズと tick() の毎フレームの両方がここを通る）。
                syncStillImageVisual();
                captureCutTransitionBaseTransform();
            };
            window.akari.applyCutFramingVisual = applyCutFramingVisual;
            const enterSegment = index => {
                if (index < 0 || index >= segments.length) return;
                // ㉕ フリーズホールドはセグメント（カット）が変わったら破棄する（seek 含む
                // enterSegment 呼び出し全経路がここを通る）。古い holdSeconds タイマーが新しい
                // セグメントの tick() を誤って早期 return させるのを防ぐ。
                freezeHoldUntilMs = 0;
                freezeHoldConsumedForSegmentIndex = null;
                activeSegmentIndex = index;
                const segment = segments[index];
                if (frameEngineMediaIdle) {
                    applyCutVisual(segment);
                    // engine 面では frame engine 起動前の tick() → applyCutsMuteState() が
                    // インライン visibility='hidden' を書き残す（起動後の tick() は
                    // frameEngineClock があると早期 return するので二度と上書きされない）。
                    // 残留値を空へ戻さないと cutVisualHidden が常時 true のままになり、
                    // カット選択枠（#cut-select-box）が出せない。画面上は生成 CSS
                    // #preview-stage[data-frame-engine-active="true"] #preview-video の
                    // visibility: hidden !important が隠し続けるので土台 video は出ない。
                    video.style.visibility = '';
                    hideStillImage();
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                if (segment.kind === 'gap') {
                    applyCutVisual(segment);
                    // video.pause() は既に一時停止中だと 'pause' イベントを発火しない
                    // （ブラウザ仕様）。その場合に pausedForGapEntry を立てると、次に来る
                    // 本物の 'pause' イベント（例えば別セグメントで実際に再生中だったものを
                    // 止めた時）がこの使い古しの flag を誤って消費してしまう。
                    if (!video.paused) {
                        pausedForGapEntry = true;
                        video.pause();
                    }
                    video.style.visibility = 'hidden';
                    hideStillImage();
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                const stillUrl = stillUrlForSegment(segment);
                if (stillUrl) {
                    // 静止画セグメント: gap と同じ壁時計駆動。video は止めて隠し、
                    // #preview-still を出す（pausedForGapEntry の使い方も gap と同一）。
                    applyCutVisual(segment);
                    if (!video.paused) {
                        pausedForGapEntry = true;
                        video.pause();
                    }
                    video.style.visibility = 'hidden';
                    showStillImage(stillUrl);
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(outputTime - segment.outStart, 0, segmentDuration);
                const target = segment.in + withinSegment * segment.speed;
                const activatedPreload = activatePreloadedSegment(index, segment, target);
                applyCutVisual(segment);
                hideStillImage();
                video.style.visibility = '';
                syncSegmentPlaybackRate();
                const seekAndResume = () => {
                    if (Math.abs((video.currentTime || 0) - target) > 0.0005) {
                        video.currentTime = target;
                    }
                    if (isPlaying && video.paused) {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                };
                // v1 マルチソース: このカットが別ソースを指しているならストリームを差し替える。
                // 差し替え直後は readyState が 0 に戻り currentTime 代入が無視されるため、
                // loadedmetadata を待ってからシークする（単一ソースでは分岐しない）
                if (activatedPreload) {
                    seekAndResume();
                } else if (!applySegmentSource(segment, seekAndResume)) {
                    seekAndResume();
                }
            };
            const stopAtNaturalEnd = () => {
                if (!isPlaying) return;
                window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                isPlaying = false;
                if (scrubAudio) scrubAudio.onPlaybackPaused();
                freezeHoldUntilMs = 0;
                if (window.akari.frameEngineClock) {
                    window.akari.frameEngineClock.pause(outputTime);
                    return;
                }
                if (frameEngineMediaIdle) return;
                video.pause();
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            };
            const applyKeepRangeBoundary = () => {
                const segment = segments[activeSegmentIndex];
                if (!segment || segment.kind !== 'src') return;
                const current = video.currentTime || 0;
                if (current >= segment.out - 0.0005) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                const result = clampSourceTime(current, activeSegmentIndex);
                activeSegmentIndex = result.index;
                syncSegmentPlaybackRate();
                if (result.ended) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                if (Math.abs(current - result.time) > 0.0005) {
                    video.currentTime = result.time;
                }
            };
            const timelineToSource = timelineValue => {
                if (segments.length === 0) return { index: 0, kind: 'src', time: timelineValue };
                let index = segments.length - 1;
                for (let candidate = 0; candidate < segments.length; candidate += 1) {
                    if (timelineValue < segments[candidate].outEnd || candidate === segments.length - 1) {
                        index = candidate;
                        break;
                    }
                }
                const segment = segments[index];
                if (segment.kind === 'gap') return { index, kind: 'gap' };
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(timelineValue - segment.outStart, 0, segmentDuration);
                return { index, kind: 'src', time: segment.in + withinSegment * segment.speed };
            };
            const seekTimelineTime = timelineValue => {
                const previousOutputTime = outputTime;
                // 総尺ちょうどへシーク（末尾延長ギャップが最終セグメントの場合を含む）すると、
                // 直後の tick() が「境界に到達済み」と即判定して stopAtNaturalEnd() を出し、
                // 再生ボタンを押しても 1 フレームも進まず固まって見えるバグ⑬⑭の根本原因。
                // 末尾に数フレーム分の再生余地を残すようクランプすることで、再生開始が必ず
                // 観測可能な進行を1回は生む（自然再生が末尾へ到達して止まる経路 = tick() 内の
                // 別クランプは無改造のため、そちらの停止挙動は従来通り）。
                const seekableDuration = window.akari.frameEngineClock?.totalDuration
                    || totalTimelineDuration || videoDuration();
                const endSafetyMargin = Math.min(2 / fps, seekableDuration);
                const seekableMax = Math.max(0, seekableDuration - endSafetyMargin);
                outputTime = clamp(Math.max(0, timelineValue), 0, seekableMax);
                window.akari.updateEmptyCanvasHint?.(outputTime);
                window.akari.reviewTransport({ type: 'seek', from: previousOutputTime, to: outputTime });
                if (window.akari.frameEngineClock) {
                    outputTime = window.akari.frameEngineClock.seek(outputTime, isPlaying);
                    window.akari.updateEmptyCanvasHint?.(outputTime);
                    return;
                }
                const mapped = timelineToSource(outputTime);
                enterSegment(mapped.index);
                if (frameEngineMediaIdle) return;
                if (mapped.kind === 'src' && !isStillSegment(segments[mapped.index])) {
                    video.currentTime = mapped.time;
                } else if (isPlaying && window.akari.previewAudio) {
                    // gap と静止画: video のシークは発生しないため音声はここで追従させる
                    void window.akari.previewAudio.playFrom(outputTime);
                }
            };
            const applyInitialPosition = () => {
                // segments is only trustworthy once rebuildSegments() has run against a real
                // video.duration (i.e. after 'loadedmetadata'). The overlay-mount Promise.all
                // below can resolve *before* 'loadedmetadata' (fast for an empty/no-cuts
                // summary), which used to rebuild an empty fallback segment list, let this
                // function mark itself done against that empty list, and skip enterSegment(0)
                // forever -- leaving #preview-video's visibility stuck at 'hidden' (set by the
                // next tick()'s applyCutsMuteState(), which hides whenever there is no active
                // segment) until the user presses play. Bail out without setting the flag so the
                // *next* call (once segments is real) can still do the real work.
                if (initialPositionApplied) return;
                if (segments.length === 0) {
                    const emptyOutput = playbackMountReady && initial.kind === 'output' && totalTimelineDuration === 0
                        && !video.getAttribute('src')
                        && !(summary.cuts?.length || summary.layers?.length || summary.overlays?.length
                            || captions.length || summary.audio?.sfx?.length || summary.audio?.narration?.length
                            || summary.audio?.bgm);
                    if (!emptyOutput) return;
                    outputTime = 0;
                    initialPositionApplied = true;
                    window.akari.previewPositionReady = true;
                    return;
                }
                if (initial.frameEngineEnabled === true) {
                    if (!(window.akari.frameEngineClock?.totalDuration > 0)
                        || document.getElementById('frame-engine-preview')?.dataset.frameEngineReady !== 'true') return;
                } else if (Number.isFinite(initialSeekTarget) && initialSeekTarget > 0
                    && !(totalTimelineDuration > 0)) return;
                initialPositionApplied = true;
                if (Number.isFinite(initialSeekTarget)) {
                    seekTimelineTime(initialSeekTarget);
                } else {
                    outputTime = segments[0].outStart;
                    if (window.akari.frameEngineClock) seekTimelineTime(outputTime);
                    else enterSegment(0);
                }
                if (window.akari.frameEngineClock) {
                    window.akari.previewSyncedFrameEngineClock = window.akari.frameEngineClock;
                }
                window.akari.previewPositionReady = true;
            };
            const zoomToSlider = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                return (Math.log2(clamp(value, ZOOM_MIN, ZOOM_MAX)) - logMin) / (logMax - logMin);
            };
            const sliderToZoom = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                const sliderValue = clamp(value, 0, 1);
                if (Math.abs(sliderValue - zoomToSlider(1)) <= SNAP_TOLERANCE) return 1;
                return Math.pow(2, logMin + (logMax - logMin) * sliderValue);
            };
            const computePanLimits = (${computePreviewPanLimits.toString()});
            const computePinchPan = (${pinchPreviewPan.toString()});
            let stageClearance = { barHeight: 0 };
            window.addEventListener('message', event => {
                if (event.data?.type !== 'akari-preview-context-bar-rect') return;
                const rect = event.data.rect;
                const nextHeight = rect && Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0;
                if (nextHeight !== stageClearance.barHeight) {
                    stageClearance = { barHeight: nextHeight };
                    pan = clampPan(pan);
                    renderZoom();
                }
            });
            const panLimits = () => computePanLimits(previewPane.clientWidth, previewPane.clientHeight,
                previewStage.offsetWidth, previewStage.offsetHeight, zoom, stageClearance.barHeight);
            const clampPan = value => {
                const limits = panLimits();
                return {
                    x: clamp(value.x, -limits.x, limits.x),
                    y: clamp(value.y, -limits.y, limits.y)
                };
            };
            const computeMinimapLayout = (${computeZoomMinimapLayout.toString()});
            const renderZoom = () => {
                zoomLayer.style.transform = 'translate(' + pan.x.toFixed(3) + 'px, '
                    + pan.y.toFixed(3) + 'px) scale(' + zoom + ')';
                globalThis.window?.akari?.updateGenerationOverlayLayout?.();
                zoomValue.textContent = Math.round(zoom * 100) + '%';
                zoomSlider.value = String(zoomToSlider(zoom));
                const isZoomed = zoom > 1.05;
                previewPane.classList.toggle('is-draggable', isZoomed);
                if (!isZoomed) previewPane.classList.remove('is-dragging');
                zoomMinimap.hidden = !isZoomed;
                if (!isZoomed) return;
                const stageRect = previewStage.getBoundingClientRect();
                const layout = computeMinimapLayout({
                    paneWidth: previewPane.clientWidth,
                    paneHeight: previewPane.clientHeight,
                    stageWidth: stageRect.width / zoom,
                    stageHeight: stageRect.height / zoom,
                    zoom,
                    pan,
                    outputWidth: stageRect.width,
                    outputHeight: stageRect.height
                });
                zoomMinimap.style.width = layout.box.width + 'px';
                zoomMinimap.style.height = layout.box.height + 'px';
                zoomMinimapViewport.style.left = (layout.viewport.left * 100) + '%';
                zoomMinimapViewport.style.top = (layout.viewport.top * 100) + '%';
                zoomMinimapViewport.style.width = (layout.viewport.width * 100) + '%';
                zoomMinimapViewport.style.height = (layout.viewport.height * 100) + '%';
            };
            const setZoom = value => {
                zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
                pan = clampPan(pan);
                renderZoom();
            };
            new ResizeObserver(() => setZoom(zoom)).observe(previewPane);

            const formatTime = value => {
                const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
                const minutes = Math.floor(seconds / 60);
                return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
            };
            const updateTransport = () => {
                const timelineDuration = window.akari.frameEngineClock?.totalDuration
                    || (segments.length > 0 ? totalTimelineDuration : videoDuration());
                const timelinePosition = segments.length > 0 ? outputTime : (video.currentTime || 0);
                seek.max = String(timelineDuration);
                seek.value = String(clamp(timelinePosition, 0, timelineDuration));
                seek.style.setProperty('--seek-progress', (timelineDuration > 0 ? Number(seek.value) / timelineDuration * 100 : 0) + '%');
                timeLabel.textContent = formatTime(timelinePosition) + ' / ' + formatTime(timelineDuration);
                penToggle.disabled = !reviewRecordingActive || isPlaying;
                if (playToggleRenderedIsPlaying !== isPlaying) {
                    playToggleRenderedIsPlaying = isPlaying;
                    const label = isPlaying ? '一時停止' : '再生';
                    playToggle.innerHTML = isPlaying ? pauseIcon : playIcon;
                    playToggle.setAttribute('aria-label', label);
                    playToggle.title = label;
                }
                syncStrokeLifetime();
            };
            const escapeCaptionHtml = value => String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const captionStyleFitsFrameFn = (${captionStyleFitsFrame.toString()});
            const formatCaptionSeconds = value => String(Math.round(value * 1000) / 1000);
            const groupWordsIntoLines = (words, maximum = 13) => {
                const lines = [];
                let current = [];
                let currentLength = 0;
                for (const word of words) {
                    const wordLength = Array.from(word.text).length;
                    if (current.length > 0 && currentLength + wordLength > maximum) {
                        lines.push(current);
                        current = [];
                        currentLength = 0;
                    }
                    current.push(word);
                    currentLength += wordLength;
                }
                if (current.length > 0) lines.push(current);
                return lines;
            };
            // --- render-cut とのパリティ層（正本: packages/render-cut/src/captions.mjs）---
            // 縦長出力の既定: 行 10 字・文字は出力幅 6%・複数行の無指定字幕は行単位の順送り（reveal）。
            // webview はサンドボックスで import できないため、意図的なコード重複（app.js と同じ判断）。
            const captionOutput = (initial.summary && initial.summary.output) || {};
            const captionPortrait = Number(captionOutput.height) > Number(captionOutput.width);
            const captionLineBudget = captionPortrait ? 10 : 20;
            const captionDefaultFontSize = captionPortrait
                ? Math.round(Number(captionOutput.width) * 0.06) : 38;
            const CAPTION_BOUNDARIES = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
            const findLastSpaceBoundary = (characters, maximum) => {
                for (let index = maximum - 1; index > 0; index -= 1) {
                    if (characters[index] === ' ' || characters[index] === '\u3000') return index + 1;
                }
                return null;
            };
            const findLastPhraseBoundary = (characters, maximum, graphemes = false) => {
                const prefix = characters.slice(0, maximum).join('');
                let best = null;
                for (const boundary of CAPTION_BOUNDARIES) {
                    const index = prefix.lastIndexOf(boundary);
                    if (index >= 0) {
                        const part = prefix.slice(0, index + boundary.length);
                        const candidate = graphemes
                            ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(part)).length
                            : Array.from(part).length;
                        if (candidate > 0 && (best === null || candidate > best)) best = candidate;
                    }
                }
                return best;
            };
            const findLastCommaBoundary = (characters, maximum) => {
                for (let index = maximum - 1; index > 0; index -= 1) {
                    if (characters[index] === '、') return index + 1;
                }
                return null;
            };
            const splitAtNaturalBoundaries = (value, maximum, graphemes = false) => {
                const lines = [];
                let remaining = graphemes
                    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), part => part.segment)
                    : Array.from(value);
                while (remaining.length > maximum) {
                    const commaBoundary = findLastCommaBoundary(remaining, maximum);
                    const spaceBoundary = commaBoundary !== null ? commaBoundary : findLastSpaceBoundary(remaining, maximum);
                    const phraseBoundary = spaceBoundary !== null ? spaceBoundary : findLastPhraseBoundary(remaining, maximum, graphemes);
                    const boundary = phraseBoundary !== null ? phraseBoundary : maximum;
                    lines.push(remaining.slice(0, boundary).join(''));
                    remaining = remaining.slice(boundary);
                }
                if (remaining.length > 0) lines.push(remaining.join(''));
                return lines;
            };
            const splitAfterPunctuation = value => {
                const characters = Array.from(value);
                const segments = [];
                let start = 0;
                for (let index = 0; index < characters.length; index += 1) {
                    if (characters[index] === '。' && index + 1 < characters.length) {
                        segments.push(characters.slice(start, index + 1).join(''));
                        start = index + 1;
                    }
                }
                segments.push(characters.slice(start).join(''));
                return segments;
            };
            const splitCaptionLines = (text, maximum, graphemes = false) => {
                const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 20;
                const lines = [];
                for (const value of String(text).split(/\\r?\\n/u)) {
                    if (value.length === 0) { lines.push(''); continue; }
                    for (const segment of splitAfterPunctuation(value)) {
                        lines.push(...splitAtNaturalBoundaries(segment, limit, graphemes));
                    }
                }
                return lines;
            };
            // splitCaptionLines の分割点を word 境界へスナップして words を行へ配る
            const groupWordsIntoDisplayLines = (words, maximum) => {
                if (words.length === 0) return [];
                const text = words.map(word => word.text).join('');
                const desiredBoundaries = [];
                let desiredOffset = 0;
                for (const line of splitCaptionLines(text, maximum).slice(0, -1)) {
                    desiredOffset += Array.from(line).length;
                    desiredBoundaries.push(desiredOffset);
                }
                const ranges = [];
                let offset = 0;
                for (const word of words) {
                    const start = offset;
                    offset += Array.from(word.text).length;
                    ranges.push({ word, start, end: offset });
                }
                const boundaries = [];
                let previous = 0;
                for (const desired of desiredBoundaries) {
                    const containing = ranges.find(range => range.start < desired && desired < range.end);
                    let snapped = desired;
                    if (containing) {
                        const candidates = [containing.start, containing.end]
                            .filter(candidate => candidate > previous && candidate < offset);
                        const withinTolerance = candidates.filter(candidate => candidate - previous <= maximum + 2);
                        const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
                        if (eligible.length === 0) continue;
                        snapped = eligible.reduce((best, candidate) =>
                            Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
                    }
                    if (snapped > previous && snapped < offset) { boundaries.push(snapped); previous = snapped; }
                }
                const lines = [];
                let start = 0;
                for (const end of [...boundaries, offset]) {
                    const line = ranges.filter(range => range.end > start && range.start < end).map(range => range.word);
                    if (line.length > 0) lines.push(line);
                    start = end;
                }
                return lines;
            };
            const renderRevealGroupsMarkup = (lines, rangeStart, rangeEnd, renderLine) => {
                const groups = [];
                for (const line of lines) {
                    const start = line.length > 0 ? line[0].start : rangeStart;
                    const previous = groups[groups.length - 1];
                    if (previous && previous.start === start) previous.lines.push(line);
                    else groups.push({ start, lines: [line] });
                }
                return groups.map((group, index) => {
                    const nextStart = index + 1 < groups.length ? groups[index + 1].start : rangeEnd;
                    const delay = Math.max(0, group.start - rangeStart);
                    const duration = Math.max(0.01, nextStart - group.start);
                    const lineMarkup = group.lines
                        .map(line => '<p class="akari-caption__line">' + renderLine(line) + '</p>')
                        .join('');
                    return '<div class="akari-caption__reveal-group" style="--akari-reveal-delay: '
                        + formatCaptionSeconds(delay) + 's; --akari-reveal-dur: '
                        + formatCaptionSeconds(duration) + 's">' + lineMarkup + '</div>';
                }).join('');
            };
            const findMatchingEmphasis = word => emphasisWords.find(emphasis =>
                emphasis.t_end > word.start
                && emphasis.t_start < word.end
                && (word.text === emphasis.word || emphasis.word.includes(word.text))
            );
            const resolveEmphasisStyle = emphasis => {
                if (emphasis.style_hint === 'one-char-bang'
                    || emphasis.style_hint === 'size-pulse'
                    || emphasis.style_hint === 'color-accent') return emphasis.style_hint;
                if (emphasis.style_hint !== undefined) return 'color-accent';
                if (emphasis.emotion === 'pain' || emphasis.emotion === 'surprise'
                    || emphasis.emotion === 'anger') return 'one-char-bang';
                if (emphasis.emotion === 'joy' || emphasis.emotion === 'emphasis') return 'size-pulse';
                return 'color-accent';
            };
            const emphasisColorName = emotion =>
                ['joy', 'pain', 'surprise', 'anger', 'sadness', 'emphasis'].includes(emotion)
                    ? emotion : 'emphasis';
            const captionCharRenderer = animators => {
                if (!Array.isArray(animators) || !animators.some(a => a?.basis === 'chars')) return null;
                let index = 0;
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
                return text => Array.from(segmenter.segment(String(text)), part =>
                    '<span class="akari-caption__char" data-akari-char="' + index++ + '">'
                    + escapeCaptionHtml(part.segment).replace(/&#039;/g, '&#39;') + '</span>').join('');
            };
            const renderEmphasisCaptionToken = (word, rangeStart, emphasis, renderChars = null) => {
                const renderText = renderChars || escapeCaptionHtml;
                const style = resolveEmphasisStyle(emphasis);
                const overlapStart = Math.max(word.start, emphasis.t_start);
                const overlapEnd = Math.min(word.end, emphasis.t_end);
                const delay = Math.max(0, overlapStart - rangeStart);
                const duration = Math.max(0.01, overlapEnd - overlapStart);
                const baseClass = 'akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--' + style;
                if (style === 'one-char-bang') {
                    const characters = renderChars
                        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.text), part => part.segment)
                        : Array.from(word.text);
                    const characterDuration = duration / characters.length;
                    const markup = characters.map((character, index) =>
                        '<span class="akari-caption__emphasis-char" style="--akari-emphasis-delay: '
                        + formatCaptionSeconds(delay + characterDuration * index)
                        + 's; --akari-emphasis-dur: '
                        + formatCaptionSeconds(Math.max(0.01, characterDuration)) + 's">'
                        + renderText(character) + '</span>'
                    ).join('');
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id + '">'
                        + markup + '</span>';
                }
                if (style === 'size-pulse') {
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                        + '" style="--akari-emphasis-delay: ' + formatCaptionSeconds(delay)
                        + 's; --akari-emphasis-dur: ' + formatCaptionSeconds(duration) + 's">'
                        + renderText(word.text) + '</span>';
                }
                return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                    + '" style="color: var(--akari-emphasis-' + emphasisColorName(emphasis.emotion) + ')">'
                    + renderText(word.text) + '</span>';
            };
            const renderCaptionToken = (word, rangeStart, style, renderChars = null, karaoke = null, karaokeIndex = 0) => {
                const renderText = renderChars || escapeCaptionHtml;
                if (style === 'reveal-word') {
                    const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                    return '<span class="akari-caption__tok akari-caption__tok--reveal-word"'
                        + ' style="--akari-tok-delay: ' + delay + 's">'
                        + renderText(word.text) + '</span>';
                }
                const emphasis = findMatchingEmphasis(word);
                // 語レベル演出は caption の karaoke/pop より該当 token だけ優先する。
                if (emphasis) return renderEmphasisCaptionToken(word, rangeStart, emphasis, renderChars);
                if (style === 'karaoke' && karaoke && typeof karaoke === 'object') {
                    const chars = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.text)].map(part => part.segment);
                    const before = Math.max(0, Math.min(chars.length, (karaoke.start_index || 0) - karaokeIndex));
                    const done = before ? '<span class="akari-caption__tok akari-caption__tok--karaoke-done">'
                        + renderText(chars.slice(0, before).join('')) + '</span>' : '';
                    const rest = chars.slice(before);
                    if (!rest.length) return done;
                    const delay = Math.max(0, word.start - rangeStart);
                    const duration = Math.max(0.01, word.end - word.start);
                    if (karaoke.fill === 'char') return done + rest.map((char, index) =>
                        '<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay:'
                        + formatCaptionSeconds(delay + duration * (before + index) / chars.length)
                        + 's;--akari-tok-dur:0s">' + renderText(char) + '</span>').join('');
                    if (karaoke.fill === 'word') return done + '<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay:'
                        + formatCaptionSeconds(delay) + 's;--akari-tok-dur:0s">' + renderText(rest.join('')) + '</span>';
                    if (karaoke.fill === 'smooth') {
                        const remaining = rest.join('');
                        return done + '<span class="akari-caption__tok akari-caption__tok--karaoke-smooth" data-karaoke-text="'
                            + escapeCaptionHtml(remaining) + '" style="--akari-tok-delay:'
                            + formatCaptionSeconds(delay + duration * before / chars.length) + 's;--akari-tok-dur:'
                            + formatCaptionSeconds(duration * rest.length / chars.length) + 's">'
                            + renderText(remaining) + '</span>';
                    }
                    if (before) return done + '<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay:'
                        + formatCaptionSeconds(delay) + 's;--akari-tok-dur:' + formatCaptionSeconds(duration)
                        + 's">' + renderText(rest.join('')) + '</span>';
                }
                const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                const className = style === 'karaoke'
                    ? 'akari-caption__tok akari-caption__tok--karaoke'
                    : style === 'pop'
                        ? 'akari-caption__tok akari-caption__tok--pop'
                        : 'akari-caption__tok';
                const vars = style === 'karaoke'
                    ? '--akari-tok-delay: ' + delay + 's; --akari-tok-dur: '
                        + formatCaptionSeconds(Math.max(0.01, word.end - word.start)) + 's'
                    : style === 'pop' ? '--akari-tok-delay: ' + delay + 's' : '';
                return '<span class="' + className + '" style="' + vars + '">'
                    + renderText(word.text) + '</span>';
            };
            // Mirrors render-cut/src/captions.mjs buildCaptionAnimation. The recipe table is
            // injected by the host because the sandboxed webview cannot import render-cut.
            const captionAnimationRecipes = ${JSON.stringify(PREVIEW_CAPTION_ANIMATION_RECIPES)};
            const decorateCaptionTypewriterHtml = ${decorateTypewriterHtml.toString()};
            const isTypewriterOnlyAnimationFn = ${isTypewriterOnlyAnimation.toString()};
            const captionPlaybackStallMsFn = ${captionPlaybackStallMs.toString()};
            const oneShotCaptionLoopIds = new Set(${JSON.stringify(PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS)});
            const buildPreviewCaptionAnimation = (animation, overlayDuration, onWarning) => {
                if (!animation || typeof animation !== 'object') return null;
                if (isTypewriterOnlyAnimationFn(animation)) return { animationCss: 'none', keyframesCss: '', ampCss: '' };
                const parts = [];
                const keyframes = new Map();
                const ampValues = [];
                const resolveSlot = (slot, kind) => {
                    if (!slot) return;
                    if (slot.id === 'typewriter') return; // the grapheme spans carry this motion
                    const recipe = captionAnimationRecipes[slot.id];
                    if (!recipe) {
                        onWarning?.('unknown textanim id "' + slot.id + '" (' + kind + ' slot); slot ignored');
                        return;
                    }
                    keyframes.set(slot.id, recipe);
                    if (slot.amp !== undefined) ampValues.push(slot.amp);
                    if (kind === 'loop') {
                        const period = slot.duration_sec ?? 1.6;
                        parts.push(oneShotCaptionLoopIds.has(slot.id)
                            ? 'akari-anim-' + slot.id + ' ' + formatCaptionSeconds(period)
                                + 's ' + (slot.ease ?? 'ease-out') + ' 0s 1 normal both paused'
                            : 'akari-anim-' + slot.id + ' ' + formatCaptionSeconds(period)
                                + 's linear 0s infinite both paused');
                        return;
                    }
                    const duration = Math.min(slot.duration_sec ?? 0.6, Math.max(0.05, overlayDuration));
                    const ease = slot.ease ?? 'ease-out';
                    if (kind === 'in') {
                        parts.push('akari-anim-' + slot.id + ' ' + formatCaptionSeconds(duration)
                            + 's ' + ease + ' 0s 1 normal both paused');
                    } else {
                        const delay = Math.max(0, overlayDuration - duration);
                        parts.push('akari-anim-' + slot.id + ' ' + formatCaptionSeconds(duration)
                            + 's ' + ease + ' ' + formatCaptionSeconds(delay)
                            + 's 1 reverse forwards paused');
                    }
                };
                resolveSlot(animation.in, 'in');
                resolveSlot(animation.loop, 'loop');
                resolveSlot(animation.out, 'out');
                if (parts.length === 0) return [animation.in, animation.loop, animation.out].some(slot => slot?.id === 'typewriter')
                    ? { animationCss: 'none', keyframesCss: '', ampCss: '' } : null;
                const keyframesCss = [...keyframes.entries()]
                    .map(([id, recipe]) => '    @keyframes akari-anim-' + id + ' { ' + recipe + ' }')
                    .join('\\n');
                return {
                    animationCss: parts.join(', '),
                    keyframesCss,
                    ampCss: ampValues.length > 0 ? '--akari-anim-amp: ' + ampValues[0] + ';' : ''
                };
            };
            const captionTextAnimationPlateAttrs = animation => animation
                ? ' data-akari-textanim style="'
                    + ((animation.ampCss || '') + 'animation:' + animation.animationCss + ';')
                        .replaceAll('&', '&amp;').replaceAll('"', '&quot;')
                        .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
                    + '"'
                : '';
            const captionTextAnimationKeyframesCss = animation => animation
                ? animation.keyframesCss
                : '';
            const captionAligned = caption => ['left', 'center', 'right'].includes(caption?.textStyle?.align);
            const captionAlignMarkup = (caption, markup, blockMode) => !blockMode && captionAligned(caption)
                ? '<div class="akari-caption__alignbox">' + markup + '</div>' : markup;
            const captionContextClasses = caption => {
                const style = caption?.textStyle;
                if (!style) return '';
                return [typeof style.opacity === 'number' && 'akari-caption--opacity',
                    style.vertical && 'akari-caption--vertical',
                    (style.underline || style.strikethrough) && 'akari-caption--decorated',
                    style.list === 'bullet' && 'akari-caption--bullet', captionAligned(caption) && 'akari-caption--aligned']
                    .filter(Boolean).map(name => ' ' + name).join('');
            };
            const captionDecorationMarkup = (markup, caption) => {
                const style = caption?.textStyle;
                if (!style?.underline && !style?.strikethrough) return markup;
                return markup.replace(/<p class="akari-caption__line">([\\s\\S]*?)<\\/p>/g, (_whole, inner) => {
                    const text = inner.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|#039);/g,
                        entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'" })[entity]);
                    return '<p class="akari-caption__line" data-decoration-text="' + escapeCaptionHtml(text) + '">' + inner + '</p>';
                });
            };
            const captionContextCss = (caption, blockMode) => {
                const style = caption?.textStyle;
                if (!style) return '';
                let css = '';
                if (typeof style.opacity === 'number') css += '.akari-caption--opacity{opacity:var(--caption-opacity,1);}';
                if (style.vertical) css += '.akari-caption--vertical{text-orientation:var(--caption-text-orientation,mixed);}.akari-caption--vertical .akari-caption__line{writing-mode:vertical-rl;max-height:var(--caption-vertical-max-height,90vh);box-sizing:border-box;width:auto;max-width:none;height:var(--caption-vertical-wrap-height,max-content);margin:0;white-space:pre-wrap;overflow-wrap:anywhere;}.akari-caption.akari-caption--vertical .akari-caption__plate{left:var(--caption-left,0);right:var(--caption-right,0);width:var(--caption-width,max-content);margin-inline:0;writing-mode:horizontal-tb;align-items:var(--caption-align-items,center);}.akari-caption.akari-caption--vertical .akari-caption__plate{flex-direction:row-reverse;align-items:flex-start;}';
                if (style.underline || style.strikethrough) {
                    css += '.akari-caption--decorated,.akari-caption--decorated .akari-caption__line,.akari-caption--decorated .akari-caption__tok{text-decoration:none!important;}';
                    css += '.akari-caption--decorated .akari-caption__line{position:relative;}';
                    css += '.akari-caption--decorated .akari-caption__line::after{content:attr(data-decoration-text);position:absolute;inset:0;z-index:2;box-sizing:border-box;padding:inherit;pointer-events:none;color:transparent;-webkit-text-stroke:0 transparent!important;text-shadow:none!important;paint-order:normal;font:inherit;letter-spacing:inherit;text-transform:inherit;text-align:inherit;white-space:inherit;text-decoration:var(--caption-text-decoration,none);text-decoration-color:var(--caption-color,#fff);}';
                }
                if (style.list === 'bullet') css += '.akari-caption--bullet .akari-caption__line{display:list-item;list-style-type:disc;list-style-position:inside;}';
                if (captionAligned(caption)) css += blockMode
                    ? '.akari-caption--aligned .akari-caption__block .akari-caption__line{box-sizing:border-box;width:100%;}'
                    : '.akari-caption--aligned .akari-caption__alignbox{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width, 92%);margin:var(--caption-line-margin,0 auto);}.akari-caption--aligned .akari-caption__alignbox .akari-caption__line{box-sizing:border-box;width:100%;max-width:none;margin:0;}';
                return css;
            };
            const captionResolvedOpen = caption => ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_OPEN)}
                .replace('akari-caption--single-line', 'akari-caption--single-line' + captionContextClasses(caption));
            const applyRichCaptionLayers = (host, caption) => {
                const style = caption?.textStyle;
                if (!style || (style.fill === undefined && style.strokes === undefined)) return;
                const root = host.querySelector('.akari-caption');
                if (!root) return;
                root.classList.add('akari-caption--rich');
                root.dataset.richFillType = style.fill?.type || 'solid';
                if (style.fill?.type === 'pattern') {
                    root.dataset.richPatternId = style.fill.pattern.id;
                    if (typeof style.fill.pattern.bg === 'object') root.dataset.richPatternBg = 'gradient';
                    else delete root.dataset.richPatternBg;
                } else {
                    delete root.dataset.richPatternId;
                    delete root.dataset.richPatternBg;
                }
                const css = document.createElement('style');
                css.textContent = ${JSON.stringify(CAPTION_RICH_LAYER_CSS)};
                root.appendChild(css);
                const font = Number(style.size_px) || 38;
                const strokes = Array.isArray(style.strokes) ? style.strokes
                    : style.stroke ? [{ color: style.stroke.color || '#000000', width_px: style.stroke.width_px ?? 1.5 }] : [];
                const em = number => String(Number(number.toFixed(6))) + 'em';
                for (const line of root.querySelectorAll('.akari-caption__line')) {
                    if (!line.querySelector('.akari-caption__tok')) {
                        if ([...line.childNodes].every(node => node.nodeType === Node.TEXT_NODE)) {
                            const source = line.textContent || '';
                            line.textContent = '';
                            for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source)) {
                                const token = document.createElement('span');
                                token.className = 'akari-caption__tok';
                                token.textContent = part.segment;
                                line.appendChild(token);
                            }
                        } else {
                            const token = document.createElement('span');
                            token.className = 'akari-caption__tok';
                            while (line.firstChild) token.appendChild(line.firstChild);
                            line.appendChild(token);
                        }
                    }
                    for (const token of line.querySelectorAll('.akari-caption__tok')) {
                        const walker = document.createTreeWalker(token, NodeFilter.SHOW_TEXT);
                        const nodes = [];
                        while (walker.nextNode()) nodes.push(walker.currentNode);
                        for (const node of nodes) {
                            const value = node.textContent || '';
                            if (!value) continue;
                            const segment = document.createElement('span');
                            segment.className = 'akari-caption__rich-segment';
                            node.parentNode.insertBefore(segment, node);
                            const layer = (name, hidden = true) => {
                                const span = document.createElement('span');
                                span.className = 'akari-caption__rich-' + name;
                                if (hidden) span.setAttribute('aria-hidden', 'true');
                                span.textContent = value;
                                segment.appendChild(span);
                                return span;
                            };
                            layer('shadow');
                            for (const stroke of strokes) {
                                const span = layer('stroke');
                                span.style.setProperty('--caption-rich-stroke-color', stroke.color);
                                span.style.setProperty('--caption-rich-stroke-width', em(2 * stroke.width_px / font));
                                span.style.setProperty('--caption-rich-stroke-offset-x', em((stroke.offset_x || 0) / font));
                                span.style.setProperty('--caption-rich-stroke-offset-y', em((stroke.offset_y || 0) / font));
                            }
                            layer('fill', false).dataset.karaokeText = value;
                            node.remove();
                        }
                    }
                }
                const align = ${alignCaptionRichFillPhase.toString()};
                align(root);
                document.fonts.ready.then(() => align(root));
            };
            const richPreviewWords = (line, renderText) => Array.from(
                new Intl.Segmenter(undefined, { granularity: 'word' }).segment(line), part => part.segment
            ).map(word => '<span class="akari-caption__tok">' + renderText(word) + '</span>').join('');
            const captionHasScaledRun = caption => Boolean(caption?.runs?.some(run =>
                Number.isFinite(run?.style?.scale) && run.style.scale !== 1));
            const captionSizedRunPlateCss = caption => captionHasScaledRun(caption)
                ? '.akari-caption__plate{width:var(--caption-width,max-content);margin-inline:var(--caption-plate-margin,auto);}'
                    + '.akari-caption__line,.akari-caption__block{max-width:none;}'
                : '';
            const renderStyledCaptionFragment = (caption, captionAnimation = null) => {
                const renderChars = captionCharRenderer(caption.animator);
                const style = caption.style;
                const textStyleActive = Boolean(caption.textStyle
                    && Object.keys(caption.textStyle).length > 0);
                const hasEmphasis = caption.words.some(word => findMatchingEmphasis(word));
                // reveal（行単位の順送り）: 明示指定に加え、縦長では複数行に折り返す無指定字幕を
                // 自動昇格させる（render-cut generateCaptionOverlays と同じ既定）。
                const reveal = style === 'reveal'
                    || (!style && !caption.textStyle?.vertical && captionPortrait
                        && splitCaptionLines(caption.text || '', captionLineBudget).length > 1);
                const rootStyle = reveal ? 'reveal' : (style || (hasEmphasis ? 'emphasis' : 'karaoke'));
                let karaokeIndex = 0;
                let karaokeCursor = 0;
                const karaokeDisplay = caption.text || caption.words.map(word => word.text).join('');
                const renderLine = line => line.map(word => {
                    const match = karaokeDisplay.indexOf(word.text, karaokeCursor);
                    const index = match >= 0
                        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(karaokeDisplay.slice(0, match))].length
                        : karaokeIndex;
                    if (match >= 0) karaokeCursor = match + word.text.length;
                    karaokeIndex = index + [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.text)].length;
                    return renderCaptionToken(word, caption.start, reveal ? null : style, renderChars,
                        caption.textStyle?.karaoke, index);
                }).join('');
                const markup = reveal
                    ? renderRevealGroupsMarkup(
                        groupWordsIntoDisplayLines(caption.words, caption.textStyle?.vertical ? Number.MAX_SAFE_INTEGER : captionLineBudget),
                        caption.start, caption.end, renderLine)
                    : groupWordsIntoLines(caption.words, caption.textStyle?.vertical ? Number.MAX_SAFE_INTEGER : captionLineBudget).map(line =>
                        '<p class="akari-caption__line">' + renderLine(line) + '</p>'
                    ).join('');
                const revealCss = reveal
                    ? '.akari-caption--reveal .akari-caption__plate{display:grid;}'
                        + '.akari-caption__reveal-group{grid-area:1 / 1;display:flex;flex-direction:column;gap:var(--plate-gap,4px);opacity:0;animation:akari-caption-reveal var(--akari-reveal-dur,0.2s) var(--akari-reveal-delay,0s) linear both paused;}'
                        + '@keyframes akari-caption-reveal{0%{opacity:0;transform:translateY(0.18em);}12%{opacity:1;transform:translateY(0);}99.99%{opacity:1;transform:translateY(0);}100%{opacity:0;transform:translateY(0);}}'
                    : '';
                const revealWordCss = style === 'reveal-word'
                    ? '@keyframes akari-caption-reveal-word{0%{opacity:0;}100%{opacity:1;}}'
                        + '.akari-caption__tok--reveal-word{animation:akari-caption-reveal-word 0.01s var(--akari-tok-delay,0s) linear both paused;}'
                    : '';
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : captionAlignMarkup(caption, markup, false);
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                const frameFitCss = captionStyleFitsFrameFn(caption.textStyle, caption.textStyleVars)
                    ? '.akari-caption__plate{left:4%;right:4%;width:auto;}'
                        + '.akari-caption__line{box-sizing:border-box;width:100%;max-width:none;margin:0;}'
                        + '.akari-caption__line::before{left:0;right:0;}'
                        + '.akari-caption__block{box-sizing:border-box;width:100%;max-width:none;margin:0;}'
                    : '';
                const emphasisCss = hasEmphasis
                    ? '.akari-caption{--akari-emphasis-joy:var(--vscode-akariTheme-accentLighter,#fdba74);--akari-emphasis-pain:var(--vscode-errorForeground,#ff798c);--akari-emphasis-surprise:var(--vscode-akariTheme-accentLight,#fb923c);--akari-emphasis-anger:var(--vscode-errorForeground,#ff798c);--akari-emphasis-sadness:var(--vscode-descriptionForeground,#a3a3a3);--akari-emphasis-emphasis:var(--vscode-akariTheme-accent,#f97316);}'
                        + '@keyframes akari-emphasis-one-char-bang{from{opacity:0;transform:scale(1.6);}to{opacity:1;transform:scale(1);}}'
                        + '@keyframes akari-emphasis-size-pulse{0%{transform:scale(1);}50%{transform:scale(1.25);}100%{transform:scale(1);}}'
                        + '.akari-caption__emphasis-char{display:inline-block;opacity:0;animation:akari-emphasis-one-char-bang var(--akari-emphasis-dur,0.1s) var(--akari-emphasis-delay,0s) ease-out both paused;}'
                        + '.akari-caption__tok--size-pulse{animation:akari-emphasis-size-pulse var(--akari-emphasis-dur,0.2s) var(--akari-emphasis-delay,0s) ease-in-out both paused;}'
                    : '';
                return '<div class="akari-caption akari-caption--' + rootStyle + captionContextClasses(caption) + '">'
                    + '<style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);'
                    + '-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));'
                    + 'paint-order:var(--caption-paint-order,stroke fill);'
                    + 'text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));'
                    + 'font-family:var(--caption-font-family,"AKARI Noto Sans JP","Noto Sans JP",sans-serif);font-size:var(--caption-font-size,38px);font-weight:var(--caption-font-weight,700);font-style:var(--caption-font-style,normal);text-decoration:var(--caption-text-decoration,none);letter-spacing:var(--caption-letter-spacing,normal);text-transform:var(--caption-text-transform,none);line-height:var(--caption-word-line-height,var(--caption-line-height,1.42));writing-mode:var(--caption-writing-mode,horizontal-tb);text-align:center;}'
                    + (caption.timeDomain === 'output' && caption.textStyleVars?.['--caption-stroke']
                        ? '.akari-caption__line,.akari-caption__block{-webkit-text-stroke:0 transparent;text-shadow:var(--caption-rounded-stroke);}' : '')
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);translate:var(--caption-translate,none);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);width:var(--caption-width,auto);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);rotate:var(--caption-rotate,0deg);scale:var(--caption-scale,1);transform-origin:center;}'
                    + '.akari-caption__line{position:relative;isolation:isolate;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption__line{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:var(--caption-fill-clip,border-box);-webkit-text-fill-color:var(--caption-fill-color,currentColor);-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                    + '.akari-caption__line::before{content:"";position:absolute;inset:calc(0px - var(--plate-ext-height,0px)) calc(0px - var(--plate-ext-width,0px));z-index:-1;border-radius:var(--plate-ext-radius,10px);background:var(--plate-ext-bg,transparent);transform:translate(var(--plate-offset-x,0px),var(--plate-offset-y,0px));}'
                    + blockCss
                    + captionSizedRunPlateCss(caption)
                    + frameFitCss
                    + '.akari-caption__tok{display:inline-block;vertical-align:baseline;line-height:1;paint-order:stroke fill;will-change:transform,color;}'
                    + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption__line{background-image:none;-webkit-text-fill-color:currentColor;filter:none;}.akari-caption__tok{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:text;-webkit-text-fill-color:transparent;-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                    + '@keyframes akari-caption-karaoke-lit{from{color:var(--caption-color,#fff);}to{color:var(--caption-highlight-color,#ffd94a);}}'
                    + (caption.textStyle?.karaoke
                        ? '@keyframes akari-caption-karaoke-wipe{from{clip-path:inset(0 100% 0 0);}to{clip-path:inset(0 0 0 0);}}'
                        : '')
                    + '@keyframes akari-caption-pop{0%{transform:translateY(0) scale(1);}50%{transform:translateY(-0.08em) scale(1.12);}100%{transform:translateY(0) scale(1);}}'
                    + '.akari-caption__tok--karaoke{animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}'
                    + (caption.textStyle?.karaoke
                        ? '.akari-caption__tok--karaoke-done{color:var(--caption-highlight-color,#ffd94a);}'
                            + '.akari-caption__tok--karaoke-smooth{position:relative;animation:none;}'
                            + '.akari-caption__tok--karaoke-smooth::after{content:attr(data-karaoke-text);position:absolute;inset:0;white-space:pre;color:var(--caption-highlight-color,#ffd94a);animation:akari-caption-karaoke-wipe var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}'
                        : '')
                    + '.akari-caption__tok--pop{animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused;}'
                    + revealWordCss
                    + revealCss
                    + emphasisCss
                    + captionTextAnimationKeyframesCss(captionAnimation)
                    + captionContextCss(caption, blockMode)
                    + '</style><div class="akari-caption__plate"'
                    + captionTextAnimationPlateAttrs(captionAnimation) + '>' + captionDecorationMarkup(plateMarkup, caption) + '</div></div>';
            };
            const renderPlainCaptionFragment = (caption, captionAnimation = null) => {
                const renderChars = captionCharRenderer(caption.animator);
                const renderText = renderChars || escapeCaptionHtml;
                if (caption.resolvedTimeline) {
                    const resolvedRunPlateCss = captionHasScaledRun(caption)
                        ? '.akari-caption--single-line .akari-caption__plate{width:var(--caption-width,max-content);margin-inline:var(--caption-plate-margin,auto);max-width:none;}'
                        : '';
                    const resolvedFrameCss = captionStyleFitsFrameFn(caption.textStyle, caption.textStyleVars)
                        ? '.akari-caption--single-line .akari-caption__plate{left:4%;right:4%;width:auto;box-sizing:border-box;}'
                            + '.akari-caption--single-line .akari-caption__line{box-sizing:border-box;width:100%;max-width:none;margin:0;background:var(--plate-bg,var(--plate-ext-bg,transparent));border-radius:var(--plate-radius,var(--plate-ext-radius,0));}'
                        : '';
                    if ((caption.wordStyles || caption.textStyle?.fill !== undefined
                        || caption.textStyle?.strokes !== undefined) && caption.resolvedWords) {
                        let currentLine = caption.resolvedWords.length ? caption.resolvedWords[0].line : 0;
                        const markup = caption.resolvedWords.map((word, index) => {
                            const lineBreak = !caption.textStyle?.vertical && word.line !== currentLine
                                ? '</p><p class="akari-caption__line">' : '';
                            currentLine = word.line;
                            const style = caption.wordStyles?.find(entry => entry.from <= index && index < entry.to);
                            if (!style) return lineBreak + '<span class="akari-caption__tok">'
                                + renderText(word.text) + '</span>';
                            const vars = Object.entries(style.style_vars || {})
                                .filter(([name, value]) => name.startsWith('--') && typeof value === 'string')
                                .map(([name, value]) => name + ':' + value + ';').join('');
                            return lineBreak + '<span class="akari-caption__tok akari-caption__tok--preset" data-emphasis-preset="'
                                + escapeCaptionHtml(style.preset_id) + '" style="' + escapeCaptionHtml(vars) + '">'
                                + renderText(word.text) + '</span>';
                        }).join('');
                        return captionDecorationMarkup(captionResolvedOpen(caption)
                            + ${JSON.stringify(RESOLVED_SINGLE_LINE_CAPTION_CSS)}
                        + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption--single-line .akari-caption__line{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:var(--caption-fill-clip,border-box);-webkit-text-fill-color:var(--caption-fill-color,currentColor);-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                            + resolvedRunPlateCss
                            + resolvedFrameCss
                            + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption--single-line .akari-caption__line{background-image:none;-webkit-text-fill-color:currentColor;filter:none;}.akari-caption__tok{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:text;-webkit-text-fill-color:transparent;-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                            + '.akari-caption__tok{display:inline-block;vertical-align:baseline;line-height:1;paint-order:stroke fill;white-space:pre;--caption-tok-color:initial;--caption-tok-font-size:initial;--caption-tok-font-family:initial;--caption-tok-font-weight:initial;--caption-tok-font-style:initial;--caption-tok-text-decoration:initial;--caption-tok-letter-spacing:initial;--caption-tok-line-height:initial;--caption-tok-text-transform:initial;--caption-tok-webkit-text-stroke:initial;--caption-tok-paint-order:initial;--caption-tok-text-shadow:initial;}.akari-caption__tok--preset{color:var(--caption-tok-color,inherit);font-size:var(--caption-tok-font-size,inherit);font-family:var(--caption-tok-font-family,inherit);font-weight:var(--caption-tok-font-weight,inherit);font-style:var(--caption-tok-font-style,inherit);text-decoration:var(--caption-tok-text-decoration,inherit);letter-spacing:var(--caption-tok-letter-spacing,inherit);line-height:var(--caption-tok-line-height,1);text-transform:var(--caption-tok-text-transform,inherit);-webkit-text-stroke:var(--caption-tok-webkit-text-stroke,inherit);paint-order:var(--caption-tok-paint-order,stroke fill);text-shadow:var(--caption-tok-text-shadow,inherit);}'
                            + captionContextCss(caption, false, true)
                            + (captionAligned(caption) ? '</style><div class="akari-caption__plate"><div class="akari-caption__alignbox"><p class="akari-caption__line">' : ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE)})
                            + markup
                            + (captionAligned(caption) ? '</p></div></div></div>' : ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE)}), caption);
                    }
                    const resolvedMarkup = !caption.textStyle?.vertical && Array.isArray(caption.displayLines)
                        && caption.displayLines.length >= 2
                        ? caption.displayLines.map(line => caption.textStyle?.fill !== undefined
                            || caption.textStyle?.strokes !== undefined
                            ? richPreviewWords(line, renderText) : renderText(line)).join(
                            '</p><p class="akari-caption__line">'
                        )
                        : caption.textStyle?.fill !== undefined || caption.textStyle?.strokes !== undefined
                            ? richPreviewWords(caption.text, renderText) : renderText(caption.text);
                    return captionDecorationMarkup(captionResolvedOpen(caption)
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_CAPTION_CSS)}
                        + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption--single-line .akari-caption__line{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:var(--caption-fill-clip,border-box);-webkit-text-fill-color:var(--caption-fill-color,currentColor);-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                        + resolvedRunPlateCss
                        + resolvedFrameCss
                        + captionContextCss(caption, false)
                        + (captionAligned(caption) ? '</style><div class="akari-caption__plate"><div class="akari-caption__alignbox"><p class="akari-caption__line">' : ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE)})
                        + resolvedMarkup
                        + (captionAligned(caption) ? '</p></div></div></div>' : ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE)}), caption);
                }
                // 焼き込みと同じ自然な区切り（句読点 → 空白 → 文節境界 → 文字上限）で折り返す
                const lines = caption.textStyle?.vertical
                    ? String(caption.text || '').split(/\\r?\\n/)
                    : splitCaptionLines(caption.text || '', captionLineBudget, Boolean(renderChars));
                const markup = lines.map(line => '<p class="akari-caption__line">'
                    + (caption.textStyle?.fill !== undefined || caption.textStyle?.strokes !== undefined
                        ? richPreviewWords(line, renderText) : renderText(line)) + '</p>').join('');
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : captionAlignMarkup(caption, markup, false);
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                const frameFitCss = captionStyleFitsFrameFn(caption.textStyle, caption.textStyleVars)
                    ? '.akari-caption__plate{left:4%;right:4%;width:auto;}'
                        + '.akari-caption__line{box-sizing:border-box;width:100%;max-width:none;margin:0;}'
                        + '.akari-caption__line::before{left:0;right:0;}'
                        + '.akari-caption__block{box-sizing:border-box;width:100%;max-width:none;margin:0;}'
                    : '';
                return '<div class="akari-caption' + captionContextClasses(caption) + '"><style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));paint-order:var(--caption-paint-order,stroke fill);text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));font-family:var(--caption-font-family,"AKARI Noto Sans JP","Noto Sans JP",sans-serif);font-size:var(--caption-font-size,38px);font-weight:var(--caption-font-weight,700);font-style:var(--caption-font-style,normal);text-decoration:var(--caption-text-decoration,none);letter-spacing:var(--caption-letter-spacing,normal);text-transform:var(--caption-text-transform,none);line-height:var(--caption-word-line-height,var(--caption-line-height,1.42));writing-mode:var(--caption-writing-mode,horizontal-tb);text-align:center;}'
                    + (caption.timeDomain === 'output' && caption.textStyleVars?.['--caption-stroke']
                        ? '.akari-caption__line,.akari-caption__block{-webkit-text-stroke:0 transparent;text-shadow:var(--caption-rounded-stroke);}' : '')
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);translate:var(--caption-translate,none);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);width:var(--caption-width,auto);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);rotate:var(--caption-rotate,0deg);scale:var(--caption-scale,1);transform-origin:center;}'
                    + '.akari-caption__line{position:relative;isolation:isolate;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + (caption.textStyle?.fill_gradient && !caption.textStyle?.fill ? '.akari-caption__line{background-image:var(--caption-fill-gradient,none);-webkit-background-clip:var(--caption-fill-clip,border-box);-webkit-text-fill-color:var(--caption-fill-color,currentColor);-webkit-text-stroke:0 transparent;text-shadow:none;filter:var(--caption-fill-filter,none);}' : '')
                    + '.akari-caption__line::before{content:"";position:absolute;inset:calc(0px - var(--plate-ext-height,0px)) calc(0px - var(--plate-ext-width,0px));z-index:-1;border-radius:var(--plate-ext-radius,10px);background:var(--plate-ext-bg,transparent);transform:translate(var(--plate-offset-x,0px),var(--plate-offset-y,0px));}'
                    + blockCss
                    + captionSizedRunPlateCss(caption)
                    + frameFitCss
                    + captionTextAnimationKeyframesCss(captionAnimation)
                    + captionContextCss(caption, blockMode)
                    + '</style><div class="akari-caption__plate"'
                    + captionTextAnimationPlateAttrs(captionAnimation) + '>' + captionDecorationMarkup(plateMarkup, caption) + '</div></div>';
            };
            const captionStyleVariableNames = ${JSON.stringify(RESOLVED_CAPTION_STYLE_VARIABLE_NAMES)};
            const applyCaptionStyleVars = (caption, captionPlate) => {
                captionPlate.style.removeProperty('--caption-plate-fit');
                captionPlate.style.removeProperty('--caption-wrap-width');
                captionPlate.style.removeProperty('--caption-vertical-wrap-height');
                captionPlate.style.removeProperty('--caption-vertical-max-height');
                for (const name of captionStyleVariableNames) {
                    captionPlate.style.removeProperty(name);
                }
                const textStyleActive = Boolean(caption && ((caption.textStyle
                    && Object.keys(caption.textStyle).length > 0) || caption.resolvedTimeline));
                if (!textStyleActive) return;
                const vars = caption.textStyleVars || {};
                for (const [name, value] of Object.entries(vars)) {
                    captionPlate.style.setProperty(name, String(value));
                }
                captionPlate.style.removeProperty('--caption-rounded-stroke');
                if (caption.timeDomain === 'output') {
                    const shadows = roundedCaptionStrokeShadowsFn(String(vars['--caption-stroke'] || ''),
                        String(vars['--caption-text-shadow'] || 'none'));
                    if (shadows) captionPlate.style.setProperty('--caption-rounded-stroke', shadows);
                }
                if (!Object.prototype.hasOwnProperty.call(vars, '--caption-font-size')) {
                    // 明示 size_px が無いときの既定は render-cut と同じ（縦長 = 幅 6% / 横長 = 38px）
                    captionPlate.style.setProperty('--caption-font-size', captionDefaultFontSize + 'px');
                }
            };
            let captionAnimatorUnavailableWarned = false;
            const applyCaptionRowSelectionAttrs = (captionPlate, caption) => {
                const id = caption && (caption.sourceCueId || caption.id);
                if (id && selectedCaptionIds.has(id)) captionPlate.setAttribute('data-selected', '');
                else captionPlate.removeAttribute('data-selected');
                if (captionAltAll) captionPlate.setAttribute('data-alt-all', '');
                else captionPlate.removeAttribute('data-alt-all');
                captionPlate.querySelectorAll('.akari-caption-handle-box, .akari-caption-handle')
                    .forEach(handle => handle.remove());
            };
            const applyCaptionSelectionAttrs = () => {
                for (const row of captionRows.values()) {
                    const wasSelected = row.plate.hasAttribute('data-selected');
                    applyCaptionRowSelectionAttrs(row.plate, row.caption);
                    if (row.captionTextAnimation && wasSelected !== row.plate.hasAttribute('data-selected')) {
                        // Re-seek the newly enabled animation before measuring its actual ink box.
                        row.captionHitRegionPending = true;
                        renderCaptionRow(row.caption, row);
                        if (row.plate.hasAttribute('data-selected')) row.captionHitRegionPending = false;
                    }
                }
                captionSelectBox.querySelector('.akari-caption-handle-box')?.remove();
                const caption = captions.find(candidate => selectedCaptionIds.has(candidate.sourceCueId || candidate.id)
                    && (candidate.sourceCueId || candidate.id) === selectedCaptionId)
                    || captions.find(candidate => selectedCaptionIds.has(candidate.sourceCueId || candidate.id));
                if (!caption) return;
                const handleBox = document.createElement('div');
                handleBox.className = 'akari-caption-handle-box';
                const handleKinds = ['nw', 'ne', 'sw', 'se', 'e', 'w', 'rot', 'move'];
                for (const kind of caption.textStyle?.vertical
                    ? [...handleKinds.filter(kind => kind !== 'e' && kind !== 'w'), 'n', 's']
                    : handleKinds) {
                    const handle = document.createElement('i');
                    handle.className = 'akari-caption-handle';
                    handle.setAttribute('data-h', kind);
                    if (kind === 'n' || kind === 's') {
                        // The shared handle stylesheet is outside this lane; keep the vertical control local.
                        handle.style.left = '50%';
                        handle.style[kind === 'n' ? 'top' : 'bottom'] =
                            'calc(0px - var(--akari-caption-vertical-edge-outset,0px))';
                        handle.style.width = '20px';
                        handle.style.height = '11px';
                        handle.style.border = '0';
                        handle.style.borderRadius = '0';
                        handle.style.background = 'transparent';
                        handle.style.boxShadow = 'none';
                        handle.style.transform = (kind === 'n' ? 'translate(-50%,-50%)' : 'translate(-50%,50%)')
                            + ' scale(var(--akari-caption-control-inverse-x,1),var(--akari-caption-control-inverse-y,1))';
                        handle.style.cursor = 'ns-resize';
                        const grip = document.createElement('span');
                        grip.style.position = 'absolute';
                        grip.style.left = '3px';
                        grip.style.top = '3px';
                        grip.style.width = '14px';
                        grip.style.height = '5px';
                        grip.style.borderRadius = '3px';
                        grip.style.background = '#fff';
                        grip.style.boxShadow = '0 1px 4px rgba(0,0,0,.35)';
                        grip.style.pointerEvents = 'none';
                        handle.appendChild(grip);
                    }
                    handleBox.appendChild(handle);
                }
                captionSelectBox.appendChild(handleBox);
                syncCaptionHandleBox();
            };
            const setCaptionAltAll = on => {
                if (captionAltAll === on) return;
                captionAltAll = on;
                applyCaptionSelectionAttrs();
                window.akari.reportAltAll?.(on);
            };
            window.addEventListener('keydown', event => {
                if (event.key === 'Alt' || event.altKey) setCaptionAltAll(true);
            });
            window.addEventListener('keyup', event => {
                if (event.key === 'Alt' || !event.altKey) setCaptionAltAll(false);
            });
            window.addEventListener('blur', () => setCaptionAltAll(false));
            // Keep these DOM-free rules aligned with captionMotionTextTargets / shouldResumeCaptionMotion.
            // This script is also evaluated from source by the preview webview tests.
            const motionTextTargets = host => [...host.querySelectorAll('.akari-caption__line')]
                .filter(line => Boolean(line.textContent?.trim()));
            const canResumeMotion = (request, ids, now) => !!request
                && now < request.expiresAt && ids.includes(request.captionId);
            let captionMotionReplay = null;
            const renderCaptionRow = (caption, row) => {
                caption = captionStylePreview.resolve(caption, selectedCaptionIds);
                const captionPlate = row.plate;
                if (activeCaptionEdit?.element.closest('.caption-row-plate') === captionPlate) return;
                if (caption !== row.renderedCaption) {
                    row.renderedCaption = caption;
                    applyCaptionStyleVars(caption, captionPlate);
                    const wrapWidthActive = Boolean(caption?.textStyleVars?.['--caption-wrap-width']);
                    if (wrapWidthActive
                        || caption?.runs?.some(run => Number.isFinite(run?.style?.scale) && run.style.scale !== 1)) {
                        captionPlate.dataset.captionSizedRun = '';
                        const captionPositionX = caption?.textStyle?.position?.x;
                        const captionAnchor = caption?.textStyle?.text_anchor;
                        const captionHorizontal = captionAnchor?.[1]
                            || (wrapWidthActive ? caption?.textStyle?.zone?.split('-').at(-1) : null);
                        captionPlate.style?.setProperty?.('--caption-plate-margin',
                            Number.isFinite(captionPositionX) ? '0'
                                : captionHorizontal === 'l' || captionHorizontal === 'left' ? '0 auto'
                                    : captionHorizontal === 'r' || captionHorizontal === 'right' ? 'auto 0' : 'auto');
                    } else {
                        delete captionPlate.dataset.captionSizedRun;
                        captionPlate.style?.removeProperty?.('--caption-plate-margin');
                    }
                    const groupTransform = caption?.groupTransform;
                    if (captionPlate.style) {
                        captionPlate.style.transform = groupTransform
                            ? 'translate(' + (groupTransform.x || 0) + 'px,' + (groupTransform.y || 0)
                                + 'px) rotate(' + (groupTransform.rotate || 0) + 'deg) scale(' + (groupTransform.scale || 1) + ')'
                            : '';
                        captionPlate.style.opacity = caption?.groupOpacity === undefined
                            ? '' : String(caption.groupOpacity);
                    }
                    const captionAnimation = caption && caption.textStyle?.animation
                        ? buildPreviewCaptionAnimation(caption.textStyle.animation, caption.end - caption.start,
                            message => console.warn('[akari-preview] captions.json item '
                                + (caption.sourceCueId || caption.id || '(unknown)') + ' ' + message))
                        : null;
                    row.captionTextAnimation = Boolean(captionAnimation);
                    const hasEmphasis = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.some(word => findMatchingEmphasis(word)));
                    const hasCaptionWords = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.length > 0);
                    // reveal（明示 + 縦長の複数行自動昇格）も word ベースの styled 経路で描く
                    const wantsCaptionReveal = hasCaptionWords
                        && (caption.style === 'reveal'
                            || (!caption.style && !caption.textStyle?.vertical && captionPortrait
                                && splitCaptionLines(caption.text || '', captionLineBudget).length > 1));
                    row.styledCaptionActive = Boolean(caption);
                    captionPlate.classList.toggle('akari-caption-host--styled', row.styledCaptionActive);
                    // caption item は書き出しと同じ全幅プレートを使う。通常の出力字幕だけ
                    // 既存の 92% 幅・右端 auto の配置規則を適用する。
                    if (caption?.timeDomain === 'output' && !caption.captionItemProjection) {
                        captionPlate.dataset.outputCaption = '';
                    }
                    else delete captionPlate.dataset.outputCaption;
                    if (caption) {
                        const usesWords = hasCaptionWords
                            && ((caption.style === 'karaoke' || caption.style === 'pop')
                                || caption.style === 'reveal-word'
                                || hasEmphasis || wantsCaptionReveal);
                        let captionHtml = usesWords
                            ? renderStyledCaptionFragment(caption, captionAnimation)
                            : renderPlainCaptionFragment(caption, captionAnimation);
                        if (caption.resolvedTimeline && captionAnimation) {
                            captionHtml = captionHtml.replace('</style>', captionTextAnimationKeyframesCss(captionAnimation) + '</style>')
                                .replace('<div class="akari-caption__plate">', '<div class="akari-caption__plate"'
                                    + captionTextAnimationPlateAttrs(captionAnimation) + '>');
                        }
                        captionHtml = caption.runs?.length
                            ? renderCaptionRuns(captionHtml, caption.text, caption.runs) : captionHtml;
                        if (caption.textStyle?.animation?.in?.id === 'typewriter'
                            || caption.textStyle?.animation?.out?.id === 'typewriter') {
                            captionHtml = decorateCaptionTypewriterHtml(captionHtml,
                                caption.textStyle.animation, caption.end - caption.start);
                        }
                        captionPlate.innerHTML = captionHtml;
                        applyRichCaptionLayers(captionPlate, caption);
                    } else {
                        captionPlate.innerHTML = '';
                    }
                    // renderCaption は innerHTML/textContent を置き換えるため、選択ハンドルは描画後に付け直す。
                    applyCaptionRowSelectionAttrs(captionPlate, caption);
                    row.captionHitRegionPending = true;
                }
                let captionAnimations = [];
                if (caption && row.styledCaptionActive) {
                    const localMs = (clamp(outputTime, caption.start, caption.end) - caption.start) * 1000;
                    captionAnimations = captionPlate.getAnimations({ subtree: true });
                    for (const animation of captionAnimations) {
                        animation.pause();
                        animation.currentTime = localMs;
                    }
                }
                if (caption && Array.isArray(caption.animator) && caption.animator.length > 0) {
                    const applyAnimator = window.AkariFrameEngine?.applyCaptionAnimatorDom;
                    if (typeof applyAnimator === 'function') {
                        applyAnimator(captionPlate, {
                            animators: caption.animator,
                            keyframes: caption.animatorKeyframes,
                            cueLocalSeconds: outputTime - caption.start,
                            cueDurationSec: caption.end - caption.start,
                            keyframeOffsetSeconds: caption.start - (caption.animatorStart ?? caption.start),
                            fps: summary.output.fps,
                            outputWidth: summary.output.width,
                            warn: (code, message) => console.warn('[akari-preview] ' + code + ': ' + message)
                        });
                    } else if (!captionAnimatorUnavailableWarned) {
                        captionAnimatorUnavailableWarned = true;
                        console.warn('[akari-preview] caption animator unavailable: frame-engine bundle is not loaded');
                    }
                }
                // ㉓ styled 字幕は「inset:0 全画面ラッパー + 内側配置」を取り得るため、
                // WAAPI を現在時刻へシークした後の実寸で clip-path を測る。可視化した最初の
                // 1 tick だけで確定すると、通常再生では 0% の画面外姿勢が焼き付くため、有限な
                // 入場アニメが終わるまでは毎 tick 測り直す。終端の無い装飾アニメは無視し、
                // 完了後は pending を落として追加の bbox 測定を止める。
                if (row.captionHitRegionPending) {
                    window.akari.interaction?.syncOverlayHitRegion?.(captionPlate);
                    if (captionEntryAnimationsSettledFn(captionAnimations)) {
                        row.captionHitRegionPending = false;
                    }
                }
            };
            const previewSelectionLeavesRangeFn = (previousTime, time, start, end, hidden = false) =>
                Number.isFinite(start) && Number.isFinite(end)
                && previousTime >= start && previousTime < end
                && (time < start || time >= end || hidden);
            let previousPreviewSelectionTime = typeof outputTime !== 'undefined' ? outputTime : 0;
            const overlaySelectionInRange = (id, time) => {
                const item = typeof summary !== 'undefined'
                    ? summary.overlays?.find(candidate => candidate.id === id) : undefined;
                return !!item && time >= item.start && time < item.start + item.duration;
            };
            window.akari.expirePreviewSelections = time => {
                const previousTime = previousPreviewSelectionTime;
                previousPreviewSelectionTime = time;
                const currentCaptionId = typeof selectedCaptionId !== 'undefined' ? selectedCaptionId : null;
                const currentLayerId = typeof selectedLayerId !== 'undefined' ? selectedLayerId : null;
                const currentCutId = typeof requestedCutId !== 'undefined' ? requestedCutId : undefined;
                const selectedLayerEntry = currentLayerId && findLayerEntry(currentLayerId);
                const selectedLayer = selectedLayerEntry?.spec
                    || (typeof summary !== 'undefined'
                        ? summary.layers?.find(item => String(item.id) === String(currentLayerId)) : undefined);
                const selectedOverlayId = (typeof requestedOverlayId !== 'undefined' && requestedOverlayId)
                    || window.akari.interaction?.selectedId;
                const selectedOverlay = selectedOverlayId && typeof summary !== 'undefined'
                    ? summary.overlays?.find(item => item.id === selectedOverlayId) : undefined;
                const interactionCut = currentCutId !== undefined ? cutInteractionSegment() : undefined;
                const selectedCut = currentCutId !== undefined
                    ? (typeof summary !== 'undefined'
                        ? summary.cuts?.find(item => String(item.id) === String(currentCutId)) : undefined)
                        || (interactionCut?.id === currentCutId ? interactionCut : undefined)
                    : undefined;
                const leaves = (start, end, hidden) => previewSelectionLeavesRangeFn(
                    previousTime, time, start, end, hidden);
                const selectedCaptionCues = currentCaptionId
                    ? captions.filter(item => (item.sourceCueId || item.id) === currentCaptionId) : [];
                const releaseCaption = selectedCaptionCues.some(item => previousTime >= item.start && previousTime < item.end)
                    && (captionLayer?.style?.visibility === 'hidden'
                        || !selectedCaptionCues.some(item => time >= item.start && time < item.end));
                const releaseLayer = selectedLayer && leaves(selectedLayer.t, selectedLayer.t + selectedLayer.duration,
                    (typeof allTracksHiddenByScope !== 'undefined' && allTracksHiddenByScope.layers)
                    || (typeof hiddenTracksByScope !== 'undefined' && hiddenTracksByScope.layers.has(selectedLayer.track))
                    || (typeof hiddenTracks !== 'undefined' && hiddenTracks.has(selectedLayer.track)));
                const releaseCut = selectedCut && leaves(selectedCut.outStart, selectedCut.outEnd,
                    (typeof allTracksHiddenByScope !== 'undefined' && allTracksHiddenByScope.cuts)
                    || (typeof hiddenTracksByScope !== 'undefined' && hiddenTracksByScope.cuts.has(selectedCut.track))
                    || (typeof hiddenTracks !== 'undefined' && hiddenTracks.has(selectedCut.track)));
                const releaseOverlay = selectedOverlay && leaves(selectedOverlay.start,
                    selectedOverlay.start + selectedOverlay.duration,
                    typeof hiddenTracks !== 'undefined' && hiddenTracks.has(selectedOverlay.track));
                if (releaseCaption || releaseLayer || releaseCut || releaseOverlay) {
                    window.akari.reportContextBox?.({ user: 'seek' });
                }
                if (releaseCaption) deselectCaption();
                if (releaseLayer) selectLayer(null);
                if (releaseCut) {
                    requestedCutId = undefined;
                    deselectCut({ report: false });
                    window.akari.reportCutSelection(null);
                }
                if (releaseOverlay) {
                    requestedOverlayId = undefined;
                    window.akari.interaction?.clearSelection?.();
                    window.akari.reportOverlaySelection(null);
                }
            };
            const renderCaption = () => {
                // All preview cues are normalized to output time by the host.
                const active = window.AkariEditKernel.findActiveCaptions(captions, outputTime);
                window.akari.expirePreviewSelections?.(outputTime);
                const activeTrackId = active.find(caption => caption.groupTrackId)?.groupTrackId;
                const itemStack = typeof summary !== 'undefined' && summary.itemStackZ ? summary : null;
                if (itemStack && captionLayer?.style) {
                    // 一枚の字幕面を段 z で固定すると、同じ段の写真が後から DOM に追加された
                    // 場合に子の順が失われる。面は透明にし、各字幕行を item 順で重ねる。
                    captionLayer.style.zIndex = '';
                    renderCaption.groupZApplied = false;
                } else if ((activeTrackId || renderCaption.groupZApplied) && captionLayer?.style
                    && typeof summary !== 'undefined' && Array.isArray(summary.timelineTracks)) {
                    const targetId = activeTrackId || summary.captionTrackId;
                    const captionZ = summary.timelineTracks.findIndex(track => track?.id === targetId);
                    captionLayer.style.zIndex = captionZ >= 0 ? String(captionZ) : '';
                    renderCaption.groupZApplied = Boolean(activeTrackId);
                }
                const keys = new Set(active.map(caption => caption.id));
                for (const [key, row] of captionRows) {
                    if (!keys.has(key)) { row.plate.remove(); captionRows.delete(key); }
                }
                for (const caption of active) {
                    let row = captionRows.get(caption.id);
                    if (!row) {
                        const plate = document.createElement('div');
                        plate.id = 'caption-plate-' + encodeURIComponent(caption.id);
                        plate.className = 'caption-row-plate';
                        plate.dataset.akariOnboardingTarget = 'caption-text';
                        plate.dataset.captionKey = caption.id;
                        row = { plate, caption, renderedCaption: null, captionHitRegionPending: false };
                        captionRows.set(caption.id, row);
                    }
                    row.caption = caption;
                    if (itemStack && row.plate?.style) {
                        const itemZ = itemStack.itemStackZ[caption.groupItemId || caption.id];
                        const rowZ = Number.isInteger(itemZ) ? itemZ
                            : itemStack.trackStackZ?.[itemStack.captionItemTrackIds?.[caption.id]
                                || caption.canvasTrackId || caption.groupTrackId || itemStack.captionTrackId];
                        row.plate.style.zIndex = Number.isInteger(rowZ) ? String(rowZ) : '';
                    }
                    // Reconcile order without moving a focused editor or captured pointer.
                    const index = active.indexOf(caption);
                    if (captionLayer.children[index] !== row.plate) {
                        captionLayer.insertBefore(row.plate, captionLayer.children[index] || null);
                    }
                    renderCaptionRow(caption, row);
                }
                window.akari.updateCanvasCaptionLayer?.();
                if (requestedCutId !== undefined) updateCutSelectBox();
                if (selectedCaptionId || selectedCaptionIds.size > 0) updateCaptionSelectBox();
            };
            window.addEventListener('akari-frame-engine-seek', event => {
                const time = event.detail?.time;
                if (!Number.isFinite(time)) return;
                outputTime = time;
                window.akari.updateEmptyCanvasHint?.(outputTime);
                renderCaption();
                applyRequestedOverlaySelection();
            });
            const renderTransitionPlate = timelineTime => renderTransitionComposite(timelineTime);
            const stopCaptionMotionReplay = keepRequest => {
                const replay = captionMotionReplay;
                if (!replay) return;
                if (replay.startTimer) window.clearTimeout(replay.startTimer);
                if (replay.finishTimer) window.clearTimeout(replay.finishTimer);
                if (replay.interval) window.clearInterval(replay.interval);
                if (replay.watchFrame) window.cancelAnimationFrame(replay.watchFrame);
                for (const animation of replay.animations || []) animation.cancel();
                replay.restore?.();
                replay.startTimer = replay.finishTimer = replay.interval = replay.watchFrame = null;
                replay.animations = [];
                replay.restore = null;
                if (!keepRequest) captionMotionReplay = null;
            };
            const finishCaptionMotionReplay = replay => {
                if (captionMotionReplay !== replay) return;
                stopCaptionMotionReplay(false);
            };
            const startCaptionMotionReplay = replay => {
                if (captionMotionReplay !== replay || Date.now() >= replay.expiresAt) {
                    stopCaptionMotionReplay(false);
                    return;
                }
                const row = [...captionRows.values()].find(candidate =>
                    (candidate.caption?.sourceCueId || candidate.caption?.id) === replay.captionId);
                const targets = row ? motionTextTargets(row.plate) : [];
                if (!targets.length) {
                    replay.startTimer = window.setTimeout(() => startCaptionMotionReplay(replay), 100);
                    return;
                }
                replay.startedAt ??= Date.now();
                const elapsed = () => Math.max(0, Date.now() - replay.startedAt);
                const original = targets.map(target => ({ target, nodes: [...target.childNodes],
                    animation: target.style.animation }));
                const token = String(++replay.revision);
                targets.forEach(target => { target.dataset.akariMotionReplay = token; });
                const watch = () => {
                    if (captionMotionReplay !== replay) return;
                    if (targets.some(target => !target.isConnected || target.dataset.akariMotionReplay !== token)) {
                        resumeCaptionMotionAfterRender();
                        return;
                    }
                    for (const target of targets) {
                        for (const animation of target.getAnimations({ subtree: true })) {
                            if (animation.playState !== 'paused') continue;
                            if (replay.animations.includes(animation)) {
                                animation.currentTime = elapsed();
                            } else if (animation.effect?.target?.closest?.('[data-akari-motion-replay]')) {
                                // renderCaptionRow seeks CSS animations to the cue time and pauses them.
                                animation.currentTime = elapsed();
                            } else continue;
                            animation.play();
                        }
                    }
                    replay.watchFrame = window.requestAnimationFrame(watch);
                };
                replay.watchFrame = window.requestAnimationFrame(watch);
                replay.restore = () => {
                    for (const entry of original) {
                        if (!entry.target.isConnected || entry.target.dataset.akariMotionReplay !== token) continue;
                        entry.target.replaceChildren(...entry.nodes);
                        entry.target.style.animation = entry.animation;
                        delete entry.target.dataset.akariMotionReplay;
                    }
                };
                const animate = (element, frames, options) => {
                    const animation = element.animate(frames, options);
                    animation.currentTime = elapsed();
                    replay.animations.push(animation);
                    return animation;
                };
                if (replay.id === 'typewriter') {
                    if (!document.getElementById('akari-caption-preview-caret-style')) {
                        const style = document.createElement('style');
                        style.id = 'akari-caption-preview-caret-style';
                        style.textContent = '@keyframes akari-caption-preview-caret{50%{opacity:0}}';
                        document.head.appendChild(style);
                    }
                    const letters = targets.map(target => Array.from(
                        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(target.textContent || ''),
                        part => part.segment));
                    const total = letters.reduce((sum, line) => sum + line.length, 0);
                    const caret = document.createElement('span');
                    caret.textContent = '|';
                    caret.style.cssText = 'display:inline-block;color:inherit;animation:akari-caption-preview-caret .55s step-end infinite';
                    const step = Math.max(55, Math.round(1400 / Math.max(1, total)));
                    let index = Math.min(total, Math.floor(elapsed() / step));
                    const draw = () => {
                        let remaining = index;
                        let active = 0;
                        letters.forEach((line, lineIndex) => {
                            const count = Math.max(0, Math.min(line.length, remaining));
                            targets[lineIndex].replaceChildren(document.createTextNode(line.slice(0, count).join('')));
                            if (remaining > 0 || lineIndex === 0) active = lineIndex;
                            remaining -= line.length;
                        });
                        targets[active].appendChild(caret);
                    };
                    draw();
                    replay.interval = window.setInterval(() => {
                        if (captionMotionReplay !== replay) return;
                        index = Math.min(total, Math.floor(elapsed() / step));
                        draw();
                        if (index >= total) {
                            window.clearInterval(replay.interval);
                            replay.interval = null;
                            replay.finishTimer = window.setTimeout(() => finishCaptionMotionReplay(replay), 650);
                        }
                    }, step);
                    return;
                }
                const line = targets[0];
                if (replay.kind === 'word-style') {
                    const text = line.textContent || '';
                    const words = Array.isArray(row.caption?.words) ? row.caption.words.map(word => word.text) : [];
                    const units = words.length && words.join('') === text ? words : Array.from(text);
                    line.replaceChildren();
                    units.forEach((unit, index) => {
                        const span = document.createElement('span');
                        span.textContent = unit;
                        span.style.display = 'inline-block';
                        line.appendChild(span);
                        const frames = replay.id === 'karaoke'
                            ? [{ color: row.caption?.textStyle?.color || '#ffffff' }, { color: getComputedStyle(line).getPropertyValue('--caption-highlight-color').trim() || '#ffd94a' }]
                            : replay.id === 'pop'
                                ? [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }]
                                : [{ opacity: 0 }, { opacity: 1 }];
                        animate(span, frames, { duration: 260, delay: index * 160, fill: 'forwards' });
                    });
                    replay.finishTimer = window.setTimeout(() => finishCaptionMotionReplay(replay),
                        units.length * 160 + 700);
                    return;
                }
                if (replay.kind === 'emphasis') {
                    const selected = row.caption?.words?.[Number(replay.wordIndex) || 0]?.text || line.textContent || '';
                    const targetLine = targets.find(candidate => (candidate.textContent || '').includes(selected)) || line;
                    const text = targetLine.textContent || '';
                    const at = text.indexOf(selected);
                    const span = document.createElement('span');
                    span.textContent = selected;
                    span.style.display = 'inline-block';
                    targetLine.replaceChildren(document.createTextNode(at >= 0 ? text.slice(0, at) : ''),
                        span, document.createTextNode(at >= 0 ? text.slice(at + selected.length) : ''));
                    const styles = {
                        'one-char-bang': [{ transform: 'scale(.5)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
                        'one-char-jumble': [{ transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }],
                        'size-pulse': [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
                        'color-accent': [{ color: 'currentColor' }, { color: '#ffd94a' }],
                        'color-only': [{ color: 'currentColor' }, { color: '#ffd94a' }],
                        'outline-bold': [{ webkitTextStrokeWidth: '0px' }, { webkitTextStrokeWidth: '2px' }],
                        danger: [{ color: '#f87171', transform: 'translateX(-3px)' }, { color: '#f87171', transform: 'translateX(3px)' }],
                        positive: [{ color: '#4ade80', transform: 'scale(1)' }, { color: '#4ade80', transform: 'scale(1.15)' }],
                        highlight: [{ backgroundColor: 'transparent' }, { backgroundColor: '#ffd94a' }]
                    };
                    if (replay.id === 'one-char-bang' || replay.id === 'one-char-jumble') {
                        span.textContent = '';
                        Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' })
                            .segment(selected), part => part.segment).forEach((character, characterIndex) => {
                            const unit = document.createElement('span');
                            unit.textContent = character;
                            unit.style.display = 'inline-block';
                            span.appendChild(unit);
                            animate(unit, styles[replay.id], { duration: 420,
                                delay: characterIndex * 110, fill: 'forwards' });
                        });
                    } else animate(span, styles[replay.id] || styles['size-pulse'],
                        { duration: 700, iterations: replay.id === 'danger' ? 3 : 1, fill: 'forwards' });
                    replay.finishTimer = window.setTimeout(() => finishCaptionMotionReplay(replay), 1800);
                    return;
                }
                const recipe = captionAnimationRecipes[replay.id];
                if (!recipe) { finishCaptionMotionReplay(replay); return; }
                const name = 'akari-caption-oneshot-' + replay.id;
                if (!document.getElementById('akari-caption-oneshot-style-' + replay.id)) {
                    const style = document.createElement('style');
                    style.id = 'akari-caption-oneshot-style-' + replay.id;
                    style.textContent = '@keyframes ' + name + '{' + recipe + '}';
                    document.head.appendChild(style);
                }
                line.style.animation = 'none';
                void line.offsetWidth;
                line.style.animation = name + ' 650ms ease-out 1 '
                    + (replay.slot === 'out' ? 'reverse' : 'normal') + ' both';
                for (const animation of line.getAnimations()) animation.currentTime = elapsed();
                replay.finishTimer = window.setTimeout(() => finishCaptionMotionReplay(replay), 700);
            };
            const scheduleCaptionMotionReplay = delay => {
                const replay = captionMotionReplay;
                if (!replay) return;
                if (replay.startTimer) window.clearTimeout(replay.startTimer);
                replay.startTimer = window.setTimeout(() => startCaptionMotionReplay(replay), delay);
            };
            const queueCaptionMotionReplay = message => {
                stopCaptionMotionReplay(false);
                captionMotionReplay = { captionId: message.captionId, id: message.id,
                    kind: message.kind, wordIndex: message.wordIndex, slot: message.slot,
                    expiresAt: Date.now() + 6000, revision: 0, animations: [] };
                // A write may publish captions shortly after this message. Give that redraw the first chance.
                scheduleCaptionMotionReplay(220);
            };
            const resumeCaptionMotionAfterRender = () => {
                const replay = captionMotionReplay;
                if (!replay) return;
                const ids = [...captionRows.values()].map(row => row.caption?.sourceCueId || row.caption?.id);
                if (!canResumeMotion(replay, ids, Date.now())) { stopCaptionMotionReplay(false); return; }
                stopCaptionMotionReplay(true);
                scheduleCaptionMotionReplay(40);
            };
            let activeTransitionWindowKey = null;
            let activeTransitionOutgoingIsStill = false;
            let activeTransitionEngine = 'none';
            let transitionAudioBaseVolume = 1;
            const setTransitionMask = (element, value) => {
                const mask = value && value !== 'none' ? value : '';
                element.style.maskImage = mask;
                element.style.webkitMaskImage = mask;
            };
            // feTurbulence(type=turbulence, baseFrequency=0.9, numOctaves=2, seed=7) を
            // luminanceToAlpha した α の実測 CDF（Chromium 実機・320x320・102400 画素）の逆関数。
            // 添字 i は目標可視比 p = i / 32、値は 256 スロット中の可視スロット数。
            // seed / baseFrequency / numOctaves を変えたらこの表も測り直すこと。
            const DISSOLVE_VISIBLE_SLOTS = [
                0, 20, 26, 30, 33, 36, 39, 41, 44, 46, 48, 51, 53, 55, 58, 60, 62,
                65, 67, 70, 72, 75, 78, 81, 84, 88, 92, 96, 100, 106, 112, 122, 256
            ];
            const writeTransitionTransform = (element, base, transition) => {
                element.style.transform = [base, transition].filter(Boolean).join(' ');
                return element.style.transform;
            };
            const transitionEngineBlockSize = (ratio, width) => {
                return Math.max(1, Math.round(ratio * width));
            };
            const transitionDissolveTableValues = (visibleRatio, slots) => {
                const safeSlots = Math.max(0, Math.floor(Number(slots) || 0));
                const ratio = Math.max(0, Math.min(1, Number(visibleRatio) || 0));
                const tablePosition = ratio * (DISSOLVE_VISIBLE_SLOTS.length - 1);
                const lowerIndex = Math.floor(tablePosition);
                const upperIndex = Math.min(DISSOLVE_VISIBLE_SLOTS.length - 1, lowerIndex + 1);
                const fraction = tablePosition - lowerIndex;
                const calibratedSlots = DISSOLVE_VISIBLE_SLOTS[lowerIndex]
                    + (DISSOLVE_VISIBLE_SLOTS[upperIndex] - DISSOLVE_VISIBLE_SLOTS[lowerIndex])
                        * fraction;
                const visibleSlots = Math.round(calibratedSlots * safeSlots / 256);
                return Array.from({ length: safeSlots }, (_value, index) =>
                    index < visibleSlots ? '1' : '0').join(' ');
            };
            const drawTransitionPixelize = (canvas, outgoingSource, incomingSource, blockSize, alpha) => {
                const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
                if (!ctx) return false;
                const width = Math.max(1, Number(canvas.width) || 1);
                const height = Math.max(1, Number(canvas.height) || 1);
                ctx.clearRect(0, 0, width, height);
                const block = Math.max(1, Math.round(Number(blockSize) || 1));
                const reducedWidth = Math.max(1, Math.ceil(width / block));
                const reducedHeight = Math.max(1, Math.ceil(height / block));
                const reduced = document.createElement('canvas');
                reduced.width = reducedWidth;
                reduced.height = reducedHeight;
                const reducedCtx = reduced.getContext('2d');
                if (!reducedCtx) return false;
                reducedCtx.clearRect(0, 0, reducedWidth, reducedHeight);
                reducedCtx.imageSmoothingEnabled = false;
                reducedCtx.webkitImageSmoothingEnabled = false;
                const sourceDimensions = source => {
                    if (!source) return null;
                    const tagName = String(source.tagName || '').toLowerCase();
                    if (tagName === 'video') {
                        if (Number(source.readyState) < 2) return null;
                        const sourceWidth = Number(source.videoWidth);
                        const sourceHeight = Number(source.videoHeight);
                        return sourceWidth > 0 && sourceHeight > 0
                            ? { width: sourceWidth, height: sourceHeight } : null;
                    }
                    if (tagName === 'img') {
                        const sourceWidth = Number(source.naturalWidth);
                        const sourceHeight = Number(source.naturalHeight);
                        return sourceWidth > 0 && sourceHeight > 0
                            ? { width: sourceWidth, height: sourceHeight } : null;
                    }
                    return null;
                };
                const drawContained = (source, sourceAlpha) => {
                    const dimensions = sourceDimensions(source);
                    if (!dimensions) return false;
                    const scale = Math.min(
                        reducedWidth / dimensions.width,
                        reducedHeight / dimensions.height
                    );
                    const drawWidth = dimensions.width * scale;
                    const drawHeight = dimensions.height * scale;
                    const drawX = (reducedWidth - drawWidth) / 2;
                    const drawY = (reducedHeight - drawHeight) / 2;
                    reducedCtx.globalAlpha = sourceAlpha;
                    reducedCtx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
                    return true;
                };
                const outgoingDrawn = drawContained(outgoingSource, 1);
                const incomingDrawn = drawContained(
                    incomingSource,
                    Math.max(0, Math.min(1, Number(alpha) || 0))
                );
                if (!outgoingDrawn && !incomingDrawn) return false;
                ctx.globalAlpha = 1;
                ctx.imageSmoothingEnabled = false;
                ctx.webkitImageSmoothingEnabled = false;
                const expandedWidth = reducedWidth * block;
                const expandedHeight = reducedHeight * block;
                const offsetX = expandedWidth === width
                    ? 0 : -Math.round((expandedWidth - width) / 2);
                const offsetY = expandedHeight === height
                    ? 0 : -Math.round((expandedHeight - height) / 2);
                ctx.drawImage(
                    reduced,
                    0,
                    0,
                    reducedWidth,
                    reducedHeight,
                    offsetX,
                    offsetY,
                    expandedWidth,
                    expandedHeight
                );
                return true;
            };
            const createTransitionPixelizeReadyHooks = rerender => {
                const listeners = new Map();
                const reset = () => {
                    for (const [element, eventListeners] of listeners) {
                        for (const [eventName, listener] of eventListeners) {
                            element.removeEventListener(eventName, listener);
                        }
                    }
                    listeners.clear();
                };
                const arm = element => {
                    if (!element) return;
                    const tagName = String(element.tagName || '').toLowerCase();
                    const eventNames = tagName === 'video'
                        ? ['loadeddata', 'seeked']
                        : tagName === 'img' ? ['load'] : [];
                    if (eventNames.length === 0) return;
                    let eventListeners = listeners.get(element);
                    if (!eventListeners) {
                        eventListeners = new Map();
                        listeners.set(element, eventListeners);
                    }
                    for (const eventName of eventNames) {
                        if (eventListeners.has(eventName)) continue;
                        const listener = () => {
                            reset();
                            rerender();
                        };
                        eventListeners.set(eventName, listener);
                        element.addEventListener(eventName, listener, { once: true });
                    }
                };
                return { arm, reset };
            };
            const transitionPixelizeReadyHooks = createTransitionPixelizeReadyHooks(() => tick(true));
            const removeTransitionEngineElements = () => {
                transitionPixelizeReadyHooks.reset();
                document.getElementById('transition-engine-filters')?.remove();
                document.getElementById('transition-pixelize-canvas')?.remove();
            };
            const ensureTransitionEngineFilters = zIndex => {
                const existing = document.getElementById('transition-engine-filters');
                if (existing) {
                    existing.style.zIndex = String(zIndex);
                    return {
                        svg: existing,
                        blur: document.getElementById('akari-transition-hblur-node'),
                        dissolveTable: document.getElementById('akari-transition-dissolve-table')
                    };
                }
                const ns = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.id = 'transition-engine-filters';
                svg.setAttribute('width', '0');
                svg.setAttribute('height', '0');
                svg.setAttribute('aria-hidden', 'true');
                svg.style.position = 'absolute';
                svg.style.zIndex = String(zIndex);
                const defs = document.createElementNS(ns, 'defs');
                const blurFilter = document.createElementNS(ns, 'filter');
                blurFilter.id = 'akari-transition-hblur';
                blurFilter.setAttribute('x', '-10%');
                blurFilter.setAttribute('y', '-10%');
                blurFilter.setAttribute('width', '120%');
                blurFilter.setAttribute('height', '120%');
                const blur = document.createElementNS(ns, 'feGaussianBlur');
                blur.id = 'akari-transition-hblur-node';
                blur.setAttribute('stdDeviation', '0 0');
                blur.setAttribute('edgeMode', 'duplicate');
                blurFilter.appendChild(blur);
                const dissolveFilter = document.createElementNS(ns, 'filter');
                dissolveFilter.id = 'akari-transition-dissolve';
                dissolveFilter.setAttribute('x', '0%');
                dissolveFilter.setAttribute('y', '0%');
                dissolveFilter.setAttribute('width', '100%');
                dissolveFilter.setAttribute('height', '100%');
                dissolveFilter.setAttribute('color-interpolation-filters', 'sRGB');
                const turbulence = document.createElementNS(ns, 'feTurbulence');
                turbulence.setAttribute('type', 'turbulence');
                turbulence.setAttribute('baseFrequency', '0.9');
                turbulence.setAttribute('numOctaves', '2');
                turbulence.setAttribute('seed', '7');
                turbulence.setAttribute('result', 'noise');
                const luminance = document.createElementNS(ns, 'feColorMatrix');
                luminance.setAttribute('in', 'noise');
                luminance.setAttribute('type', 'luminanceToAlpha');
                luminance.setAttribute('result', 'noiseAlpha');
                const transfer = document.createElementNS(ns, 'feComponentTransfer');
                transfer.setAttribute('in', 'noiseAlpha');
                transfer.setAttribute('result', 'mask');
                const dissolveTable = document.createElementNS(ns, 'feFuncA');
                dissolveTable.id = 'akari-transition-dissolve-table';
                dissolveTable.setAttribute('type', 'discrete');
                dissolveTable.setAttribute('tableValues', transitionDissolveTableValues(0, 256));
                transfer.appendChild(dissolveTable);
                const composite = document.createElementNS(ns, 'feComposite');
                composite.setAttribute('in', 'SourceGraphic');
                composite.setAttribute('in2', 'mask');
                composite.setAttribute('operator', 'in');
                dissolveFilter.append(turbulence, luminance, transfer, composite);
                defs.append(blurFilter, dissolveFilter);
                svg.appendChild(defs);
                layersStage.appendChild(svg);
                return { svg, blur, dissolveTable };
            };
            const ensureTransitionPixelizeCanvas = zIndex => {
                let canvas = document.getElementById('transition-pixelize-canvas');
                if (!canvas) {
                    canvas = document.createElement('canvas');
                    canvas.id = 'transition-pixelize-canvas';
                    canvas.style.position = 'absolute';
                    canvas.style.pointerEvents = 'none';
                    layersStage.appendChild(canvas);
                }
                canvas.style.zIndex = String(zIndex);
                return canvas;
            };
            const resetTransitionComposite = () => {
                if (activeTransitionWindowKey !== null) {
                    const segment = segments[activeSegmentIndex];
                    const restoredOpacity = segment && Number.isFinite(segment.opacity)
                        ? String(segment.opacity) : '';
                    if (isStillSegment(segment)) {
                        // syncStillImageVisual の鏡写し元も同時に戻し、tick 外の layout/load 経路が
                        // 静止画だけを古い transition opacity へ戻さないようにする。
                        video.style.opacity = restoredOpacity;
                        stillImage.style.opacity = restoredOpacity;
                    } else {
                        video.style.opacity = restoredOpacity;
                    }
                    if (segment && segment.kind === 'src') {
                        const restoredZ = String(typeof zForItem === 'function'
                            ? zForItem(segment.id, zForTrack(segment.trackId)) : zForTrack(segment.trackId));
                        video.style.zIndex = restoredZ;
                        stillImage.style.zIndex = restoredZ;
                    }
                    if (!activeTransitionOutgoingIsStill) {
                        video.volume = transitionAudioBaseVolume;
                    }
                }
                activeTransitionWindowKey = null;
                activeTransitionOutgoingIsStill = false;
                activeTransitionEngine = 'none';
                removeTransitionEngineElements();
                video.dataset.akariTransitionAudioActive = 'false';
                video.dataset.akariTransitionType = '';
                video.dataset.akariTransitionProgress = '';
                stillImage.dataset.akariTransitionType = '';
                stillImage.dataset.akariTransitionProgress = '';
                transitionVideo.dataset.akariTransitionType = '';
                transitionVideo.dataset.akariTransitionProgress = '';
                transitionStill.dataset.akariTransitionType = '';
                transitionStill.dataset.akariTransitionProgress = '';
                transitionVideo.style.display = 'none';
                transitionVideo.style.opacity = '0';
                transitionVideo.style.clipPath = 'none';
                transitionVideo.style.transform = '';
                transitionVideo.style.filter = transitionVideo.dataset.akariAdjustFilter || '';
                setTransitionMask(transitionVideo, 'none');
                transitionVideo.muted = true;
                transitionVideo.pause();
                transitionStill.style.display = 'none';
                transitionStill.style.opacity = '0';
                transitionStill.style.clipPath = 'none';
                transitionStill.style.transform = '';
                transitionStill.style.filter = transitionStill.dataset.akariAdjustFilter || '';
                setTransitionMask(transitionStill, 'none');
                video.style.filter = video.dataset.akariAdjustFilter || '';
                stillImage.style.filter = stillImage.dataset.akariAdjustFilter || '';
                setTransitionMask(video, 'none');
                setTransitionMask(stillImage, 'none');
                transitionPlate.style.opacity = '0';
                transitionFallbackLabel.style.display = 'none';
                transitionFallbackLabel.textContent = '';
                transitionFallbackLabel.dataset.akariTransitionFallback = '';
            };
            const renderTransitionComposite = timelineTime => {
                if (frameEngineMediaIdle) {
                    resetTransitionComposite();
                    return;
                }
                const window = transitionWindows.find(candidate =>
                    timelineTime >= candidate.start && timelineTime < candidate.end);
                const incomingHidden = window && (allTracksHiddenByScope.cuts
                    || hiddenTracksByScope.cuts.has(window.incoming.track));
                if (!window || !window.incoming || incomingHidden) {
                    resetTransitionComposite();
                    return;
                }
                const outgoingIsStill = isStillSegment(window.outgoing);
                const incomingStillUrl = stillUrlForSegment(window.incoming);
                const incomingIsStill = Boolean(incomingStillUrl);
                const outgoingElement = outgoingIsStill ? stillImage : video;
                const incomingElement = incomingIsStill ? transitionStill : transitionVideo;
                const key = window.start + ':' + window.end + ':' + window.incoming.cutIndex;
                if (activeTransitionWindowKey !== key) {
                    resetTransitionComposite();
                    activeTransitionWindowKey = key;
                    activeTransitionOutgoingIsStill = outgoingIsStill;
                    transitionAudioBaseVolume = Number.isFinite(video.volume)
                        ? clamp(video.volume, 0, 1) : 1;
                    video.dataset.akariTransitionAudioActive = String(!outgoingIsStill);
                }
                const progress = clamp((timelineTime - window.start) / window.duration, 0, 1);
                const transitionDefinition = transitionById[window.type];
                const visual = computeTransitionVisualFn(
                    transitionDefinition?.previewKind || 'fallback',
                    progress,
                    transitionDefinition?.labelJa || String(window.type)
                );
                if (activeTransitionEngine !== visual.engine) {
                    removeTransitionEngineElements();
                    activeTransitionEngine = visual.engine;
                }
                const outgoingZ = zForItem(window.outgoing.id, zForTrack(window.outgoing.trackId));
                const incomingZ = zForItem(window.incoming.id, zForTrack(window.incoming.trackId));
                const engineZ = Math.max(outgoingZ, incomingZ) + 1;
                const engineFilters = visual.engine === 'directional-blur'
                    || visual.engine === 'noise-dissolve'
                    ? ensureTransitionEngineFilters(engineZ) : null;
                if (visual.engine === 'directional-blur' && engineFilters?.blur) {
                    const stageWidth = Number.parseFloat(layersStage.style.width)
                        || Number.parseFloat(video.style.width)
                        || Number(summary.output && summary.output.width)
                        || 1280;
                    engineFilters.blur.setAttribute(
                        'stdDeviation',
                        String(visual.blurStdDeviationRatio * stageWidth) + ' 0'
                    );
                } else if (visual.engine === 'noise-dissolve' && engineFilters?.dissolveTable) {
                    engineFilters.dissolveTable.setAttribute(
                        'tableValues',
                        transitionDissolveTableValues(visual.dissolveVisibleRatio, 256)
                    );
                }
                const outgoingOpacity = Number.isFinite(window.outgoing.opacity) ? window.outgoing.opacity : 1;
                const incomingOpacity = Number.isFinite(window.incoming.opacity) ? window.incoming.opacity : 1;
                clearAdjustBaseFilter(outgoingElement);
                clearAdjustBaseFilter(incomingElement);
                setAdjustBaseFilter(outgoingElement, window.outgoing);
                setAdjustBaseFilter(incomingElement, window.incoming);
                if (outgoingIsStill) {
                    clearAdjustBaseFilter(video);
                    setAdjustBaseFilter(video, window.outgoing);
                }
                if (outgoingIsStill) {
                    // #preview-still は tick 外の layout/load 経路でも video.style.opacity を
                    // 鏡写しする。hidden の video にも同じ合成値を置けば、どの経路が後から
                    // syncStillImageVisual を呼んでも outgoing の実 DOM 値が巻き戻らない。
                    video.style.opacity = String(outgoingOpacity * visual.outgoingOpacity);
                    stillImage.style.opacity = video.style.opacity;
                } else {
                    video.style.opacity = String(outgoingOpacity * visual.outgoingOpacity);
                }
                const outgoingTransitionFilter = visual.engine === 'directional-blur'
                    ? 'url(#akari-transition-hblur)'
                    : (visual.outgoingFilter === 'none' ? '' : visual.outgoingFilter);
                setAdjustTransitionFilter(outgoingElement, window.outgoing, outgoingTransitionFilter);
                setTransitionMask(outgoingElement, visual.outgoingMask);
                if (outgoingIsStill) {
                    video.style.filter = outgoingElement.style.filter;
                    setTransitionMask(video, visual.outgoingMask);
                }
                if (incomingIsStill && transitionStill.getAttribute('src') !== incomingStillUrl) {
                    transitionStill.setAttribute('src', incomingStillUrl);
                }
                incomingElement.style.display = 'block';
                incomingElement.style.opacity = String(incomingOpacity * visual.incomingOpacity);
                incomingElement.style.clipPath = visual.incomingClipPath;
                incomingElement.style.left = video.style.left;
                incomingElement.style.top = video.style.top;
                incomingElement.style.width = video.style.width;
                incomingElement.style.height = video.style.height;
                const incomingLocalTime = Math.max(0, timelineTime - window.start);
                const incomingLayerStyle = writeCutLayerStyleBase(incomingElement, window.incoming);
                if (incomingLayerStyle) {
                    if (incomingIsStill) {
                        applyCutKeyframesToMedia(transitionStill, window.incoming, incomingLocalTime);
                    } else {
                        // 動画 incoming の既存レールと wiring assert を維持する。
                        applyCutKeyframesToMedia(transitionVideo, window.incoming, incomingLocalTime);
                    }
                    // dissolve/fade の 'none' で crop clip を消さない。reveal は既存 transition
                    // window の clip を優先し、窓モデル自体の挙動を維持する。
                    incomingElement.style.clipPath = visual.incomingClipPath === 'none'
                        ? (incomingElement.dataset.akariCropClipPath || 'none')
                        : visual.incomingClipPath;
                } else {
                    const incomingTransform = window.incoming.transform;
                    const incomingBaseTransform = incomingTransform
                        ? 'translate(' + (Number(incomingTransform.x) || 0) + 'px, '
                            + (Number(incomingTransform.y) || 0) + 'px) scale('
                            + (Number(incomingTransform.scale) || 1) + ') rotate('
                            + (Number(incomingTransform.rotate) || 0) + 'deg)'
                        : '';
                    const incomingFraming = computeCutFramingVisualFn(
                        window.incoming.framing,
                        incomingLocalTime
                    );
                    incomingElement.style.transformOrigin = incomingFraming?.transformOrigin || '';
                    incomingElement.style.transform = incomingBaseTransform
                        + (incomingFraming ? (incomingBaseTransform ? ' ' : '') + incomingFraming.transform : '');
                    if (incomingIsStill) {
                        transitionStill.style.clipPath = visual.incomingClipPath;
                    } else {
                        transitionVideo.style.clipPath = visual.incomingClipPath;
                    }
                }
                // style.transform は同一 tick の再入で既に transition を含み得るため読み戻さない。
                // applyCutFramingVisual が毎 tick 保存する transition 無しの正準値だけを基底にする。
                const outgoingBaseTransform = outgoingElement.dataset.akariTransitionBaseTransform || '';
                writeTransitionTransform(
                    outgoingElement,
                    outgoingBaseTransform,
                    visual.outgoingTransform
                );
                if (outgoingIsStill) video.style.transform = outgoingElement.style.transform;
                writeTransitionTransform(
                    incomingElement,
                    incomingElement.style.transform,
                    visual.incomingTransform
                );
                const incomingTransitionFilter = visual.engine === 'directional-blur'
                    ? 'url(#akari-transition-hblur)'
                    : visual.engine === 'noise-dissolve'
                        ? 'url(#akari-transition-dissolve)'
                        : (visual.incomingFilter === 'none' ? '' : visual.incomingFilter);
                setAdjustTransitionFilter(incomingElement, window.incoming, incomingTransitionFilter);
                setTransitionMask(incomingElement, visual.incomingMask);
                outgoingElement.style.zIndex = String(visual.zSwap ? Math.max(outgoingZ, incomingZ) + 1 : outgoingZ);
                if (outgoingIsStill) video.style.zIndex = outgoingElement.style.zIndex;
                incomingElement.style.zIndex = String(incomingZ);
                if (visual.engine === 'pixelize') {
                    transitionPixelizeReadyHooks.arm(outgoingElement);
                    transitionPixelizeReadyHooks.arm(incomingElement);
                    const canvas = ensureTransitionPixelizeCanvas(engineZ);
                    const canvasWidth = Number(summary.output && summary.output.width) || 1280;
                    const canvasHeight = Number(summary.output && summary.output.height) || 720;
                    canvas.width = Math.max(1, Math.round(canvasWidth));
                    canvas.height = Math.max(1, Math.round(canvasHeight));
                    canvas.style.left = video.style.left;
                    canvas.style.top = video.style.top;
                    canvas.style.width = video.style.width;
                    canvas.style.height = video.style.height;
                    const blockSize = transitionEngineBlockSize(visual.pixelBlockRatio, canvasWidth);
                    canvas.style.display = drawTransitionPixelize(
                        canvas,
                        outgoingElement,
                        incomingElement,
                        blockSize,
                        visual.progress
                    ) ? 'block' : 'none';
                }
                const progressText = visual.progress.toFixed(3);
                outgoingElement.dataset.akariTransitionType = window.type;
                outgoingElement.dataset.akariTransitionProgress = progressText;
                incomingElement.dataset.akariTransitionType = window.type;
                incomingElement.dataset.akariTransitionProgress = progressText;
                transitionPlate.style.background = visual.plateColor;
                transitionPlate.style.opacity = String(visual.plateOpacity);
                transitionFallbackLabel.textContent = visual.fallbackLabel;
                transitionFallbackLabel.style.display = visual.fallbackLabel ? 'block' : 'none';
                transitionFallbackLabel.dataset.akariTransitionFallback = visual.fallbackLabel ? window.type : '';

                if (!incomingIsStill) {
                    const incomingSpeed = Number.isFinite(window.incoming.speed) && window.incoming.speed > 0
                        ? window.incoming.speed : 1;
                    const target = window.incoming.in + (timelineTime - window.start) * incomingSpeed;
                    const seekIncoming = () => {
                        const tolerance = isPlaying ? 0.05 : 0.001;
                        if (Math.abs((transitionVideo.currentTime || 0) - target) > tolerance) {
                            try { transitionVideo.currentTime = target; } catch (_error) { /* metadata pending */ }
                        }
                        if (isPlaying && transitionVideo.paused) {
                            void transitionVideo.play().catch(() => undefined);
                        } else if (!isPlaying && !transitionVideo.paused) {
                            transitionVideo.pause();
                        }
                    };
                    if (!applyTransitionSegmentSource(window.incoming, () => {
                        seekIncoming();
                        tick(true);
                    })) seekIncoming();
                    transitionVideo.playbackRate = effectiveMediaRateFn(incomingSpeed, previewRate);

                    const cutsTrackMuted = allTracksMutedByScope.cuts
                        || mutedTracksByScope.cuts.has(window.incoming.track);
                    transitionVideo.muted = globalMuted || !isCutAudioAudibleFn(window.incoming, { muted: cutsTrackMuted });
                    // incoming 静止画ではこの分岐へ入らず、無音要素の volume を触らない。
                    transitionVideo.volume = transitionAudioBaseVolume * progress;
                }
                if (!outgoingIsStill) {
                    // outgoing 静止画では本編 video の音量を変えず、動画側だけを線形減衰する。
                    video.volume = transitionAudioBaseVolume * (1 - progress);
                }
            };
            const renderLayers = timelineTime => {
                // ㉘ layers[].keyframes（contract-2026-08-09-transform-keyframes-v0.md）: dataset
                // が変わっても DOM スタイルには自動反映されない（updateStageScale が dataset ->
                // style を書く唯一の場所）ので、このフレームで実際に何か上書きしたときだけ最後に
                // 1 回まとめて呼ぶ -- keyframes の無いプロジェクト（大多数）はここで一切コストが
                // 増えない。
                let anyKeyframeApplied = false;
                for (const entry of layerEntries) {
                    const layer = entry.spec;
                    const layerVideo = entry.video;
                    layerVideo.muted = allTracksMutedByScope.layers || mutedTracksByScope.layers.has(layer.track);
                    const activeWindow = !allTracksHiddenByScope.layers
                        && !hiddenTracksByScope.layers.has(layer.track)
                        && timelineTime >= layer.t && timelineTime < layer.t + layer.duration;
                    if (optimisticallyRemovedIds.has(String(layer.id))) {
                        layerVideo.style.display = 'none';
                        if (entry.deferredPlaceholder) entry.deferredPlaceholder.style.display = 'none';
                        if (!layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    if (layerVideo.akariPhotoFrameBorder) {
                        layerVideo.akariPhotoFrameBorder.style.display = activeWindow && !layer.proxyMissing
                            && typeof layer.src === 'string' && layer.src ? 'block' : 'none';
                        layerVideo.akariPhotoFrameBorder.style.opacity = layerVideo.style.opacity || '1';
                    }
                    const localTime = clamp(timelineTime - layer.t, 0, layer.duration);
                    const mediaEnd = Number.isFinite(layerVideo.duration) && layerVideo.duration > 0
                        ? Math.max(0, layerVideo.duration - 0.001)
                        : layer.duration;
                    const target = Math.min(localTime, mediaEnd);
                    let deferredPlaybackRate = effectiveMediaRateFn(1, previewRate);
                    if (!frameEngineMediaIdle && layerVideo.tagName === 'VIDEO'
                        && Math.abs(layerVideo.playbackRate - deferredPlaybackRate) > 0.001) {
                        layerVideo.playbackRate = deferredPlaybackRate;
                    }
                    if (layer.retiredTelop) {
                        entry.deferredPlaceholder.style.display = activeWindow ? 'grid' : 'none';
                        entry.deferredPlaceholder.dataset.akariDeferredState = activeWindow ? 'retired' : 'inactive';
                        layerVideo.style.display = 'none';
                        if (!layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    if (entry.deferredTelop && frameEngineMediaIdle) {
                        const bakePending = layer.proxyMissing
                            || !(typeof layer.src === 'string' && layer.src);
                        const deferredState = !activeWindow ? 'inactive'
                            : bakePending ? 'baking'
                                : layerVideo.readyState < HTMLMediaElement.HAVE_METADATA ? 'loading' : 'ready';
                        entry.deferredPlaceholder.style.display = deferredState === 'baking' ? 'grid' : 'none';
                        entry.deferredPlaceholder.dataset.akariDeferredState = deferredState;
                    }
                    if (entry.deferredTelop && !frameEngineMediaIdle) {
                        if (entry.deferredMediaLoading
                            && layerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                            entry.deferredMediaLoading = false;
                        }
                        if (entry.deferredSeekPending && !layerVideo.seeking
                            && Number.isFinite(entry.deferredSeekTarget)
                            && Math.abs((layerVideo.currentTime || 0) - entry.deferredSeekTarget) <= 0.25) {
                            // seeked is the primary release. This covers engines which settle a
                            // same-frame seek without emitting the event after a source swap.
                            entry.deferredSeekPending = false;
                            entry.deferredSeekTarget = null;
                        }
                        const bakePending = layer.proxyMissing
                            || !(typeof layer.src === 'string' && layer.src);
                        const deferredAction = resolveDeferredTelopPlaybackFn({
                            active: activeWindow,
                            bakePending,
                            mediaReady: !entry.deferredMediaLoading
                                && layerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
                            seekPending: entry.deferredSeekPending,
                            mediaSeeking: layerVideo.seeking,
                            currentTime: layerVideo.currentTime || 0,
                            targetTime: target,
                            playing: isPlaying
                        });
                        // 「準備中」は host がまだ telop を焼いている間だけ。ready 後の media load や
                        // currentTime 再同期は通常の再生操作なので、表示済みフレームを保ったまま行う。
                        const showPlaceholder = deferredAction.phase === 'baking';
                        entry.deferredPlaceholder.style.display = showPlaceholder ? 'grid' : 'none';
                        entry.deferredPlaceholder.dataset.akariDeferredState = deferredAction.phase;
                        if (deferredAction.phase === 'inactive') {
                            layerVideo.style.display = 'none';
                            if (!layerVideo.paused) layerVideo.pause();
                            layerVideo.playbackRate = effectiveMediaRateFn(1, previewRate);
                            continue;
                        }
                        if (deferredAction.phase === 'baking') {
                            layerVideo.style.display = 'none';
                            if (!layerVideo.paused) layerVideo.pause();
                            continue;
                        }
                        if (deferredAction.phase === 'loading') {
                            layerVideo.style.display = entry.deferredHasPresentedFrame ? 'block' : 'none';
                            if (isPlaying && entry.deferredHasPresentedFrame && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        if (deferredAction.phase === 'syncing') {
                            layerVideo.style.display = 'block';
                            if (isPlaying && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        if (deferredAction.phase === 'seek') {
                            layerVideo.style.display = 'block';
                            entry.deferredSeekPending = true;
                            entry.deferredSeekTarget = deferredAction.targetTime;
                            try {
                                layerVideo.currentTime = deferredAction.targetTime;
                            } catch (error) {
                                entry.deferredSeekPending = false;
                                entry.deferredSeekTarget = null;
                                console.warn('[akari-preview] deferred telop seek failed', layer.id, error);
                            }
                            if (isPlaying && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        entry.deferredHasPresentedFrame = true;
                        deferredPlaybackRate = effectiveMediaRateFn(deferredAction.playbackRate, previewRate);
                    }
                    const active = activeWindow
                        && !layer.proxyMissing
                        && typeof layer.src === 'string' && layer.src;
                    if (!active) {
                        layerVideo.style.display = 'none';
                        if (!frameEngineMediaIdle && !layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    if (layerVideo.readyState < HTMLMediaElement.HAVE_METADATA
                        && !(frameEngineMediaIdle && layer.isImage === true)) {
                        layerVideo.style.display = 'none';
                        continue;
                    }
                    layerVideo.style.display = 'block';
                    if (!selectionGestureProtects('layer', entry)
                        && Array.isArray(layer.keyframes) && layer.keyframes.length >= 2) {
                        // computeLayerKeyframesVisualFn is a webview-injected copy (toString()
                        // serialization) -- guarded the same way computeLayerPerspectiveVisualFn's
                        // call in updateStageScale is, so a future injection regression degrades to
                        // "keyframes not applied" instead of aborting the rest of this loop.
                        try {
                            const resolved = computeLayerKeyframesVisualFn(layer.keyframes, localTime,
                                layer.transform || {}, true);
                            if (resolved) {
                                if (resolved.transform) {
                                    layerVideo.dataset.akariTransformX = String(resolved.transform.x);
                                    layerVideo.dataset.akariTransformY = String(resolved.transform.y);
                                    layerVideo.dataset.akariTransformScale = String(resolved.transform.scale);
                                    layerVideo.dataset.akariTransformScaleX = String(resolved.transform.scaleX ?? resolved.transform.scale);
                                    layerVideo.dataset.akariTransformScaleY = String(resolved.transform.scaleY ?? resolved.transform.scale);
                                    layerVideo.dataset.akariTransformRotate = String(resolved.transform.rotate);
                                }
                                if (resolved.crop) {
                                    layerVideo.dataset.akariCropX = String(resolved.crop.x);
                                    layerVideo.dataset.akariCropY = String(resolved.crop.y);
                                    layerVideo.dataset.akariCropW = String(resolved.crop.w);
                                    layerVideo.dataset.akariCropH = String(resolved.crop.h);
                                }
                                if (resolved.perspective) {
                                    layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(resolved.perspective.corners);
                                }
                                if (resolved.transform || resolved.crop || resolved.perspective) anyKeyframeApplied = true;
                            }
                        } catch (error) {
                            console.warn('[akari-preview] layer keyframes visual failed; rendering without them', layer.id, error);
                        }
                    }
                    // engine 面では legacy media を表示幾何の台帳としてだけ使う。ここまでの
                    // display / dataset 更新は維持し、再生・シーク・画素走査へは進めない。
                    if (frameEngineMediaIdle) continue;
                    if (Math.abs(layerVideo.playbackRate - deferredPlaybackRate) > 0.001) {
                        layerVideo.playbackRate = deferredPlaybackRate;
                    }
                    if (!entry.deferredTelop) {
                        const tolerance = isPlaying ? 0.05 : 0.001;
                        if (Math.abs((layerVideo.currentTime || 0) - target) > tolerance) {
                            try {
                                layerVideo.currentTime = target;
                            } catch (error) {
                                console.warn('[akari-preview] layer seek failed', layer.id, error);
                            }
                        }
                    }
                    if (!isPlaying) {
                        if (!layerVideo.paused) layerVideo.pause();
                    } else if (layerVideo.paused) {
                        void layerVideo.play().catch(() => undefined);
                    }
                    if (layer.kind === 'baked') {
                        const hitRegionBucket = Math.floor(target * 4);
                        if (entry.hitRegionBucket !== hitRegionBucket) {
                            entry.hitRegionBucket = hitRegionBucket;
                            syncLayerHitRegion(entry, true);
                        }
                    }
                }
                if (anyKeyframeApplied && window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                for (const entry of filterEntries) {
                    const filter = entry.spec;
                    entry.element.style.display = !allTracksHiddenByScope.layers
                        && !hiddenTracksByScope.layers.has(filter.track)
                        && timelineTime >= filter.t
                        && timelineTime < filter.t + filter.duration ? 'block' : 'none';
                }
            };
            const renderCutLayerStyleVisual = timelineTime => {
                const segment = segments[activeSegmentIndex];
                if (!segment || !cutHasLayerStyleVisual(segment)) return;
                const localTime = Math.max(0, timelineTime - segment.outStart);
                applyCutKeyframesToMedia(video, segment, localTime);
                if (stillImage.style.display !== 'none') {
                    applyCutKeyframesToMedia(stillImage, segment, localTime);
                }
            };
            const applyCutsMuteState = () => {
                const segment = segments[activeSegmentIndex];
                applyCutsZIndex(segment);
                const cutsTrackMuted = Boolean(segment && segment.kind === 'src'
                    && (allTracksMutedByScope.cuts || mutedTracksByScope.cuts.has(segment.track)));
                const cutsTrackHidden = Boolean(segment && segment.kind === 'src'
                    && (allTracksHiddenByScope.cuts || hiddenTracksByScope.cuts.has(segment.track)));
                const globalMutedValue = String(globalMuted);
                if (video.dataset.akariGlobalMuted !== globalMutedValue) {
                    video.dataset.akariGlobalMuted = globalMutedValue;
                }
                const wantMuted = globalMuted || !isCutAudioAudibleFn(segment || {}, { muted: cutsTrackMuted });
                if (initial.kind === 'raw' && window.akari.rawAudioActive === true) {
                    if (!video.muted) video.muted = true;
                } else if (video.muted !== wantMuted) {
                    video.muted = globalMuted || !isCutAudioAudibleFn(segment || {}, { muted: cutsTrackMuted });
                }
                if (initial.kind === 'raw') window.akari.rawAudioSync?.();
                const segmentIsStill = isStillSegment(segment);
                video.style.visibility = !segment || segment.kind === 'gap' || segmentIsStill
                    || cutsTrackHidden ? 'hidden' : '';
                // 静止画の表示可否もここで一元管理する（トラック非表示・再生エラー時は隠す）。
                if (segmentIsStill && !cutsTrackHidden && !playbackErrored) {
                    showStillImage(stillUrlForSegment(segment));
                } else {
                    hideStillImage();
                }
            };
            const liveDom = (${createPreviewLiveDomController.toString()})({
                stage, layersStage, captionRows, layerEntries, video,
                computeAdjustCssVisual: computeAdjustCssVisualFn,
                next: (${nextPreviewLiveOverride.toString()})
            });
            let pendingShapeLive = null;
            const clearLiveOverride = () => {
                const pending = pendingShapeLive;
                if (!pending) { liveDom.clear(); return; }
                const saved = window.akari?.state?.summary?.overlays?.find(
                    overlay => String(overlay.id) === pending.id);
                if (saved?.html === pending.html) {
                    liveDom.adoptShapeBase?.(pending.key);
                    liveDom.clear();
                    const overlay = Array.from(stage.querySelectorAll('[data-overlay-id]'))
                        .find(element => element.dataset.overlayId === pending.id);
                    if (overlay && overlay.innerHTML !== pending.html) overlay.innerHTML = pending.html;
                    pendingShapeLive = null;
                } else {
                    liveDom.updateShape(pending.key, pending.html);
                }
            };
            window.akari.shapeLivePendingId = () => pendingShapeLive?.id;
            window.akari.shapeLivePendingHtml = () => pendingShapeLive?.html;
            window.akari.reconcileShapeLive = (id, savedHtml) => {
                const pending = pendingShapeLive;
                if (!pending || pending.id !== id) return;
                liveDom.adoptShapeBase(pending.key);
                if (savedHtml === pending.html) {
                    liveDom.clear();
                    pendingShapeLive = null;
                } else liveDom.updateShape(pending.key, pending.html);
            };
            const paintLiveOverride = () => liveDom.paint();
            const tick = (immediatePlaybackTick = false) => {
                if (typeof applyInitialPosition === 'function' && !initialPositionApplied) applyInitialPosition();
                const frameEngineClock = window.akari && window.akari.frameEngineClock;
                if (frameEngineClock) {
                    if (window.akari.previewPositionReady === true
                        && window.akari.previewSyncedFrameEngineClock !== frameEngineClock
                        && frameEngineClock.totalDuration > 0) {
                        outputTime = frameEngineClock.seek(outputTime, isPlaying);
                        window.akari.previewSyncedFrameEngineClock = frameEngineClock;
                    }
                    outputTime = frameEngineClock.tick(outputTime, isPlaying);
                    if (isPlaying && loopRange && outputTime >= loopRange.end) {
                        seekTimelineTime(loopRange.start);
                    }
                    renderLayers(outputTime);
                    if (typeof syncVideoCandidatePreview === 'function') syncVideoCandidatePreview(outputTime);
                    updateLayerSelectBox();
                    window.akari.runtime.tick(outputTime, isPlaying);
                    applyRequestedOverlaySelection();
                    window.akari.playbackTick(outputTime, isPlaying, immediatePlaybackTick);
                    window.akari.audioMeterTick(outputTime, isPlaying, immediatePlaybackTick);
                    renderCaption();
                    if (typeof paintLiveOverride === 'function') paintLiveOverride();
                    updateTransport();
                    updateGenerationOverlay(outputTime);
                    return;
                }
                // ㉕ cuts[].freeze の一時停止ホールド中（contract-2026-08-02-preview-parity.md
                // §2.4.3 の近似実装 — 尺は伸ばさない）: video / previewAudio を実時間で
                // 一時停止したまま outputTime を進めず、rAF の連鎖だけ生かしておく。
                if (freezeHoldUntilMs > 0) {
                    if (performance.now() < freezeHoldUntilMs) {
                        applyCutsMuteState();
                        return;
                    }
                    freezeHoldUntilMs = 0;
                    if (isPlaying) {
                        const resumedSegment = segments[activeSegmentIndex];
                        if (resumedSegment && isStillSegment(resumedSegment)) {
                            // 静止画セグメントは壁時計駆動のため、ホールドで止まっていた分だけ
                            // 原点を引き直す（video.play() は呼ばない — src が無いこともある）。
                            gapWallClockOriginMs = performance.now();
                            gapOutputOrigin = outputTime;
                        } else if (video.paused) {
                            void video.play().catch(error => console.error('[akari-preview] freeze hold の再開に失敗しました', error));
                        }
                        if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    }
                }
                const segment = segments[activeSegmentIndex];
                const segmentIsStill = isStillSegment(segment);
                if (segment && (segment.kind === 'gap' || segmentIsStill)) {
                    if (isPlaying) {
                        outputTime = clamp(
                            wallClockOutputTimeFn(
                                gapOutputOrigin, gapWallClockOriginMs, performance.now(), previewRate
                            ),
                            segment.outStart,
                            segment.outEnd
                        );
                        if (outputTime >= segment.outEnd - 0.0005) {
                            const nextIndex = activeSegmentIndex + 1;
                            if (nextIndex < segments.length) {
                                outputTime = segments[nextIndex].outStart;
                                enterSegment(nextIndex);
                            } else {
                                stopAtNaturalEnd();
                            }
                        } else if (segmentIsStill
                            && freezeHoldConsumedForSegmentIndex !== activeSegmentIndex) {
                            // ㉕ cuts[].freeze: 静止画では視覚的 no-op（契約 §3.2）だが、動画と同じ
                            // 「境界通過で一時停止ホールド」の近似は踏襲する（尺は伸ばさない）。
                            const freezeCheck = checkCutFreezeCrossingFn(segment.freeze, playedCutLocalSeconds(segment));
                            if (freezeCheck.shouldHold) {
                                freezeHoldConsumedForSegmentIndex = activeSegmentIndex;
                                freezeHoldUntilMs = performance.now()
                                    + freezeHoldMsFn(freezeCheck.holdSeconds, previewRate);
                                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                            }
                        }
                    }
                } else if (segment) {
                    outputTime = outputTimeForSourceClockFn(
                        segment,
                        video.currentTime,
                        outputTime,
                        !sourceSwapPending
                    );
                    if (!sourceSwapPending) applyKeepRangeBoundary();
                    const activeSegment = segments[activeSegmentIndex];
                    if (isPlaying && activeSegment && activeSegment.kind === 'src'
                        && freezeHoldConsumedForSegmentIndex !== activeSegmentIndex) {
                        const freezeCheck = checkCutFreezeCrossingFn(activeSegment.freeze, playedCutLocalSeconds(activeSegment));
                        if (freezeCheck.shouldHold) {
                            freezeHoldConsumedForSegmentIndex = activeSegmentIndex;
                            freezeHoldUntilMs = performance.now()
                                + freezeHoldMsFn(freezeCheck.holdSeconds, previewRate);
                            video.pause();
                            if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        }
                    }
                } else {
                    outputTime = video.currentTime || 0;
                }
                if (isPlaying && loopRange && outputTime >= loopRange.end) {
                    seekTimelineTime(loopRange.start);
                }
                renderCutLayerStyleVisual(outputTime);
                applyCutFramingVisual();
                preloadUpcomingTransition(outputTime);
                preloadUpcomingCut(outputTime);
                renderLayers(outputTime);
                if (typeof syncVideoCandidatePreview === 'function') syncVideoCandidatePreview(outputTime);
                updateLayerSelectBox();
                renderTransitionPlate(outputTime);
                window.akari.runtime.tick(outputTime, isPlaying);
                applyRequestedOverlaySelection();
                if (window.akari.previewAudio) {
                    window.akari.previewAudio.setMutedTracks(
                        mutedTracksByScope.audio, allTracksMutedByScope.audio
                    );
                    window.akari.previewAudio.tick(outputTime, isPlaying);
                }
                // タイムライン横軸と同じ出力秒（cuts ギャップレス連結後の秒）を送る（音声側も timelineTime で駆動済み）。
                window.akari.playbackTick(outputTime, isPlaying, immediatePlaybackTick);
                window.akari.audioMeterTick(outputTime, isPlaying, immediatePlaybackTick);
                renderCaption();
                if (typeof paintLiveOverride === 'function') paintLiveOverride();
                updateTransport();
                applyCutsMuteState();
                renderVideoFx(outputTime);
                updateGenerationOverlay(outputTime);
            };
            window.addEventListener('akari-overlay-remount-complete', () => {
                applyOverlayTracks();
                tick(true);
            });
            const runTickGuarded = () => {
                // A thrown exception here would otherwise abort animate()/the
                // watchdog callback before their requestAnimationFrame re-arm runs,
                // permanently killing the rAF self-chain (defense in depth -
                // real-data testing found no such exception, but tick() has many
                // data-dependent branches and this keeps any future one from being
                // fatal to playback).
                try {
                    tick();
                } catch (error) {
                    console.error('[akari-preview] tick failed; continuing animation loop', error);
                }
            };
            const animate = () => {
                lastTickAtMs = performance.now();
                runTickGuarded();
                if (isPlaying) animationFrame = requestAnimationFrame(animate);
            };
            const startAnimation = () => {
                cancelAnimationFrame(animationFrame);
                lastTickAtMs = performance.now();
                animationFrame = requestAnimationFrame(animate);
                window.clearInterval(animationWatchdogTimer);
                // rAF の連鎖が途切れると outputTime/シークバー/video が永久停止する一方、
                // previewAudio は壁時計駆動で鳴り続ける「片肺」状態になる（実機再現済み）。
                // rAF が生きている間は lastTickAtMs が毎フレーム更新されるため素通りする監視。
                animationWatchdogTimer = window.setInterval(() => {
                    if (!isPlaying) {
                        window.clearInterval(animationWatchdogTimer);
                        animationWatchdogTimer = 0;
                        return;
                    }
                    if (performance.now() - lastTickAtMs > captionPlaybackStallMsFn(document.visibilityState)) {
                        cancelAnimationFrame(animationFrame);
                        lastTickAtMs = performance.now();
                        runTickGuarded();
                        animationFrame = requestAnimationFrame(animate);
                    }
                }, 100);
            };
            const stopAnimation = () => {
                cancelAnimationFrame(animationFrame);
                animationFrame = 0;
                window.clearInterval(animationWatchdogTimer);
                animationWatchdogTimer = 0;
                tick(true);
            };
            const showPlaybackError = () => {
                playbackErrored = true;
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
                if (!frameEngineMediaIdle) video.pause();
                video.hidden = true;
                hideStillImage();
                layersStage.hidden = true;
                stage.hidden = true;
                captionLayer.textContent = ''; captionRows.clear();
                previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                previewMessageReload.hidden = false;
                previewMessage.hidden = false;
                playToggle.disabled = true;
                frameBack.disabled = true;
                frameForward.disabled = true;
                skipBack.disabled = true;
                skipForward.disabled = true;
                rateToggle.disabled = true;
                zoomToggle.disabled = true;
                fullscreenToggle.disabled = true;
                seek.disabled = true;
            };
            const restorePlayback = () => {
                if (!playbackErrored) return;
                playbackErrored = false;
                previewMessage.hidden = true;
                previewMessageReload.hidden = true;
                video.hidden = false;
                layersStage.hidden = false;
                stage.hidden = false;
                playToggle.disabled = false;
                frameBack.disabled = false;
                frameForward.disabled = false;
                skipBack.disabled = false;
                skipForward.disabled = false;
                rateToggle.disabled = false;
                zoomToggle.disabled = false;
                fullscreenToggle.disabled = false;
                seek.disabled = false;
                updateTransport();
                tick(true);
            };
            // task/2026-08-09-drop-hevc-proxy: showPlaybackError の直後、その動画で初めての
            // MEDIA_ERR_DECODE(3) / MEDIA_ERR_SRC_NOT_SUPPORTED(4) のときだけ呼ぶ。ホスト側で
            // 変換に成功すれば widget が丸ごとリロードされるため UI の後始末はせず、キューだけ
            // 進める。失敗時はエラー表示中の既存経路だけ通常のエラー文言に戻す。
            const processNextHevcFallback = () => {
                if (hevcFallbackInFlight || hevcFallbackQueue.length === 0) return;
                const request = hevcFallbackQueue.shift();
                hevcFallbackInFlight = true;
                if (playbackErrored) {
                    previewMessageText.textContent = '動画をそのまま再生できませんでした。互換用に変換しています…';
                    previewMessageReload.hidden = true;
                }
                window.akari.engine.resolveHevcFallback(request.errorCode, request.requestKey).then(() => {
                    // 成功応答はホスト側の ffmpeg 完了後に届くため、ここで次を送っても
                    // 変換は重ならず、webview の in-flight は常に 1 件に保たれる。
                    hevcFallbackInFlight = false;
                    processNextHevcFallback();
                }, () => {
                    if (playbackErrored) {
                        previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                        previewMessageReload.hidden = false;
                    }
                    hevcFallbackInFlight = false;
                    processNextHevcFallback();
                });
            };
            const attemptHevcFallback = (errorCode, videoUri) => {
                const requestKey = typeof videoUri === 'string' && videoUri ? videoUri : initial.videoUri;
                if (hevcFallbackRequested.has(requestKey)) return;
                hevcFallbackRequested.add(requestKey);
                hevcFallbackQueue.push({ errorCode, requestKey });
                processNextHevcFallback();
            };
            previewMessageReload.addEventListener('click', () => {
                if (!frameEngineMediaIdle) video.load();
            });
            let swapTrialToken;
            let swapTrialUserStopped = false;
            const reportSwapState = token => window.akari.reportSwapPlayback({
                type: 'akari-preview-swap-playback-state', token,
                playing: isPlaying && token === window.akari.swapTrialPlaybackToken, userStopped: swapTrialUserStopped
            });
            const stopSwapAutoplay = () => {
                swapTrialUserStopped = true;
                window.akari.reportSwapPlayback({ type: 'akari-preview-swap-user-control' });
            };
            playToggle.addEventListener('click', event => { if (event.isTrusted) stopSwapAutoplay(); }, true);
            const togglePlayback = () => {
                if (playToggle.disabled) return;
                if (!isPlaying) {
                    abortCurrentStroke();
                    abortCurrentRect();
                    isPlaying = true;
                    if (scrubAudio) scrubAudio.stop();
                    // 描画系ツール（pen/rect）は一時停止中のみ有効 -- select はそのまま維持する
                    // （select ツールは再生中もクリックへ intent を乗せる意味を持つため、mode 自体は
                    // pen/rect のときだけ neutral へ戻して host にも伝える。penModeActive/
                    // rectModeActive はどのモードでも isPlaying=true で false になるよう再計算する）。
                    if (reviewToolMode === 'pen' || reviewToolMode === 'rect') {
                        applyReviewToolMode('neutral');
                        window.akari.reviewSetToolMode('neutral');
                    } else {
                        setPenModeActive(false);
                        setRectModeActive(false);
                    }
                    window.akari.reviewTransport({ type: 'play', timelineT: outputTime });
                    if (window.akari.frameEngineClock) {
                        window.akari.frameEngineClock.play(outputTime);
                        startAnimation();
                        return;
                    }
                    if (frameEngineMediaIdle) {
                        startAnimation();
                        return;
                    }
                    if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    const segment = segments[activeSegmentIndex];
                    if (segment && (segment.kind === 'gap' || isStillSegment(segment))) {
                        // gap / 静止画セグメントからの再生開始は壁時計の原点を引き直すだけ
                        gapWallClockOriginMs = performance.now();
                        gapOutputOrigin = outputTime;
                        if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    } else {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                    startAnimation();
                } else {
                    isPlaying = false;
                    if (scrubAudio) scrubAudio.onPlaybackPaused();
                    // ㉕ 手動一時停止はフリーズホールドを打ち切る（保留中タイマーを引きずったまま
                    // 次の再開で誤って再一時停止しない — contract-2026-08-02-preview-parity.md §2.4.3）。
                    freezeHoldUntilMs = 0;
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                    if (window.akari.frameEngineClock) {
                        window.akari.frameEngineClock.pause(outputTime);
                        stopAnimation();
                        return;
                    }
                    if (frameEngineMediaIdle) {
                        stopAnimation();
                        return;
                    }
                    if (window.akari.previewAudio) window.akari.previewAudio.pause();
                    video.pause();
                    stopAnimation();
                }
            };
            restoreInitialPlayback = () => {
                if (!initialPlaybackRestorePending || !initialPositionApplied) return;
                const frameEngineClock = window.akari && window.akari.frameEngineClock;
                if (frameEngineMediaIdle && !frameEngineClock) return;
                // legacy video は currentTime 代入後の seeked を待つ。frame-engine ready は上で
                // restoredPosition の renderFrame 完了後にだけ発火するので、そのまま再開できる。
                if (frameEngineClock && previewStage.dataset.frameEngineReady !== 'true') return;
                if (!frameEngineClock && video.seeking) return;
                initialPlaybackRestorePending = false;
                if (!isPlaying) togglePlayback();
            };
            (${installPreviewFrameCapture.toString()})({
                pageId: initial.playbackPageId,
                send: message => window.akari.reportPreviewFrameCapture(message),
                freeze: () => {
                    let time = outputTime;
                    const resume = isPlaying;
                    if (isPlaying) togglePlayback();
                    let ready = Promise.resolve();
                    const clock = window.akari.frameEngineClock;
                    if (clock) {
                        // Already paused above: pin the clock without seek(), which would enqueue
                        // a second, timer-driven ScrubController render outside this ready promise.
                        clock.pause(time);
                        // Await this single same-summary render, then update the DOM captions/overlays.
                        // The controller waits for browser painting BEFORE applying capture CSS;
                        // gl.flush() completing here is not a canvas + DOM presentation fence.
                        ready = clock.refreshAdjustBypass().then(() => { tick(true); });
                    } else {
                        time = outputTime; // pause's tick reads the actual decoded video clock.
                    }
                    return { time, ready, resume: () => { if (resume && !isPlaying) togglePlayback(); } };
                }
            });
            const isEditable = (${isEditableEventTarget.toString()});
            const shouldStopEditableDeletionKeydownFn = (${shouldStopEditableDeletionKeydown.toString()});
            const isImeComposing = (${isImeCompositionKeydown.toString()});
            document.addEventListener('keydown', event => {
                if (shouldStopEditableDeletionKeydownFn(
                    event.target,
                    document.activeElement,
                    event.key,
                    event.metaKey,
                    event.ctrlKey,
                    isEditable
                )) {
                    event.stopPropagation();
                }
            }, true);
            const videoDuration = () => Number.isFinite(video.duration) ? video.duration : 0;
            const nudgeFrame = direction => {
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.frameEngineClock) window.akari.frameEngineClock.pause(outputTime);
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                if (!frameEngineMediaIdle) video.pause();
                seekTimelineTime(outputTime + direction / fps);
                notifyScrubSeek();
                stopAnimation();
            };
            const skipSeconds = seconds => {
                seekTimelineTime(outputTime + seconds);
                notifyScrubSeek();
                tick(true);
            };

            playToggle.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                togglePlayback();
            });
            frameBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(-1);
            });
            frameForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(1);
            });
            skipBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(-10);
            });
            skipForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(10);
            });
            // シークバー / host からの seek の間引き（2026-09-02 preview-perf）。
            // range の input はポインタ移動ごと（60〜120 回/s）に届き、その都度
            // seekTimelineTime（frame-engine では clock.seek → 再生中なら audioSupply.seek が Web Audio
            // グラフを丸ごと作り直す）+ フル tick()（可視の全 Three.js シーン・字幕・レイヤー）を同期
            // 実行していた。createRafThrottleFn で「1 フレームに最大 1 回・最後の値が勝つ」へ折りたたみ、
            // 確定（change / pointerup）では flush() で即時反映する。値は input 時に変数へ退避する
            // （実行時に seek.value を読むと、間に走った updateTransport() がフレーム量子化済みの旧位置を
            // 書き戻していることがある）。
            let pendingScrubTime = null;
            const scrubThrottle = createRafThrottleFn(() => {
                if (pendingScrubTime === null) return;
                const target = pendingScrubTime;
                pendingScrubTime = null;
                if (!initialPositionApplied) {
                    initialSeekTarget = target;
                    return;
                }
                seekTimelineTime(target);
                notifyScrubSeek();
                // 一時停止中の手動シークも host の位置正本へ必ず到達させる。通常 tick の 50 ms
                // throttle に最終ドラッグ値が落とされると、直後の編集で一つ前の位置へ戻ってしまう。
                tick(true);
            });
            const requestScrub = timelineValue => {
                pendingScrubTime = timelineValue;
                scrubThrottle.call();
            };
            // ドラッグ中の音声: 再生中にドラッグを始めたら canonical な togglePlayback() で 1 回だけ
            // 一時停止し（frame-engine: clock.pause → audioSupply.pause / 従来: previewAudio.pause +
            // video.pause）、ドラッグ中の各フレームは clock.seek(t, isPlaying=false) = audioSupply は
            // stopSources() だけで音声グラフを作り直さない。離した時点で最終位置を flush してから
            // togglePlayback() で再開する（clock.play(outputTime) → audioSupply.playFrom = 音声グラフの
            // 構築はドラッグ全体で 1 回）。isPlaying 自体を倒すのは、tick() → clock.tick(outputTime,
            // isPlaying) が isPlaying=true のままだと毎フレーム setPlaying(true) で音声を復活させて
            // しまうため（clock 側は frameEngineBootstrapScript の管轄で、ここからは呼ぶだけ）。
            let scrubDragActive = false;
            let scrubDragResumePlaying = false;
            const beginScrubDrag = () => {
                if (scrubDragActive) return;
                scrubDragActive = true;
                scrubDragResumePlaying = isPlaying;
                if (isPlaying) togglePlayback();
            };
            const endScrubDrag = () => {
                if (!scrubDragActive) return;
                scrubThrottle.flush();
                scrubDragActive = false;
                const resume = scrubDragResumePlaying && !isPlaying;
                scrubDragResumePlaying = false;
                if (resume) togglePlayback();
            };
            const renderPreviewRate = () => {
                const label = formatPreviewRateLabelFn(previewRate);
                rateToggle.textContent = label;
                rateValue.textContent = label;
                for (const preset of document.querySelectorAll('.rate-preset[data-rate]')) {
                    const value = Number(preset.getAttribute('data-rate'));
                    preset.setAttribute('aria-pressed', String(Math.abs(value - previewRate) <= 1e-9));
                }
            };
            const setPreviewPlaybackRate = value => {
                const nextRate = clampPreviewPlaybackRate(value);
                if (!previewRatePresets.includes(nextRate) || nextRate === previewRate) {
                    renderPreviewRate();
                    return;
                }
                const previousRate = previewRate;
                const now = performance.now();
                const segment = segments[activeSegmentIndex];
                if (!window.akari.frameEngineClock
                    && segment && (segment.kind === 'gap' || isStillSegment(segment))) {
                    if (isPlaying) {
                        outputTime = clamp(
                            wallClockOutputTimeFn(gapOutputOrigin, gapWallClockOriginMs, now, previousRate),
                            segment.outStart,
                            segment.outEnd
                        );
                    }
                    gapOutputOrigin = outputTime;
                    gapWallClockOriginMs = now;
                } else if (!window.akari.frameEngineClock && segment && segment.kind === 'src') {
                    // playbackRate を変える前の media clock を現在位置へ写し、次の tick で
                    // 最後に描画した位置へ巻き戻らないようにする。
                    outputTime = outputTimeForSourceClockFn(
                        segment,
                        video.currentTime,
                        outputTime,
                        !sourceSwapPending
                    );
                }
                if (freezeHoldUntilMs > now) {
                    const remainingTimelineSeconds = (freezeHoldUntilMs - now) / 1000 * previousRate;
                    freezeHoldUntilMs = now + freezeHoldMsFn(remainingTimelineSeconds, nextRate);
                }
                previewRate = nextRate;
                window.akari.previewPlaybackRate = previewRate;
                const frameEngineClock = window.akari.frameEngineClock;
                if (frameEngineClock) {
                    outputTime = frameEngineClock.setRate(previewRate);
                } else {
                    syncSegmentPlaybackRate();
                    renderTransitionPlate(outputTime);
                    renderLayers(outputTime);
                    if (window.akari.previewAudio) {
                        void window.akari.previewAudio.setRate(previewRate, outputTime, isPlaying);
                    }
                }
                window.akari.persistPlaybackRate(previewRate);
                window.akari.reviewTransport({ type: 'rate', value: previewRate, timelineT: outputTime });
                renderPreviewRate();
                tick(true);
            };
            renderPreviewRate();
            rateToggle.addEventListener('click', () => {
                ratePopup.hidden = !ratePopup.hidden;
                rateToggle.setAttribute('aria-expanded', String(!ratePopup.hidden));
                if (!ratePopup.hidden) {
                    zoomPopup.hidden = true;
                    zoomToggle.setAttribute('aria-expanded', 'false');
                }
            });
            for (const preset of document.querySelectorAll('.rate-preset[data-rate]')) {
                preset.addEventListener('click', () => {
                    setPreviewPlaybackRate(Number(preset.getAttribute('data-rate')));
                    ratePopup.hidden = true;
                    rateToggle.setAttribute('aria-expanded', 'false');
                });
            }
            zoomToggle.addEventListener('click', () => {
                zoomPopup.hidden = !zoomPopup.hidden;
                zoomToggle.setAttribute('aria-expanded', String(!zoomPopup.hidden));
                if (!zoomPopup.hidden) {
                    ratePopup.hidden = true;
                    rateToggle.setAttribute('aria-expanded', 'false');
                }
            });
            indicatorToggle.addEventListener('click', () => {
                indicatorPopup.hidden = !indicatorPopup.hidden;
                indicatorToggle.setAttribute('aria-expanded', String(!indicatorPopup.hidden));
            });
            indicatorToggle.addEventListener('mouseenter', () => {
                indicatorPopup.hidden = false;
                indicatorToggle.setAttribute('aria-expanded', 'true');
            });
            zoomSlider.addEventListener('input', () => setZoom(sliderToZoom(Number(zoomSlider.value))));
            zoomSlider.addEventListener('dblclick', () => { pan = { x: 0, y: 0 }; setZoom(1); });
            for (const preset of document.querySelectorAll('.zoom-preset')) {
                preset.addEventListener('click', () => {
                    const value = Number(preset.getAttribute('data-zoom'));
                    if (value === 1) pan = { x: 0, y: 0 };
                    setZoom(value);
                });
            }
            // capture 段で登録: パン開始の stopPropagation（ズーム中の previewPane pointerdown）に
            // 外側クリック検知が殺されないようにする
            document.addEventListener('pointerdown', event => {
                if (!zoomPopup.hidden && !event.target.closest('.transport-right')) {
                    zoomPopup.hidden = true;
                    zoomToggle.setAttribute('aria-expanded', 'false');
                }
                if (!ratePopup.hidden && !event.target.closest('.transport-right')) {
                    ratePopup.hidden = true;
                    rateToggle.setAttribute('aria-expanded', 'false');
                }
                if (!indicatorPopup.hidden && !event.target.closest('.transport-left')) {
                    indicatorPopup.hidden = true;
                    indicatorToggle.setAttribute('aria-expanded', 'false');
                }
            }, true);
            previewPane.addEventListener('wheel', event => {
                if (event.ctrlKey) {
                    event.preventDefault();
                    const factor = Math.exp(-event.deltaY * 0.01);
                    const nextZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
                    const bounds = previewPane.getBoundingClientRect();
                    pan = computePinchPan(pan, { x: event.clientX - bounds.left - bounds.width / 2,
                        y: event.clientY - bounds.top - bounds.height / 2 }, zoom, nextZoom);
                    setZoom(nextZoom);
                    return;
                }
                const target = event.target;
                if (target instanceof Element && target.closest('.transport-controls, #zoom-popup, #rate-popup, #indicator-popup, input, textarea, select, [role="slider"]')) return;
                for (let node = target instanceof Element ? target : null; node && node !== previewPane; node = node.parentElement) {
                    if (node.isContentEditable) continue;
                    const style = getComputedStyle(node);
                    if ((/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
                        || (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth)) return;
                }
                event.preventDefault();
                const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? previewPane.clientHeight : 1;
                pan = clampPan({ x: pan.x - event.deltaX * unit, y: pan.y - event.deltaY * unit });
                renderZoom();
            }, { passive: false });
            const isDirectManipulationTarget = (target, pointerEvent) => {
                if (!(target instanceof Element)) return false;
                if (target.closest('[data-overlay-id], [data-akari-interaction], .caption-row-plate, '
                    + '#layer-select-box, #layer-crop-box, #layer-crop-toggle, '
                    + '#layer-perspective-toggle, #layer-perspective-panel, #cut-select-box, #caption-select-box')) {
                    return true;
                }
                const layer = target.closest('[data-akari-layer-id]');
                if (layer && layer.dataset.akariLayerId === selectedLayerId) return true;
                if (frameEngineMediaIdle && pointerEvent && (target === previewStage || target?.id === 'frame-engine-canvas')) return Boolean(findVisualMediaHitAt(pointerEvent));
                return cutSelected && (target === video || target === stillImage);
            };
            previewPane.addEventListener('pointerdown', event => {
                if ((typeof motionDraw !== 'undefined' && motionDraw) || penModeActive || zoom <= 1.05 || event.button !== 0) return;
                if (window.akari.shouldStartPreviewMarquee?.(event)) return;
                // ズーム中のパン開始判定は capture 段で previewPane 配下の pointerdown を扱う。
                // 奪っていたため、audio-notice の × 等インタラクティブ操作系の上で押しても
                // preventDefault() が click 合成を止めてしまい押せなくなっていた（実測: Chromium は
                // pointerdown.preventDefault() を呼ぶと後続の click を合成しない）。ボタンに加え、
                // 選択済みレイヤー/カット・オーバーレイの直接操作面も素通しする。
                // Alt+drag は要素の複製として届ける。
                if (event.target.closest && event.target.closest('button, [role="button"], input, textarea, select, a[href]')) return;
                if (isDirectManipulationTarget(event.target, event)) return;
                event.preventDefault();
                event.stopPropagation();
                previewPane.setPointerCapture(event.pointerId);
                drag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    base: { x: pan.x, y: pan.y },
                    didMove: false
                };
            }, true);
            previewPane.addEventListener('pointermove', event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (!drag.didMove && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
                    drag.didMove = true;
                    previewPane.classList.add('is-dragging');
                }
                if (!drag.didMove) return;
                pan = clampPan({ x: drag.base.x + dx, y: drag.base.y + dy });
                renderZoom();
            }, true);
            const finishPan = event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const didMove = drag.didMove;
                drag = null;
                previewPane.classList.remove('is-dragging');
                if (previewPane.hasPointerCapture(event.pointerId)) previewPane.releasePointerCapture(event.pointerId);
                if (didMove) suppressClick = true;
            };
            previewPane.addEventListener('pointerup', finishPan, true);
            previewPane.addEventListener('pointercancel', finishPan, true);
            previewPane.addEventListener('click', event => {
                if (!suppressClick) return;
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            fullscreenToggle.addEventListener('click', () => {
                void window.akari.toggleFullscreen().catch(error => console.error('[akari-preview] fullscreen failed', error));
            });
            // Playback-click edit region: window capture precedes interaction.js document capture regardless of registration order.
            // Freeze the target before the document/element selection handlers run.
            // Finish after pointerup/click, including blank canvas hits and cancelled gestures.
            let playbackSelectionPointer = null;
            window.addEventListener('pointerdown', event => {
                if ((typeof motionDraw !== 'undefined' && motionDraw) || !isPlaying || event.button !== 0 || event.altKey || penModeActive || rectModeActive
                    || !(event.target instanceof Element)
                    || event.target.closest('button, [role="button"], input, textarea, select, a[href], [contenteditable="true"]')) return;
                const onSurface = previewStage.contains(event.target)
                    || isDirectManipulationTarget(event.target, event);
                if (!onSurface) return;
                togglePlayback();
                if (!isPlaying) playbackSelectionPointer = event.pointerId;
            }, true);
            const finishPlaybackSelection = event => {
                if (playbackSelectionPointer !== event.pointerId) return;
                playbackSelectionPointer = null;
                setTimeout(() => {
                    const selected = window.akari.interaction?.selectedId || selectedLayerId
                        || selectedCaptionId || cutSelected;
                    if (!selected && !isPlaying) togglePlayback();
                }, 0);
            };
            window.addEventListener('pointerup', finishPlaybackSelection, true);
            window.addEventListener('pointercancel', finishPlaybackSelection, true);
            // 全画面状態の正本はホスト（akari-preview-fullscreen-state で通知される）。ボタン表示は
            // その通知でだけ切り替える。旧実装の document.fullscreenchange はこの webview では
            // 発火し得ない（sandbox に allowfullscreen が無い）ため廃止。
            let hostFullscreenActive = false;
            const applyHostFullscreenState = active => {
                hostFullscreenActive = Boolean(active);
                fullscreenToggle.setAttribute('aria-pressed', String(hostFullscreenActive));
                fullscreenToggle.setAttribute('aria-label', hostFullscreenActive ? '全画面解除' : '全画面');
                fullscreenToggle.title = hostFullscreenActive ? '全画面解除' : '全画面';
                fullscreenToggle.innerHTML = hostFullscreenActive ? restoreIcon : fullscreenIcon;
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-fullscreen-state') {
                    applyHostFullscreenState(message.active);
                }
            });
            // 操作中の Escape は既存の取消処理へ渡し、通常時は選択を 1 段だけ解除する。
            window.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || !event.isTrusted || event.defaultPrevented
                    || cropModeActive || perspectivePanelOpen || selectionDragActive || drag
                    || scrubDragActive || activeCaptionEdit) return;
                if (selectedCaptionId) deselectCaption();
                else if (selectedLayerId) selectLayer(null);
                else if (cutSelected) deselectCut();
                else return;
                event.preventDefault();
                event.stopPropagation();
                // 同じ window の capture リスナー（全画面等）にも、この打鍵を渡さない。
                event.stopImmediatePropagation();
            }, true);
            // 選択が無い場合は Escape で元のレイアウトへ戻す。isTrusted 必須 — オーバーレイ選択解除が
            // 合成 Escape（applyRequestedOverlaySelection の dispatchEvent）を window に流すため、
            // それで全画面が解除されてしまうのを防ぐ。capture でオーバーレイ側の Escape 処理より
            // 先に拾う（上の選択解除が消費した打鍵はここへ届かない）。
            window.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || !event.isTrusted || !hostFullscreenActive) return;
                event.preventDefault();
                event.stopPropagation();
                window.akari.exitFullscreen();
            }, true);
            // isEditable だけでは IME 変換中のスペースを止められない（issue #51）。変換候補を送る
            // スペースで再生が走ると、日本語入力のたびにプレビューが動いて制作が中断される。
            window.addEventListener('keydown', event => {
                if (event.repeat || isImeComposing(event)
                    || (event.code !== 'Space' && event.key !== ' ')
                    || isEditable(event.target)
                    || isEditable(document.activeElement)
                    || playToggle.disabled) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                clearStaticAnnotationStrokes();
                if (event.isTrusted) stopSwapAutoplay();
                togglePlayback();
            }, true);
            // range の input はポインタ押下中にもキー操作でも届くため、pointerdown 〜 pointerup /
            // pointercancel（要素外で離した場合は window 側で拾う）の間だけ「ドラッグ」として扱い、
            // キー操作（矢印キー等）は従来どおり 1 回ごとに即時反映する。
            let seekPointerHeld = false;
            seek.addEventListener('pointerdown', () => {
                seekPointerHeld = true;
            });
            const releaseSeekPointer = () => {
                if (!seekPointerHeld) return;
                seekPointerHeld = false;
                endScrubDrag();
            };
            seek.addEventListener('pointerup', releaseSeekPointer);
            seek.addEventListener('pointercancel', releaseSeekPointer);
            seek.addEventListener('lostpointercapture', releaseSeekPointer);
            window.addEventListener('pointerup', releaseSeekPointer, true);
            window.addEventListener('pointercancel', releaseSeekPointer, true);
            seek.addEventListener('input', () => {
                // beginScrubDrag() → togglePlayback() → stopAnimation() → tick() → updateTransport() が
                // seek.value を旧位置で書き戻すので、その前に読む。
                const value = Number(seek.value);
                clearStaticAnnotationStrokes();
                const startingDrag = seekPointerHeld && !scrubDragActive;
                if (startingDrag) beginScrubDrag();
                requestScrub(value);
                // ドラッグ開始フレームとキー操作は即時反映（間引くのはドラッグ中の連続 input だけ）。
                if (startingDrag || !seekPointerHeld) scrubThrottle.flush();
            });
            seek.addEventListener('change', () => {
                // change = ポインタを離した時 / キー操作の確定時。保留中の位置を即反映し、ドラッグなら
                // 再生を戻す（pointerup 側と二重に呼ばれても endScrubDrag は冪等）。
                scrubThrottle.flush();
                endScrubDrag();
            });
            let requestedOverlayId;
            let applyingOverlaySelection;
            const applyRequestedOverlaySelection = () => {
                if (requestedOverlayId === undefined) return;
                if (window.akari.interaction?.hasSelectionTree) {
                    window.akari.interaction.selectFromTimeline(requestedOverlayId);
                    return;
                }
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedId === requestedOverlayId
                    && (!selectedId || stage.querySelector('[data-akari-interaction="selection-frame"]'))) return;
                if (requestedOverlayId === null) {
                    if (selected) {
                        window.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
                        }));
                    }
                    return;
                }
                const target = Array.from(stage.querySelectorAll('[data-overlay-id]'))
                    .find(candidate => candidate.getAttribute('data-overlay-id') === requestedOverlayId);
                if (!target || getComputedStyle(target).visibility === 'hidden') return;
                const fragment = Array.from(target.children)
                    .find(candidate => !candidate.hasAttribute('data-akari-interaction'));
                const rect = (fragment || target).getBoundingClientRect();
                applyingOverlaySelection = requestedOverlayId;
                target.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
                queueMicrotask(() => { applyingOverlaySelection = undefined; });
            };
            const generationOverlay = document.getElementById('akari-gen-overlay');
            const generationPip = document.getElementById('akari-gen-pip');
            const generationPipImage = document.getElementById('akari-gen-pip-image');
            const generationBlur = document.getElementById('akari-gen-blur');
            const generationBlurImage = document.getElementById('akari-gen-blur-image');
            const generationShimmer = document.getElementById('akari-gen-shimmer');
            const generationIcon = document.getElementById('akari-gen-icon');
            const generationMask = document.getElementById('akari-gen-mask');
            const generationTag = document.getElementById('akari-gen-tag');
            const generationBand = document.getElementById('akari-gen-band');
            const generationBandText = document.getElementById('akari-gen-band-text');
            const generationBandBar = document.getElementById('akari-gen-band-bar');
            const generationBandFill = document.getElementById('akari-gen-band-fill');
            let generationTagText = '';
            let generationElapsedStartedAt = null;
            if (typeof window.setInterval === 'function') {
                const generationElapsedTicker = window.setInterval(() => {
                    if (!generationOverlay || generationOverlay.hidden || !Number.isFinite(generationElapsedStartedAt)) return;
                    generationBandText.textContent = '生成中 · ' + Math.max(0,
                        Math.floor((Date.now() - generationElapsedStartedAt) / 1000)) + ' 秒';
                }, 1000);
                if (typeof generationElapsedTicker?.unref === 'function') generationElapsedTicker.unref();
            }
            // 出力座標系は維持し、札と文字だけを画面 px に戻す。layersStage の実測は
            // updateStageScale の frameScale と外側 zoom-layer の倍率の両方を含む。
            const updateGenerationOverlayLayout = () => {
                if (!generationOverlay || generationOverlay.hidden) return;
                const scale = layersStage.getBoundingClientRect().width / layersStage.offsetWidth;
                if (!Number.isFinite(scale) || scale <= 0) return;
                generationOverlay.style.setProperty('--akari-gen-inv-scale', String(1 / scale));
                generationOverlay.style.setProperty('--akari-gen-band-space', generationBand.hidden ? '0px' : '26px');
                generationTag.textContent = generationTagText;
                if (generationTagText.startsWith('▶ 動画予定') && generationTag.scrollWidth > generationTag.clientWidth) {
                    generationTag.textContent = '▶ 動画予定';
                }
            };
            if (generationOverlay) window.akari.updateGenerationOverlayLayout = updateGenerationOverlayLayout;
            let generationClips = [];
            const generationExtras = new Map();
            let generationExportLook = typeof initial !== 'undefined' && initial.exportLook === true;
            const hideGenerationOverlay = () => {
                if (!generationOverlay) return;
                for (const extra of generationExtras.values()) extra.remove();
                generationExtras.clear();
                generationOverlay.hidden = true;
                generationPip.hidden = true;
                generationBlur.hidden = true;
                generationPipImage.removeAttribute('src');
                generationBlurImage.removeAttribute('src');
                generationShimmer.hidden = true;
                if (generationIcon) generationIcon.hidden = true;
                generationElapsedStartedAt = null;
                delete generationOverlay.dataset.akariGenAurora;
                delete generationOverlay.dataset.akariGenMedia;
                generationMask.hidden = true;
                generationTag.hidden = true;
                generationBand.hidden = true;
            };
            const updateGenerationOverlay = timelineTime => {
                if (!generationOverlay) return;
                if (generationExportLook) {
                    hideGenerationOverlay();
                    return;
                }
                const firstClip = generationClips.find(candidate => Number.isFinite(candidate.start)
                    && Number.isFinite(candidate.end) && candidate.start <= timelineTime && timelineTime < candidate.end);
                if (!firstClip) {
                    hideGenerationOverlay();
                    return;
                }
                if ((window.akari.stillCandidatePreviewItemId === String(firstClip.id)
                    || typeof videoCandidatePreview !== 'undefined' && videoCandidatePreview?.itemId === String(firstClip.id))
                    && generationClips.filter(candidate => Number.isFinite(candidate.start)
                        && Number.isFinite(candidate.end) && candidate.start <= timelineTime && timelineTime < candidate.end).length === 1) {
                    hideGenerationOverlay();
                    return;
                }
                const active = generationOverlaysAtTimeFn(generationClips, timelineTime, candidate => {
                    const candidateState = resolveGenerationStateFn(candidate.meta, Date.now(), candidate.binding, resolveGenerationStateV1);
                    return describeOverlayFn(candidateState, candidate.meta, String(candidate.name || candidate.id || ''), {
                        sourcePath: typeof candidate.sourcePath === 'string' ? candidate.sourcePath : undefined,
                        localTimeSec: timelineTime - candidate.start,
                        clipDurationSec: candidate.end - candidate.start
                    }, describeNextDraftV1);
                }, candidate => window.akari.stillCandidatePreviewItemId === String(candidate.id)
                    || typeof videoCandidatePreview !== 'undefined' && videoCandidatePreview?.itemId === String(candidate.id));
                const clip = active[0]?.clip;
                if (!clip) { hideGenerationOverlay(); return; }
                const state = resolveGenerationStateFn(clip.meta, Date.now(), clip.binding, resolveGenerationStateV1);
                const description = describeOverlayFn(state, clip.meta, String(clip.name || clip.id || ''), {
                    sourcePath: typeof clip.sourcePath === 'string' ? clip.sourcePath : undefined,
                    localTimeSec: timelineTime - clip.start,
                    clipDurationSec: clip.end - clip.start
                }, describeNextDraftV1);
                if (description.tag === null && description.band === null
                    && !description.shimmer && !description.aurora && !description.maskRect && !description.pip && !description.blurBackground) {
                    hideGenerationOverlay();
                    return;
                }
                generationOverlay.hidden = false;
                generationOverlay.dataset.akariGenAurora = description.aurora || '';
                generationOverlay.dataset.akariGenMedia = clip.kind || 'visual';
                if (generationIcon) generationIcon.textContent = clip.kind === 'audio' ? '♫' : '✦';
                const transform = clip.transform || {};
                const crop = clip.crop || {};
                const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
                const stageWidth = layersStage.offsetWidth;
                const stageHeight = layersStage.offsetHeight;
                const scale = Math.max(.01, finite(transform.scale, 1));
                // layer-style の実描画は素材の自然寸法 × crop × scale。V1 cut の
                // フレーム寸法とは基準が異なるため、同じ layer DOM から寸法を取る。
                const layerMedia = clip.kind === 'layer'
                    ? Array.from(layersStage.querySelectorAll('[data-akari-layer-id]'))
                        .find(media => media.dataset.akariLayerId === String(clip.id)) : null;
                const naturalWidth = Number(layerMedia?.videoWidth || layerMedia?.naturalWidth);
                const naturalHeight = Number(layerMedia?.videoHeight || layerMedia?.naturalHeight);
                const sourceWidth = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : stageWidth;
                const sourceHeight = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : stageHeight;
                const boxWidth = clip.kind === 'audio' ? stageWidth * .7
                    : sourceWidth * Math.max(.01, finite(crop.w, 1)) * Math.max(.01, finite(transform.scaleX, scale));
                const boxHeight = clip.kind === 'audio' ? stageHeight * .34
                    : sourceHeight * Math.max(.01, finite(crop.h, 1)) * Math.max(.01, finite(transform.scaleY, scale));
                generationOverlay.style.left = (stageWidth / 2 + finite(transform.x, 0) - boxWidth / 2) + 'px';
                generationOverlay.style.top = (stageHeight / 2 + finite(transform.y, 0) - boxHeight / 2) + 'px';
                generationOverlay.style.width = boxWidth + 'px';
                generationOverlay.style.height = boxHeight + 'px';
                generationOverlay.style.transform = 'rotate(' + (finite(transform.rotate, 0)
                    + (clip.kind === 'layer' ? finite(crop.rotate, 0) : 0)) + 'deg)';
                function updateExtras() {
                const extraIds = new Set();
                for (const entry of active.slice(1)) {
                    const other = entry.clip;
                    const key = String(other.id);
                    extraIds.add(key);
                    let extra = generationExtras.get(key);
                    if (!extra) {
                        extra = document.createElement('div');
                        extra.className = 'akari-gen-extra';
                        extra.setAttribute('aria-hidden', 'true');
                        extra.innerHTML = '<span class="akari-gen-extra-icon">✦</span><span class="akari-gen-extra-tag"></span>';
                        generationOverlay.parentNode.appendChild(extra);
                        generationExtras.set(key, extra);
                    }
                    extra.dataset.akariGenAurora = entry.description.aurora || '';
                    extra.dataset.akariGenMedia = other.kind || 'visual';
                    extra.querySelector('.akari-gen-extra-icon').textContent = other.kind === 'audio' ? '♫' : '✦';
                    extra.querySelector('.akari-gen-extra-tag').textContent = entry.description.tag || '';
                    const otherTransform = other.transform || {};
                    const otherCrop = other.crop || {};
                    const otherScale = Math.max(.01, finite(otherTransform.scale, 1));
                    const otherMedia = other.kind === 'layer'
                        ? Array.from(layersStage.querySelectorAll('[data-akari-layer-id]'))
                            .find(media => media.dataset.akariLayerId === key) : null;
                    const otherWidth = Number(otherMedia?.videoWidth || otherMedia?.naturalWidth);
                    const otherHeight = Number(otherMedia?.videoHeight || otherMedia?.naturalHeight);
                    const otherBoxWidth = other.kind === 'audio' ? stageWidth * .7
                        : (Number.isFinite(otherWidth) && otherWidth > 0 ? otherWidth : stageWidth)
                            * Math.max(.01, finite(otherCrop.w, 1)) * Math.max(.01, finite(otherTransform.scaleX, otherScale));
                    const otherBoxHeight = other.kind === 'audio' ? stageHeight * .34
                        : (Number.isFinite(otherHeight) && otherHeight > 0 ? otherHeight : stageHeight)
                            * Math.max(.01, finite(otherCrop.h, 1)) * Math.max(.01, finite(otherTransform.scaleY, otherScale));
                    extra.style.left = (stageWidth / 2 + finite(otherTransform.x, 0) - otherBoxWidth / 2) + 'px';
                    extra.style.top = (stageHeight / 2 + finite(otherTransform.y, 0) - otherBoxHeight / 2) + 'px';
                    extra.style.width = otherBoxWidth + 'px';
                    extra.style.height = otherBoxHeight + 'px';
                    extra.style.transform = 'rotate(' + (finite(otherTransform.rotate, 0)
                        + (other.kind === 'layer' ? finite(otherCrop.rotate, 0) : 0)) + 'deg)';
                    const displayScale = layersStage.getBoundingClientRect().width / layersStage.offsetWidth;
                    if (Number.isFinite(displayScale) && displayScale > 0) {
                        extra.style.setProperty('--akari-gen-inv-scale', String(1 / displayScale));
                    }
                }
                for (const [key, extra] of generationExtras) {
                    if (!extraIds.has(key)) { extra.remove(); generationExtras.delete(key); }
                }
                }
                const setGenerationImage = (container, image, path, uri) => {
                    container.hidden = !path || typeof uri !== 'string' || !uri;
                    if (container.hidden) image.removeAttribute('src');
                    else if (image.getAttribute('src') !== uri) image.setAttribute('src', uri);
                };
                updateExtras();
                setGenerationImage(generationPip, generationPipImage, description.pip, clip.pipUri);
                setGenerationImage(generationBlur, generationBlurImage, description.blurBackground, clip.blurBackgroundUri);
                generationTag.hidden = description.tag === null;
                generationTagText = description.tag || '';
                if (state === 'failed') generationTag.dataset.akariGenSeverity = 'error';
                else if (clip.meta && clip.meta.kind === 'frames') generationTag.dataset.akariGenSeverity = 'frames';
                else if (state === 'generating') generationTag.dataset.akariGenSeverity = 'generating';
                else if (description.tag?.startsWith('▶ 動画予定')) generationTag.dataset.akariGenSeverity = 'planned-video';
                else delete generationTag.dataset.akariGenSeverity;
                generationBand.hidden = description.band === null;
                generationBandText.textContent = description.band?.text || '';
                const startedAt = Date.parse(String(clip.meta?.job?.started_at || ''));
                generationElapsedStartedAt = /^生成中 · [0-9]+ 秒$/u.test(description.band?.text || '')
                    && Number.isFinite(startedAt) ? startedAt : null;
                const progress = description.band?.progress;
                generationBandBar.hidden = progress === null || progress === undefined;
                generationBandFill.style.width = progress === null || progress === undefined
                    ? '0%' : (Math.max(0, Math.min(1, progress)) * 100) + '%';
                generationShimmer.hidden = !description.shimmer;
                if (generationIcon) generationIcon.hidden = description.aurora !== 'generating'
                    && !(clip.kind !== 'audio' && description.aurora === 'planned');
                generationMask.hidden = description.maskRect === null;
                if (description.maskRect) {
                    generationMask.style.left = (description.maskRect.x * 100) + '%';
                    generationMask.style.top = (description.maskRect.y * 100) + '%';
                    generationMask.style.width = (description.maskRect.w * 100) + '%';
                    generationMask.style.height = (description.maskRect.h * 100) + '%';
                }
                updateGenerationOverlayLayout();
            };
            const onMainVideoLoadedMetadata = event => {
                if (event.currentTarget !== video) return;
                void sfxDurationsReady.then(() => {
                    restorePlayback();
                    rebuildSegments();
                    applyInitialPosition();
                    restoreInitialPlayback();
                    updateTransport();
                });
            };
            const onMainVideoCanPlay = event => {
                if (event.currentTarget === video) restorePlayback();
            };
            const onMainVideoPlay = event => {
                if (event.currentTarget !== video) return;
                if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                if (isPlaying) startAnimation();
            };
            const onMainVideoAudioNoticePlay = event => {
                if (event.currentTarget !== video) return;
                const playingVideo = event.currentTarget;
                // 無音素材の検知は 1 ドキュメントにつき 1 回だけ。判定は ffprobe による
                // ソースファイルの実測（initial.hasSourceAudio、node 側 probeAudioPresence）を
                // 正とする — webkitAudioDecodedByteCount はこのアプリが同梱する
                // Electron/Chromium では常に 0 のまま張り付き（実測確認済み）、実際に音声が
                // 再生されているソースでも誤検出する。hasSourceAudio が null（ffprobe 不在・
                // 失敗で未確定）のときは、確証が無いまま出すと偽陽性の原因になるため表示しない。
                window.setTimeout(() => {
                    if (playingVideo !== video || audioNoticeShown || video.paused || video.ended) return;
                    if (initial.hasSourceAudio === false) {
                        audioNoticeShown = true;
                        audioNotice.hidden = false;
                    }
                }, 1500);
            };
            const onMainVideoPause = event => {
                if (event.currentTarget !== video) return;
                if (pausedForGapEntry) {
                    pausedForGapEntry = false;
                    window.akari.playbackTick(outputTime, isPlaying, true);
                    window.akari.audioMeterTick(outputTime, isPlaying, true);
                    return;
                }
                // Every intentional pause call site (togglePlayback's stop branch,
                // nudgeFrame, stopAtNaturalEnd, showPlaybackError) flips isPlaying
                // to false *before* calling video.pause(), so isPlaying still being
                // true here means the browser paused the element on its own -
                // observed reliably as a single spurious native pause ~0.3-0.8s
                // into the first playback of a large (100s+ MB) source.mp4 right
                // after a fresh <video> load (e.g. every full webview reload
                // triggered by an edit.json save while playing). Tearing down the
                // animation/audio loop here would leave the raw <video> decoding
                // ungoverned by tick() while previewAudio keeps its own independent
                // schedule - the "video/seekbar stuck, audio still going" freeze.
                // Resume instead; if that also fails, fall back to a real stop.
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src' && !isStillSegment(segment) && !video.ended) {
                    window.akari.playbackTick(outputTime, true, true);
                    window.akari.audioMeterTick(outputTime, true, true);
                    void video.play().catch(error => {
                        console.error('[akari-preview] unexpected pause auto-resume failed', error);
                        window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                        isPlaying = false;
                        window.akari.playbackTick(outputTime, false, true);
                        window.akari.audioMeterTick(outputTime, false, true);
                        if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        stopAnimation();
                    });
                    return;
                }
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                window.akari.playbackTick(outputTime, false, true);
                window.akari.audioMeterTick(outputTime, false, true);
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            };
            const onMainVideoEnded = event => {
                if (event.currentTarget !== video) return;
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            };
            const onMainVideoSeeking = event => {
                if (event.currentTarget !== video) return;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            };
            const onMainVideoSeeked = event => {
                if (event.currentTarget !== video) return;
                tick(true);
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src' && !isStillSegment(segment)) {
                    if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    if (video.paused) void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                }
                applyRequestedOverlaySelection();
                restoreInitialPlayback();
            };
            const onMainVideoError = event => {
                const media = event.currentTarget;
                const errorCode = media.error ? media.error.code : 0;
                if (media === video) showPlaybackError();
                // MediaError.MEDIA_ERR_DECODE = 3, MEDIA_ERR_SRC_NOT_SUPPORTED = 4 — 「宣言は
                // probably/maybe だったが実際には再生できなかった」ケースだけフォールバックを試す。
                if (errorCode === 3 || errorCode === 4) {
                    if (media !== video) {
                        const standbyUri = initial.videoSourceUris[currentStandbyVideoSourceId];
                        if (typeof standbyUri === 'string' && standbyUri) {
                            attemptHevcFallback(errorCode, standbyUri);
                        }
                        return;
                    }
                    const segment = segments[activeSegmentIndex];
                    const segmentSourceId = segment && segment.kind === 'src' ? String(segment.src) : '';
                    const sourceId = currentVideoSourceId || segmentSourceId;
                    attemptHevcFallback(errorCode, initial.videoSourceUris[sourceId] || initial.videoUri);
                }
            };
            for (const media of [video, standbyVideo]) {
                media.addEventListener('loadedmetadata', onMainVideoLoadedMetadata);
                media.addEventListener('canplay', onMainVideoCanPlay);
                media.addEventListener('play', onMainVideoPlay);
                media.addEventListener('play', onMainVideoAudioNoticePlay);
                media.addEventListener('pause', onMainVideoPause);
                media.addEventListener('ended', onMainVideoEnded);
                media.addEventListener('seeking', onMainVideoSeeking);
                media.addEventListener('seeked', onMainVideoSeeked);
                media.addEventListener('error', onMainVideoError);
            }
            transitionVideo.addEventListener('error', () => {
                const errorCode = transitionVideo.error ? transitionVideo.error.code : 0;
                if (errorCode === 3 || errorCode === 4) {
                    const videoUri = initial.videoSourceUris[currentTransitionVideoSourceId];
                    if (typeof videoUri === 'string' && videoUri) {
                        // 先読み中の未来のカットはまだ画面に出ていないため、再生中の画面を
                        // エラー表示へ切り替えず、変換要求だけを静かに送る。
                        attemptHevcFallback(errorCode, videoUri);
                    }
                }
            });
            audioNoticeDismiss.addEventListener('click', () => {
                audioNotice.hidden = true;
            });
            const syncDeclaredTrackStates = () => {
                const tracks = summary.tracks || {};
                const syncScope = (scope, entries) => {
                    hiddenTracksByScope[scope].clear();
                    mutedTracksByScope[scope].clear();
                    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
                        const ref = entry && Number.isInteger(entry.ref) && entry.ref >= 0 ? entry.ref : index;
                        if (entry && entry.hidden === true) hiddenTracksByScope[scope].add(ref);
                        if (entry && entry.muted === true) mutedTracksByScope[scope].add(ref);
                    }
                };
                syncScope('cuts', tracks.cuts);
                syncScope('layers', tracks.layers);
                syncScope('audio', tracks.audio);
                syncFrameEngineMutedTracks();
            };
            const applyIncrementalModel = nextSummary => {
                if (!nextSummary || typeof nextSummary !== 'object') return;
                nextSummary = window.akari.interaction?.protectModelSummary?.(nextSummary) ?? nextSummary;
                const nextLayers = Array.isArray(nextSummary.layers) ? nextSummary.layers : [];
                const previousLayerIds = new Set(layerEntries.map(entry => String(entry.spec.id)));
                const retainedLayerOrderChanged = layerEntries
                    .filter(entry => nextLayers.some(layer => String(layer.id) === String(entry.spec.id)))
                    .map(entry => String(entry.spec.id)).join('\u0000')
                    !== nextLayers.filter(layer => previousLayerIds.has(String(layer.id)))
                        .map(layer => String(layer.id)).join('\u0000');
                const addedLayers = nextLayers.filter(layer => !previousLayerIds.has(String(layer.id)));
                const oldOverlays = Array.isArray(summary.overlays) ? summary.overlays : [];
                const newOverlays = Array.isArray(nextSummary.overlays) ? nextSummary.overlays : [];
                const overlaysAppended = newOverlays.length > oldOverlays.length
                    && oldOverlays.every((overlay, index) => overlay.id === newOverlays[index]?.id);
                if (window.akari.frameEngineClock?.updateModel) {
                    playbackModelUpdate = window.akari.frameEngineClock.updateModel(nextSummary);
                } else if (initial.frameEngineEnabled) {
                    // frame-engine の codec probe / 初回描画より先に編集通知が届いても捨てない。
                    // bootstrap は復元フレーム描画後にこの最新 summary を適用してから ready を通知する。
                    window.akari.frameEnginePendingSummary = nextSummary;
                }
                const previousAudioJson = JSON.stringify(summary.audio || null);
                const previousTracksJson = JSON.stringify(summary.tracks || null);
                const activeCutIndex = segments[activeSegmentIndex]
                    && Number.isInteger(segments[activeSegmentIndex].cutIndex)
                    ? segments[activeSegmentIndex].cutIndex : null;
                summary = nextSummary;
                window.akari.state.summary = summary;
                const byId = new Map(layerEntries.map(entry => [String(entry.spec.id), entry]));
                for (const entry of layerEntries) {
                    if (nextLayers.some(layer => String(layer.id) === String(entry.spec.id))) continue;
                    entry.video.pause();
                    entry.video.removeAttribute('src');
                    if (entry.video.tagName === 'VIDEO') entry.video.load();
                    entry.video.remove();
                    entry.video.akariPhotoFrameBorder?.remove();
                    entry.deferredPlaceholder?.remove();
                    if (entry.fxRail) {
                        entry.fxRail.dispose?.();
                        railMeta.delete(entry.fxRail);
                        const railIndex = videoFxRails.indexOf(entry.fxRail);
                        if (railIndex >= 0) videoFxRails.splice(railIndex, 1);
                    }
                }
                layerEntries.splice(0, layerEntries.length,
                    ...nextLayers.map(layer => byId.get(String(layer.id))).filter(Boolean));
                if (overlaysAppended) {
                    window.akari.interaction?.clearSelection?.();
                    void window.akari.runtime.mount(summary).catch(error =>
                        console.warn('[akari-preview] incremental overlay mount failed', error));
                }
                for (const layer of addedLayers) {
                    const entry = createLayerEntry(layer, layerEntries.length);
                    layerEntries.push(entry);
                    entry.video.addEventListener('loadeddata', () => syncLayerHitRegion(entry, true));
                    entry.video.addEventListener('seeked', () => syncLayerHitRegion(entry, true));
                    entry.fxRail = !frameEngineMediaIdle && entry.spec.chromaKey
                        ? mountVideoFxRail(entry.video, 'layer:' + entry.spec.id,
                            { chromaKey: entry.spec.chromaKey }) : null;
                }
                for (const [index, entry] of layerEntries.entries()) {
                    entry.video.dataset.akariLayerIndex = String(index);
                    if (retainedLayerOrderChanged) {
                        layersStage.appendChild(entry.video);
                        if (entry.deferredPlaceholder) layersStage.appendChild(entry.deferredPlaceholder);
                    }
                }
                window.akari.updateEmptyCanvasHint?.(outputTime);
                window.akari.runtime.applyAxisSummary?.(summary);
                refreshAdjustCssApproximation();
                refreshIndicators();
                rebuildVisualTrackZ();
                for (let index = 0; index < layerEntries.length; index += 1) {
                    applyIncrementalLayerSpec(layerEntries[index], summary.layers[index]);
                }
                if (previousTracksJson !== JSON.stringify(summary.tracks || null)) syncDeclaredTrackStates();
                rebuildSegments();
                if (activeCutIndex !== null) {
                    const matchingIndex = segments.findIndex(segment => segment.kind === 'src'
                        && segment.cutIndex === activeCutIndex);
                    if (matchingIndex >= 0) activeSegmentIndex = matchingIndex;
                } else {
                    const containingIndex = segments.findIndex(segment => outputTime >= segment.outStart
                        && outputTime < segment.outEnd);
                    if (containingIndex >= 0) activeSegmentIndex = containingIndex;
                }
                const activeSegment = segments[activeSegmentIndex];
                syncSegmentPlaybackRate();
                applyCutVisual(activeSegment);
                applyCutsZIndex(activeSegment);
                for (const entry of layerEntries) {
                    entry.video.style.zIndex = String(zForItem(entry.spec.id, zForTrack(entry.spec.trackId)));
                }
                for (const [index, entry] of filterEntries.entries()) {
                    const filter = summary.filters[index];
                    clearAdjustBaseFilter(entry.element);
                    setAdjustBaseFilter(entry.element, filter);
                    entry.element.style.zIndex = String(zForItem(entry.spec.id, zForTrack(entry.spec.trackId)));
                }
                applyOverlayTracks();
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                const nextAudioJson = JSON.stringify(summary.audio || null);
                if (previousAudioJson !== nextAudioJson && window.akari.previewAudio?.updateConfig) {
                    playbackModelUpdate = Promise.all([
                        playbackModelUpdate,
                        window.akari.previewAudio.updateConfig(summary.audio, outputTime, isPlaying),
                        probeSfxDurations().then(() => { rebuildSegments(); tick(true); })
                    ]);
                }
                if (addedLayers.length === 0) tick(true);
                for (const id of window.akari.optimisticallyRemovedIds ?? []) {
                    const layer = findLayerEntry(id);
                    if (layer) layer.video.style.display = 'none';
                    const overlay = stage.querySelector('[data-overlay-id="' + CSS.escape(id) + '"]');
                    if (overlay) overlay.style.display = 'none';
                }
                for (const id of [...(window.akari.optimisticallyRemovedIds ?? [])]) {
                    if (!nextLayers.some(layer => String(layer.id) === id)
                        && !(summary.overlays ?? []).some(overlay => String(overlay.id) === id)) {
                        window.akari.optimisticallyRemovedIds.delete(id);
                    }
                }
                window.akari.interaction?.restorePendingDragTransforms?.();
                window.akari.requestGenerationUpdate?.();
                const renderedModel = playbackModelUpdate;
                void Promise.resolve(renderedModel).then(() => Promise.all(addedLayers.map(layer => {
                    const entry = findLayerEntry(layer.id);
                    return entry?.video.tagName === 'IMG' ? entry.video.decode() : Promise.resolve();
                }))).then(() => {
                    if (addedLayers.length > 0) tick(true);
                    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                        window.akari.reportReadySeek({ type: 'akari-preview-model-painted',
                            pageId: initial.playbackPageId, layerIds: addedLayers.map(layer => layer.id) });
                    }));
                }).catch(error => console.warn('[akari-preview] incremental paint unavailable', error));
            };
            const applyOptimisticItemUpdate = message => {
                if (message.rollback) {
                    optimisticallyRemovedIds.clear();
                    for (const entry of layerEntries) entry.video.style.display = '';
                    for (const { plate } of captionRows.values()) plate.style.display = '';
                    applyOverlayTracks();
                    tick(true);
                    return;
                }
                for (const id of message.removedIds ?? []) {
                    optimisticallyRemovedIds.add(String(id));
                    const layer = findLayerEntry(id);
                    if (layer) layer.video.style.display = 'none';
                    const overlay = stage.querySelector('[data-overlay-id="' + CSS.escape(String(id)) + '"]');
                    if (overlay) overlay.style.display = 'none';
                    const caption = captionRows.get(String(id));
                    if (caption) caption.plate.style.display = 'none';
                }
                if (Array.isArray(message.order) && message.order.length) {
                    const visual = new Map();
                    for (const entry of layerEntries) visual.set(String(entry.spec.id), entry.video);
                    for (const element of stage.querySelectorAll('[data-overlay-id]')) {
                        visual.set(element.getAttribute('data-overlay-id'), element);
                    }
                    const ordered = message.order.map(id => visual.get(String(id))).filter(Boolean);
                    const zValues = ordered.map(element => Number(element.style.zIndex))
                        .filter(Number.isFinite).sort((a, b) => a - b);
                    ordered.forEach((element, index) => { element.style.zIndex = String(zValues[index] ?? index); });
                }
            };
            // BEGIN preview bag response (bootstrap owns summary and persistent plates)
            let bagMountTail = Promise.resolve();
            const mixedSelectionFrames = document.createElement('div');
            mixedSelectionFrames.id = 'akari-mixed-selection-frames';
            mixedSelectionFrames.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483646';
            previewPane.appendChild(mixedSelectionFrames);
            const mixedSelectionElement = item => item.kind === 'caption'
                ? [...captionRows.values()].find(row => (row.caption.sourceCueId || row.caption.id) === item.id)?.plate
                : item.kind === 'layer' ? findLayerEntry(item.id)?.video
                    : [...stage.querySelectorAll('[data-overlay-id]')].find(node => node.dataset.overlayId === item.id);
            const mixedSelectionRect = (item, element) => {
                if (item.kind === 'caption') {
                    const block = element.querySelector('.akari-caption__block');
                    const elements = (block ? [block] : [...element.querySelectorAll('.akari-caption__line')])
                        .concat([...element.querySelectorAll('.akari-caption__run')]);
                    if (!elements.length) return null;
                    const rects = elements.map(node => node.getBoundingClientRect());
                    const left = Math.min(...rects.map(rect => rect.left));
                    const top = Math.min(...rects.map(rect => rect.top));
                    const right = Math.max(...rects.map(rect => rect.right));
                    const bottom = Math.max(...rects.map(rect => rect.bottom));
                    return { left, top, width: right - left, height: bottom - top };
                }
                if (item.kind === 'overlay') return element.dataset?.role === 'shape-line'
                    ? window.akari.interaction?.lineFrameGeometry?.(element) || null
                    : window.akari.interaction?.fragmentBounds?.(element) || null;
                return element.getBoundingClientRect();
            };
            const nativeMixedFrameVisible = frame => {
                if (!frame || frame.hidden) return false;
                const style = getComputedStyle(frame);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = frame.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const hasNativeMixedFrame = item => item.kind === 'caption'
                ? item.id === selectedCaptionId && captionSelectBox.classList.contains('is-active')
                    && nativeMixedFrameVisible(captionSelectBox)
                : item.kind === 'layer'
                    ? item.id === selectedLayerId && layerSelectBox.classList.contains('is-active')
                        && nativeMixedFrameVisible(layerSelectBox)
                    : item.id === window.akari.interaction?.selectedId
                        && nativeMixedFrameVisible(document.querySelector('[data-akari-interaction="selection-frame"]'));
            let mixedFrameLoop = false;
            const drawMixedSelectionFrames = () => {
                mixedSelectionFrames.replaceChildren();
                if (selectedMixedGroup.length < 2) { mixedFrameLoop = false; return; }
                const pane = previewPane.getBoundingClientRect();
                const scaleX = pane.width && previewPane.offsetWidth ? pane.width / previewPane.offsetWidth : 1;
                const scaleY = pane.height && previewPane.offsetHeight ? pane.height / previewPane.offsetHeight : 1;
                for (const item of selectedMixedGroup) {
                    const element = mixedSelectionElement(item);
                    if (!element || getComputedStyle(element).visibility === 'hidden') continue;
                    if (hasNativeMixedFrame(item)) continue;
                    const rect = mixedSelectionRect(item, element);
                    if (!rect) continue;
                    if (!(rect.width > 0 && rect.height > 0)) continue;
                    const frame = document.createElement('div');
                    frame.dataset.akariMixedSelected = item.kind + ':' + item.id;
                    frame.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid var(--akari-accent,#65aaff);';
                    frame.style.left = (rect.left - pane.left) / scaleX + 'px';
                    frame.style.top = (rect.top - pane.top) / scaleY + 'px';
                    frame.style.width = rect.width / scaleX + 'px';
                    frame.style.height = rect.height / scaleY + 'px';
                    if (Number.isFinite(rect.angle)) frame.style.transform = 'rotate(' + rect.angle + 'deg)';
                    mixedSelectionFrames.appendChild(frame);
                }
                requestAnimationFrame(drawMixedSelectionFrames);
            };
            const applyMixedSelection = selection => {
                selectedMixedGroup = selection.filter(item => item && ['caption', 'layer', 'overlay'].includes(item.kind)
                    && typeof item.id === 'string' && item.id.length > 0);
                applyingMixedSelection = true;
                const captionsInGroup = selectedMixedGroup.filter(item => item.kind === 'caption').map(item => item.id);
                selectedCaptionIds = new Set(captionsInGroup);
                selectLayer(selectedMixedGroup.find(item => item.kind === 'layer')?.id || null, { report: false });
                selectCaption(captionsInGroup[0] || null, { report: false, preserveGroup: true });
                requestedOverlayId = selectedMixedGroup.find(item => item.kind === 'overlay')?.id || null;
                applyRequestedOverlaySelection();
                if (requestedOverlayId && window.akari.interaction?.hasSelectionTree
                    && window.akari.interaction.selectedId !== requestedOverlayId) {
                    // Shapes can be rendered as overlays without a selection-tree node.
                    // Keep their mixed frame, but remove an unrelated native overlay frame.
                    window.akari.interaction.clearSelection?.();
                }
                requestAnimationFrame(() => { applyingMixedSelection = false; });
                if (selectedMixedGroup.length > 1 && !mixedFrameLoop) {
                    mixedFrameLoop = true;
                    requestAnimationFrame(drawMixedSelectionFrames);
                } else if (selectedMixedGroup.length < 2) mixedSelectionFrames.replaceChildren();
            };
            const mixedSelectionHit = event => {
                const element = event.target instanceof Element ? event.target : event.target?.parentElement;
                if (element?.closest('[data-akari-interaction="selection-frame"]')
                    && window.akari.interaction?.selectedId) {
                    return { kind: 'overlay', id: window.akari.interaction.selectedId };
                }
                const captionPlate = element?.closest('.caption-row-plate');
                if (captionPlate) {
                    const row = captionRows.get(captionPlate.dataset.captionKey);
                    if (row) return { kind: 'caption', id: row.caption.sourceCueId || row.caption.id };
                }
                const layer = element?.closest('[data-akari-layer-id]');
                if (layer) return { kind: 'layer', id: layer.dataset.akariLayerId };
                const overlay = element?.closest('[data-overlay-id]');
                if (overlay) return { kind: 'overlay', id: overlay.dataset.overlayId };
                if (element?.closest('#caption-select-box') && selectedCaptionId) return { kind: 'caption', id: selectedCaptionId };
                if (element?.closest('#layer-select-box') && selectedLayerId) return { kind: 'layer', id: selectedLayerId };
                if (element === previewStage || element?.id === 'frame-engine-canvas') {
                    const visualHitAt = findVisualMediaHitAt;
                    const media = visualHitAt(event);
                    if (media?.dataset?.akariLayerId) {
                        return { kind: 'layer', id: media.dataset.akariLayerId };
                    }
                    // A cut uses the separate cut transform/write path; mixedMove accepts
                    // layer/overlay writes and caption positions, so a cut cannot join it.
                }
                return null;
            };
            window.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !(event.shiftKey || event.ctrlKey || event.metaKey)) return;
                const hit = mixedSelectionHit(event);
                if (!hit) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                suppressMixedClick = true;
                const current = selectedMixedGroup.length ? [...selectedMixedGroup]
                    : [selectedCaptionId && { kind: 'caption', id: selectedCaptionId },
                        selectedLayerId && { kind: 'layer', id: selectedLayerId },
                        window.akari.interaction?.selectedId
                            && { kind: 'overlay', id: window.akari.interaction.selectedId }].filter(Boolean);
                const index = current.findIndex(item => item.kind === hit.kind && item.id === hit.id);
                if (index >= 0) current.splice(index, 1);
                else current.push(hit);
                applyMixedSelection(current);
                window.akari.reportMixedSelection?.(current);
            }, true);
            let suppressMixedClick = false;
            window.addEventListener('pointerup', () => {
                if (suppressMixedClick) setTimeout(() => { suppressMixedClick = false; }, 0);
            }, true);
            window.addEventListener('click', event => {
                if (!suppressMixedClick) return;
                suppressMixedClick = false;
                event.preventDefault();
                event.stopImmediatePropagation();
            }, true);
            window.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey
                    || selectedMixedGroup.length < 2
                    || selectedMixedGroup.every(item => item.kind === 'caption')) return;
                const hit = mixedSelectionHit(event);
                if (!hit || !selectedMixedGroup.some(item => item.kind === hit.kind && item.id === hit.id)) return;
                const members = selectedMixedGroup.map(item => ({ item, element: mixedSelectionElement(item) }))
                    .filter(row => row.element);
                if (members.length !== selectedMixedGroup.length) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const pointerId = event.pointerId;
                const origin = captionOutputPoint(event.clientX, event.clientY);
                const rows = members.map(row => {
                    const css = String(row.element.style.translate || '').trim().split(' ');
                    return { ...row, rect: row.item.kind === 'caption'
                        ? captionVisualRect(row.element) : row.element.getBoundingClientRect(),
                        layoutRect: row.item.kind === 'caption' ? captionLayoutRect(row.element) : null,
                        captionTransform: row.item.kind === 'caption' ? captionTransformValues(row.element) : null,
                        translate: { x: parseFloat(css[0]) || 0, y: parseFloat(css[1]) || 0 } };
                });
                let delta = { x: 0, y: 0 };
                let moved = false;
                window.akari.reportGesture?.('begin');
                const stop = () => {
                    window.removeEventListener('pointermove', move, true);
                    window.removeEventListener('pointerup', up, true);
                    window.removeEventListener('pointercancel', cancel, true);
                };
                const restore = () => {
                    for (const row of rows) row.element.style.translate = row.translate.x || row.translate.y
                        ? row.translate.x + 'px ' + row.translate.y + 'px' : '';
                };
                const move = next => {
                    if (next.pointerId !== pointerId) return;
                    const point = captionOutputPoint(next.clientX, next.clientY);
                    delta = { x: point.x - origin.x, y: point.y - origin.y };
                    if (!moved && Math.hypot(delta.x, delta.y) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    next.preventDefault();
                    for (const row of rows) row.element.style.translate = (row.translate.x + delta.x) + 'px '
                        + (row.translate.y + delta.y) + 'px';
                };
                let finished = false;
                const finish = async cancelled => {
                    if (finished) return;
                    finished = true;
                    try {
                        stop();
                        if (cancelled || !moved) return;
                        suppressMixedClick = true;
                        const writes = [];
                        const cuePositions = [];
                        for (const row of rows) {
                            const { item } = row;
                            if (item.kind === 'caption') {
                                const caption = captions.find(candidate => (candidate.sourceCueId || candidate.id) === item.id);
                                if (!caption) continue;
                                const movedRect = { left: row.rect.left + delta.x, right: row.rect.right + delta.x,
                                    top: row.rect.top + delta.y, bottom: row.rect.bottom + delta.y };
                                const value = frameCaptionPosition(caption, captionPositionFromVisualRect(
                                    movedRect, row.layoutRect, captionOutputFrame(), {
                                        anchor: caption.textStyle?.text_anchor || 'bc',
                                        clamp: captionClampEnabled(caption), timeDomain: caption.timeDomain,
                                        ...row.captionTransform
                                    }));
                                cuePositions.push({ captionId: item.id, value });
                            } else {
                                const spec = item.kind === 'layer' ? findLayerEntry(item.id)?.spec
                                    : summary.overlays?.find(candidate => candidate.id === item.id)
                                        || summary.tree?.find(candidate => candidate.id === item.id);
                                if (!spec) continue;
                                writes.push({ kind: item.kind, itemId: item.id, patch: { transform: {
                                    x: (Number(spec.transform?.x) || 0) + delta.x,
                                    y: (Number(spec.transform?.y) || 0) + delta.y
                                } } });
                            }
                        }
                        if (writes.length + cuePositions.length !== rows.length) throw new Error('選択素材の位置を取得できません');
                        await window.akari.engine.mixedMove(writes, cuePositions);
                        window.akari.reportGesture?.('saved');
                    } catch (error) {
                        window.akari.showWriteError(error);
                    } finally {
                        try { restore(); } finally { window.akari.reportGesture?.('end'); }
                    }
                };
                const up = next => { if (next.pointerId === pointerId) void finish(false); };
                const cancel = next => { if (next.pointerId === pointerId) void finish(true); };
                window.addEventListener('pointermove', move, true);
                window.addEventListener('pointerup', up, true);
                window.addEventListener('pointercancel', cancel, true);
            }, true);
            window.addEventListener('message', event => {
                const message = event.data;
                if (message?.type === 'akari-preview-optimistic-item-update') {
                    applyOptimisticItemUpdate(message);
                    return;
                }
                if (message?.type !== 'akari-preview-expand-bag' || !message.summary
                    || !window.akari.isCurrentBagExpansion(message.requestId)) return;
                // Serialize mounts; discard replies superseded by a later scope.
                bagMountTail = bagMountTail.then(async () => {
                    if (!window.akari.isCurrentBagExpansion(message.requestId)) return;
                    summary = message.summary;
                    window.akari.state.summary = summary;
                    await window.akari.runtime.mount(summary);
                    // mount owns the stage; restore the shell's persistent plates.
                    stage.append(transitionPlate, transitionFallbackLabel, captionLayer);
                    applyIncrementalModel(summary);
                    stage.append(emptyCanvasHint);
                }).catch(error => console.warn('[akari-preview] bag expansion failed', error));
            });
            // END preview bag response
            const readySeek = (${createReadySeekResponder.toString()})({
                pageId: initial.playbackPageId,
                ready: () => playbackMountReady
                    && (frameEngineMediaIdle ? document.getElementById('frame-engine-preview')?.dataset.frameEngineReady === 'true'
                        : initialPositionApplied && (isStillSegment(segments[activeSegmentIndex])
                            || segments[activeSegmentIndex]?.kind === 'gap' || (!video.seeking && video.readyState >= 1))),
                pendingModel: () => playbackModelUpdate,
                seek: time => {
                    // 開いた時点の時刻・再生復元で、この外部操作を後から上書きしない。
                    initialPositionApplied = true;
                    initialPlaybackRestorePending = false;
                    if (isPlaying) togglePlayback();
                    seekTimelineTime(time);
                    tick(true);
                },
                reply: message => window.akari.reportReadySeek(message)
            });
            window.addEventListener('message', event => {
                const message = event.data;
                if (message?.type === 'akari-preview-video-candidate') {
                    if (message.clear === true) {
                        if (!videoCandidatePreview || !message.itemId || videoCandidatePreview.itemId === message.itemId) {
                            clearVideoCandidatePreview();
                        }
                        return;
                    }
                    if (typeof message.itemId !== 'string' || typeof message.url !== 'string'
                        || typeof message.relativePath !== 'string' || !Number.isFinite(message.outSeconds)
                        || message.outSeconds <= 0 || !layerEntries.some(row => String(row.spec.id) === message.itemId)
                            && !segments.some(row => String(row.id) === message.itemId)) return;
                    clearVideoCandidatePreview();
                    const candidateVideo = document.createElement('video');
                    candidateVideo.dataset.akariVideoCandidatePreview = message.itemId;
                    candidateVideo.dataset.akariVideoCandidateRelativePath = message.relativePath;
                    candidateVideo.crossOrigin = 'anonymous';
                    candidateVideo.preload = 'auto';
                    candidateVideo.playsInline = true;
                    candidateVideo.muted = true;
                    candidateVideo.style.pointerEvents = 'none';
                    layersStage.appendChild(candidateVideo);
                    videoCandidatePreview = { itemId: message.itemId, relativePath: message.relativePath,
                        outSeconds: message.outSeconds, video: candidateVideo, audio: null };
                    document.documentElement.dataset.akariVideoCandidatePreview = message.itemId;
                    document.documentElement.dataset.akariVideoCandidateRelativePath = message.relativePath;
                    candidateVideo.src = message.url;
                    candidateVideo.load();
                    candidateVideo.addEventListener('loadedmetadata', () => syncVideoCandidatePreview(outputTime), { once: true });
                    syncVideoCandidatePreview(outputTime);
                    updateGenerationOverlay(outputTime);
                    tick(true);
                    return;
                }
                if (message?.type === 'akari-preview-video-candidate-audio') {
                    if (!videoCandidatePreview || videoCandidatePreview.itemId !== message.itemId
                        || videoCandidatePreview.relativePath !== message.relativePath
                        || typeof message.url !== 'string') return;
                    videoCandidatePreview.audio?.remove();
                    const candidateAudio = document.createElement('audio');
                    candidateAudio.dataset.akariVideoCandidateSidecar = message.itemId;
                    candidateAudio.crossOrigin = 'anonymous';
                    candidateAudio.preload = 'auto';
                    candidateAudio.hidden = true;
                    document.body.appendChild(candidateAudio);
                    videoCandidatePreview.audio = candidateAudio;
                    candidateAudio.src = message.url;
                    candidateAudio.load();
                    candidateAudio.addEventListener('canplay', () => syncVideoCandidatePreview(outputTime), { once: true });
                    return;
                }
                if (message?.type === 'akari-preview-still-candidate') {
                    const sourceId = typeof message.sourceId === 'string' ? message.sourceId : null;
                    const itemId = typeof message.itemId === 'string' ? message.itemId : null;
                    // CachedStillImageSource fetches its URL. The webview CSP allows blob: for
                    // connect-src, while data: is only allowed for img-src.
                    let candidateUrl = null;
                    if (typeof message.imageUrl === 'string' && message.imageUrl.startsWith('data:image/png;base64,')) {
                        const bytes = atob(message.imageUrl.slice('data:image/png;base64,'.length));
                        const data = Uint8Array.from(bytes, char => char.charCodeAt(0));
                        candidateUrl = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
                    }
                    const priorObjectUrl = window.akari.stillCandidateObjectUrl;
                    window.akari.stillCandidateObjectUrl = candidateUrl;
                    if (priorObjectUrl) setTimeout(() => URL.revokeObjectURL(priorObjectUrl), 5000);
                    window.akari.stillCandidatePreviewItemId = candidateUrl ? itemId : null;
                    const original = initial.imageSources || {};
                    const previous = window.akari.stillCandidateSourceId;
                    const layerIndex = itemId ? layerEntries.findIndex(entry => String(entry.spec.id) === itemId && entry.video.tagName === 'IMG') : -1;
                    const priorLayer = window.akari.stillCandidateLayer;
                    if (priorLayer) {
                        const entry = layerEntries[priorLayer.index];
                        if (entry) {
                            entry.spec.src = priorLayer.url;
                            if (summary.layers?.[priorLayer.index]) summary.layers[priorLayer.index].src = priorLayer.url;
                            entry.video.src = priorLayer.url;
                            window.akari.setStillCandidateSource?.('akari-image-layer-' + priorLayer.index + '.png', priorLayer.url);
                        }
                        window.akari.stillCandidateLayer = null;
                    }
                    if (previous && original[previous] && (previous !== sourceId || layerIndex >= 0)) {
                        const saved = window.akari.stillCandidateOriginals?.[previous] || original[previous];
                        original[previous] = saved;
                        window.akari.setStillCandidateSource?.(previous, saved);
                    }
                    if (layerIndex >= 0 && candidateUrl) {
                        const entry = layerEntries[layerIndex];
                        const saved = entry.spec.src;
                        window.akari.stillCandidateLayer = { index: layerIndex, url: saved };
                        entry.spec.src = candidateUrl;
                        if (summary.layers?.[layerIndex]) summary.layers[layerIndex].src = candidateUrl;
                        entry.video.src = candidateUrl;
                        window.akari.setStillCandidateSource?.('akari-image-layer-' + layerIndex + '.png', candidateUrl);
                    } else if (sourceId && original[sourceId]) {
                        window.akari.stillCandidateOriginals ||= {};
                        window.akari.stillCandidateOriginals[sourceId] ||= original[sourceId];
                        const url = candidateUrl || window.akari.stillCandidateOriginals[sourceId];
                        original[sourceId] = url;
                        window.akari.setStillCandidateSource?.(sourceId, url);
                        if (stillImage.style.display !== 'none') stillImage.src = url;
                        window.akari.stillCandidateSourceId = candidateUrl ? sourceId : null;
                    } else if (!sourceId || layerIndex >= 0) window.akari.stillCandidateSourceId = null;
                    // Paused frame-engine previews do not redraw on tick alone. Seek the current frame
                    // after swapping its CachedStillImageSource so the canvas changes immediately.
                    window.akari.frameEngineClock?.seek(outputTime, isPlaying);
                    tick(true);
                    return;
                }
                if (message?.type === 'akari-preview-ready-seek') {
                    void readySeek(message).catch(error => console.error('[akari-preview] ready seek failed', error));
                    return;
                }
                // 2026-09-02 preview-perf: host からの seek は rAF で間引く（下の akari-preview-seek）。
                // seek 以外のメッセージは「直前の seek が反映済み」という従来の順序を保つため、保留中の
                // seek を先に flush してから処理する（間引かれるのは連続する seek 同士だけ）。
                if (!(message && message.type === 'akari-preview-seek')) scrubThrottle.flush();
                if (message && message.type === 'akari-preview-set-scrub-audio'
                    && typeof message.enabled === 'boolean') {
                    setScrubAudioEnabled(message.enabled);
                    return;
                }
                if (message && message.type === 'akari-preview-generation-update') {
                    generationClips = Array.isArray(message.clips) ? message.clips : [];
                    generationExportLook = message.exportLook === true;
                    updateGenerationOverlay(outputTime);
                    return;
                }
                if (message && message.type === 'akari-preview-set-export-look'
                    && typeof message.enabled === 'boolean') {
                    generationExportLook = message.enabled;
                    updateGenerationOverlay(outputTime);
                    return;
                }
                if (message && message.type === 'akari-preview-set-review-recording'
                    && typeof message.active === 'boolean') {
                    const wasRecordingActive = reviewRecordingActive;
                    reviewRecordingActive = message.active;
                    if (reviewRecordingActive && !wasRecordingActive) {
                        reviewRecordingStartedAt = performance.now();
                        persistentStrokeItems = [];
                        annotationStrokeItems = [];
                        penLayer.dataset.akariStrokeSession = '';
                        redrawStaticBitmap();
                        recomposite();
                    }
                    if (!reviewRecordingActive && wasRecordingActive) {
                        // 表示プールだけを捨てる。記録済みデータは strokes.json に残り、
                        // セッション行の「描線」から必要な時点へ再表示できる。
                        persistentStrokeItems = [];
                        annotationStrokeItems = [];
                        penLayer.dataset.akariStrokeSession = '';
                        redrawStaticBitmap();
                        recomposite();
                    }
                    penToggle.hidden = !reviewRecordingActive;
                    if (!reviewRecordingActive) {
                        abortCurrentStroke();
                        abortCurrentRect();
                        applyReviewToolMode('neutral');
                    } else if (typeof message.mode === 'string') {
                        // ReviewSessionRecorder（host）が唯一の正本 -- 右パネルの選択/ペン/四角
                        // ボタンやキーボードショートカットで切り替わった mode をここで反映する。
                        applyReviewToolMode(message.mode);
                    }
                    updateTransport();
                    return;
                }
                if (message && message.type === 'akari-preview-show-annotation-strokes') {
                    const strokes = Array.isArray(message.strokes)
                        ? message.strokes
                        : (Array.isArray(message.points)
                            ? message.points.map(points => ({ tool: 'pen', points })) : []);
                    showStaticAnnotationStrokes(strokes);
                    return;
                }
                if (message && message.type === 'akari-preview-show-session-strokes') {
                    showPersistentSessionStrokes(message);
                    return;
                }
                if (message && message.type === 'akari-preview-set-stroke-visibility'
                    && typeof message.visible === 'boolean') {
                    persistentStrokesVisible = message.visible;
                    penLayer.dataset.akariPersistentVisible = String(persistentStrokesVisible);
                    redrawStaticBitmap();
                    recomposite();
                    return;
                }
                if (message && message.type === 'akari-preview-caption-zone-hover') {
                    updateCaptionZoneHighlight(typeof message.zone === 'string' ? message.zone : null);
                    return;
                }
                if (message && message.type === 'akari-preview-caption-position-preset') {
                    const action = message.action;
                    const caption = captions.find(candidate =>
                        (candidate.sourceCueId || candidate.id) === action?.captionId);
                    const row = [...captionRows.values()].find(candidate =>
                        (candidate.caption.sourceCueId || candidate.caption.id) === action?.captionId);
                    if (!caption || !row || !row.plate?.isConnected) return;
                    const frame = captionOutputFrame();
                    const rect = captionVisualRect(row.plate);
                    const zone = caption.textStyle?.zone || 'bottom';
                    const anchor = caption.textStyle?.text_anchor
                        || (String(zone).startsWith('top') ? 'tc'
                            : zone === 'center' || zone === 'left' || zone === 'right' ? 'mc' : 'bc');
                    const anchorY = anchor[0] === 'b' ? rect.bottom
                        : anchor[0] === 'm' ? (rect.top + rect.bottom) / 2 : rect.top;
                    const value = action.kind === 'zone'
                        ? captionZonePlacementFn(action.zone,
                            { width: rect.right - rect.left, height: rect.bottom - rect.top }, frame)
                        : captionAxisPlacementFn(action.axis, action.percent,
                            { x: rect.left / frame.width, y: anchorY / frame.height }, anchor);
                    const patch = caption.timeDomain === 'output' ? { cuePosition: value }
                        : { groupPosition: value };
                    void window.akari.engine.captionWrite(action.captionId, patch).catch(error =>
                        window.akari.showWriteError(error));
                    return;
                }
                if (message && message.type === 'akari-preview-onboarding-clear-selection') {
                    deselectCaption();
                    captionPalette.hidden = true;
                    captionRunMenu.hidden = true;
                    return;
                }
                if (message && message.type === 'akari-preview-onboarding-select-caption') {
                    const visible = [...captionRows.values()].find(row => row.plate && !row.plate.hidden
                        && row.caption.sourceCueId !== 'c-title');
                    if (visible) selectCaption(visible.caption.sourceCueId || visible.caption.id);
                    return;
                }
                if (message && message.type === 'akari-preview-select-caption-run') {
                    const caption = captions.find(item => (item.sourceCueId || item.id) === message.captionId
                        && captionRows.has(item.id));
                    if (caption) {
                        const selectRun = () => {
                            beginCaptionEdit(caption);
                            const element = activeCaptionEdit?.element;
                            if (selectEditorGraphemes(element, message.from, message.to)) syncRunSelection();
                        };
                        if (activeCaptionEdit && activeCaptionEdit.captionId !== message.captionId) {
                            void commitCaptionEdit().then(selectRun);
                        } else selectRun();
                    }
                }
                if (message && message.type === 'akari-preview-run-styles') {
                    captionRunMenu.replaceChildren();
                    for (const choice of message.choices || []) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.textContent = choice.name;
                        button.dataset.akariRunStyle = choice.id;
                        button.addEventListener('click', () => {
                            if (choice.style && Object.keys(choice.style).length) {
                                writeCaptionRun({ kind: 'style', style: choice.style });
                            }
                            if (choice.notice) window.akari.reportRunStyleOmitted(choice.notice);
                            captionRunMenu.hidden = true;
                        });
                        captionRunMenu.appendChild(button);
                    }
                    if (!captionRunMenu.childElementCount) captionRunMenu.textContent = '使えるスタイルがありません';
                }
                if (message && message.type === 'akari-preview-set-selected-captions') {
                    selectedCaptionIds = new Set(Array.isArray(message.captionIds) ? message.captionIds : []);
                    if (Object.prototype.hasOwnProperty.call(message, 'primaryCaptionId')) {
                        selectCaption(selectedCaptionIds.has(message.primaryCaptionId)
                            ? message.primaryCaptionId : null, { report: false, preserveGroup: true });
                    } else if (!selectedCaptionIds.has(selectedCaptionId)) {
                        const visible = [...captionRows.values()].find(row =>
                            selectedCaptionIds.has(row.caption.sourceCueId || row.caption.id));
                        selectCaption(visible ? visible.caption.sourceCueId || visible.caption.id : null,
                            { report: false, preserveGroup: true });
                    }
                    applyCaptionSelectionAttrs();
                    captionStylePreview.selectionChanged(selectedCaptionIds);
                    updateCaptionSelectBox();
                    return;
                }
                if (message?.type === 'akari-preview-set-selected-group' && Array.isArray(message.selection)) {
                    applyMixedSelection(message.selection);
                    return;
                }
                if (message && message.type === 'akari-preview-caption-style-preview') {
                    void captionStylePreview.receive(message);
                    return;
                }
                if (message && message.type === 'akari-preview-caption-motion-play'
                    && typeof message.captionId === 'string' && typeof message.id === 'string') {
                    queueCaptionMotionReplay(message);
                    return;
                }
                if (message && message.type === 'akari-preview-captions-update') {
                    if (captionGestureCount) {
                        pendingCaptionUpdate = Array.isArray(message.captions) ? message.captions : [];
                        return;
                    }
                    const nextCaptions = Array.isArray(message.captions) ? message.captions : [];
                    // textStyleVars, not textStyle, drives the plate's actual CSS. A stale
                    // message cannot be repaired by changing textStyle alone.
                    if (captionUpdateIsStale(nextCaptions)) return;
                    clearLiveOverride();
                    captionStylePreview.captionsUpdated(nextCaptions);
                    captions = protectCaptionUpdate(nextCaptions);
                    window.akari.previewCaptions = captions;
                    void window.akari.frameEngineClock?.refreshContentDuration?.();
                    if (!window.akari.frameEngineClock) rebuildSegments();
                    if (pendingCaptionDragReload) {
                        pendingCaptionDragReload = false;
                        for (const { plate } of captionRows.values()) {
                            plate.style.translate = '';
                            plate.style.removeProperty('--caption-scale');
                            plate.style.removeProperty('--caption-rotate');
                        }
                    }
                    renderCaption();
                    resumeCaptionMotionAfterRender();
                    window.akari.refreshActiveCaptionRuns?.();
                    updateCaptionSelectBox();
                    return;
                }
                if (message && message.type === 'akari-preview-audio-update') {
                    if (!initial.frameEngineEnabled) return;
                    summary.audio = message.audio;
                    window.akari.state.summary.audio = message.audio;
                    void probeSfxDurations();
                    if (window.akari.frameEnginePendingSummary) {
                        window.akari.frameEnginePendingSummary.audio = message.audio;
                    }
                    if (window.akari.frameEngineUpdateAudio) window.akari.frameEngineUpdateAudio(message);
                    else window.akari.frameEnginePendingAudio = { audio: message.audio };
                    return;
                }
                if (message && message.type === 'akari-preview-model-update') {
                    if (selectionGestures.size || captionGestureCount
                        || window.akari.interaction?.activePointerOperation) {
                        pendingSelectionModel = message.summary;
                        return;
                    }
                    clearLiveOverride();
                    applyIncrementalModel(message.summary);
                    return;
                }
                if (message && message.type === 'akari-preview-set-muted' && typeof message.muted === 'boolean') {
                    globalMuted = message.muted;
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility'
                    && Number.isInteger(message.track) && message.track >= 0 && typeof message.visible === 'boolean') {
                    if (message.visible) hiddenTracks.delete(message.track); else hiddenTracks.add(message.track);
                    applyTrackVisibility(message.track);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2') {
                    const { scope, track, hidden, muted } = message;
                    if ((scope === 'cuts' || scope === 'layers' || scope === 'audio') && typeof hidden === 'boolean') {
                        if (track === null) {
                            allTracksHiddenByScope[scope] = hidden;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (hidden) hiddenTracksByScope[scope].add(track);
                            else hiddenTracksByScope[scope].delete(track);
                        }
                    }
                    if ((scope === 'cuts' || scope === 'audio' || scope === 'layers') && typeof muted === 'boolean') {
                        if (track === null) {
                            allTracksMutedByScope[scope] = muted;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (muted) mutedTracksByScope[scope].add(track);
                            else mutedTracksByScope[scope].delete(track);
                        }
                    }
                    syncFrameEngineMutedTracks();
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(
                            mutedTracksByScope.audio, allTracksMutedByScope.audio
                        );
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2-bulk') {
                    hiddenTracksByScope.cuts = new Set(Array.isArray(message.hiddenCuts) ? message.hiddenCuts : []);
                    mutedTracksByScope.cuts = new Set(Array.isArray(message.mutedCuts) ? message.mutedCuts : []);
                    hiddenTracksByScope.layers = new Set(Array.isArray(message.hiddenLayers) ? message.hiddenLayers : []);
                    mutedTracksByScope.layers = new Set(Array.isArray(message.mutedLayers) ? message.mutedLayers : []);
                    mutedTracksByScope.audio = new Set(Array.isArray(message.mutedAudio) ? message.mutedAudio : []);
                    syncFrameEngineMutedTracks();
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(mutedTracksByScope.audio, allTracksMutedByScope.audio);
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-captions-visibility'
                    && typeof message.visible === 'boolean') {
                    captionLayer.style.visibility = message.visible ? 'visible' : 'hidden';
                    return;
                }
                if (message && message.type === 'akari-preview-seek' && Number.isFinite(message.time)) {
                    requestScrub(message.time);
                    return;
                }
                if (message && message.type === 'akari-preview-selection-floor') {
                    window.akari.state.selectionFloor = message.scopeId;
                    window.akari.interaction?.setSelectionFloor(message.scopeId);
                    return;
                }
                if (message && message.type === 'akari-preview-loop-range') {
                    const range = message.range;
                    loopRange = range && Number.isFinite(range.start) && Number.isFinite(range.end)
                        && range.end > range.start ? { start: range.start, end: range.end } : null;
                    if (loopRange && (outputTime < loopRange.start || outputTime >= loopRange.end)) {
                        seekTimelineTime(loopRange.start);
                        tick(true);
                    }
                    return;
                }
                if (message && message.type === 'akari-preview-toggle-playback') {
                    togglePlayback();
                    return;
                }
                if (message?.type === 'akari-preview-set-zoom') {
                    if (message.fit === true) { pan = { x: 0, y: 0 }; setZoom(1); }
                    else if (Number.isFinite(message.scale)) setZoom(message.scale);
                    return;
                }
                if (message?.type === 'akari-preview-set-rate' && Number.isFinite(message.rate)) {
                    setPreviewPlaybackRate(message.rate);
                    return;
                }
                if (message?.type === 'akari-preview-swap-trial-context') {
                    if (swapTrialToken !== message.token) {
                        swapTrialToken = message.token; swapTrialUserStopped = false;
                        window.akari.swapTrialPlaybackToken = undefined;
                    }
                    return;
                }
                if (message?.type === 'akari-preview-swap-playback-query') { reportSwapState(message.token); return; }
                if (message?.type === 'akari-preview-set-playback' && typeof message.playing === 'boolean') {
                    if (message.trialToken && swapTrialUserStopped) { reportSwapState(message.trialToken); return; }
                    if (message.playing !== isPlaying) togglePlayback();
                    if (message.trialToken) {
                        swapTrialToken = message.trialToken; window.akari.swapTrialPlaybackToken = message.trialToken;
                        reportSwapState(message.trialToken);
                    }
                    return;
                }
                if (message?.type === 'akari-preview-set-crop-mode') {
                    if (typeof message.itemId === 'string' && message.itemId) {
                        if (typeof findLayerEntry !== 'function' || findLayerEntry(message.itemId)) selectLayer(message.itemId);
                        else {
                            requestedCutId = message.itemId;
                            selectCut({ report: false });
                        }
                    }
                    setCropMode(typeof message.on === 'boolean' ? message.on : !cropModeActive);
                    return;
                }
                if (message?.type === 'akari-preview-set-perspective-panel') {
                    if (typeof message.itemId === 'string' && message.itemId) selectLayer(message.itemId);
                    setPerspectivePanelOpen(typeof message.on === 'boolean' ? message.on : !perspectivePanelOpen);
                    return;
                }
                if (message?.type === 'akari-preview-pulse-item' && typeof message.itemId === 'string') {
                    const el = Array.from(layersStage.querySelectorAll('[data-overlay-id], [data-akari-layer-id]'))
                        .find(node => (node.getAttribute('data-overlay-id') || node.getAttribute('data-akari-layer-id')) === message.itemId);
                    if (el) {
                        el.classList.remove('akari-focus-pulse');
                        void el.offsetWidth;
                        el.classList.add('akari-focus-pulse');
                    }
                    return;
                }
                if (message?.type === 'akari-preview-zone-hint' && Array.isArray(message.zones)) {
                    showZoneHints(message.zones, Number.isFinite(message.durationMs) ? message.durationMs : 2000);
                    return;
                }
                if (message?.type === 'akari-preview-select-primary') {
                    const selection = message.selection;
                    requestedCutId = selection?.kind === 'cut' ? selection.id : undefined;
                    if (selection?.kind === 'cut') {
                        selectCut({ report: false });
                    } else {
                        deselectCut({ report: false });
                    }
                    selectCaption(selection?.kind === 'caption' ? selection.id : null, { report: false });
                    return;
                }
                if (message && message.type === 'akari-preview-select-overlay'
                    && (typeof message.overlayId === 'string' || message.overlayId === null)) {
                    requestedOverlayId = message.overlayId;
                    const visible = overlaySelectionInRange(requestedOverlayId, outputTime);
                    if (requestedOverlayId && !visible) window.akari.interaction?.clearSelection?.();
                    applyRequestedOverlaySelection();
                }
                if (message && message.type === 'akari-preview-select-layer'
                    && (typeof message.layerId === 'string' || message.layerId === null)) {
                    selectLayer(message.layerId, { report: false });
                }
                if (message && message.type === 'akari-preview-adjust-bypass' && message.target
                    && typeof message.enabled === 'boolean') {
                    const target = message.target;
                    const id = target.kind === 'cut' ? summary.cuts?.[target.index]?.id
                        : target.kind === 'item' || target.kind === 'layer' ? target.id : undefined;
                    if (id === undefined) return;
                    if (message.enabled) adjustBypassIds.add(String(id));
                    else adjustBypassIds.delete(String(id));
                    void window.akari.frameEngineClock?.refreshAdjustBypass();
                    refreshAdjustCssApproximation();
                    refreshIndicators();
                    applyCutVisual(segments[activeSegmentIndex]);
                    for (const entry of layerEntries) {
                        clearAdjustBaseFilter(entry.video);
                        setAdjustBaseFilter(entry.video, entry.spec);
                    }
                    for (const entry of filterEntries) {
                        clearAdjustBaseFilter(entry.element);
                        setAdjustBaseFilter(entry.element, entry.spec);
                    }
                    window.akari.updateLayerLayout?.();
                    renderVideoFx(outputTime);
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-live-transform' && message.target
                    && (message.target.kind === 'cut'
                        || message.target.kind === 'layer'
                        || message.target.kind === 'item'
                        || message.target.kind === 'caption')
                    && (message.values && typeof message.values === 'object'
                        || typeof message.field === 'string' && Number.isFinite(message.value))) {
                    const values = message.values && typeof message.values === 'object'
                        ? Object.entries(message.values) : [[message.field, message.value]];
                    if (!values.length || values.some(([field, value]) =>
                        typeof field !== 'string' || !field || !Number.isFinite(value))) return;
                    const targetKey = message.target.kind === 'cut'
                        ? 'cut:' + message.target.index : message.target.kind === 'caption'
                            ? 'caption:' + message.target.id : 'item:' + message.target.id;
                    if (message.clear) {
                        if (message.field === 'shape') pendingShapeLive = null;
                        if (values.length === 1) void window.akari.frameEngineClock?.applyLivePreview?.(message);
                        else void window.akari.frameEngineClock?.applyTransformPreview?.(
                            message.target, Object.fromEntries(values));
                        clearLiveOverride();
                        tick(true);
                        return;
                    }
                    if (typeof message.shapeHtml === 'string') {
                        if (pendingShapeLive && window.akari?.state?.summary?.overlays?.some(
                            overlay => String(overlay.id) === pendingShapeLive.id
                                && overlay.html === pendingShapeLive.html)) clearLiveOverride();
                        pendingShapeLive = { key: targetKey, id: message.target.id, html: message.shapeHtml };
                        liveDom.updateShape(targetKey, message.shapeHtml);
                        return;
                    }
                    if (message.field === 'photoFrame' && message.photoFrame
                        && typeof message.photoFrame === 'object') {
                        const cut = message.target.kind === 'cut'
                            || message.target.kind === 'item' && video.dataset.akariCutId === message.target.id;
                        const media = cut ? (stillImage.style.display !== 'none' ? stillImage : video)
                            : Array.from(layersStage.querySelectorAll('img[data-akari-layer-id]'))
                                .find(element => element.dataset.akariLayerId === message.target.id);
                        if (media && media.tagName === 'IMG') {
                            media.dataset.akariPhotoFrame = JSON.stringify(message.photoFrame);
                            void window.akari.frameEngineClock?.applyLivePreview?.(message);
                            if (cut) {
                                media.dataset.akariCutLayerStyleActive = 'true';
                                media.dataset.akariCutCropDeclared = 'true';
                                window.akari.applyCutLayerStyleLayout?.(media);
                            }
                            else window.akari.updateLayerLayout?.();
                        }
                        return;
                    }
                    for (const [field, value] of values) liveDom.update(targetKey, field, value);
                    if (message.target.kind === 'caption') {
                        paintLiveOverride();
                        updateCaptionSelectBox();
                        return;
                    }
                    // ドラッグ中の ephemeral 反映: summary/segments は一切書き換えず、applyCutVisual/
                    // layerEntries が読む dataset を直接上書きして updateLayerLayout() で再計算させるだけ。
                    // 確定書き込み(pointerup)後は edit.json 変更検知 → queueRefresh() の通常経路で
                    // 正規の HTML に置き換わるため、ここで明示的な「クリア」は不要
                    // （Esc 破棄時は元値を持つ同型メッセージが再送されて上書きされる）。
                    const applyLiveField = element => {
                        for (const [field, value] of values) {
                            if (field === 'x') element.dataset.akariTransformX = String(value);
                            else if (field === 'y') element.dataset.akariTransformY = String(value);
                            else if (field === 'scale') element.dataset.akariTransformScale = String(value);
                            else if (field === 'scaleX') element.dataset.akariTransformScaleX = String(value);
                            else if (field === 'scaleY') element.dataset.akariTransformScaleY = String(value);
                            else if (field === 'rotate') element.dataset.akariTransformRotate = String(value);
                            else if (field === 'opacity') element.style.opacity = String(value);
                            else if (field === 'crop.x') element.dataset.akariCropX = String(value);
                            else if (field === 'crop.y') element.dataset.akariCropY = String(value);
                            else if (field === 'crop.w') element.dataset.akariCropW = String(value);
                            else if (field === 'crop.h') element.dataset.akariCropH = String(value);
                        }
                    };
                    const enginePreview = values.length === 1
                        ? window.akari.frameEngineClock?.applyLivePreview?.(message)
                        : window.akari.frameEngineClock?.applyTransformPreview?.(
                            message.target, Object.fromEntries(values));
                    if (message.target.kind === 'cut') {
                        if (values.some(([field]) => field !== 'opacity')) video.dataset.akariCutTransformActive = 'true';
                        applyLiveField(video);
                    } else if (typeof message.target.id === 'string') {
                        const overlay = Array.from(typeof stage !== 'undefined' && stage
                            ? stage.querySelectorAll('[data-overlay-id]') : [])
                            .find(element => element.getAttribute('data-overlay-id') === message.target.id);
                        if (overlay && message.target.kind === 'item') {
                            const nodes = Array.isArray(summary.tree) ? summary.tree : [];
                            const selected = nodes.find(node => String(node.id) === message.target.id);
                            for (const [field, value] of values) {
                                if (selected && ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'].includes(field)) {
                                    let ancestorId = selected.parentId;
                                    let parent = {};
                                    const seen = new Set();
                                    while (ancestorId != null && !seen.has(String(ancestorId))) {
                                        seen.add(String(ancestorId));
                                        const ancestor = nodes.find(node => String(node.id) === String(ancestorId));
                                        if (!ancestor) break;
                                        if (ancestor.kind === 'group') { parent = ancestor.transform || {}; break; }
                                        ancestorId = ancestor.parentId;
                                    }
                                    const inlineNumber = (name, fallback) => {
                                        const value = Number.parseFloat(overlay.style.getPropertyValue?.(name) || '');
                                        return Number.isFinite(value) ? value : fallback;
                                    };
                                    const stored = selected.transform || {};
                                    const inlineScale = Boolean(overlay.style.getPropertyValue?.('--scale')?.trim());
                                    const inlineAxis = ['--scale-x', '--scale-y'].some(name =>
                                        overlay.style.getPropertyValue?.(name)?.trim());
                                    const scale = inlineNumber('--scale', stored.scale ?? 1);
                                    const scaleX = inlineNumber('--scale-x', inlineScale ? scale : stored.scaleX ?? scale);
                                    const scaleY = inlineNumber('--scale-y', inlineScale ? scale : stored.scaleY ?? scale);
                                    const world = {
                                        x: inlineNumber('--x', stored.x ?? 0),
                                        y: inlineNumber('--y', stored.y ?? 0),
                                        scale: inlineAxis && scaleX === scaleY ? scaleX : scale,
                                        ...((inlineAxis || !inlineScale && (stored.scaleX !== undefined || stored.scaleY !== undefined))
                                            && scaleX !== scaleY ? { scaleX, scaleY } : {}),
                                        rotate: inlineNumber('--rotate', stored.rotate ?? 0)
                                    };
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
                                    if (field === 'scale') {
                                        const previous = Math.sqrt(local.scaleX * local.scaleY);
                                        const ratio = previous > 0 ? value / previous : 1;
                                        local.scaleX *= ratio;
                                        local.scaleY *= ratio;
                                        local.scale = value;
                                    } else local[field] = value;
                                    const sx = parentScale * (local.scaleX ?? local.scale ?? 1);
                                    const sy = parentScale * (local.scaleY ?? local.scale ?? 1);
                                    const next = {
                                        x: (parent.x ?? 0) + parentScale * (cosine * local.x - sine * local.y),
                                        y: (parent.y ?? 0) + parentScale * (sine * local.x + cosine * local.y),
                                        scale: sx === sy ? sx : parentScale * (local.scale ?? 1),
                                        scaleX: sx, scaleY: sy,
                                        rotate: (parent.rotate ?? 0) + local.rotate
                                    };
                                    overlay.style.setProperty('--x', String(next.x) + 'px');
                                    overlay.style.setProperty('--y', String(next.y) + 'px');
                                    overlay.style.setProperty('--scale', String(next.scale));
                                    if (sx === sy) {
                                        overlay.style.removeProperty('--scale-x');
                                        overlay.style.removeProperty('--scale-y');
                                    } else {
                                        overlay.style.setProperty('--scale-x', String(next.scaleX));
                                        overlay.style.setProperty('--scale-y', String(next.scaleY));
                                    }
                                    overlay.style.setProperty('--rotate', String(next.rotate) + 'deg');
                                }
                                if (!selected && ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'].includes(field)) {
                                    const name = field === 'scaleX' ? '--scale-x'
                                        : field === 'scaleY' ? '--scale-y' : '--' + field;
                                    overlay.style.setProperty(name, String(value)
                                        + (field === 'x' || field === 'y' ? 'px'
                                            : field === 'rotate' ? 'deg' : ''));
                                }
                                if (field === 'opacity') overlay.style.opacity = String(value);
                            }
                            liveDom.captureOverlayCss(overlay);
                        }
                        if (message.target.kind === 'item' && video.dataset.akariCutId === message.target.id) {
                            if (values.some(([field]) => field !== 'opacity')) video.dataset.akariCutTransformActive = 'true';
                            applyLiveField(video);
                        } else {
                            const layerIdSelector = CSS.escape(message.target.id);
                            const layerVideo = layersStage.querySelector(
                                'video[data-akari-layer-id="' + layerIdSelector + '"], img[data-akari-layer-id="' + layerIdSelector + '"]'
                            );
                            if (layerVideo) applyLiveField(layerVideo);
                        }
                    }
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                    updateLayerSelectBox();
                    paintLiveOverride();
                    if (enginePreview) void Promise.resolve(enginePreview).then(() => {
                        if (liveDom.key() === targetKey) {
                            paintLiveOverride();
                            window.akari.updateLayerLayout?.();
                        }
                    });
                    return;
                }
            });

            let lastReportedOverlayId = null;
            let lastReportedOverlayIds = [];
            const reportOverlaySelectionChange = (force = false, notify = true) => {
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const interaction = window.akari.interaction;
                const selectedOverlayId = interaction?.hasSelectionTree ? interaction.selectedId
                    : selected?.getAttribute('data-overlay-id') || null;
                const selectedOverlayIds = interaction?.hasSelectionTree ? interaction.selectedIds
                    : selectedOverlayId ? [selectedOverlayId] : [];
                if (selectedOverlayId !== lastReportedOverlayId || force === true
                    || selectedOverlayIds.length !== lastReportedOverlayIds.length
                    || selectedOverlayIds.some((id, index) => id !== lastReportedOverlayIds[index])) {
                    if ((typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection)
                        || (typeof selectedMixedGroup !== 'undefined'
                            && selectedMixedGroup.length > 1 && (!force || !notify))
                        || (requestedOverlayId && !selectedOverlayId && !force)) {
                        lastReportedOverlayId = selectedOverlayId;
                        lastReportedOverlayIds = [...selectedOverlayIds];
                        return;
                    }
                    if (!selectedOverlayId && requestedOverlayId
                        && !overlaySelectionInRange(requestedOverlayId, outputTime)
                        && !(force && notify)) return;
                    lastReportedOverlayId = selectedOverlayId;
                    lastReportedOverlayIds = [...selectedOverlayIds];
                    if (selectedOverlayId && !(typeof applyingMixedSelection !== 'undefined' && applyingMixedSelection)) {
                        requestedCutId = undefined;
                        selectLayer(null, { report: false });
                        deselectCut({ report: false });
                        if (selectedCaptionId) deselectCaption();
                    }
                    requestedOverlayId = selectedOverlayId || undefined;
                    if (notify && selectedOverlayId !== applyingOverlaySelection) {
                        if (typeof selectedMixedGroup !== 'undefined') selectedMixedGroup = [];
                        if (interaction?.hasSelectionTree) window.akari.reportOverlaySelection(selectedOverlayId, interaction.scopeId, selectedOverlayIds);
                        else window.akari.reportOverlaySelection(selectedOverlayId);
                    }
                }
            };
            window.addEventListener('akari-preview-scope-selection', event => {
                reportOverlaySelectionChange(true, event.detail?.notify !== false);
            });
            stage.addEventListener('click', event => {
                if (event.isTrusted && event.target.closest?.('[data-overlay-id]')) {
                    queueMicrotask(() => reportOverlaySelectionChange(true));
                }
            }, true);
            new MutationObserver(reportOverlaySelectionChange).observe(stage, {
                attributes: true,
                attributeFilter: ['data-akari-interaction-selected'],
                subtree: true
            });

            let motionDraw = null;
            let motionStroke = null;
            const motionDrawFps = Number(summary.output.fps) || 30;
            const motionDrawFinishTransitionFn = (${motionDrawFinishTransition.toString()});
            const motionDrawPointerOwnershipFn = (${createMotionDrawPointerOwnership.toString()});
            const motionDrawPointerOwnership = motionDrawPointerOwnershipFn(() => window.akari.interaction);
            let motionDrawFinishState = { pointerId: null, claimed: false };
            const stopMotionDraw = () => {
                motionDrawFinishState = { pointerId: null, claimed: true };
                motionDrawPointerOwnership.stop();
                if (motionStroke && previewPane.hasPointerCapture?.(motionStroke.pointerId)) {
                    previewPane.releasePointerCapture(motionStroke.pointerId);
                }
                motionDraw?.feedback.dispose();
                motionDraw = null; motionStroke = null;
                previewPane.style.cursor = ''; previewPane.title = '';
            };
            const motionDrawSpec = draw => {
                const spec = draw.kind === 'layer' ? draw.layer.spec
                    : draw.kind === 'cut' ? summary.cuts[draw.cutIndex]
                    : draw.kind === 'canvas' ? draw.node : draw.overlay;
                const cutSpan = draw.kind === 'cut' ? cutInteractionSegment() : null;
                const at = Number(spec.motionSource?.at ?? (draw.kind === 'layer' ? spec.t
                    : draw.kind === 'cut' ? cutSpan?.outStart : spec.at ?? spec.start)) || 0;
                const duration = Number(spec.motionSource?.duration ?? spec.duration
                    ?? (cutSpan ? cutSpan.outEnd - at : 0)) || 0;
                const source = spec.motionSource
                    ? { ...spec.motionSource, fps: motionDrawFps }
                    : { at, duration, fps: motionDrawFps, keyframeUnit: 'seconds',
                        transform: draw.kind === 'canvas' ? spec.localTransform : spec.transform,
                        opacity: spec.opacity, keyframes: spec.keyframes, motion: spec.motion };
                let parents = (spec.motionParents ?? []).map(parent => ({ ...parent, fps: motionDrawFps }));
                if (draw.kind === 'canvas') {
                    const nodes = summary.tree || [];
                    let parentId = spec.parentId;
                    parents = [];
                    while (parentId) {
                        const parent = nodes.find(node => node.id === parentId);
                        if (!parent) break;
                        if (parent.kind === 'group') parents.push({ at: parent.at, duration: parent.duration,
                            fps: motionDrawFps, keyframeUnit: 'seconds', transform: parent.localTransform,
                            opacity: parent.opacity, keyframes: parent.keyframes, motion: parent.motion });
                        parentId = parent.parentId;
                    }
                }
                return { spec, at, duration, source, parents };
            };
            const motionDrawRangeText = (range, existing) => {
                const seconds = value => String(Math.round(value * 10) / 10);
                return range ? '位置の点 ' + seconds(range.start) + '〜' + seconds(range.end)
                    + ' 秒を置き換えます（Esc でやめる）'
                    : existing ? '今の位置の点 ' + seconds(existing.start) + '〜' + seconds(existing.end)
                        + ' 秒があります。描く範囲を置き換えます（Esc でやめる）'
                    : 'プレビューで道筋を描きます（Esc でやめる）';
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (message?.type !== 'akari-preview-motion-draw' || typeof message.itemId !== 'string') return;
                stopMotionDraw();
                const layer = findLayerEntry(message.itemId);
                const cutIndex = summary.cuts.findIndex(cut => cut.id === message.itemId);
                const overlay = summary.overlays.find(item => item.id === message.itemId);
                const node = (summary.tree || []).find(item => item.id === message.itemId && item.kind === 'group');
                if (!layer && cutIndex < 0 && !overlay && !node) return;
                if (cropModeActive) setCropMode(false);
                if (photoSelect?.itemId) window.akari.reportPhotoSelectEnd(photoSelect.itemId);
                if (photoBrush) window.akari.reportPhotoBrushEnd?.();
                photoSelect = null;
                photoBrush = null;
                photoStroke = null;
                hidePhotoBrushUi();
                layerSelectBox.classList.remove('akari-photo-pointer-mode');
                cutSelectBox.classList.remove('akari-photo-pointer-mode');
                layerSelectBox.style.cursor = '';
                layerSelectBox.title = '';
                cutSelectBox.style.cursor = '';
                cutSelectBox.title = '';
                photoHighlightCanvas?.remove(); photoHighlightCanvas = null;
                const feedback = window.akari.motionStroke.createStrokeFeedback();
                motionDraw = layer ? { kind: 'layer', id: message.itemId, layer, feedback }
                    : cutIndex >= 0 ? { kind: 'cut', id: message.itemId, cutIndex, feedback }
                    : node ? { kind: 'canvas', id: message.itemId, node, feedback }
                    : { kind: 'overlay', id: message.itemId, overlay, feedback };
                if (layer) selectLayer(message.itemId);
                else if (cutIndex >= 0) { requestedCutId = message.itemId; selectCut({ report: false }); }
                else { requestedOverlayId = message.itemId; applyRequestedOverlaySelection(); }
                const { spec } = motionDrawSpec(motionDraw);
                const existing = window.akari.motionStroke.positionKeyframeRange(spec.keyframes,
                    motionDrawFps, spec.keyframeUnit || 'seconds');
                motionDraw.existing = existing;
                feedback.show(motionDrawRangeText(null, existing));
                previewPane.style.cursor = 'crosshair';
                previewPane.title = '道筋を描きます。Esc で終わります';
                motionDrawPointerOwnership.start();
            });
            window.addEventListener('message', event => {
                const message = event.data;
                const selected = message?.selection?.id ?? message?.layerId ?? message?.overlayId;
                if (motionDraw && ['akari-preview-select-primary', 'akari-preview-select-overlay',
                    'akari-preview-select-layer'].includes(message?.type) && selected && selected !== motionDraw.id) stopMotionDraw();
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && (motionDraw || motionDrawPointerOwnership.armed)) stopMotionDraw();
            });
            const motionDrawBox = draw => draw.kind === 'layer' ? layerSelectBox
                : draw.kind === 'cut' ? cutSelectBox
                : document.querySelector('[data-akari-interaction="selection-frame"]')
                    || Array.from(stage.querySelectorAll('[data-overlay-id]'))
                        .find(element => element.dataset.overlayId === draw.id)
                    || previewPane;
            const onMotionDrawPointerDown = event => {
                if (!motionDraw || event.button !== 0) return;
                if (event.target?.closest?.('button, [role="button"], input, textarea, select, a[href]')) return;
                event.preventDefault(); event.stopImmediatePropagation();
                const rect = motionDrawBox(motionDraw).getBoundingClientRect();
                if (event.clientX < rect.left || event.clientX > rect.right
                    || event.clientY < rect.top || event.clientY > rect.bottom) return;
                const point = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                if (!point) return;
                previewPane.setPointerCapture(event.pointerId);
                const details = motionDrawSpec(motionDraw);
                const visible = window.akari.itemMotion.evaluateItemMotion(details.source,
                    outputTime, details.parents);
                motionStroke = { pointerId: event.pointerId, startTime: outputTime,
                    offsetX: visible.x - (point.x - summary.output.width / 2),
                    offsetY: visible.y - (point.y - summary.output.height / 2),
                    samples: [{ x: visible.x, y: visible.y, ms: 0 }],
                    screen: [{ x: event.clientX, y: event.clientY }], started: performance.now() };
                motionDrawFinishState = { pointerId: event.pointerId, claimed: false };
            };
            window.addEventListener('pointerdown', () => {
                if (motionDraw) motionDrawPointerOwnership.start();
            }, true);
            previewPane.addEventListener('pointerdown', onMotionDrawPointerDown, true);
            const recordMotionDrawPoint = event => {
                if (!motionStroke || event.pointerId !== motionStroke.pointerId) return;
                const point = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                if (!point) return;
                motionStroke.samples.push({ x: point.x - summary.output.width / 2 + motionStroke.offsetX,
                    y: point.y - summary.output.height / 2 + motionStroke.offsetY,
                    ms: performance.now() - motionStroke.started });
                motionStroke.screen.push({ x: event.clientX, y: event.clientY });
                motionDraw.feedback.draw(motionStroke.screen);
                const details = motionDrawSpec(motionDraw);
                const start = Math.max(0, motionStroke.startTime - details.at);
                const end = Math.min(details.duration, start + motionStroke.samples.at(-1).ms / 1000);
                motionDraw.feedback.show(motionDrawRangeText({ start, end }, motionDraw.existing));
            };
            const finishMotionDraw = event => {
                if (!motionStroke || !motionDraw) return;
                const decision = motionDrawFinishTransitionFn(motionDrawFinishState, event);
                if (!decision.finish) return;
                motionDrawFinishState = decision.state;
                event.preventDefault(); event.stopImmediatePropagation();
                const draw = motionDraw, stroke = motionStroke;
                try {
                    if (event.type === 'pointerup') recordMotionDrawPoint(event);
                    const { at, duration, source, parents } = motionDrawSpec(draw);
                    const samples = stroke.samples.map(sample => ({
                        ...window.akari.itemMotion.invertItemMotionPosition(source,
                            stroke.startTime + sample.ms / 1000, parents, sample.x, sample.y), ms: sample.ms
                    }));
                    let points = window.akari.motionStroke.strokeToXYKeyframes(samples, {
                        fps: motionDrawFps, startFrame: Math.round((stroke.startTime - at) * motionDrawFps),
                        durationFrames: Math.round(duration * motionDrawFps), mode: 'speed'
                    });
                    if (draw.kind === 'layer' && parents.length) {
                        points = points.map(point => ({ ...point, transform: (() => {
                            const position = window.akari.itemMotion.evaluateItemMotion({
                                at, duration, fps: motionDrawFps, transform: point.transform
                            }, at + point.t / motionDrawFps, parents);
                            return { x: position.x, y: position.y };
                        })() }));
                    }
                    stopMotionDraw();
                    if (points.length < 2) throw new Error('道筋をもう少し長く描いてください。');
                    void (async () => {
                        try {
                            if (draw.kind === 'layer') await window.akari.engine.layerWrite(draw.id, { xyKeyframes: points });
                            else if (draw.kind === 'cut') await window.akari.engine.cutWrite(draw.cutIndex, draw.id, { xyKeyframes: points });
                            else await window.akari.engine.overlayWrite(null, draw.id, { xyKeyframes: points });
                        } catch (error) { window.akari.showWriteError(error); }
                    })();
                } catch (error) {
                    stopMotionDraw();
                    window.akari.showWriteError(error);
                }
            };
            window.addEventListener('pointerup', finishMotionDraw, true);
            previewPane.addEventListener('pointerup', finishMotionDraw, true);
            previewPane.addEventListener('lostpointercapture', finishMotionDraw, true);
            window.addEventListener('mouseup', finishMotionDraw, true);
            window.addEventListener('pointermove', finishMotionDraw, true);
            window.addEventListener('mousemove', finishMotionDraw, true);
            previewPane.addEventListener('pointermove', event => {
                if (!motionStroke || event.pointerId !== motionStroke.pointerId) return;
                if (motionDrawFinishTransitionFn(motionDrawFinishState, event).finish) {
                    finishMotionDraw(event);
                    return;
                }
                event.preventDefault(); event.stopImmediatePropagation();
                recordMotionDrawPoint(event);
            }, true);
            window.addEventListener('pointercancel', () => {
                if (motionDraw) stopMotionDraw();
            }, true);

            Promise.all([window.__akariCaptionFontReady, window.akari.runtime.mount(summary), sfxDurationsReady]).then(() => {
                applyOverlayTracks();
                stage.append(transitionPlate, transitionFallbackLabel, captionLayer);
                stage.append(emptyCanvasHint);
                refreshIndicators();
                rebuildSegments();
                prepareScrubAudioSources();
                applyInitialPosition();
                window.akari.updateEmptyCanvasHint?.(outputTime);
                restoreInitialPlayback();
                setZoom(1);
                tick();
                reportOverlaySelectionChange();
                applyRequestedOverlaySelection();
                window.akari.reportPrimarySelectionReady();
                playbackMountReady = true;
                if (!initialPositionApplied) {
                    applyInitialPosition();
                    if (initialPositionApplied) tick(true);
                }
            }).catch(error => console.error('[akari-preview] overlay mount failed', error));
        })();`;
}
