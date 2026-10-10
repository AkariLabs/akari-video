import * as React from '@theia/core/shared/react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ConnectService, ConnectSnapshot, ConnectorRow } from '../common/connect-protocol';
import './connect-style';

const groups = ['AKARI の道具', '素材を作る', '行き来する', '渡す'];

@injectable()
export class ConnectWidget extends ReactWidget {
    static readonly ID = 'akari-connect-widget';
    @inject(ConnectService) protected readonly service!: ConnectService;
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WindowService) protected readonly windows!: WindowService;
    protected snapshot?: ConnectSnapshot;
    protected selectedId = '';
    protected filter = 'すべて';
    protected search = '';
    protected pendingKey = '';

    @postConstruct() protected init(): void {
        this.id = ConnectWidget.ID;
        this.title.label = 'つなぐ';
        this.title.caption = 'チャットから使える道具とサービス';
        this.title.closable = true;
        this.update();
    }
    protected override onAfterAttach(message: Message): void { super.onAfterAttach(message); void this.reload(); }
    async reload(): Promise<void> {
        try { this.snapshot = await this.service.list(); this.update(); document.dispatchEvent(new Event('akari-connect-change')); }
        catch { void this.messages.error('接続状態を読めませんでした。'); }
    }
    select(id?: string): void { if (this.selectedId !== (id ?? '')) this.pendingKey = ''; this.selectedId = id ?? ''; this.update(); void this.reload(); }
    protected selected(): ConnectorRow | undefined { return this.snapshot?.rows.find(row => row.id === this.selectedId); }
    protected async saveKey(row: ConnectorRow): Promise<void> {
        try {
            await this.service.setCredential(row.id, this.pendingKey);
            this.pendingKey = '';
            await this.reload();
        } catch { void this.messages.error('鍵を保存できませんでした。入力と保存先を確認してください。'); }
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
    protected override render(): React.ReactNode {
        const snapshot = this.snapshot;
        const rows = snapshot?.rows ?? [];
        const connected = rows.filter(row => row.status === 'つながった').length;
        const selected = this.selected();
        const visible = (row: ConnectorRow): boolean =>
            (this.filter === 'すべて' || this.filter === row.group || this.filter === 'つながっている' && row.status === 'つながった') &&
            `${row.name} ${row.description}`.toLocaleLowerCase().includes(this.search.toLocaleLowerCase());
        return <div className="akari-connect-view">
            <main className="akari-connect-main">
                <header><div><h2>つなぐ</h2><p>チャットから使える道具とサービス。つないだものは、話しかけるだけで AKARI が使います。</p></div>
                    <input aria-label="探す" placeholder="探す" value={this.search} onChange={event => { this.search = event.currentTarget.value; this.update(); }} /></header>
                <nav className="akari-connect-filters">{['すべて', 'つながっている', ...groups].map(filter =>
                    <button key={filter} data-connect-filter={filter} className={this.filter === filter ? 'active' : ''} onClick={() => { this.filter = filter; this.update(); }}>
                        {filter}{filter === 'つながっている' && <b>{connected}</b>}
                    </button>)}</nav>
                <div className="akari-connect-list">{groups.map(group => {
                    const matches = rows.filter(row => row.group === group && visible(row));
                    return matches.length > 0 && <section key={group}><h3>{group}</h3><div className="akari-connect-grid">
                        {matches.map(row => <button key={row.id} data-connect-id={row.id} className={`akari-connect-card ${this.selectedId === row.id ? 'selected' : ''}`}
                            onClick={() => this.select(row.id)}><span className="akari-connect-icon">{row.icon}</span><strong>{row.name}</strong>
                            <span>{row.description}</span><small data-status={row.status}>{row.status}</small></button>)}
                    </div></section>;
                })}</div>
            </main>
            {selected && <aside className="akari-connect-detail" data-connect-detail={selected.id}><div className="akari-connect-detail-title"><span className="akari-connect-icon">{selected.icon}</span><div><h2>{selected.name}</h2><small data-status={selected.status}>{selected.status}</small></div><button onClick={() => this.select()} aria-label="閉じる">×</button></div>
                <p>{selected.description}</p><div className="akari-connect-setting"><span>つなぎ方</span><strong>{selected.id === 'higgsfield' ? 'API key と secret を : でつないで貼ってください。' : selected.kind === 'key' ? 'API の鍵を追加します。' : selected.id === 'after-effects' ? '環境設定で「スクリプトによるファイルの書き込み」をオンにしてください。' : selected.kind === 'app' ? 'インストール済みのアプリを最初に使うときに確かめます。' : selected.kind === 'planned' ? '準備中です。' : selected.kind === 'browser' ? 'ブラウザでログインして使います。' : 'AKARI に含まれています。'}</strong></div>
                {selected.maskedTail && <div className="akari-connect-setting"><span>登録済みの鍵</span><strong data-connect-masked-tail={selected.id}>••••{selected.maskedTail}</strong></div>}
                {selected.kind === 'key' && <div className="akari-connect-key"><input type="password" data-connect-key-input={selected.id} aria-label="API の鍵" placeholder="API の鍵" value={this.pendingKey} onChange={event => { this.pendingKey = event.currentTarget.value; this.update(); }} /><button data-connect-key-save={selected.id} disabled={!this.pendingKey} onClick={() => void this.saveKey(selected)}>鍵を追加</button><small>鍵はこのパソコンの資格情報ファイルに保存します。チャットには貼らないでください。</small></div>}
                {selected.setupUrl && <button onClick={() => this.windows.openNewWindow(selected.setupUrl!, { external: true })}>{selected.kind === 'browser' ? 'ログイン ↗' : '手順を見る ↗'}</button>}
                {selected.group === '素材を作る' && <div className="akari-connect-order"><span>使う順番</span><button onClick={() => void this.move(selected, -1)}>上へ</button><button onClick={() => void this.move(selected, 1)}>下へ</button></div>}
                {selected.group === '素材を作る' && <label className="akari-connect-toggle">使う <input type="checkbox" checked={selected.enabled} onChange={() => void this.toggle(selected)} /></label>}
                {selected.try && <button className="akari-connect-try" data-connect-try={selected.id} onClick={() => void this.tryInChat(selected)}>チャットで試す「{selected.try}」 →</button>}
            </aside>}
            <footer>失敗したら次へ自動で切り替える <input type="checkbox" checked={snapshot?.fallbackOnFailure ?? false} onChange={async event => { await this.service.setFallbackOnFailure(event.currentTarget.checked); await this.reload(); }} /></footer>
        </div>;
    }
}
