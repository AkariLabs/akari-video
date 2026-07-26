import URI from '@theia/core/lib/common/uri';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget, OpenerService, open } from '@theia/core/lib/browser';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Annotation } from '../common/akari-annotations-protocol';
import { AnnotationStroke } from '../common/annotation-store';
import { collectBlockIds, extractBlocksManifest, parseCanvasTarget, parseDocTarget, parseImageTarget } from '../common/doc-target';
import { AkariCanvasDialog } from './akari-canvas-dialog';
import { AkariImageAnnotationDialog } from './akari-image-annotation-dialog';
import { OPEN_AKARI_REVIEW_BOARD } from './akari-annotations-commands';
import { AnnotationStatusFilter, ReviewModel } from './review-model';

/** doc: target のブロック存在チェック結果（契約 §6 の劣化規約に対応）。 */
type DocTargetHealth = 'ok' | 'path-missing' | 'block-missing';
/** image: target のファイル存在チェック結果（同じく契約 §6。block-id の概念が無い分 doc より単純）。 */
type ImageTargetHealth = 'ok' | 'path-missing';
/** canvas: target のディレクトリ存在チェック結果（contract-2026-07-26-canvas-surface §6）。 */
type CanvasTargetHealth = 'ok' | 'dir-missing';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.BEGIN_ONBOARDING と同一）。
// 「入力欄への投入」に対応する公開 API は無く、送信専用の akari.partner.send しか無いため、
// ここでは送信せずクリップボードコピー + パートナーペインへのフォーカスで代替する
// （task.md の代替実装規約どおり）。
const BEGIN_PARTNER_ONBOARDING_COMMAND_ID = 'akari.partner.beginOnboarding';

// akari-preview 側の同名定数とミラー。extension 間の npm 依存を作らず outer window で連携する。
const REVIEW_SESSION_START_EVENT = 'akari.review.session.start';
const REVIEW_SESSION_STOP_EVENT = 'akari.review.session.stop';
const REVIEW_SESSION_REFRESH_EVENT = 'akari.review.session.refresh';
const REVIEW_SESSION_OPEN_FOLDER_EVENT = 'akari.review.session.openFolder';
const REVIEW_SESSION_STATE_EVENT = 'akari.review.session.state';
const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';

interface ReviewSessionSummary {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationSec: number;
    orphaned: boolean;
}

