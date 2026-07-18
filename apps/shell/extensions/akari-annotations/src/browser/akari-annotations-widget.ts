import { CommandService, Disposable, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation, WriteBackResult } from '../common/akari-annotations-protocol';
import { parseReview } from '../common/annotation-store';
import { CaptionRecord, parseCaptions } from '../common/caption-store';
import { EditCut, EditOverlay, parseEdit } from '../common/edit-store';
import { ProjectLocation } from './project-location';

const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
const MINIMUM_ITEM_DURATION = 0.15;
const DRAG_THRESHOLD_PX = 3;
const EDGE_ZONE_PX = 6;
const SNAP_THRESHOLD_PX = 8;

const STATUS_LABELS: Record<Annotation['status'], string> = {
    open: '未対応',
    addressed: '対応済み',
    resolved: '確認済み'
};
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
    protected readonly filterSelect = document.createElement('select');
    protected readonly strip = document.createElement('div');
    protected readonly playhead = document.createElement('div');
    protected readonly snapGuide = document.createElement('div');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly textInput = document.createElement('input');
    protected readonly addButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly listContainer = document.createElement('div');
    protected readonly footer = document.createElement('div');

    protected location: ProjectLocation | undefined;
    protected annotations: Annotation[] = [];
    protected captions: CaptionRecord[] = [];
    protected cuts: EditCut[] = [];
    protected overlays: EditOverlay[] = [];
    protected wordBoundaries: number[] = [];
    protected selectedSourceT = 0;
    protected statusFilter: 'all' | Annotation['status'] = 'all';
    protected configured = false;
    protected dragState: DragState | undefined;
    protected lastUndo: (() => Promise<void>) | undefined;
    protected contextPopup: HTMLDivElement | undefined;

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
            gridTemplateRows: 'auto auto auto auto minmax(0, 1fr) auto',
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
        this.filterSelect.setAttribute('aria-label', '状態で絞り込み');
        const filterOptions: Array<[string, string]> = [
            ['all', 'すべて'], ['open', '未対応'], ['addressed', '対応済み'], ['resolved', '確認済み']
        ];
        for (const [value, label] of filterOptions) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.filterSelect.appendChild(option);
        }
        this.filterSelect.addEventListener('change', () => {
            this.statusFilter = this.filterSelect.value as typeof this.statusFilter;
            this.renderList();
        });
        this.toolbar.append(heading, this.undoButton, this.filterSelect);

        Object.assign(this.strip.style, {
            position: 'relative', margin: '8px 10px', height: '96px',
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
        this.strip.addEventListener('contextmenu', event => this.openAnnotationPopup(event));

        Object.assign(this.composerRow.style, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px 8px', boxSizing: 'border-box'
        });
        Object.assign(this.timeLabel.style, {
            fontVariantNumeric: 'tabular-nums', color: 'var(--theia-descriptionForeground)', minWidth: '96px'
        });
        this.textInput.type = 'text';
        this.textInput.placeholder = 'コメントを入力';
        this.textInput.setAttribute('aria-label', 'コメントを入力');
        Object.assign(this.textInput.style, { flex: '1', minWidth: '0' });
        this.textInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submitAnnotation();
            }
        });
        this.addButton.type = 'button';
        this.addButton.className = 'theia-button main';
        this.addButton.textContent = '追加';
        this.addButton.addEventListener('click', () => void this.submitAnnotation());
        this.composerRow.append(this.timeLabel, this.textInput, this.addButton);

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });
        Object.assign(this.listContainer.style, { minHeight: '0', overflow: 'auto', padding: '4px 10px' });
        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'タイムラインをクリックすると時刻を選べます。プレビューを開いていればその場でシークします。';

        this.node.append(this.toolbar, this.strip, this.composerRow, this.notice, this.listContainer, this.footer);
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
        top: 38px;
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
        window.addEventListener('keydown', keydown);
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('keydown', keydown);
            this.closeAnnotationPopup();
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
        }));
        this.updateTimeLabel();
    }

    async configure(location: ProjectLocation): Promise<void> {
        if (this.configured) {
            return;
        }
        this.configured = true;
        this.location = location;
        this.title.caption = `タイムライン — ${location.reviewUri.toString()}`;
        await this.reloadAll();
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
                this.annotations = [];
                this.hideNotice();
            } else {
                const source = (await this.fileService.readFile(this.location.reviewUri)).value.toString();
                const parsed = parseReview(source);
                this.annotations = parsed.annotations;
                this.showWarnings(parsed.warnings);
            }
        } catch (error) {
            this.annotations = [];
            this.showNotice(`レビューデータを読み取れません: ${this.errorMessage(error)}`);
        }
        this.renderStrip();
        this.renderList();
    }

    protected async reloadEdit(): Promise<void> {
        this.cuts = [];
        this.overlays = [];
        if (this.location?.editUri) {
            try {
                const source = (await this.fileService.readFile(this.location.editUri)).value.toString();
                const parsed = parseEdit(source);
                this.cuts = parsed.cuts;
                this.overlays = parsed.overlays;
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

    protected renderStrip(): void {
        for (const child of Array.from(this.strip.children)) {
            if (child !== this.playhead && child !== this.snapGuide) {
                child.remove();
            }
        }
        const duration = this.totalDuration();
        this.renderRuler(duration);
        this.cuts.forEach((cut, index) => {
            const element = this.stripSegment(cut.in, cut.out, 14, 22, 'akari-annotations-strip-clip', `C${index + 1}`);
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
        for (const caption of this.captions) {
            const captionEnd = Math.max(caption.end, caption.start + MINIMUM_ITEM_DURATION);
            const element = this.stripSegment(
                caption.start, captionEnd, 38, 16, 'akari-annotations-strip-caption', caption.text
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
            this.strip.appendChild(this.captionLabel(caption.start, caption.text));
        }
        for (const overlay of this.overlays) {
            const element = this.stripSegment(
                overlay.start, overlay.start + overlay.duration, 56, 16,
                'akari-annotations-strip-overlay', overlay.id
            );
            element.appendChild(this.segmentLabel(overlay.id));
            this.installDragListeners(element, (event, rect) => ({
                kind: 'overlay', id: overlay.id,
                mode: rect.right - event.clientX <= EDGE_ZONE_PX ? 'resize' : 'move',
                originalStart: overlay.start, originalDuration: overlay.duration
            }));
            this.strip.appendChild(element);
        }
        for (const annotation of this.annotations) {
            const marker = this.stripSegment(
                annotation.sourceT,
                annotation.sourceT + Math.max(duration * 0.006, 0.2),
                76,
                18,
                'akari-annotations-strip-pin',
                `${this.formatTimestamp(annotation.sourceT)} ${annotation.text}`
            );
            marker.style.background = STATUS_COLORS[annotation.status];
            marker.style.borderRadius = '50%';
            marker.setAttribute('data-annotation-id', annotation.id);
            marker.setAttribute('data-annotation-status', annotation.status);
            this.strip.appendChild(marker);
        }
        this.playhead.style.left = `${this.percent(this.selectedSourceT, duration)}%`;
        this.updateTimeLabel();
    }

    protected renderRuler(duration: number): void {
        const divisions = 5;
        for (let index = 0; index <= divisions; index++) {
            const label = document.createElement('div');
            const time = duration * index / divisions;
            label.textContent = this.formatRulerTimestamp(time);
            Object.assign(label.style, {
                position: 'absolute', top: '0', height: '14px', left: `${index * 100 / divisions}%`,
                color: 'var(--theia-descriptionForeground)', fontSize: '9px', lineHeight: '13px',
                fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '2',
                transform: index === 0 ? 'none' : index === divisions ? 'translateX(-100%)' : 'translateX(-50%)'
            });
            this.strip.appendChild(label);
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
        const duration = this.totalDuration();
        const element = document.createElement('div');
        element.className = className;
        if (title) {
            element.title = title;
        }
        Object.assign(element.style, {
            position: 'absolute',
            top: `${top}px`,
            height: `${height}px`,
            left: `${this.percent(start, duration)}%`,
            width: `${Math.max(this.percent(end, duration) - this.percent(start, duration), 0.3)}%`,
            pointerEvents: 'none'
        });
        return element;
    }

    protected captionLabel(start: number, text: string): HTMLDivElement {
        const label = document.createElement('div');
        label.className = 'akari-annotations-strip-caption-text';
        label.textContent = text;
        label.title = text;
        label.style.left = `${this.percent(start, this.totalDuration())}%`;
        return label;
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
        const duration = this.totalDuration();
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
        const duration = this.totalDuration();
        ghost.style.left = `${this.percent(start, duration)}%`;
        ghost.style.width = `${Math.max(this.percent(end, duration) - this.percent(start, duration), 0.3)}%`;
    }

    protected snapTime(value: number, showGuide: boolean): number {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.totalDuration();
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
                this.snapGuide.style.left = `${this.percent(nearest, duration)}%`;
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

    protected percent(value: number, duration: number): number {
        return duration > 0 ? Math.min(100, Math.max(0, value / duration * 100)) : 0;
    }

    protected timeAtClientX(clientX: number): number {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        return ratio * this.totalDuration();
    }

    protected selectTimeAtClientX(clientX: number): void {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        this.selectedSourceT = ratio * this.totalDuration();
        this.playhead.style.left = `${ratio * 100}%`;
        this.updateTimeLabel();
        void this.requestSeek(this.selectedSourceT);
    }

    protected onStripClick(event: MouseEvent): void {
        this.selectTimeAtClientX(event.clientX);
    }

    protected updateTimeLabel(): void {
        this.timeLabel.textContent = this.formatTimestamp(this.selectedSourceT);
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

    protected async submitAnnotation(textOverride?: string, sourceTOverride?: number): Promise<void> {
        const text = (textOverride ?? this.textInput.value).trim();
        const sourceT = sourceTOverride ?? this.selectedSourceT;
        if (!text || !this.location) {
            return;
        }
        this.addButton.disabled = true;
        try {
            const result = await this.annotationsService.createAnnotation({
                reviewUri: this.location.reviewUri.toString(),
                projectRootUri: this.location.root.toString(),
                sourceT,
                timelineT: null,
                target: null,
                text
            });
            if (!this.annotations.some(existing => existing.id === result.annotation.id)) {
                this.annotations = [...this.annotations, result.annotation];
            }
            if (textOverride === undefined) {
                this.textInput.value = '';
            }
            this.hideNotice();
            this.renderStrip();
            this.renderList();
            this.footer.textContent = result.committed
                ? '注釈を追加しました。変更を記録しました。'
                : '注釈を追加しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`注釈を追加できません: ${detail}`);
            this.messages.error(`注釈を追加できません: ${detail}`);
        } finally {
            this.addButton.disabled = false;
        }
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        if (!this.location) {
            return;
        }
        try {
            const result = await this.annotationsService.resolveAnnotation({
                reviewUri: this.location.reviewUri.toString(),
                annotationId: id
            });
            this.annotations = this.annotations.map(annotation => annotation.id === id ? result.annotation : annotation);
            this.renderStrip();
            this.renderList();
            this.footer.textContent = '注釈を確認済みにしました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`更新できません: ${detail}`);
            this.messages.error(`更新できません: ${detail}`);
        }
    }

    protected renderList(): void {
        this.listContainer.replaceChildren();
        const filtered = this.annotations
            .filter(annotation => this.statusFilter === 'all' || annotation.status === this.statusFilter)
            .sort((left, right) => left.sourceT - right.sourceT);
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '該当する注釈はありません。';
            empty.style.color = 'var(--theia-descriptionForeground)';
            empty.style.padding = '8px 2px';
            this.listContainer.appendChild(empty);
            return;
        }
        for (const annotation of filtered) {
            this.listContainer.appendChild(this.renderAnnotationRow(annotation));
        }
    }

    protected renderAnnotationRow(annotation: Annotation): HTMLDivElement {
        const row = document.createElement('div');
        row.setAttribute('data-annotation-row', annotation.id);
        Object.assign(row.style, {
            display: 'grid', gap: '4px', padding: '8px 6px', borderBottom: '1px solid var(--theia-widget-border)'
        });
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const time = document.createElement('span');
        time.textContent = this.formatTimestamp(annotation.sourceT);
        time.style.fontVariantNumeric = 'tabular-nums';
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, {
            color: STATUS_COLORS[annotation.status], fontSize: '11px',
            border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px'
        });
        head.append(time, badge);
        if (annotation.status === 'addressed') {
            const resolveButton = document.createElement('button');
            resolveButton.type = 'button';
            resolveButton.className = 'theia-button secondary';
            resolveButton.textContent = '確認済みにする';
            resolveButton.setAttribute('data-resolve-button', annotation.id);
            resolveButton.style.marginLeft = 'auto';
            resolveButton.addEventListener('click', () => void this.resolveAnnotationById(annotation.id));
            head.appendChild(resolveButton);
        }
        const text = document.createElement('div');
        text.textContent = annotation.text;
        row.append(head, text);
        if (annotation.response) {
            const response = document.createElement('div');
            response.style.color = 'var(--theia-descriptionForeground)';
            response.style.fontSize = '12px';
            response.textContent = `対応（${annotation.response.action === 'edited' ? '編集しました' : '見送りました'}）: ${annotation.response.summary}`;
            row.appendChild(response);
        }
        return row;
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
