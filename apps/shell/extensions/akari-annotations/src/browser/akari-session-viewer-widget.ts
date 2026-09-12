import URI from '@theia/core/lib/common/uri';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import {
    AkariPreviewService,
    ReadReviewSessionBundleResult,
    ReviewSessionProposalSummary
} from 'akari-preview/lib/common/akari-preview-protocol';
import {
    compileClipboardFailureFooter,
    compileClipboardFailureNotice,
    compileCopiedMessage,
    planCompileHandoff
} from '../common/compile-session-handoff';
import { diffReviewSessionEdit, ReviewSessionEditChangeKind, ReviewSessionEditDiff } from './review-session-diff';
import {
    activeUtteranceIndex,
    resolveSessionTimelineT,
    ReviewSessionTimelineEvent,
    sessionRecDurationSec
} from './review-session-timeline';

// akari-preview-open-handler.ts の同名定数と文字列だけミラーする。
const REVIEW_SESSION_VIEWER_SYNC_EVENT = 'akari.review.session.viewer.sync';

interface ReviewSessionViewerSyncDetail {
    phase: 'attach' | 'tick' | 'detach';
    projectRootUri: string;
    editUri: string;
    sessionId: string;
    recT?: number;
    timelineT?: number;
}

interface SessionRequest {
    projectRootUri: string;
    editUri?: string;
    sessionId: string;
}

const CHANGE_LABELS: Record<ReviewSessionEditChangeKind, string> = {
    added: '追加', removed: '削除', moved: '移動', resized: '尺変更', trimmed: '素材区間'
};

