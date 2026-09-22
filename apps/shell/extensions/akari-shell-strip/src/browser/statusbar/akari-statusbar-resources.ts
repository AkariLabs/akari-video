import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import { CommandService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { ShellTerminalServerProxy } from '@theia/terminal/lib/common/shell-terminal-protocol';
import { AkariExportSessionService } from '../akari-export-session-service';
import { AkariPreviewServerService, PreviewServerStatus } from '../../common/preview-server-protocol';
import { AkariStatusbarResourcesService } from '../../common/statusbar-resources-protocol';
import { formatGb, ResourceSample, resolveStatusbarOptions, resourceRows, resourceSummary, RunningItem, StatusbarOptions } from '../../common/statusbar-resources';

const ACCOUNT_ENTRY = 'akari-statusbar-account';
const RESOURCE_ENTRY = 'akari-statusbar-resources';
// surfaces と shell-strip は相互に lib を参照する。型検査時の循環を避けつつ、
// 実行時には設定画面と同じ DI シンボル・RPC プロキシを共有する。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AkariConnectionsService } = require('akari-surfaces/lib/common/akari-connections-protocol') as { AkariConnectionsService: symbol };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { providerLogo, providerInitial } = require('akari-surfaces/lib/browser/settings/provider-catalog') as {
    providerLogo(id: string): string | undefined; providerInitial(label: string): string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AkariProjectService } = require('akari-project/lib/common/akari-project-protocol') as { AkariProjectService: symbol };
interface ConnectionRow { id: string; label: string; configured: boolean }
interface ProviderBalanceResult { ok: boolean; display?: string; error?: string; checked_at: string }
interface ConnectionsClient {
    listConnections(): Promise<{ providers: ConnectionRow[]; store: { connected: boolean } }>;
    readBalance(id: string): Promise<ProviderBalanceResult>;
}

interface StatusbarHook { pollCount: number; lastSample: ResourceSample | null }
declare global { interface Window { __akariStatusbarResources?: StatusbarHook } }

const CSS = `
.akari-statusbar-popup{position:fixed;z-index:10000;width:370px;max-width:calc(100vw - 20px);padding:12px;background:var(--akari-card,#141414);color:var(--akari-ink,#e5e5e5);border:1px solid var(--akari-line,rgba(255,255,255,.13));border-radius:var(--akari-card-radius,12px);box-shadow:0 12px 38px rgba(0,0,0,.34);font:12px system-ui,sans-serif}
.akari-statusbar-popup header{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:650;padding:2px 4px 10px}
.akari-statusbar-popup header button,.akari-statusbar-popup .stop{border:0;background:transparent;color:var(--akari-faint,#999);cursor:pointer;font:inherit;padding:3px 5px;border-radius:5px}
.akari-statusbar-popup header button:hover,.akari-statusbar-popup .stop:hover,.akari-statusbar-popup .provider:hover{background:var(--akari-elevated,#1a1a1a)}
.akari-statusbar-popup .muted{color:var(--akari-faint,#999)}
.akari-statusbar-popup .account{display:flex;gap:10px;align-items:center;padding:9px 6px 13px;border-bottom:1px solid var(--akari-line-inner,#252525)}
.akari-statusbar-popup .avatar{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--akari-elevated,#222)}
.akari-statusbar-popup .provider,.akari-statusbar-popup .running{display:flex;gap:9px;align-items:center;padding:9px 5px;border-radius:5px}
.akari-statusbar-popup .provider{width:100%;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit}
.akari-statusbar-popup .provider .name,.akari-statusbar-popup .running .name{flex:1}
.akari-statusbar-popup .provider-logo{width:18px;height:18px;flex:none;object-fit:contain;text-align:center}
.akari-statusbar-popup .mono,.akari-statusbar-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.akari-statusbar-popup .meter{display:grid;grid-template-columns:128px 1fr 75px;gap:9px;align-items:center;padding:8px 3px}
.akari-statusbar-popup .track{height:5px;border-radius:5px;background:var(--akari-elevated,#292929);overflow:hidden}
.akari-statusbar-popup .track i{display:block;height:100%;background:#6b6b6b;border-radius:5px}
.akari-statusbar-popup .value{text-align:right}
.akari-statusbar-popup .running-list{border-top:1px solid var(--akari-line-inner,#252525);margin-top:7px;padding-top:6px}
`;

