import { BaseWidget } from '@theia/core/lib/browser';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { Task } from '../../common/akari-tasks-protocol';
import { availableActions, type TaskAction } from '../../common/task-actions';
import { orderNextTasks } from '../../common/task-order';
import { buildUiTargetRow, parseUiTarget } from '../../common/doc-target';
import { TaskService } from './task-service';

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
const viaLabels: Record<string, string> = { voice: '声', pen: 'ペン', pointer: '指す', canvas: 'キャンバス',
    typed: '入力', chat: 'チャット', paper: '紙', jev: 'Jev', external: '外部' };
const outcomeLabels: Record<string, string> = { edited: '対応済み', declined: '見送り', failed: '失敗', dismissed: '無視' };
const oneLine = (value: unknown): string => String(value ?? '').replace(/\s+/gu, ' ').trim();

@injectable()
export class AkariTaskBoardWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-task-board-widget';

    @inject(TaskService) protected readonly tasks!: TaskService;
    @inject(MessageService) protected readonly messages!: MessageService;

    protected filter: SourceFilter = 'all';
    protected selected = new Set<string>();
    protected doneLimit = 50;

    @postConstruct()
    protected init(): void {
        this.id = AkariTaskBoardWidget.FACTORY_ID;
        this.title.label = 'タスクボード';
        this.title.caption = 'タスクボード';
        this.title.iconClass = 'codicon codicon-checklist';
        this.title.closable = true;
        this.node.setAttribute('data-akari-ui', 'panel:task-board');
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

    protected visibleTasks(): Task[] {
        return this.tasks.list().filter(task => this.filter === 'all' || task.source === this.filter);
    }

    protected makeButton(label: string, run: () => void, kind: 'primary' | 'secondary' | 'quiet' | 'danger' = 'quiet'): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = kind === 'primary' ? 'theia-button' : `theia-button ${kind}`;
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
            this.selected.clear();
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
            this.renderBoard();
        } catch (error) { this.messages.error(`タスクを変更できませんでした: ${String(error)}`); }
    }

    protected targetLabel(task: Task): string {
        const target = typeof task.target === 'string' ? task.target : null;
        const ui = parseUiTarget(target);
        return ui ? buildUiTargetRow(ui.id).label : target || task.id;
    }

    protected renderCard(task: Task): HTMLElement {
        const card = document.createElement('article');
        card.setAttribute('data-task-id', task.id);
        Object.assign(card.style, { padding: '10px', border: '1px solid var(--akari-line-inner)',
            borderRadius: '8px', background: 'var(--akari-card)', display: 'grid', gap: '6px' });
        if (task.unknown) card.style.opacity = '0.65';
        const top = document.createElement('div');
        Object.assign(top.style, { display: 'flex', gap: '6px', alignItems: 'center' });
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.setAttribute('aria-label', `${task.id} を選ぶ`);
        check.checked = this.selected.has(task.id);
        check.disabled = task.state !== 'unsent' || task.needsConfirm === true || task.unknown === true;
        check.addEventListener('change', () => {
            check.checked ? this.selected.add(task.id) : this.selected.delete(task.id);
            this.renderBoard();
        });
        const source = document.createElement('small');
        source.textContent = sourceLabels[task.source] ?? task.source;
        source.style.color = 'var(--akari-accent)';
        const via = document.createElement('small');
        via.textContent = typeof task.via === 'string' ? `· ${viaLabels[task.via] ?? task.via}` : '';
        via.style.color = 'var(--akari-muted)';
        const title = document.createElement('strong');
        title.textContent = oneLine(task.title) || oneLine(task.body).slice(0, 40) || task.id;
        title.style.flex = '1';
        top.append(check, source, via, title);
        card.append(top);

        const body = document.createElement('div');
        body.textContent = oneLine(task.body);
        Object.assign(body.style, { overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
        card.append(body);

        const meta = document.createElement('small');
        const created = task.createdAt ? new Date(task.createdAt) : undefined;
        meta.textContent = `${this.targetLabel(task)} · ${created && Number.isFinite(created.valueOf()) ? created.toLocaleString('ja-JP') : task.id}`;
        meta.style.color = 'var(--akari-muted)';
        card.append(meta);

        const notes: string[] = [];
        if (task.orphaned === true) notes.push('元の注釈が見つかりません');
        if (task.unknown === true) notes.push('このタスクは表示のみできます');
        const sentTo = task.sentTo as { route?: string; pasted?: boolean } | undefined;
        if (task.state === 'sent' && sentTo?.route === 'clipboard' && sentTo.pasted !== true) notes.push('貼り付けてください');
        if (typeof task.outcome === 'string') notes.push(`結果: ${outcomeLabels[task.outcome] ?? task.outcome}`);
        const response = task.response as { summary?: string } | undefined;
        if (typeof response?.summary === 'string') notes.push(response.summary);
        if (notes.length) {
            const status = document.createElement('small');
            status.textContent = notes.join(' · ');
            status.style.color = task.outcome === 'failed' || task.outcome === 'declined' || task.orphaned
                ? 'var(--akari-danger)' : 'var(--akari-warning)';
            card.append(status);
        }

        const actions = availableActions(task);
        if (actions.length) {
            const footer = document.createElement('div');
            Object.assign(footer.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
            for (const action of actions) {
                footer.append(this.makeButton(action.label, () => { void this.act(task, action); },
                    action.id === 'send' ? 'primary' : action.id === 'dismiss' ? 'danger' : 'quiet'));
            }
            card.append(footer);
        }
        return card;
    }

    protected renderBoard(): void {
        const all = this.visibleTasks();
        const sendable = all.filter(task => task.state === 'unsent' && task.needsConfirm !== true && !task.unknown);
        this.selected = new Set([...this.selected].filter(id => sendable.some(task => task.id === id)));
        this.node.replaceChildren();
        const header = document.createElement('header');
        Object.assign(header.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '12px',
            borderBottom: '1px solid var(--akari-line)' });
        const heading = document.createElement('strong');
        heading.textContent = 'タスクボード';
        heading.style.flex = '1';
        const bulk = this.makeButton('未送信をまとめて頼む', () => {
            void this.send(sendable.map(task => task.id), sendable.some(task => availableActions(task).find(action => action.id === 'send')?.confirm));
        }, 'secondary');
        bulk.disabled = sendable.length === 0;
        const chosen = this.makeButton('選択して頼む', () => {
            const tasks = sendable.filter(task => this.selected.has(task.id));
            void this.send(tasks.map(task => task.id), tasks.some(task => availableActions(task).find(action => action.id === 'send')?.confirm));
        }, 'primary');
        chosen.disabled = this.selected.size === 0;
        header.append(heading, bulk, chosen);
        this.node.append(header);

        const filterBar = document.createElement('nav');
        Object.assign(filterBar.style, { display: 'flex', gap: '4px', padding: '8px 12px', flexWrap: 'wrap' });
        const allTasks = this.tasks.list();
        for (const filter of filters) {
            const count = filter.source === 'all' ? allTasks.length : allTasks.filter(task => task.source === filter.source).length;
            const button = this.makeButton(`${filter.title} ${count}`, () => {
                this.filter = filter.source;
                this.doneLimit = 50;
                this.renderBoard();
            }, this.filter === filter.source ? 'secondary' : 'quiet');
            filterBar.append(button);
        }
        this.node.append(filterBar);

        const board = document.createElement('div');
        Object.assign(board.style, { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
            gap: '8px', overflow: 'auto', minHeight: '0', padding: '8px 12px', flex: '1' });
        for (const column of columns) {
            const section = document.createElement('section');
            section.setAttribute('data-task-column', column.state);
            Object.assign(section.style, { minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' });
            const rows = column.state === 'unsent' || column.state === 'review'
                ? orderNextTasks(all).filter(task => task.state === column.state)
                : all.filter(task => task.state === column.state)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
            const label = document.createElement('strong');
            label.textContent = `${column.title} ${rows.length}`;
            section.append(label);
            for (const task of column.state === 'done' ? rows.slice(0, this.doneLimit) : rows) {
                section.append(this.renderCard(task));
            }
            if (column.state === 'done' && rows.length > this.doneLimit) {
                section.append(this.makeButton('もっと見る', () => { this.doneLimit += 50; this.renderBoard(); }, 'secondary'));
            }
            board.append(section);
        }
        const unknown = all.filter(task => task.unknown || !columns.some(column => column.state === task.state));
        if (unknown.length) {
            const section = document.createElement('section');
            section.textContent = '読み取れないタスク';
            for (const task of unknown) section.append(this.renderCard(task));
            board.append(section);
        }
        this.node.append(board);
    }
}
