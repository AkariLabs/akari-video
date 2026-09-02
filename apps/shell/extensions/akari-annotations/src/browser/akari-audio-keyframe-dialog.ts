import { AbstractDialog, DialogError, DialogMode, DialogProps } from '@theia/core/lib/browser/dialogs';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { AudioEnvelopeKeyframePayload } from '../common/akari-annotations-protocol';
import {
    AUDIO_KEYFRAME_MAX_DB,
    AUDIO_KEYFRAME_MIN_DB,
    audioKeyframeDbToPx,
    audioKeyframeDbToLinearGain,
    audioKeyframeEffectiveGainDb,
    audioKeyframeMaximumZoom,
    audioKeyframePxToDb,
    audioKeyframePxToTime,
    audioKeyframeScrollWindow,
    audioKeyframeSeekBarHitTest,
    audioKeyframeTimeToPx,
    audioKeyframeTimeToViewPx,
    audioKeyframeViewPxToTime,
    audioKeyframeZoomWindow,
    normalizeAudioKeyframeGainDb,
    snapAudioKeyframeTime,
    validateAudioKeyframeTime
} from '../common/audio-keyframe-editor-geometry';
import {
    AudioWaveformDebounceGate,
    AudioWaveformWindow,
    audioLoudnessBucketColors,
    audioLoopTilePeaks,
    audioSourceSliceWindow,
    audioWaveformPrefetchWindow,
    audioWaveformTierBucketCount,
    audioWaveformWindowContains,
    waveformHeightForPeak
} from '../common/filmstrip-geometry';

const EDITOR_WIDTH_PX = 760;
const EDITOR_HEIGHT_PX = 180;
const WAVEFORM_HEIGHT_PX = 140;
const SEEK_BAR_HEIGHT_PX = 14;
const DB_GRID_VALUES = [6, 0, -6, -12, -24] as const;
const POINT_HIT_RADIUS_PX = 9;
const EASING_VALUES = ['linear', 'hold', 'ease-in-out'] as const;

type AudioKeyframeEasing = typeof EASING_VALUES[number];

interface EditableAudioKeyframe {
    t: number;
    gainDb: number;
    easing: AudioKeyframeEasing;
}

export interface AudioKeyframeWaveformRequest {
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly bucketCount: number;
}

interface DetailedWaveform {
    readonly sourceWindow: AudioWaveformWindow;
    readonly peaks: readonly number[];
}

export interface AkariAudioKeyframeDialogProps extends DialogProps {
    readonly audioUri: string;
    readonly audioKind: 'bgm' | 'sfx' | 'narration';
    readonly durationSeconds: number;
    readonly sourceDurationSeconds: number;
    readonly sourceInSeconds?: number;
    readonly speed?: number;
    readonly fps: number;
    readonly keyframeFrames: boolean;
    readonly keyframes?: readonly AudioEnvelopeKeyframePayload[];
    readonly gainDb?: number;
    readonly fadeIn?: number;
    readonly fadeOut?: number;
    readonly fullPeaks: readonly number[];
    readonly fetchWaveform: (request: AudioKeyframeWaveformRequest) => Promise<readonly number[] | undefined>;
}

export interface AkariAudioKeyframeDialogValue {
    readonly keyframes: AudioEnvelopeKeyframePayload[];
    readonly gainDb: number;
}

/** 波形の上で音量エンベロープだけを編集する、通常 DOM の Theia ダイアログ。 */
export class AkariAudioKeyframeDialog extends AbstractDialog<AkariAudioKeyframeDialogValue> {

    protected readonly stage = document.createElement('div');
    protected readonly canvas = document.createElement('canvas');
    protected readonly editorRow = document.createElement('div');
    protected readonly overallGainInput = document.createElement('input');
    protected readonly timeInput = document.createElement('input');
    protected readonly gainInput = document.createElement('input');
    protected readonly easingInput = document.createElement('select');
    protected readonly deleteButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly playbackStatus = document.createElement('div');
    protected readonly ctx: CanvasRenderingContext2D;
    protected readonly points: EditableAudioKeyframe[];
    protected readonly audio: HTMLAudioElement;
    protected readonly audioContext: AudioContext;
    protected readonly audioSource: MediaElementAudioSourceNode;
    protected readonly playbackGain: GainNode;
    protected readonly detailDebounceGate = new AudioWaveformDebounceGate(200);
    protected readonly detailedWaveforms = new Map<string, DetailedWaveform>();
    protected readonly detailInFlight = new Set<string>();

    protected overallGainDb: number;
    protected selectedIndex: number | undefined;
    protected activePointerId: number | undefined;
    protected activeSeekPointerId: number | undefined;
    protected canvasWidth = EDITOR_WIDTH_PX;
    protected canvasHeight = EDITOR_HEIGHT_PX;
    protected canvasDpr = 1;
    protected currentTimeSeconds = 0;
    protected viewStartSeconds = 0;
    protected viewEndSeconds = 0;
    protected playbackFrame: number | undefined;
    protected detailTimer: number | undefined;
    protected playbackDisposed = false;

