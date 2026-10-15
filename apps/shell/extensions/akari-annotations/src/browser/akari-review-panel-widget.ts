import { formatDate, t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget, OpenerService, open } from '@theia/core/lib/browser';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { Annotation } from '../common/akari-annotations-protocol';
import { handAnnotation, handPendingAnnotations } from '../common/annotation-handoff-flow';
import { AnnotationStroke } from '../common/annotation-store';
import { AkariPreviewService } from 'akari-preview/lib/common/akari-preview-protocol';
import { pendingAnnotationHandoff } from '../common/batch-annotation-handoff';
import { planCompileHandoff } from '../common/compile-session-handoff';
import { handPromptToPartner } from '../common/partner-handoff';
import {
    buildUiTargetRow,
    collectBlockIds,
    extractBlocksManifest,
    parseCanvasTarget,
    parseDocTarget,
    parseImageTarget,
    parseUiTarget,
    needsUiTargetLabels
} from '../common/doc-target';
import {
    CLIP_ANNOTATION_LABELS_REQUEST_EVENT,
    CLIP_ANNOTATION_OPEN_EVENT,
    CLIP_ANNOTATION_REVEAL_EVENT
} from '../common/timeline-context-menu-items';
import { resolveRawSourceId } from '../common/raw-source-selection';
import { formatRecordingName } from '../common/recording-name';
import {
    RawPreviewAnnotationStateSnapshot,
    RawSourceSelectionSnapshot,
    RawSourceSelectionState,
    applyResolvedRawSourceSelection,
    sameRawPreviewIdentity,
    suppressRawSourceSelection,
    transitionRawSourceSelection
} from '../common/raw-source-selection-state';
import { AkariCanvasDialog } from './akari-canvas-dialog';
import { AKARI_WARNING_TEXT_COLOR, createAkariNoticeBanner } from './akari-notice-banner';
import { AkariImageAnnotationDialog } from './akari-image-annotation-dialog';
import { OPEN_AKARI_REVIEW_BOARD } from './akari-annotations-commands';
import { ReviewModel, reviewSessionBadge, sessionIdForAnnotation } from './review-model';
import { SentAnnotationStore } from './sent-annotation-store';
import { UiTargetLabelStore } from './ui-target-label-store';
import { replayableAnnotationStrokes } from '../common/annotation-display-strokes';

export interface ReviewScrollRow {
    id: string;
    top: number;
    bottom: number;
}

export interface ReviewScrollAnchor {
    id: string;
    offset: number;
    order: string[];
}

/** 再描画前の表示先頭。先頭にいるときは新しい行も先頭から見せる。 */
export function captureReviewScrollAnchor(
    rows: readonly ReviewScrollRow[], containerTop: number, scrollTop: number
): ReviewScrollAnchor | undefined {
    if (scrollTop <= 0) return undefined;
    const firstVisible = rows.find(row => row.bottom > containerTop);
    if (!firstVisible) return undefined;
    return {
        id: firstVisible.id,
        offset: firstVisible.top - containerTop,
        order: rows.map(row => row.id)
    };
}

/** 旧アンカーが消えた場合は旧順の次、次も無ければ前を同じ位置へ置く。 */
export function restoreReviewScrollTop(
    anchor: ReviewScrollAnchor | undefined, rows: readonly ReviewScrollRow[],
    containerTop: number, scrollTop: number, maxScrollTop: number
): number {
    if (!anchor) return Math.max(0, Math.min(scrollTop, maxScrollTop));
    const byId = new Map(rows.map(row => [row.id, row]));
    let row = byId.get(anchor.id);
    if (!row) {
        const index = anchor.order.indexOf(anchor.id);
        for (let i = index + 1; i < anchor.order.length && !row; i++) {
            row = byId.get(anchor.order[i]);
        }
        for (let i = index - 1; i >= 0 && !row; i--) {
            row = byId.get(anchor.order[i]);
        }
    }
    if (!row) return Math.max(0, Math.min(scrollTop, maxScrollTop));
    return Math.max(0, Math.min(scrollTop + row.top - containerTop - anchor.offset, maxScrollTop));
}

/** DOM の位置測定だけを純関数の外に置く。 */
export function readReviewScrollRows(container: HTMLElement, firstAttribute: string, secondAttribute: string): ReviewScrollRow[] {
    return Array.from(container.children).flatMap(child => {
        const id = child.getAttribute(firstAttribute) ?? child.getAttribute(secondAttribute);
        if (id === null) return [];
        const rect = child.getBoundingClientRect();
        return [{ id, top: rect.top, bottom: rect.bottom }];
    });
}

/** doc: target のブロック存在チェック結果（契約 §6 の劣化規約に対応）。 */
type DocTargetHealth = 'ok' | 'path-missing' | 'block-missing';
/** image: target のファイル存在チェック結果（同じく契約 §6。block-id の概念が無い分 doc より単純）。 */
type ImageTargetHealth = 'ok' | 'path-missing';
/** canvas: target のディレクトリ存在チェック結果（contract-2026-07-26-canvas-surface §6）。 */
type CanvasTargetHealth = 'ok' | 'dir-missing';

// akari-preview 側の同名定数とミラー。extension 間の npm 依存を作らず outer window で連携する。
const REVIEW_SESSION_START_EVENT = 'akari.review.session.start';
const REVIEW_SESSION_STOP_EVENT = 'akari.review.session.stop';
const REVIEW_SESSION_REFRESH_EVENT = 'akari.review.session.refresh';
const REVIEW_SESSION_OPEN_FOLDER_EVENT = 'akari.review.session.openFolder';
const REVIEW_SESSION_STATE_EVENT = 'akari.review.session.state';
const REVIEW_SESSION_FOCUS_EVENT = 'akari.review.session.focus';
const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';
// M3 (task.md 指示2): 「選択を解除」ボタンからの request。akari-preview 側
// （akari-preview-open-handler.ts の REVIEW_UI_SELECTION_CLEAR_EVENT）と文字列だけミラーする。
const REVIEW_UI_SELECTION_CLEAR_EVENT = 'akari.review.uiSelection.clear';
// akari-preview 側の同名イベントと文字列だけミラーする。raw preview は editUri を持たないため、
// フォーカス中の素材 URI と source 秒をこの additive な経路で受け取る。
const RAW_PREVIEW_ANNOTATION_STATE_EVENT = 'akari.preview.rawAnnotationState';

type ReviewToolMode = 'neutral' | 'pen' | 'rect' | 'select';

interface ReviewSessionSummary {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationSec: number;
    orphaned: boolean;
    ranges?: Array<{ start: number; end: number }>;
    status?: 'recorded' | 'transcribed' | 'compiled' | null;
    compiledAnnotations?: string[] | null;
    strokeCount?: number;
}

interface ReviewSessionFocusDetail {
    sessionId: string;
    editUri: string;
}

/** M3 (task.md 指示2): select ツールで直近クリックした登録済み UI 要素。akari-preview 側とミラー。 */
interface ReviewSelectedUiTarget {
    target: string;
    label: string;
}

interface ReviewSessionUiState {
    editUri: string;
    projectRootUri: string;
    status: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
    active: boolean;
    elapsedSec: number;
    level: number;
    silenceWarning: boolean;
    toolMode: ReviewToolMode;
    sessions: ReviewSessionSummary[];
    selectedUiTarget?: ReviewSelectedUiTarget;
    error?: string;
}

type RawPreviewAnnotationState = RawPreviewAnnotationStateSnapshot;
type RawSourceSelection = RawSourceSelectionSnapshot;

const STATUS_LABELS: Record<Annotation['status'], string> = {
    get open() { return t('annotations.reviewPanelWidget.text.notSupported'); },
    get addressed() { return t('annotations.reviewPanelWidget.text.alreadySupported'); },
    get resolved() { return t('annotations.reviewPanelWidget.text.confirmed'); }
};
const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};
const ANNOTATION_UNDO_TIMEOUT_MS = 6000;

/**
 * 注釈（レビューコメント）専用パネル。右サイドへ配置する。
 * タイムラインは編集（カット・字幕・オーバーレイ）に専念し、注釈の一覧・絞り込み・追加はここへ集約する。
 */