interface ReviewSessionUiState {
    editUri: string;
    projectRootUri: string;
    status: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
    active: boolean;
    elapsedSec: number;
    level: number;
    silenceWarning: boolean;
    sessions: ReviewSessionSummary[];
    error?: string;
}

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

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    protected readonly toolbar = document.createElement('div');
    protected readonly openBoardButton = document.createElement('button');
    protected readonly compileButton = document.createElement('button');
    protected readonly filterSelect = document.createElement('select');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly docSelectionChip = document.createElement('div');
    protected readonly docSelectionLabel = document.createElement('span');
    protected readonly docSelectionClear = document.createElement('button');
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
    protected readonly openSessionsButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly listContainer = document.createElement('div');
    protected readonly footer = document.createElement('div');
    protected reviewSessionState: ReviewSessionUiState | undefined;
    protected lastReviewSessionContext = '';

    @postConstruct()
    protected init(): void {
        this.id = AkariReviewPanelWidget.FACTORY_ID;
        this.title.label = '注釈';
        this.title.caption = '注釈（レビューコメント）';
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.title.closable = true;
        this.node.classList.add('akari-review-panel-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto auto auto auto minmax(0, 1fr) auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '8px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        const heading = document.createElement('strong');
        heading.textContent = '注釈';
        heading.style.marginRight = 'auto';
        this.filterSelect.setAttribute('aria-label', '状態で絞り込み');
        const filterOptions: Array<[AnnotationStatusFilter, string]> = [
            ['all', 'すべて'], ['open', '未対応'], ['addressed', '対応済み'], ['resolved', '確認済み']
        ];
        for (const [value, label] of filterOptions) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.filterSelect.appendChild(option);
        }
        this.filterSelect.addEventListener('change', () => {
            this.model.statusFilter = this.filterSelect.value as AnnotationStatusFilter;
        });
        this.openBoardButton.type = 'button';
        this.openBoardButton.className = 'theia-button secondary';
        this.openBoardButton.textContent = 'ボードを開く';
        this.openBoardButton.setAttribute('data-review-open-board', '');
        this.openBoardButton.title = 'かんばん形式のレビューボードをタブで開く';
        this.openBoardButton.addEventListener('click', () => void this.commands.executeCommand(OPEN_AKARI_REVIEW_BOARD.id));
        this.toolbar.append(heading, this.filterSelect, this.openBoardButton);

        Object.assign(this.composerRow.style, {
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
            padding: '8px 10px', boxSizing: 'border-box',
            borderBottom: '1px solid var(--theia-widget-border)'
        });
        Object.assign(this.timeLabel.style, {
            fontVariantNumeric: 'tabular-nums', color: 'var(--theia-descriptionForeground)', fontSize: '11px'
        });
        this.timeLabel.title = 'タイムラインをクリックすると、この時刻が変わります。';
        this.docSelectionChip.setAttribute('data-review-doc-selection-chip', '');
        Object.assign(this.docSelectionChip.style, {
            display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px',
            padding: '2px 8px', borderRadius: '999px',
            border: '1px solid var(--theia-textLink-foreground)', color: 'var(--theia-textLink-foreground)'
        });
        this.docSelectionLabel.setAttribute('data-review-doc-selection-label', '');
        this.docSelectionClear.type = 'button';
        this.docSelectionClear.textContent = '✕';
        this.docSelectionClear.title = '選択を解除して動画注釈に戻す';
        this.docSelectionClear.setAttribute('aria-label', 'レポートのブロック選択を解除');
        Object.assign(this.docSelectionClear.style, {
            background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
            color: 'inherit'
        });
        this.docSelectionClear.addEventListener('click', () => { this.model.docSelection = undefined; });
        this.docSelectionChip.append(this.docSelectionLabel, this.docSelectionClear);
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
        this.composerRow.append(this.timeLabel, this.docSelectionChip, this.textInput, this.addButton);

        Object.assign(this.recordingSection.style, {
            display: 'grid', gap: '7px', padding: '9px 10px',
            borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        this.recordingSection.setAttribute('data-review-recording-section', '');
        const recordingHeading = document.createElement('div');
        Object.assign(recordingHeading.style, { display: 'flex', alignItems: 'center', gap: '7px' });
        const recordingTitle = document.createElement('strong');
        recordingTitle.textContent = '録音セッション';
        recordingTitle.style.fontSize = '12px';
        this.recordingIndicator.className = 'akari-review-recording-indicator';
        this.recordingIndicator.textContent = '●';
        this.recordingIndicator.setAttribute('aria-label', '録音停止中');
        Object.assign(this.recordingIndicator.style, { color: 'var(--theia-descriptionForeground)', fontSize: '11px' });
        Object.assign(this.recordingElapsed.style, {
            marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: '12px'
        });
        this.recordingElapsed.textContent = '00:00';
        recordingHeading.append(recordingTitle, this.recordingIndicator, this.recordingElapsed);

        const recordingControls = document.createElement('div');
        Object.assign(recordingControls.style, { display: 'flex', alignItems: 'center', gap: '7px' });
        this.recordingButton.type = 'button';
        this.recordingButton.setAttribute('data-review-recording-toggle', '');
        this.recordingButton.className = 'theia-button main';
        this.recordingButton.textContent = '録音開始';
        this.recordingButton.addEventListener('click', () => this.toggleRecording());
        this.openSessionsButton.type = 'button';
        this.openSessionsButton.setAttribute('data-review-sessions-open', '');
        this.openSessionsButton.className = 'theia-button secondary';
        this.openSessionsButton.textContent = '保存先を開く';
        this.openSessionsButton.addEventListener('click', () => this.openSessionsFolder());
        this.compileButton.type = 'button';
        this.compileButton.setAttribute('data-review-compile', '');
        this.compileButton.className = 'theia-button secondary';
        this.compileButton.textContent = 'コンパイル';
        this.compileButton.title = '最新の録音セッションをコンパイルする定型文をパートナーへ渡す';
        this.compileButton.addEventListener('click', () => void this.compileLatestSession());
        recordingControls.append(this.recordingButton, this.openSessionsButton, this.compileButton);

        this.recordingLevelMeter.setAttribute('data-review-level-meter', '');
        this.recordingLevelMeter.setAttribute('data-review-level', '0');
        this.recordingLevelMeter.setAttribute('role', 'meter');
        this.recordingLevelMeter.setAttribute('aria-label', 'マイク入力レベル');
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
        this.silenceWarningNotice.textContent = '入力が無音です — マイク設定を確認してください';
        Object.assign(this.silenceWarningNotice.style, {
            display: 'none', color: 'var(--theia-warningForeground)', fontSize: '11px', lineHeight: '1.4'
        });
        Object.assign(this.recordingNotice.style, {
            display: 'none', color: 'var(--theia-errorForeground)', fontSize: '11px', lineHeight: '1.4'
        });
        Object.assign(this.sessionList.style, {
            display: 'grid', gap: '3px', maxHeight: '92px', overflow: 'auto', fontSize: '11px'
        });
        this.recordingSection.append(
            recordingHeading,
            recordingControls,
            this.recordingLevelMeter,
            this.silenceWarningNotice,
            this.recordingNotice,
            this.sessionList
        );

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
        this.footer.textContent = 'タイムラインで時刻を選び、ここにコメントを書きます。';

        this.node.append(
            this.toolbar,
            this.composerRow,
            this.recordingSection,
            this.notice,
            this.listContainer,
            this.footer
        );

        const style = document.createElement('style');
        style.textContent = `
    .akari-review-panel-widget .akari-review-row.akari-review-row-revealed {
        background: var(--theia-list-activeSelectionBackground);
        border-radius: 3px;
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

        this.toDispose.push(this.model.onChanged(() => this.render()));
        this.toDispose.push(this.model.onReveal(id => this.revealAnnotation(id)));
        const onReviewSessionState = (event: Event): void => {
            const state = (event as CustomEvent<ReviewSessionUiState>).detail;
            const editUri = this.model.location?.editUri?.normalizePath().toString();
            if (!state || !editUri || this.normalizeUri(state.editUri) !== this.normalizeUri(editUri)) {
                return;
            }
            this.reviewSessionState = state;
            this.renderRecordingSection();
        };
        window.addEventListener(REVIEW_SESSION_STATE_EVENT, onReviewSessionState);
        this.toDispose.push({
            dispose: () => window.removeEventListener(REVIEW_SESSION_STATE_EVENT, onReviewSessionState)
        });
        this.render();
    }

    protected render(): void {
        this.filterSelect.value = this.model.statusFilter;
        this.renderDocSelectionChip();
        this.refreshReviewSessionContext();
        this.renderRecordingSection();
        this.renderList();
    }

    /**
     * レポート側でブロックを選択している間は、その文脈をコンポーザーに出す（指示 3）。
     * 選択中は動画の時刻ではなく doc: target で注釈が作られることを示す。
     */
    protected renderDocSelectionChip(): void {
        const selection = this.model.docSelection;
        if (!selection) {
            this.docSelectionChip.style.display = 'none';
            this.timeLabel.style.display = '';
            this.timeLabel.textContent = this.formatTimestamp(this.model.selectedSourceT);
            this.textInput.placeholder = 'コメントを入力';
            return;
        }
        this.timeLabel.style.display = 'none';
        this.docSelectionChip.style.display = 'inline-flex';
        this.docSelectionLabel.textContent = `📄 ${this.reportBaseName(selection.path)} を選択中`;
        this.docSelectionLabel.title = `${selection.path}#${selection.blockId}`;
        this.textInput.placeholder = 'このブロックについてコメント';
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
        this.recordingButton.disabled = !location?.editUri || busy;
        this.recordingButton.textContent = state?.status === 'starting'
            ? '準備中…'
            : state?.status === 'stopping'
                ? '保存中…'
                : active ? '録音終了' : '録音開始';
        this.recordingButton.className = active ? 'theia-button secondary' : 'theia-button main';
        this.recordingIndicator.classList.toggle('is-recording', active);
        this.recordingIndicator.setAttribute('aria-label', active ? '録音中' : '録音停止中');
        this.recordingElapsed.textContent = this.formatSessionDuration(state?.elapsedSec ?? 0);
        this.compileButton.disabled = !location || (state?.sessions.length ?? 0) === 0;
        const level = active ? Math.max(0, Math.min(1, state?.level ?? 0)) : 0;
        this.recordingLevelMeter.setAttribute('data-review-level', String(level));
        this.recordingLevelMeter.setAttribute('aria-valuenow', String(level));
        this.recordingLevelFill.style.width = `${level * 100}%`;
        this.silenceWarningNotice.style.display = state?.silenceWarning ? 'block' : 'none';
        this.openSessionsButton.disabled = !location;
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
            empty.textContent = '録音済みセッションはありません。';
            empty.style.color = 'var(--theia-descriptionForeground)';
            this.sessionList.appendChild(empty);
            return;
        }
        for (const session of [...sessions].reverse()) {
            const row = document.createElement('div');
            row.setAttribute('data-review-session', session.id);
            Object.assign(row.style, {
                display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                alignItems: 'center', gap: '7px'
            });
            const id = document.createElement('strong');
            id.textContent = session.id;
            const started = document.createElement('span');
            started.textContent = this.formatSessionDate(session.startedAt);
            started.style.color = 'var(--theia-descriptionForeground)';
            started.style.overflow = 'hidden';
            started.style.textOverflow = 'ellipsis';
            started.style.whiteSpace = 'nowrap';
            const duration = document.createElement('span');
            duration.textContent = session.orphaned
                ? `${this.formatSessionDuration(session.durationSec)}・未完了`
                : this.formatSessionDuration(session.durationSec);
            duration.style.fontVariantNumeric = 'tabular-nums';
            if (session.orphaned) {
                duration.style.color = 'var(--theia-warningForeground)';
            }
            row.append(id, started, duration);
            this.sessionList.appendChild(row);
        }
    }

    protected refreshReviewSessionContext(): void {
        const location = this.model.location;
        const editUri = location?.editUri?.normalizePath().toString();
        if (!location || !editUri) {
            this.lastReviewSessionContext = '';
            this.reviewSessionState = undefined;
            return;
        }
        const projectRootUri = location.root.normalizePath().toString();
        const context = `${projectRootUri}\n${editUri}`;
        if (context === this.lastReviewSessionContext) {
            return;
        }
        this.lastReviewSessionContext = context;
        this.reviewSessionState = undefined;
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_REFRESH_EVENT, {
            detail: { projectRootUri, editUri }
        }));
    }

    protected toggleRecording(): void {
        const location = this.model.location;
        const editUri = location?.editUri?.normalizePath().toString();
        if (!location || !editUri) {
            this.recordingNotice.textContent = '出力プレビューを開いてから録音を開始してください。';
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
        // 一覧が再描画されるたびに劣化状態を再確認する（ファイルのリネーム・差し替えを
        // ライブセッション中に検知できるよう、レンダーパスをまたいでキャッシュしない）。
        this.docTargetHealthCache.clear();
        this.listContainer.replaceChildren();
        const filtered = this.model.filtered();
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = this.model.annotations.length === 0
                ? 'まだ注釈はありません。'
                : '該当する注釈はありません。';
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
        row.className = 'akari-review-row';
        row.setAttribute('data-annotation-row', annotation.id);
        Object.assign(row.style, {
            display: 'grid', gap: '4px', padding: '8px 6px', borderBottom: '1px solid var(--theia-widget-border)'
        });
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const docTarget = parseDocTarget(annotation.target);
        const imageTarget = parseImageTarget(annotation.target);
        const canvasTarget = parseCanvasTarget(annotation.target);
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
            time.title = 'この時刻へジャンプ';
            Object.assign(time.style, {
                fontVariantNumeric: 'tabular-nums', background: 'none', border: 'none', padding: '0',
                color: 'var(--theia-textLink-foreground)', cursor: 'pointer', font: 'inherit'
            });
            time.addEventListener('click', () => this.model.requestSeek(annotation.sourceT ?? 0));
            head.appendChild(time);
        }
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, {
            color: STATUS_COLORS[annotation.status], fontSize: '11px',
            border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px'
        });
        head.appendChild(badge);
        // Shared Annotation.strokes is still the legacy point-array type; keep this ready for its future rich shape.
        const candidateStrokes = annotation.strokes as unknown as Array<{
            frame?: unknown;
            points?: unknown;
            sessionRef?: unknown;
        }>;
        const richStrokes = Array.isArray(candidateStrokes)
            ? candidateStrokes.filter((stroke): stroke is {
                frame: { sourceT?: unknown; cutIndex?: unknown };
                points: Array<[number, number]>;
                sessionRef: string;
            } => Boolean(
                stroke
                && typeof stroke === 'object'
                && !Array.isArray(stroke)
                && stroke.frame
                && typeof stroke.frame === 'object'
                && Array.isArray(stroke.points)
                && stroke.points.length >= 2
                && typeof stroke.sessionRef === 'string'
            ))
            : [];
        if (richStrokes.length > 0) {
            const strokeButton = document.createElement('button');
            strokeButton.type = 'button';
            strokeButton.textContent = '✏️';
            strokeButton.title = 'ペン描画を表示';
            strokeButton.setAttribute('aria-label', 'ペン描画を表示');
            Object.assign(strokeButton.style, {
                background: 'none', border: 'none', padding: '0', cursor: 'pointer', font: 'inherit'
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
            head.appendChild(strokeButton);
        }
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
        text.style.whiteSpace = 'pre-wrap';
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
        button.title = `${docTarget.path}#${docTarget.blockId} — クリックでレポートを開く`;
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
                button.title = `${docTarget.path} が見つかりません（ピン表示は不可。注釈自体は有効です）`;
                button.textContent = `📄⚠️ ${this.reportBaseName(docTarget.path)}`;
            } else if (health === 'block-missing') {
                const lost = document.createElement('span');
                lost.textContent = '（対象消失）';
                lost.title = `block-id が現在のレポートにありません: ${docTarget.blockId}`;
                Object.assign(lost.style, { color: 'var(--theia-warningForeground)', fontSize: '11px', marginLeft: '4px' });
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
            this.messages.error(`レポートを開けません: ${this.errorMessage(error)}`);
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
        button.title = `${imageTarget.path} — クリックでポップアップを再表示`;
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
                button.title = `${imageTarget.path} が見つかりません（再表示は不可。注釈自体は有効です）`;
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
            this.messages.warn(`${path} が見つからないため、ポップアップを再表示できません。`);
            return;
        }
        const imageRectStrokes = (strokes ?? []).filter(
            (stroke): stroke is Extract<AnnotationStroke, { space: 'image-rect' }> => stroke.space === 'image-rect'
        );
        const dialog = new AkariImageAnnotationDialog(
            { title: '画像の注釈', mode: 'view', imageUri, relativePath: path, existingStrokes: imageRectStrokes, maxWidth: 960 },
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
        button.title = `${canvasTarget.id} — クリックでキャンバスを再表示`;
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
                button.title = `review/canvas/${canvasTarget.id} が見つかりません（再表示は不可。注釈自体は有効です）`;
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
            this.messages.warn(`review/canvas/${id} が見つからないため、キャンバスを再表示できません。`);
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
                backgroundWarning = `背景画像（${backgroundRef}）が見つからないため、ペン描画のみ表示します。`;
            }
        }

        const existingStrokes = await this.readCanvasStrokes(
            location.root.resolve(`review/canvas/${id}/strokes.json`), embeddedStrokes
        );

        const dialog = new AkariCanvasDialog(
            {
                title: `キャンバスの表示（${id}）`, mode: 'view', aspect, backgroundUri, backgroundWarning,
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

    protected async submitAnnotation(): Promise<void> {
        const text = this.textInput.value.trim();
        if (!text) {
            return;
        }
        if (!this.model.location) {
            this.showNotice('プロジェクトを特定できません。タイムラインを開いてから追加してください。');
            return;
        }
        const docSelection = this.model.docSelection;
        this.addButton.disabled = true;
        try {
            const result = docSelection
                ? await this.model.addDocAnnotation(text, docSelection)
                : await this.model.addAnnotation(text, this.model.selectedSourceT);
            this.textInput.value = '';
            // 送信後は選択を解除する（同じブロックへ連続で誤って追加しないため）。
            if (docSelection) {
                this.model.docSelection = undefined;
            }
            this.hideNotice();
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

    /**
     * 最新の録音セッション id を含む定型文をパートナーへ渡す（task.md §指示3・最小のコンパイル導線）。
     * akari-partner の公開 API には「入力欄へ投入するだけ（送信しない）」ものが無く、
     * `akari.partner.send` は即送信してしまうため、ここでは送信せずクリップボードコピー +
     * `akari.partner.beginOnboarding`（接続済みならペインを表に出すだけ・未接続なら推奨導線を開始）
     * によるフォーカスで代替する。
     */
    protected async compileLatestSession(): Promise<void> {
        const sessions = this.reviewSessionState?.sessions ?? [];
        if (sessions.length === 0) {
            this.showNotice('録音済みセッションがありません。先に録音してください。');
            return;
        }
        const latest = [...sessions].sort((left, right) => {
            const leftOrder = this.sessionSortKey(left);
            const rightOrder = this.sessionSortKey(right);
            return leftOrder === rightOrder
                ? left.startedAt.localeCompare(right.startedAt)
                : leftOrder - rightOrder;
        }).pop();
        if (!latest) {
            return;
        }
        const prompt = `review セッション ${latest.id} をコンパイルして`;
        try {
            await navigator.clipboard.writeText(prompt);
            this.hideNotice();
            this.footer.textContent = `「${prompt}」をクリップボードにコピーしました。パートナーへ貼り付けてください。`;
        } catch (error) {
            this.showNotice(`クリップボードにコピーできません: ${this.errorMessage(error)}`);
        }
        try {
            await this.commands.executeCommand(BEGIN_PARTNER_ONBOARDING_COMMAND_ID);
        } catch (error) {
            console.warn('[akari-annotations] partner focus skipped:', error);
        }
    }

    protected sessionSortKey(session: ReviewSessionSummary): number {
        const match = /^s-(\d+)$/.exec(session.id);
        return match ? Number(match[1]) : 0;
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        try {
            await this.model.resolveAnnotation(id);
            this.hideNotice();
            this.footer.textContent = '注釈を確認済みにしました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`更新できません: ${detail}`);
            this.messages.error(`更新できません: ${detail}`);
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
            ? date.toLocaleString('ja-JP', {
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
