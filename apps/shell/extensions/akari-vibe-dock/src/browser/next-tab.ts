import { t } from './vibe-text';
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
    title?: unknown;
    body?: unknown;
    target?: unknown;
    anchor?: { sourceT?: unknown };
    severity?: unknown;
    actions: NextAction[];
}
interface NextRowsResult {
    rows: NextRow[];
    summary: { unsent: number; sent: number; review: number; done: number };
    clipboardPending?: number;
}

const sourceLabels: Record<string, string> = { annotation: t('vibe.dock.nextTab.annotationsLabel'), lint: t('vibe.dock.nextTab.lintLabel'), proposal: t('vibe.dock.nextTab.suggestionsLabel'), export: t('vibe.dock.nextTab.exportLabel') };

export function nextTargetLabel(target: unknown): string {
    if (typeof target !== 'string' || !target) return '';
    if (/(?:^|,\s*)(?:cut:\d+|overlay:[^,\s]+)/.test(target)) return t('vibe.dock.nextTab.screenLabel');
    const cut = /^ui:timeline:cut:(\d+)$/.exec(target);
    if (cut) return `C${Number(cut[1]) + 1}`;
    return target.startsWith('ui:') ? target.slice(3) : target;
}

function nextRowTitle(row: NextRow): string {
    return String(row.title || row.body || '').replace(/\s+/gu, ' ').trim() || t('vibe.dock.nextTab.noContentLabel');
}

@injectable()
export class NextVibeDockTab implements VibeDockTabContribution, FrontendApplicationContribution {
    readonly id = 'next';
    readonly label = t('vibe.dock.nextTab.nextLabel');
    readonly icon = 'next';
    readonly order = 20;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(VibeDockTabs) protected readonly tabs!: VibeDockTabs;
    protected data: NextRowsResult = { rows: [], summary: { unsent: 0, sent: 0, review: 0, done: 0 } };
    protected notice?: Disposable;
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

    protected showStatus(status: VibeDockContext['status'] | undefined, line: string): void {
        if (!status) return;
        this.notice?.dispose();
        const notice = status.set(line, 'info');
        this.notice = notice;
        setTimeout(() => { if (this.notice === notice) this.notice = undefined; notice.dispose(); }, 4000);
    }

    protected async perform(action: NextAction, id: string, status?: VibeDockContext['status']): Promise<void> {
        if (action.confirm && !window.confirm(t('vibe.dock.nextTab.askPartnerHandleTaskMessage'))) return;
        const command = action.id === 'send' ? 'send' : action.id;
        const result = await this.commands.executeCommand<{ sent?: string[] }>(`akari.tasks.${command}`,
            action.id === 'send' ? { ids: [id] } : { id });
        await this.load();
        if (action.id === 'send' && !result?.sent?.length) return;
        this.showStatus(status, action.id === 'send' ? t('vibe.dock.nextTab.taskSentPartnerNotice')
            : action.id === 'dismiss' ? t('vibe.dock.nextTab.taskIgnoredMessage') : t('vibe.dock.nextTab.reviewedMessage'));
    }

