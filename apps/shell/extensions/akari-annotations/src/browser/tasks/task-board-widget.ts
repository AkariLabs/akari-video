import { BaseWidget } from '@theia/core/lib/browser';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { Task } from '../../common/akari-tasks-protocol';
import { availableActions, type TaskAction } from '../../common/task-actions';
import { orderNextTasks } from '../../common/task-order';
import { buildUiTargetRow, parseUiTarget } from '../../common/doc-target';
import { CLIP_ANNOTATION_REVEAL_EVENT } from '../../common/timeline-context-menu-items';
import { ReviewModel } from '../review-model';
import { TaskService } from './task-service';
import { AkariRoughCanvasService } from '../../common/rough-canvas-protocol';

type Column = 'unsent' | 'sent' | 'review' | 'done';
type SourceFilter = 'all' | 'annotation' | 'lint' | 'proposal' | 'export';

const columns: ReadonlyArray<{ state: Column; title: string }> = [
    { state: 'unsent', title: '未送信' },
    { state: 'sent', title: '送った' },
    { state: 'review', title: '確認する' },
    { state: 'done', title: '済み' }
];
const filters: ReadonlyArray<{ source: SourceFilter; title: string }> = [
    { source: 'all', title: 'すべて' },
    { source: 'annotation', title: '注釈' },
    { source: 'lint', title: 'リント' },
    { source: 'proposal', title: '提案' },
    { source: 'export', title: '書き出し' }
];
const sourceLabels: Record<string, string> = { annotation: '注釈', lint: 'リント', proposal: '提案', export: '書き出し' };
const outcomeLabels: Record<string, string> = { edited: '編集', declined: '見送り', failed: '失敗', dismissed: '無視' };
const oneLine = (value: unknown): string => String(value ?? '').replace(/\s+/gu, ' ').trim();
const timeLabel = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const elapsedLabel = (value: unknown): string => {
    const then = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(then)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
    return minutes < 1 ? 'たった今' : minutes < 60 ? `${minutes} 分前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 時間前` : `${Math.floor(minutes / 1440)} 日前`;
};

