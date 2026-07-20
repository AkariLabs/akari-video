import { CommandService, Disposable, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    AkariAnnotationsService,
    Annotation,
    WAVEFORM_BUCKET_COUNT,
    WriteBackResult
} from '../common/akari-annotations-protocol';
import { parseReview } from '../common/annotation-store';
import { CaptionRecord, parseCaptions } from '../common/caption-store';
import { EditCut, EditOverlay, parseEdit } from '../common/edit-store';
import { assignSubRows } from '../common/lane-layout';
import { OPEN_AKARI_REVIEW_PANEL_ID } from './akari-annotations-commands';
import { ProjectLocation } from './project-location';
import { ReviewModel } from './review-model';

const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
const MINIMUM_ITEM_DURATION = 0.15;
const DRAG_THRESHOLD_PX = 3;
const EDGE_ZONE_PX = 6;
const SNAP_THRESHOLD_PX = 8;
const MIN_VIEW_DURATION_FRAMES = 4;
const RULER_TARGET_TICK_COUNT = 6;
const RULER_STEP_MULTIPLIERS_FRAMES = [1, 2, 5, 10, 20, 50, 100];
const RULER_STEP_SECONDS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const ZOOM_SLIDER_RESOLUTION = 1000;
const ZOOM_WHEEL_SENSITIVITY = 0.01;
const ZOOM_EVENT_FACTOR_MIN = 1 / 1.5;
const ZOOM_EVENT_FACTOR_MAX = 1.5;
const MIN_CLIP_WIDTH_FOR_MEDIA_PX = 40;
const WAVEFORM_CANVAS_HEIGHT_PX = 32;

const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};

interface DragBase {
    pointerId: number;
    startClientX: number;
    element: HTMLDivElement;
    ghost: HTMLDivElement;
    dragged: boolean;
}

type DragDetail =
    | { kind: 'cut-trim'; index: number; edge: 'left' | 'right'; originalIn: number; originalOut: number }
    | { kind: 'cut-reorder'; index: number; originalIn: number; originalOut: number }
    | { kind: 'caption'; id: string; mode: 'move' | 'start' | 'end'; originalStart: number; originalEnd: number }
    | { kind: 'overlay'; id: string; mode: 'move' | 'resize'; originalStart: number; originalDuration: number };

type DragState = DragBase & DragDetail;

type DragPreview =
    | { kind: 'cut-trim'; index: number; input: number; output: number }
    | { kind: 'cut-reorder'; fromIndex: number; toIndex: number }
    | { kind: 'caption'; id: string; deltaStart: number; deltaEnd: number; start: number; end: number }
    | { kind: 'overlay-move'; id: string; start: number }
    | { kind: 'overlay-resize'; id: string; duration: number };