@injectable()
export class AkariStatusbarResources implements FrontendApplicationContribution {
    @inject(StatusBar) protected readonly statusBar!: StatusBar;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(TerminalService) protected readonly terminals!: TerminalService;
    @inject(ShellTerminalServerProxy) protected readonly terminalServer!: ShellTerminalServerProxy;
    @inject(AkariExportSessionService) protected readonly exportSession!: AkariExportSessionService;
    @inject(AkariPreviewServerService) protected readonly previewService!: AkariPreviewServerService;
    @inject(AkariStatusbarResourcesService) protected readonly resources!: AkariStatusbarResourcesService;
    @inject(AkariConnectionsService) protected readonly connections!: ConnectionsClient;
    @inject(AkariProjectService) protected readonly store!: { getStoreConnectionStatus(): Promise<{ connected: boolean; identifier?: string; email?: string }> };

    protected app: FrontendApplication | undefined;
    protected sample: ResourceSample | undefined;
    protected options: StatusbarOptions = resolveStatusbarOptions(() => undefined);
    protected timer: number | undefined;
    protected foreground = true;
    protected polling = false;
    protected popup: HTMLElement | undefined;
    protected popupKind: 'account' | 'resources' | undefined;
    protected providers: ConnectionRow[] = [];
    protected storeConnected = false;
    protected accountName: string | undefined;
    protected balances = new Map<string, ProviderBalanceResult>();
    protected balanceCheckedAt: number | undefined;
    protected preview: PreviewServerStatus | undefined;
    protected running: RunningItem[] = [];

