import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { Disposable } from '@theia/core/lib/common';
import { SettingsSectionBodyContribution } from 'akari-surfaces/lib/common/settings-section-body';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConnectService, ConnectSnapshot, ConnectorRow } from '../common/connect-protocol';
import './connect-style';

const groups = ['tools', 'generate'];
const filterLabel = (value: string): string => ({
    'all': t('connect.connectSettingsSection.ui.allLabel'),
    'ready': t('connect.connectSettingsSection.ui.availableLabel'),
    'tools': t('connect.connectSettingsSection.ui.akariToolsLabel'),
    'generate': t('connect.connectSettingsSection.ui.createAssetsLabel')
}[value] ?? value);
const statusLabel = (value: string): string => ({
    'ready': t('connect.connectProtocol.ui.availableLabel'),
    'needs-key': t('connect.connectProtocol.ui.keyRequiredLabel'),
    'planned': t('connect.connectProtocol.ui.comingSoonLabel'),
    'needs-blender': t('connect.connectProtocol.ui.requiresBlenderLabel')
}[value] ?? value);
const connectorIcon = (row: ConnectorRow): React.ReactElement =>
    <span className="akari-connect-icon" style={{ background: row.background, color: row.color }}>
        {row.logo ? <img src={row.logo} alt="" /> : row.initials || row.icon}
    </span>;