    render(host: HTMLElement, ctx: VibeDockContext): Disposable {
        const selected = new Set<string>();
        let disposed = false;
        const previousStyle = { boxSizing: host.style.boxSizing, display: host.style.display,
            flexDirection: host.style.flexDirection, minHeight: host.style.minHeight, overflow: host.style.overflow };
        Object.assign(host.style, { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: '0', overflow: 'hidden' });
        const paint = (): void => {
            if (disposed) return;
            const scrollTop = host.querySelector?.<HTMLElement>('.akari-vibe-next-list')?.scrollTop ?? 0;
            host.replaceChildren();
            const style = document.createElement('style');
            style.textContent = `
.akari-vibe-next-list { flex:1; min-height:0; overflow:auto; }
.akari-vibe-next-batch { position:sticky; top:0; display:flex; align-items:center; justify-content:space-between; gap:6px; height:24px; padding:0 3px; margin-bottom:4px; background:var(--akari-bg); }
.akari-vibe-next-batch small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--akari-faint); font-size:10px; }
.akari-vibe-next-batch .theia-button { flex:none; min-width:0; margin:0; }
.akari-vibe-next-row { min-height:35px; padding-right:6px; margin-bottom:5px; }
.akari-vibe-next-row[data-selected="true"] { background:var(--akari-selected); }
.akari-vibe-next-row .akari-vibe-next-content { gap:6px; }
.akari-vibe-next-row .akari-vibe-next-text { display:block; min-width:0; flex:1; font-size:11px; line-height:1.35; }
.akari-vibe-next-row .akari-vibe-next-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-vibe-next-row .akari-vibe-next-text small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-vibe-next-row .akari-vibe-next-pick { all:unset; box-sizing:border-box; flex:none; width:11px; height:11px; border:1px solid var(--akari-faint); border-radius:50%; cursor:pointer; }
.akari-vibe-next-row .akari-vibe-next-pick[aria-pressed="true"] { background:var(--akari-accent); border-color:var(--akari-accent); }
.akari-vibe-next-row .akari-vibe-next-pick:focus-visible { outline:2px solid var(--akari-accent-light); outline-offset:2px; }
.akari-vibe-next-row .akari-vibe-next-actions .theia-button { margin:0; min-width:0; padding-inline:6px; }
.akari-vibe-next-open { flex:none; position:static; margin-top:5px; margin-bottom:0; }
`;
            host.append(style);
            const list = document.createElement('div');
            list.className = 'akari-vibe-next-list';
            const eligible = this.data.rows.filter(row => selected.has(row.id) && row.actions.some(action => action.id === 'send'));
            const batch = document.createElement('button');
            batch.className = 'theia-button secondary small';
            batch.textContent = t('vibe.dock.nextTab.askAllText');
            batch.title = t('vibe.dock.nextTab.askPartnerHandleSelectedTasksTooltip');
            batch.setAttribute('aria-label', t('vibe.dock.nextTab.askPartnerHandleSelectedTasksAriaLabel'));
            batch.addEventListener('click', () => {
                const ids = eligible.map(row => row.id);
                if (eligible.some(row => row.actions.find(action => action.id === 'send')?.confirm)
                    && !window.confirm(t('vibe.dock.nextTab.askPartnerHandleSelectedTasksMessage'))) return;
                void this.commands.executeCommand<{ sent?: string[] }>('akari.tasks.send', { ids }).then(async result => {
                    await this.load();
                    if (result?.sent?.length) this.showStatus(ctx.status, t('vibe.dock.nextTab.selectedTasksSentPartnerNotice'));
                });
            });
            if (eligible.length) {
                const band = document.createElement('div');
                band.className = 'akari-vibe-next-batch';
                const count = document.createElement('small');
                count.textContent = t('vibe.dock.nextTab.selectedWithCountText', { value1: eligible.length });
                band.append(count, batch);
                list.append(band);
            }

            if (this.data.clipboardPending) {
                const pending = document.createElement('button');
                pending.className = 'theia-button quiet';
                pending.textContent = t('vibe.dock.nextTab.waitingPasteWithValueText', { value1: this.data.clipboardPending });
                pending.title = pending.textContent;
                pending.setAttribute('aria-label', pending.textContent);
                pending.addEventListener('click', () => { void this.commands.executeCommand('akari.tasks.openBoard'); });
                list.append(pending);
            }
            if (!this.data.rows.length) {
                const empty = document.createElement('div');
                empty.className = 'akari-vibe-empty';
                empty.textContent = t('vibe.dock.nextTab.nothingDoNextText');
                list.append(empty);
            }
            for (const row of this.data.rows.slice(0, 7)) {
                const rowTitle = nextRowTitle(row);
                const line = document.createElement('div');
                line.className = 'akari-vibe-next-row';
                line.setAttribute('data-task-id', row.id);
                line.setAttribute('data-source', row.source);
                line.setAttribute('data-selected', String(selected.has(row.id)));
                const bar = document.createElement('span');
                bar.className = 'akari-vibe-next-bar';
                const check = document.createElement('button');
                check.type = 'button';
                check.className = 'akari-vibe-next-pick';
                check.setAttribute('aria-label', t('vibe.dock.nextTab.selectWithValueAriaLabel', { value1: Array.from(rowTitle).slice(0, 20).join('') }));
                check.setAttribute('aria-pressed', String(selected.has(row.id)));
                check.disabled = !row.actions.some(action => action.id === 'send');
                check.addEventListener('click', () => { selected.has(row.id) ? selected.delete(row.id) : selected.add(row.id); paint(); });
                const label = document.createElement('span');
                label.className = 'akari-vibe-next-text';
                const title = document.createElement('span');
                title.className = 'akari-vibe-next-title';
                title.textContent = rowTitle;
                label.title = title.textContent;
                const target = document.createElement('small');
                const seconds = row.anchor?.sourceT;
                const time = typeof seconds === 'number' && Number.isFinite(seconds)
                    ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '';
                target.textContent = [sourceLabels[row.source] ?? row.source,
                    row.source === 'lint' && typeof row.severity === 'string' ? row.severity === 'error' ? t('vibe.dock.nextTab.errorLabel') : t('vibe.dock.nextTab.warningLabel') : '',
                    time || nextTargetLabel(row.target)].filter(Boolean).join(' · ');
                label.append(title, target);
                const content = document.createElement('span');
                content.className = 'akari-vibe-next-content';
                content.append(check, label);
                line.append(bar, content);
                const actions = document.createElement('span');
                actions.className = 'akari-vibe-next-actions';
                for (const action of row.actions.filter(item => ['send', 'dismiss', 'confirm', 'approve'].includes(item.id))) {
                    const button = document.createElement('button');
                    button.className = action.id === 'dismiss' ? 'theia-button quiet small' : 'theia-button secondary small';
                    button.textContent = action.label;
                    button.title = action.label;
                    button.setAttribute('aria-label', action.label);
                    button.addEventListener('click', () => { void this.perform(action, row.id, ctx.status); });
                    actions.append(button);
                }
                line.append(actions);
                list.append(line);
            }
            host.append(list);
            list.scrollTop = scrollTop;
            const open = document.createElement('button');
            open.className = 'akari-vibe-nav akari-vibe-next-open';
            open.textContent = t('vibe.dock.nextTab.openTaskBoardText');
            open.title = t('vibe.dock.nextTab.openTaskBoardTooltip');
            open.setAttribute('aria-label', t('vibe.dock.nextTab.openTaskBoardAriaLabel'));
            open.addEventListener('click', () => { void this.commands.executeCommand('akari.tasks.openBoard'); });
            host.append(open);
        };
        const subscription = this.onChanged(paint);
        paint();
        void this.load();
        return Disposable.create(() => { disposed = true; subscription.dispose(); host.replaceChildren(); Object.assign(host.style, previousStyle); });
    }
}
