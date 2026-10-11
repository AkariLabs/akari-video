import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { Disposable } from '@theia/core/lib/common';
import { SettingsSectionBodyContribution } from 'akari-surfaces/lib/common/settings-section-body';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConnectService, ConnectSnapshot, ConnectorRow } from '../common/connect-protocol';
import './connect-style';

const groups = ['AKARI の道具', '素材を作る'];
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
    protected filter = 'すべて';
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
        catch { void this.messages.error('接続状態を読めませんでした。'); }
    }
    select(id?: string): void { if (this.selectedId !== (id ?? '')) this.pendingKey = ''; this.selectedId = id ?? ''; this.paint(); void this.reload(); }
    protected selected(): ConnectorRow | undefined { return this.snapshot?.rows.find(row => row.id === this.selectedId); }
    protected async saveKey(row: ConnectorRow): Promise<void> {
        try {
            await this.service.setCredential(row.id, this.pendingKey);
            this.pendingKey = '';
            await this.reload();
        } catch { void this.messages.error('鍵を保存できませんでした。入力と保存先を確認してください。'); }
    }
    protected async removeKey(row: ConnectorRow): Promise<void> {
        try { await this.service.deleteCredential(row.id); await this.reload(); }
        catch { void this.messages.error('鍵を削除できませんでした。'); }
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
            void this.messages.info('AKARI チャットを開けません。');
            return;
        }
        await this.commands.executeCommand('akari.chat.prefill', { text: row.try });
    }
    protected renderContent(): React.ReactElement {
        const snapshot = this.snapshot;
        const rows = snapshot?.rows ?? [];
        const available = rows.filter(row => row.status === '使える' && row.enabled).length;
        const selected = this.selected();
        const visible = (row: ConnectorRow): boolean =>
            (this.filter === 'すべて' || this.filter === row.group || this.filter === '使える' && row.status === '使える' && row.enabled) &&
            `${row.name} ${row.description}`.toLocaleLowerCase().includes(this.search.toLocaleLowerCase());
        return <div className="akari-connect-view">
            <main className="akari-connect-main">
                <header><p>AKARI で使える道具と素材のサービスを表示します。鍵を追加すると使えるようになります。</p>
                    <input aria-label="探す" placeholder="探す" value={this.search} onChange={event => { this.search = event.currentTarget.value; this.paint(); }} /></header>
                <nav className="akari-connect-filters">{['すべて', '使える', ...groups].map(filter =>
                    <button key={filter} data-connect-filter={filter} className={this.filter === filter ? 'active' : ''} onClick={() => { this.filter = filter; this.paint(); }}>
                        {filter}{filter === '使える' && <b>{available}</b>}
                    </button>)}</nav>
                <div className="akari-connect-list">{groups.map(group => {
                    const matches = rows.filter(row => row.group === group && visible(row));
                    return matches.length > 0 && <section key={group}><h3>{group}</h3><div className="akari-connect-rows">
                        {matches.map(row => <button key={row.id} data-connect-id={row.id} className={`akari-connect-card ${this.selectedId === row.id ? 'selected' : ''}`}
                            onClick={() => this.select(row.id)}>{connectorIcon(row)}<span className="akari-connect-row-copy"><strong>{row.name}</strong><span>{row.description}</span></span><small data-status={row.status}>{row.status}</small></button>)}
                    </div></section>;
                })}{rows.length > 0 && !rows.some(visible) && <p>該当する道具やサービスはありません。</p>}</div>
            </main>
            {selected && <aside className="akari-connect-detail" data-connect-detail={selected.id}><div className="akari-connect-detail-title">{connectorIcon(selected)}<div><h2>{selected.name}</h2><small data-status={selected.status}>{selected.status}</small></div><button onClick={() => this.select()} aria-label="閉じる">×</button></div>
                <p>{selected.description}</p><div className="akari-connect-setting"><span>使い方</span><strong>{selected.kind === 'key' ? 'API の鍵を追加します。' : selected.kind === 'blender-recipe' ? 'Blender を使って 3D 素材を作ります。' : selected.kind === 'planned' ? '準備中です。' : 'AKARI に含まれています。'}</strong></div>
                {selected.maskedTail && <div className="akari-connect-setting"><span>登録済みの鍵</span><strong data-connect-masked-tail={selected.id}>••••{selected.maskedTail}</strong>
                    {selected.credentialSource === 'credentials.env' && <button onClick={() => void this.removeKey(selected)}>鍵を削除</button>}</div>}
                {selected.kind === 'key' && <div className="akari-connect-key"><input type="password" data-connect-key-input={selected.id} aria-label="API の鍵" placeholder="API の鍵" value={this.pendingKey} onChange={event => { this.pendingKey = event.currentTarget.value; this.paint(); }} /><button data-connect-key-save={selected.id} disabled={!this.pendingKey} onClick={() => void this.saveKey(selected)}>鍵を追加</button><small>鍵はこのパソコンの資格情報ファイルに保存します。チャットには貼らないでください。</small></div>}
                {selected.setupUrl && <button onClick={() => this.windows.openNewWindow(selected.setupUrl!, { external: true })}>手順を見る ↗</button>}
                {selected.group === '素材を作る' && <div className="akari-connect-order"><span>使う順番</span><button onClick={() => void this.move(selected, -1)}>上へ</button><button onClick={() => void this.move(selected, 1)}>下へ</button></div>}
                {selected.group === '素材を作る' && <label className="akari-connect-toggle">使う <input type="checkbox" checked={selected.enabled} onChange={() => void this.toggle(selected)} /></label>}
                {selected.try && <button className="akari-connect-try" data-connect-try={selected.id} onClick={() => void this.tryInChat(selected)}>チャットで試す「{selected.try}」 →</button>}
            </aside>}
            <footer>失敗したら次へ自動で切り替える <input type="checkbox" checked={snapshot?.fallbackOnFailure ?? false} onChange={async event => { await this.service.setFallbackOnFailure(event.currentTarget.checked); await this.reload(); }} /></footer>
        </div>;
    }
}