    onStart(app: FrontendApplication): void {
        this.app = app;
        const style = document.createElement('style');
        style.id = 'akari-statusbar-resources-style';
        style.textContent = CSS;
        document.head.appendChild(style);
        window.__akariStatusbarResources = { pollCount: 0, lastSample: null };
        this.foreground = !document.hidden;
        document.addEventListener('visibilitychange', () => this.visibilityChanged());
        window.addEventListener('blur', () => { this.foreground = false; this.stopTimer(); });
        window.addEventListener('focus', () => { this.foreground = true; this.visibilityChanged(); });
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName.startsWith('akari.statusBar.')) {
                this.options = resolveStatusbarOptions(key => this.preferences.get(key));
                this.startTimer();
                void this.updateEntries();
                this.renderOpenPopup();
            }
        });
        this.exportSession.onDidChange(() => void this.updateRunning());
        void this.preferences.ready.then(() => {
            this.options = resolveStatusbarOptions(key => this.preferences.get(key));
            this.startTimer();
            void this.updateEntries();
        });
        void this.updateEntries();
        void this.loadConnections();
    }

    protected visibilityChanged(): void {
        if (document.hidden || !this.foreground) this.stopTimer();
        else this.startTimer();
    }

    protected stopTimer(): void {
        if (this.timer !== undefined) window.clearInterval(this.timer);
        this.timer = undefined;
    }

    protected startTimer(): void {
        this.stopTimer();
        if (document.hidden || !this.foreground) return;
        void this.poll();
        this.timer = window.setInterval(() => void this.poll(), this.options.intervalSec * 1000);
    }

    protected async poll(): Promise<void> {
        if (this.polling || document.hidden || !this.foreground) return;
        this.polling = true;
        try {
            const terminalPids = await Promise.all(this.terminals.all.filter(t => !t.exitStatus && t.kind === 'akari-partner').map(t => t.processId.catch(() => 0)));
            if (document.hidden || !this.foreground) return;
            const hook = window.__akariStatusbarResources;
            if (hook) hook.pollCount++;
            const preview = await this.previewService.getStatus().catch(() => undefined);
            const sample = await this.resources.sample([...terminalPids, ...(preview?.pid ? [preview.pid] : [])]);
            if (document.hidden || !this.foreground) return;
            this.sample = sample;
            if (hook) hook.lastSample = sample;
            await this.updateRunning(terminalPids, preview);
            await this.updateEntries();
            this.renderOpenPopup();
        } catch (error) {
            console.warn('[akari-statusbar] resource sample failed', error);
        } finally { this.polling = false; }
    }

    protected async updateRunning(knownPids?: number[], knownPreview?: PreviewServerStatus): Promise<void> {
        const terminals = this.terminals.all.filter(t => !t.exitStatus && t.kind === 'akari-partner');
        const pids = knownPids ?? await Promise.all(terminals.map(t => t.processId.catch(() => 0)));
        const items: RunningItem[] = terminals.map((terminal, index) => ({
            id: `terminal:${terminal.id}`, icon: '⌘', label: terminal.title.label || 'パートナー端末',
            memoryBytes: this.sample?.rssByPid[String(pids[index])] ?? null, stoppable: true
        }));
        const exportStatus = this.exportSession.snapshot.status;
        if (exportStatus.phase === 'linting' || exportStatus.phase === 'rendering') {
            items.push({ id: 'export', icon: '⇩', label: `書き出し ${Math.round(exportStatus.progressPercent ?? 0)}%`, memoryBytes: null, stoppable: true });
        }
        // プレビューサーバー自身が保持する状態を読む。新しいプロセス監視は置かない。
        try { this.preview = knownPreview ?? await this.previewService.getStatus(); } catch { this.preview = undefined; }
        if (this.preview?.phase === 'starting' || this.preview?.phase === 'running') {
            items.push({ id: 'preview', icon: '▣', label: 'プレビュー',
                memoryBytes: this.sample?.rssByPid[String(this.preview.pid)] ?? null, stoppable: true });
        }
        // 文字起こしダイアログが既に描画している進行表示だけを読む。
        const transcribe = document.querySelector('[data-akari-transcribe-progress]')
            ?? Array.from(document.querySelectorAll('[data-akari-transcribe-mode="advanced"][data-step="2"]'))
                .find(node => node.textContent?.includes('起こし中'));
        if (transcribe) items.push({ id: 'transcribe', icon: '♫', label: '文字起こし', memoryBytes: null,
            stoppable: !!this.transcribeCancelButton() });
        this.running = items;
        void this.updateEntries();
        this.renderOpenPopup();
    }

    protected async updateEntries(): Promise<void> {
        const name = this.accountName ?? this.sample?.username ?? 'アカウント';
        const balance = this.options.accountBalance ? [...this.balances.values()].find(item => item.ok)?.display : undefined;
        await this.statusBar.setElement(ACCOUNT_ENTRY, {
            text: `$(account) ${name}${balance ? ` · ${balance}` : ''}`,
            alignment: StatusBarAlignment.LEFT, priority: 10000, name: 'アカウント',
            onclick: event => this.togglePopup('account', event.currentTarget as HTMLElement)
        });
        await this.statusBar.setElement(RESOURCE_ENTRY, {
            text: this.sample ? resourceSummary(this.sample, this.options, this.running.length) : 'CPU — · メモリ —',
            alignment: StatusBarAlignment.RIGHT, priority: 10000, name: 'リソース', className: 'akari-statusbar-mono',
            onclick: event => this.togglePopup('resources', event.currentTarget as HTMLElement)
        });
    }

    protected togglePopup(kind: 'account' | 'resources', anchor: HTMLElement): void {
        if (this.popup && this.popupKind === kind) { this.closePopup(); return; }
        this.closePopup();
        const popup = document.createElement('div');
        popup.className = 'akari-statusbar-popup';
        popup.dataset.akariStatusbarPopup = kind;
        popup.setAttribute('role', 'dialog');
        const rect = anchor.getBoundingClientRect();
        popup.style.bottom = `${Math.max(0, innerHeight - rect.top + 6)}px`;
        popup.style[kind === 'account' ? 'left' : 'right'] = '10px';
        document.body.appendChild(popup);
        this.popup = popup;
        this.popupKind = kind;
        this.renderOpenPopup();
        document.addEventListener('pointerdown', this.outsideClick, true);
        document.addEventListener('keydown', this.escapeKey, true);
        if (kind === 'account') void this.loadConnections();
    }

    protected readonly outsideClick = (event: PointerEvent): void => {
        if (!this.popup?.contains(event.target as Node) && !(event.target as Element).closest?.('#theia-statusBar')) this.closePopup();
    };
    protected readonly escapeKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.closePopup(); };
    protected closePopup(): void {
        this.popup?.remove(); this.popup = undefined; this.popupKind = undefined;
        document.removeEventListener('pointerdown', this.outsideClick, true);
        document.removeEventListener('keydown', this.escapeKey, true);
    }

    protected async loadConnections(): Promise<void> {
        try {
            const [list, store] = await Promise.all([this.connections.listConnections(), this.store.getStoreConnectionStatus()]);
            this.providers = list.providers;
            this.storeConnected = store.connected;
            this.accountName = store.email?.split('@')[0] || store.identifier || this.sample?.username;
        } catch { this.providers = []; this.storeConnected = false; }
        void this.updateEntries();
        this.renderOpenPopup();
    }

    protected async refreshBalances(): Promise<void> {
        const rows = this.providers.filter(row => row.configured && ['openrouter', 'fal', 'elevenlabs'].includes(row.id));
        await Promise.all(rows.map(async row => {
            try { this.balances.set(row.id, await this.connections.readBalance(row.id)); }
            catch { this.balances.set(row.id, { ok: false, error: '取得できません', checked_at: new Date().toISOString() }); }
        }));
        this.balanceCheckedAt = Date.now();
        this.renderOpenPopup();
        void this.updateEntries();
    }

    protected renderOpenPopup(): void {
        if (!this.popup) return;
        this.popup.replaceChildren();
        if (this.popupKind === 'account') this.renderAccount(this.popup);
        else this.renderResources(this.popup);
    }

    protected element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = ''): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = value;
        return node;
    }

    protected renderAccount(popup: HTMLElement): void {
        const heading = this.element('header');
        const refresh = this.element('button', '', `↻ ${this.balanceCheckedAt ? `${Math.max(0, Math.floor((Date.now() - this.balanceCheckedAt) / 60000))} 分前` : '更新'}`);
        refresh.dataset.akariBalanceRefresh = 'true';
        refresh.onclick = () => void this.refreshBalances();
        heading.append(this.element('span', '', 'アカウント'), refresh);
        const account = this.element('div', 'account');
        const detail = this.element('div');
        detail.append(this.element('b', '', this.accountName ?? this.sample?.username ?? 'アカウント'),
            this.element('div', 'muted', this.storeConnected ? 'AKARI Store に接続済み' : 'AKARI Store 未接続'));
        const avatar = this.element('span', 'avatar');
        avatar.append(this.element('i', 'codicon codicon-account'));
        account.append(avatar, detail);
        popup.append(heading, account);
        for (const row of this.providers) {
            const button = this.element('button', 'provider');
            button.dataset.akariProvider = row.id;
            const balance = this.balances.get(row.id);
            const display = !row.configured ? '未接続' : balance?.display ?? (balance?.error || '—');
            const logoUrl = providerLogo(row.id);
            const logo = logoUrl ? this.element('img', 'provider-logo') : this.element('span', 'provider-logo', providerInitial(row.label));
            if (logoUrl && logo instanceof HTMLImageElement) { logo.src = logoUrl; logo.alt = ''; }
            button.append(logo, this.element('span', 'name', row.label),
                this.element('span', 'mono muted', display), this.element('span', 'muted', '›'));
            button.onclick = () => void this.openProvider(row.id);
            popup.append(button);
        }
    }

    protected async openProvider(id: string): Promise<void> {
        this.closePopup();
        // 設定側は section を解決する。provider は先行して渡し、現行版でも DOM の行へ寄せる。
        void this.commands.executeCommand('akari.settings.open', { section: 'connections', provider: id });
        let remaining = 20;
        const focus = (): void => {
            const row = Array.from(document.querySelectorAll<HTMLElement>('[data-akari-provider]'))
                .find(node => node.dataset.akariProvider === id && !node.closest('.akari-statusbar-popup'));
            if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); }
            else if (--remaining > 0) window.setTimeout(focus, 100);
        };
        window.setTimeout(focus, 100);
    }

    protected renderResources(popup: HTMLElement): void {
        const header = this.element('header');
        header.append(this.element('span', '', 'リソース'), this.element('span', 'muted', `${this.options.intervalSec} 秒ごと`));
        popup.append(header);
        if (this.sample) for (const row of resourceRows(this.sample, this.options)) {
            const meter = this.element('div', 'meter');
            meter.dataset.akariResource = row.key;
            const track = this.element('span', 'track');
            const fill = this.element('i');
            fill.style.width = `${row.percent}%`;
            track.append(fill);
            meter.append(this.element('span', '', row.label), track, this.element('span', 'value mono', row.value));
            popup.append(meter);
        }
        if (this.options.running) {
            const list = this.element('div', 'running-list');
            for (const item of this.running) {
                const line = this.element('div', 'running');
                line.dataset.akariRunning = item.id;
                line.append(this.element('span', '', item.icon), this.element('span', 'name', item.label),
                    this.element('span', 'mono muted', item.memoryBytes === null ? '—' : formatGb(item.memoryBytes)));
                if (item.stoppable) {
                    const stop = this.element('button', 'stop', '止める');
                    stop.onclick = () => void this.stopItem(item.id);
                    line.append(stop);
                }
                list.append(line);
            }
            popup.append(list);
        }
    }

    protected async stopItem(id: string): Promise<void> {
        if (id.startsWith('terminal:')) {
            const terminal = this.terminals.getById(id.slice('terminal:'.length));
            if (terminal) {
                await this.terminalServer.close(terminal.terminalId);
                await this.app?.shell.closeWidget(terminal.id);
            }
        }
        else if (id === 'export') await this.exportSession.cancel();
        else if (id === 'preview') await this.previewService.stop();
        else if (id === 'transcribe') this.transcribeCancelButton()?.click();
        await this.updateRunning();
    }

    protected transcribeCancelButton(): HTMLButtonElement | undefined {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[data-akari-transcribe-mode]'));
        for (const dialog of dialogs) {
            const button = Array.from(dialog.querySelectorAll('button')).find(item => item.textContent?.trim() === '中止');
            if (button && dialog.getClientRects().length > 0) return button;
        }
        return undefined;
    }
}
