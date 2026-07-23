import URI from '@theia/core/lib/common/uri';
import { CommandService, Disposable, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    AkariAnnotationsService,
    Annotation,
    CaptionWritePayload,
    OverlayWritePayload,
    WAVEFORM_BUCKET_COUNT,
    WriteBackResult
} from '../common/akari-annotations-protocol';
import { parseReview } from '../common/annotation-store';
import { CaptionRecord, parseCaptions } from '../common/caption-store';
import {
    EditAudioBgm,
    EditAudioSfx,
    EditBeat,
    EditCut,
    EditLayer,
    EditOverlay,
    parseEdit
} from '../common/edit-store';
import { assignSubRows } from '../common/lane-layout';
import { OPEN_AKARI_INSPECTOR_ID, OPEN_AKARI_REVIEW_PANEL_ID } from './akari-annotations-commands';
import { ProjectLocation } from './project-location';
import { ReviewModel } from './review-model';
import { TimelineSelectionModel } from './timeline-selection-model';

const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';
const HISTORY_LIMIT = 50;
const PLAYHEAD_FOLLOW_THRESHOLD = 0.78;
const MINIMUM_ITEM_DURATION = 0.15;
const DRAG_THRESHOLD_PX = 3;
const EDGE_ZONE_PX = 6;
const SNAP_THRESHOLD_PX = 6;
const SNAP_GRID_SECONDS = 0.25;
const SNAP_GUIDE_COLOR_DEFAULT = '#06b6d4';
const SNAP_GUIDE_COLOR_PLAYHEAD = '#f59e0b';
const MIN_VIEW_DURATION_FRAMES = 4;
const RULER_MIN_TICK_SPACING_PX = 80;
const RULER_STEP_MULTIPLIERS_FRAMES = [1, 2, 5, 10, 20, 50, 100];
const RULER_STEP_SECONDS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_BAND_HEIGHT_PX = 14;
const RULER_TICK_COLOR = '#3f3f46';
const RULER_BAND_BACKGROUND = '#1e1e21';
const STRIP_BACKGROUND = '#1a1d22';
const STRIP_BORDER_COLOR = '#2a2d33';
const ZOOM_SLIDER_RESOLUTION = 1000;
const ZOOM_WHEEL_SENSITIVITY = 0.01;
const ZOOM_EVENT_FACTOR_MIN = 1 / 1.5;
const ZOOM_EVENT_FACTOR_MAX = 1.5;
const MIN_CLIP_WIDTH_FOR_MEDIA_PX = 40;
const PLAYHEAD_COLOR = '#3b82f6';
const MICRO_CLIP_WIDTH_PX = 28;
const WAVEFORM_CANVAS_HEIGHT_PX = 64;
const CLIP_HEADER_HEIGHT = 28;
/** クリップ帯の高さ（ヘッダー帯28px + サムネイル/波形本体44px）。 */
const CLIP_HEIGHT = CLIP_HEADER_HEIGHT + 44;
const LANE_GAP = 6;
const SUBROW_HEIGHT = 32;
const SUBROW_GAP = 4;
const SUBROW_STRIDE = SUBROW_HEIGHT + SUBROW_GAP;
const STRIP_BOTTOM_MARGIN = 6;
const TRACK_HEADER_WIDTH = 136;
const BEAT_PROJECTION_EPSILON = 0.000001;

/** タイムライン（出力秒軸）上の1セグメント。cuts[] を配列順にギャップなく連結した結果。 */
interface OutputSegment {
    index: number;
    src?: string;
    in: number;
    out: number;
    speed: number;
    transitionOut?: { type: string; duration: number };
    tlStart: number;
    tlEnd: number;
}

type ToolMode = 'select' | 'razor';

type TimelineSelection =
    | { kind: 'cut'; index: number }
    | { kind: 'overlay'; id: string }
    | { kind: 'caption'; id: string }
    | { kind: 'layer'; id: string }
    | { kind: 'audio'; id: string }
    | undefined;

interface SnapCandidate {
    time: number;
    isPlayhead?: boolean;
}

export interface PreviewPlaybackTick {
    videoUri?: string;
    time?: number;
    playing?: boolean;
}

interface HistoryEntry {
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    label: string;
}

type TimelineClipboard =
    | { kind: 'caption'; payload: Pick<CaptionWritePayload, 'text' | 'start' | 'end'> }
    | { kind: 'overlay'; payload: OverlayWritePayload };

const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
const TIMELINE_SET_MUTED_EVENT = 'akari.timeline.setMuted';
const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
const TIMELINE_SET_CLIPS_VISIBILITY_EVENT = 'akari.timeline.setClipsVisibility';
const TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT = 'akari.timeline.setOverlayTrackMuted';
const TIMELINE_SET_LAYERS_VISIBILITY_EVENT = 'akari.timeline.setLayersVisibility';
const TIMELINE_SET_LAYERS_MUTED_EVENT = 'akari.timeline.setLayersMuted';
const TIMELINE_SET_AUDIO_VISIBILITY_EVENT = 'akari.timeline.setAudioVisibility';
const TIMELINE_SET_AUDIO_MUTED_EVENT = 'akari.timeline.setAudioMuted';
const TIMELINE_SET_CAPTIONS_MUTED_EVENT = 'akari.timeline.setCaptionsMuted';
const TIMELINE_SET_BEATS_VISIBILITY_EVENT = 'akari.timeline.setBeatsVisibility';
const TIMELINE_SET_BEATS_MUTED_EVENT = 'akari.timeline.setBeatsMuted';

interface OverlayTrackLayout {
    track: number;
    top: number;
    height: number;
    rows: number[];
}

const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};

const BEAT_KIND_COLORS: Record<string, string> = {
    hook: 'var(--theia-charts-blue, #3794ff)',
    turn: 'var(--theia-charts-orange, #d19a66)',
    punchline: 'var(--theia-charts-yellow, #cca700)',
    reveal: 'var(--theia-charts-red, #f14c4c)',
    emotion: 'var(--theia-charts-purple, #b180d7)'
};
const DEFAULT_BEAT_COLOR = 'var(--theia-charts-green, #89d185)';

interface DragBase {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    element: HTMLDivElement;
    ghost: HTMLDivElement;
    dragged: boolean;
}

type DragDetail =
    | { kind: 'cut-trim'; index: number; edge: 'left' | 'right'; originalIn: number; originalOut: number }
    | { kind: 'cut-reorder'; index: number; originalTlStart: number; duration: number }
    | { kind: 'caption'; id: string; mode: 'move' | 'start' | 'end'; originalStart: number; originalEnd: number }
    | { kind: 'overlay'; id: string; mode: 'move' | 'resize'; originalStart: number; originalDuration: number; originalTrack: number };

type DragState = DragBase & DragDetail;

