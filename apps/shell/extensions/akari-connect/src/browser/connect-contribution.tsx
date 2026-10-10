import { ApplicationShell, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConnectService } from '../common/connect-protocol';
import { ConnectWidget } from './connect-widget';

export const CONNECT_OPEN: Command = { id: 'akari.connect.open', label: 'つなぐ' };

@injectable()
export class ConnectContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ConnectService) protected readonly service!: ConnectService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CONNECT_OPEN, { execute: async (arg?: { id?: string }) => {
            const widget = await this.widgets.getOrCreateWidget<ConnectWidget>(ConnectWidget.ID);
            if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'main' });
            await this.shell.activateWidget(widget.id);
            widget.select(arg?.id);
        } });
    }
    onDidInitializeLayout(): void {
        let lastSignature = '';
        let items: { id: string; icon: string; name: string }[] = [];
        let requestId = 0;
        let mountQueued = false;
        const createStack = (): HTMLElement => {
            const stack = document.createElement('span');
            stack.className = 'akari-connect-stack';
            stack.setAttribute('aria-label', `接続中: ${items.map(item => item.name).join('、')}`);
            for (const item of items.slice(0, 5)) {
                const icon = document.createElement('span');
                icon.className = 'akari-connect-stack-icon';
                icon.title = item.name;
                icon.textContent = item.icon;
                stack.appendChild(icon);
            }
            if (items.length > 5) {
                const more = document.createElement('span');
                more.className = 'akari-connect-stack-more';
                more.textContent = `+${items.length - 5}`;
                stack.appendChild(more);
            }
            return stack;
        };
        const mountCached = (): void => {
            const tab = document.querySelector<HTMLElement>('#theia-left-content-panel .lm-TabBar-tab[data-akari-rail-id="akari-connect-opener"]');
            if (!tab) return;
            let host = tab.querySelector<HTMLElement>(':scope > .akari-connect-rail-host');
            if (items.length === 0) {
                tab.classList.remove('akari-connect-has-stack');
                host?.remove();
                lastSignature = '';
                return;
            }
            tab.classList.add('akari-connect-has-stack');
            if (!host) {
                host = document.createElement('span');
                host.className = 'akari-connect-rail-host';
                tab.appendChild(host);
            }
            const signature = items.map(row => `${row.id}:${row.icon}:${row.name}`).join('|');
            if (signature !== lastSignature || !host.querySelector('.akari-connect-stack')) {
                host.replaceChildren(createStack());
                lastSignature = signature;
            }
        };
        const scheduleMount = (): void => {
            if (mountQueued) return;
            mountQueued = true;
            queueMicrotask(() => { mountQueued = false; mountCached(); });
        };
        const refreshSnapshot = async (): Promise<void> => {
            const current = ++requestId;
            try {
                const snapshot = await this.service.list();
                if (current !== requestId) return;
                items = snapshot.rows.filter(row => row.status === 'つながった' && row.enabled)
                    .map(row => ({ id: row.id, icon: row.icon, name: row.name }));
                scheduleMount();
            } catch { /* レールは接続状態が読めなくても開ける。 */ }
        };
        const railObserver = new MutationObserver(scheduleMount);
        let observedRail: HTMLElement | null = null;
        const watchRail = (): void => {
            const rail = document.getElementById('theia-left-content-panel');
            if (rail === observedRail) return;
            railObserver.disconnect();
            observedRail = rail;
            if (rail) railObserver.observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-akari-rail-id'] });
            scheduleMount();
        };
        watchRail();
        window.setInterval(watchRail, 1000);
        document.addEventListener('akari-connect-change', () => { void refreshSnapshot(); });
        window.addEventListener('focus', () => { void refreshSnapshot(); });
        window.setInterval(() => { void refreshSnapshot(); }, 60_000);
        void refreshSnapshot();
    }
}
