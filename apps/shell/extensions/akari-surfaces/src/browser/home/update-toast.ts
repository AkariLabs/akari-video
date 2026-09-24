import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { UpdateStage, noticeStorageKey, shouldAutoShowNotice } from './home-model';
import { AKARI_APP_ICON } from '../settings/app-icon';
import { UPDATER_CANCEL_REQUEST_FILENAME } from '../../electron-common/electron-api';

export interface UpdateToastState {
    stage: UpdateStage;
    version: string;
    channel?: string;
    notesUrl?: string;
    summary?: string;
    sizeLabel?: string;
    progress?: number;
    checking?: boolean;
    fallbackReason?: string;
    downloadUrl?: string;
}

/** Theia notification item cannot show the app icon or per-version dismissal. Keep this tiny view outside Home so tab changes do not hide it. */
@injectable()
export class AkariUpdateToast {
    protected host: HTMLElement | undefined;
    protected toast: HTMLElement | undefined;
    protected bell: HTMLElement | undefined;
    protected observer: MutationObserver | undefined;
    protected state: UpdateToastState | undefined;
    protected visible = false;
    protected cancelledVersion: string | undefined;
    @inject(FileService) protected readonly files!: FileService;
    @inject(EnvVariablesServer) protected readonly env!: EnvVariablesServer;
    onDownload: () => void = () => undefined;
    onOpenBrowser: () => void = () => undefined;
    onRestart: () => void = () => undefined;
    onDismiss: () => void = () => undefined;

    setState(next: UpdateToastState | undefined, options: { dismissed?: boolean } = {}): void {
        const previousStage = this.state?.stage;
        const autoShow = shouldAutoShowNotice(next, this.state, !!next && !!sessionStorage.getItem(noticeStorageKey(next.version)), options.dismissed);
        this.state = next;
        if (autoShow && !(next?.stage === 'found' && next.version === this.cancelledVersion)) { this.visible = true; }
        if (next?.stage === 'downloading' && previousStage !== 'downloading') { this.cancelledVersion = undefined; }
        if (!next) { this.visible = false; }
        this.render();
    }

    showForTest(stage: UpdateStage, version = '99.0.0', notesUrl?: string, progress?: number): void {
        const normalizedProgress = typeof progress === 'number' && Number.isFinite(progress)
            ? Math.max(0, Math.min(100, progress)) : undefined;
        this.setState({ stage, version, notesUrl, progress: normalizedProgress });
        this.visible = true;
        this.render();
    }