@injectable()
export class ConnectSettingsSection implements SettingsSectionBodyContribution {
    readonly sectionId = 'connections';
    protected host?: HTMLElement;
    protected root?: Root;
    @inject(ConnectService) protected readonly service!: ConnectService;
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WindowService) protected readonly windows!: WindowService;
    protected snapshot?: ConnectSnapshot;
    protected selectedId = '';
    protected filter = 'all';
    protected search = '';
    protected pendingKey = '';

    render(host: HTMLElement): Disposable {
        const mount = document.createElement('div');
        mount.className = 'akari-connect-settings-host';
        let placementObserver: MutationObserver | undefined;
        const place = (): boolean => {
            const defaults = host.querySelector('[data-akari-generation-defaults]');
            const lead = host.querySelector('h2 + .akari-set-lead');
            if (defaults) host.insertBefore(mount, defaults);
            else if (lead) lead.after(mount);
            else return false;
            placementObserver?.disconnect();
            return true;
        };
        host.append(mount);
        if (!place()) {
            placementObserver = new MutationObserver(() => { place(); });
            placementObserver.observe(host, { childList: true });
        }
        const root = createRoot(mount);
        this.host = mount;
        this.root = root;
        this.paint();
        void this.reload();
        return Disposable.create(() => {
            this.pendingKey = '';
            placementObserver?.disconnect();
            root.unmount();
            mount.remove();
            if (this.root === root) { this.root = undefined; this.host = undefined; }
        });
    }
    protected paint(): void {
        this.root?.render(this.renderContent());
    }
    async reload(): Promise<void> {
        try { this.snapshot = await this.service.list(); this.paint(); document.dispatchEvent(new Event('akari-connect-change')); }
        catch { void this.messages.error(t('connect.connectSettingsSection.ui.couldNotReadConnectionStatus')); }
    }
    select(id?: string): void { if (this.selectedId !== (id ?? '')) this.pendingKey = ''; this.selectedId = id ?? ''; this.paint(); void this.reload(); }
    protected selected(): ConnectorRow | undefined { return this.snapshot?.rows.find(row => row.id === this.selectedId); }
    protected async saveKey(row: ConnectorRow): Promise<void> {
        try {
            await this.service.setCredential(row.id, this.pendingKey);
            this.pendingKey = '';
            await this.reload();
        } catch { void this.messages.error(t('connect.connectSettingsSection.ui.failedSaveKeyCheckInputSaveLocationError')); }
    }
    protected async removeKey(row: ConnectorRow): Promise<void> {
        try { await this.service.deleteCredential(row.id); await this.reload(); }
        catch { void this.messages.error(t('connect.connectSettingsSection.ui.keyCouldNotDeletedError')); }
    }
    protected async toggle(row: ConnectorRow): Promise<void> {
        await this.service.setEnabled(row.id, !row.enabled);
        await this.reload();
    }
    protected async move(row: ConnectorRow, offset: number): Promise<void> {
        const order = [...(this.snapshot?.generationOrder ?? [])];
        const from = order.indexOf(row.id);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        await this.service.setGenerationOrder(order);
        await this.reload();
    }
    protected async tryInChat(row: ConnectorRow): Promise<void> {
        if (!row.try) return;
        if (!this.commands.getCommand('akari.chat.prefill')) {
            void this.messages.info(t('connect.connectSettingsSection.ui.couldNotOpenAkariChatError'));
            return;
        }
        await this.commands.executeCommand('akari.chat.prefill', { text: row.try });
    }
    protected renderContent(): React.ReactElement {
        const snapshot = this.snapshot;
        const rows = snapshot?.rows ?? [];
        const available = rows.filter(row => row.status === 'ready' && row.enabled).length;
        const selected = this.selected();
        const visible = (row: ConnectorRow): boolean =>
            (this.filter === 'all' || this.filter === row.group || this.filter === 'ready' && row.status === 'ready' && row.enabled) &&
            `${row.name} ${row.description}`.toLocaleLowerCase().includes(this.search.toLocaleLowerCase());
        return <div className="akari-connect-view">
            <main className="akari-connect-main">
                <header><p>{t('connect.connectSettingsSection.ui.connectServicesDescription')}</p>
                    <input aria-label={t('connect.connectSettingsSection.ui.searchLabel')} placeholder={t('connect.connectSettingsSection.ui.searchLabel')} value={this.search} onChange={event => { this.search = event.currentTarget.value; this.paint(); }} /></header>
                <nav className="akari-connect-filters">{['all', 'ready', ...groups].map(filter =>
                    <button key={filter} data-connect-filter={filter} className={this.filter === filter ? 'active' : ''} onClick={() => { this.filter = filter; this.paint(); }}>
                        {filterLabel(filter)}{filter === 'ready' && <b>{available}</b>}
                    </button>)}</nav>
                <div className="akari-connect-list">{groups.map(group => {
                    const matches = rows.filter(row => row.group === group && visible(row));
                    return matches.length > 0 && <section key={group}><h3>{filterLabel(group)}</h3><div className="akari-connect-rows">
                        {matches.map(row => <button key={row.id} data-connect-id={row.id} className={`akari-connect-card ${this.selectedId === row.id ? 'selected' : ''}`}
                            onClick={() => this.select(row.id)}>{connectorIcon(row)}<span className="akari-connect-row-copy"><strong>{row.name}</strong><span>{row.description}</span></span><small data-status={row.status}>{statusLabel(row.status)}</small></button>)}
                    </div></section>;
                })}{rows.length > 0 && !rows.some(visible) && <p>{t('connect.connectSettingsSection.ui.thereNoCorrespondingToolsServicesMessage')}</p>}</div>
            </main>
            {selected && <aside className="akari-connect-detail" data-connect-detail={selected.id}><div className="akari-connect-detail-title">{connectorIcon(selected)}<div><h2>{selected.name}</h2><small data-status={selected.status}>{statusLabel(selected.status)}</small></div><button onClick={() => this.select()} aria-label={t('connect.connectSettingsSection.ui.closeLabel')}>×</button></div>
                <p>{selected.description}</p><div className="akari-connect-setting"><span>{t('connect.connectSettingsSection.ui.howWorksLabel')}</span><strong>{selected.kind === 'key' ? t('connect.connectSettingsSection.ui.addAPIKeyAction') : selected.kind === 'blender-recipe' ? t('connect.connectSettingsSection.ui.createThreeDAssetsBlenderMessage') : selected.kind === 'planned' ? t('connect.connectSettingsSection.ui.comingSoonMessage') : t('connect.connectSettingsSection.ui.includedAkariMessage')}</strong></div>
                {selected.maskedTail && <div className="akari-connect-setting"><span>{t('connect.connectSettingsSection.ui.savedKeyLabel')}</span><strong data-connect-masked-tail={selected.id}>••••{selected.maskedTail}</strong>
                    {selected.credentialSource === 'credentials.env' && <button onClick={() => void this.removeKey(selected)}>{t('connect.connectSettingsSection.ui.deleteKeyAction')}</button>}</div>}
                {selected.kind === 'key' && <div className="akari-connect-key"><input type="password" data-connect-key-input={selected.id} aria-label={t('connect.connectSettingsSection.ui.apiKeyLabel')} placeholder={t('connect.connectSettingsSection.ui.apiKeyLabel')} value={this.pendingKey} onChange={event => { this.pendingKey = event.currentTarget.value; this.paint(); }} /><button data-connect-key-save={selected.id} disabled={!this.pendingKey} onClick={() => void this.saveKey(selected)}>{t('connect.connectSettingsSection.ui.addKeyAction')}</button><small>{t('connect.connectSettingsSection.ui.credentialStorageNotice')}</small></div>}
                {selected.setupUrl && <button onClick={() => this.windows.openNewWindow(selected.setupUrl!, { external: true })}>{t('connect.connectSettingsSection.ui.seeInstructionsLabel')}</button>}
                {selected.group === 'generate' && <div className="akari-connect-order"><span>{t('connect.connectSettingsSection.ui.priorityOrderLabel')}</span><button onClick={() => void this.move(selected, -1)}>{t('connect.connectSettingsSection.ui.moveUpAction')}</button><button onClick={() => void this.move(selected, 1)}>{t('connect.connectSettingsSection.ui.moveDownAction')}</button></div>}
                {selected.group === 'generate' && <label className="akari-connect-toggle">{t('connect.connectSettingsSection.ui.useLabel')}<input type="checkbox" checked={selected.enabled} onChange={() => void this.toggle(selected)} /></label>}
                {selected.try && <button className="akari-connect-try" data-connect-try={selected.id} onClick={() => void this.tryInChat(selected)}>{t('connect.connectSettingsSection.ui.tryInChatAction', { prompt: selected.tryLabel ?? selected.try })}</button>}
            </aside>}
            <footer>{t('connect.connectSettingsSection.ui.automaticallyTryNextServiceIfOneFailsMessage')}<input type="checkbox" checked={snapshot?.fallbackOnFailure ?? false} onChange={async event => { await this.service.setFallbackOnFailure(event.currentTarget.checked); await this.reload(); }} /></footer>
        </div>;
    }
}