@injectable()
export class AkariTaskBoardWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-task-board-widget';

    @inject(TaskService) protected readonly tasks!: TaskService;
    @inject(ReviewModel) protected readonly review!: ReviewModel;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(AkariRoughCanvasService) protected readonly canvas!: AkariRoughCanvasService;

    protected filter: SourceFilter = 'all';
    protected doneLimit = 50;

    @postConstruct()
    protected init(): void {
        this.id = AkariTaskBoardWidget.FACTORY_ID;
        this.title.label = 'タスクボード';
        this.title.caption = 'タスクボード';
        this.title.iconClass = 'codicon codicon-checklist';
        this.title.closable = true;
        this.node.setAttribute('data-akari-ui', 'panel:task-board');
        this.node.classList.add('akari-task-board');
        Object.assign(this.node.style, { display: 'flex', flexDirection: 'column', minHeight: '0', height: '100%',
            background: 'var(--akari-bg)', color: 'var(--akari-ink)', overflow: 'hidden' });
        this.toDispose.push(this.tasks.onDidChange(() => this.renderBoard()));
        this.renderBoard();
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        // 保存済みレイアウトにこの widget が残っていても、off では復元直後に閉じる。
        try { if (window.localStorage.getItem('akari.vibePreview.enabled') !== '1') this.close(); }
        catch { this.close(); }
    }

    protected makeButton(label: string, run: () => void, kind: 'secondary' | 'quiet' = 'quiet'): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-button ${kind} small`;
        button.textContent = label;
        button.addEventListener('click', run);
        return button;
    }

    protected async send(ids: string[], confirmation = false): Promise<void> {
        if (!ids.length) return;
        if (confirmation && !window.confirm('選んだタスクをパートナーに頼みますか？')) return;
        try {
            for (let index = 0; index < ids.length; index += 20) {
                const result = await this.tasks.send(ids.slice(index, index + 20));
                if (!result.sent.length) break;
            }
            this.renderBoard();
        } catch (error) { this.messages.error(`タスクを頼めませんでした: ${String(error)}`); }
    }

    protected async act(task: Task, action: TaskAction): Promise<void> {
        try {
            if (action.id === 'send') await this.send([task.id], action.confirm === true);
            else if (action.id === 'dismiss') await this.tasks.dismiss(task.id);
            else if (action.id === 'confirm') await this.tasks.confirm(task.id);
            else if (action.id === 'markPasted') await this.tasks.markPasted(task.id);
            else if (action.id === 'retry') await this.tasks.update(task.id, { state: 'unsent' }, 'human');
            else if (action.id === 'approve') await this.tasks.update(task.id,
                { needsConfirm: false, confirmedAt: new Date().toISOString() }, 'human');
            this.renderBoard();
        } catch (error) { this.messages.error(`タスクを変更できませんでした: ${String(error)}`); }
    }

    protected renderCard(task: Task): HTMLElement {
        const card = document.createElement('article');
        card.className = 'akari-task-card';
        card.setAttribute('data-task-id', task.id);
        if (task.unknown || task.state === 'done') card.classList.add('is-dim');
        const anchor = task.anchor as { sourceT?: unknown } | undefined;
        const sourceT = typeof anchor?.sourceT === 'number' && Number.isFinite(anchor.sourceT) ? anchor.sourceT : undefined;
        const severity = typeof task.severity === 'string' ? task.severity : '';
        const source = document.createElement('small');
        source.className = 'akari-task-source';
        source.textContent = [sourceLabels[task.source] ?? task.source,
            task.source === 'lint' && severity ? severity === 'error' ? 'エラー' : severity === 'warning' ? '注意' : severity
                : sourceT === undefined ? '' : timeLabel(sourceT)].filter(Boolean).join(' · ');
        if (task.source === 'lint') source.style.color = severity === 'error' ? 'var(--akari-danger)' : 'var(--akari-warning)';
        else if (task.source === 'proposal') source.style.color = 'var(--akari-accent-light)';
        card.append(source);

        const body = document.createElement('div');
        body.className = 'akari-task-body';
        body.textContent = oneLine(task.body) || oneLine(task.title) || '内容なし';
        card.append(body);

        if (task.source === 'proposal' && task.needsConfirm === true) {
            const origin = task.origin as { memo?: string; job?: string } | undefined;
            const evidence = task.evidence as { quote?: string } | undefined;
            const detail = task.targetDetail as { region?: { box?: number[] } } | undefined;
            const badge = document.createElement('small'); badge.className = 'akari-task-source';
            badge.textContent = '案'; badge.style.color = 'var(--akari-accent-light)';
            const sourceRow = document.createElement('span');
            Object.assign(sourceRow.style, { display: 'inline-flex', alignItems: 'center', gap: '4px' });
            source.replaceWith(sourceRow); sourceRow.append(badge, source);
            const visual = document.createElement('span');
            Object.assign(visual.style, { display: 'inline-flex', alignItems: 'center', gap: '5px' });
            const paperSlot = document.createElement('span');
            const regionSlot = document.createElement('span');
            visual.append(paperSlot, regionSlot); card.append(visual);
            const box = detail?.region?.box;
            const showRegion = (): void => {
                if (!Array.isArray(box) || box.length !== 4) return;
                const diagram = document.createElement('span'); diagram.title = '画面のここ';
                diagram.style.cssText = 'display:block;position:relative;width:72px;height:40px;border:1px solid var(--akari-line);';
                const region = document.createElement('span');
                Object.assign(region.style, { position: 'absolute', left: `${box[0] * 100}%`, top: `${box[1] * 100}%`,
                    width: `${box[2] * 100}%`, height: `${box[3] * 100}%`, border: '1px solid var(--akari-accent)' });
                diagram.append(region); regionSlot.append(diagram);
            };
            showRegion();
            if (origin?.memo && /^c-\d{4,}$/.test(origin.memo)) {
                const older = this.tasks.list().some(other => {
                    const prior = other.origin as { memo?: string; job?: string } | undefined;
                    return prior?.memo === origin.memo && prior?.job !== origin.job
                        && String(prior?.job ?? '') < String(origin.job ?? '');
                });
                if (older) { const newer = document.createElement('small'); newer.textContent = '新しい案'; card.append(newer); }
                const root = this.review.location?.root.toString();
                if (root) void this.canvas.readMemo(root, origin.memo).then(memo => {
                    if (memo.paperDataUrl) {
                        const image = document.createElement('img'); image.alt = '紙のメモ';
                        image.style.maxWidth = '72px'; image.style.maxHeight = '42px'; image.style.objectFit = 'contain';
                        image.onerror = () => image.remove();
                        image.src = memo.paperDataUrl; paperSlot.append(image);
                    }
                }).catch(() => undefined);
            }
            const proof = document.createElement('small'); proof.className = 'akari-task-meta';
            proof.textContent = [evidence?.quote ? `根拠: ${evidence.quote}` : '',
                task.confidence === 'low' ? '位置は自信がありません' : ''].filter(Boolean).join(' · ');
            if (proof.textContent) card.append(proof);
            if (typeof task.question === 'string' && task.question.trim()) {
                const question = document.createElement('small'); question.className = 'akari-task-meta';
                question.textContent = `確かめたいこと: ${task.question}`; card.append(question);
            }
        }

        if (task.state === 'sent') {
            const sentTo = task.sentTo as { agent?: string; route?: string; pasted?: boolean } | undefined;
            const meta = document.createElement('small');
            meta.className = 'akari-task-meta';
            meta.textContent = [sentTo?.agent, elapsedLabel(task.sentAt ?? task.updatedAt),
                sentTo?.route === 'clipboard' && sentTo.pasted !== true ? '貼り付け待ち' : ''].filter(Boolean).join(' · ');
            if (meta.textContent) card.append(meta);
        }
        if (task.state === 'review' && typeof task.outcome === 'string') {
            const outcome = document.createElement('small');
            outcome.className = 'akari-task-outcome';
            outcome.textContent = outcomeLabels[task.outcome] ?? task.outcome;
            if (task.outcome === 'failed') outcome.style.color = 'var(--akari-danger)';
            card.append(outcome);
        }

        const actions = availableActions(task);
        const footer = document.createElement('div');
        footer.className = 'akari-task-actions';
        for (const action of actions) footer.append(this.makeButton(action.label, () => { void this.act(task, action); },
            action.id === 'send' || action.id === 'markPasted' ? 'secondary' : 'quiet'));
        const ui = parseUiTarget(typeof task.target === 'string' ? task.target : null);
        if (task.state !== 'done' && ui && buildUiTargetRow(ui.id).revealable && this.review.location?.editUri) {
            footer.append(this.makeButton('要素へ', () => window.dispatchEvent(new CustomEvent(CLIP_ANNOTATION_REVEAL_EVENT, {
                detail: { editUri: this.review.location?.editUri?.normalizePath().toString(), target: ui.id }
            }))));
        } else if (task.state !== 'done' && sourceT !== undefined) {
            footer.append(this.makeButton('時刻へ', () => this.review.requestSeek(sourceT)));
        }
        if (footer.childElementCount) card.append(footer);
        return card;
    }

    protected renderBoard(): void {
        const allTasks = this.tasks.list();
        const all = allTasks.filter(task => this.filter === 'all' || task.source === this.filter);
        const sendable = all.filter(task => task.state === 'unsent' && task.needsConfirm !== true && !task.unknown);
        this.node.replaceChildren();
        const style = document.createElement('style');
        style.textContent = `
