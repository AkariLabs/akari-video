import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, Disposable, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockTabs } from './vibe-dock-tabs';

interface NextAction { id: string; label: string; confirm?: boolean }
interface NextRow {
    id: string;
    source: string;
    state: string;
    body?: unknown;
    target?: unknown;
    actions: NextAction[];
}
interface NextRowsResult {
    rows: NextRow[];
    summary: { unsent: number; sent: number; review: number; done: number };
    clipboardPending?: number;
}

const sourceLabels: Record<string, string> = { annotation: '注釈', lint: 'リント', proposal: '提案', export: '書き出し' };

export function nextTargetLabel(target: unknown): string {
    if (typeof target !== 'string' || !target) return '';
    const cut = /^ui:timeline:cut:(\d+)$/.exec(target);
    if (cut) return `C${Number(cut[1]) + 1}`;
    return target.startsWith('ui:') ? target.slice(3) : target;
}

@injectable()
export class NextVibeDockTab implements VibeDockTabContribution, FrontendApplicationContribution {
    readonly id = 'next';
    readonly label = '次';
    readonly icon = 'next';
    readonly order = 20;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(VibeDockTabs) protected readonly tabs!: VibeDockTabs;
    protected data: NextRowsResult = { rows: [], summary: { unsent: 0, sent: 0, review: 0, done: 0 } };
    protected readonly changed = new Emitter<void>();
    readonly onChanged: Event<void> = this.changed.event;

    onStart(): void {
        window.addEventListener('akari.tasks.changed', () => { void this.load(); });
        void this.load();
    }

    badge(): { count: number; tone?: 'info' | 'warn' } {
        return { count: this.data.summary.unsent + this.data.summary.review,
            ...(this.data.summary.review > 0 ? { tone: 'warn' as const } : {}) };
    }

    async load(): Promise<void> {
        try {
            const result = await this.commands.executeCommand<NextRowsResult>('akari.tasks.nextRows');
            if (!result || !Array.isArray(result.rows)) return;
            this.data = result;
            this.tabs.refreshBadges();
            this.changed.fire();
        } catch { /* タスクの接続前は空表示を保つ。 */ }
    }

    protected async perform(action: NextAction, id: string): Promise<void> {
        if (action.confirm && !window.confirm('このタスクをパートナーに頼みますか？')) return;
        const command = action.id === 'send' ? 'send' : action.id;
        await this.commands.executeCommand(`akari.tasks.${command}`, action.id === 'send' ? { ids: [id] } : { id });
        await this.load();
    }

    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        const selected = new Set<string>();
        let disposed = false;
        const paint = (): void => {
            if (disposed) return;
            host.replaceChildren();
            const batch = document.createElement('button');
            batch.className = 'theia-button secondary small';
            batch.textContent = 'まとめて頼む';
            batch.title = '選んだタスクをまとめて頼む';
            batch.setAttribute('aria-label', '選んだタスクをまとめて頼む');
            const eligible = this.data.rows.filter(row => selected.has(row.id) && row.actions.some(action => action.id === 'send'));
            batch.hidden = eligible.length === 0;
            batch.addEventListener('click', () => {
                const ids = eligible.map(row => row.id);
                if (eligible.some(row => row.actions.find(action => action.id === 'send')?.confirm)
                    && !window.confirm('選んだタスクをパートナーに頼みますか？')) return;
                void this.commands.executeCommand('akari.tasks.send', { ids }).then(() => this.load());
            });
            host.append(batch);

            if (this.data.clipboardPending) {
                const pending = document.createElement('button');
                pending.className = 'theia-button quiet';
                pending.textContent = `貼り付け待ち ${this.data.clipboardPending} 件`;
                pending.title = pending.textContent;
                pending.setAttribute('aria-label', pending.textContent);
                pending.addEventListener('click', () => { void this.commands.executeCommand('akari.tasks.openBoard'); });
                host.append(pending);
            }
            if (!this.data.rows.length) {
                const empty = document.createElement('div');
                empty.className = 'akari-vibe-empty';
                empty.textContent = '次にやることはありません';
                host.append(empty);
            }
            for (const row of this.data.rows.slice(0, 7)) {
                const line = document.createElement('div');
                line.className = 'akari-vibe-next-row';
                line.setAttribute('data-task-id', row.id);
                line.setAttribute('data-source', row.source);
                const bar = document.createElement('span');
                bar.className = 'akari-vibe-next-bar';
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.setAttribute('aria-label', `${row.id} を選ぶ`);
                check.checked = selected.has(row.id);
                check.disabled = !row.actions.some(action => action.id === 'send');
                check.addEventListener('change', () => { check.checked ? selected.add(row.id) : selected.delete(row.id); paint(); });
                const label = document.createElement('span');
                label.className = 'akari-vibe-next-text';
                label.textContent = String(row.body ?? '').replace(/\s+/gu, ' ').trim() || row.id;
                label.title = label.textContent;
                const target = document.createElement('small');
                target.textContent = [sourceLabels[row.source] ?? row.source, nextTargetLabel(row.target)].filter(Boolean).join(' · ');
                label.append(target);
                const content = document.createElement('span');
                content.className = 'akari-vibe-next-content';
                content.append(check, label);
                line.append(bar, content);
                const actions = document.createElement('span');
                actions.className = 'akari-vibe-next-actions';
                for (const action of row.actions.filter(item => ['send', 'dismiss', 'confirm'].includes(item.id))) {
                    const button = document.createElement('button');
                    button.className = action.id === 'dismiss' ? 'theia-button quiet danger small' : 'theia-button secondary small';
                    button.textContent = action.label;
                    button.title = action.label;
                    button.setAttribute('aria-label', action.label);
                    button.addEventListener('click', () => { void this.perform(action, row.id); });
                    actions.append(button);
                }
                line.append(actions);
                host.append(line);
            }
            const open = document.createElement('button');
            open.className = 'akari-vibe-nav';
            open.textContent = '専用のタスクボードを開く ›';
            open.title = '専用のタスクボードを開く';
            open.setAttribute('aria-label', '専用のタスクボードを開く');
            open.addEventListener('click', () => { void this.commands.executeCommand('akari.tasks.openBoard'); });
            host.append(open);
        };
        const subscription = this.onChanged(paint);
        paint();
        void this.load();
        return Disposable.create(() => { disposed = true; subscription.dispose(); host.replaceChildren(); });
    }
}