@injectable()
export class AkariSessionViewerWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-session-viewer-widget';

    @inject(AkariPreviewService)
    protected readonly previewService!: AkariPreviewService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    protected request: SessionRequest | undefined;
    protected bundle: ReadReviewSessionBundleResult | undefined;
    protected audio: HTMLAudioElement | undefined;
    protected seek: HTMLInputElement | undefined;
    protected time: HTMLSpanElement | undefined;
    protected play: HTMLButtonElement | undefined;
    protected utteranceRows: HTMLElement[] = [];
    protected animationFrame = 0;
    protected lastTimelineT: number | undefined;
    protected streamId: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AkariSessionViewerWidget.FACTORY_ID;
        this.title.label = 'セッション';
        this.title.caption = '録音セッションを見返す';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-history';
        this.node.classList.add('akari-session-viewer-widget');
        this.node.setAttribute('data-akari-ui', 'panel:session-viewer');
        Object.assign(this.node.style, { overflow: 'auto', padding: '12px', boxSizing: 'border-box' });
    }

    async showSession(request: SessionRequest): Promise<void> {
        this.detachSession();
        this.request = request;
        this.node.replaceChildren(this.notice('読み込み中です。'));
        try {
            const [bundle, sessions] = await Promise.all([
                this.previewService.readReviewSessionBundle({
                    projectRootUri: request.projectRootUri, sessionId: request.sessionId
                }),
                this.previewService.listReviewSessions({ projectRootUri: request.projectRootUri })
            ]);
            let currentText: string | null = null;
            if (request.editUri) {
                try {
                    currentText = (await this.fileService.read(new URI(request.editUri))).value.toString();
                } catch {
                    currentText = null;
                }
            }
            this.bundle = bundle;
            await this.render(bundle, diffReviewSessionEdit(bundle.editSnapshotText, currentText),
                sessions.find(session => session.id === request.sessionId)?.startedAt);
            this.dispatchSync('attach');
        } catch (error) {
            this.node.replaceChildren(this.notice(`セッションを読み込めません: ${this.errorMessage(error)}`));
        }
    }

    protected async render(
        bundle: ReadReviewSessionBundleResult, diff: ReviewSessionEditDiff, startedAt?: string
    ): Promise<void> {
        this.node.replaceChildren();
        const header = document.createElement('h3');
        header.setAttribute('data-viewer-header', '');
        const date = startedAt && Number.isFinite(Date.parse(startedAt))
            ? new Date(startedAt).toLocaleString('ja-JP') : '記録情報なし';
        header.textContent = `${bundle.sessionId} ・ 開始日時: ${date} ・ 録音長 ${this.clock(bundle.audioDurationSec)}`;
        this.node.append(header, await this.renderTransport(bundle), this.renderTranscript(bundle), this.renderDiff(diff));
        const warnings = document.createElement('section');
        warnings.setAttribute('data-viewer-warnings', '');
        if (bundle.warnings.length) {
            const list = document.createElement('ul');
            bundle.warnings.forEach(warning => {
                const item = document.createElement('li');
                item.textContent = warning;
                list.appendChild(item);
            });
            warnings.appendChild(list);
        } else {
            warnings.style.display = 'none';
        }
        this.node.appendChild(warnings);
        this.updateAt(0, false);
    }

    protected async renderTransport(bundle: ReadReviewSessionBundleResult): Promise<HTMLElement> {
        const section = document.createElement('section');
        section.setAttribute('data-viewer-transport', '');
        Object.assign(section.style, { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });
        const play = document.createElement('button');
        play.type = 'button'; play.textContent = '再生'; play.setAttribute('data-viewer-play', '');
        play.setAttribute('aria-pressed', 'false');
        const seek = document.createElement('input');
        seek.type = 'range'; seek.min = '0';
        seek.max = String(Math.max(bundle.audioDurationSec, sessionRecDurationSec(bundle.events)));
        seek.step = '0.01'; seek.value = '0'; seek.setAttribute('data-viewer-seek', '');
        const time = document.createElement('span');
        time.setAttribute('data-viewer-time', '');
        const rate = document.createElement('select');
        rate.setAttribute('data-viewer-rate', '');
        [0.5, 1, 1.5, 2].forEach(value => {
            const option = document.createElement('option');
            option.value = String(value); option.textContent = `${value}×`; option.selected = value === 1;
            rate.appendChild(option);
        });
        const audio = document.createElement('audio');
        audio.preload = 'metadata'; audio.style.display = 'none'; audio.setAttribute('data-viewer-audio', '');
        this.play = play; this.seek = seek; this.time = time; this.audio = audio;
        if (bundle.audioUri) {
            const stream = await this.previewService.createAssetStream({ assetUri: bundle.audioUri });
            audio.src = stream.url;
            this.streamId = stream.id;
        } else {
            play.disabled = seek.disabled = rate.disabled = true;
            const missing = document.createElement('span');
            missing.setAttribute('data-viewer-audio-missing', '');
            missing.textContent = '録音音声（audio.wav）が見つかりません。';
            section.appendChild(missing);
        }
        play.addEventListener('click', () => {
            if (audio.paused) void audio.play(); else audio.pause();
        });
        audio.addEventListener('play', () => { play.textContent = '停止'; play.setAttribute('aria-pressed', 'true'); this.animate(); });
        audio.addEventListener('pause', () => { play.textContent = '再生'; play.setAttribute('aria-pressed', 'false'); this.stopAnimation(); });
        audio.addEventListener('timeupdate', () => this.updateAt(audio.currentTime, true));
        audio.addEventListener('ended', () => this.stopAnimation());
        seek.addEventListener('input', () => {
            audio.currentTime = Number(seek.value);
            this.updateAt(audio.currentTime, true, true);
        });
        rate.addEventListener('change', () => { audio.playbackRate = Number(rate.value); });
        section.append(play, seek, time, rate, audio);
        return section;
    }

    protected renderTranscript(bundle: ReadReviewSessionBundleResult): HTMLElement {
        const section = document.createElement('section');
        section.setAttribute('data-viewer-transcript', '');
        const heading = document.createElement('h4'); heading.textContent = '文字起こし'; section.appendChild(heading);
        this.utteranceRows = [];
        if (bundle.transcript === null) {
            const empty = document.createElement('div'); empty.setAttribute('data-viewer-transcript-empty', '');
            empty.append('コンパイル（文字起こし）がまだです。');
            const compile = document.createElement('button'); compile.type = 'button'; compile.textContent = 'コンパイル';
            compile.setAttribute('data-viewer-compile', ''); compile.addEventListener('click', () => void this.copyCompilePrompt());
            empty.appendChild(compile); section.appendChild(empty); return section;
        }
        bundle.transcript.forEach((segment, index) => {
            const row = document.createElement('div'); row.setAttribute('data-viewer-utterance', String(index));
            Object.assign(row.style, {
                display: 'grid', gridTemplateColumns: '58px 1fr auto', gap: '8px', cursor: 'pointer',
                paddingLeft: '6px', borderBottom: '1px solid var(--theia-widget-border)'
            });
            const at = document.createElement('span'); at.setAttribute('data-viewer-utterance-time', ''); at.textContent = this.clock(segment.start, true);
            const text = document.createElement('span'); text.setAttribute('data-viewer-utterance-text', ''); text.textContent = segment.text;
            const target = document.createElement('span'); target.setAttribute('data-viewer-utterance-target', '');
            const proposal = bundle.proposals?.[index]; target.textContent = this.proposalLabel(proposal);
            if (proposal?.confidence === 'low') row.setAttribute('data-viewer-utterance-low', '');
            row.addEventListener('click', () => {
                if (this.audio) this.audio.currentTime = segment.start;
                this.updateAt(segment.start, true, true);
            });
            row.append(at, text, target); section.appendChild(row); this.utteranceRows.push(row);
        });
        return section;
    }

    protected renderDiff(diff: ReviewSessionEditDiff): HTMLElement {
        const section = document.createElement('section'); section.setAttribute('data-viewer-diff', '');
        const heading = document.createElement('h4'); heading.textContent = '録音時点からの差分'; section.appendChild(heading);
        if (diff.status === 'legacy-snapshot') {
            const row = this.notice(`旧形式（version ${diff.version}）のスナップショットのため差分は出せません。`);
            row.setAttribute('data-viewer-diff-legacy', ''); section.appendChild(row); return section;
        }
        if (diff.status === 'unreadable') {
            const row = this.notice(diff.reason); row.setAttribute('data-viewer-diff-unreadable', ''); section.appendChild(row); return section;
        }
        const counts = Object.fromEntries(Object.keys(CHANGE_LABELS).map(kind => [kind, 0])) as Record<ReviewSessionEditChangeKind, number>;
        diff.changes.forEach(change => { counts[change.kind] += 1; });
        const summary = document.createElement('div'); summary.setAttribute('data-viewer-diff-summary', '');
        summary.textContent = `追加 ${counts.added} / 削除 ${counts.removed} / 移動 ${counts.moved} / `
            + `尺変更 ${counts.resized} / 素材区間 ${counts.trimmed}`;
        section.appendChild(summary);
        if (!diff.changes.length) {
            const empty = this.notice('録音時点から変わっていません。'); empty.setAttribute('data-viewer-diff-empty', '');
            section.appendChild(empty);
        }
        diff.changes.forEach(change => {
            const row = document.createElement('div'); row.setAttribute('data-viewer-diff-row', change.itemId);
            const kind = document.createElement('strong'); kind.setAttribute('data-viewer-diff-kind', ''); kind.textContent = CHANGE_LABELS[change.kind];
            const detail = document.createElement('span'); detail.setAttribute('data-viewer-diff-detail', ''); detail.textContent = `${change.itemId}: ${change.detail}`;
            row.append(kind, ' ', detail); section.appendChild(row);
        });
        return section;
    }

    protected updateAt(recT: number, dispatch: boolean, forceDispatch = false): void {
        if (!this.bundle) return;
        const timelineT = resolveSessionTimelineT(this.bundle.events as ReviewSessionTimelineEvent[], recT);
        if (this.seek) this.seek.value = String(recT);
        if (this.time) this.time.textContent = `録音 ${this.clock(recT, true)} / 出力 ${timelineT === null ? '--' : seconds(timelineT)}`;
        const active = activeUtteranceIndex(this.bundle.transcript ?? [], recT);
        this.utteranceRows.forEach((row, index) => {
            if (index === active) {
                row.setAttribute('data-viewer-utterance-active', '');
                row.style.background = 'var(--theia-list-activeSelectionBackground)';
                row.style.color = 'var(--theia-list-activeSelectionForeground)';
                row.style.borderLeft = '3px solid var(--theia-focusBorder)';
                row.style.fontWeight = '600';
                row.scrollIntoView({ block: 'nearest' });
            } else {
                row.removeAttribute('data-viewer-utterance-active');
                row.style.background = '';
                row.style.color = '';
                row.style.borderLeft = '';
                row.style.fontWeight = '';
            }
        });
        if (dispatch && timelineT !== null && (forceDispatch
            || this.lastTimelineT === undefined || Math.abs(timelineT - this.lastTimelineT) >= 0.02)) {
            this.lastTimelineT = timelineT;
            this.dispatchSync('tick', recT, timelineT);
        }
    }

    protected animate(): void {
        this.stopAnimation();
        const frame = (): void => {
            if (!this.audio || this.audio.paused) return;
            this.updateAt(this.audio.currentTime, true);
            this.animationFrame = window.requestAnimationFrame(frame);
        };
        this.animationFrame = window.requestAnimationFrame(frame);
    }

    protected stopAnimation(): void {
        if (this.animationFrame) window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
    }

    protected dispatchSync(phase: ReviewSessionViewerSyncDetail['phase'], recT?: number, timelineT?: number): void {
        if (!this.request?.editUri) return;
        window.dispatchEvent(new CustomEvent<ReviewSessionViewerSyncDetail>(REVIEW_SESSION_VIEWER_SYNC_EVENT, {
            detail: { phase, projectRootUri: this.request.projectRootUri, editUri: this.request.editUri,
                sessionId: this.request.sessionId, ...(recT === undefined ? {} : { recT }),
                ...(timelineT === undefined ? {} : { timelineT }) }
        }));
    }

    protected async copyCompilePrompt(): Promise<void> {
        if (!this.request) return;
        const plan = planCompileHandoff([{ id: this.request.sessionId, startedAt: '' }], this.request.sessionId);
        if (plan.kind === 'notice') { this.messages.warn(plan.notice); return; }
        try {
            await navigator.clipboard.writeText(plan.prompt);
            void this.messages.info(compileCopiedMessage(plan.prompt), { timeout: 3000 });
        } catch (error) {
            const detail = compileClipboardFailureNotice(this.errorMessage(error));
            this.node.appendChild(this.notice(`${detail} ${compileClipboardFailureFooter(plan.prompt)}`));
        }
    }

    protected proposalLabel(proposal: ReviewSessionProposalSummary | undefined): string {
        if (!proposal) return '対象未解決';
        const target = proposal.target ?? '対象未解決';
        const source = proposal.sourceT === null ? '' : ` / 素材 ${seconds(proposal.sourceT)}`;
        return `${target}${source}${proposal.confidence === 'low' ? '（要確認）' : ''}`;
    }

    protected clock(value: number, decimal = false): string {
        const safe = Math.max(0, value || 0); const minutes = Math.floor(safe / 60); const secondsValue = safe % 60;
        return `${String(minutes).padStart(2, '0')}:${secondsValue.toFixed(decimal ? 1 : 0).padStart(decimal ? 4 : 2, '0')}`;
    }

    protected notice(text: string): HTMLDivElement { const row = document.createElement('div'); row.textContent = text; return row; }
    protected errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

    protected detachSession(): void {
        if (this.request) this.dispatchSync('detach');
        this.audio?.pause(); this.stopAnimation(); this.lastTimelineT = undefined;
        if (this.streamId) void this.previewService.disposeAssetStream(this.streamId).catch(() => undefined);
        this.streamId = undefined;
    }

    protected override onBeforeDetach(message: Message): void {
        this.detachSession();
        super.onBeforeDetach(message);
    }

    override dispose(): void {
        this.detachSession();
        super.dispose();
    }
}

function seconds(value: number): string { return `${value.toFixed(2)}s`; }