.akari-task-board { container-type:inline-size; }
.akari-task-board .akari-task-header { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--akari-line-inner); min-width:0; }
.akari-task-board .akari-task-heading { font-size:13px; font-weight:700; white-space:nowrap; flex:none; }
.akari-task-board .akari-task-filters { flex:none; min-width:0; max-width:calc(100% - 210px); overflow-x:auto; overflow-y:hidden; white-space:nowrap; }
.akari-task-board .akari-task-filters > button { flex:0 0 auto; white-space:nowrap; }
.akari-task-board .akari-task-filters button:disabled { opacity:.45; cursor:default; }
.akari-task-board .akari-task-bulk { margin-left:auto; flex:none; white-space:nowrap; }
.akari-task-board .akari-task-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); grid-auto-rows:max-content; align-items:start; gap:8px; padding:10px 12px; overflow-x:hidden; overflow-y:auto; min-height:0; flex:1; align-content:start; }
.akari-task-board .akari-task-grid.is-empty { align-content:center; }
.akari-task-board .akari-task-column { min-width:0; min-height:150px; height:max-content; overflow:visible; padding:6px; display:flex; flex-direction:column; gap:5px; background:var(--akari-card); border-radius:8px; }
.akari-task-board .akari-task-column-head { display:flex; justify-content:space-between; padding:0 2px 2px; font-size:11px; font-weight:400; color:var(--akari-faint); }
.akari-task-board .akari-task-card { flex:none; min-width:0; height:max-content; display:grid; gap:3px; padding:5px 6px; border-radius:6px; background:var(--akari-elevated); line-height:1.35; font-size:12px; }
.akari-task-board .akari-task-card.is-dim { opacity:.55; }
.akari-task-board .akari-task-card.is-dim .akari-task-body { text-decoration:line-through; }
.akari-task-board .akari-task-source { font-size:10px; color:var(--akari-muted); }
.akari-task-board .akari-task-body { overflow-wrap:anywhere; white-space:normal; font-weight:400; }
.akari-task-board .akari-task-meta { font-size:10px; color:var(--akari-faint); overflow-wrap:anywhere; }
.akari-task-board .akari-task-outcome { width:max-content; max-width:100%; padding:1px 5px; border-radius:4px; font-size:10px; color:var(--akari-muted); background:var(--akari-card); }
.akari-task-board .akari-task-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:3px; }
.akari-task-board .akari-task-actions .theia-button { margin:0; }
.akari-task-board .akari-task-column-empty { margin:2px 4px; font-size:11px; color:var(--akari-faint); }
.akari-task-board .akari-task-all-empty { grid-column:1/-1; align-self:center; justify-self:center; color:var(--akari-faint); }
@container (max-width:850px) { .akari-task-board .akari-task-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@container (max-width:730px) {
  .akari-task-board .akari-task-header { display:grid; grid-template-columns:max-content minmax(0,1fr); }
  .akari-task-board .akari-task-filters { width:100%; max-width:none; flex-wrap:wrap; overflow:visible; white-space:normal; }
  .akari-task-board .akari-task-bulk { grid-column:1/-1; justify-self:end; margin-left:0; }
}
`;
        this.node.append(style);
        const header = document.createElement('header');
        header.className = 'akari-task-header';
        const heading = document.createElement('span');
        heading.className = 'akari-task-heading';
        heading.textContent = 'タスクボード';
        const filterBar = document.createElement('nav');
        filterBar.className = 'akari-seg akari-task-filters';
        filterBar.setAttribute('role', 'group');
        filterBar.setAttribute('aria-label', '出どころ');
        for (const filter of filters) {
            const count = filter.source === 'all' ? allTasks.length : allTasks.filter(task => task.source === filter.source).length;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `${filter.title} ${count}`;
            button.disabled = count === 0 && filter.source !== 'all';
            button.setAttribute('aria-pressed', String(this.filter === filter.source));
            button.addEventListener('click', () => { this.filter = filter.source; this.doneLimit = 50; this.renderBoard(); });
            filterBar.append(button);
        }
        const bulk = this.makeButton('未送信をまとめて頼む', () => {
            void this.send(sendable.map(task => task.id), sendable.some(task => availableActions(task).find(action => action.id === 'send')?.confirm));
        }, 'secondary');
        bulk.classList.add('akari-task-bulk');
        bulk.disabled = sendable.length === 0;
        header.append(heading, filterBar, bulk);
        this.node.append(header);

        const board = document.createElement('div');
        board.className = 'akari-task-grid';
        if (all.length) for (const column of columns) {
            const section = document.createElement('section');
            section.className = 'akari-task-column';
            section.setAttribute('data-task-column', column.state);
            const rows = column.state === 'unsent' || column.state === 'review'
                ? orderNextTasks(all).filter(task => task.state === column.state)
                : all.filter(task => task.state === column.state)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
            const label = document.createElement('div');
            label.className = 'akari-task-column-head';
            const name = document.createElement('span');
            name.textContent = column.title;
            const count = document.createElement('b');
            count.textContent = String(rows.length);
            label.append(name, count);
            section.append(label);
            if (!rows.length && all.length) {
                const empty = document.createElement('div');
                empty.className = 'akari-task-column-empty';
                empty.textContent = 'タスクはありません';
                section.append(empty);
            }
            for (const task of column.state === 'done' ? rows.slice(0, this.doneLimit) : rows) {
                section.append(this.renderCard(task));
            }
            if (column.state === 'done' && rows.length > this.doneLimit) {
                section.append(this.makeButton('もっと見る', () => { this.doneLimit += 50; this.renderBoard(); }, 'secondary'));
            }
            board.append(section);
        }
        if (!all.length) {
            board.classList.add('is-empty');
            const empty = document.createElement('div');
            empty.className = 'akari-task-all-empty';
            empty.textContent = 'タスクはありません';
            board.append(empty);
        }
        this.node.append(board);
    }
}
