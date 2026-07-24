import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Annotation } from '../common/akari-annotations-protocol';
import { OPEN_AKARI_REVIEW_BOARD } from './akari-annotations-commands';
import { AnnotationStatusFilter, ReviewModel } from './review-model';

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

    protected readonly toolbar = document.createElement('div');
    protected readonly openBoardButton = document.createElement('button');
    protected readonly compileButton = document.createElement('button');
    protected readonly filterSelect = document.createElement('select');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly textInput = document.createElement('input');
    protected readonly addButton = document.createElement('button');
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
        this.timeLabel.textContent = this.formatTimestamp(this.model.selectedSourceT);
        this.refreshReviewSessionContext();
        this.renderRecordingSection();
        this.renderList();
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
        const time = document.createElement('button');
        time.type = 'button';
        time.textContent = this.formatTimestamp(annotation.sourceT);
        time.title = 'この時刻へジャンプ';
        Object.assign(time.style, {
            fontVariantNumeric: 'tabular-nums', background: 'none', border: 'none', padding: '0',
            color: 'var(--theia-textLink-foreground)', cursor: 'pointer', font: 'inherit'
        });
        time.addEventListener('click', () => this.model.requestSeek(annotation.sourceT));
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, {
            color: STATUS_COLORS[annotation.status], fontSize: '11px',
            border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px'
        });
        head.append(time, badge);
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
        this.addButton.disabled = true;
        try {
            const result = await this.model.addAnnotation(text, this.model.selectedSourceT);
            this.textInput.value = '';
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

    protected formatTimestamp(value: number): string {
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