@injectable()
export class AkariAnnotationsWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-annotations-widget';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    protected readonly toolbar = document.createElement('div');
    protected readonly undoButton = document.createElement('button');
    protected readonly zoomHud = document.createElement('div');
    protected readonly zoomIcon = document.createElement('span');
    protected readonly zoomLabel = document.createElement('span');
    protected readonly zoomSlider = document.createElement('input');
    protected readonly reviewButton = document.createElement('button');
    protected readonly stripScroll = document.createElement('div');
    protected readonly strip = document.createElement('div');
    protected readonly playhead = document.createElement('div');
    protected readonly snapGuide = document.createElement('div');
    protected readonly notice = document.createElement('div');
    protected readonly footer = document.createElement('div');

    @inject(ReviewModel)
    protected readonly review!: ReviewModel;

    protected location: ProjectLocation | undefined;
    protected captions: CaptionRecord[] = [];
    protected cuts: EditCut[] = [];
    protected overlays: EditOverlay[] = [];
    protected wordBoundaries: number[] = [];
    protected configured = false;
    protected dragState: DragState | undefined;
    protected lastUndo: (() => Promise<void>) | undefined;
    protected contextPopup: HTMLDivElement | undefined;
    protected viewStart = 0;
    protected viewDuration: number | undefined;
    protected fps = 30;
    protected thumbnailCache = new Map<string, string | 'pending' | 'unavailable'>();
    protected waveformCache = new Map<string, number[] | 'pending' | 'unavailable'>();
    protected ffmpegMissingNoticeShown = false;

    /** 注釈の実体は ReviewModel が持つ（注釈パネルと共有）。ここではピン描画のために読むだけ。 */
    protected get annotations(): readonly Annotation[] {
        return this.review.annotations;
    }

    protected get selectedSourceT(): number {
        return this.review.selectedSourceT;
    }

    protected set selectedSourceT(value: number) {
        this.review.selectedSourceT = value;
    }

    @postConstruct()
    protected init(): void {
        this.id = AkariAnnotationsWidget.FACTORY_ID;
        this.title.label = 'タイムライン';
        this.title.caption = 'タイムラインとレビューコメント';
        this.title.iconClass = 'codicon codicon-comment';
        this.title.closable = true;
        this.node.classList.add('akari-annotations-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '10px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        const heading = document.createElement('strong');
        heading.textContent = 'タイムライン';
        heading.style.marginRight = 'auto';
        this.undoButton.type = 'button';
        this.undoButton.className = 'theia-button secondary';
        this.undoButton.textContent = '元に戻す';
        this.undoButton.disabled = true;
        this.undoButton.addEventListener('click', () => void this.performUndo());
        Object.assign(this.zoomHud.style, {
            display: 'flex', alignItems: 'center', gap: '6px'
        });
        this.zoomIcon.className = 'codicon codicon-search';
        this.zoomIcon.setAttribute('aria-hidden', 'true');
        this.zoomIcon.setAttribute('data-testid', 'akari-timeline-zoom-icon');
        this.zoomLabel.textContent = '100%';
        this.zoomLabel.setAttribute('data-testid', 'akari-timeline-zoom-percent');
        Object.assign(this.zoomLabel.style, {
            fontSize: '11px', fontVariantNumeric: 'tabular-nums', minWidth: '38px', textAlign: 'right',
            color: 'var(--theia-descriptionForeground)'
        });
        this.zoomSlider.type = 'range';
        this.zoomSlider.min = '0';
        this.zoomSlider.max = String(ZOOM_SLIDER_RESOLUTION);
        this.zoomSlider.step = '1';
        this.zoomSlider.value = '0';
        this.zoomSlider.setAttribute('aria-label', 'ズーム率');
        this.zoomSlider.setAttribute('data-testid', 'akari-timeline-zoom-slider');
        Object.assign(this.zoomSlider.style, { width: '90px' });
        this.zoomSlider.addEventListener('input', () => {
            const proposedDuration = this.sliderValueToViewDuration(Number(this.zoomSlider.value));
            const centerTime = this.viewStart + this.visibleDuration() / 2;
            this.applyViewDuration(proposedDuration, centerTime, 0.5);
        });
        this.zoomHud.append(this.zoomIcon, this.zoomLabel, this.zoomSlider);
        this.reviewButton.type = 'button';
        this.reviewButton.className = 'theia-button secondary';
        this.reviewButton.textContent = '注釈';
        this.reviewButton.title = '注釈パネルを開く';
        this.reviewButton.addEventListener('click', () => void this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID));
        this.toolbar.append(heading, this.zoomHud, this.undoButton, this.reviewButton);

        Object.assign(this.strip.style, {
            position: 'relative', margin: '8px 10px',
            border: '1px solid var(--theia-widget-border)', borderRadius: '4px',
            background: 'var(--theia-editorWidget-background)', cursor: 'pointer', overflow: 'hidden'
        });
        Object.assign(this.playhead.style, {
            position: 'absolute', top: '0', bottom: '0', width: '2px',
            background: 'var(--theia-focusBorder)', left: '0%', pointerEvents: 'none', zIndex: '10'
        });
        Object.assign(this.snapGuide.style, {
            position: 'absolute', top: '0', bottom: '0', width: '1px', display: 'none',
            background: 'var(--theia-charts-yellow, #e5c07b)', pointerEvents: 'none', zIndex: '11'
        });
        this.strip.append(this.playhead, this.snapGuide);
        this.strip.addEventListener('click', event => this.onStripClick(event));
        this.strip.addEventListener('wheel', event => this.onWheelZoom(event), { passive: false });
        this.strip.addEventListener('contextmenu', event => this.openAnnotationPopup(event));

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });
        Object.assign(this.stripScroll.style, { minHeight: '0', overflow: 'auto' });
        this.stripScroll.appendChild(this.strip);
        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'タイムラインをクリックすると時刻を選べます。プレビューを開いていればその場でシークします。';

        this.node.append(this.toolbar, this.stripScroll, this.notice, this.footer);
        const style = document.createElement('style');
        style.textContent = `
    .akari-annotations-widget .akari-annotations-strip-clip {
        background: color-mix(in srgb, var(--theia-charts-blue, #61afef) 62%, transparent);
        border: 1px solid color-mix(in srgb, var(--theia-charts-blue, #61afef) 82%, white);
        border-radius: 2px;
        box-sizing: border-box;
    }
    .akari-annotations-widget .akari-annotations-strip-caption {
        background: var(--theia-charts-purple, #b180d7);
        opacity: .68;
        border-radius: 2px;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay {
        background: var(--theia-charts-orange, #d19a66);
        opacity: .74;
        border-radius: 2px;
    }
    .akari-annotations-widget .akari-annotations-strip-caption-text {
        position: absolute;
        height: 16px;
        display: flex;
        align-items: center;
        white-space: nowrap;
        font-size: 11px;
        line-height: 1;
        color: var(--theia-foreground);
        pointer-events: none;
        padding-left: 3px;
        z-index: 3;
        text-shadow: 0 0 2px var(--theia-editorWidget-background), 0 0 3px var(--theia-editorWidget-background);
    }
    .akari-annotations-widget .akari-annotations-pin {
        position: absolute;
        top: 3px;
        width: 9px;
        height: 9px;
        border-radius: 50% 50% 50% 0;
        transform: translateX(-50%) rotate(-45deg);
        transform-origin: center;
        box-shadow: 0 0 0 1px var(--theia-editorWidget-background);
        cursor: pointer;
        pointer-events: auto;
        z-index: 4;
    }
    .akari-annotations-widget .akari-annotations-pin:hover {
        filter: brightness(1.25);
    }
    .akari-annotations-widget .akari-annotations-pin[data-annotation-status="resolved"] {
        opacity: .55;
    }
    .akari-annotations-widget .akari-annotations-segment-label {
        display: block;
        padding: 1px 3px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--theia-editor-foreground, #fff);
        font-size: 10px;
        line-height: 14px;
        pointer-events: none;
        text-shadow: 0 1px 2px #000;
    }
`;
        this.node.appendChild(style);

        const keydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && this.dragState) {
                event.preventDefault();
                this.cancelDrag(this.dragState);
                return;
            }
            if (this.isAttached && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                void this.performUndo();
            }
        };
        // 注釈が増減したらピンを描き直す。パネルの時刻リンクからのジャンプもここで受ける。
        this.toDispose.push(this.review.onChanged(() => this.renderStrip()));
        this.toDispose.push(this.review.onSeekRequested(time => {
            this.selectedSourceT = time;
            this.renderStrip();
            void this.requestSeek(time);
        }));

        window.addEventListener('keydown', keydown);
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('keydown', keydown);
            this.closeAnnotationPopup();
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
        }));
    }

    async configure(location: ProjectLocation): Promise<void> {
        if (this.configured) {
            return;
        }
        this.configured = true;
        this.location = location;
        this.title.caption = `タイムライン — ${location.reviewUri.toString()}`;
        await this.reloadAll();
        requestAnimationFrame(() => this.renderStrip());
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (!this.location) {
                return;
            }
            if (event.contains(this.location.reviewUri)) {
                void this.reloadReview();
            }
            if (this.location.editUri && event.contains(this.location.editUri)) {
                void this.reloadEdit();
            }
            if (event.contains(this.location.captionsUri)) {
                void this.reloadCaptions();
            }
            if (this.location.analysisUri && event.contains(this.location.analysisUri)) {
                void this.reloadAnalysis();
            }
        }));
        try {
            this.toDispose.push(await this.fileService.watch(location.root, { recursive: true, excludes: [] }));
        } catch (error) {
            console.warn('[akari-annotations] file watching is unavailable', error);
        }
    }

    protected async reloadAll(): Promise<void> {
        await Promise.all([this.reloadReview(), this.reloadEdit(), this.reloadCaptions(), this.reloadAnalysis()]);
    }

    protected async reloadReview(): Promise<void> {
        if (!this.location) {
            return;
        }
        try {
            const exists = await this.fileService.exists(this.location.reviewUri);
            if (!exists) {
                this.review.annotations = [];
                this.hideNotice();
            } else {
                const source = (await this.fileService.readFile(this.location.reviewUri)).value.toString();
                const parsed = parseReview(source);
                this.review.annotations = parsed.annotations;
                this.showWarnings(parsed.warnings);
            }
        } catch (error) {
            this.review.annotations = [];
            this.showNotice(`レビューデータを読み取れません: ${this.errorMessage(error)}`);
        }
        this.renderStrip();
    }

    protected async reloadEdit(): Promise<void> {
        this.cuts = [];
        this.overlays = [];
        this.fps = 30;
        if (this.location?.editUri) {
            try {
                const source = (await this.fileService.readFile(this.location.editUri)).value.toString();
                const parsed = parseEdit(source);
                this.cuts = parsed.cuts;
                this.overlays = parsed.overlays;
                this.fps = parsed.fps;
                if (parsed.warnings.length > 0) {
                    this.showWarnings(parsed.warnings);
                }
            } catch {
                // A missing or unreadable edit.json means no clips or overlays are drawn.
            }
        }
        this.renderStrip();
    }

    protected async reloadCaptions(): Promise<void> {
        this.captions = [];
        if (this.location) {
            try {
                const source = (await this.fileService.readFile(this.location.captionsUri)).value.toString();
                const parsed = parseCaptions(source);
                this.captions = parsed.captions;
                if (parsed.warnings.length > 0) {
                    this.showWarnings(parsed.warnings);
                }
            } catch {
                // A missing or unreadable captions.json means no caption segments are drawn.
            }
        }
        this.renderStrip();
    }

    protected async reloadAnalysis(): Promise<void> {
        this.wordBoundaries = [];
        if (this.location?.analysisUri) {
            try {
                const analysis = JSON.parse((await this.fileService.readFile(this.location.analysisUri)).value.toString());
                if (Array.isArray(analysis?.transcript)) {
                    const boundaries: number[] = [];
                    for (const segment of analysis.transcript) {
                        if (!Array.isArray(segment?.words)) {
                            continue;
                        }
                        for (const word of segment.words) {
                            if (typeof word?.start === 'number' && Number.isFinite(word.start)) {
                                boundaries.push(word.start);
                            }
                            if (typeof word?.end === 'number' && Number.isFinite(word.end)) {
                                boundaries.push(word.end);
                            }
                        }
                    }
                    this.wordBoundaries = boundaries;
                }
            } catch {
                // Snapping degrades to clip and playhead boundaries when analysis is unavailable.
            }
        }
    }

    protected totalDuration(): number {
        const candidates = [
            10,
            ...this.captions.map(caption => caption.end),
            ...this.cuts.map(cut => cut.out),
            ...this.overlays.map(overlay => overlay.start + overlay.duration),
            ...this.annotations.map(annotation => annotation.sourceT + 1)
        ];
        return Math.max(...candidates) * 1.02;
    }

    protected visibleDuration(): number {
        return this.viewDuration ?? this.totalDuration();
    }

    protected renderStrip(): void {
        const CLIP_TOP = 14;
        const CLIP_HEIGHT = 22;
        const LANE_GAP = 6;
        const SUBROW_HEIGHT = 16;
        const SUBROW_GAP = 2;
        const SUBROW_STRIDE = SUBROW_HEIGHT + SUBROW_GAP;
        const STRIP_BOTTOM_MARGIN = 6;

        const maxDuration = this.totalDuration();
        if (this.viewDuration !== undefined) {
            if (this.viewDuration >= maxDuration) {
                this.viewDuration = undefined;
                this.viewStart = 0;
            } else {
                this.viewStart = Math.min(Math.max(0, this.viewStart), Math.max(0, maxDuration - this.viewDuration));
            }
        }
        for (const child of Array.from(this.strip.children)) {
            if (child !== this.playhead && child !== this.snapGuide) {
                child.remove();
            }
        }
        this.renderRuler();
        this.cuts.forEach((cut, index) => {
            const element = this.stripSegment(
                cut.in, cut.out, CLIP_TOP, CLIP_HEIGHT, 'akari-annotations-strip-clip', `C${index + 1}`
            );
            const widthPercent = Math.max(this.percent(cut.out) - this.percent(cut.in), 0.3);
            const clipWidth = this.strip.clientWidth * widthPercent / 100;
            this.renderClipMedia(element, cut, clipWidth);
            element.appendChild(this.segmentLabel(`C${index + 1}`));
            this.installDragListeners(element, (event, rect) => {
                const localX = event.clientX - rect.left;
                const rightDistance = rect.right - event.clientX;
                if (localX <= EDGE_ZONE_PX && localX <= rightDistance) {
                    return { kind: 'cut-trim', index, edge: 'left', originalIn: cut.in, originalOut: cut.out };
                }
                if (rightDistance <= EDGE_ZONE_PX) {
                    return { kind: 'cut-trim', index, edge: 'right', originalIn: cut.in, originalOut: cut.out };
                }
                return { kind: 'cut-reorder', index, originalIn: cut.in, originalOut: cut.out };
            });
            this.strip.appendChild(element);
        });

        const captionRows = assignSubRows(this.captions.map(c => ({ start: c.start, end: c.end })));
        const captionSubRowCount = captionRows.length ? Math.max(...captionRows) + 1 : 1;
        const captionBandTop = CLIP_TOP + CLIP_HEIGHT + LANE_GAP;
        const captionBandHeight = captionSubRowCount * SUBROW_STRIDE;

        const overlayRows = assignSubRows(this.overlays.map(o => ({ start: o.start, end: o.start + o.duration })));
        const overlaySubRowCount = overlayRows.length ? Math.max(...overlayRows) + 1 : 1;
        const overlayBandTop = captionBandTop + captionBandHeight + LANE_GAP;
        const overlayBandHeight = overlaySubRowCount * SUBROW_STRIDE;

        // 注釈ピンはルーラー帯（renderRuler）へ描くため、専用レーンは持たない。
        const stripHeight = overlayBandTop + overlayBandHeight + STRIP_BOTTOM_MARGIN;
        this.strip.style.height = `${stripHeight}px`;

        this.captions.forEach((caption, index) => {
            const captionEnd = Math.max(caption.end, caption.start + MINIMUM_ITEM_DURATION);
            const top = captionBandTop + captionRows[index] * SUBROW_STRIDE;
            const element = this.stripSegment(
                caption.start, captionEnd, top, SUBROW_HEIGHT, 'akari-annotations-strip-caption', caption.text
            );
            this.installDragListeners(element, (event, rect) => {
                const localX = event.clientX - rect.left;
                const rightDistance = rect.right - event.clientX;
                const mode = localX <= EDGE_ZONE_PX && localX <= rightDistance ? 'start'
                    : rightDistance <= EDGE_ZONE_PX ? 'end' : 'move';
                return {
                    kind: 'caption', id: caption.id, mode,
                    originalStart: caption.start, originalEnd: caption.end
                };
            });
            this.strip.appendChild(element);
            this.strip.appendChild(this.captionLabel(caption.start, caption.text, top));
        });
        this.overlays.forEach((overlay, index) => {
            const top = overlayBandTop + overlayRows[index] * SUBROW_STRIDE;
            const element = this.stripSegment(
                overlay.start, overlay.start + overlay.duration, top, SUBROW_HEIGHT,
                'akari-annotations-strip-overlay', overlay.id
            );
            element.appendChild(this.segmentLabel(overlay.id));
            this.installDragListeners(element, (event, rect) => ({
                kind: 'overlay', id: overlay.id,
                mode: rect.right - event.clientX <= EDGE_ZONE_PX ? 'resize' : 'move',
                originalStart: overlay.start, originalDuration: overlay.duration
            }));
            this.strip.appendChild(element);
        });
        this.playhead.style.left = `${this.percent(this.selectedSourceT)}%`;
        this.updateZoomHud();
    }

    protected renderRuler(): void {
        const ticks = this.computeRulerTicks(this.viewStart, this.visibleDuration(), this.fps);
        for (const tick of ticks) {
            const label = document.createElement('div');
            label.textContent = tick.label;
            const percent = this.percent(tick.time);
            Object.assign(label.style, {
                position: 'absolute', top: '0', height: '14px', left: `${percent}%`,
                color: 'var(--theia-descriptionForeground)', fontSize: '9px', lineHeight: '13px',
                fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '2',
                transform: percent <= 2 ? 'none' : percent >= 98 ? 'translateX(-100%)' : 'translateX(-50%)'
            });
            this.strip.appendChild(label);
        }
        this.renderAnnotationPins();
    }

    protected computeRulerTicks(viewStart: number, duration: number, fps: number): Array<{ time: number; label: string }> {
        if (duration <= 0) {
            return [{ time: viewStart, label: this.formatTickLabel(viewStart, 1, fps) }];
        }
        const frameDuration = 1 / fps;
        const idealStep = duration / RULER_TARGET_TICK_COUNT;
        const step = this.niceRulerStep(idealStep, frameDuration);
        const viewEnd = viewStart + duration;
        const startIndex = Math.ceil((viewStart - step * 1e-6) / step);
        const endIndex = Math.floor((viewEnd + step * 1e-6) / step);
        const ticks: Array<{ time: number; label: string }> = [];
        for (let index = startIndex; index <= endIndex; index++) {
            const time = index * step;
            ticks.push({ time, label: this.formatTickLabel(time, step, fps) });
        }
        if (ticks.length === 0) {
            ticks.push({ time: viewStart, label: this.formatTickLabel(viewStart, step, fps) });
        }
        return ticks;
    }

    protected niceRulerStep(idealStep: number, frameDuration: number): number {
        const candidates = RULER_STEP_MULTIPLIERS_FRAMES.map(frames => frames * frameDuration)
            .concat(RULER_STEP_SECONDS)
            .filter(candidate => candidate > 0)
            .sort((a, b) => a - b);
        for (const step of candidates) {
            if (step >= idealStep - 1e-9) {
                return step;
            }
        }
        return candidates[candidates.length - 1];
    }

    protected formatTickLabel(time: number, step: number, fps: number): string {
        const clamped = Math.max(0, time);
        if (step < 0.1 - 1e-9) {
            return this.formatFrameTimestamp(clamped, fps);
        }
        if (step < 1 - 1e-9) {
            return this.formatSubSecondTimestamp(clamped);
        }
        return this.formatRulerTimestamp(clamped);
    }

    protected formatSubSecondTimestamp(value: number): string {
        const totalTenths = Math.round(value * 10);
        const wholeSeconds = Math.floor(totalTenths / 10);
        const tenth = totalTenths % 10;
        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenth}`;
    }

    protected formatFrameTimestamp(value: number, fps: number): string {
        const totalFrames = Math.round(value * fps);
        const wholeSeconds = Math.floor(totalFrames / fps);
        const frame = totalFrames % fps;
        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        const frameDigits = String(Math.max(1, fps - 1)).length;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frame).padStart(frameDigits, '0')}`;
    }

    /**
     * 注釈ピンをルーラー帯の下端へ描く。専用レーンを 1 行使わず、時刻の目盛りと同じ帯に収める。
     * クリックでその時刻へシークし、注釈パネル側の該当行を目立たせる。
     */
    protected renderAnnotationPins(): void {
        for (const annotation of this.annotations) {
            const pin = document.createElement('div');
            pin.className = 'akari-annotations-pin';
            pin.title = `${this.formatTimestamp(annotation.sourceT)} ${annotation.text}`;
            pin.setAttribute('data-annotation-id', annotation.id);
            pin.setAttribute('data-annotation-status', annotation.status);
            pin.style.left = `${this.percent(annotation.sourceT)}%`;
            pin.style.background = STATUS_COLORS[annotation.status];
            pin.addEventListener('click', event => {
                event.stopPropagation();
                this.selectedSourceT = annotation.sourceT;
                this.renderStrip();
                void this.requestSeek(annotation.sourceT);
                this.review.reveal(annotation.id);
                void this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID);
            });
            this.strip.appendChild(pin);
        }
    }

    protected stripSegment(
        start: number,
        end: number,
        top: number,
        height: number,
        className: string,
        title?: string
    ): HTMLDivElement {
        const element = document.createElement('div');
        element.className = className;
        if (title) {
            element.title = title;
        }
        Object.assign(element.style, {
            position: 'absolute',
            top: `${top}px`,
            height: `${height}px`,
            left: `${this.percent(start)}%`,
            width: `${Math.max(this.percent(end) - this.percent(start), 0.3)}%`,
            pointerEvents: 'none'
        });
        return element;
    }

    protected captionLabel(start: number, text: string, top: number): HTMLDivElement {
        const label = document.createElement('div');
        label.className = 'akari-annotations-strip-caption-text';
        label.textContent = text;
        label.title = text;
        label.style.left = `${this.percent(start)}%`;
        label.style.top = `${top}px`;
        return label;
    }

    protected renderClipMedia(element: HTMLDivElement, cut: EditCut, clipWidth: number): void {
        if (clipWidth < MIN_CLIP_WIDTH_FOR_MEDIA_PX || !this.location?.videoUri) {
            return;
        }
        const key = `${cut.in}:${cut.out}`;
        const thumbnail = this.thumbnailCache.get(key);
        if (typeof thumbnail === 'string' && thumbnail !== 'pending' && thumbnail !== 'unavailable') {
            element.style.backgroundImage = `url(${thumbnail})`;
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
        } else if (thumbnail === undefined) {
            this.fetchThumbnail(key, cut);
        }

        const waveform = this.waveformCache.get(key);
        if (Array.isArray(waveform)) {
            element.appendChild(this.waveformCanvas(waveform));
        } else if (waveform === undefined) {
            this.fetchWaveform(key, cut);
        }
    }

    protected fetchThumbnail(key: string, cut: EditCut): void {
        if (!this.location?.videoUri) {
            return;
        }
        this.thumbnailCache.set(key, 'pending');
        const atSeconds = cut.in + Math.min(0.1, (cut.out - cut.in) / 2);
        void this.annotationsService.getClipThumbnail({
            projectRootUri: this.location.root.toString(),
            videoUri: this.location.videoUri,
            atSeconds
        }).then(result => {
            if (result.status === 'ready' && result.dataUri) {
                this.thumbnailCache.set(key, result.dataUri);
            } else {
                this.thumbnailCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.renderStrip();
        }).catch(() => {
            this.thumbnailCache.set(key, 'unavailable');
            this.renderStrip();
        });
    }

    protected fetchWaveform(key: string, cut: EditCut): void {
        if (!this.location?.videoUri) {
            return;
        }
        this.waveformCache.set(key, 'pending');
        void this.annotationsService.getClipWaveform({
            projectRootUri: this.location.root.toString(),
            videoUri: this.location.videoUri,
            startSeconds: cut.in,
            endSeconds: cut.out
        }).then(result => {
            if (result.status === 'ready' && result.peaks) {
                this.waveformCache.set(key, result.peaks);
            } else {
                this.waveformCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.renderStrip();
        }).catch(() => {
            this.waveformCache.set(key, 'unavailable');
            this.renderStrip();
        });
    }

    protected showFfmpegMissingNotice(reason: string | undefined): void {
        if (reason === 'ffmpeg-not-found' && !this.ffmpegMissingNoticeShown && !this.notice.textContent) {
            this.showNotice('ffmpeg が見つからないため、サムネイルと波形は表示されません（他の操作は通常どおり使えます）');
            this.ffmpegMissingNoticeShown = true;
        }
    }

    protected waveformCanvas(peaks: readonly number[]): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = WAVEFORM_BUCKET_COUNT;
        canvas.height = WAVEFORM_CANVAS_HEIGHT_PX;
        Object.assign(canvas.style, {
            position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '.55', pointerEvents: 'none'
        });
        const context = canvas.getContext('2d');
        if (context) {
            context.fillStyle = '#fff';
            peaks.forEach((peak, index) => {
                const barHeight = Math.max(1, peak * WAVEFORM_CANVAS_HEIGHT_PX);
                context.fillRect(index, (WAVEFORM_CANVAS_HEIGHT_PX - barHeight) / 2, 1, barHeight);
            });
        }
        return canvas;
    }

    protected segmentLabel(text: string): HTMLSpanElement {
        const label = document.createElement('span');
        label.className = 'akari-annotations-segment-label';
        label.textContent = text;
        return label;
    }

    protected installDragListeners(
        element: HTMLDivElement,
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail
    ): void {
        element.style.pointerEvents = 'auto';
        element.style.touchAction = 'none';
        element.style.cursor = 'grab';
        element.addEventListener('click', event => event.stopPropagation());
        element.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.dragState) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const ghost = element.cloneNode(true) as HTMLDivElement;
            ghost.removeAttribute('title');
            Object.assign(ghost.style, {
                pointerEvents: 'none', opacity: '.55', borderStyle: 'dashed', zIndex: '8', cursor: 'grabbing'
            });
            this.strip.appendChild(ghost);
            const state = {
                ...detail(event, element.getBoundingClientRect()),
                pointerId: event.pointerId,
                startClientX: event.clientX,
                element,
                ghost,
                dragged: false
            } as DragState;
            this.dragState = state;
            element.style.cursor = 'grabbing';
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture can fail if the element is detached during a file refresh.
            }
        });
        element.addEventListener('pointermove', event => {
            const state = this.dragState;
            if (!state || state.element !== element || state.pointerId !== event.pointerId) {
                return;
            }
            event.preventDefault();
            if (Math.abs(event.clientX - state.startClientX) > DRAG_THRESHOLD_PX) {
                state.dragged = true;
            }
            this.updateDragPreview(state, event.clientX, state.dragged);
        });
        element.addEventListener('pointerup', event => {
            const state = this.dragState;
            if (!state || state.element !== element || state.pointerId !== event.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!state.dragged) {
                this.cancelDrag(state);
                this.selectTimeAtClientX(event.clientX);
                return;
            }
            const preview = this.updateDragPreview(state, event.clientX, true);
            this.cancelDrag(state);
            void this.commitDrag(preview);
        });
        element.addEventListener('pointercancel', event => {
            const state = this.dragState;
            if (state && state.element === element && state.pointerId === event.pointerId) {
                this.cancelDrag(state);
            }
        });
    }

    protected updateDragPreview(state: DragState, clientX: number, allowGuide: boolean): DragPreview {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.visibleDuration();
        const delta = rect.width > 0 ? (clientX - state.startClientX) / rect.width * duration : 0;
        if (state.kind === 'cut-trim') {
            const proposed = state.edge === 'left' ? state.originalIn + delta : state.originalOut + delta;
            const edge = this.snapTime(Math.max(0, proposed), allowGuide);
            const input = state.edge === 'left' ? edge : state.originalIn;
            const output = state.edge === 'right' ? edge : state.originalOut;
            this.setGhostRange(state.ghost, input, output);
            return { kind: 'cut-trim', index: state.index, input, output };
        }
        if (state.kind === 'cut-reorder') {
            const proposedStart = Math.max(0, state.originalIn + delta);
            const pointerTime = this.timeAtClientX(clientX);
            const dropTime = this.snapTime(pointerTime, allowGuide);
            this.setGhostRange(state.ghost, proposedStart, proposedStart + state.originalOut - state.originalIn);
            const boundaries = this.cuts.flatMap((cut, index) => [
                { time: cut.in, index },
                { time: cut.out, index }
            ]);
            const target = boundaries.reduce((nearest, candidate) =>
                Math.abs(dropTime - candidate.time) < Math.abs(dropTime - nearest.time) ? candidate : nearest,
            boundaries.find(candidate => candidate.index === state.index) ?? { time: state.originalIn, index: state.index });
            const toIndex = target.index;
            return { kind: 'cut-reorder', fromIndex: state.index, toIndex };
        }
        if (state.kind === 'caption') {
            let start = state.originalStart;
            let end = state.originalEnd;
            if (state.mode === 'move') {
                start = this.snapTime(state.originalStart + delta, allowGuide);
                end = state.originalEnd + (start - state.originalStart);
            } else if (state.mode === 'start') {
                start = this.snapTime(state.originalStart + delta, allowGuide);
            } else {
                end = this.snapTime(state.originalEnd + delta, allowGuide);
            }
            this.setGhostRange(state.ghost, start, end);
            return {
                kind: 'caption', id: state.id,
                deltaStart: start - state.originalStart,
                deltaEnd: end - state.originalEnd,
                start, end
            };
        }
        if (state.mode === 'move') {
            const start = this.snapTime(Math.max(0, state.originalStart + delta), allowGuide);
            this.setGhostRange(state.ghost, start, start + state.originalDuration);
            return { kind: 'overlay-move', id: state.id, start };
        }
        const end = this.snapTime(state.originalStart + state.originalDuration + delta, allowGuide);
        this.setGhostRange(state.ghost, state.originalStart, end);
        return { kind: 'overlay-resize', id: state.id, duration: end - state.originalStart };
    }

    protected setGhostRange(ghost: HTMLDivElement, start: number, end: number): void {
        ghost.style.left = `${this.percent(start)}%`;
        ghost.style.width = `${Math.max(this.percent(end) - this.percent(start), 0.3)}%`;
    }

    protected snapTime(value: number, showGuide: boolean): number {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.visibleDuration();
        if (rect.width <= 0 || duration <= 0) {
            this.hideSnapGuide();
            return value;
        }
        const threshold = SNAP_THRESHOLD_PX / (rect.width / duration);
        const candidates = [
            ...this.wordBoundaries,
            ...this.cuts.flatMap(cut => [cut.in, cut.out]),
            this.selectedSourceT
        ].filter(candidate => Number.isFinite(candidate));
        let nearest: number | undefined;
        for (const candidate of candidates) {
            if (nearest === undefined || Math.abs(candidate - value) < Math.abs(nearest - value)) {
                nearest = candidate;
            }
        }
        if (nearest !== undefined && Math.abs(nearest - value) <= threshold) {
            if (showGuide) {
                this.snapGuide.style.left = `${this.percent(nearest)}%`;
                this.snapGuide.style.display = 'block';
            }
            return nearest;
        }
        this.hideSnapGuide();
        return value;
    }

    protected hideSnapGuide(): void {
        this.snapGuide.style.display = 'none';
    }

    protected cancelDrag(state: DragState): void {
        if (this.dragState !== state) {
            return;
        }
        try {
            if (state.element.hasPointerCapture(state.pointerId)) {
                state.element.releasePointerCapture(state.pointerId);
            }
        } catch {
            // The element may already have lost capture after pointercancel.
        }
        state.element.style.cursor = 'grab';
        state.ghost.remove();
        this.hideSnapGuide();
        this.dragState = undefined;
    }

    protected async commitDrag(preview: DragPreview): Promise<void> {
        const location = this.location;
        if (!location) {
            return;
        }
        try {
            let result: WriteBackResult;
            if (preview.kind === 'cut-trim') {
                if (!location.editUri) {
                    return;
                }
                if (preview.output - preview.input < MINIMUM_ITEM_DURATION) {
                    this.showNotice('クリップが短すぎます（0.15 秒未満にはできません）');
                    return;
                }
                const original = this.cuts[preview.index];
                result = await this.annotationsService.trimCut({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                    cutIndex: preview.index, in: preview.input, out: preview.output
                });
                this.setUndo(async () => {
                    await this.annotationsService.trimCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        cutIndex: preview.index, in: original.in, out: original.out
                    });
                    await this.reloadEdit();
                });
                await this.reloadEdit();
                this.footer.textContent = this.writeResultMessage('クリップをトリムしました。', result);
            } else if (preview.kind === 'cut-reorder') {
                if (!location.editUri || preview.fromIndex === preview.toIndex) {
                    this.footer.textContent = 'クリップの順序は変わりませんでした。';
                    return;
                }
                result = await this.annotationsService.reorderCuts({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                    fromIndex: preview.fromIndex, toIndex: preview.toIndex
                });
                this.setUndo(async () => {
                    await this.annotationsService.reorderCuts({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        fromIndex: preview.toIndex, toIndex: preview.fromIndex
                    });
                    await this.reloadEdit();
                });
                await this.reloadEdit();
                this.footer.textContent = this.writeResultMessage('クリップの順序を入れ替えました。', result);
            } else if (preview.kind === 'caption') {
                if (preview.start < 0 || preview.end - preview.start < MINIMUM_ITEM_DURATION) {
                    this.showNotice('字幕が短すぎます（0.15 秒未満にはできません）');
                    return;
                }
                result = await this.annotationsService.shiftCaption({
                    captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                    captionId: preview.id, deltaStart: preview.deltaStart, deltaEnd: preview.deltaEnd
                });
                this.setUndo(async () => {
                    await this.annotationsService.shiftCaption({
                        captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                        captionId: preview.id, deltaStart: -preview.deltaStart, deltaEnd: -preview.deltaEnd
                    });
                    await this.reloadCaptions();
                });
                await this.reloadCaptions();
                this.footer.textContent = this.writeResultMessage('字幕のタイミングを調整しました。', result);
            } else if (preview.kind === 'overlay-move') {
                if (!location.editUri) {
                    return;
                }
                const original = this.overlays.find(overlay => overlay.id === preview.id);
                if (!original) {
                    throw new Error(`オーバーレイ ${preview.id} が見つかりません`);
                }
                result = await this.annotationsService.moveOverlay({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                    overlayId: preview.id, start: preview.start
                });
                this.setUndo(async () => {
                    await this.annotationsService.moveOverlay({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        overlayId: preview.id, start: original.start
                    });
                    await this.reloadEdit();
                });
                await this.reloadEdit();
                this.footer.textContent = this.writeResultMessage('オーバーレイを移動しました。', result);
            } else {
                if (!location.editUri) {
                    return;
                }
                if (preview.duration <= 0) {
                    this.showNotice('オーバーレイの尺は正の値にしてください。');
                    return;
                }
                const original = this.overlays.find(overlay => overlay.id === preview.id);
                if (!original) {
                    throw new Error(`オーバーレイ ${preview.id} が見つかりません`);
                }
                result = await this.annotationsService.resizeOverlay({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                    overlayId: preview.id, duration: preview.duration
                });
                this.setUndo(async () => {
                    await this.annotationsService.resizeOverlay({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        overlayId: preview.id, duration: original.duration
                    });
                    await this.reloadEdit();
                });
                await this.reloadEdit();
                this.footer.textContent = this.writeResultMessage('オーバーレイの尺を変更しました。', result);
            }
            this.hideNotice();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`タイムラインを更新できません: ${detail}`);
            this.messages.error(`タイムラインを更新できません: ${detail}`);
        }
    }

    protected setUndo(action: () => Promise<void>): void {
        this.lastUndo = action;
        this.undoButton.disabled = false;
    }

    protected async performUndo(): Promise<void> {
        const action = this.lastUndo;
        if (!action) {
            return;
        }
        this.undoButton.disabled = true;
        try {
            await action();
            this.lastUndo = undefined;
            this.hideNotice();
            this.footer.textContent = '直前のタイムライン操作を元に戻しました。';
        } catch (error) {
            this.undoButton.disabled = false;
            const detail = this.errorMessage(error);
            this.showNotice(`元に戻せません: ${detail}`);
            this.messages.error(`元に戻せません: ${detail}`);
        }
    }

    protected writeResultMessage(message: string, result: WriteBackResult): string {
        return result.committed ? `${message} 変更を記録しました。` : message;
    }

    protected percent(value: number): number {
        const duration = this.visibleDuration();
        return duration > 0 ? Math.min(100, Math.max(0, (value - this.viewStart) / duration * 100)) : 0;
    }

    protected zoomPercent(): number {
        const duration = this.visibleDuration();
        return duration > 0 ? this.totalDuration() / duration * 100 : 100;
    }

    protected minViewDurationSeconds(): number {
        return Math.min(this.totalDuration(), MIN_VIEW_DURATION_FRAMES / this.fps);
    }

    protected sliderValueToViewDuration(sliderValue: number): number {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        if (maxDuration <= minDuration) {
            return maxDuration;
        }
        const ratio = minDuration / maxDuration;
        const t = Math.min(1, Math.max(0, sliderValue / ZOOM_SLIDER_RESOLUTION));
        return maxDuration * Math.pow(ratio, t);
    }

    protected viewDurationToSliderValue(duration: number): number {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        if (maxDuration <= minDuration) {
            return 0;
        }
        const ratio = minDuration / maxDuration;
        const clamped = Math.min(maxDuration, Math.max(minDuration, duration));
        const t = Math.log(clamped / maxDuration) / Math.log(ratio);
        return Math.round(t * ZOOM_SLIDER_RESOLUTION);
    }

    protected updateZoomHud(): void {
        this.zoomLabel.textContent = `${Math.round(this.zoomPercent())}%`;
        const sliderValue = this.viewDurationToSliderValue(this.visibleDuration());
        if (Number(this.zoomSlider.value) !== sliderValue) {
            this.zoomSlider.value = String(sliderValue);
        }
    }

    protected applyViewDuration(proposedDuration: number, anchorTime: number, anchorRatio: number): void {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        const clamped = Math.min(maxDuration, Math.max(minDuration, proposedDuration));
        if (clamped >= maxDuration - 1e-6) {
            this.viewDuration = undefined;
            this.viewStart = 0;
        } else {
            const proposedStart = anchorTime - anchorRatio * clamped;
            this.viewDuration = clamped;
            this.viewStart = Math.min(Math.max(0, proposedStart), Math.max(0, maxDuration - clamped));
        }
        this.renderStrip();
    }

    protected timeAtClientX(clientX: number): number {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        return this.viewStart + ratio * this.visibleDuration();
    }

    protected selectTimeAtClientX(clientX: number): void {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        this.selectedSourceT = this.viewStart + ratio * this.visibleDuration();
        this.playhead.style.left = `${ratio * 100}%`;
        void this.requestSeek(this.selectedSourceT);
    }

    protected onStripClick(event: MouseEvent): void {
        this.selectTimeAtClientX(event.clientX);
    }

    protected onWheelZoom(event: WheelEvent): void {
        if (!event.ctrlKey) {
            return;
        }
        event.preventDefault();
        const rect = this.strip.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const currentDuration = this.visibleDuration();
        const rawFactor = Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
        const factor = Math.min(ZOOM_EVENT_FACTOR_MAX, Math.max(ZOOM_EVENT_FACTOR_MIN, rawFactor));
        const proposedDuration = currentDuration / factor;
        const cursorRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const cursorTime = this.viewStart + cursorRatio * currentDuration;
        this.applyViewDuration(proposedDuration, cursorTime, cursorRatio);
    }

    protected async requestSeek(time: number): Promise<void> {
        if (!this.location?.videoUri) {
            this.footer.textContent = `${this.formatTimestamp(time)} を選択しました。動画に結び付く文字起こしが見つかりません。`;
            return;
        }
        const result = await this.commands.executeCommand<'seeked' | 'mismatched-asset' | 'no-preview'>(
            TRANSCRIPT_SEEK_COMMAND_ID,
            { videoUri: this.location.videoUri, time, captionId: '' }
        );
        const timestamp = this.formatTimestamp(time);
        this.footer.textContent = result === 'seeked'
            ? `${timestamp} にプレビューをシークしました。`
            : result === 'mismatched-asset'
                ? `${timestamp} を選択しました。別の素材のプレビューが開いています。`
                : `${timestamp} を選択しました。プレビューを開くとここからジャンプできます。`;
    }

    protected openAnnotationPopup(event: MouseEvent): void {
        event.preventDefault();
        this.closeAnnotationPopup();
        const sourceT = this.timeAtClientX(event.clientX);
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
            display: 'flex', gap: '5px', padding: '6px', borderRadius: '4px',
            border: '1px solid var(--theia-widget-border)', background: 'var(--theia-menu-background)',
            boxShadow: '0 3px 12px rgba(0,0,0,.35)'
        });
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `${this.formatTimestamp(sourceT)} に注釈`;
        input.setAttribute('aria-label', 'タイムラインに注釈を追加');
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'theia-button main';
        submit.textContent = '追加';
        const accept = (): void => {
            const text = input.value.trim();
            if (!text) {
                return;
            }
            this.closeAnnotationPopup();
            void this.submitAnnotation(text, sourceT);
        };
        input.addEventListener('keydown', keyEvent => {
            if (keyEvent.key === 'Enter') {
                keyEvent.preventDefault();
                accept();
            } else if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                this.closeAnnotationPopup();
            }
        });
        input.addEventListener('blur', () => setTimeout(() => {
            if (this.contextPopup === popup && !popup.contains(document.activeElement)) {
                this.closeAnnotationPopup();
            }
        }, 0));
        submit.addEventListener('mousedown', downEvent => downEvent.preventDefault());
        submit.addEventListener('click', accept);
        popup.addEventListener('contextmenu', popupEvent => popupEvent.preventDefault());
        popup.append(input, submit);
        document.body.appendChild(popup);
        this.contextPopup = popup;
        input.focus();
    }

    protected closeAnnotationPopup(): void {
        this.contextPopup?.remove();
        this.contextPopup = undefined;
    }

    /** タイムライン上の右クリックから直接追加する経路。一覧・入力欄は注釈パネルが持つ。 */
    protected async submitAnnotation(text: string, sourceT: number): Promise<void> {
        if (!text || !this.location) {
            return;
        }
        try {
            const result = await this.review.addAnnotation(text, sourceT);
            this.hideNotice();
            this.renderStrip();
            this.footer.textContent = result.committed
                ? '注釈を追加しました。変更を記録しました。'
                : '注釈を追加しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`注釈を追加できません: ${detail}`);
            this.messages.error(`注釈を追加できません: ${detail}`);
        }
    }

    protected showWarnings(warnings: readonly string[]): void {
        if (warnings.length > 0) {
            this.showNotice(warnings.join(' '));
        } else {
            this.hideNotice();
        }
    }

    protected showNotice(message: string): void {
        this.notice.textContent = message;
        this.notice.style.display = 'block';
    }

    protected hideNotice(): void {
        this.notice.textContent = '';
        this.notice.style.display = 'none';
    }

    protected formatRulerTimestamp(value: number): string {
        const seconds = Math.max(0, Math.floor(value));
        const minutes = Math.floor(seconds / 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }

    protected formatTimestamp(value: number): string {
        const milliseconds = Math.max(0, Math.round(value * 1000));
        const hours = Math.floor(milliseconds / 3_600_000);
        const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
        const seconds = Math.floor((milliseconds % 60_000) / 1000);
        const fraction = milliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
            `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