    protected element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        node.className = className;
        if (text) { node.textContent = text; }
        return node;
    }

    protected button(text: string, action: () => void, primary = false): HTMLButtonElement {
        const button = this.element('button', primary ? 'akari-update-button primary' : 'akari-update-button', text);
        button.type = 'button';
        button.addEventListener('click', action);
        return button;
    }

    protected ensureHost(): HTMLElement {
        if (this.host) { return this.host; }
        const style = this.element('style', 'akari-update-style');
        style.textContent = `
.akari-update-host{position:fixed;right:20px;bottom:20px;z-index:10020;font-family:var(--theia-ui-font-family, sans-serif);color:var(--theia-foreground)}
.akari-update-toast{width:330px;box-sizing:border-box;border:1px solid var(--theia-widget-border);border-radius:11px;background:var(--theia-sideBar-background);box-shadow:0 12px 35px rgba(0,0,0,.35);padding:14px}
.akari-update-head{display:flex;align-items:center;gap:9px}.akari-update-icon{width:29px;height:29px;border-radius:7px;object-fit:cover}.akari-update-title{font-size:13px;font-weight:700;flex:1}.akari-update-close{border:0;background:none;color:var(--theia-descriptionForeground);font-size:18px;cursor:pointer}.akari-update-copy{font-size:12px;line-height:1.55;color:var(--theia-descriptionForeground);margin:9px 0}.akari-update-copy a{color:var(--theia-textLink-foreground)}.akari-update-actions{display:flex;justify-content:flex-end;gap:6px}.akari-update-button{border:1px solid var(--theia-widget-border);border-radius:5px;background:transparent;color:var(--theia-foreground);padding:6px 10px;cursor:pointer}.akari-update-button.primary{background:var(--theia-button-background);color:var(--theia-button-foreground)}.akari-update-bell{display:block;margin:8px 0 0 auto;border:1px solid var(--theia-widget-border);border-radius:99px;background:var(--theia-sideBar-background);color:var(--theia-foreground);padding:7px 10px;cursor:pointer}.akari-update-progress{height:4px;background:var(--theia-widget-border);border-radius:4px;overflow:hidden;margin:8px 0}.akari-update-progress i{display:block;height:100%;background:var(--theia-focusBorder);animation:akari-update-pulse 1.4s ease-in-out infinite alternate}@keyframes akari-update-pulse{from{transform:translateX(-60%)}to{transform:translateX(250%)}}.akari-update-history{display:flex;align-items:center;gap:9px;padding:12px;cursor:pointer;border-bottom:1px solid var(--theia-widget-border);font-size:12px}.akari-update-history:hover{background:var(--theia-list-hoverBackground)}.akari-update-history img{width:24px;height:24px;border-radius:5px}.akari-update-history span{flex:1}
`;
        document.head.appendChild(style);
        this.host = this.element('div', 'akari-update-host');
        document.body.appendChild(this.host);
        this.observer = new MutationObserver(() => this.injectHistoryEntry());
        this.observer.observe(document.body, { childList: true, subtree: true });
        return this.host;
    }

    protected later(): void {
        if (this.state) { sessionStorage.setItem(noticeStorageKey(this.state.version), '1'); }
        this.visible = false;
        this.render();
    }

    protected async cancelDownload(): Promise<void> {
        const state = this.state;
        if (!state || state.stage !== 'downloading') { return; }
        const override = await this.env.getValue('AKARI_HOME');
        const home = override?.value ? URI.fromFilePath(override.value) :
            new URI(await this.env.getHomeDirUri()).resolve('.akari');
        await this.files.createFolder(home, { fromUserGesture: false });
        await this.files.writeFile(home.resolve(UPDATER_CANCEL_REQUEST_FILENAME),
            BinaryBuffer.fromString(JSON.stringify({ version: state.version, time: Date.now() })));
        this.cancelledVersion = state.version;
        sessionStorage.removeItem(noticeStorageKey(state.version));
        this.visible = false;
        this.render();
    }

    protected injectHistoryEntry(): void {
        if (!this.state) { document.querySelector('.akari-update-history')?.remove(); return; }
        const list = document.querySelector('.theia-notification-center .theia-notification-list');
        if (!list) { return; }
        let entry = list.querySelector('.akari-update-history') as HTMLElement | null;
        if (!entry) {
            entry = this.element('div', 'akari-update-history');
            entry.dataset.akariUpdateHistory = 'true';
            entry.setAttribute('role', 'button');
            entry.tabIndex = 0;
            const icon = this.element('img', '');
            icon.src = AKARI_APP_ICON;
            icon.onerror = () => { const logo = this.element('strong', '', 'AKARI'); icon.replaceWith(logo); };
            icon.alt = 'AKARI Video';
            entry.append(icon, this.element('span', ''));
            const reopen = (): void => {
                (document.querySelector('.theia-notification-center.open .codicon-chevron-down') as HTMLElement | null)?.click();
                this.visible = true;
                this.render();
            };
            entry.addEventListener('click', reopen);
            entry.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reopen(); } });
            list.prepend(entry);
        }
        const label = entry.querySelector('span');
        const text = `AKARI Video v${this.state.version} — 更新のお知らせを開く`;
        if (label && label.textContent !== text) { label.textContent = text; }
    }

    protected render(): void {
        const host = this.ensureHost();
        host.replaceChildren();
        if (!this.state) { return; }
        const state = this.state;
        if (this.visible) {
            const toast = this.element('div', 'akari-update-toast');
            toast.dataset.akariUpdateStage = state.stage;
            toast.setAttribute('role', 'status');
            const head = this.element('div', 'akari-update-head');
            const icon = this.element('img', 'akari-update-icon');
            icon.src = AKARI_APP_ICON;
            icon.onerror = () => { const logo = this.element('strong', '', 'AKARI'); icon.replaceWith(logo); };
            icon.alt = 'AKARI Video';
            head.append(icon, this.element('strong', 'akari-update-title', state.stage === 'ready' ? `v${state.version} の準備ができました` : state.stage === 'downloading' ? `v${state.version} をダウンロード中` : `新しい版${state.channel === 'prerelease' ? '（プレリリース）' : ''}があります — v${state.version}`));
            const close = this.button('×', () => { this.visible = false; this.onDismiss(); this.render(); });
            close.className = 'akari-update-close';
            close.setAttribute('aria-label', 'この版は出さない');
            head.appendChild(close);
            toast.appendChild(head);
            const copy = this.element('p', 'akari-update-copy');
            if (state.stage === 'found') {
                const details = [state.summary, state.sizeLabel ? `約 ${state.sizeLabel}` : undefined].filter(Boolean);
                const reason = state.fallbackReason && state.fallbackReason.length > 180
                    ? `${state.fallbackReason.slice(0, 180)}…` : state.fallbackReason;
                copy.textContent = state.checking ? '更新を確認しています…' : reason
                    ? `アプリ内更新を開始できませんでした（${reason}）。${state.downloadUrl ? 'ブラウザから取得できます。' : '配布先を確認してください。'}`
                    : details.length ? details.join(' · ') : '新しい版をダウンロードできます。';
                if (state.notesUrl && /^https?:\/\//i.test(state.notesUrl)) {
                    const link = this.element('a', '', '変更点');
                    link.href = state.notesUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    copy.append(' ', link);
                }
            } else if (state.stage === 'downloading') {
                copy.textContent = state.progress === undefined ? 'ダウンロードしています。裏で続きます。' : `ダウンロードしています — ${Math.round(state.progress)}%`;
                if (state.notesUrl && /^https?:\/\//i.test(state.notesUrl)) {
                    const link = this.element('a', '', '変更点');
                    link.href = state.notesUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    copy.append(' ', link);
                }
                const progress = this.element('div', 'akari-update-progress');
                const bar = this.element('i', '');
                bar.style.width = `${state.progress ?? 35}%`;
                if (state.progress !== undefined) { bar.style.animation = 'none'; }
                progress.appendChild(bar);
                toast.appendChild(progress);
            } else {
                copy.textContent = '再起動すると新しい版になります。開いているプロジェクトは保存されています。';
            }
            toast.appendChild(copy);
            const actions = this.element('div', 'akari-update-actions');
            if (state.stage === 'found') {
                actions.append(this.button('後で', () => this.later()));
                if (state.checking) {
                    const checking = this.button('確認中…', () => undefined, true);
                    checking.disabled = true;
                    actions.append(checking);
                } else if (state.fallbackReason && state.downloadUrl) {
                    actions.append(this.button('ブラウザでダウンロード', () => this.onOpenBrowser(), true));
                } else {
                    actions.append(this.button(state.fallbackReason ? '再試行' : 'ダウンロード', () => this.onDownload(), true));
                }
            }
            if (state.stage === 'downloading') { actions.append(this.button('やめる', () => { void this.cancelDownload().catch(error => console.error('[akari-surfaces] 更新の取消要求に失敗しました:', error)); })); }
            if (state.stage === 'ready') { actions.append(this.button('次に起動したとき', () => this.later()), this.button('更新して再起動', () => this.onRestart(), true)); }
            toast.appendChild(actions);
            host.appendChild(toast);
            this.toast = toast;
        }
        this.injectHistoryEntry();
        const nativeBell = document.getElementById('status-bar-theia-notification-center');
        if (nativeBell) {
            nativeBell.dataset.akariUpdateBell = 'true';
            this.bell = nativeBell;
        } else if (!this.visible) {
            const bell = this.button('通知', () => { this.visible = true; this.render(); });
            bell.className = 'akari-update-bell';
            bell.dataset.akariUpdateBell = 'true';
            host.appendChild(bell);
            this.bell = bell;
        }
    }
}