@injectable()
export class AkariReviewPanelWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-review-panel-widget';

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(ReviewModel)
    protected readonly model!: ReviewModel;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(SentAnnotationStore)
    protected readonly sentStore!: SentAnnotationStore;

    @inject(UiTargetLabelStore)
    protected readonly labelStore!: UiTargetLabelStore;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(AkariPreviewService)
    protected readonly previewService!: AkariPreviewService;

    protected readonly toolbar = document.createElement('div');
    protected readonly openBoardButton = document.createElement('button');
    protected readonly filterButtons = document.createElement('div');
    protected readonly countLabel = document.createElement('span');
    protected readonly batchBar = document.createElement('div');
    protected readonly batchButton = document.createElement('button');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly docSelectionChip = document.createElement('div');
    protected readonly docSelectionLabel = document.createElement('span');
    protected readonly docSelectionClear = document.createElement('button');
    protected readonly clipSelectionChip = document.createElement('div');
    protected readonly clipSelectionLabel = document.createElement('span');
    protected readonly clipSelectionClear = document.createElement('button');
    // M3 (task.md 指示2): select ツールで選択中の UI 要素へのコメント導線（docSelectionChip とミラー）。
    protected readonly uiSelectionChip = document.createElement('div');
    protected readonly uiSelectionLabel = document.createElement('span');
    protected readonly uiSelectionClear = document.createElement('button');
    protected readonly rawSourceChip = document.createElement('div');
    protected readonly rawSourceLabel = document.createElement('span');
    protected readonly rawSourceClear = document.createElement('button');
    protected readonly textInput = document.createElement('input');
    protected readonly addButton = document.createElement('button');
    /** doc: target の block-id 存在チェック（契約 §6）。report.html の blocks マニフェストを path ごとにキャッシュする。 */
    protected readonly docTargetHealthCache = new Map<string, Promise<unknown | undefined>>();
    protected readonly recordingSection = document.createElement('section');
    protected readonly recordingButton = document.createElement('button');
    protected readonly recordingIndicator = document.createElement('span');
    protected readonly recordingElapsed = document.createElement('span');
    protected readonly recordingLevelMeter = document.createElement('div');
    protected readonly recordingLevelFill = document.createElement('div');
    protected readonly silenceWarningNotice = document.createElement('div');
    protected readonly recordingNotice = document.createElement('div');
    protected readonly sessionList = document.createElement('div');
    protected readonly notice = createAkariNoticeBanner({ dataAttribute: 'data-akari-review-notice' });
    protected readonly listContainer = document.createElement('div');
    protected reviewSessionState: ReviewSessionUiState | undefined;
    protected focusedReviewSessionId: string | undefined;
    protected lastReviewSessionContext = '';
    protected rawSourceState: RawSourceSelectionState = {};
    protected rawSourceResolutionKey: string | undefined;
    protected resolvedRawSourceKey: string | undefined;
    protected rawSourceResolutionSequence = 0;
    protected rawSourceResolutionPromise: Promise<void> | undefined;
    protected clipAnnotationSelection: { editUri: string; target: string; label: string; sourceT: number } | undefined;
    protected get uiTargetLabels(): Readonly<Record<string, string>> {
        return this.labelStore.get(this.model.location?.editUri?.toString());
    }
    protected lastUiTargetLabelsRequest = '';
    protected sentAnnotationIds = new Set<string>();
    protected sentAnnotationsReviewUri = '';
    protected sentAnnotationsLoadSequence = 0;
    protected pendingUndo = new Map<string, { annotation: Annotation; timer: ReturnType<typeof setTimeout> }>();
    protected pendingSessionDeletes = new Map<string, { timer: ReturnType<typeof setTimeout>; projectRootUri: string }>();
    protected handedSessionIds = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = AkariReviewPanelWidget.FACTORY_ID;
        this.title.label = t('annotations.reviewPanelWidget.text.annotation');
        this.title.caption = t('annotations.reviewPanelWidget.text.annotationsReviewComments');
        this.title.iconClass = 'akari-rail-icon akari-rail-icon-review';
        this.title.closable = false; // 右ドック常設。閉じたいときは右ドックごと畳む。
        this.node.classList.add('akari-review-panel-widget');
        // docs/contract-2026-08-11-review-session-ui-events.md #2: panel:<id> opt-in target.
        this.node.setAttribute('data-akari-ui', 'panel:review');
        this.node.setAttribute('data-akari-ui-label', t('annotations.reviewPanelWidget.text.annotationPanel'));
        Object.assign(this.node.style, {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: '0',
            overflow: 'hidden',
            fontSize: '12px',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '8px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box', flex: 'none'
        });
        const heading = document.createElement('strong');
        heading.textContent = t('annotations.reviewPanelWidget.text.annotation');
        heading.style.fontSize = '13px';
        this.countLabel.style.cssText = 'font-size:11px;color:var(--theia-descriptionForeground);margin-right:auto';
        this.openBoardButton.type = 'button';
        this.openBoardButton.className = 'theia-button secondary';
        this.openBoardButton.textContent = '⋯';
        this.openBoardButton.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.moreOptions'));
        this.openBoardButton.setAttribute('aria-haspopup', 'menu');
        this.openBoardButton.setAttribute('aria-expanded', 'false');
        this.openBoardButton.setAttribute('data-review-open-board', '');
        Object.assign(this.openBoardButton.style, { minWidth: '0', width: '28px', height: '28px', padding: '0' });
        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;right:10px;top:38px;z-index:10;background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);padding:5px;border-radius:6px';
        menu.setAttribute('role', 'menu');
        const closeMenu = (): void => {
            menu.style.display = 'none';
            this.openBoardButton.setAttribute('aria-expanded', 'false');
        };
        this.openBoardButton.addEventListener('click', () => {
            const expanded = this.openBoardButton.getAttribute('aria-expanded') === 'true';
            menu.style.display = expanded ? 'none' : 'grid';
            this.openBoardButton.setAttribute('aria-expanded', String(!expanded));
        });
        const onOutsidePointerDown = (event: PointerEvent): void => {
            if (!menu.contains(event.target as Node) && !this.openBoardButton.contains(event.target as Node)) closeMenu();
        };
        const onMenuKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && this.openBoardButton.getAttribute('aria-expanded') === 'true') {
                closeMenu();
                this.openBoardButton.focus();
            }
        };
        document.addEventListener('pointerdown', onOutsidePointerDown);
        document.addEventListener('keydown', onMenuKeyDown);
        this.toDispose.push({ dispose: () => {
            document.removeEventListener('pointerdown', onOutsidePointerDown);
            document.removeEventListener('keydown', onMenuKeyDown);
        } });
        const boardItem = document.createElement('button');
        boardItem.className = 'theia-button secondary';
        boardItem.setAttribute('role', 'menuitem');
        boardItem.textContent = t('annotations.reviewPanelWidget.text.openBoard');
        boardItem.addEventListener('click', () => { closeMenu(); void this.commands.executeCommand(OPEN_AKARI_REVIEW_BOARD.id); });
        const folderItem = document.createElement('button');
        folderItem.className = 'theia-button secondary';
        folderItem.setAttribute('role', 'menuitem');
        folderItem.textContent = t('annotations.reviewPanelWidget.text.openSaveLocation');
        folderItem.addEventListener('click', () => { closeMenu(); this.openSessionsFolder(); });
        menu.append(boardItem, folderItem);
        this.toolbar.style.position = 'relative';
        this.toolbar.append(heading, this.countLabel, this.openBoardButton, menu);
        Object.assign(this.filterButtons.style, {
            display: 'flex', gap: '4px', padding: '8px 10px', borderBottom: '1px solid var(--theia-widget-border)', flexWrap: 'wrap', flex: 'none'
        });

        Object.assign(this.composerRow.style, {
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
            padding: '8px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', flex: 'none'
        });
        Object.assign(this.timeLabel.style, {
            fontVariantNumeric: 'tabular-nums', color: 'var(--theia-descriptionForeground)', fontSize: '11px'
        });
        this.timeLabel.title = t('annotations.reviewPanelWidget.text.clickingOnTheTimelineWillChangeThis');
        this.docSelectionChip.setAttribute('data-review-doc-selection-chip', '');
        Object.assign(this.docSelectionChip.style, {
            display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px',
            padding: '2px 8px', borderRadius: '999px',
            border: '1px solid var(--theia-textLink-foreground)', color: 'var(--theia-textLink-foreground)'
        });
        this.docSelectionLabel.setAttribute('data-review-doc-selection-label', '');
        this.docSelectionClear.type = 'button';
        this.docSelectionClear.textContent = '✕';
        this.docSelectionClear.title = t('annotations.reviewPanelWidget.text.deselectAndReturnToVideoAnnotations');
        this.docSelectionClear.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.unblockReports'));
        Object.assign(this.docSelectionClear.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            color: 'inherit'
        });
        this.docSelectionClear.addEventListener('click', () => { this.model.docSelection = undefined; });
        this.docSelectionChip.append(this.docSelectionLabel, this.docSelectionClear);
        this.clipSelectionChip.setAttribute('data-review-clip-selection-chip', '');
        Object.assign(this.clipSelectionChip.style, {
            display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px',
            padding: '2px 8px', borderRadius: '999px',
            border: '1px solid var(--theia-textLink-foreground)', color: 'var(--theia-textLink-foreground)'
        });
        this.clipSelectionLabel.setAttribute('data-review-clip-selection-label', '');
        this.clipSelectionClear.type = 'button';
        this.clipSelectionClear.textContent = '✕';
        this.clipSelectionClear.title = t('annotations.reviewPanelWidget.text.deselectClipsAndReturnToVideoAnnotations');
        this.clipSelectionClear.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.deselectClips'));
        Object.assign(this.clipSelectionClear.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit', color: 'inherit'
        });
        this.clipSelectionClear.addEventListener('click', () => this.clearClipAnnotationSelection());
        this.clipSelectionChip.append(this.clipSelectionLabel, this.clipSelectionClear);
        // M3 (task.md 指示2): docSelectionChip とミラーした「選択中の UI 要素」チップ。
        this.uiSelectionChip.setAttribute('data-review-ui-selection-chip', '');
        Object.assign(this.uiSelectionChip.style, {
            display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px',
            padding: '2px 8px', borderRadius: '999px',
            border: '1px solid var(--theia-textLink-foreground)', color: 'var(--theia-textLink-foreground)'
        });
        this.uiSelectionLabel.setAttribute('data-review-ui-selection-label', '');
        this.uiSelectionClear.type = 'button';
        this.uiSelectionClear.textContent = '✕';
        this.uiSelectionClear.title = t('annotations.reviewPanelWidget.text.deselectAndReturnToVideoAnnotations');
        this.uiSelectionClear.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.deselectUiElements'));
        Object.assign(this.uiSelectionClear.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            color: 'inherit'
        });
        this.uiSelectionClear.addEventListener('click', () => this.clearUiSelection());
        this.uiSelectionChip.append(this.uiSelectionLabel, this.uiSelectionClear);
        this.rawSourceChip.setAttribute('data-review-raw-source-chip', '');
        Object.assign(this.rawSourceChip.style, {
            display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px',
            padding: '2px 8px', borderRadius: '999px',
            border: '1px solid var(--theia-textLink-foreground)', color: 'var(--theia-textLink-foreground)'
        });
        this.rawSourceLabel.setAttribute('data-review-raw-source-label', '');
        this.rawSourceClear.type = 'button';
        this.rawSourceClear.textContent = '✕';
        this.rawSourceClear.title = t('annotations.reviewPanelWidget.text.deselectMaterialAndReturnToOutputTimeline');
        this.rawSourceClear.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.rawPreviewDeselectMaterial'));
        Object.assign(this.rawSourceClear.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            color: 'inherit'
        });
        this.rawSourceClear.addEventListener('click', () => this.clearRawSourceSelection());
        this.rawSourceChip.append(this.rawSourceLabel, this.rawSourceClear);
        this.textInput.type = 'text';
        this.textInput.placeholder = t('annotations.reviewPanelWidget.text.enterComment');
        this.textInput.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.enterComment'));
        Object.assign(this.textInput.style, { flex: '1', minWidth: '0' });
        this.textInput.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void this.submitAnnotation();
            }
        });
        this.addButton.type = 'button';
        this.addButton.className = 'theia-button main';
        this.addButton.textContent = t('annotations.reviewPanelWidget.text.add');
        this.addButton.addEventListener('click', () => void this.submitAnnotation());
        this.composerRow.append(
            this.timeLabel,
            this.docSelectionChip,
            this.clipSelectionChip,
            this.uiSelectionChip,
            this.rawSourceChip,
            this.textInput,
            this.addButton
        );

        Object.assign(this.recordingSection.style, {
            display: 'grid', gap: '7px', padding: '9px 10px',
            borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box', flex: 'none'
        });
        this.recordingSection.setAttribute('data-review-recording-section', '');
        const recordingHeading = document.createElement('div');
        Object.assign(recordingHeading.style, { display: 'flex', alignItems: 'center', gap: '7px' });
        const recordingTitle = document.createElement('strong');
        recordingTitle.textContent = t('annotations.reviewPanelWidget.text.recordingSession');
        recordingTitle.setAttribute('data-review-recording-title', '');
        recordingTitle.style.fontSize = '12px';
        this.recordingIndicator.className = 'akari-review-recording-indicator';
        this.recordingIndicator.textContent = '●';
        this.recordingIndicator.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.recordingStopped'));
        Object.assign(this.recordingIndicator.style, { color: 'var(--theia-descriptionForeground)', fontSize: '11px' });
        Object.assign(this.recordingElapsed.style, {
            marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: '12px'
        });
        this.recordingElapsed.textContent = '00:00';
        recordingHeading.append(recordingTitle, this.recordingIndicator, this.recordingElapsed);

        const recordingHint = document.createElement('div');
        recordingHint.setAttribute('data-review-sessions-hint', '');
        recordingHint.textContent = t('annotations.reviewPanelWidget.text.aRecordIDrewWhileTalkingWhen');
        Object.assign(recordingHint.style, {
            color: 'var(--theia-descriptionForeground)', fontSize: '11px', lineHeight: '1.4'
        });

        const recordingControls = document.createElement('div');
        Object.assign(recordingControls.style, { display: 'flex', alignItems: 'center', gap: '7px' });
        this.recordingButton.type = 'button';
        this.recordingButton.setAttribute('data-review-recording-toggle', '');
        this.recordingButton.className = 'theia-button secondary';
        this.recordingButton.textContent = t('annotations.reviewPanelWidget.text.startRecording');
        this.recordingButton.addEventListener('click', () => this.toggleRecording());
        recordingControls.append(this.recordingButton);

        this.recordingLevelMeter.setAttribute('data-review-level-meter', '');
        this.recordingLevelMeter.setAttribute('data-review-level', '0');
        this.recordingLevelMeter.setAttribute('role', 'meter');
        this.recordingLevelMeter.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.microphoneInputLevel'));
        this.recordingLevelMeter.setAttribute('aria-valuemin', '0');
        this.recordingLevelMeter.setAttribute('aria-valuemax', '1');
        Object.assign(this.recordingLevelMeter.style, {
            height: '6px', overflow: 'hidden', borderRadius: '999px',
            background: 'var(--theia-input-background)'
        });
        Object.assign(this.recordingLevelFill.style, {
            width: '0%', height: '100%', borderRadius: 'inherit',
            background: 'var(--theia-charts-green)', transition: 'width 120ms linear'
        });
        this.recordingLevelMeter.appendChild(this.recordingLevelFill);
        this.silenceWarningNotice.textContent = t('annotations.reviewPanelWidget.text.inputIsSilentCheckMicrophoneSettings');
        Object.assign(this.silenceWarningNotice.style, {
            display: 'none', color: AKARI_WARNING_TEXT_COLOR, fontSize: '11px', lineHeight: '1.4'
        });
        Object.assign(this.recordingNotice.style, {
            display: 'none', color: 'var(--theia-errorForeground)', fontSize: '11px', lineHeight: '1.4'
        });
        Object.assign(this.sessionList.style, {
            display: 'grid', gap: '7px', padding: '8px 10px', fontSize: '12px',
            borderBottom: '1px solid var(--theia-widget-border)',
            flex: '0 1 auto', minHeight: '0', maxHeight: '35%', overflow: 'auto', alignContent: 'start'
        });
        this.recordingSection.append(
            recordingHeading,
            recordingHint,
            recordingControls,
            this.recordingLevelMeter,
            this.silenceWarningNotice,
            this.recordingNotice
        );

        Object.assign(this.listContainer.style, { flex: '1 1 0', minHeight: '0', overflow: 'auto', padding: '4px 10px' });
        this.batchBar.style.cssText = 'display:flex;flex:none;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--theia-widget-border);font-size:12px';
        this.batchButton.type = 'button';
        this.batchButton.className = 'theia-button main';
        this.batchButton.textContent = t('annotations.reviewPanelWidget.text.handAllToAi');
        this.batchButton.setAttribute('data-review-batch-handoff', '');
        this.batchButton.addEventListener('click', () => void this.sendPendingAnnotations());
        Object.assign(this.notice.node.style, {
            position: 'static', width: 'auto', maxHeight: '25%', flex: 'none', boxShadow: 'none'
        });
        this.toDispose.push(this.notice);
        this.toDispose.push({ dispose: () => this.flushSessionDeletes() });
        this.node.append(
            this.toolbar,
            this.recordingSection,
            this.sessionList,
            this.filterButtons,
            this.notice.node,
            this.listContainer,
            this.batchBar,
            this.composerRow
        );

        const style = document.createElement('style');
        style.textContent = `
    .akari-review-panel-widget button,
    .akari-review-panel-widget input {
        font-size: 12px;
    }
    .akari-review-panel-widget [role="menu"] button {
        font-size: 12px;
    }
    .akari-review-panel-widget .theia-button.secondary[data-review-filter][aria-pressed="true"] {
        border-color: var(--theia-focusBorder) !important;
        background-color: var(--theia-list-activeSelectionBackground) !important;
        color: var(--theia-list-activeSelectionForeground, var(--theia-foreground)) !important;
        font-weight: 650 !important;
    }
    .akari-review-panel-widget .akari-review-row.akari-review-row-revealed {
        background: var(--theia-list-activeSelectionBackground);
        border-radius: 3px;
    }
    .akari-review-panel-widget .akari-review-row-undo {
        background: var(--theia-list-inactiveSelectionBackground);
    }
    .akari-review-panel-widget .akari-review-recording-indicator.is-recording {
        color: #e5484d !important;
        animation: akari-review-recording-pulse 1.15s ease-in-out infinite;
    }
    @keyframes akari-review-recording-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.28; }
    }
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => {
            this.syncSentAnnotationsForLocation();
            this.render();
        }));
        this.toDispose.push(this.sentStore.onDidChange(reviewUri => {
            if (reviewUri !== this.sentAnnotationsReviewUri) return;
            void this.sentStore.read(reviewUri).then(ids => {
                this.sentAnnotationIds = new Set(ids);
                this.renderList();
            });
        }));
        this.toDispose.push(this.model.onReveal(id => this.revealAnnotation(id)));
        const onReviewSessionState = (event: Event): void => {
            const state = (event as CustomEvent<ReviewSessionUiState>).detail;
            const projectRootUri = this.model.location?.root.normalizePath().toString();
            if (!state || !projectRootUri
                || this.normalizeUri(state.projectRootUri) !== this.normalizeUri(projectRootUri)) {
                return;
            }
            this.reviewSessionState = state;
            this.renderRecordingSection();
            // M3 (task.md 指示2): selectedUiTarget はこの state 更新でしか変わらないため、
            // コンポーザーのチップもここで再描画する（model.onChanged 経由の render() を待たない）。
            this.renderDocSelectionChip();
        };
        window.addEventListener(REVIEW_SESSION_STATE_EVENT, onReviewSessionState);
        this.toDispose.push({
            dispose: () => window.removeEventListener(REVIEW_SESSION_STATE_EVENT, onReviewSessionState)
        });
        const onReviewSessionFocus = (event: Event): void => {
            const detail = (event as CustomEvent<ReviewSessionFocusDetail>).detail;
            const editUri = this.model.location?.editUri?.normalizePath().toString();
            if (!detail || !editUri || this.normalizeUri(detail.editUri) !== this.normalizeUri(editUri)) return;
            this.focusedReviewSessionId = detail.sessionId;
            this.revealReviewSession(detail.sessionId);
        };
        window.addEventListener(REVIEW_SESSION_FOCUS_EVENT, onReviewSessionFocus);
        this.toDispose.push({
            dispose: () => window.removeEventListener(REVIEW_SESSION_FOCUS_EVENT, onReviewSessionFocus)
        });
        const onRawPreviewAnnotationState = (event: Event): void => {
            const state = (event as CustomEvent<RawPreviewAnnotationState>).detail;
            this.handleRawPreviewAnnotationState(state);
        };
        window.addEventListener(RAW_PREVIEW_ANNOTATION_STATE_EVENT, onRawPreviewAnnotationState);
        this.toDispose.push({
            dispose: () => window.removeEventListener(RAW_PREVIEW_ANNOTATION_STATE_EVENT, onRawPreviewAnnotationState)
        });
        const onClipAnnotationOpen = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string; target?: string; label?: string; sourceT?: number;
            }>).detail;
            const editUri = this.model.location?.editUri?.normalizePath().toString();
            if (!detail || !editUri || this.normalizeUri(detail.editUri ?? '') !== this.normalizeUri(editUri)
                || typeof detail.sourceT !== 'number' || !Number.isFinite(detail.sourceT)) return;
            if (typeof detail.target === 'string' && detail.target) {
                this.clipAnnotationSelection = {
                    editUri,
                    target: detail.target,
                    label: typeof detail.label === 'string' && detail.label.trim() ? detail.label.trim() : detail.target,
                    sourceT: detail.sourceT
                };
            } else {
                this.clearClipAnnotationSelection();
            }
            this.model.selectedSourceT = detail.sourceT;
            this.renderDocSelectionChip();
            this.textInput.focus();
        };
        this.toDispose.push(this.labelStore.onDidChange(changedEditUri => {
            const editUri = this.model.location?.editUri?.normalizePath().toString();
            if (!editUri || changedEditUri !== editUri) return;
            this.renderList();
        }));
        window.addEventListener(CLIP_ANNOTATION_OPEN_EVENT, onClipAnnotationOpen);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener(CLIP_ANNOTATION_OPEN_EVENT, onClipAnnotationOpen);
        } });
        this.syncSentAnnotationsForLocation();
        this.render();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.lastReviewSessionContext = '';
        this.refreshReviewSessionContext();
        this.requestMissingUiTargetLabels();
    }

    protected override onBeforeHide(msg: Message): void {
        this.flushSessionDeletes();
        super.onBeforeHide(msg);
    }

    protected render(): void {
        this.renderFilters();
        this.renderDocSelectionChip();
        this.refreshReviewSessionContext();
        this.renderRecordingSection();
        this.renderList();
    }

    /**
     * レポート側でブロックを選択している間、または select ツールで UI 要素を選択している間は、
     * その文脈をコンポーザーに出す（指示 3 / M3 task.md 指示2）。選択中は動画の時刻ではなく
     * doc: / ui: target で注釈が作られることを示す。doc 選択が優先（同時に両方成立する経路は
     * 通常無いが、レポートタブと録音セッションを両方開いた稀なケースの決定を明確にしておく）。
     */
    protected renderFilters(): void {
        const counts = { all: this.model.annotations.length, open: 0, addressed: 0, resolved: 0 };
        for (const annotation of this.model.annotations) counts[annotation.status]++;
        this.countLabel.textContent = t('annotations.reviewPanelWidget.text.headerCounts', {
            open: counts.open, addressed: counts.addressed
        });
        this.filterButtons.replaceChildren();
        for (const [status, label] of [
            ['all', t('annotations.reviewPanelWidget.text.all')],
            ['open', t('annotations.reviewPanelWidget.text.notSupported')],
            ['addressed', t('annotations.reviewPanelWidget.text.alreadySupported')],
            ['resolved', t('annotations.reviewPanelWidget.text.confirmed')]
        ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-button secondary';
            button.textContent = `${label} ${counts[status]}`;
            button.setAttribute('data-review-filter', status);
            button.setAttribute('aria-pressed', String(status === this.model.statusFilter));
            button.addEventListener('click', () => { this.model.statusFilter = status; });
            this.filterButtons.appendChild(button);
        }
    }

    protected renderDocSelectionChip(): void {
        const selection = this.model.docSelection;
        const clipSelection = selection ? undefined : this.clipAnnotationSelection;
        const uiSelection = selection || clipSelection ? undefined : this.reviewSessionState?.selectedUiTarget;
        const rawSelection = selection || clipSelection || uiSelection ? undefined : this.rawSourceState.selection;
        if (!selection && !clipSelection && !uiSelection && !rawSelection) {
            this.docSelectionChip.style.display = 'none';
            this.clipSelectionChip.style.display = 'none';
            this.uiSelectionChip.style.display = 'none';
            this.rawSourceChip.style.display = 'none';
            this.timeLabel.style.display = '';
            this.timeLabel.textContent = this.formatTimestamp(this.model.selectedSourceT);
            this.textInput.placeholder = t('annotations.reviewPanelWidget.text.enterComment');
            return;
        }
        this.timeLabel.style.display = 'none';
        if (selection) {
            this.docSelectionChip.style.display = 'inline-flex';
            this.clipSelectionChip.style.display = 'none';
            this.uiSelectionChip.style.display = 'none';
            this.rawSourceChip.style.display = 'none';
            this.docSelectionLabel.textContent = t('annotations.reviewPanelWidget.text.selecting', { name: this.reportBaseName(selection.path) });
            this.docSelectionLabel.title = `${selection.path}#${selection.blockId}`;
            this.textInput.placeholder = t('annotations.reviewPanelWidget.text.commentAboutThisBlock');
            return;
        }
        if (clipSelection) {
            this.docSelectionChip.style.display = 'none';
            this.clipSelectionChip.style.display = 'inline-flex';
            this.uiSelectionChip.style.display = 'none';
            this.rawSourceChip.style.display = 'none';
            this.clipSelectionLabel.textContent = t('annotations.reviewPanelWidget.text.selectingAlternate', { label: clipSelection.label });
            this.clipSelectionLabel.title = `ui:${clipSelection.target}`;
            this.textInput.placeholder = t('annotations.reviewPanelWidget.text.commentAboutThisClip');
            return;
        }
        if (uiSelection) {
            this.docSelectionChip.style.display = 'none';
            this.clipSelectionChip.style.display = 'none';
            this.uiSelectionChip.style.display = 'inline-flex';
            this.rawSourceChip.style.display = 'none';
            this.uiSelectionLabel.textContent = t('annotations.reviewPanelWidget.text.selectingAlternate', { label: uiSelection.label });
            this.uiSelectionLabel.title = uiSelection.target;
            this.textInput.placeholder = t('annotations.reviewPanelWidget.text.commentAboutThisUiElement');
            return;
        }
        this.docSelectionChip.style.display = 'none';
        this.clipSelectionChip.style.display = 'none';
        this.uiSelectionChip.style.display = 'none';
        this.rawSourceChip.style.display = 'inline-flex';
        this.rawSourceLabel.textContent = `🎞 ${rawSelection!.src}`;
        this.rawSourceLabel.title = `${rawSelection!.mediaUri} @ ${this.formatTimestamp(rawSelection!.sourceT)}`;
        this.textInput.placeholder = t('annotations.reviewPanelWidget.text.commentAboutTheCurrentLocationOfThis');
    }

    protected handleRawPreviewAnnotationState(state: RawPreviewAnnotationState | undefined): void {
        const transition = transitionRawSourceSelection(this.rawSourceState, state);
        this.rawSourceState = transition.state;
        if (!this.rawSourceState.latest) {
            this.rawSourceResolutionKey = undefined;
            this.resolvedRawSourceKey = undefined;
            this.rawSourceResolutionSequence += 1;
            this.rawSourceResolutionPromise = undefined;
            this.renderDocSelectionChip();
            return;
        }
        // activation が変わった瞬間に旧チップを消す。解決完了まで旧 src を表示・送信しない。
        this.renderDocSelectionChip();
        if (transition.needsResolution) {
            void this.resolveRawSourceSelection(this.rawSourceState.latest);
        }
    }

    protected async resolveRawSourceSelection(state: RawPreviewAnnotationState): Promise<void> {
        const location = this.model.location;
        const editUri = location?.editUri;
        if (!location || !editUri || !state.mediaUri) {
            return;
        }
        const key = `${state.activation}\n${editUri.normalizePath().toString()}\n${state.mediaUri}`;
        if (this.rawSourceResolutionKey === key && this.rawSourceResolutionPromise) {
            await this.rawSourceResolutionPromise;
            return;
        }
        if (this.resolvedRawSourceKey === key) {
            return;
        }
        this.rawSourceResolutionKey = key;
        const sequence = ++this.rawSourceResolutionSequence;
        const resolution = (async (): Promise<void> => {
            let src: string | undefined;
            try {
                const editSource = (await this.fileService.readFile(editUri)).value.toString();
                src = resolveRawSourceId(JSON.parse(editSource), location.root.toString(), state.mediaUri!);
            } catch {
                src = undefined;
            }
            if (sequence !== this.rawSourceResolutionSequence) {
                return;
            }
            this.rawSourceResolutionKey = undefined;
            this.resolvedRawSourceKey = key;
            this.rawSourceState = applyResolvedRawSourceSelection(this.rawSourceState, state, src);
            this.renderDocSelectionChip();
        })();
        this.rawSourceResolutionPromise = resolution;
        try {
            await resolution;
        } finally {
            if (this.rawSourceResolutionPromise === resolution) {
                this.rawSourceResolutionPromise = undefined;
            }
        }
    }

    protected async currentRawSourceSelection(): Promise<RawSourceSelection | undefined> {
        for (;;) {
            const latest = this.rawSourceState.latest;
            if (!latest?.active || !latest.mediaUri || !Number.isFinite(latest.sourceT)
                || this.rawSourceState.suppressedActivation === latest.activation) {
                return undefined;
            }
            if (sameRawPreviewIdentity(this.rawSourceState.selection, latest)) {
                return this.rawSourceState.selection;
            }
            await this.resolveRawSourceSelection(latest);
            const current = this.rawSourceState.latest;
            if (sameRawPreviewIdentity(current, latest)) {
                return sameRawPreviewIdentity(this.rawSourceState.selection, current)
                    ? this.rawSourceState.selection
                    : undefined;
            }
        }
    }

    protected clearRawSourceSelection(): void {
        this.rawSourceState = suppressRawSourceSelection(this.rawSourceState);
        this.renderDocSelectionChip();
    }

    protected clearClipAnnotationSelection(): void {
        this.clipAnnotationSelection = undefined;
        this.renderDocSelectionChip();
    }

    /** task.md 指示2: ✕ ボタンから ReviewSessionRecorder（akari-preview 側）へ選択解除を渡す。 */
    protected clearUiSelection(): void {
        const location = this.model.location;
        const editUri = location?.editUri?.normalizePath().toString();
        if (!location || !editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(REVIEW_UI_SELECTION_CLEAR_EVENT, {
            detail: { projectRootUri: location.root.normalizePath().toString(), editUri }
        }));
    }

    protected reportBaseName(path: string): string {
        const segments = path.split('/');
        return segments[segments.length - 1] || path;
    }

    protected renderRecordingSection(): void {
        const location = this.model.location;
        const state = this.reviewSessionState;
        const busy = state?.status === 'starting' || state?.status === 'stopping';
        const active = state?.active === true;
        const title = this.recordingSection.querySelector<HTMLElement>('[data-review-recording-title]');
        if (title) title.textContent = t(active
            ? 'annotations.reviewPanelWidget.text.recordingInProgress'
            : 'annotations.reviewPanelWidget.text.recordingSession');
        this.recordingButton.disabled = !location?.editUri || busy;
        this.recordingButton.textContent = state?.status === 'starting'
            ? t('annotations.reviewPanelWidget.text.preparing')
            : state?.status === 'stopping'
                ? t('annotations.reviewPanelWidget.text.saving')
                : active ? t('annotations.reviewPanelWidget.text.recordingFinished') : t('annotations.reviewPanelWidget.text.startRecording');
        this.recordingButton.className = 'theia-button secondary';
        this.recordingSection.style.border = active ? '1px solid var(--theia-widget-border)' : 'none';
        this.recordingIndicator.style.display = active ? 'inline' : 'none';
        this.recordingElapsed.style.display = active ? 'inline' : 'none';
        const hint = this.recordingSection.querySelector<HTMLElement>('[data-review-sessions-hint]');
        if (hint) hint.textContent = t(active
            ? 'annotations.reviewPanelWidget.text.headphoneWarning'
            : 'annotations.reviewPanelWidget.text.aRecordIDrewWhileTalkingWhen');
        this.recordingIndicator.classList.toggle('is-recording', active);
        this.recordingIndicator.setAttribute('aria-label', active ? t('annotations.reviewPanelWidget.text.recordingInProgress') : t('annotations.reviewPanelWidget.text.recordingStopped'));
        this.recordingElapsed.textContent = this.formatSessionDuration(state?.elapsedSec ?? 0);
        this.recordingLevelMeter.style.display = active ? 'block' : 'none';
        this.silenceWarningNotice.style.display = active && state?.silenceWarning ? 'block' : 'none';
        const level = active ? Math.max(0, Math.min(1, state?.level ?? 0)) : 0;
        this.recordingLevelMeter.setAttribute('data-review-level', String(level));
        this.recordingLevelMeter.setAttribute('aria-valuenow', String(level));
        this.recordingLevelFill.style.width = `${level * 100}%`;


        if (state?.error) {
            this.recordingNotice.textContent = state.error;
            this.recordingNotice.style.display = 'block';
        } else {
            this.recordingNotice.textContent = '';
            this.recordingNotice.style.display = 'none';
        }

        this.sessionList.replaceChildren();
        const sessions = state?.sessions ?? [];
        if (sessions.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = t('annotations.reviewPanelWidget.text.thereAreNoRecordedSessions');
            empty.style.color = 'var(--theia-descriptionForeground)';
            this.sessionList.appendChild(empty);
            return;
        }
        for (const session of [...sessions].reverse()) {
            const wrapper = document.createElement('div');
            wrapper.className = 'akari-review-row';
            wrapper.setAttribute('data-review-session', session.id);
            wrapper.style.cssText = 'display:grid;gap:5px;padding:8px;border:1px solid var(--theia-widget-border);border-radius:7px';
            if (this.pendingSessionDeletes.has(session.id)) {
                const label = document.createElement('span');
                label.textContent = t('annotations.reviewPanelWidget.text.deletedRecording', { name: formatRecordingName(session.id) });
                const undo = document.createElement('button');
                undo.className = 'theia-button secondary';
                undo.textContent = t('annotations.reviewPanelWidget.text.undo');
                undo.addEventListener('click', () => this.undoSessionDelete(session.id));
                wrapper.append(label, undo);
                this.sessionList.appendChild(wrapper);
                continue;
            }
            const title = document.createElement('strong');
            title.textContent = formatRecordingName(session.id);
            title.style.cssText = 'white-space:nowrap;flex:none';
            const meta = document.createElement('div');
            meta.style.cssText = 'color:var(--theia-descriptionForeground);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px';
            meta.textContent = `${this.formatSessionDate(session.startedAt)} · ${this.formatSessionDuration(session.durationSec)}`;
            const firstLine = document.createElement('div');
            firstLine.style.cssText = 'display:flex;align-items:baseline;gap:8px;min-width:0';
            firstLine.append(title, meta);
            const badge = reviewSessionBadge(session);
            const status = document.createElement('div');
            status.setAttribute('data-review-session-badge', badge.key);
            status.textContent = this.handedSessionIds.has(session.id) && badge.key !== 'compiled' && badge.key !== 'orphaned'
                ? t('annotations.reviewPanelWidget.text.handedToAi') : badge.label;
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;flex:none';
            const trash = this.trashButton(() => this.queueSessionDelete(session.id));
            trash.setAttribute('data-review-session-delete', session.id);
            trash.disabled = active && session.id === sessions[sessions.length - 1]?.id;
            actions.appendChild(trash);
            if (!session.orphaned && badge.key !== 'compiled' && !this.handedSessionIds.has(session.id)) {
                const hand = document.createElement('button');
                hand.className = 'theia-button main';
                hand.textContent = t('annotations.reviewPanelWidget.text.handToAi');
                hand.setAttribute('data-review-session-handoff', session.id);
                hand.addEventListener('click', () => void this.compileLatestSession(session.id));
                actions.appendChild(hand);
            }
            wrapper.appendChild(firstLine);
            if ((session.strokeCount ?? 0) > 0) {
                const strokes = document.createElement('span');
                strokes.append(this.createPenIcon(), t('annotations.reviewPanelWidget.text.strokeCount', {
                    count: session.strokeCount ?? 0, n: session.strokeCount ?? 0
                }));
                strokes.style.cssText = 'display:flex;align-items:center;gap:4px;color:#ff8a1f;font-size:11px';
                wrapper.append(strokes);
            }
            const lastLine = document.createElement('div');
            lastLine.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
            lastLine.append(status, actions);
            wrapper.appendChild(lastLine);
            this.sessionList.appendChild(wrapper);
        }
        this.revealReviewSession(this.focusedReviewSessionId);
    }

    protected refreshReviewSessionContext(): void {
        const location = this.model.location;
        const editUri = location?.editUri?.normalizePath().toString();
        if (!location) {
            this.lastReviewSessionContext = '';
            this.flushSessionDeletes();
            this.handedSessionIds.clear();
            this.reviewSessionState = undefined;
            return;
        }
        const projectRootUri = location.root.normalizePath().toString();
        const context = projectRootUri;
        if (context === this.lastReviewSessionContext) {
            return;
        }
        this.flushSessionDeletes();
        this.handedSessionIds.clear();
        this.lastReviewSessionContext = context;
        this.reviewSessionState = undefined;
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_REFRESH_EVENT, {
            detail: { projectRootUri, ...(editUri ? { editUri } : {}) }
        }));
    }

    protected toggleRecording(): void {
        const location = this.model.location;
        const editUri = location?.editUri?.normalizePath().toString();
        if (!location || !editUri) {
            this.recordingNotice.textContent = t('annotations.reviewPanelWidget.text.pleaseOpenTheOutputPreviewBeforeStarting');
            this.recordingNotice.style.display = 'block';
            return;
        }
        const projectRootUri = location.root.normalizePath().toString();
        window.dispatchEvent(new CustomEvent(
            this.reviewSessionState?.active ? REVIEW_SESSION_STOP_EVENT : REVIEW_SESSION_START_EVENT,
            { detail: { projectRootUri, editUri } }
        ));
    }

    protected openSessionsFolder(): void {
        const location = this.model.location;
        if (!location) {
            return;
        }
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_OPEN_FOLDER_EVENT, {
            detail: {
                projectRootUri: location.root.normalizePath().toString(),
                editUri: location.editUri?.normalizePath().toString()
            }
        }));
    }

    protected renderList(): void {
        this.requestMissingUiTargetLabels();
        // 一覧が再描画されるたびに劣化状態を再確認する（ファイルのリネーム・差し替えを
        // ライブセッション中に検知できるよう、レンダーパスをまたいでキャッシュしない）。
        this.docTargetHealthCache.clear();
        const containerTop = this.listContainer.getBoundingClientRect().top;
        const anchor = captureReviewScrollAnchor(
            readReviewScrollRows(this.listContainer, 'data-annotation-row', 'data-annotation-undo'),
            containerTop, this.listContainer.scrollTop
        );
        this.listContainer.replaceChildren();
        const pending = pendingAnnotationHandoff(this.model.annotations, this.sentAnnotationIds);
        this.batchBar.replaceChildren();
        const batchLabel = document.createElement('span');
        batchLabel.textContent = t('annotations.reviewPanelWidget.text.pendingHandoff', { count: pending.length });
        this.batchButton.disabled = pending.length === 0;
        this.batchBar.append(batchLabel, this.batchButton);
        const annotationsById = new Map(this.model.filtered().map(annotation => [annotation.id, annotation]));
        for (const { annotation } of this.pendingUndo.values()) {
            annotationsById.set(annotation.id, annotation);
        }
        const filtered = [...annotationsById.values()].sort(
            (left, right) => (left.sourceT ?? Infinity) - (right.sourceT ?? Infinity)
        );
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = this.model.annotations.length === 0
                ? t('annotations.reviewPanelWidget.text.thereAreNoAnnotationsYet')
                : t('annotations.reviewPanelWidget.text.thereAreNoCorrespondingNotes');
            empty.style.color = 'var(--theia-descriptionForeground)';
            empty.style.padding = '8px 2px';
            this.listContainer.appendChild(empty);
            this.restoreListScroll(anchor);
            return;
        }
        for (const annotation of filtered) {
            this.listContainer.appendChild(this.pendingUndo.has(annotation.id)
                ? this.renderUndoRow(annotation)
                : this.renderAnnotationRow(annotation));
        }
        this.restoreListScroll(anchor);
    }

    protected restoreListScroll(anchor: ReviewScrollAnchor | undefined): void {
        this.listContainer.scrollTop = restoreReviewScrollTop(
            anchor,
            readReviewScrollRows(this.listContainer, 'data-annotation-row', 'data-annotation-undo'),
            this.listContainer.getBoundingClientRect().top,
            this.listContainer.scrollTop,
            this.listContainer.scrollHeight - this.listContainer.clientHeight
        );
    }

    protected renderUndoRow(annotation: Annotation): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-review-row akari-review-row-undo';
        row.setAttribute('data-annotation-undo', annotation.id);
        Object.assign(row.style, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 6px',
            borderBottom: '1px solid var(--theia-widget-border)'
        });
        const message = document.createElement('span');
        message.textContent = t('annotations.reviewPanelWidget.text.iDeletedIt');
        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.className = 'theia-button secondary';
        undoButton.textContent = t('annotations.reviewPanelWidget.text.undo');
        undoButton.addEventListener('click', () => void this.undoDeleteAnnotation(annotation.id));
        row.append(message, undoButton);
        return row;
    }

    protected requestMissingUiTargetLabels(): void {
        const targets = this.model.annotations.map(annotation => annotation.target);
        if (!needsUiTargetLabels(targets, this.uiTargetLabels)) {
            this.lastUiTargetLabelsRequest = '';
            return;
        }
        const request = JSON.stringify(targets.filter(target => typeof target === 'string').sort());
        if (request === this.lastUiTargetLabelsRequest) return;
        this.lastUiTargetLabelsRequest = request;
        const editUri = this.model.location?.editUri?.normalizePath().toString();
        window.dispatchEvent(new CustomEvent(CLIP_ANNOTATION_LABELS_REQUEST_EVENT, {
            detail: { ...(editUri ? { editUri } : {}) }
        }));
    }

    protected renderAnnotationRow(annotation: Annotation): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-review-row';
        row.setAttribute('data-annotation-row', annotation.id);
        Object.assign(row.style, {
            display: 'grid', gap: '6px', padding: '9px', border: '1px solid var(--theia-widget-border)', borderRadius: '7px', marginBottom: '7px', fontSize: '12px'
        });
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' });
        const docTarget = parseDocTarget(annotation.target);
        const imageTarget = parseImageTarget(annotation.target);
        const canvasTarget = parseCanvasTarget(annotation.target);
        // M3 (task.md 指示2): ui: target は doc:/image:/canvas: と違い sourceT が実数（選択時の
        // 再生位置）のため、既存の時刻ジャンプボタンはそのまま出しつつ、対象要素の id ラベルを添える。
        const uiTarget = parseUiTarget(annotation.target);
        if (docTarget) {
            head.appendChild(this.renderDocTargetButton(docTarget));
        } else if (imageTarget) {
            head.appendChild(this.renderImageTargetButton(imageTarget, annotation.strokes));
        } else if (canvasTarget) {
            head.appendChild(this.renderCanvasTargetButton(canvasTarget, annotation.strokes));
        } else {
            const time = document.createElement('button');
            time.type = 'button';
            time.textContent = this.formatTimestamp(annotation.sourceT);
            time.title = t('annotations.reviewPanelWidget.text.jumpToThisTime');
            Object.assign(time.style, {
                fontVariantNumeric: 'tabular-nums', background: 'none', border: 'none', padding: '0',
                color: 'var(--theia-textLink-foreground)', cursor: 'pointer', font: 'inherit'
            });
            time.addEventListener('click', () => this.model.requestSeek(annotation.sourceT ?? 0));
            head.appendChild(time);
            if (uiTarget) {
                head.appendChild(this.renderUiTargetLabel(uiTarget));
            } else if (annotation.target) {
                const target = document.createElement('span');
                target.textContent = annotation.target;
                target.style.color = 'var(--theia-descriptionForeground)';
                head.appendChild(target);
            }
        }
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, {
            color: STATUS_COLORS[annotation.status], fontSize: '11px',
            border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px'
        });
        head.appendChild(badge);
        if (this.sentAnnotationIds.has(annotation.id)) {
            const sentBadge = document.createElement('span');
            sentBadge.textContent = t('annotations.reviewPanelWidget.text.sent');
            sentBadge.setAttribute('data-sent-annotation', annotation.id);
            Object.assign(sentBadge.style, {
                color: 'var(--theia-descriptionForeground)', fontSize: '11px',
                border: '1px solid var(--theia-widget-border)', borderRadius: '999px', padding: '0 8px'
            });
            head.insertBefore(sentBadge, badge);
        }
        const richStrokes = replayableAnnotationStrokes(annotation.strokes);
        if (richStrokes.length > 0) {
            const strokeButton = document.createElement('button');
            strokeButton.type = 'button';
            strokeButton.appendChild(this.createPenIcon());
            strokeButton.title = t('annotations.reviewPanelWidget.text.showPenDrawing');
            strokeButton.setAttribute('aria-label', t('annotations.reviewPanelWidget.text.showPenDrawing'));
            Object.assign(strokeButton.style, {
                background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit', color: '#ff8a1f'
            });
            strokeButton.addEventListener('click', () => {
                const editUri = this.model.location?.editUri?.normalizePath().toString();
                if (!editUri) {
                    return;
                }
                window.dispatchEvent(new CustomEvent(REVIEW_ANNOTATION_SHOW_STROKES_EVENT, {
                    detail: {
                        editUri,
                        sourceT: annotation.sourceT,
                        strokes: richStrokes
                    }
                }));
            });
            head.insertBefore(strokeButton, head.children[1] ?? badge);
        }
        const origin = sessionIdForAnnotation(annotation, this.reviewSessionState?.sessions ?? []);
        if (origin) {
            const source = document.createElement('span');
            source.textContent = t('annotations.reviewPanelWidget.text.fromRecording', { name: formatRecordingName(origin) });
            source.style.color = 'var(--theia-descriptionForeground)';
            head.insertBefore(source, badge);
        }
        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px', justifyContent: 'flex-end' });
        const deleteButton = this.trashButton(() => void this.deleteAnnotationById(annotation.id));
        deleteButton.setAttribute('data-delete-button', annotation.id);
        actions.appendChild(deleteButton);
        if (annotation.status === 'addressed') {
            const resolveButton = document.createElement('button');
            resolveButton.type = 'button';
            resolveButton.className = 'theia-button secondary';
            resolveButton.textContent = t('annotations.reviewPanelWidget.text.markAsConfirmed');
            resolveButton.setAttribute('data-resolve-button', annotation.id);
            resolveButton.addEventListener('click', () => void this.resolveAnnotationById(annotation.id));
            actions.appendChild(resolveButton);
        }
        if (annotation.status === 'open') {
            const sendButton = document.createElement('button');
            sendButton.type = 'button';
            sendButton.className = 'theia-button main';
            sendButton.textContent = t('annotations.reviewPanelWidget.text.handToAi');
            sendButton.setAttribute('data-send-button', annotation.id);
            sendButton.addEventListener('click', () => void this.sendAnnotationToAgent(annotation));
            actions.appendChild(sendButton);
        }
        const text = document.createElement('div');
        text.textContent = annotation.text;
        text.style.whiteSpace = 'pre-wrap';
        row.append(head, text);
        if (annotation.response) {
            const response = document.createElement('div');
            response.style.color = 'var(--theia-descriptionForeground)';
            response.style.fontSize = '12px';
            response.textContent = t('annotations.reviewPanelWidget.text.correspondence', { action: annotation.response.action === 'edited' ? t('annotations.reviewPanelWidget.response.edited') : t('annotations.reviewPanelWidget.response.skipped'), summary: annotation.response.summary });
            row.appendChild(response);
        }
        row.appendChild(actions);
        return row;
    }

    /** ui:timeline:* はタイムラインが公開した表示名を使い、該当クリップへのクリック導線を持つ。 */
    protected renderUiTargetLabel(uiTarget: { id: string }): HTMLElement {
        const row = buildUiTargetRow(uiTarget.id, this.uiTargetLabels);
        const label = document.createElement(row.revealable ? 'button' : 'span');
        if (label instanceof HTMLButtonElement) label.type = 'button';
        label.setAttribute('data-review-ui-target', uiTarget.id);
        label.textContent = `🎛️ ${row.label}`;
        label.title = row.revealable ? t('annotations.reviewPanelWidget.text.clickToSelectTheClip', { name: row.title }) : row.title;
        Object.assign(label.style, {
            fontSize: '11px',
            color: row.revealable ? 'var(--theia-textLink-foreground)' : 'var(--theia-descriptionForeground)',
            ...(row.revealable ? { background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit' } : {})
        });
        if (row.revealable) label.addEventListener('click', () => {
            const editUri = this.model.location?.editUri?.normalizePath().toString();
            if (editUri) window.dispatchEvent(new CustomEvent(CLIP_ANNOTATION_REVEAL_EVENT, {
                detail: { editUri, target: uiTarget.id }
            }));
        });
        return label;
    }

    /**
     * doc: target 注釈のクリック導線（L1 受け入れ条件 3）: レポートタブを開き（未オープンなら
     * 開く）、対象ブロックへスクロール + ピン表示させるメッセージを webview へ送る。
     * 劣化規約（契約 §6）: path 不在は warning 付きボタン、block-id 消失は「対象消失」表示に
     * するが、いずれも注釈自体は一覧から消さない。
     */
    protected renderDocTargetButton(docTarget: { path: string; blockId: string }): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-review-doc-target', `${docTarget.path}#${docTarget.blockId}`);
        button.textContent = `📄 ${this.reportBaseName(docTarget.path)}`;
        button.title = t('annotations.reviewPanelWidget.text.clickToOpenReport', { path: docTarget.path, blockId: docTarget.blockId });
        Object.assign(button.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            color: 'var(--theia-textLink-foreground)'
        });
        button.addEventListener('click', () => void this.openReportAndReveal(docTarget));
        void this.docTargetHealth(docTarget.path, docTarget.blockId).then(health => {
            if (!button.isConnected) {
                return;
            }
            if (health === 'path-missing') {
                button.title = t('annotations.reviewPanelWidget.text.notFoundPinningNotPossibleAnnotationItself', { path: docTarget.path });
                button.textContent = `📄⚠️ ${this.reportBaseName(docTarget.path)}`;
            } else if (health === 'block-missing') {
                const lost = document.createElement('span');
                lost.textContent = t('annotations.reviewPanelWidget.text.targetDisappears');
                lost.title = t('annotations.reviewPanelWidget.text.blockIdIsMissingFromCurrentReport', { blockId: docTarget.blockId });
                Object.assign(lost.style, { color: AKARI_WARNING_TEXT_COLOR, fontSize: '11px', marginLeft: '4px' });
                button.after(lost);
            }
        });
        return button;
    }

    /** report.html を開き（既存タブを再利用）、対象ブロックへスクロール + ピン表示させる。 */
    protected async openReportAndReveal(docTarget: { path: string; blockId: string }): Promise<void> {
        const location = this.model.location;
        if (!location) {
            return;
        }
        const reportUri = location.root.resolve(docTarget.path);
        try {
            const opened = await open(this.openerService, reportUri);
            if (opened instanceof WebviewWidget) {
                opened.sendMessage({ type: 'akari-doc-annotation-reveal', blockId: docTarget.blockId });
            }
        } catch (error) {
            this.messages.error(t('annotations.reviewPanelWidget.text.unableToOpenReport', { reason: this.errorMessage(error) }));
        }
    }

    /**
     * image: target 注釈のクリック導線（契約 §4-2・受け入れ条件 3）: ポップアップを再表示し、
     * strokes を静止描画する（揮発しない）。劣化規約（契約 §6）: path 不在は warning 付き
     * ボタンにし、再表示のみ不可にする（注釈自体は一覧から消さない）。
     */
    protected renderImageTargetButton(
        imageTarget: { path: string }, strokes: Annotation['strokes']
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-review-image-target', imageTarget.path);
        button.textContent = `🖼️ ${this.reportBaseName(imageTarget.path)}`;
        button.title = t('annotations.reviewPanelWidget.text.redisplayPopupOnClick', { path: imageTarget.path });
        Object.assign(button.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            fontSize: '11px', color: 'var(--theia-textLink-foreground)'
        });
        button.addEventListener('click', () => void this.openImageAnnotationPopup(imageTarget.path, strokes));
        void this.imageTargetHealth(imageTarget.path).then(health => {
            if (!button.isConnected) {
                return;
            }
            if (health === 'path-missing') {
                button.title = t('annotations.reviewPanelWidget.text.notFoundCannotBeDisplayedAgainAnnotation', { path: imageTarget.path });
                button.textContent = `🖼️⚠️ ${this.reportBaseName(imageTarget.path)}`;
                button.style.color = 'var(--theia-descriptionForeground)';
            }
        });
        return button;
    }

    /** image: target のファイルが実在するかを path ごとにキャッシュして確認する。 */
    protected async imageTargetHealth(path: string): Promise<ImageTargetHealth> {
        const location = this.model.location;
        if (!location) {
            return 'path-missing';
        }
        return await this.fileService.exists(location.root.resolve(path)) ? 'ok' : 'path-missing';
    }

    protected async openImageAnnotationPopup(path: string, strokes: Annotation['strokes']): Promise<void> {
        const location = this.model.location;
        if (!location) {
            return;
        }
        const imageUri = location.root.resolve(path);
        if (!await this.fileService.exists(imageUri)) {
            this.messages.warn(t('annotations.reviewPanelWidget.text.thePopupCannotBeRedisplayedBecauseIs', { path: path }));
            return;
        }
        const imageRectStrokes = (strokes ?? []).filter(
            (stroke): stroke is Extract<AnnotationStroke, { space: 'image-rect' }> => stroke.space === 'image-rect'
        );
        const dialog = new AkariImageAnnotationDialog(
            { title: t('annotations.reviewPanelWidget.text.imageAnnotation'), mode: 'view', imageUri, relativePath: path, existingStrokes: imageRectStrokes, maxWidth: 960 },
            this.fileService,
            this.model
        );
        await dialog.open();
    }

    /**
     * canvas: target 注釈のクリック導線（contract-2026-07-26-canvas-surface §5・受け入れ条件 4）:
     * キャンバスを view モードで再表示する（背景 + strokes 静止）。劣化規約（同契約 §6）:
     * ディレクトリ不在は warning 付きボタンにし、再表示のみ不可にする（注釈自体は一覧から消さない）。
     */
    protected renderCanvasTargetButton(
        canvasTarget: { id: string }, strokes: Annotation['strokes']
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-review-canvas-target', canvasTarget.id);
        button.textContent = `🎨 ${canvasTarget.id}`;
        button.title = t('annotations.reviewPanelWidget.text.refreshCanvasOnClick', { id: canvasTarget.id });
        Object.assign(button.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            fontSize: '11px', color: 'var(--theia-textLink-foreground)'
        });
        button.addEventListener('click', () => void this.openCanvasViewPopup(canvasTarget.id, strokes));
        void this.canvasTargetHealth(canvasTarget.id).then(health => {
            if (!button.isConnected) {
                return;
            }
            if (health === 'dir-missing') {
                button.title = t('annotations.reviewPanelWidget.text.reviewCanvasNotFoundCannotBeDisplayed', { id: canvasTarget.id });
                button.textContent = `🎨⚠️ ${canvasTarget.id}`;
                button.style.color = 'var(--theia-descriptionForeground)';
            }
        });
        return button;
    }

    /** canvas: target のディレクトリ（canvas.json）が実在するかを確認する。 */
    protected async canvasTargetHealth(id: string): Promise<CanvasTargetHealth> {
        const location = this.model.location;
        if (!location) {
            return 'dir-missing';
        }
        return await this.fileService.exists(location.root.resolve(`review/canvas/${id}/canvas.json`))
            ? 'ok' : 'dir-missing';
    }

    protected async openCanvasViewPopup(id: string, embeddedStrokes: Annotation['strokes']): Promise<void> {
        const location = this.model.location;
        if (!location) {
            return;
        }
        const canvasJsonUri = location.root.resolve(`review/canvas/${id}/canvas.json`);
        if (!await this.fileService.exists(canvasJsonUri)) {
            this.messages.warn(t('annotations.reviewPanelWidget.text.theCanvasCannotBeRefreshedBecauseReview', { id: id }));
            return;
        }
        let aspect = { w: 1920, h: 1080 };
        let backgroundRef: string | undefined;
        try {
            const manifest = JSON.parse((await this.fileService.readFile(canvasJsonUri)).value.toString()) as {
                aspect?: { w?: unknown; h?: unknown };
                background?: { ref?: unknown } | null;
            };
            if (manifest?.aspect && typeof manifest.aspect.w === 'number' && typeof manifest.aspect.h === 'number'
                && manifest.aspect.w > 0 && manifest.aspect.h > 0) {
                aspect = { w: manifest.aspect.w, h: manifest.aspect.h };
            }
            if (manifest?.background && typeof manifest.background.ref === 'string') {
                backgroundRef = manifest.background.ref;
            }
        } catch (error) {
            console.warn('[akari-annotations] canvas.json を読めません', error);
        }

        let backgroundUri: URI | undefined;
        let backgroundWarning: string | undefined;
        if (backgroundRef) {
            const candidate = location.root.resolve(backgroundRef);
            if (await this.fileService.exists(candidate)) {
                backgroundUri = candidate;
            } else {
                // 契約 §6: background の ref が存在しない → strokes だけで表示（warning）。
                backgroundWarning = t('annotations.reviewPanelWidget.text.onlyThePenDrawingIsDisplayedBecause', { reference: backgroundRef });
            }
        }

        const existingStrokes = await this.readCanvasStrokes(
            location.root.resolve(`review/canvas/${id}/strokes.json`), embeddedStrokes
        );

        const dialog = new AkariCanvasDialog(
            {
                title: t('annotations.reviewPanelWidget.text.displayCanvas', { id: id }), mode: 'view', aspect, backgroundUri, backgroundWarning,
                existingStrokes, maxWidth: 1200
            },
            this.fileService,
            this.model,
            this.fileDialogService
        );
        await dialog.open();
    }

    /**
     * strokes.json 原本（フル精度）を読む。壊れている/無い場合は review.json に埋め込まれた
     * 間引き済みストロークへフォールバックする（再表示自体は止めない）。
     */
    protected async readCanvasStrokes(
        strokesUri: URI, embeddedStrokes: Annotation['strokes']
    ): Promise<Array<ReadonlyArray<readonly [number, number]>>> {
        try {
            const parsed = JSON.parse((await this.fileService.readFile(strokesUri)).value.toString()) as {
                version?: unknown;
                strokes?: Array<{ points?: unknown }>;
            };
            if (parsed?.version === 1 && Array.isArray(parsed.strokes)) {
                const strokes = parsed.strokes
                    .map(stroke => stroke.points)
                    .filter((points): points is [number, number][] => Array.isArray(points) && points.length >= 2);
                if (strokes.length > 0) {
                    return strokes;
                }
            }
        } catch {
            // strokes.json が読めない場合は下の embedded フォールバックへ。
        }
        return (embeddedStrokes ?? [])
            .filter((stroke): stroke is Extract<AnnotationStroke, { space: 'canvas-rect' }> => stroke.space === 'canvas-rect')
            .map(stroke => stroke.points);
    }

    /**
     * report.html を直接読み、blocks マニフェストに block-id が含まれるかを確認する
     * （webview が開いているかどうかに依存しない・path ごとに読み取り結果をキャッシュする）。
     */
    protected async docTargetHealth(path: string, blockId: string): Promise<DocTargetHealth> {
        const location = this.model.location;
        if (!location) {
            return 'path-missing';
        }
        const uri = location.root.resolve(path);
        const cacheKey = uri.toString();
        let cached = this.docTargetHealthCache.get(cacheKey);
        if (!cached) {
            cached = this.readBlocksManifest(uri);
            this.docTargetHealthCache.set(cacheKey, cached);
        }
        const manifest = await cached;
        if (manifest === undefined) {
            return 'path-missing';
        }
        return collectBlockIds(manifest).has(blockId) ? 'ok' : 'block-missing';
    }

    protected async readBlocksManifest(uri: URI): Promise<unknown | undefined> {
        try {
            if (!(await this.fileService.exists(uri))) {
                return undefined;
            }
            const source = (await this.fileService.readFile(uri)).value.toString();
            return extractBlocksManifest(source);
        } catch {
            return undefined;
        }
    }

    /** タイムラインのピンから呼ばれる。該当行が絞り込みで隠れている場合は絞り込みを解除する。 */
    protected revealAnnotation(annotationId: string): void {
        const target = this.model.annotations.find(annotation => annotation.id === annotationId);
        if (target && this.model.statusFilter !== 'all' && target.status !== this.model.statusFilter) {
            this.model.statusFilter = 'all';
        }
        const row = this.listContainer.querySelector<HTMLDivElement>(`[data-annotation-row="${CSS.escape(annotationId)}"]`);
        if (!row) {
            return;
        }
        row.scrollIntoView({ block: 'nearest' });
        this.listContainer.querySelectorAll('.akari-review-row-revealed').forEach(
            highlighted => highlighted.classList.remove('akari-review-row-revealed')
        );
        row.classList.add('akari-review-row-revealed');
    }

    protected revealReviewSession(sessionId: string | undefined): void {
        if (!sessionId) return;
        const row = this.sessionList.querySelector<HTMLElement>(
            `[data-review-session="${CSS.escape(sessionId)}"]`
        );
        if (!row) return;
        row.scrollIntoView({ block: 'nearest' });
        this.node.querySelectorAll('.akari-review-row-revealed').forEach(
            highlighted => highlighted.classList.remove('akari-review-row-revealed')
        );
        row.classList.add('akari-review-row-revealed');
    }

    protected async submitAnnotation(): Promise<void> {
        const text = this.textInput.value.trim();
        if (!text) {
            return;
        }
        if (!this.model.location) {
            this.showNotice(t('annotations.reviewPanelWidget.text.unableToIdentifyProjectPleaseOpenThe'));
            return;
        }
        const docSelection = this.model.docSelection;
        const clipSelection = docSelection ? undefined : this.clipAnnotationSelection;
        const uiSelection = docSelection || clipSelection ? undefined : this.reviewSessionState?.selectedUiTarget;
        this.addButton.disabled = true;
        try {
            // 解決中の古い selection を捕まえず、クリック時点の最新 activation の確定を待つ。
            const rawSelection = docSelection || clipSelection || uiSelection
                ? undefined
                : await this.currentRawSourceSelection();
            await (docSelection
                ? this.model.addDocAnnotation(text, docSelection)
                : clipSelection
                    ? this.model.addUiAnnotation(text, clipSelection.sourceT, clipSelection.target)
                    : uiSelection
                        ? this.model.addUiAnnotation(text, this.model.selectedSourceT, uiSelection.target)
                        : rawSelection
                            ? this.model.addAnnotation(text, rawSelection.sourceT, rawSelection.src)
                            : this.model.addAnnotation(text, this.model.selectedSourceT));
            this.textInput.value = '';
            // 送信後は選択を解除する（同じブロックへ連続で誤って追加しないため）。
            if (docSelection) {
                this.model.docSelection = undefined;
            } else if (clipSelection) {
                this.clearClipAnnotationSelection();
            } else if (uiSelection) {
                this.clearUiSelection();
            }
            this.hideNotice();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(t('annotations.reviewPanelWidget.text.unableToAddAnnotation', { reason: detail }));
            this.messages.error(t('annotations.reviewPanelWidget.text.unableToAddAnnotation', { reason: detail }));
        } finally {
            this.addButton.disabled = false;
        }
    }

    protected async handPrompt(prompt: string, subject: string): Promise<'typed' | 'unsupported' | 'no-partner' | 'copied'> {
        return handPromptToPartner(prompt, subject, {
            typePrompt: text => this.commands.executeCommand('akari.partner.typePrompt', text),
            copy: text => navigator.clipboard.writeText(text),
            notify: async (message, action) => {
                if (action) {
                    const selected = await this.messages.info(message, action);
                    return selected === action;
                } else {
                    void this.messages.info(message);
                }
            },
            openPartner: () => this.commands.executeCommand('akari.partner.open')
        });
    }

    protected async compileLatestSession(sessionId?: string): Promise<void> {
        const plan = planCompileHandoff(this.reviewSessionState?.sessions ?? [], sessionId);
        if (plan.kind === 'notice') { this.showNotice(plan.notice); return; }
        const result = await this.handPrompt(plan.prompt, formatRecordingName(plan.sessionId));
        if (result === 'typed' || result === 'unsupported') {
            this.handedSessionIds.add(plan.sessionId);
            this.renderRecordingSection();
        }
    }

    protected async sendPendingAnnotations(): Promise<void> {
        const pending = pendingAnnotationHandoff(this.model.annotations, this.sentAnnotationIds);
        if (!pending.length) return;
        await handPendingAnnotations(this.model.annotations, this.sentAnnotationIds, {
            hand: prompt => this.handPrompt(prompt, t('annotations.reviewPanelWidget.text.batchSubject', {
                count: pending.length, n: pending.length
            })),
            markSent: id => this.markAnnotationSent(id)
        });
    }

    protected createPenIcon(): SVGSVGElement {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '14');
        icon.setAttribute('height', '14');
        icon.setAttribute('viewBox', '0 0 16 16');
        icon.setAttribute('aria-hidden', 'true');
        icon.style.color = '#ff8a1f';
        icon.innerHTML = '<path fill="currentColor" d="M11.8 1.2 14.8 4.2 5 14l-4 1 1-4zM3 11.7l1.3 1.3 8.7-8.7-1.3-1.3z"/>';
        return icon;
    }

    protected trashButton(action: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        Object.assign(button.style, { minWidth: '0', width: '28px', height: '28px', padding: '0' });
        button.innerHTML = '<span class="codicon codicon-trash" aria-hidden="true"></span>';
        button.title = t('annotations.reviewPanelWidget.text.delete');
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', action);
        return button;
    }

    protected queueSessionDelete(id: string): void {
        const projectRootUri = this.model.location?.root.normalizePath().toString();
        if (!projectRootUri || this.pendingSessionDeletes.has(id)) return;
        const timer = setTimeout(() => { void this.commitSessionDelete(id); }, ANNOTATION_UNDO_TIMEOUT_MS);
        this.pendingSessionDeletes.set(id, { timer, projectRootUri });
        this.renderRecordingSection();
    }

    protected undoSessionDelete(id: string): void {
        const entry = this.pendingSessionDeletes.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pendingSessionDeletes.delete(id);
        this.renderRecordingSection();
    }

    protected async commitSessionDelete(id: string): Promise<void> {
        const entry = this.pendingSessionDeletes.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pendingSessionDeletes.delete(id);
        try {
            const removed = await this.previewService.deleteReviewSession({ projectRootUri: entry.projectRootUri, sessionId: id });
            if (removed) this.hideNotice();
            else {
                const message = t('annotations.reviewPanelWidget.text.recordingNotFound');
                this.showNotice(message);
                this.messages.error(message);
            }
            const state = this.reviewSessionState;
            const location = this.model.location;
            if (state && location?.root.normalizePath().toString() === entry.projectRootUri) {
                state.sessions = state.sessions.filter(session => session.id !== id);
                this.renderRecordingSection();
                window.dispatchEvent(new CustomEvent(REVIEW_SESSION_REFRESH_EVENT, {
                    detail: {
                        projectRootUri: entry.projectRootUri,
                        editUri: location.editUri?.normalizePath().toString()
                    }
                }));
            }
        } catch (error) {
            const message = t('annotations.reviewPanelWidget.text.cannotDelete', { reason: this.errorMessage(error) });
            this.showNotice(message);
            this.messages.error(message);
            this.renderRecordingSection();
        }
    }

    protected flushSessionDeletes(): void {
        for (const id of [...this.pendingSessionDeletes.keys()]) void this.commitSessionDelete(id);
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        try {
            await this.model.resolveAnnotation(id);
            this.hideNotice();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(t('annotations.reviewPanelWidget.text.cannotUpdate', { reason: detail }));
            this.messages.error(t('annotations.reviewPanelWidget.text.cannotUpdate', { reason: detail }));
        }
    }

    protected async deleteAnnotationById(id: string): Promise<void> {
        const existing = this.model.annotations.find(annotation => annotation.id === id);
        if (!existing) {
            return;
        }
        const timer = setTimeout(() => {
            this.pendingUndo.delete(id);
            this.renderList();
        }, ANNOTATION_UNDO_TIMEOUT_MS);
        this.pendingUndo.set(id, { annotation: existing, timer });
        try {
            await this.model.deleteAnnotation(id);
            this.hideNotice();
        } catch (error) {
            clearTimeout(timer);
            this.pendingUndo.delete(id);
            this.renderList();
            const detail = this.errorMessage(error);
            this.showNotice(t('annotations.reviewPanelWidget.text.cannotDelete', { reason: detail }));
        }
    }

    protected async undoDeleteAnnotation(id: string): Promise<void> {
        const entry = this.pendingUndo.get(id);
        if (!entry) {
            return;
        }
        clearTimeout(entry.timer);
        this.pendingUndo.delete(id);
        try {
            await this.model.restoreAnnotation(entry.annotation);
            this.hideNotice();
        } catch (error) {
            const timer = setTimeout(() => {
                this.pendingUndo.delete(id);
                this.renderList();
            }, ANNOTATION_UNDO_TIMEOUT_MS);
            this.pendingUndo.set(id, { annotation: entry.annotation, timer });
            const detail = this.errorMessage(error);
            this.showNotice(t('annotations.reviewPanelWidget.text.irreversible', { reason: detail }));
        } finally {
            this.renderList();
        }
    }

    protected syncSentAnnotationsForLocation(): void {
        const reviewUri = this.model.location?.reviewUri.toString() ?? '';
        if (reviewUri === this.sentAnnotationsReviewUri) {
            return;
        }
        for (const { timer } of this.pendingUndo.values()) {
            clearTimeout(timer);
        }
        this.pendingUndo.clear();
        this.sentAnnotationsReviewUri = reviewUri;
        this.sentAnnotationIds = new Set();
        const sequence = ++this.sentAnnotationsLoadSequence;
        if (!reviewUri) {
            return;
        }
        void this.sentStore.read(reviewUri).then(ids => {
            if (sequence !== this.sentAnnotationsLoadSequence || reviewUri !== this.sentAnnotationsReviewUri) {
                return;
            }
            this.sentAnnotationIds = new Set(ids);
            this.renderList();
        });
    }

    protected async markAnnotationSent(id: string): Promise<void> {
        const reviewUri = this.model.location?.reviewUri.toString();
        if (!reviewUri) {
            return;
        }
        await this.sentStore.mark(reviewUri, id);
    }

    protected async sendAnnotationToAgent(annotation: Annotation): Promise<void> {
        await handAnnotation(annotation, this.uiTargetLabels, {
            hand: prompt => this.handPrompt(prompt, t('annotations.reviewPanelWidget.text.annotation')),
            markSent: id => this.markAnnotationSent(id)
        });
    }

    protected showNotice(message: string): void {
        this.notice.setMessage(message);
    }

    protected hideNotice(): void {
        this.notice.clear();
    }

    /** sourceT: null（doc: / image: target）は時刻表示を持たないため縮退させる（契約 §2）。 */
    protected formatTimestamp(value: number | null): string {
        if (value === null) {
            return '--:--:--.---';
        }
        const milliseconds = Math.max(0, Math.round(value * 1000));
        const hours = Math.floor(milliseconds / 3_600_000);
        const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
        const seconds = Math.floor((milliseconds % 60_000) / 1000);
        const fraction = milliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
            `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
    }

    protected formatSessionDuration(value: number): string {
        const totalSeconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    protected formatSessionDate(value: string): string {
        const date = new Date(value);
        return Number.isFinite(date.getTime())
            ? formatDate(date, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
            : value;
    }

    protected normalizeUri(value: string): string {
        return value.replace(/\/+$/, '');
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