    protected readonly dialogKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        } else if ((event.key === 'Delete' || event.key === 'Backspace')
            && !this.isEditorInput(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            this.deleteSelectedPoint();
        } else if ((event.key === ' ' || event.code === 'Space') && !this.isEditorInput(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            void this.togglePlayback();
        }
    };

    constructor(protected readonly props: AkariAudioKeyframeDialogProps) {
        super(props);
        this.ctx = this.canvas.getContext('2d')!;
        this.viewEndSeconds = Math.max(0, props.durationSeconds);
        this.audio = new Audio(props.audioUri);
        this.audio.preload = 'auto';
        this.audio.playbackRate = this.playbackSpeed();
        this.audioContext = new AudioContext();
        this.audioSource = this.audioContext.createMediaElementSource(this.audio);
        this.playbackGain = this.audioContext.createGain();
        this.audioSource.connect(this.playbackGain);
        this.playbackGain.connect(this.audioContext.destination);
        this.overallGainDb = normalizeAudioKeyframeGainDb(props.gainDb);
        this.points = (props.keyframes ?? [])
            .filter(point => Number.isFinite(point.t))
            .map(point => {
                const rawT = props.keyframeFrames ? point.t / props.fps : point.t;
                const rawGainDb = typeof point.gain_db === 'number' && Number.isFinite(point.gain_db)
                    ? point.gain_db : 0;
                return {
                    t: Math.max(0, Math.min(props.durationSeconds, rawT)),
                    gainDb: Math.max(AUDIO_KEYFRAME_MIN_DB, Math.min(AUDIO_KEYFRAME_MAX_DB, rawGainDb)),
                    easing: this.validEasing(point.easing)
                };
            })
            .sort((left, right) => left.t - right.t);
        this.wirePlayback();
        this.buildDom();
    }

    protected buildDom(): void {
        this.contentNode.classList.add('akari-audio-keyframe-dialog');
        Object.assign(this.stage.style, {
            position: 'relative',
            width: `${EDITOR_WIDTH_PX}px`,
            height: `${EDITOR_HEIGHT_PX}px`,
            maxWidth: '100%',
            background: 'var(--theia-editor-background)',
            border: '1px solid var(--theia-widget-border)',
            borderRadius: '4px',
            overflow: 'hidden',
            flexShrink: '0'
        });
        Object.assign(this.canvas.style, {
            position: 'absolute', inset: '0', width: '100%', height: '100%',
            cursor: 'crosshair', touchAction: 'none'
        });
        this.canvas.setAttribute('aria-label', '音量キーフレーム波形エディタ');
        this.stage.appendChild(this.canvas);
        this.contentNode.appendChild(this.stage);

        Object.assign(this.editorRow.style, {
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr auto',
            alignItems: 'end', gap: '8px', marginTop: '10px'
        });
        this.configureNumberInput(this.overallGainInput, '全体ゲイン', '0.5');
        this.configureNumberInput(this.timeInput, 't 秒', '0.001');
        this.configureNumberInput(this.gainInput, 'gain_db', '0.1');
        this.overallGainInput.min = String(AUDIO_KEYFRAME_MIN_DB);
        this.overallGainInput.max = String(AUDIO_KEYFRAME_MAX_DB);
        this.overallGainInput.value = String(this.overallGainDb);
        this.timeInput.min = '0';
        this.timeInput.max = String(this.props.durationSeconds);
        this.gainInput.min = String(AUDIO_KEYFRAME_MIN_DB);
        this.gainInput.max = String(AUDIO_KEYFRAME_MAX_DB);
        this.easingInput.setAttribute('aria-label', 'easing');
        for (const easing of EASING_VALUES) {
            const option = document.createElement('option');
            option.value = easing;
            option.textContent = easing;
            this.easingInput.appendChild(option);
        }
        this.deleteButton.type = 'button';
        this.deleteButton.className = 'theia-button secondary';
        this.deleteButton.textContent = '選択点を削除';
        this.deleteButton.addEventListener('click', () => this.deleteSelectedPoint());
        this.editorRow.append(
            this.labeledControl('全体ゲイン (dB)', this.overallGainInput),
            this.labeledControl('t 秒', this.timeInput),
            this.labeledControl('gain_db', this.gainInput),
            this.labeledControl('easing', this.easingInput),
            this.deleteButton
        );
        this.contentNode.appendChild(this.editorRow);

        Object.assign(this.playbackStatus.style, {
            display: 'none', color: 'var(--theia-errorForeground)',
            fontSize: '12px', minHeight: '16px', margin: '6px 0 0'
        });
        this.playbackStatus.setAttribute('role', 'status');
        this.contentNode.appendChild(this.playbackStatus);

        Object.assign(this.notice.style, {
            display: 'none', color: 'var(--theia-errorForeground)',
            fontSize: '12px', minHeight: '16px', margin: '6px 0 0'
        });
        this.notice.setAttribute('role', 'alert');
        this.contentNode.appendChild(this.notice);

        this.overallGainInput.addEventListener('input', () => this.commitOverallGainInput());
        this.timeInput.addEventListener('change', () => this.commitTimeInput());
        this.gainInput.addEventListener('change', () => this.commitGainInput());
        this.easingInput.addEventListener('change', () => this.commitEasingInput());
        this.wirePointerEvents();
        this.syncSelectedControls();
        this.appendAcceptButton('適用');
        this.appendCloseButton('キャンセル');
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        this.setupCanvas();
        window.addEventListener('keydown', this.dialogKeydown, true);
        this.scheduleDetailedWaveform();
    }

    protected override onBeforeDetach(message: Message): void {
        window.removeEventListener('keydown', this.dialogKeydown, true);
        this.disposePlayback();
        super.onBeforeDetach(message);
    }

    protected setupCanvas(): void {
        const rect = this.stage.getBoundingClientRect();
        this.canvasWidth = Math.max(1, Math.round(rect.width));
        this.canvasHeight = Math.max(1, Math.round(rect.height));
        this.canvasDpr = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.canvasWidth * this.canvasDpr);
        this.canvas.height = Math.round(this.canvasHeight * this.canvasDpr);
        this.canvas.style.width = `${this.canvasWidth}px`;
        this.canvas.style.height = `${this.canvasHeight}px`;
        this.ctx.setTransform(this.canvasDpr, 0, 0, this.canvasDpr, 0, 0);
        this.redraw();
    }

    protected wirePointerEvents(): void {
        this.canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.activePointerId !== undefined
                || this.activeSeekPointerId !== undefined) return;
            event.preventDefault();
            const point = this.canvasPoint(event);
            if (audioKeyframeSeekBarHitTest(point.y, SEEK_BAR_HEIGHT_PX)) {
                this.activeSeekPointerId = event.pointerId;
                this.canvas.setPointerCapture(event.pointerId);
                this.seekToCanvasX(point.x);
                return;
            }
            const hitIndex = this.hitTestPoint(point.x, point.y);
            if (hitIndex !== undefined) {
                this.selectPoint(hitIndex);
                this.activePointerId = event.pointerId;
                this.canvas.setPointerCapture(event.pointerId);
                return;
            }
            const fitTime = audioKeyframePxToTime(point.x, this.props.durationSeconds, this.canvasWidth);
            const t = snapAudioKeyframeTime(
                this.isFitToWidthView() ? fitTime : audioKeyframeViewPxToTime(
                    point.x, this.viewStartSeconds, this.viewEndSeconds, this.canvasWidth
                ),
                this.props.fps,
                this.props.durationSeconds
            );
            const validation = validateAudioKeyframeTime(this.points, t);
            if ('message' in validation) {
                this.showNotice(validation.message);
                return;
            }
            this.points.push({
                t,
                gainDb: this.editableGainDbAtY(point.y),
                easing: 'linear'
            });
            this.points.sort((left, right) => left.t - right.t);
            this.selectPoint(this.points.findIndex(candidate => candidate.t === t));
            this.hideNotice();
            this.redraw();
        });
        this.canvas.addEventListener('pointermove', event => {
            if (this.activeSeekPointerId === event.pointerId) {
                event.preventDefault();
                this.seekToCanvasX(this.canvasPoint(event).x);
                return;
            }
            if (this.activePointerId !== event.pointerId || this.selectedIndex === undefined) return;
            event.preventDefault();
            const point = this.canvasPoint(event);
            const fitTime = audioKeyframePxToTime(point.x, this.props.durationSeconds, this.canvasWidth);
            const t = snapAudioKeyframeTime(
                this.isFitToWidthView() ? fitTime : audioKeyframeViewPxToTime(
                    point.x, this.viewStartSeconds, this.viewEndSeconds, this.canvasWidth
                ),
                this.props.fps,
                this.props.durationSeconds
            );
            const validation = validateAudioKeyframeTime(this.points, t, this.selectedIndex);
            if ('message' in validation) {
                this.showNotice(validation.message);
                return;
            }
            const selected = this.points[this.selectedIndex];
            selected.t = t;
            selected.gainDb = this.editableGainDbAtY(point.y);
            this.points.sort((left, right) => left.t - right.t);
            this.selectedIndex = this.points.indexOf(selected);
            this.hideNotice();
            this.syncSelectedControls();
            this.redraw();
        });
        const finish = (event: PointerEvent): void => {
            if (this.activePointerId !== event.pointerId && this.activeSeekPointerId !== event.pointerId) return;
            if (this.canvas.hasPointerCapture(event.pointerId)) {
                this.canvas.releasePointerCapture(event.pointerId);
            }
            if (this.activePointerId === event.pointerId) this.activePointerId = undefined;
            if (this.activeSeekPointerId === event.pointerId) this.activeSeekPointerId = undefined;
        };
        this.canvas.addEventListener('pointerup', finish);
        this.canvas.addEventListener('pointercancel', finish);
        this.canvas.addEventListener('wheel', event => this.handleWheel(event), { passive: false });
    }

    protected redraw(): void {
        this.updatePlaybackGain();
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.ctx.fillStyle = '#111827';
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.paintWaveform();
        this.paintDbGrid();
        this.paintEnvelope();
        this.paintSeekBar();
        this.paintPlaybackHead();
    }

    protected paintWaveform(): void {
        const peaks = this.displayPeaks();
        if (peaks.length === 0) return;
        const centerY = SEEK_BAR_HEIGHT_PX + (this.canvasHeight - SEEK_BAR_HEIGHT_PX) / 2;
        const maxHalfHeight = Math.min(WAVEFORM_HEIGHT_PX, this.canvasHeight - SEEK_BAR_HEIGHT_PX) / 2;
        const colors = audioLoudnessBucketColors(peaks, {
            gainDb: this.overallGainDb,
            keyframes: this.points,
            fadeInSeconds: this.props.fadeIn,
            fadeOutSeconds: this.props.fadeOut,
            durationSeconds: this.props.durationSeconds,
            bucketStartSeconds: this.viewStartSeconds,
            bucketDurationSeconds: this.viewEndSeconds - this.viewStartSeconds
        });
        this.ctx.globalAlpha = .24;
        for (let x = 0; x < this.canvasWidth; x += 1) {
            const bucket = Math.min(peaks.length - 1, Math.floor(x / this.canvasWidth * peaks.length));
            this.ctx.fillStyle = colors[bucket];
            const halfHeight = waveformHeightForPeak(peaks[bucket]) * maxHalfHeight;
            this.ctx.fillRect(x, centerY - halfHeight, 1, halfHeight * 2);
        }
        this.ctx.globalAlpha = 1;
    }

    protected paintDbGrid(): void {
        this.ctx.font = '10px sans-serif';
        for (const db of DB_GRID_VALUES) {
            const y = audioKeyframeDbToPx(db, this.canvasHeight);
            this.ctx.beginPath();
            this.ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,.68)' : 'rgba(255,255,255,.2)';
            this.ctx.lineWidth = db === 0 ? 1.5 : 1;
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvasWidth, y);
            this.ctx.stroke();
            this.ctx.fillStyle = db === 0 ? '#ffffff' : 'rgba(255,255,255,.72)';
            this.ctx.fillText(`${db > 0 ? '+' : ''}${db} dB`, 5, Math.max(11, y - 3));
        }
    }

    protected paintEnvelope(): void {
        if (this.points.length > 1) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#f8fafc';
            this.ctx.lineWidth = 2;
            const first = this.points[0];
            this.ctx.moveTo(
                this.timeToCanvasPx(first.t),
                audioKeyframeDbToPx(this.displayGainDb(first), this.canvasHeight)
            );
            for (let index = 1; index < this.points.length; index += 1) {
                const previous = this.points[index - 1];
                const current = this.points[index];
                const x = this.timeToCanvasPx(current.t);
                const y = audioKeyframeDbToPx(this.displayGainDb(current), this.canvasHeight);
                if (previous.easing === 'hold') {
                    this.ctx.lineTo(x, audioKeyframeDbToPx(this.displayGainDb(previous), this.canvasHeight));
                }
                this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();
        }
        this.points.forEach((point, index) => {
            const x = this.timeToCanvasPx(point.t);
            const y = audioKeyframeDbToPx(this.displayGainDb(point), this.canvasHeight);
            this.ctx.beginPath();
            this.ctx.arc(x, y, index === this.selectedIndex ? 6 : 4.5, 0, Math.PI * 2);
            this.ctx.fillStyle = index === this.selectedIndex ? '#f59e0b' : '#eafcff';
            this.ctx.fill();
            this.ctx.strokeStyle = '#0891b2';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        });
    }

    protected displayPeaks(): readonly number[] {
        const detailed = this.detailedPeaksForView();
        if (detailed) return detailed;
        let basePeaks: readonly number[];
        if (this.props.audioKind === 'bgm') {
            basePeaks = audioLoopTilePeaks(this.props.fullPeaks, {
                trackDurationSec: this.props.sourceDurationSeconds,
                timelineDurationSec: this.props.durationSeconds,
                inSec: this.props.sourceInSeconds ?? 0,
                speed: this.props.speed,
                maxBuckets: EDITOR_WIDTH_PX * 2
            });
        } else {
            const sourceWindow = audioSourceSliceWindow({
                inSec: this.props.sourceInSeconds ?? 0,
                displayDurationSec: this.props.durationSeconds,
                speed: this.props.speed
            });
            if (this.props.fullPeaks.length === 0 || !(this.props.sourceDurationSeconds > 0)) return [];
            const start = Math.max(0, Math.min(
                this.props.fullPeaks.length,
                Math.floor(sourceWindow.startSec / this.props.sourceDurationSeconds * this.props.fullPeaks.length)
            ));
            const end = Math.max(start + 1, Math.min(
                this.props.fullPeaks.length,
                Math.ceil(sourceWindow.endSec / this.props.sourceDurationSeconds * this.props.fullPeaks.length)
            ));
            basePeaks = this.props.fullPeaks.slice(start, end);
        }
        return this.slicePeaks(
            basePeaks, 0, this.props.durationSeconds, this.viewStartSeconds, this.viewEndSeconds
        );
    }

    protected slicePeaks(
        peaks: readonly number[], domainStart: number, domainEnd: number,
        sliceStart: number, sliceEnd: number
    ): readonly number[] {
        if (peaks.length === 0 || !(domainEnd > domainStart) || !(sliceEnd > sliceStart)) return [];
        const start = Math.max(0, Math.min(
            peaks.length,
            Math.floor((sliceStart - domainStart) / (domainEnd - domainStart) * peaks.length)
        ));
        const end = Math.max(start + 1, Math.min(
            peaks.length,
            Math.ceil((sliceEnd - domainStart) / (domainEnd - domainStart) * peaks.length)
        ));
        return peaks.slice(start, end);
    }

    protected paintSeekBar(): void {
        this.ctx.fillStyle = 'rgba(15,23,42,.92)';
        this.ctx.fillRect(0, 0, this.canvasWidth, SEEK_BAR_HEIGHT_PX);
        this.ctx.strokeStyle = 'rgba(255,255,255,.28)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, SEEK_BAR_HEIGHT_PX - .5);
        this.ctx.lineTo(this.canvasWidth, SEEK_BAR_HEIGHT_PX - .5);
        this.ctx.stroke();
    }

    protected paintPlaybackHead(): void {
        if (this.currentTimeSeconds < this.viewStartSeconds
            || this.currentTimeSeconds > this.viewEndSeconds) return;
        const x = this.timeToCanvasPx(this.currentTimeSeconds);
        this.ctx.strokeStyle = '#22d3ee';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, this.canvasHeight);
        this.ctx.stroke();
        this.ctx.fillStyle = '#22d3ee';
        this.ctx.beginPath();
        this.ctx.arc(x, SEEK_BAR_HEIGHT_PX / 2, 3.5, 0, Math.PI * 2);
        this.ctx.fill();
    }

    protected timeToCanvasPx(t: number): number {
        return this.isFitToWidthView()
            ? audioKeyframeTimeToPx(t, this.props.durationSeconds, this.canvasWidth)
            : audioKeyframeTimeToViewPx(t, this.viewStartSeconds, this.viewEndSeconds, this.canvasWidth);
    }

    protected isFitToWidthView(): boolean {
        return Math.abs(this.viewStartSeconds) < 1e-9
            && Math.abs(this.viewEndSeconds - this.props.durationSeconds) < 1e-9;
    }

    protected seekToCanvasX(x: number): void {
        const requested = audioKeyframeViewPxToTime(
            x, this.viewStartSeconds, this.viewEndSeconds, this.canvasWidth
        );
        this.currentTimeSeconds = Math.min(this.playbackDurationSeconds(), requested);
        this.syncAudioCurrentTime();
        this.updatePlaybackGain();
        this.redraw();
    }

    protected handleWheel(event: WheelEvent): void {
        if (!event.ctrlKey && !event.shiftKey) return;
        event.preventDefault();
        const point = this.canvasPoint(event);
        if (event.ctrlKey) {
            const detailBuckets = Math.max(1, Math.ceil(this.playbackSourceDurationSeconds() * 200));
            const maximumZoom = audioKeyframeMaximumZoom(detailBuckets, this.canvasWidth);
            const window = audioKeyframeZoomWindow(
                { startSeconds: this.viewStartSeconds, endSeconds: this.viewEndSeconds },
                this.props.durationSeconds,
                point.x,
                this.canvasWidth,
                Math.exp(-event.deltaY * .002),
                maximumZoom
            );
            this.viewStartSeconds = window.startSeconds;
            this.viewEndSeconds = window.endSeconds;
        } else {
            const viewDuration = this.viewEndSeconds - this.viewStartSeconds;
            const wheelDelta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
            const delta = wheelDelta / Math.max(1, this.canvasWidth) * viewDuration;
            const window = audioKeyframeScrollWindow(
                { startSeconds: this.viewStartSeconds, endSeconds: this.viewEndSeconds },
                this.props.durationSeconds,
                delta
            );
            this.viewStartSeconds = window.startSeconds;
            this.viewEndSeconds = window.endSeconds;
        }
        this.scheduleDetailedWaveform();
        this.redraw();
    }

    protected playbackSpeed(): number {
        return this.props.speed !== undefined && Number.isFinite(this.props.speed) && this.props.speed > 0
            ? this.props.speed : 1;
    }

    protected playbackSourceStartSeconds(): number {
        return Math.max(0, Math.min(
            this.props.sourceDurationSeconds,
            Number.isFinite(this.props.sourceInSeconds) ? this.props.sourceInSeconds ?? 0 : 0
        ));
    }

    protected playbackSourceDurationSeconds(): number {
        // v1 の BGM も loop させず、in から始まるソース実尺の 1 周目だけを再生する。
        return Math.max(0, Math.min(
            this.props.sourceDurationSeconds - this.playbackSourceStartSeconds(),
            this.props.durationSeconds * this.playbackSpeed()
        ));
    }

    protected playbackDurationSeconds(): number {
        return Math.min(
            Math.max(0, this.props.durationSeconds),
            this.playbackSourceDurationSeconds() / this.playbackSpeed()
        );
    }

    protected visibleSourceWindow(): AudioWaveformWindow | undefined {
        if (this.viewEndSeconds > this.playbackDurationSeconds() + 1e-9) return undefined;
        const sourceStart = this.playbackSourceStartSeconds();
        const speed = this.playbackSpeed();
        const startSeconds = sourceStart + this.viewStartSeconds * speed;
        const endSeconds = sourceStart + this.viewEndSeconds * speed;
        return endSeconds > startSeconds ? { startSeconds, endSeconds } : undefined;
    }

    protected detailedWaveformPlan(): {
        key: string;
        sourceWindow: AudioWaveformWindow;
        bucketCount: number;
        visibleWindow: AudioWaveformWindow;
    } | undefined {
        const visibleWindow = this.visibleSourceWindow();
        if (!visibleWindow) return undefined;
        const sourceStart = this.playbackSourceStartSeconds();
        const sourceWindow = audioWaveformPrefetchWindow({
            visibleWindow,
            sourceWindow: {
                startSeconds: sourceStart,
                endSeconds: sourceStart + this.playbackSourceDurationSeconds()
            },
            fullDurationSeconds: this.props.sourceDurationSeconds
        });
        if (!sourceWindow || !(sourceWindow.endSeconds > sourceWindow.startSeconds)) return undefined;
        const bucketCount = audioWaveformTierBucketCount(
            'T2', this.props.sourceDurationSeconds, sourceWindow.endSeconds - sourceWindow.startSeconds
        );
        const key = `${sourceWindow.startSeconds.toFixed(3)}:${sourceWindow.endSeconds.toFixed(3)}:${bucketCount}`;
        return { key, sourceWindow, bucketCount, visibleWindow };
    }

    protected detailedPeaksForView(): readonly number[] | undefined {
        const plan = this.detailedWaveformPlan();
        if (!plan) return undefined;
        const detailed = this.detailedWaveforms.get(plan.key)
            ?? [...this.detailedWaveforms.values()].find(candidate =>
                audioWaveformWindowContains(candidate.sourceWindow, plan.visibleWindow));
        if (!detailed || !audioWaveformWindowContains(detailed.sourceWindow, plan.visibleWindow)) return undefined;
        return this.slicePeaks(
            detailed.peaks,
            detailed.sourceWindow.startSeconds,
            detailed.sourceWindow.endSeconds,
            plan.visibleWindow.startSeconds,
            plan.visibleWindow.endSeconds
        );
    }

    protected scheduleDetailedWaveform(): void {
        if (this.playbackDisposed || this.props.fullPeaks.length === 0) return;
        const displayed = this.displayPeaks();
        if (displayed.length === 0 || this.canvasWidth / displayed.length <= 3) return;
        const plan = this.detailedWaveformPlan();
        if (!plan || this.detailedWaveforms.has(plan.key) || this.detailInFlight.has(plan.key)) return;
        const decision = this.detailDebounceGate.consider(plan.key, Date.now());
        if (decision.shouldFetch) {
            this.fetchDetailedWaveform(plan);
            return;
        }
        if (decision.waitMs === undefined) return;
        if (this.detailTimer !== undefined) window.clearTimeout(this.detailTimer);
        this.detailTimer = window.setTimeout(() => {
            this.detailTimer = undefined;
            this.scheduleDetailedWaveform();
        }, Math.max(0, Math.ceil(decision.waitMs)));
    }

    protected fetchDetailedWaveform(plan: {
        key: string;
        sourceWindow: AudioWaveformWindow;
        bucketCount: number;
    }): void {
        this.detailInFlight.add(plan.key);
        void this.props.fetchWaveform({
            startSeconds: plan.sourceWindow.startSeconds,
            endSeconds: plan.sourceWindow.endSeconds,
            bucketCount: plan.bucketCount
        }).then(peaks => {
            if (!this.playbackDisposed && peaks && peaks.length > 0) {
                this.detailedWaveforms.set(plan.key, { sourceWindow: plan.sourceWindow, peaks });
            }
        }).catch(() => undefined).finally(() => {
            this.detailInFlight.delete(plan.key);
            this.detailDebounceGate.release(plan.key);
            if (!this.playbackDisposed) this.redraw();
        });
    }

    protected wirePlayback(): void {
        this.audio.addEventListener('loadedmetadata', this.playbackMetadataLoaded);
        this.audio.addEventListener('ended', this.playbackEnded);
        this.audio.addEventListener('error', this.playbackFailed);
        this.updatePlaybackGain();
    }

    protected readonly playbackMetadataLoaded = (): void => {
        this.audio.playbackRate = this.playbackSpeed();
        this.syncAudioCurrentTime();
    };

    protected readonly playbackEnded = (): void => {
        this.syncDisplayTimeFromAudio();
        this.stopPlaybackFrame();
        this.redraw();
    };

    protected readonly playbackFailed = (): void => {
        this.stopPlaybackFrame();
        this.audio.pause();
        this.playbackStatus.textContent = 'この形式は再生未対応';
        this.playbackStatus.style.display = 'block';
    };

    protected async togglePlayback(): Promise<void> {
        if (!this.audio.paused) {
            this.audio.pause();
            this.stopPlaybackFrame();
            this.syncDisplayTimeFromAudio();
            this.redraw();
            return;
        }
        if (this.currentTimeSeconds >= this.playbackDurationSeconds() - 1e-9) {
            this.currentTimeSeconds = 0;
        }
        this.syncAudioCurrentTime();
        this.updatePlaybackGain();
        try {
            await Promise.all([this.audioContext.resume(), this.audio.play()]);
            if (this.playbackDisposed) {
                this.audio.pause();
                return;
            }
            this.startPlaybackFrame();
        } catch {
            if (!this.playbackDisposed) this.playbackFailed();
        }
    }

    protected startPlaybackFrame(): void {
        this.stopPlaybackFrame();
        const update = (): void => {
            this.syncDisplayTimeFromAudio();
            this.updatePlaybackGain();
            if (this.currentTimeSeconds >= this.playbackDurationSeconds() - 1e-6) {
                this.audio.pause();
                this.stopPlaybackFrame();
            } else if (!this.audio.paused) {
                this.playbackFrame = window.requestAnimationFrame(update);
            }
            this.redraw();
        };
        this.playbackFrame = window.requestAnimationFrame(update);
    }

    protected stopPlaybackFrame(): void {
        if (this.playbackFrame === undefined) return;
        window.cancelAnimationFrame(this.playbackFrame);
        this.playbackFrame = undefined;
    }

    protected syncAudioCurrentTime(): void {
        const sourceTime = this.playbackSourceStartSeconds()
            + this.currentTimeSeconds * this.playbackSpeed();
        try {
            this.audio.currentTime = Math.min(this.props.sourceDurationSeconds, sourceTime);
        } catch {
            // metadata 読み込み前は次の seek / play で同じ表示秒から再同期する。
        }
    }

    protected syncDisplayTimeFromAudio(): void {
        const displayTime = (this.audio.currentTime - this.playbackSourceStartSeconds()) / this.playbackSpeed();
        this.currentTimeSeconds = Math.max(0, Math.min(this.playbackDurationSeconds(), displayTime));
    }

    protected updatePlaybackGain(): void {
        const effectiveDb = audioKeyframeEffectiveGainDb(
            this.points, this.currentTimeSeconds, this.overallGainDb
        );
        this.playbackGain.gain.value = audioKeyframeDbToLinearGain(effectiveDb);
        // ducking は他レーンの発話区間に依存し、この素材単体のエディタでは確定できないため除外する。
    }

    protected disposePlayback(): void {
        if (this.playbackDisposed) return;
        this.playbackDisposed = true;
        this.audio.pause();
        this.stopPlaybackFrame();
        if (this.detailTimer !== undefined) {
            window.clearTimeout(this.detailTimer);
            this.detailTimer = undefined;
        }
        this.audio.removeEventListener('loadedmetadata', this.playbackMetadataLoaded);
        this.audio.removeEventListener('ended', this.playbackEnded);
        this.audio.removeEventListener('error', this.playbackFailed);
        void this.audioContext.close().catch(() => undefined);
    }

    protected hitTestPoint(x: number, y: number): number | undefined {
        let closest: { index: number; distance: number } | undefined;
        this.points.forEach((point, index) => {
            const dx = this.timeToCanvasPx(point.t) - x;
            const dy = audioKeyframeDbToPx(this.displayGainDb(point), this.canvasHeight) - y;
            const distance = Math.hypot(dx, dy);
            if (distance <= POINT_HIT_RADIUS_PX && (!closest || distance < closest.distance)) {
                closest = { index, distance };
            }
        });
        return closest?.index;
    }

    protected selectPoint(index: number): void {
        this.selectedIndex = index >= 0 && index < this.points.length ? index : undefined;
        this.syncSelectedControls();
        this.redraw();
    }

    protected deleteSelectedPoint(): void {
        if (this.selectedIndex === undefined) return;
        this.points.splice(this.selectedIndex, 1);
        this.selectedIndex = undefined;
        this.hideNotice();
        this.syncSelectedControls();
        this.redraw();
    }

    protected commitOverallGainInput(): void {
        const value = Number(this.overallGainInput.value);
        if (!Number.isFinite(value)) return;
        this.overallGainDb = normalizeAudioKeyframeGainDb(value);
        this.overallGainInput.value = String(this.overallGainDb);
        this.redraw();
    }

    protected commitTimeInput(): void {
        if (this.selectedIndex === undefined) return;
        const current = this.points[this.selectedIndex];
        const t = snapAudioKeyframeTime(
            Number(this.timeInput.value), this.props.fps, this.props.durationSeconds
        );
        const validation = validateAudioKeyframeTime(this.points, t, this.selectedIndex);
        if ('message' in validation) {
            this.showNotice(validation.message);
            this.syncSelectedControls();
            return;
        }
        current.t = t;
        this.points.sort((left, right) => left.t - right.t);
        this.selectedIndex = this.points.indexOf(current);
        this.hideNotice();
        this.syncSelectedControls();
        this.redraw();
    }

    protected commitGainInput(): void {
        if (this.selectedIndex === undefined) return;
        const y = audioKeyframeDbToPx(Number(this.gainInput.value), this.canvasHeight);
        this.points[this.selectedIndex].gainDb = this.roundDb(audioKeyframePxToDb(y, this.canvasHeight));
        this.hideNotice();
        this.syncSelectedControls();
        this.redraw();
    }

    protected commitEasingInput(): void {
        if (this.selectedIndex === undefined) return;
        this.points[this.selectedIndex].easing = this.validEasing(this.easingInput.value);
        this.redraw();
    }

    protected displayGainDb(point: EditableAudioKeyframe): number {
        return point.gainDb + this.overallGainDb;
    }

    protected editableGainDbAtY(y: number): number {
        return this.roundDb(normalizeAudioKeyframeGainDb(
            audioKeyframePxToDb(y, this.canvasHeight) - this.overallGainDb
        ));
    }

    protected syncSelectedControls(): void {
        const point = this.selectedIndex === undefined ? undefined : this.points[this.selectedIndex];
        for (const control of [this.timeInput, this.gainInput, this.easingInput, this.deleteButton]) {
            control.disabled = point === undefined;
        }
        this.timeInput.value = point ? String(this.roundTime(point.t)) : '';
        this.gainInput.value = point ? String(point.gainDb) : '';
        this.easingInput.value = point?.easing ?? 'linear';
    }

    protected configureNumberInput(input: HTMLInputElement, ariaLabel: string, step: string): void {
        input.type = 'number';
        input.step = step;
        input.setAttribute('aria-label', ariaLabel);
        input.style.width = '100%';
    }

    protected labeledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
        const label = document.createElement('label');
        label.textContent = labelText;
        Object.assign(label.style, {
            display: 'flex', flexDirection: 'column', gap: '3px',
            fontSize: '11px', color: 'var(--theia-descriptionForeground)'
        });
        label.appendChild(control);
        return label;
    }

    protected canvasPoint(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
        };
    }

    protected isEditorInput(target: EventTarget | null): boolean {
        return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
            || target instanceof HTMLTextAreaElement;
    }

    protected validEasing(value: unknown): AudioKeyframeEasing {
        return typeof value === 'string' && EASING_VALUES.includes(value as AudioKeyframeEasing)
            ? value as AudioKeyframeEasing : 'linear';
    }

    protected roundDb(value: number): number {
        return Math.round(value * 10) / 10;
    }

    protected roundTime(value: number): number {
        return Math.round(value * 1000) / 1000;
    }

    protected showNotice(message: string): void {
        this.notice.textContent = message;
        this.notice.style.display = 'block';
    }

    protected hideNotice(): void {
        this.notice.textContent = '';
        this.notice.style.display = 'none';
    }

    protected override async isValid(
        _value: AkariAudioKeyframeDialogValue, _mode: DialogMode
    ): Promise<DialogError> {
        return true;
    }

    get value(): AkariAudioKeyframeDialogValue {
        const keyframes = [...this.points]
            .sort((left, right) => left.t - right.t)
            .map(point => ({
                t: this.props.keyframeFrames ? Math.round(point.t * this.props.fps) : point.t,
                gain_db: point.gainDb,
                easing: point.easing
            }));
        return { keyframes, gainDb: this.overallGainDb };
    }
}