type DragPreview =
    | { kind: 'cut-trim'; index: number; input: number; output: number }
    | { kind: 'cut-reorder'; fromIndex: number; toIndex: number }
    | { kind: 'caption'; id: string; deltaStart: number; deltaEnd: number; start: number; end: number }
    | { kind: 'overlay-move'; id: string; start: number; track: number }
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
    protected readonly selectToolButton = document.createElement('button');
    protected readonly razorToolButton = document.createElement('button');
    protected readonly snapToggleButton = document.createElement('button');
    protected readonly undoButton = document.createElement('button');
    protected readonly redoButton = document.createElement('button');
    protected readonly zoomHud = document.createElement('div');
    protected readonly zoomIcon = document.createElement('span');
    protected readonly zoomLabel = document.createElement('span');
    protected readonly zoomSlider = document.createElement('input');
    protected readonly reviewButton = document.createElement('button');
    protected readonly timelineViewport = document.createElement('div');
    protected readonly trackHeaderColumn = document.createElement('div');
    protected readonly trackHeaderRulerSpacer = document.createElement('div');
    protected readonly trackHeadersViewport = document.createElement('div');
    protected readonly trackHeaders = document.createElement('div');
    protected readonly timelineBody = document.createElement('div');
    protected readonly rulerBar = document.createElement('div');
    protected readonly stripScroll = document.createElement('div');
    protected readonly timelineOverlay = document.createElement('div');
    protected readonly hScrollbarTrack = document.createElement('div');
    protected readonly hScrollbarThumb = document.createElement('div');
    protected readonly strip = document.createElement('div');
    protected readonly playhead = document.createElement('div');
    protected readonly playheadHandle = document.createElement('div');
    protected readonly snapGuide = document.createElement('div');
    protected readonly dragFeedback = document.createElement('div');
    protected readonly notice = document.createElement('div');
    protected readonly footer = document.createElement('div');

    @inject(ReviewModel)
    protected readonly review!: ReviewModel;

    @inject(TimelineSelectionModel)
    protected readonly selectionModel!: TimelineSelectionModel;

    protected location: ProjectLocation | undefined;
    protected captions: CaptionRecord[] = [];
    protected cuts: EditCut[] = [];
    protected overlays: EditOverlay[] = [];
    protected beats: EditBeat[] = [];
    protected layers: EditLayer[] = [];
    protected audioSfx: EditAudioSfx[] = [];
    protected audioBgm: EditAudioBgm | undefined;
    protected segments: OutputSegment[] = [];
    protected wordBoundaries: number[] = [];
    protected configured = false;
    protected dragState: DragState | undefined;
    protected renderStripPending = false;
    protected past: HistoryEntry[] = [];
    protected future: HistoryEntry[] = [];
    protected contextPopup: HTMLDivElement | undefined;
    protected viewStart = 0;
    protected viewDuration: number | undefined;
    protected fps = 30;
    /** 出力秒（アウトプットタイムライン軸）。cuts が無ければ source 秒と一致する。 */
    protected playheadT = 0;
    protected thumbnailCache = new Map<string, string | 'pending' | 'unavailable'>();
    protected waveformCache = new Map<string, number[] | 'pending' | 'unavailable'>();
    protected ffmpegMissingNoticeShown = false;
    protected toolMode: ToolMode = 'select';
    protected snapEnabled = true;
    protected selection: TimelineSelection;
    protected clipboard: TimelineClipboard | undefined;
    protected overlayTrackLayouts: OverlayTrackLayout[] = [];
    protected clipMuted = false;
    protected clipsVisible = true;
    protected captionsVisible = true;
    protected captionsMuted = false;
    protected beatsVisible = true;
    protected beatsMuted = false;
    protected layersVisible = true;
    protected layersMuted = false;
    protected audioVisible = true;
    protected audioMuted = false;
    protected readonly hiddenTracks = new Set<number>();
    protected readonly mutedOverlayTracks = new Set<number>();

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
            gridTemplateRows: 'auto minmax(0, 1fr) auto auto auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '4px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        this.configureIconButton(this.selectToolButton, 'codicon-cursor', '選択ツール', '選択 (A)');
        this.selectToolButton.addEventListener('click', () => this.setToolMode('select'));
        this.configureIconButton(this.razorToolButton, 'codicon-screen-cut', '分割ツール', '分割 (B)');
        this.razorToolButton.addEventListener('click', () => this.setToolMode('razor'));
        this.configureIconButton(this.snapToggleButton, 'codicon-magnet', 'マグネット', 'マグネット（スナップ）切替 (N)');
        this.snapToggleButton.addEventListener('click', () => this.setSnapEnabled(!this.snapEnabled));
        this.configureIconButton(this.undoButton, 'codicon-discard', '元に戻す', '元に戻す (⌘Z)');
        this.undoButton.disabled = true;
        this.undoButton.addEventListener('click', () => void this.performUndo());
        this.configureIconButton(this.redoButton, 'codicon-redo', 'やり直す', 'やり直す (⇧⌘Z)');
        this.redoButton.disabled = true;
        this.redoButton.addEventListener('click', () => void this.performRedo());
        this.toolbar.append(
            this.selectToolButton, this.razorToolButton,
            this.createToolbarSeparator(),
            this.snapToggleButton,
            this.createToolbarSeparator(),
            this.undoButton, this.redoButton
        );
        this.updateToolModeButtons();
        this.updateSnapButton();
        Object.assign(this.zoomHud.style, {
            display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto'
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
        this.toolbar.append(this.zoomHud, this.reviewButton);

        Object.assign(this.timelineViewport.style, {
            display: 'grid', gridTemplateColumns: `${TRACK_HEADER_WIDTH}px minmax(0, 1fr)`, minHeight: '0',
            paddingLeft: '10px', boxSizing: 'border-box'
        });
        Object.assign(this.trackHeaderColumn.style, {
            display: 'grid', gridTemplateRows: `${RULER_BAND_HEIGHT_PX}px minmax(0, 1fr)`,
            minHeight: '0', margin: '8px 0'
        });
        Object.assign(this.trackHeaderRulerSpacer.style, {
            border: '1px solid var(--theia-widget-border)', borderRight: '0', borderBottom: '0',
            borderRadius: '4px 0 0 0', background: RULER_BAND_BACKGROUND, boxSizing: 'border-box'
        });
        Object.assign(this.trackHeadersViewport.style, {
            minHeight: '0', overflow: 'hidden', border: '1px solid var(--theia-widget-border)',
            borderRight: '0', borderRadius: '0 0 0 4px',
            background: 'var(--theia-editorWidget-background)', boxSizing: 'border-box'
        });
        Object.assign(this.trackHeaders.style, {
            position: 'relative', width: `${TRACK_HEADER_WIDTH}px`, boxSizing: 'border-box'
        });
        Object.assign(this.timelineBody.style, {
            position: 'relative', display: 'grid', gridTemplateRows: `${RULER_BAND_HEIGHT_PX}px minmax(0, 1fr)`,
            minWidth: '0', minHeight: '0', margin: '8px 10px 8px 0'
        });
        Object.assign(this.rulerBar.style, {
            position: 'relative', minWidth: '0', overflow: 'hidden', background: RULER_BAND_BACKGROUND,
            border: `1px solid ${STRIP_BORDER_COLOR}`, borderBottom: '0', borderRadius: '0 4px 0 0',
            boxSizing: 'border-box', cursor: 'pointer'
        });
        this.strip.classList.add('akari-annotations-strip');
        Object.assign(this.strip.style, {
            position: 'relative', width: '100%', minWidth: '100%',
            border: `1px solid ${STRIP_BORDER_COLOR}`, borderRadius: '0 0 4px 0', boxSizing: 'border-box',
            background: STRIP_BACKGROUND, cursor: 'pointer', overflow: 'hidden'
        });
        Object.assign(this.timelineOverlay.style, {
            position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '9'
        });
        Object.assign(this.playhead.style, {
            position: 'absolute', top: '0', bottom: '0', width: '2px',
            background: PLAYHEAD_COLOR, left: '0%', pointerEvents: 'none',
            boxShadow: `0 0 4px 1px ${PLAYHEAD_COLOR}`
        });
        Object.assign(this.playheadHandle.style, {
            position: 'absolute', top: '0', left: '50%', width: '14px', height: '16px',
            transform: 'translateX(-50%)', cursor: 'ew-resize', pointerEvents: 'auto'
        });
        this.playheadHandle.setAttribute('aria-hidden', 'true');
        this.playheadHandle.innerHTML =
            `<svg width="14" height="16" viewBox="0 0 14 16" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M0 0H14V10L7 16L0 10Z" fill="${PLAYHEAD_COLOR}"/></svg>`;
        this.playheadHandle.addEventListener('pointerdown', event => this.onPlayheadHandlePointerDown(event));
        this.playhead.appendChild(this.playheadHandle);
        Object.assign(this.snapGuide.style, {
            position: 'absolute', top: '0', bottom: '0', width: '1px', display: 'none',
            background: SNAP_GUIDE_COLOR_DEFAULT, pointerEvents: 'none'
        });
        Object.assign(this.dragFeedback.style, {
            position: 'absolute', display: 'none', padding: '2px 6px', fontSize: '10px',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            color: 'var(--theia-editor-foreground, #fff)',
            background: 'var(--theia-editorHoverWidget-background, rgba(30,30,30,.9))',
            border: '1px solid var(--theia-editorHoverWidget-border, rgba(255,255,255,.2))',
            borderRadius: '3px', pointerEvents: 'none'
        });
        this.timelineOverlay.append(this.playhead, this.snapGuide, this.dragFeedback);
        this.strip.addEventListener('click', event => this.onStripClick(event));
        this.strip.addEventListener('wheel', event => this.onWheelZoom(event), { passive: false });
        this.strip.addEventListener('contextmenu', event => this.openAnnotationPopup(event));
        this.rulerBar.addEventListener('click', event => this.onStripClick(event));
        this.rulerBar.addEventListener('wheel', event => this.onWheelZoom(event), { passive: false });
        this.rulerBar.addEventListener('contextmenu', event => this.openAnnotationPopup(event));

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });
        Object.assign(this.stripScroll.style, { minHeight: '0', overflow: 'auto' });
        Object.assign(this.hScrollbarTrack.style, {
            position: 'relative', height: '14px', margin: '0 10px 8px 10px', flex: 'none',
            background: 'var(--theia-scrollbarSlider-background, rgba(121,121,121,.35))',
            borderRadius: '7px', cursor: 'pointer', display: 'none'
        });
        this.hScrollbarTrack.setAttribute('data-testid', 'akari-timeline-hscrollbar-track');
        Object.assign(this.hScrollbarThumb.style, {
            position: 'absolute', top: '2px', bottom: '2px', left: '0%', width: '100%',
            background: 'var(--theia-scrollbarSlider-hoverBackground, rgba(100,100,100,.75))',
            borderRadius: '5px', cursor: 'grab'
        });
        this.hScrollbarThumb.setAttribute('data-testid', 'akari-timeline-hscrollbar-thumb');
        this.hScrollbarTrack.appendChild(this.hScrollbarThumb);
        this.hScrollbarTrack.addEventListener('click', event => this.onScrollbarTrackClick(event));
        this.hScrollbarThumb.addEventListener('pointerdown', event => this.onScrollbarThumbPointerDown(event));
        this.stripScroll.appendChild(this.strip);
        this.stripScroll.addEventListener('scroll', () => {
            this.trackHeaders.style.transform = `translateY(${-this.stripScroll.scrollTop}px)`;
        });
        this.trackHeadersViewport.appendChild(this.trackHeaders);
        this.trackHeaderColumn.append(this.trackHeaderRulerSpacer, this.trackHeadersViewport);
        this.timelineBody.append(this.rulerBar, this.stripScroll, this.timelineOverlay);
        this.timelineViewport.append(this.trackHeaderColumn, this.timelineBody);
        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'タイムラインをクリックすると時刻を選べます。プレビューを開いていればその場でシークします。';

        this.node.append(this.toolbar, this.timelineViewport, this.hScrollbarTrack, this.notice, this.footer);
        const style = document.createElement('style');
        style.textContent = `
    .akari-annotations-widget .akari-annotations-strip-clip {
        background: #27272a;
        border: 1px solid #3f3f46;
        border-right-width: 2px;
        border-radius: 0;
        box-shadow: none;
        box-sizing: border-box;
        color: #e5e5e5;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: ${CLIP_HEADER_HEIGHT}px;
        background: #2c8a9a;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        padding: 0 3px;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 12px;
        line-height: ${CLIP_HEADER_HEIGHT}px;
        color: #e5e5e5;
        pointer-events: none;
        overflow: hidden;
        white-space: nowrap;
        z-index: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-label,
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        flex: none;
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
    .akari-annotations-widget .akari-annotations-strip-layer,
    .akari-annotations-widget .akari-annotations-strip-audio {
        border-radius: 2px;
        cursor: pointer;
    }
    .akari-annotations-widget .akari-annotations-strip-layer-baked {
        background: var(--theia-charts-blue, #3794ff);
        opacity: .76;
    }
    .akari-annotations-widget .akari-annotations-strip-layer-video {
        background: var(--theia-charts-purple, #b180d7);
        opacity: .76;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-sfx {
        background: var(--theia-charts-green, #89d185);
        opacity: .72;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-bgm {
        background: color-mix(in srgb, var(--theia-charts-green, #89d185) 50%, var(--theia-charts-blue, #3794ff));
        opacity: .66;
    }
    .akari-annotations-widget .akari-track-band {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-beats-band-label {
        position: absolute;
        left: 3px;
        top: 0;
        height: ${SUBROW_HEIGHT}px;
        padding: 0 3px;
        border-radius: 2px;
        background: color-mix(in srgb, ${STRIP_BACKGROUND} 82%, transparent);
        color: var(--theia-descriptionForeground);
        font-size: 9px;
        line-height: ${SUBROW_HEIGHT}px;
        pointer-events: none;
        z-index: 2;
    }
    .akari-annotations-widget .akari-beat-marker {
        position: absolute;
        box-sizing: border-box;
        transform: translateX(-50%) rotate(45deg);
        transform-origin: center;
        border: 1px solid color-mix(in srgb, var(--theia-editorWidget-background) 65%, white);
        box-shadow: 0 0 2px var(--theia-editorWidget-background);
        cursor: default;
        pointer-events: auto;
        z-index: 3;
    }
    .akari-annotations-widget .akari-beat-marker:hover {
        filter: brightness(1.2);
    }
    .akari-annotations-widget .akari-track-band-hidden,
    .akari-annotations-widget .akari-track-band-hidden + .akari-annotations-strip-overlay {
        opacity: .28;
    }
    .akari-annotations-widget .akari-track-header-button {
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        padding: 2px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-foreground);
        cursor: pointer;
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-row {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 3px;
        min-width: 0;
        padding: 0 3px;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        box-sizing: border-box;
    }
    .akari-annotations-widget .akari-track-header-icon {
        width: 17px;
        height: 17px;
        display: grid;
        place-items: center;
        color: var(--theia-descriptionForeground);
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-icon svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
    }
    .akari-annotations-widget .akari-track-header-name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-track-header-button[aria-pressed="false"] { opacity: .4; }
    .akari-annotations-widget .akari-track-header-button:hover { background: var(--theia-toolbar-hoverBackground); }
    .akari-annotations-widget .akari-track-header-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    .akari-annotations-widget .akari-annotations-selected {
        border: 2px solid var(--theia-focusBorder);
        box-sizing: border-box;
        opacity: 1;
        z-index: 5;
    }
    .akari-annotations-widget .akari-annotations-strip-caption-text {
        position: absolute;
        height: ${SUBROW_HEIGHT}px;
        display: flex;
        align-items: center;
        white-space: nowrap;
        font-size: 13px;
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
        font-size: 12px;
        line-height: ${SUBROW_HEIGHT}px;
        pointer-events: none;
        text-shadow: 0 1px 2px #000;
    }
    .akari-annotations-widget .akari-annotations-selected {
        outline: 2px solid var(--theia-focusBorder, #fff);
        outline-offset: 1px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .65);
        z-index: 2;
    }
    .akari-annotations-widget .akari-annotations-strip-clip.akari-annotations-selected {
        outline: 2px solid #f97316;
        outline-offset: -2px;
        border-left: 2px solid #ffffff;
        border-right: 2px solid #ffffff;
        box-shadow: none;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip:hover::before,
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip:hover::after {
        content: '';
        position: absolute;
        top: 3px;
        bottom: 3px;
        width: 10px;
        background: rgba(255, 255, 255, .18);
        pointer-events: none;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip:hover::before {
        left: 0;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip:hover::after {
        right: 0;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip-micro:hover::before,
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip-micro:hover::after {
        content: none;
        display: none;
    }
    .akari-annotations-widget .akari-annotations-icon-button {
        width: 26px;
        height: 26px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
    }
    .akari-annotations-widget .akari-annotations-icon-button[aria-pressed="true"] {
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
`;
        this.node.appendChild(style);

        const keydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && this.dragState) {
                event.preventDefault();
                this.cancelDrag(this.dragState);
                return;
            }
            if (event.key === 'Escape' && this.isAttached && this.selection) {
                event.preventDefault();
                event.stopPropagation();
                this.applySelection(undefined);
                return;
            }
            if (!this.isAttached || this.isEditableTarget(event.target) || this.isEditableTarget(document.activeElement)) {
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                event.stopPropagation();
                this.copySelectedItem();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                event.stopPropagation();
                void this.pasteClipboard();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.stopPropagation();
                if (event.shiftKey) {
                    void this.performRedo();
                } else {
                    void this.performUndo();
                }
                return;
            }
            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === 'a') {
                    event.preventDefault();
                    this.setToolMode('select');
                    return;
                }
                if (key === 'b') {
                    event.preventDefault();
                    this.setToolMode('razor');
                    return;
                }
                if (key === 'n') {
                    event.preventDefault();
                    this.setSnapEnabled(!this.snapEnabled);
                    return;
                }
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection?.kind === 'cut') {
                event.preventDefault();
                void this.performDeleteSelectedCut();
            }
        };
        // 注釈が増減したらピンを描き直す。パネルの時刻リンクからのジャンプもここで受ける。
        this.toDispose.push(this.review.onChanged(() => this.renderStrip()));
        this.toDispose.push(this.review.onSeekRequested(time => {
            this.selectedSourceT = time;
            this.playheadT = time;
            this.renderStrip();
            void this.requestSeek(time);
        }));

        window.addEventListener('keydown', keydown, true);
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('keydown', keydown, true);
            this.closeAnnotationPopup();
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
        }));
    }

    protected configureIconButton(button: HTMLButtonElement, icon: string, ariaLabel: string, title: string): void {
        button.type = 'button';
        button.className = 'theia-button secondary akari-annotations-icon-button';
        button.setAttribute('aria-label', ariaLabel);
        button.title = title;
        button.replaceChildren();
        const iconSpan = document.createElement('span');
        iconSpan.className = `codicon ${icon}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        button.appendChild(iconSpan);
    }

    protected createToolbarSeparator(): HTMLDivElement {
        const separator = document.createElement('div');
        Object.assign(separator.style, {
            width: '1px', height: '18px', margin: '0 4px', flex: 'none',
            background: 'var(--theia-widget-border)'
        });
        return separator;
    }

    protected setToolMode(mode: ToolMode): void {
        if (this.toolMode === mode) {
            return;
        }
        this.toolMode = mode;
        this.updateToolModeButtons();
        this.node.classList.toggle('akari-annotations-tool-razor', mode === 'razor');
        this.strip.style.cursor = mode === 'razor' ? 'crosshair' : 'pointer';
        this.renderStrip();
    }

    protected updateToolModeButtons(): void {
        this.selectToolButton.setAttribute('aria-pressed', String(this.toolMode === 'select'));
        this.razorToolButton.setAttribute('aria-pressed', String(this.toolMode === 'razor'));
    }

    protected setSnapEnabled(value: boolean): void {
        this.snapEnabled = value;
        this.updateSnapButton();
        if (!value) {
            this.hideSnapGuide();
        }
    }

    protected updateSnapButton(): void {
        this.snapToggleButton.setAttribute('aria-pressed', String(this.snapEnabled));
    }

    protected isEditableTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    }

    protected selectionFromDragState(state: DragState): TimelineSelection {
        if (state.kind === 'cut-trim' || state.kind === 'cut-reorder') {
            return { kind: 'cut', index: state.index };
        }
        if (state.kind === 'caption') {
            return { kind: 'caption', id: state.id };
        }
        return { kind: 'overlay', id: state.id };
    }

    protected applySelection(selection: TimelineSelection, notifyPreview = true): void {
        const previous = this.selection;
        if (this.selectionKey(previous) === this.selectionKey(selection)) {
            return;
        }
        this.selection = selection;
        this.pushSelectionSnapshot();
        this.applySelectionClass();
        // オーバーレイ選択はタイムライン⇔プレビューwebviewで双方向同期する（クリップ/字幕には対応先がないため対象外）。
        if (notifyPreview && (previous?.kind === 'overlay' || selection?.kind === 'overlay')) {
            window.dispatchEvent(new CustomEvent(TIMELINE_OVERLAY_SELECTED_EVENT, {
                detail: {
                    editUri: this.location?.editUri?.toString() ?? '',
                    overlayId: selection?.kind === 'overlay' ? selection.id : null
                }
            }));
        }
        // クリップは同じクリック内の requestSeek が open+seek を直列化する。
        // レイヤー/オーディオはシークを伴わないため reveal コマンドで出力プレビューを開く。
        if (selection?.kind === 'layer' || selection?.kind === 'audio') {
            this.revealOutputPreview();
        }
        if (selection) {
            void this.commands.executeCommand(OPEN_AKARI_INSPECTOR_ID);
        }
    }

    protected selectionKey(selection: TimelineSelection): string {
        if (!selection) {
            return '';
        }
        return selection.kind === 'cut' ? `cut:${selection.index}` : `${selection.kind}:${selection.id}`;
    }

    protected applySelectionClass(): void {
        const selection = this.selection;
        for (const element of Array.from(this.strip.querySelectorAll<HTMLElement>('[data-akari-item-kind]'))) {
            const kind = element.dataset.akariItemKind;
            const id = element.dataset.akariItemId;
            const selected = selection !== undefined && selection.kind === kind
                && (selection.kind === 'cut' ? String(selection.index) === id : selection.id === id);
            element.classList.toggle('akari-annotations-selected', selected);
        }
    }

    handleOverlaySelection(editUri: string, overlayId: string | null): void {
        if (!this.canHandlePlaybackTick(editUri)) {
            return;
        }
        if (overlayId === null) {
            if (this.selection?.kind === 'overlay') {
                this.applySelection(undefined, false);
            }
            return;
        }
        if (this.overlays.some(overlay => overlay.id === overlayId)) {
            this.applySelection({ kind: 'overlay', id: overlayId }, false);
        }
    }

    /** 選択の実体を TimelineSelectionModel へ反映する。対象が消えていれば選択解除する。 */
    protected pushSelectionSnapshot(): void {
        const selection = this.selection;
        if (!selection) {
            this.selectionModel.snapshot = undefined;
            return;
        }
        if (selection.kind === 'cut') {
            const segment = this.segments[selection.index];
            const cut = this.cuts[selection.index];
            if (!segment || !cut) {
                this.selection = undefined;
                this.selectionModel.snapshot = undefined;
                return;
            }
            this.selectionModel.snapshot = {
                kind: 'cut', index: selection.index, label: `C${selection.index + 1}`,
                sourceName: this.sourceBaseName(), sourceIn: cut.in, sourceOut: cut.out,
                outputStart: segment.tlStart, outputEnd: segment.tlEnd
            };
        } else if (selection.kind === 'overlay') {
            const overlay = this.overlays.find(candidate => candidate.id === selection.id);
            if (!overlay) {
                this.selection = undefined;
                this.selectionModel.snapshot = undefined;
                return;
            }
            this.selectionModel.snapshot = { kind: 'overlay', id: overlay.id, outputStart: overlay.start, duration: overlay.duration };
        } else if (selection.kind === 'caption') {
            const caption = this.captions.find(candidate => candidate.id === selection.id);
            if (!caption) {
                this.selection = undefined;
                this.selectionModel.snapshot = undefined;
                return;
            }
            const ranges = this.sourceRangeToOutputRanges(caption.start, caption.end);
            this.selectionModel.snapshot = {
                kind: 'caption', id: caption.id, text: caption.text,
                sourceStart: caption.start, sourceEnd: caption.end,
                outputStart: ranges.length > 0 ? ranges[0][0] : undefined,
                outputEnd: ranges.length > 0 ? ranges[ranges.length - 1][1] : undefined
            };
        } else if (selection.kind === 'layer') {
            const layer = this.layers.find(candidate => candidate.id === selection.id);
            if (!layer) {
                this.selection = undefined;
                this.selectionModel.snapshot = undefined;
                return;
            }
            this.selectionModel.snapshot = {
                kind: 'layer', id: layer.id, layerKind: layer.kind,
                outputStart: layer.t, duration: layer.duration
            };
        } else {
            const sfx = this.audioSfx.find(candidate => candidate.id === selection.id);
            if (sfx) {
                this.selectionModel.snapshot = {
                    kind: 'audio', id: sfx.id, audioKind: 'sfx', label: this.pathBaseName(sfx.path),
                    outputStart: sfx.t, duration: sfx.duration
                };
            } else if (selection.id === 'bgm' && this.audioBgm) {
                this.selectionModel.snapshot = {
                    kind: 'audio', id: this.audioBgm.id, audioKind: 'bgm', label: this.pathBaseName(this.audioBgm.path),
                    outputStart: 0, duration: this.totalDuration()
                };
            } else {
                this.selection = undefined;
                this.selectionModel.snapshot = undefined;
                return;
            }
        }
        this.selectionModel.fps = this.fps;
    }

    protected sourceBaseName(): string {
        if (!this.location?.videoUri) {
            return '';
        }
        try {
            return new URI(this.location.videoUri).path.base;
        } catch {
            return this.location.videoUri;
        }
    }

    protected pathBaseName(path: string): string {
        return path.split('/').pop() || path;
    }

    /** レザーモードでクリップをクリックした位置（出力秒→source 秒）で cuts を2分割する。 */
    protected async performRazorSplitAt(segment: OutputSegment, clientX: number): Promise<void> {
        const location = this.location;
        if (!location?.editUri) {
            return;
        }
        const outputT = this.timeAtClientX(clientX);
        const sourceT = this.outputToSource(outputT);
        if (sourceT - segment.in < MINIMUM_ITEM_DURATION || segment.out - sourceT < MINIMUM_ITEM_DURATION) {
            this.footer.textContent = 'クリップの端に近すぎるため分割できません（両側 0.15 秒以上必要です）';
            return;
        }
        const index = segment.index;
        const originalIn = segment.in;
        const originalOut = segment.out;
        try {
            const result = await this.annotationsService.splitCut({
                editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                cutIndex: index, atSeconds: sourceT
            });
            this.pushHistory({
                label: 'クリップの分割',
                undo: async () => {
                    await this.annotationsService.deleteCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(), cutIndex: index + 1
                    });
                    await this.annotationsService.trimCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        cutIndex: index, in: originalIn, out: originalOut
                    });
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.annotationsService.splitCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        cutIndex: index, atSeconds: sourceT
                    });
                    await this.reloadEdit();
                }
            });
            await this.reloadEdit();
            this.hideNotice();
            this.footer.textContent = this.writeResultMessage('クリップを分割しました。', result);
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`クリップを分割できません: ${detail}`);
            this.messages.error(`クリップを分割できません: ${detail}`);
        }
    }

    /** 選択中のクリップを削除する（Delete/Backspace）。 */
    protected async performDeleteSelectedCut(): Promise<void> {
        if (this.selection?.kind !== 'cut') {
            return;
        }
        const index = this.selection.index;
        const location = this.location;
        if (!location?.editUri) {
            return;
        }
        try {
            const result = await this.annotationsService.deleteCut({
                editUri: location.editUri.toString(), projectRootUri: location.root.toString(), cutIndex: index
            });
            const removedText = result.removedText;
            this.pushHistory({
                label: 'クリップの削除',
                undo: async () => {
                    await this.annotationsService.insertCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                        cutIndex: index, elementText: removedText
                    });
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.annotationsService.deleteCut({
                        editUri: location.editUri!.toString(), projectRootUri: location.root.toString(), cutIndex: index
                    });
                    await this.reloadEdit();
                }
            });
            this.applySelection(undefined);
            await this.reloadEdit();
            this.hideNotice();
            this.footer.textContent = this.writeResultMessage('クリップを削除しました。', result);
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`クリップを削除できません: ${detail}`);
            this.messages.error(`クリップを削除できません: ${detail}`);
        }
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
        this.beats = [];
        this.layers = [];
        this.audioSfx = [];
        this.audioBgm = undefined;
        this.fps = 30;
        if (this.location?.editUri) {
            try {
                const source = (await this.fileService.readFile(this.location.editUri)).value.toString();
                const parsed = parseEdit(source);
                this.cuts = parsed.cuts;
                this.overlays = parsed.overlays;
                this.beats = parsed.beats ?? [];
                this.layers = parsed.layers;
                this.audioSfx = parsed.audioSfx;
                this.audioBgm = parsed.audioBgm;
                this.fps = parsed.fps;
                if (parsed.warnings.length > 0) {
                    this.showWarnings(parsed.warnings);
                }
            } catch {
                // A missing or unreadable edit.json means no clips or overlays are drawn.
            }
        }
        this.rebuildSegments();
        this.selectionModel.fps = this.fps;
        this.pushSelectionSnapshot();
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
        this.pushSelectionSnapshot();
        this.renderStrip();
    }

    /** cuts[] を配列順にギャップなく連結した出力秒セグメントを再構築する。cuts が変わるたび呼ぶ。 */
    protected rebuildSegments(): void {
        let cursor = 0;
        this.segments = this.cuts.map((cut, index) => {
            const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
            const duration = Math.max(0, cut.out - cut.in) / speed;
            const segment: OutputSegment = {
                index, src: cut.src, in: cut.in, out: cut.out, speed,
                transitionOut: cut.transitionOut, tlStart: cursor, tlEnd: cursor + duration
            };
            cursor += duration;
            if (cut.transitionOut && index < this.cuts.length - 1) {
                cursor -= cut.transitionOut.duration;
            }
            return segment;
        });
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
        if (this.cuts.length > 0) {
            // アウトプット軸: cuts 尺合計とオーバーレイ終端の大きい方（10 秒フロアは cuts があるときは外す）。
            const cutsDuration = this.segments.length > 0 ? this.segments[this.segments.length - 1].tlEnd : 0;
            const overlaysEnd = this.overlays.reduce((max, overlay) => Math.max(max, overlay.start + overlay.duration), 0);
            const layersEnd = this.layers.reduce((max, layer) => Math.max(max, layer.t + layer.duration), 0);
            const sfxEnd = this.audioSfx.reduce((max, sfx) => Math.max(max, sfx.t + sfx.duration), 0);
            return Math.max(cutsDuration, overlaysEnd, layersEnd, sfxEnd) * 1.02;
        }
        const candidates = [
            10,
            ...this.captions.map(caption => caption.end),
            ...this.overlays.map(overlay => overlay.start + overlay.duration),
            ...this.layers.map(layer => layer.t + layer.duration),
            ...this.audioSfx.map(sfx => sfx.t + sfx.duration),
            ...this.beats.map(beat => beat.t + 1),
            ...this.annotations.map(annotation => annotation.sourceT + 1)
        ];
        return Math.max(...candidates) * 1.02;
    }

    /** source 秒 → 出力秒。cuts が無ければ恒等写像（後方互換）。範囲外は最も近いセグメントへクランプする。 */
    protected sourceToOutput(t: number): number {
        if (this.segments.length === 0) {
            return t;
        }
        let best: { segment: OutputSegment; distance: number } | undefined;
        for (const segment of this.segments) {
            if (t >= segment.in && t <= segment.out) {
                return segment.tlStart + (t - segment.in) / segment.speed;
            }
            const distance = t < segment.in ? segment.in - t : t - segment.out;
            if (!best || distance < best.distance) {
                best = { segment, distance };
            }
        }
        const segment = best!.segment;
        const clamped = Math.min(segment.out, Math.max(segment.in, t));
        return segment.tlStart + (clamped - segment.in) / segment.speed;
    }

    /** 出力秒 → source 秒。cuts が無ければ恒等写像（後方互換）。 */
    protected outputToSource(t: number): number {
        if (this.segments.length === 0) {
            return t;
        }
        for (const segment of this.segments) {
            if (t >= segment.tlStart && t <= segment.tlEnd) {
                return segment.in + (t - segment.tlStart) * segment.speed;
            }
        }
        const last = this.segments[this.segments.length - 1];
        if (t > last.tlEnd) {
            return last.out;
        }
        return this.segments[0].in;
    }

    /**
     * source 秒区間 → 出力秒区間の配列。削除区間で分断される字幕を複数区間として返す。
     * src 指定時は同じ src のセグメントだけを対象にする。cuts が無く src も無ければ
     * 入力をそのまま1区間として返す（単一ソース後方互換）。
     */
    protected sourceRangeToOutputRanges(start: number, end: number, src?: string): Array<[number, number]> {
        if (this.segments.length === 0) {
            return src === undefined ? [[start, end]] : [];
        }
        const ranges: Array<[number, number]> = [];
        for (const segment of this.segments) {
            if (src !== undefined && segment.src !== src) {
                continue;
            }
            const overlapStart = Math.max(start, segment.in);
            const overlapEnd = Math.min(end, segment.out);
            if (overlapEnd > overlapStart) {
                ranges.push([
                    segment.tlStart + (overlapStart - segment.in) / segment.speed,
                    segment.tlStart + (overlapEnd - segment.in) / segment.speed
                ]);
            }
        }
        return ranges;
    }

    protected visibleDuration(): number {
        return this.viewDuration ?? this.totalDuration();
    }

    protected renderStrip(): void {
        // DOM 再構築で pointer capture と dragState を壊さないよう、ドラッグ終了まで延期する。
        if (this.dragState) {
            this.renderStripPending = true;
            return;
        }

        const maxDuration = this.totalDuration();
        if (this.viewDuration !== undefined) {
            if (this.viewDuration >= maxDuration) {
                this.viewDuration = undefined;
                this.viewStart = 0;
            } else {
                this.viewStart = Math.min(Math.max(0, this.viewStart), Math.max(0, maxDuration - this.viewDuration));
            }
        }
        this.strip.replaceChildren();
        this.rulerBar.replaceChildren();
        this.renderRuler();

        // レーン構造は NLE 慣行（Wave 23）: 見せ場 → 字幕帯 → オーバーレイのトラック行（track 降順）
        // → レイヤー → オーディオ → クリップ帯（最下段）。
        // 横軸の位置決めは出力軸（Wave 22）: クリップは this.segments（cuts のギャップレス連結）、
        // 字幕は sourceRangeToOutputRanges で source 秒→出力秒へ変換する。オーバーレイ・レイヤー・音声は元々出力秒基準。
        const captionRows = assignSubRows(this.captions.map(c => ({ start: c.start, end: c.end })));
        const captionSubRowCount = captionRows.length ? Math.max(...captionRows) + 1 : 0;
        let nextTop = 0;
        const beatsBandTop = nextTop;
        const beatsBandHeight = this.beats.length > 0 ? SUBROW_STRIDE : 0;
        if (beatsBandHeight > 0) {
            nextTop += beatsBandHeight + LANE_GAP;
        }
        const captionBandTop = nextTop;
        const captionBandHeight = captionSubRowCount * SUBROW_STRIDE;
        if (captionBandHeight > 0) {
            nextTop += captionBandHeight + LANE_GAP;
        }

        const overlayRows = new Map<string, number>();
        this.overlayTrackLayouts = [];
        const overlayTracks = [...new Set(this.overlays.map(overlay => overlay.track))].sort((a, b) => b - a);
        for (const track of overlayTracks) {
            const trackOverlays = this.overlays.filter(overlay => overlay.track === track);
            const rows = assignSubRows(trackOverlays.map(overlay => ({
                start: overlay.start, end: overlay.start + overlay.duration
            })));
            trackOverlays.forEach((overlay, index) => overlayRows.set(overlay.id, rows[index] ?? 0));
            const rowCount = rows.length ? Math.max(...rows) + 1 : 1;
            const height = rowCount * SUBROW_STRIDE;
            this.overlayTrackLayouts.push({ track, top: nextTop, height, rows });
            nextTop += height + LANE_GAP;
        }

        const layerRows = assignSubRows(this.layers.map(layer => ({
            start: layer.t, end: layer.t + layer.duration
        })));
        const layerBandTop = nextTop;
        const layerBandHeight = this.layers.length > 0
            ? (Math.max(...layerRows) + 1) * SUBROW_STRIDE : 0;
        if (layerBandHeight > 0) {
            nextTop += layerBandHeight + LANE_GAP;
        }

        const audioSfxRows = assignSubRows(this.audioSfx.map(sfx => ({
            start: sfx.t, end: sfx.t + sfx.duration
        })));
        const audioBandTop = nextTop;
        const audioSfxRowCount = audioSfxRows.length > 0 ? Math.max(...audioSfxRows) + 1 : 0;
        const audioBandHeight = this.audioSfx.length > 0 || this.audioBgm
            ? ((this.audioBgm ? 1 : 0) + audioSfxRowCount) * SUBROW_STRIDE : 0;
        if (audioBandHeight > 0) {
            nextTop += audioBandHeight + LANE_GAP;
        }
        const clipTop = nextTop;

        // 注釈ピンはルーラー帯（renderRuler）へ描くため、専用レーンは持たない。
        const stripHeight = clipTop + CLIP_HEIGHT + STRIP_BOTTOM_MARGIN;
        this.strip.style.height = `${stripHeight}px`;
        this.trackHeaders.style.height = `${stripHeight}px`;
        this.trackHeaders.style.transform = `translateY(${-this.stripScroll.scrollTop}px)`;
        this.renderTrackHeaders(
            beatsBandTop, beatsBandHeight,
            captionBandTop, captionBandHeight,
            layerBandTop, layerBandHeight,
            audioBandTop, audioBandHeight,
            clipTop
        );

        if (beatsBandHeight > 0) {
            const beatsBand = this.laneBand('beats', beatsBandTop, beatsBandHeight);
            const label = document.createElement('span');
            label.className = 'akari-beats-band-label';
            label.textContent = '見せ場';
            beatsBand.appendChild(label);
            beatsBand.style.opacity = this.beatsVisible ? '1' : '.28';
            this.strip.appendChild(beatsBand);
            this.renderBeatMarkers(beatsBandTop, beatsBandHeight);
        }
        if (captionBandHeight > 0) {
            const captionBand = this.laneBand('captions', captionBandTop, captionBandHeight);
            captionBand.style.opacity = this.captionsVisible ? '1' : '.28';
            this.strip.appendChild(captionBand);
        }
        for (const layout of this.overlayTrackLayouts) {
            const band = this.laneBand(`track-${layout.track}`, layout.top, layout.height);
            band.dataset.akariTrack = String(layout.track);
            band.classList.toggle('akari-track-band-hidden', this.hiddenTracks.has(layout.track));
            this.strip.appendChild(band);
        }
        if (layerBandHeight > 0) {
            const layerBand = this.laneBand('layers', layerBandTop, layerBandHeight);
            layerBand.style.opacity = this.layersVisible ? '1' : '.28';
            this.strip.appendChild(layerBand);
        }
        if (audioBandHeight > 0) {
            const audioBand = this.laneBand('audio', audioBandTop, audioBandHeight);
            audioBand.style.opacity = this.audioVisible ? '1' : '.28';
            this.strip.appendChild(audioBand);
        }
        const clipBand = this.laneBand('clips', clipTop, CLIP_HEIGHT);
        clipBand.style.opacity = this.clipsVisible ? '1' : '.28';
        this.strip.appendChild(clipBand);

        this.captions.forEach((caption, index) => {
            const captionEnd = Math.max(caption.end, caption.start + MINIMUM_ITEM_DURATION);
            const outputRanges = this.sourceRangeToOutputRanges(caption.start, captionEnd);
            if (outputRanges.length === 0) {
                // 削除区間に完全に落ちた字幕は非表示にする。
                return;
            }
            const [outputStart, outputEnd] = [outputRanges[0][0], outputRanges[outputRanges.length - 1][1]];
            const top = captionBandTop + captionRows[index] * SUBROW_STRIDE;
            const element = this.stripSegment(
                outputStart, outputEnd, top, SUBROW_HEIGHT, 'akari-annotations-strip-caption', caption.text
            );
            element.dataset.akariItemKind = 'caption';
            element.dataset.akariItemId = caption.id;
            element.dataset.akariLane = 'captions';
            element.style.opacity = this.captionsVisible ? '' : '.28';
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
            const label = this.captionLabel(outputStart, caption.text, top);
            label.style.opacity = this.captionsVisible ? '' : '.28';
            this.strip.appendChild(label);
        });
        this.overlays.forEach(overlay => {
            const layout = this.overlayTrackLayouts.find(candidate => candidate.track === overlay.track);
            const top = (layout?.top ?? captionBandTop + captionBandHeight + LANE_GAP)
                + (overlayRows.get(overlay.id) ?? 0) * SUBROW_STRIDE;
            const element = this.stripSegment(
                overlay.start, overlay.start + overlay.duration, top, SUBROW_HEIGHT,
                'akari-annotations-strip-overlay', overlay.id
            );
            element.dataset.akariItemKind = 'overlay';
            element.dataset.akariItemId = overlay.id;
            element.dataset.akariTrack = String(overlay.track);
            element.style.opacity = this.hiddenTracks.has(overlay.track) ? '.28' : '';
            element.appendChild(this.segmentLabel(overlay.id));
            this.installDragListeners(element, (event, rect) => ({
                kind: 'overlay', id: overlay.id,
                mode: rect.right - event.clientX <= EDGE_ZONE_PX ? 'resize' : 'move',
                originalStart: overlay.start, originalDuration: overlay.duration, originalTrack: overlay.track
            }));
            this.strip.appendChild(element);
        });
        this.layers.forEach((layer, index) => {
            const top = layerBandTop + (layerRows[index] ?? 0) * SUBROW_STRIDE;
            const element = this.stripSegment(
                layer.t, layer.t + layer.duration, top, SUBROW_HEIGHT,
                `akari-annotations-strip-layer akari-annotations-strip-layer-${layer.kind}`, layer.id
            );
            element.dataset.akariItemKind = 'layer';
            element.dataset.akariItemId = layer.id;
            element.dataset.akariLane = 'layers';
            element.style.pointerEvents = 'auto';
            element.style.opacity = this.layersVisible ? '' : '.28';
            element.appendChild(this.segmentLabel(layer.id));
            element.addEventListener('click', event => {
                event.stopPropagation();
                this.applySelection({ kind: 'layer', id: layer.id });
            });
            this.strip.appendChild(element);
        });
        if (this.audioBgm) {
            const bgm = this.audioBgm;
            const label = this.pathBaseName(bgm.path);
            const element = this.stripSegment(
                0, this.totalDuration(), audioBandTop, SUBROW_HEIGHT,
                'akari-annotations-strip-audio akari-annotations-strip-audio-bgm', label
            );
            element.dataset.akariItemKind = 'audio';
            element.dataset.akariItemId = bgm.id;
            element.dataset.akariLane = 'audio';
            element.style.pointerEvents = 'auto';
            element.style.opacity = this.audioVisible ? '' : '.28';
            element.appendChild(this.segmentLabel(label));
            element.addEventListener('click', event => {
                event.stopPropagation();
                this.applySelection({ kind: 'audio', id: bgm.id });
            });
            this.strip.appendChild(element);
        }
        this.audioSfx.forEach((sfx, index) => {
            const rowOffset = this.audioBgm ? 1 : 0;
            const top = audioBandTop + (rowOffset + (audioSfxRows[index] ?? 0)) * SUBROW_STRIDE;
            const label = this.pathBaseName(sfx.path);
            const element = this.stripSegment(
                sfx.t, sfx.t + sfx.duration, top, SUBROW_HEIGHT,
                'akari-annotations-strip-audio akari-annotations-strip-audio-sfx', label
            );
            element.dataset.akariItemKind = 'audio';
            element.dataset.akariItemId = sfx.id;
            element.dataset.akariLane = 'audio';
            element.style.pointerEvents = 'auto';
            element.style.opacity = this.audioVisible ? '' : '.28';
            element.appendChild(this.segmentLabel(label));
            element.addEventListener('click', event => {
                event.stopPropagation();
                this.applySelection({ kind: 'audio', id: sfx.id });
            });
            this.strip.appendChild(element);
        });
        this.segments.forEach(segment => {
            const cut = this.cuts[segment.index];
            const element = this.stripSegment(
                segment.tlStart, segment.tlEnd, clipTop, CLIP_HEIGHT,
                'akari-annotations-strip-clip', `C${segment.index + 1}`
            );
            element.dataset.akariItemKind = 'cut';
            element.dataset.akariItemId = String(segment.index);
            element.dataset.akariLane = 'clips';
            element.style.opacity = this.clipsVisible ? '' : '.28';
            const widthPercent = Math.max(this.percent(segment.tlEnd) - this.percent(segment.tlStart), 0.3);
            const clipWidth = this.strip.clientWidth * widthPercent / 100;
            if (clipWidth < MICRO_CLIP_WIDTH_PX) {
                element.classList.add('akari-annotations-strip-clip-micro');
            }
            this.renderClipMedia(element, cut, clipWidth);
            element.appendChild(this.clipHeader(`C${segment.index + 1}`, segment.tlEnd - segment.tlStart));
            this.installDragListeners(element, (event, rect) => {
                const localX = event.clientX - rect.left;
                const rightDistance = rect.right - event.clientX;
                if (localX <= EDGE_ZONE_PX && localX <= rightDistance) {
                    return { kind: 'cut-trim', index: segment.index, edge: 'left', originalIn: cut.in, originalOut: cut.out };
                }
                if (rightDistance <= EDGE_ZONE_PX) {
                    return { kind: 'cut-trim', index: segment.index, edge: 'right', originalIn: cut.in, originalOut: cut.out };
                }
                return { kind: 'cut-reorder', index: segment.index, originalTlStart: segment.tlStart, duration: segment.tlEnd - segment.tlStart };
            }, event => void this.performRazorSplitAt(segment, event.clientX));
            if (this.toolMode === 'razor') {
                element.style.cursor = 'crosshair';
            }
            this.strip.appendChild(element);
        });
        this.playhead.style.left = `${this.percent(this.playheadT)}%`;
        const scrollbarWidth = Math.max(0, this.stripScroll.offsetWidth - this.stripScroll.clientWidth);
        this.rulerBar.style.marginRight = `${scrollbarWidth}px`;
        this.timelineOverlay.style.right = `${scrollbarWidth}px`;
        this.applySelectionClass();
        this.updateZoomHud();
        this.updateScrollbar();
    }

    protected laneBand(lane: string, top: number, height: number): HTMLDivElement {
        const band = document.createElement('div');
        band.className = 'akari-track-band';
        band.dataset.akariLane = lane;
        band.style.top = `${top}px`;
        band.style.height = `${height}px`;
        return band;
    }

    protected renderBeatMarkers(top: number, height: number): void {
        for (const beat of this.beats) {
            const outputRanges = this.sourceRangeToOutputRanges(
                beat.t, beat.t + BEAT_PROJECTION_EPSILON, beat.src
            );
            for (let occurrence = 0; occurrence < outputRanges.length; occurrence++) {
                const marker = document.createElement('div');
                marker.className = 'akari-beat-marker';
                marker.dataset.akariBeatId = beat.id;
                marker.dataset.akariBeatKind = beat.kind;
                marker.dataset.akariBeatStrength = String(beat.strength);
                marker.dataset.akariBeatOccurrence = String(occurrence);
                marker.title = [
                    `kind: ${beat.kind}`,
                    `strength: ${beat.strength}`,
                    ...(beat.basis !== undefined ? [`basis: ${beat.basis}`] : [])
                ].join('\n');
                const size = 7 + beat.strength * 6;
                marker.style.left = `${this.percent(outputRanges[occurrence][0])}%`;
                marker.style.top = `${top + (height - size) / 2}px`;
                marker.style.width = `${size}px`;
                marker.style.height = `${size}px`;
                marker.style.opacity = this.beatsVisible ? String(0.35 + beat.strength * 0.65) : '.28';
                marker.style.background = BEAT_KIND_COLORS[beat.kind] ?? DEFAULT_BEAT_COLOR;
                this.strip.appendChild(marker);
            }
        }
    }

    protected renderTrackHeaders(
        beatsTop: number,
        beatsHeight: number,
        captionTop: number,
        captionHeight: number,
        layerTop: number,
        layerHeight: number,
        audioTop: number,
        audioHeight: number,
        clipTop: number
    ): void {
        this.trackHeaders.replaceChildren();
        if (beatsHeight > 0) {
            this.trackHeaders.appendChild(this.trackHeaderRow(
                '見せ場', 'beat', 'beats', beatsTop, beatsHeight,
                this.beatsVisible, () => {
                    this.beatsVisible = !this.beatsVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_BEATS_VISIBILITY_EVENT, { visible: this.beatsVisible });
                    this.renderStrip();
                }, !this.beatsMuted, () => {
                    this.beatsMuted = !this.beatsMuted;
                    this.dispatchPreviewEvent(TIMELINE_SET_BEATS_MUTED_EVENT, { muted: this.beatsMuted });
                    this.renderStrip();
                }
            ));
        }
        if (captionHeight > 0) {
            this.trackHeaders.appendChild(this.trackHeaderRow(
                '字幕', 'caption', 'captions', captionTop, captionHeight,
                this.captionsVisible, () => {
                    this.captionsVisible = !this.captionsVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT, { visible: this.captionsVisible });
                    this.renderStrip();
                }, !this.captionsMuted, () => {
                    this.captionsMuted = !this.captionsMuted;
                    this.dispatchPreviewEvent(TIMELINE_SET_CAPTIONS_MUTED_EVENT, { muted: this.captionsMuted });
                    this.renderStrip();
                }
            ));
        }
        for (const layout of this.overlayTrackLayouts) {
            const visible = !this.hiddenTracks.has(layout.track);
            const audible = !this.mutedOverlayTracks.has(layout.track);
            this.trackHeaders.appendChild(this.trackHeaderRow(
                `トラック ${layout.track}`, 'overlay', `track-${layout.track}`, layout.top, layout.height,
                visible, () => {
                    if (this.hiddenTracks.has(layout.track)) {
                        this.hiddenTracks.delete(layout.track);
                    } else {
                        this.hiddenTracks.add(layout.track);
                    }
                    this.dispatchPreviewEvent(TIMELINE_SET_TRACK_VISIBILITY_EVENT, {
                        track: layout.track, visible: !this.hiddenTracks.has(layout.track)
                    });
                    this.renderStrip();
                }, audible, () => {
                    if (this.mutedOverlayTracks.has(layout.track)) {
                        this.mutedOverlayTracks.delete(layout.track);
                    } else {
                        this.mutedOverlayTracks.add(layout.track);
                    }
                    this.dispatchPreviewEvent(TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT, {
                        track: layout.track, muted: this.mutedOverlayTracks.has(layout.track)
                    });
                    this.renderStrip();
                }, layout.track
            ));
        }
        if (layerHeight > 0) {
            this.trackHeaders.appendChild(this.trackHeaderRow(
                'レイヤー', 'layer', 'layers', layerTop, layerHeight,
                this.layersVisible, () => {
                    this.layersVisible = !this.layersVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_LAYERS_VISIBILITY_EVENT, { visible: this.layersVisible });
                    this.renderStrip();
                }, !this.layersMuted, () => {
                    this.layersMuted = !this.layersMuted;
                    this.dispatchPreviewEvent(TIMELINE_SET_LAYERS_MUTED_EVENT, { muted: this.layersMuted });
                    this.renderStrip();
                }
            ));
        }
        if (audioHeight > 0) {
            this.trackHeaders.appendChild(this.trackHeaderRow(
                'オーディオ', 'audio', 'audio', audioTop, audioHeight,
                this.audioVisible, () => {
                    this.audioVisible = !this.audioVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_AUDIO_VISIBILITY_EVENT, { visible: this.audioVisible });
                    this.renderStrip();
                }, !this.audioMuted, () => {
                    this.audioMuted = !this.audioMuted;
                    this.dispatchPreviewEvent(TIMELINE_SET_AUDIO_MUTED_EVENT, { muted: this.audioMuted });
                    this.renderStrip();
                }
            ));
        }
        this.trackHeaders.appendChild(this.trackHeaderRow(
            'クリップ', 'video', 'clips', clipTop, CLIP_HEIGHT,
            this.clipsVisible, () => {
                this.clipsVisible = !this.clipsVisible;
                this.dispatchPreviewEvent(TIMELINE_SET_CLIPS_VISIBILITY_EVENT, { visible: this.clipsVisible });
                this.renderStrip();
            }, !this.clipMuted, () => {
                this.clipMuted = !this.clipMuted;
                this.dispatchPreviewEvent(TIMELINE_SET_MUTED_EVENT, { muted: this.clipMuted });
                this.renderStrip();
            }
        ));
    }

    protected trackHeaderRow(
        name: string,
        kind: 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat',
        lane: string,
        top: number,
        height: number,
        visible: boolean,
        toggleVisibility: () => void,
        audible: boolean,
        toggleMute: () => void,
        track?: number
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-track-header-row';
        row.dataset.akariLane = lane;
        row.style.top = `${top}px`;
        row.style.height = `${height}px`;
        if (track !== undefined) {
            row.dataset.akariTrack = String(track);
        }
        const icon = document.createElement('span');
        icon.className = 'akari-track-header-icon';
        icon.dataset.akariKind = kind;
        icon.innerHTML = this.trackKindSvg(kind);
        const nameElement = document.createElement('span');
        nameElement.className = 'akari-track-header-name';
        nameElement.textContent = name;
        row.append(
            icon,
            nameElement,
            this.trackHeaderButton(`${name}を表示`, 'visibility', visible, this.eyeSvg(), toggleVisibility),
            this.trackHeaderButton(`${name}の音声`, 'mute', audible, this.speakerSvg(), toggleMute)
        );
        return row;
    }

    protected trackHeaderButton(
        label: string,
        toggle: 'visibility' | 'mute',
        enabled: boolean,
        svg: string,
        action: () => void
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'akari-track-header-button';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(enabled));
        button.dataset.akariToggle = toggle;
        button.innerHTML = svg;
        button.addEventListener('click', event => {
            event.stopPropagation();
            action();
        });
        return button;
    }

    protected eyeSvg(): string {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    }

    protected speakerSvg(): string {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
    }

    protected trackKindSvg(kind: 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat'): string {
        switch (kind) {
            case 'video':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>';
            case 'overlay':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h7"/></svg>';
            case 'layer':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>';
            case 'audio':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';
            case 'caption':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h3M13 10h4M12 14h5"/></svg>';
            case 'beat':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>';
        }
    }

    protected dispatchPreviewEvent(type: string, detail: Record<string, unknown>): void {
        window.dispatchEvent(new CustomEvent(type, {
            detail: { editUri: this.location?.editUri?.toString() ?? '', ...detail }
        }));
    }

    protected renderRuler(): void {
        const ticks = this.computeRulerTicks(this.viewStart, this.visibleDuration(), this.fps);
        for (const tick of ticks) {
            const percent = this.percent(tick.time);
            const tickLine = document.createElement('div');
            Object.assign(tickLine.style, {
                position: 'absolute', top: '0', height: `${RULER_BAND_HEIGHT_PX}px`, width: '1px',
                left: `${percent}%`, background: RULER_TICK_COLOR, pointerEvents: 'none', zIndex: '1'
            });
            this.rulerBar.appendChild(tickLine);
            const label = document.createElement('div');
            label.textContent = tick.label;
            Object.assign(label.style, {
                position: 'absolute', top: '0', height: `${RULER_BAND_HEIGHT_PX}px`, left: `${percent}%`,
                color: 'var(--theia-descriptionForeground)', fontSize: '9px', lineHeight: `${RULER_BAND_HEIGHT_PX - 1}px`,
                fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '2',
                paddingLeft: '2px',
                transform: percent <= 2 ? 'none' : percent >= 98 ? 'translateX(-100%)' : 'translateX(-50%)'
            });
            this.rulerBar.appendChild(label);
        }
        this.renderAnnotationPins();
    }

    /**
     * 秒モード刻み候補（[0.5,1,2,5,10,15,30,60,120,300,600]）から「刻み×px/秒 >= 80px」を満たす
     * 最小の刻みを採用する。1 フレームが 4px 以上に見える高ズームではフレームモード（MM:SS:FF）に切り替える。
     */
    protected computeRulerTicks(viewStart: number, duration: number, fps: number): Array<{ time: number; label: string }> {
        const rect = this.strip.getBoundingClientRect();
        const pxPerSecond = duration > 0 && rect.width > 0 ? rect.width / duration : 0;
        if (duration <= 0 || pxPerSecond <= 0) {
            return [{ time: viewStart, label: this.formatRulerTimestamp(Math.max(0, viewStart)) }];
        }
        const frameDuration = 1 / fps;
        const frameMode = pxPerSecond * frameDuration >= 4;
        const step = frameMode
            ? this.niceStepFromCandidates(RULER_STEP_MULTIPLIERS_FRAMES.map(frames => frames * frameDuration), pxPerSecond)
            : this.niceStepFromCandidates(RULER_STEP_SECONDS, pxPerSecond);
        const viewEnd = viewStart + duration;
        const startIndex = Math.ceil((viewStart - step * 1e-6) / step);
        const endIndex = Math.floor((viewEnd + step * 1e-6) / step);
        const ticks: Array<{ time: number; label: string }> = [];
        for (let index = startIndex; index <= endIndex; index++) {
            const time = index * step;
            ticks.push({ time, label: this.formatTickLabel(time, fps, frameMode) });
        }
        if (ticks.length === 0) {
            ticks.push({ time: viewStart, label: this.formatTickLabel(viewStart, fps, frameMode) });
        }
        return ticks;
    }

    protected niceStepFromCandidates(candidates: readonly number[], pxPerSecond: number): number {
        const sorted = [...candidates].filter(candidate => candidate > 0).sort((a, b) => a - b);
        for (const step of sorted) {
            if (step * pxPerSecond >= RULER_MIN_TICK_SPACING_PX) {
                return step;
            }
        }
        return sorted[sorted.length - 1];
    }

    protected formatTickLabel(time: number, fps: number, frameMode: boolean): string {
        const clamped = Math.max(0, time);
        return frameMode ? this.formatFrameTimestamp(clamped, fps) : this.formatRulerTimestamp(clamped);
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
            pin.style.left = `${this.percent(this.sourceToOutput(annotation.sourceT))}%`;
            pin.style.background = STATUS_COLORS[annotation.status];
            pin.addEventListener('click', event => {
                event.stopPropagation();
                this.selectedSourceT = annotation.sourceT;
                this.renderStrip();
                void this.requestSeek(annotation.sourceT);
                this.review.reveal(annotation.id);
                void this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID);
            });
            this.rulerBar.appendChild(pin);
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

    /** クリップ上端のヘッダー帯（レガシー準拠）。ラベルと尺（MM:SS:FF）を表示する。 */
    protected clipHeader(label: string, durationSeconds: number): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'akari-annotations-strip-clip-header';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'akari-annotations-strip-clip-header-label';
        labelSpan.textContent = label;
        const durationSpan = document.createElement('span');
        durationSpan.className = 'akari-annotations-strip-clip-header-duration';
        durationSpan.textContent = this.formatFrameTimestamp(durationSeconds, this.fps);
        header.append(labelSpan, durationSpan);
        return header;
    }

    protected installDragListeners(
        element: HTMLDivElement,
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail,
        onRazorClick?: (event: MouseEvent) => void
    ): void {
        element.style.pointerEvents = 'auto';
        element.style.touchAction = 'none';
        element.style.cursor = 'default';
        element.addEventListener('click', event => {
            event.stopPropagation();
            if (this.toolMode === 'razor') {
                onRazorClick?.(event);
            }
        });
        element.addEventListener('pointermove', event => {
            if (this.toolMode !== 'select' || this.dragState) {
                return;
            }
            const rect = element.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const rightDistance = rect.right - event.clientX;
            element.style.cursor = localX <= EDGE_ZONE_PX || rightDistance <= EDGE_ZONE_PX ? 'ew-resize' : 'default';
        });
        element.addEventListener('pointerdown', event => {
            if (event.button !== 0) {
                return;
            }
            if (this.toolMode === 'razor') {
                // レザー中はドラッグを開始しない。クリックは上の 'click' リスナーが処理する。
                return;
            }
            if (this.dragState) {
                // 前回の pointerup を取りこぼした残留状態を破棄して自己回復する。
                this.cancelDrag(this.dragState);
            }
            event.preventDefault();
            event.stopPropagation();
            const ghost = element.cloneNode(true) as HTMLDivElement;
            ghost.removeAttribute('title');
            Object.assign(ghost.style, {
                pointerEvents: 'none', opacity: '.5', borderStyle: 'dashed', zIndex: '8', cursor: 'grabbing'
            });
            this.strip.appendChild(ghost);
            const state = {
                ...detail(event, element.getBoundingClientRect()),
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                element,
                ghost,
                dragged: false
            } as DragState;
            this.dragState = state;
            element.style.cursor = 'grabbing';
            element.style.opacity = '.5';
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
            const verticalMove = state.kind === 'overlay' && state.mode === 'move'
                && Math.abs(event.clientY - state.startClientY) > DRAG_THRESHOLD_PX;
            if (Math.abs(event.clientX - state.startClientX) > DRAG_THRESHOLD_PX || verticalMove) {
                state.dragged = true;
            }
            this.updateDragPreview(state, event.clientX, event.clientY, state.dragged);
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
                this.applySelection(this.selectionFromDragState(state));
                this.selectTimeAtClientX(event.clientX);
                return;
            }
            const preview = this.updateDragPreview(state, event.clientX, event.clientY, true);
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

    protected updateDragPreview(state: DragState, clientX: number, clientY: number, allowGuide: boolean): DragPreview {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.visibleDuration();
        // strip 全体で秒/px の縮尺は一定なので、この delta は source 秒・出力秒のどちらにもそのまま使える。
        const delta = rect.width > 0 ? (clientX - state.startClientX) / rect.width * duration : 0;
        const showGuide = allowGuide && this.snapEnabled;
        if (state.kind === 'cut-trim') {
            const proposed = state.edge === 'left' ? state.originalIn + delta : state.originalOut + delta;
            const edge = this.snapTimeInSourceSpace(Math.max(0, proposed), showGuide);
            const input = state.edge === 'left' ? edge : state.originalIn;
            const output = state.edge === 'right' ? edge : state.originalOut;
            const segment = this.segments[state.index];
            const newDuration = Math.max(0, output - input);
            if (segment) {
                if (state.edge === 'left') {
                    this.setGhostRange(state.ghost, segment.tlEnd - newDuration / segment.speed, segment.tlEnd);
                } else {
                    this.setGhostRange(state.ghost, segment.tlStart, segment.tlStart + newDuration / segment.speed);
                }
            } else {
                this.setGhostRange(state.ghost, input, output);
            }
            this.updateDragFeedback(state, `${state.edge === 'left' ? 'In' : 'Out'} ${this.formatTimestamp(edge)} / 尺 ${newDuration.toFixed(2)} 秒`);
            this.updateGhostHeaderDuration(state.ghost, newDuration);
            return { kind: 'cut-trim', index: state.index, input, output };
        }
        if (state.kind === 'cut-reorder') {
            const proposedTlStart = Math.max(0, state.originalTlStart + delta);
            const pointerTime = this.timeAtClientX(clientX);
            const dropTime = this.snapTimeInOutputSpace(pointerTime, showGuide);
            this.setGhostRange(state.ghost, proposedTlStart, proposedTlStart + state.duration);
            const boundaries = this.segments.flatMap(segment => [
                { time: segment.tlStart, index: segment.index },
                { time: segment.tlEnd, index: segment.index }
            ]);
            const target = boundaries.reduce((nearest, candidate) =>
                Math.abs(dropTime - candidate.time) < Math.abs(dropTime - nearest.time) ? candidate : nearest,
            boundaries.find(candidate => candidate.index === state.index) ?? { time: state.originalTlStart, index: state.index });
            const toIndex = target.index;
            this.updateDragFeedback(state, `並べ替え先: ${this.formatTimestamp(dropTime)}`);
            return { kind: 'cut-reorder', fromIndex: state.index, toIndex };
        }
        if (state.kind === 'caption') {
            let start = state.originalStart;
            let end = state.originalEnd;
            if (state.mode === 'move') {
                start = this.snapTimeInSourceSpace(state.originalStart + delta, showGuide);
                end = state.originalEnd + (start - state.originalStart);
            } else if (state.mode === 'start') {
                start = this.snapTimeInSourceSpace(state.originalStart + delta, showGuide);
            } else {
                end = this.snapTimeInSourceSpace(state.originalEnd + delta, showGuide);
            }
            const ranges = this.sourceRangeToOutputRanges(start, end);
            if (ranges.length > 0) {
                this.setGhostRange(state.ghost, ranges[0][0], ranges[ranges.length - 1][1]);
            }
            this.updateDragFeedback(state, `${this.formatTimestamp(start)} – ${this.formatTimestamp(end)}`);
            return {
                kind: 'caption', id: state.id,
                deltaStart: start - state.originalStart,
                deltaEnd: end - state.originalEnd,
                start, end
            };
        }
        if (state.mode === 'move') {
            const start = this.snapTimeInOutputSpace(Math.max(0, state.originalStart + delta), showGuide);
            this.setGhostRange(state.ghost, start, start + state.originalDuration);
            const track = this.overlayTrackAtClientY(clientY);
            const layout = this.overlayTrackLayouts.find(candidate => candidate.track === track);
            if (layout) {
                state.ghost.style.top = `${layout.top}px`;
            } else if (this.overlayTrackLayouts.length > 0) {
                state.ghost.style.top = `${Math.max(0, this.overlayTrackLayouts[0].top - SUBROW_STRIDE)}px`;
            }
            state.ghost.dataset.akariTrack = String(track);
            this.updateDragFeedback(state, `${this.formatTimestamp(start)} / 尺 ${state.originalDuration.toFixed(2)} 秒`);
            return { kind: 'overlay-move', id: state.id, start, track };
        }
        const end = this.snapTimeInOutputSpace(state.originalStart + state.originalDuration + delta, showGuide);
        this.setGhostRange(state.ghost, state.originalStart, end);
        this.updateDragFeedback(state, `尺 ${(end - state.originalStart).toFixed(2)} 秒`);
        return { kind: 'overlay-resize', id: state.id, duration: end - state.originalStart };
    }

    protected updateDragFeedback(state: DragState, text: string): void {
        if (!state.dragged) {
            this.dragFeedback.style.display = 'none';
            return;
        }
        this.dragFeedback.textContent = text;
        this.dragFeedback.style.left = state.ghost.style.left;
        const ghostTop = parseFloat(state.ghost.style.top || '0');
        const viewportTop = RULER_BAND_HEIGHT_PX + ghostTop - this.stripScroll.scrollTop;
        this.dragFeedback.style.top = `${Math.max(0, viewportTop - 18)}px`;
        this.dragFeedback.style.display = 'block';
    }

    /** トリム中、ゴースト（クリップの複製）のヘッダー尺表示をリアルタイム更新する（レガシー準拠の数値フィードバック）。 */
    protected updateGhostHeaderDuration(ghost: HTMLDivElement, durationSeconds: number): void {
        const durationSpan = ghost.querySelector<HTMLElement>('.akari-annotations-strip-clip-header-duration');
        if (durationSpan) {
            durationSpan.textContent = this.formatFrameTimestamp(Math.max(0, durationSeconds), this.fps);
        }
    }

    protected overlayTrackAtClientY(clientY: number): number {
        if (this.overlayTrackLayouts.length === 0) {
            return 0;
        }
        const stripTop = this.strip.getBoundingClientRect().top;
        const localY = clientY - stripTop;
        const highest = this.overlayTrackLayouts[0];
        if (localY < highest.top) {
            return highest.track + 1;
        }
        for (const layout of this.overlayTrackLayouts) {
            if (localY >= layout.top && localY < layout.top + layout.height + LANE_GAP) {
                return layout.track;
            }
        }
        return 0;
    }

    protected setGhostRange(ghost: HTMLDivElement, start: number, end: number): void {
        ghost.style.left = `${this.percent(start)}%`;
        ghost.style.width = `${Math.max(this.percent(end) - this.percent(start), 0.3)}%`;
    }

    /**
     * トリム・字幕ドラッグ用。候補は source 空間（単語境界・他 cuts の in/out・現在の再生/選択位置）。
     * 候補が閾値内になければ 0.25 秒グリッドへフォールバックする（スナップ有効時は常に何かへ吸着する）。
     */
    protected snapTimeInSourceSpace(value: number, showGuide: boolean): number {
        if (!this.snapEnabled) {
            this.hideSnapGuide();
            return value;
        }
        const threshold = this.snapThresholdSeconds();
        if (threshold === undefined) {
            return value;
        }
        const candidates: SnapCandidate[] = [
            ...this.wordBoundaries.map(time => ({ time })),
            ...this.cuts.flatMap(cut => [{ time: cut.in }, { time: cut.out }]),
            { time: this.outputToSource(this.playheadT), isPlayhead: true },
            { time: this.selectedSourceT }
        ].filter(candidate => Number.isFinite(candidate.time));
        const nearest = this.nearestCandidate(candidates, value);
        if (nearest !== undefined && Math.abs(nearest.time - value) <= threshold) {
            if (showGuide) {
                this.showSnapGuideAt(this.sourceToOutput(nearest.time), nearest.isPlayhead === true);
            }
            return nearest.time;
        }
        const grid = this.snapToGrid(value);
        if (showGuide) {
            this.showSnapGuideAt(this.sourceToOutput(grid), false);
        }
        return grid;
    }

    /**
     * 並べ替え・オーバーレイドラッグ用。候補は出力空間（セグメント境界・再生位置・選択位置の射影）。
     * 候補が閾値内になければ 0.25 秒グリッドへフォールバックする。
     */
    protected snapTimeInOutputSpace(value: number, showGuide: boolean): number {
        if (!this.snapEnabled) {
            this.hideSnapGuide();
            return value;
        }
        const threshold = this.snapThresholdSeconds();
        if (threshold === undefined) {
            return value;
        }
        const candidates: SnapCandidate[] = [
            ...this.segments.flatMap(segment => [{ time: segment.tlStart }, { time: segment.tlEnd }]),
            { time: this.playheadT, isPlayhead: true },
            { time: this.sourceToOutput(this.selectedSourceT) }
        ].filter(candidate => Number.isFinite(candidate.time));
        const nearest = this.nearestCandidate(candidates, value);
        if (nearest !== undefined && Math.abs(nearest.time - value) <= threshold) {
            if (showGuide) {
                this.showSnapGuideAt(nearest.time, nearest.isPlayhead === true);
            }
            return nearest.time;
        }
        const grid = this.snapToGrid(value);
        if (showGuide) {
            this.showSnapGuideAt(grid, false);
        }
        return grid;
    }

    protected snapToGrid(value: number): number {
        return Math.max(0, Math.round(value / SNAP_GRID_SECONDS) * SNAP_GRID_SECONDS);
    }

    protected snapThresholdSeconds(): number | undefined {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.visibleDuration();
        if (rect.width <= 0 || duration <= 0) {
            this.hideSnapGuide();
            return undefined;
        }
        return SNAP_THRESHOLD_PX / (rect.width / duration);
    }

    protected nearestCandidate(candidates: readonly SnapCandidate[], value: number): SnapCandidate | undefined {
        let nearest: SnapCandidate | undefined;
        for (const candidate of candidates) {
            if (nearest === undefined || Math.abs(candidate.time - value) < Math.abs(nearest.time - value)) {
                nearest = candidate;
            }
        }
        return nearest;
    }

    /** ガイド線は常に出力軸座標へ射影して表示する。playhead へ吸着したときだけアンバーにする。 */
    protected showSnapGuideAt(outputTime: number, isPlayhead: boolean): void {
        this.snapGuide.style.left = `${this.percent(outputTime)}%`;
        this.snapGuide.style.background = isPlayhead ? SNAP_GUIDE_COLOR_PLAYHEAD : SNAP_GUIDE_COLOR_DEFAULT;
        this.snapGuide.style.display = 'block';
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
        state.element.style.cursor = 'default';
        state.element.style.opacity = '';
        state.ghost.remove();
        this.hideSnapGuide();
        this.dragFeedback.style.display = 'none';
        this.dragState = undefined;
        if (this.renderStripPending) {
            this.renderStripPending = false;
            this.renderStrip();
        }
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
                this.pushHistory({
                    label: 'クリップのトリム',
                    undo: async () => {
                        await this.annotationsService.trimCut({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            cutIndex: preview.index, in: original.in, out: original.out
                        });
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.annotationsService.trimCut({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            cutIndex: preview.index, in: preview.input, out: preview.output
                        });
                        await this.reloadEdit();
                    }
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
                this.pushHistory({
                    label: 'クリップの並べ替え',
                    undo: async () => {
                        await this.annotationsService.reorderCuts({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            fromIndex: preview.toIndex, toIndex: preview.fromIndex
                        });
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.annotationsService.reorderCuts({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            fromIndex: preview.fromIndex, toIndex: preview.toIndex
                        });
                        await this.reloadEdit();
                    }
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
                this.pushHistory({
                    label: '字幕タイミングの調整',
                    undo: async () => {
                        await this.annotationsService.shiftCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                            captionId: preview.id, deltaStart: -preview.deltaStart, deltaEnd: -preview.deltaEnd
                        });
                        await this.reloadCaptions();
                    },
                    redo: async () => {
                        await this.annotationsService.shiftCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                            captionId: preview.id, deltaStart: preview.deltaStart, deltaEnd: preview.deltaEnd
                        });
                        await this.reloadCaptions();
                    }
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
                const originalTrackState = this.overlayTrackState();
                result = await this.annotationsService.moveOverlay({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(),
                    overlayId: preview.id, start: preview.start,
                    track: preview.track === original.track ? undefined : preview.track
                });
                await this.reloadEdit();
                const movedTrackState = this.overlayTrackState();
                this.pushHistory({
                    label: 'オーバーレイの移動',
                    undo: async () => {
                        await this.annotationsService.moveOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            overlayId: preview.id, start: original.start,
                            trackState: originalTrackState
                        });
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.annotationsService.moveOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            overlayId: preview.id, start: preview.start,
                            trackState: movedTrackState
                        });
                        await this.reloadEdit();
                    }
                });
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
                this.pushHistory({
                    label: 'オーバーレイの尺変更',
                    undo: async () => {
                        await this.annotationsService.resizeOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            overlayId: preview.id, duration: original.duration
                        });
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.annotationsService.resizeOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            overlayId: preview.id, duration: preview.duration
                        });
                        await this.reloadEdit();
                    }
                });
                await this.reloadEdit();
                this.footer.textContent = this.writeResultMessage('オーバーレイの尺を変更しました。', result);
            }
            this.hideNotice();
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`タイムラインを更新できません: ${detail}`);
            this.messages.error(`タイムラインを更新できません: ${detail}`);
        }
    }

    protected pushHistory(entry: HistoryEntry): void {
        this.past = [...this.past, entry].slice(-HISTORY_LIMIT);
        this.future = [];
        this.updateHistoryButtons();
    }

    protected overlayTrackState(): Record<string, number | null> {
        const state: Record<string, number | null> = {};
        for (const overlay of this.overlays) {
            state[overlay.id] = Object.prototype.hasOwnProperty.call(overlay.payload, 'track') ? overlay.track : null;
        }
        return state;
    }

    protected updateHistoryButtons(): void {
        this.undoButton.disabled = this.past.length === 0;
        this.redoButton.disabled = this.future.length === 0;
    }

    protected async performUndo(): Promise<void> {
        const entry = this.past.pop();
        if (!entry) {
            return;
        }
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        try {
            await entry.undo();
            this.future = [...this.future, entry].slice(-HISTORY_LIMIT);
            this.hideNotice();
            this.revealOutputPreview();
            this.footer.textContent = `${entry.label}を元に戻しました。`;
        } catch (error) {
            console.warn('[akari-annotations] undo entry is no longer applicable', error);
            this.footer.textContent = '元に戻せませんでした（対象が変更されています）';
        } finally {
            this.updateHistoryButtons();
        }
    }

    protected async performRedo(): Promise<void> {
        const entry = this.future.pop();
        if (!entry) {
            return;
        }
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        try {
            await entry.redo();
            this.past = [...this.past, entry].slice(-HISTORY_LIMIT);
            this.hideNotice();
            this.revealOutputPreview();
            this.footer.textContent = `${entry.label}をやり直しました。`;
        } catch (error) {
            console.warn('[akari-annotations] redo entry is no longer applicable', error);
            this.footer.textContent = 'やり直せませんでした（対象が変更されています）';
        } finally {
            this.updateHistoryButtons();
        }
    }

    protected copySelectedItem(): boolean {
        const selection = this.selection;
        if (!selection || selection.kind === 'cut' || selection.kind === 'layer' || selection.kind === 'audio') {
            this.footer.textContent = 'コピーする字幕またはオーバーレイが選択されていません。';
            return false;
        }
        if (selection.kind === 'caption') {
            const caption = this.captions.find(candidate => candidate.id === selection.id);
            if (!caption) {
                this.applySelection(undefined);
                this.footer.textContent = 'コピー対象の字幕が見つかりません。';
                return false;
            }
            this.clipboard = {
                kind: 'caption',
                payload: { text: caption.text, start: caption.start, end: caption.end }
            };
            this.footer.textContent = '字幕をコピーしました。';
            return true;
        }
        const overlay = this.overlays.find(candidate => candidate.id === selection.id);
        if (!overlay) {
            this.applySelection(undefined);
            this.footer.textContent = 'コピー対象のオーバーレイが見つかりません。';
            return false;
        }
        this.clipboard = {
            kind: 'overlay',
            payload: this.deepCopy(overlay.payload) as OverlayWritePayload
        };
        this.footer.textContent = 'オーバーレイをコピーしました。';
        return true;
    }

    protected async pasteClipboard(): Promise<void> {
        const clipboard = this.clipboard;
        const location = this.location;
        if (!clipboard || !location) {
            this.footer.textContent = 'ペーストする字幕またはオーバーレイがありません。';
            return;
        }
        const start = Number.isFinite(this.playheadT) ? this.playheadT : this.selectedSourceT;
        const duration = clipboard.kind === 'caption'
            ? clipboard.payload.end - clipboard.payload.start
            : clipboard.payload.duration;
        const contentDuration = this.totalDuration() / 1.02;
        if (!Number.isFinite(start) || start < 0 || start + duration > contentDuration + Number.EPSILON) {
            this.footer.textContent = '総尺を超える位置にはペーストできません。';
            return;
        }
        try {
            if (clipboard.kind === 'caption') {
                const caption: CaptionWritePayload = {
                    id: this.nextCopyId('caption-copy', this.captions.map(candidate => candidate.id)),
                    start,
                    end: start + duration,
                    text: clipboard.payload.text,
                    speaker: null,
                    sourceRef: null,
                    edited: true
                };
                const result = await this.annotationsService.insertCaption({
                    captionsUri: location.captionsUri.toString(),
                    projectRootUri: location.root.toString(),
                    caption
                });
                this.pushHistory({
                    label: '字幕のペースト',
                    undo: async () => {
                        await this.annotationsService.removeCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                            captionId: caption.id
                        });
                        await this.reloadCaptions();
                    },
                    redo: async () => {
                        await this.annotationsService.insertCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(), caption
                        });
                        await this.reloadCaptions();
                        this.applySelection({ kind: 'caption', id: caption.id });
                    }
                });
                await this.reloadCaptions();
                this.applySelection({ kind: 'caption', id: caption.id });
                this.footer.textContent = this.writeResultMessage('字幕をペーストしました。', result);
            } else {
                if (!location.editUri) {
                    this.footer.textContent = 'edit.json がないためオーバーレイをペーストできません。';
                    return;
                }
                const originalId = String(clipboard.payload.id);
                const overlay = this.deepCopy(clipboard.payload) as OverlayWritePayload;
                overlay.id = this.nextCopyId(`${originalId}-copy`, this.overlays.map(candidate => candidate.id));
                overlay.start = start;
                const result = await this.annotationsService.insertOverlay({
                    editUri: location.editUri.toString(), projectRootUri: location.root.toString(), overlay
                });
                this.pushHistory({
                    label: 'オーバーレイのペースト',
                    undo: async () => {
                        await this.annotationsService.removeOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(),
                            overlayId: overlay.id
                        });
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.annotationsService.insertOverlay({
                            editUri: location.editUri!.toString(), projectRootUri: location.root.toString(), overlay
                        });
                        await this.reloadEdit();
                        this.applySelection({ kind: 'overlay', id: overlay.id });
                    }
                });
                await this.reloadEdit();
                this.applySelection({ kind: 'overlay', id: overlay.id });
                this.footer.textContent = this.writeResultMessage('オーバーレイをペーストしました。', result);
            }
            this.hideNotice();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`ペーストできません: ${detail}`);
            this.messages.error(`ペーストできません: ${detail}`);
        }
    }

    protected nextCopyId(base: string, ids: string[]): string {
        const used = new Set(ids);
        if (!used.has(base)) {
            return base;
        }
        let sequence = 2;
        while (used.has(`${base}-${sequence}`)) {
            sequence++;
        }
        return `${base}-${sequence}`;
    }

    protected deepCopy<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
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

    protected setViewStart(candidate: number): void {
        const maxStart = Math.max(0, this.totalDuration() - this.visibleDuration());
        this.viewStart = Math.min(Math.max(0, candidate), maxStart);
        this.renderStrip();
    }

    protected updateScrollbar(): void {
        const zoomed = this.viewDuration !== undefined;
        this.hScrollbarTrack.style.display = zoomed ? 'block' : 'none';
        if (!zoomed) {
            return;
        }
        const total = this.totalDuration();
        const visible = this.visibleDuration();
        const widthPercent = total > 0 ? Math.min(100, Math.max(2, visible / total * 100)) : 100;
        const leftPercent = total > 0 ? Math.min(100 - widthPercent, Math.max(0, this.viewStart / total * 100)) : 0;
        this.hScrollbarThumb.style.width = `${widthPercent}%`;
        this.hScrollbarThumb.style.left = `${leftPercent}%`;
    }

    protected onScrollbarTrackClick(event: MouseEvent): void {
        if (event.target === this.hScrollbarThumb) {
            return;
        }
        const rect = this.hScrollbarTrack.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const total = this.totalDuration();
        this.setViewStart(ratio * total - this.visibleDuration() / 2);
    }

    protected onScrollbarThumbPointerDown(event: PointerEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.hScrollbarThumb.setPointerCapture(event.pointerId);
        const trackRect = this.hScrollbarTrack.getBoundingClientRect();
        const startClientX = event.clientX;
        const startViewStart = this.viewStart;
        const total = this.totalDuration();
        const onMove = (moveEvent: PointerEvent): void => {
            if (trackRect.width <= 0) {
                return;
            }
            const deltaRatio = (moveEvent.clientX - startClientX) / trackRect.width;
            this.setViewStart(startViewStart + deltaRatio * total);
        };
        const onUp = (upEvent: PointerEvent): void => {
            this.hScrollbarThumb.releasePointerCapture(upEvent.pointerId);
            this.hScrollbarThumb.removeEventListener('pointermove', onMove);
            this.hScrollbarThumb.removeEventListener('pointerup', onUp);
            this.hScrollbarThumb.removeEventListener('pointercancel', onUp);
        };
        this.hScrollbarThumb.addEventListener('pointermove', onMove);
        this.hScrollbarThumb.addEventListener('pointerup', onUp);
        this.hScrollbarThumb.addEventListener('pointercancel', onUp);
    }

    /** playhead 上端のピン型ハンドルをドラッグしている間、継続的にプレビューへシークする（スクラブ）。 */
    protected onPlayheadHandlePointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.playheadHandle.setPointerCapture(event.pointerId);
        const onMove = (moveEvent: PointerEvent): void => {
            const outputT = this.timeAtClientX(moveEvent.clientX);
            this.playheadT = outputT;
            this.playhead.style.left = `${this.percent(outputT)}%`;
            void this.requestSeek(this.outputToSource(outputT));
        };
        const onUp = (upEvent: PointerEvent): void => {
            this.playheadHandle.releasePointerCapture(upEvent.pointerId);
            this.playheadHandle.removeEventListener('pointermove', onMove);
            this.playheadHandle.removeEventListener('pointerup', onUp);
            this.playheadHandle.removeEventListener('pointercancel', onUp);
            this.selectedSourceT = this.outputToSource(this.playheadT);
        };
        this.playheadHandle.addEventListener('pointermove', onMove);
        this.playheadHandle.addEventListener('pointerup', onUp);
        this.playheadHandle.addEventListener('pointercancel', onUp);
    }

    protected panViewBy(deltaSeconds: number): void {
        this.setViewStart(this.viewStart + deltaSeconds);
    }

    protected timeAtClientX(clientX: number): number {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        return this.viewStart + ratio * this.visibleDuration();
    }

    protected selectTimeAtClientX(clientX: number): void {
        const outputT = this.timeAtClientX(clientX);
        const sourceT = this.outputToSource(outputT);
        this.selectedSourceT = sourceT;
        this.playheadT = outputT;
        this.playhead.style.left = `${this.percent(outputT)}%`;
        void this.requestSeek(sourceT);
    }

    protected onStripClick(event: MouseEvent): void {
        if (event.target instanceof Element && event.target.closest('.akari-beat-marker')) {
            return;
        }
        this.applySelection(undefined);
        this.selectTimeAtClientX(event.clientX);
    }

    protected onWheelZoom(event: WheelEvent): void {
        if (event.ctrlKey) {
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
            return;
        }
        const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX
            : (event.shiftKey ? event.deltaY : 0);
        if (horizontalDelta === 0) {
            return;
        }
        event.preventDefault();
        const rect = this.strip.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        this.panViewBy(horizontalDelta / rect.width * this.visibleDuration());
    }

    canHandlePlaybackTick(editUri: string | undefined): boolean {
        if (!this.isAttached || !this.location?.editUri || !editUri) {
            return false;
        }
        return this.normalizeUri(this.location.editUri.toString()) === this.normalizeUri(editUri);
    }

    handlePlaybackTick(request: PreviewPlaybackTick): void {
        if (!this.canHandlePlaybackTick(request.videoUri)
            || !Number.isFinite(request.time)
            || typeof request.playing !== 'boolean') {
            return;
        }
        this.playheadT = Math.max(0, request.time!);
        const visibleDuration = this.visibleDuration();
        const followEdge = this.viewStart + visibleDuration * PLAYHEAD_FOLLOW_THRESHOLD;
        if (request.playing && this.viewDuration !== undefined && this.playheadT > followEdge) {
            const nextViewStart = this.playheadT - visibleDuration * PLAYHEAD_FOLLOW_THRESHOLD;
            if (nextViewStart > this.viewStart + 1e-6) {
                this.setViewStart(nextViewStart);
            }
        }
        this.playhead.style.left = `${this.percent(this.playheadT)}%`;
    }

    protected normalizeUri(value: string): string {
        return new URI(value).normalizePath().toString();
    }

    /**
     * プレビューのタブをフォーカスを奪わずに前面へ出す。契約: akari.preview.ensureVisible。
     * 未登録（プレビュー未実装・別画面）でも壊れないよう黙って無視する。
     */
    protected revealOutputPreview(): void {
        if (!this.location?.editUri) {
            return;
        }
        void this.commands.executeCommand(ENSURE_PREVIEW_VISIBLE_COMMAND_ID, { editUri: this.location.editUri.toString() })
            .catch(() => undefined);
    }

    protected async requestSeek(time: number): Promise<void> {
        if (!this.location?.editUri) {
            this.footer.textContent = `${this.formatTimestamp(time)} を選択しました。edit.json が見つかりません。`;
            return;
        }
        const result = await this.commands.executeCommand<'seeked' | 'mismatched-asset'>(
            SEEK_OUTPUT_PREVIEW_COMMAND_ID,
            { editUri: this.location.editUri.toString(), time: this.sourceToOutput(time) }
        );
        const timestamp = this.formatTimestamp(time);
        this.footer.textContent = result === 'seeked'
            ? `${timestamp} にプレビューをシークしました。`
            : `${timestamp} を選択しました。出力プレビューを開けませんでした。`;
    }

    protected openAnnotationPopup(event: MouseEvent): void {
        event.preventDefault();
        this.closeAnnotationPopup();
        const sourceT = this.outputToSource(this.timeAtClientX(event.clientX));
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
