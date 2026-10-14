import { t } from '@akari-video/i18n';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConnectService, ConnectorRow } from '../common/connect-protocol';

export const CONNECT_OPEN: Command = { id: 'akari.connect.open', label: t('connect.connectContribution.ui.connectLabel') };

@injectable()
export class ConnectContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(ConnectService) protected readonly service!: ConnectService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CONNECT_OPEN, { execute: async (arg?: { id?: string }) => {
            await registry.executeCommand('akari.settings.open', { section: 'connections', connectorId: arg?.id });
        } });
    }
    onDidInitializeLayout(): void {
        let lastSignature = '';
        let items: Pick<ConnectorRow, 'id' | 'icon' | 'name' | 'logo' | 'background' | 'color' | 'initials'>[] = [];
        let requestId = 0;
        let mountQueued = false;
        const createStack = (): HTMLElement => {
            const stack = document.createElement('span');
            stack.className = 'akari-connect-stack';
            stack.setAttribute('aria-label', t('connect.connectContribution.ui.availableNamesLabel', { names: items.map(item => item.name).join(t('connect.connectContribution.punctuation.listSeparator')) }));
            for (const item of items.slice(0, 5)) {
                const icon = document.createElement('span');
                icon.className = 'akari-connect-stack-icon';
                icon.title = item.name;
                if (item.background) icon.style.background = item.background;
                if (item.color) icon.style.color = item.color;
                if (item.logo) {
                    const image = document.createElement('img');
                    image.src = item.logo;
                    image.alt = '';
                    icon.appendChild(image);
                } else icon.textContent = item.initials || item.icon;
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
            const signature = JSON.stringify(items);
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
                items = snapshot.rows.filter(row => row.status === 'ready' && row.enabled)
                    .map(row => ({ id: row.id, icon: row.icon, name: row.name, logo: row.logo,
                        background: row.background, color: row.color, initials: row.initials }));
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
